import {
  createGraphSnapshot,
  describeImportPlan,
  knowledgeGraphRepository,
  parseGraphSnapshot,
  planGraphImport,
  suggestSnapshotFileName,
  type GraphImportPlan,
  type ImportStrategy,
} from '../../../modules/knowledge-graph/public';
import { setStatus } from '../../app/status-bar';

/**
 * Graph export and import.
 *
 * Export is the first user-data export in this plugin, so the mechanics are
 * spelled out rather than assumed: an object URL, an `<a download>`, and an
 * explicit revoke. `revokeObjectURL` is called after a short delay rather than
 * immediately, because revoking in the same tick races the browser's own read of
 * the blob on some builds — a bug that only shows up as an occasional empty file.
 *
 * Import reads through a file input and validates strictly before touching the
 * database: `parseGraphSnapshot` either returns a whole document or nothing, so a
 * malformed file can never half-load.
 */

export interface ExportResult {
  fileName: string;
  bytes: number;
  papers: number;
  entities: number;
  edges: number;
}

/** Serializes the current graph and hands it to the browser as a download. */
export async function exportKnowledgeGraph(): Promise<ExportResult> {
  const [papers, entities, edges, settings] = await Promise.all([
    knowledgeGraphRepository.listPapers(),
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
    knowledgeGraphRepository.readSettings(),
  ]);

  // Personal nodes are derived from notes, highlights, folders and tags rather
  // than stored, so they are not in the file. The file carries what is stored;
  // re-deriving on import reproduces the personal layer from the same sources.
  const json = createGraphSnapshot({ papers, entities, userNodes: [], edges, settings });
  const blob = new Blob([json], { type: 'application/json' });
  const fileName = suggestSnapshotFileName();
  downloadBlob(blob, fileName);

  return {
    fileName,
    bytes: blob.size,
    papers: papers.length,
    entities: entities.length,
    edges: edges.length,
  };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Not revoked synchronously: the browser may not have read the blob yet.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ImportPreview {
  plan: GraphImportPlan;
  summary: string;
  dropped: { papers: number; entities: number; edges: number; userNodes: number };
}

/**
 * Parses a file and plans the import, without writing anything.
 *
 * Split from applying so the user can see exactly what will happen — including
 * how many edges would be discarded — before committing.
 */
export async function previewGraphImport(
  file: File,
  strategy: ImportStrategy,
): Promise<{ preview: ImportPreview | null; error: string | null }> {
  const text = await file.text();
  const parsed = parseGraphSnapshot(text);
  if (!parsed.document) {
    return { preview: null, error: parsed.error ?? '无法解析该文件。' };
  }

  const [papers, entities] = await Promise.all([
    knowledgeGraphRepository.listPapers(),
    knowledgeGraphRepository.listEntities(),
  ]);
  const plan = planGraphImport(parsed.document, strategy, { papers, entities });
  return {
    preview: { plan, summary: describeImportPlan(plan), dropped: parsed.dropped },
    error: null,
  };
}

export interface ImportResult {
  strategy: ImportStrategy;
  papers: number;
  entities: number;
  edges: number;
}

/**
 * Applies a planned import.
 *
 * `replace` clears first, and the clear is not undone if the write then fails —
 * a half-restored graph is worse than an empty one, because the user cannot tell
 * what is missing. The failure is reported instead.
 */
export async function applyGraphImport(plan: GraphImportPlan): Promise<ImportResult> {
  if (plan.strategy === 'replace') {
    await knowledgeGraphRepository.clearAll();
  }
  if (plan.settings) await knowledgeGraphRepository.writeSettings(plan.settings);

  await knowledgeGraphRepository.putPapers(plan.papers);
  await knowledgeGraphRepository.putEntities(plan.entities);
  const edgesWritten = await knowledgeGraphRepository.putEdges(plan.edges);

  return {
    strategy: plan.strategy,
    papers: plan.papers.length,
    entities: plan.entities.length,
    edges: edgesWritten,
  };
}

/** File-picker plumbing: resolves with the chosen file, or null if cancelled. */
export function pickSnapshotFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
    });
    // `cancel` is not universally supported, so no reliance on it: the promise
    // simply stays pending until a later pick resolves it.
    input.click();
  });
}

export function reportExportResult(result: ExportResult): void {
  setStatus(
    `已导出 ${result.fileName}：${result.papers} 篇文献、${result.entities} 个实体、`
    + `${result.edges} 条边（${Math.round(result.bytes / 1024)} KB）。`,
  );
}
