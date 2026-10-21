/**
 * 整库备份与恢复（A3）。
 *
 * 本地优先意味着没有云端可依赖：换一台机器、清一次浏览器数据，知识库、图谱、摘录就都不在了。这个模块把「什么是这份
 * 库」定义成一个带版本号的 JSON，并给出恢复计划。
 *
 * 两件事刻意分开：**序列化与判定是纯函数**（可测、无 IO），**读写存储是调用方的事**。恢复也不做原地覆盖——只补缺失，
 * 因为「导入一份旧备份把新数据盖掉」是不可逆的，而不可逆的事不该藏在一次文件选择框后面。
 *
 * 备份里**没有 PDF 字节**：文件本身太大、也不属于应用。恢复后文献记录、分块、概览、图谱都在，打开原文时需要重新关联
 * 本地文件（数据体检会把它列为「文件关联失效」，一条一条修）。
 */

import type { DocumentChunk } from '../../../modules/document-agent/public';
import type { KnowledgeFolder, KnowledgeLibraryDocument } from '../adapters/browser-document-corpus';

export const BACKUP_FORMAT = 'pdfpal-knowledge-backup';
export const BACKUP_VERSION = 1;

/**
 * 图谱那一段在备份里是「原样搬运」：这个模块只需要认得节点的 id，不需要知道图谱节点的完整形状——那属于图谱模块。
 * 用 `object` 而不是 `GraphPaper` 也是为了避免知识模块反向依赖图谱模块（会形成循环依赖）。
 */
export type BackupGraphNode = Record<string, unknown>;

export interface BackupGraph {
  papers: BackupGraphNode[];
  entities: BackupGraphNode[];
  edges: BackupGraphNode[];
}

export interface BackupPayload {
  format: string;
  version: number;
  exportedAt: string;
  /** 文献记录：元数据、概览、相关论文、阅读状态、所属文件夹等全在这里。 */
  documents: KnowledgeLibraryDocument[];
  folders: KnowledgeFolder[];
  /** 全文分块，按 documentId 分组。这是重建成本最高的部分，缺了它检索与抽取都要重跑。 */
  chunks: Record<string, DocumentChunk[]>;
  graph: BackupGraph;
  /** 知识笔记（原文摘录/自建笔记的索引）。结构由 viewer 侧的存储决定，这里只负责原样搬运。 */
  notes: unknown[];
}

export interface BackupInput {
  documents: readonly KnowledgeLibraryDocument[];
  folders: readonly KnowledgeFolder[];
  chunks: ReadonlyMap<string, readonly DocumentChunk[]>;
  graph: BackupGraph;
  notes: readonly unknown[];
  exportedAt?: string;
}

/** 组装备份对象。`chunks` 用 Map 传进来，序列化成按 documentId 分组的对象。 */
export function buildBackupPayload(input: BackupInput): BackupPayload {
  const chunks: Record<string, DocumentChunk[]> = {};
  for (const [documentId, list] of input.chunks) {
    if (list.length) chunks[documentId] = [...list];
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    documents: [...input.documents],
    folders: [...input.folders],
    chunks,
    graph: {
      papers: [...input.graph.papers],
      entities: [...input.graph.entities],
      edges: [...input.graph.edges],
    },
    notes: [...input.notes],
  };
}

/** 序列化：缩进两格，方便用户自己打开看一眼，也方便出问题时排查。 */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** 建议的文件名，带日期，避免两次导出互相覆盖。 */
export function backupFileName(exportedAt: string): string {
  const stamp = exportedAt.slice(0, 10).replace(/-/g, '');
  return `pdfpal-backup-${stamp}.json`;
}

export type BackupParseResult =
  | { ok: true; payload: BackupPayload }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 图谱节点的 id，字段名由图谱模块决定（paperId / entityId / edgeId）。 */
function nodeId(node: BackupGraphNode | undefined, key: string): string {
  const value = node?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * 解析并校验一份备份。
 *
 * Strict about the envelope (format/version/arrays), tolerant about the contents: a backup written by a slightly older
 * version can still carry records this build no longer knows about, and refusing the whole file over one unknown key would
 * be worse than importing what is understood.
 */
export function parseBackup(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '这个文件不是有效的 JSON。' };
  }
  if (!isObject(raw)) return { ok: false, error: '备份文件的内容不是一个对象。' };
  if (raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: '这不是 PDFPal 的备份文件。' };
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: '备份文件缺少有效的版本号。' };
  }
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `这份备份来自更新的版本（v${version}），当前版本只认到 v${BACKUP_VERSION}。`,
    };
  }
  if (!Array.isArray(raw.documents)) return { ok: false, error: '备份文件里没有文献记录。' };
  const graph = isObject(raw.graph) ? raw.graph : {};
  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    version,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    documents: raw.documents as KnowledgeLibraryDocument[],
    folders: Array.isArray(raw.folders) ? raw.folders as KnowledgeFolder[] : [],
    chunks: isObject(raw.chunks) ? raw.chunks as Record<string, DocumentChunk[]> : {},
    graph: {
      papers: Array.isArray(graph.papers) ? graph.papers as BackupGraphNode[] : [],
      entities: Array.isArray(graph.entities) ? graph.entities as BackupGraphNode[] : [],
      edges: Array.isArray(graph.edges) ? graph.edges as BackupGraphNode[] : [],
    },
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
  return { ok: true, payload };
}

/** 现有的 id 集合，决定哪些条目已经存在。 */
export interface RestoreExisting {
  documentIds: ReadonlySet<string>;
  folderIds: ReadonlySet<string>;
  chunkDocumentIds: ReadonlySet<string>;
  paperIds: ReadonlySet<string>;
  entityIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  /** 笔记的 id，用来判断是否已经存在。 */
  noteIds: ReadonlySet<string>;
}

export interface RestorePlan {
  documents: KnowledgeLibraryDocument[];
  folders: KnowledgeFolder[];
  chunks: { documentId: string; chunks: DocumentChunk[] }[];
  papers: BackupGraphNode[];
  entities: BackupGraphNode[];
  edges: BackupGraphNode[];
  notes: unknown[];
  /** 因为已经存在而跳过的条数，界面上要说出来。 */
  skipped: {
    documents: number;
    folders: number;
    chunks: number;
    papers: number;
    entities: number;
    edges: number;
    notes: number;
  };
}

/**
 * 恢复计划：只补缺失的条目，绝不覆盖已有的。
 *
 * 「补缺失」而不是「覆盖」有两个理由：一是导入可能发生在一份仍在使用的库上，覆盖会静默丢掉新数据；二是备份里没有 PDF
 * 字节，覆盖之后「打开原文」的关联反而更差。已有条目一律跳过并计入报告。
 */
export function planRestore(payload: BackupPayload, existing: RestoreExisting): RestorePlan {
  const plan: RestorePlan = {
    documents: [],
    folders: [],
    chunks: [],
    papers: [],
    entities: [],
    edges: [],
    notes: [],
    skipped: { documents: 0, folders: 0, chunks: 0, papers: 0, entities: 0, edges: 0, notes: 0 },
  };

  for (const document of payload.documents) {
    if (!document?.documentId || existing.documentIds.has(document.documentId)) {
      plan.skipped.documents += 1;
      continue;
    }
    plan.documents.push(document);
  }
  for (const folder of payload.folders) {
    if (!folder?.id || existing.folderIds.has(folder.id)) {
      plan.skipped.folders += 1;
      continue;
    }
    plan.folders.push(folder);
  }
  for (const [documentId, chunks] of Object.entries(payload.chunks)) {
    // Chunks for a document that already has an index are skipped even if the document itself was new: two indexes for one
    // paper would double every retrieval result.
    if (!chunks.length || existing.chunkDocumentIds.has(documentId)) {
      plan.skipped.chunks += 1;
      continue;
    }
    plan.chunks.push({ documentId, chunks });
  }
  for (const paper of payload.graph.papers) {
    const id = nodeId(paper, 'paperId');
    if (!id || existing.paperIds.has(id)) {
      plan.skipped.papers += 1;
      continue;
    }
    plan.papers.push(paper);
  }
  for (const entity of payload.graph.entities) {
    const id = nodeId(entity, 'entityId');
    if (!id || existing.entityIds.has(id)) {
      plan.skipped.entities += 1;
      continue;
    }
    plan.entities.push(entity);
  }
  for (const edge of payload.graph.edges) {
    const id = nodeId(edge, 'edgeId');
    if (!id || existing.edgeIds.has(id)) {
      plan.skipped.edges += 1;
      continue;
    }
    plan.edges.push(edge);
  }
  for (const note of payload.notes) {
    const id = isObject(note) && typeof note.id === 'string' ? note.id : '';
    if (!id || existing.noteIds.has(id)) {
      plan.skipped.notes += 1;
      continue;
    }
    plan.notes.push(note);
  }
  return plan;
}

/** 一句话说明这次恢复会做什么，用于确认框与结果提示。 */
export function describeRestorePlan(plan: RestorePlan): string {
  const added = [
    plan.documents.length && `${plan.documents.length} 篇文献`,
    plan.folders.length && `${plan.folders.length} 个文件夹`,
    plan.chunks.length && `${plan.chunks.length} 份全文索引`,
    plan.papers.length && `${plan.papers.length} 个图谱节点`,
    plan.entities.length && `${plan.entities.length} 个知识点`,
    plan.edges.length && `${plan.edges.length} 条关系`,
    plan.notes.length && `${plan.notes.length} 条笔记`,
  ].filter(Boolean);
  const skipped = [
    plan.skipped.documents && `${plan.skipped.documents} 篇文献`,
    plan.skipped.papers && `${plan.skipped.papers} 个图谱节点`,
  ].filter(Boolean);
  if (!added.length) return '备份里的内容都已经存在，没有需要导入的东西。';
  return `将导入 ${added.join('、')}${skipped.length ? `；已存在而跳过的有 ${skipped.join('、')}` : ''}。`;
}
