import { getDocumentChunks } from '../../../modules/document-agent/public';
import {
  getDocumentFileHandle,
  planDataHealth,
  paperNameKey,
  type DataHealthFinding,
  type DataHealthGraphPaper,
  type DataHealthReport,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';
import {
  knowledgeGraphRepository,
} from '../../../modules/knowledge-graph/public';
import { listKnowledgeDocuments, updateKnowledgeDocument } from './knowledge-corpus-repository';

/**
 * 数据体检的输入采集与修复动作。
 *
 * 判定本身在 `modules/knowledge/application/data-health.ts`（纯函数、可测）；这里只负责从四处存储把事实读出来，
 * 以及执行「修一条」这件事。每个修复动作都小而明确，没有「全部修复」。
 */

/** 一次体检的结果，附带采集时读到的分块数（`sync-chunk-count` 要用它，避免再读一遍）。 */
export interface DataHealthRun extends DataHealthReport {
  chunkCounts: ReadonlyMap<string, number | null>;
}

/** 读实际分块数。读失败记 `null`，与「0 段」严格区分。 */
async function readChunkCount(documentId: string): Promise<number | null> {
  try {
    const chunks = await getDocumentChunks(documentId);
    return chunks.filter((chunk) => chunk.text.trim().length > 0).length;
  } catch {
    return null;
  }
}

/** 图谱侧的文献与「有没有边」，一次读全，避免每篇文献各读一遍。 */
async function readGraphPapers(): Promise<DataHealthGraphPaper[]> {
  const [papers, edges] = await Promise.all([
    knowledgeGraphRepository.listPapers(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const connected = new Set<string>();
  for (const edge of edges) {
    // 只关心文献节点：实体之间的边不说明这篇文献有没有知识点。
    if (edge.sourceKind === 'paper') connected.add(edge.source);
    if (edge.targetKind === 'paper') connected.add(edge.target);
  }
  return papers.map((paper) => ({
    paperId: paper.paperId,
    title: paper.title,
    extractionStatus: paper.extractionStatus,
    hasEdges: connected.has(paper.paperId),
  }));
}

/** 有文件关联的文献：句柄存在，或最近打开里还留着条目（由调用方判断并传入）。 */
async function readLinkedFileIds(
  documents: readonly KnowledgeLibraryDocument[],
  hasRecentEntry: (document: KnowledgeLibraryDocument) => boolean,
): Promise<Set<string>> {
  const linked = new Set<string>();
  for (const document of documents) {
    if (hasRecentEntry(document)) {
      linked.add(document.documentId);
      continue;
    }
    if (await getDocumentFileHandle(document.documentId)) linked.add(document.documentId);
  }
  return linked;
}

export interface DataHealthCheckOptions {
  /** 「最近打开」里是否还有这条记录的条目。由调用方注入，因为它属于 recent-files 功能。 */
  hasRecentEntry: (document: KnowledgeLibraryDocument) => boolean;
  /** 测试与离线场景可以直接给数据，跳过采集。 */
  documents?: readonly KnowledgeLibraryDocument[];
}

/** 跑一次体检。 */
export async function runDataHealthCheck(options: DataHealthCheckOptions): Promise<DataHealthRun> {
  const documents = options.documents ?? listKnowledgeDocuments();
  const chunkCounts = new Map<string, number | null>();
  for (const document of documents) {
    chunkCounts.set(document.documentId, await readChunkCount(document.documentId));
  }
  const [graphPapers, linkedFileIds] = await Promise.all([
    readGraphPapers(),
    readLinkedFileIds(documents, options.hasRecentEntry),
  ]);
  const report = planDataHealth({
    documents,
    chunkCounts,
    graphPapers,
    linkedFileIds,
    paperNameKey,
  });
  return { ...report, chunkCounts };
}

/** 把记录里的片段数改成实际值。只改记录，不动分块数据。 */
export function syncChunkCount(documentId: string, actual: number): void {
  updateKnowledgeDocument(documentId, { chunkCount: actual });
}

/** 记录说已索引、其实什么都没索引：改成「未索引」，让界面与图谱对同一件事说同一句话。 */
export function markDocumentUnindexed(documentId: string): void {
  updateKnowledgeDocument(documentId, {
    indexStatus: 'pending',
    chunkCount: 0,
    indexError: undefined,
  });
}

/** 重置卡住的图谱抽取状态（本地操作，不花模型调用）。 */
export async function resetStuckExtraction(paperId: string): Promise<boolean> {
  const papers = await knowledgeGraphRepository.listPapers();
  const paper = papers.find((item) => item.paperId === paperId);
  if (!paper || paper.extractionStatus !== 'extracting') return false;
  await knowledgeGraphRepository.putPaper({
    ...paper,
    extractionStatus: 'error',
    extractionError: '抽取没有完成：状态已手动重置，可以重新抽取。',
    extractedAt: null,
  });
  return true;
}

/** 修复动作的统一返回，界面据此决定提示语。 */
export interface DataHealthFixResult {
  ok: boolean;
  message: string;
}

/** 描述「这条问题现在是什么情况」，供修复后的提示使用。 */
export function describeFindingTitle(finding: DataHealthFinding): string {
  return `${finding.documentName}：${finding.message}`;
}
