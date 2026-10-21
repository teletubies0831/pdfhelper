/**
 * 数据体检：找出「记录说一套、实际数据另一套」的地方，并给出可执行的修复建议。
 *
 * 这个模块只做判定，不做 IO、不写库、不花钱——所有输入都是调用方已经读到的快照。这样做的原因很实际：这些不一致
 * 分散在四处存储（文献记录在 localStorage、分块与图谱在 IndexedDB、文件句柄又在另一个 IndexedDB），任何一处对不上
 * 都会让界面自相矛盾，而只有把判定抽成纯函数，才可能把「每一种不一致」都写进测试里。
 *
 * 唯一的例外是 `duplicate`：合并两条记录会丢数据，所以 v1 只报告、不提供自动修复。
 */

import type { KnowledgeLibraryDocument } from '../adapters/browser-document-corpus';

/** 一类不一致。字符串是稳定的，界面与测试都按它分支。 */
export type DataHealthFindingKind =
  | 'chunks-missing'
  | 'chunks-mismatch'
  | 'index-untrusted'
  | 'metadata-missing'
  | 'graph-empty'
  | 'extraction-stuck'
  | 'file-link-missing'
  | 'duplicate';

/** 修复动作的种类。`manual` 表示没有自动动作，只能人去处理。 */
export type DataHealthFixKind =
  | 'rebuild-index'
  | 'sync-chunk-count'
  | 'mark-unindexed'
  | 'complete-metadata'
  | 'extract-graph'
  | 'reset-extraction'
  | 'relink-file'
  | 'manual';

export interface DataHealthFinding {
  kind: DataHealthFindingKind;
  /** 严重程度：`broken` 说明功能已经不可用（例如抽取已无法进行），`warn` 说明数据自相矛盾但不致命。 */
  severity: 'broken' | 'warn';
  documentId: string;
  documentName: string;
  /** 一句话说明，直接给用户看。 */
  message: string;
  /** 这条要怎么修；`manual` 表示没有自动动作。 */
  fix: DataHealthFixKind;
  /** 修复动作的说明（按钮上或确认框里用）；`manual` 时是给人看的建议。 */
  fixLabel: string;
  /** 修复要不要花模型调用。 */
  costsMoney: boolean;
}

/** 图谱侧每篇文献的最小信息：这些字段来自投影，不需要整份实体/关系。 */
export interface DataHealthGraphPaper {
  paperId: string;
  title: string;
  extractionStatus: 'none' | 'queued' | 'extracting' | 'ready' | 'error';
  /** 这篇文献在图谱里是否至少有一条边（论文↔实体或论文↔论文）。 */
  hasEdges: boolean;
}

export interface DataHealthInput {
  documents: readonly KnowledgeLibraryDocument[];
  /** 实际读到的正文分块数，按 documentId。读失败时为 `null`（与「0 段」不是一回事）。 */
  chunkCounts: ReadonlyMap<string, number | null>;
  /** 图谱里的文献，按 paperId（= documentId）。 */
  graphPapers: readonly DataHealthGraphPaper[];
  /** 有可用文件句柄（或最近打开里能找到）的文献 id。 */
  linkedFileIds: ReadonlySet<string>;
  /** 论文名归一化函数（与「同一篇文献」判定共用），用于找重复记录。 */
  paperNameKey: (name: string) => string;
}

export interface DataHealthReport {
  findings: DataHealthFinding[];
  /** 按严重程度排序后的待处理条数，给侧栏徽标用。 */
  total: number;
  broken: number;
}

/** 一条文献是否「什么都没写」。与 `hasDocumentMetadata` 同口径，但这里不需要它，只要字段是否非空。 */
function hasAnyMetadata(document: KnowledgeLibraryDocument): boolean {
  const authors = Array.isArray(document.authors) ? document.authors : [];
  return authors.length > 0
    || Boolean(document.publishDate || document.doi || document.documentUrl || document.language);
}

function findingKindSeverity(kind: DataHealthFindingKind): 'broken' | 'warn' {
  // 「分裂」类问题的共同点：用户看到的状态是假的，而且下一步必然做错（去建索引、去抽取、去打开原文）。
  return kind === 'chunks-missing'
    || kind === 'graph-empty'
    || kind === 'extraction-stuck'
    || kind === 'index-untrusted'
    ? 'broken'
    : 'warn';
}

/**
 * 判定一篇文献的问题。
 *
 * 顺序有意如此：先修数据（分块），再看依赖它的东西（图谱抽取）。一篇分块丢失的文献，同时也会被报成「图谱里没有
 * 知识」——那不是两条问题，是一条问题的两个症状，所以分块缺失时不再重复报图谱项。
 */
function findingsForDocument(
  document: KnowledgeLibraryDocument,
  chunks: number | null,
  graph: DataHealthGraphPaper | undefined,
  linkedFile: boolean,
): DataHealthFinding[] {
  const findings: DataHealthFinding[] = [];
  const base = {
    documentId: document.documentId,
    documentName: document.documentName,
  };
  const recordedChunks = Number(document.chunkCount) || 0;
  const claimsIndexed = document.indexStatus === 'ready';

  if (chunks === null) {
    // 读取失败不能当成「没有分块」：那正是上一轮把存储故障误报成「请先建立索引」的坑。
    findings.push({
      ...base,
      kind: 'chunks-missing',
      severity: 'broken',
      message: '读取本地索引失败，无法确认这篇文献的正文分块是否还在（这是存储读取问题，不是缺少索引）。',
      fix: 'manual',
      fixLabel: '可在扩展的「应用 → 存储」里检查，或先关闭其它标签页后重试体检。',
      costsMoney: false,
    });
    return findings;
  }

  if (claimsIndexed && recordedChunks > 0 && chunks === 0) {
    findings.push({
      ...base,
      kind: 'chunks-missing',
      severity: 'broken',
      message: `记录显示已索引 ${recordedChunks} 个片段，但本地分块数据是 0 段——图谱抽取和跨文献检索都用不了它。`,
      fix: 'rebuild-index',
      fixLabel: '重建索引',
      costsMoney: false,
    });
    return findings;
  }

  if (chunks > 0 && chunks !== recordedChunks) {
    findings.push({
      ...base,
      kind: 'chunks-mismatch',
      severity: 'warn',
      message: `记录里的片段数是 ${recordedChunks}，实际是 ${chunks} 段。`,
      fix: 'sync-chunk-count',
      fixLabel: `把记录改成 ${chunks} 段`,
      costsMoney: false,
    });
  }

  if (claimsIndexed && recordedChunks === 0 && chunks === 0) {
    findings.push({
      ...base,
      kind: 'index-untrusted',
      severity: 'broken',
      message: '记录说已索引，但既没有片段数也没有分块数据。',
      fix: 'mark-unindexed',
      fixLabel: '标记为未索引',
      costsMoney: false,
    });
  }

  if (graph) {
    if (graph.extractionStatus === 'extracting') {
      findings.push({
        ...base,
        kind: 'extraction-stuck',
        severity: 'broken',
        message: '抽取状态停在「进行中」，但已经没有正在运行的任务（多半是中途刷新或关闭了页面）。',
        fix: 'reset-extraction',
        fixLabel: '重置为待抽取',
        costsMoney: false,
      });
    } else if (!graph.hasEdges && chunks > 0 && (graph.extractionStatus === 'ready' || graph.extractionStatus === 'none')) {
      findings.push({
        ...base,
        kind: 'graph-empty',
        severity: 'broken',
        message: graph.extractionStatus === 'ready'
          ? '图谱里的抽取标记为已完成，但这篇文献没有任何知识点或关系——抽取结果已经不在了。'
          : '这篇文献已经进入图谱，但还没有抽取过知识点。',
        fix: 'extract-graph',
        fixLabel: '重新抽取',
        costsMoney: true,
      });
    }
  }

  if (document.metadataStatus !== 'skipped' && !hasAnyMetadata(document)) {
    findings.push({
      ...base,
      kind: 'metadata-missing',
      severity: 'warn',
      message: '作者、发表日期、DOI 都还空着。',
      fix: 'complete-metadata',
      fixLabel: '补全元数据',
      costsMoney: true,
    });
  }

  if (!linkedFile) {
    findings.push({
      ...base,
      kind: 'file-link-missing',
      severity: 'warn',
      message: '这份文献和本地文件的关联已经不在了（「最近打开」只保留 12 项，旧记录会被挤出去）。',
      fix: 'relink-file',
      fixLabel: '重新选择文件',
      costsMoney: false,
    });
  }

  return findings;
}

/**
 * 找出重复记录：论文名归一化后相同、页数也相同，但不是同一条记录。
 *
 * 与 `findSamePaperDocument` 同一口径——那里的两条信号（名字 + 页数）是「判定必须在抽取之前完成」的结果，这里沿用
 * 同样的理由：不能为了查重去调用模型。
 */
function duplicateFindings(
  documents: readonly KnowledgeLibraryDocument[],
  paperNameKey: (name: string) => string,
): DataHealthFinding[] {
  const byKey = new Map<string, KnowledgeLibraryDocument[]>();
  for (const document of documents) {
    const key = paperNameKey(document.documentName);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(document);
    else byKey.set(key, [document]);
  }
  const findings: DataHealthFinding[] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    for (const document of bucket) {
      const others = bucket.filter((item) => item.documentId !== document.documentId);
      const pages = others.map((item) => item.pageCount).filter((count) => count === document.pageCount);
      if (!pages.length) continue;
      findings.push({
        documentId: document.documentId,
        documentName: document.documentName,
        kind: 'duplicate',
        severity: 'warn',
        message: `知识库里还有 ${pages.length} 条同名同页数的记录（${others.map((item) => item.documentName).join('、')}）。`,
        fix: 'manual',
        fixLabel: '确认保留哪一条后再删掉其余记录（合并会在后续版本提供）。',
        costsMoney: false,
      });
    }
  }
  return findings;
}

/**
 * 体检入口。
 *
 * 排序：严重 → 警告；同级按文献名，让同一篇文献的问题排在一起，界面上按文献分组就不需要再排序。
 */
export function planDataHealth(input: DataHealthInput): DataHealthReport {
  const graphByPaper = new Map(input.graphPapers.map((paper) => [paper.paperId, paper]));
  const findings: DataHealthFinding[] = [];

  for (const document of input.documents) {
    // `undefined` (never measured) and `null` (measured, read failed) are both "unknown" — and 0 is a real measurement.
    const measured = input.chunkCounts.get(document.documentId);
    findings.push(...findingsForDocument(
      document,
      measured === undefined ? null : measured,
      graphByPaper.get(document.documentId),
      input.linkedFileIds.has(document.documentId),
    ));
  }
  findings.push(...duplicateFindings(input.documents, input.paperNameKey));

  findings.sort((left, right) => {
    const severity = (left.severity === 'broken' ? 0 : 1) - (right.severity === 'broken' ? 0 : 1);
    if (severity !== 0) return severity;
    return left.documentName.localeCompare(right.documentName)
      || left.kind.localeCompare(right.kind);
  });

  return {
    findings,
    total: findings.length,
    broken: findings.filter((finding) => finding.severity === 'broken').length,
  };
}

/** 一句话总结，给侧栏徽标的 title 与对话框标题用。 */
export function describeDataHealth(report: DataHealthReport): string {
  if (!report.total) return '没有发现数据问题。';
  return report.broken
    ? `发现 ${report.total} 处问题，其中 ${report.broken} 处会让功能不可用。`
    : `发现 ${report.total} 处问题，都不影响当前使用。`;
}
