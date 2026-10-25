import { getDocumentChunks, replaceDocumentChunks } from '../../../modules/document-agent/public';
import {
  backupFileName,
  buildBackupPayload,
  describeRestorePlan,
  parseBackup,
  planRestore,
  serializeBackup,
  type BackupGraph,
  type BackupPayload,
  type RestoreExisting,
} from '../../../modules/knowledge/public';
import { knowledgeGraphRepository } from '../../../modules/knowledge-graph/public';
import type { GraphEdge, GraphEntity, GraphPaper } from '../../../modules/knowledge-graph/public';
import {
  addKnowledgeDocument,
  createKnowledgeFolder,
  listKnowledgeDocuments,
  listKnowledgeFolders,
  updateKnowledgeDocument,
} from './knowledge-corpus-repository';
import { readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import type { SavedKnowledgeNote } from '../../app/public';
import { refreshKnowledgeBaseIfOpen } from './knowledge-base-controller';

/**
 * 设置 →「备份与恢复」的接线。
 *
 * 读写存储都在这里，判定在 `modules/knowledge/application/backup.ts`（纯函数、可测）。导出永远不询问；导入先做计划、
 * 把「将导入什么、跳过什么」摆出来，用户确认后才写——它虽然只补缺失，但恢复一份备份仍然是会改变库的操作。
 */

const EXPORT_BUTTON_ID = 'settings-backup-export';
const IMPORT_BUTTON_ID = 'settings-backup-import';
const FILE_INPUT_ID = 'settings-backup-file';
const SUMMARY_ID = 'settings-backup-summary';
const STATUS_ID = 'settings-backup-status';

let installed = false;
let busy = false;

function setStatus(message: string, isError = false): void {
  const element = document.getElementById(STATUS_ID);
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', isError);
}

function setSummary(message: string): void {
  const element = document.getElementById(SUMMARY_ID);
  if (element) element.textContent = message;
}

/** 收集当前库的一切。分块按文献逐篇读：一篇读失败不该让整次导出失败，只记一条警告。 */
async function collectBackup(): Promise<{ payload: BackupPayload; unreadable: string[] }> {
  const documents = listKnowledgeDocuments();
  const folders = listKnowledgeFolders();
  const chunks = new Map<string, Awaited<ReturnType<typeof getDocumentChunks>>>();
  const unreadable: string[] = [];
  for (const document of documents) {
    try {
      const list = await getDocumentChunks(document.documentId);
      if (list.length) chunks.set(document.documentId, list);
    } catch {
      unreadable.push(document.documentName);
    }
  }
  const [papers, entities, edges] = await Promise.all([
    knowledgeGraphRepository.listPapers(),
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const payload = buildBackupPayload({
    documents,
    folders,
    chunks,
    // The backup module treats graph nodes as opaque JSON (it only reads their ids), so the cast happens at this boundary
    // rather than making the knowledge module depend on the graph module's types.
    graph: { papers, entities, edges } as unknown as BackupGraph,
    notes: readSavedKnowledgeNotes(),
  });
  return { payload, unreadable };
}

/** 文件夹的层级深度，用来保证父文件夹先被创建。 */
function folderDepth(folder: { id: string; parentId: string | null }, all: readonly { id: string; parentId: string | null }[]): number {
  let depth = 0;
  let current = folder.parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current) && depth < 32) {
    seen.add(current);
    depth += 1;
    current = all.find((item) => item.id === current)?.parentId ?? null;
  }
  return depth;
}

function downloadText(fileName: string, text: string): void {  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next task: revoking synchronously can cancel the download in some Chromium versions.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportKnowledgeBackup(): Promise<void> {
  if (busy) return;
  busy = true;
  setStatus('正在整理备份…');
  try {
    const { payload, unreadable } = await collectBackup();
    if (!payload.documents.length && !payload.graph.papers.length) {
      setStatus('这个库还是空的，没有可导出的内容。', true);
      return;
    }
    const fileName = backupFileName(payload.exportedAt);
    downloadText(fileName, serializeBackup(payload));
    const parts = [
      `${payload.documents.length} 篇文献`,
      `${Object.keys(payload.chunks).length} 份全文索引`,
      `${payload.graph.papers.length} 个图谱节点`,
      `${payload.notes.length} 条笔记`,
    ];
    setStatus(`已导出 ${fileName}（${parts.join('、')}）。PDF 文件本身不在备份里。`);
    setSummary(`上次导出：${fileName}`);
    if (unreadable.length) {
      setStatus(
        `已导出 ${fileName}，但有 ${unreadable.length} 篇文献的全文索引读不出来，未包含在内：${unreadable.join('、')}。`,
        true,
      );
    }
  } catch (error) {
    setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    busy = false;
  }
}

async function collectExisting(payload: BackupPayload): Promise<RestoreExisting> {
  const documents = listKnowledgeDocuments();
  const folders = listKnowledgeFolders();
  const chunkDocumentIds = new Set<string>();
  for (const document of documents) {
    try {
      const chunks = await getDocumentChunks(document.documentId);
      if (chunks.some((chunk) => chunk.text.trim())) chunkDocumentIds.add(document.documentId);
    } catch {
      // Unreadable now does not mean "导入一份": leaving it out of the set lets the backup's chunks restore it.
    }
  }
  const [papers, entities, edges] = await Promise.all([
    knowledgeGraphRepository.listPapers(),
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const notes = readSavedKnowledgeNotes();
  return {
    documentIds: new Set(documents.map((document) => document.documentId)),
    folderIds: new Set(folders.map((folder) => folder.id)),
    chunkDocumentIds,
    paperIds: new Set(papers.map((paper) => paper.paperId)),
    entityIds: new Set(entities.map((entity) => entity.entityId)),
    edgeIds: new Set(edges.map((edge) => edge.edgeId)),
    noteIds: new Set(notes.map((note) => note.id)),
  };
}

export async function importKnowledgeBackup(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  setStatus('正在读取备份…');
  try {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setStatus(parsed.error, true);
      return;
    }
    const existing = await collectExisting(parsed.payload);
    const plan = planRestore(parsed.payload, existing);
    const description = describeRestorePlan(plan);
    if (!plan.documents.length && !plan.papers.length && !plan.chunks.length && !plan.notes.length) {
      setStatus(description);
      setSummary(`上次导入：${file.name}（没有新增内容）`);
      return;
    }
    if (!window.confirm(`${description}\n\n已有内容不会被覆盖。继续导入吗？`)) {
      setStatus('已取消导入。');
      return;
    }
    setStatus('正在写入…');
    // Folders first, parents before children, so a child can point at its parent's *new* id; the map then rewrites each
    // document's folderId. `createKnowledgeFolder` mints ids, which is why this is not a straight copy of the objects.
    const folderIdMap = new Map<string, string>();
    const ordered = [...plan.folders].sort((left, right) => folderDepth(left, plan.folders) - folderDepth(right, plan.folders));
    for (const folder of ordered) {
      const created = createKnowledgeFolder(folder.name, folder.parentId ? folderIdMap.get(folder.parentId) ?? null : null);
      folderIdMap.set(folder.id, created.id);
    }
    for (const document of plan.documents) {
      addKnowledgeDocument({
        documentId: document.documentId,
        documentName: document.documentName,
        pageCount: document.pageCount,
        recentEntryId: document.recentEntryId,
      });
      // `addKnowledgeDocument` only knows the four identity fields; everything else (metadata, overview, reading state,
      // folder) is restored on top. `recentEntryId` is deliberately blank: the backup's entry ids belong to another
      // machine's 最近打开 list, and pointing at them would make 「打开原文」 fail instead of asking for the file.
      //
      // The index fields are restored *after* the chunks below, not here: a record that says 「已索引 40 个片段」 while the
      // import is still running (or after it failed halfway) is exactly the lie 数据体检 exists to find.
      const { documentId: _id, addedAt: _added, indexStatus: _status, chunkCount: _chunks, indexError: _error, ...patch } = document;
      updateKnowledgeDocument(document.documentId, {
        ...patch,
        recentEntryId: undefined,
        folderId: document.folderId ? folderIdMap.get(document.folderId) ?? null : null,
      });
    }
    for (const entry of plan.chunks) await replaceDocumentChunks(entry.documentId, entry.chunks);
    // Only now may a record claim its index: the chunks it describes are in place (or the backup had none for it, in which
    // case the record stays 未索引 and 数据体检 will offer to rebuild).
    for (const entry of plan.chunks) {
      const source = plan.documents.find((document) => document.documentId === entry.documentId);
      if (!source) continue;
      updateKnowledgeDocument(entry.documentId, {
        indexStatus: source.indexStatus ?? 'ready',
        chunkCount: source.chunkCount ?? entry.chunks.length,
        indexError: undefined,
      });
    }
    if (plan.papers.length) await knowledgeGraphRepository.putPapers(plan.papers as unknown as GraphPaper[]);
    if (plan.entities.length) await knowledgeGraphRepository.putEntities(plan.entities as unknown as GraphEntity[]);
    if (plan.edges.length) await knowledgeGraphRepository.putEdges(plan.edges as unknown as GraphEdge[]);
    let droppedNotes = 0;
    if (plan.notes.length) {
      const existingNotes = readSavedKnowledgeNotes();
      const merged = [...existingNotes, ...plan.notes as SavedKnowledgeNote[]];
      // `writeSavedKnowledgeNotes` caps at 500; the imported notes are appended last, so a full library would drop exactly
      // the notes this import was for. Count them and say so instead of finishing silently.
      droppedNotes = Math.max(0, merged.length - 500);
      writeSavedKnowledgeNotes(merged);
    }
    setStatus(
      droppedNotes
        ? `导入完成。${description}但笔记上限 500 条，有 ${droppedNotes} 条导出的笔记没有导入。`
        : `导入完成。${description}`,
      droppedNotes > 0,
    );
    setSummary(`上次导入：${file.name}`);
    refreshKnowledgeBaseIfOpen();
  } catch (error) {
    setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    busy = false;
  }
}

/** 绑定设置页里那一栏。幂等：重复调用不会重复绑定。 */
export function installBackupSettings(): void {
  if (installed) return;
  installed = true;
  document.getElementById(EXPORT_BUTTON_ID)?.addEventListener('click', () => {
    void exportKnowledgeBackup();
  });
  const input = document.getElementById(FILE_INPUT_ID) as HTMLInputElement | null;
  document.getElementById(IMPORT_BUTTON_ID)?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    // Clear first: picking the same file twice must fire `change` again.
    input.value = '';
    void importKnowledgeBackup(file);
  });
}
