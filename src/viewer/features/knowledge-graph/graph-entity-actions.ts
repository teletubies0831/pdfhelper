import { getDocumentChunks } from '../../../modules/document-agent/public';
import {
  knowledgeGraphRepository,
  runBatchExtraction,
  runEntityExtraction,
  selectBatchTargets,
  summarizeBatchResult,
  type ExtractionProgress,
} from '../../../modules/knowledge-graph/public';
import {
  knowledgeGraphBatchButton,
  knowledgeGraphConflictsButton,
  knowledgeGraphConflictsCountElement,
  knowledgeGraphExtractButton,
  knowledgeGraphMergeButton,
  knowledgeGraphMetricsButton,
  knowledgeGraphPendingButton,
  knowledgeGraphPendingCountElement,
} from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';
import { showAppError } from '../../app/error-dialog';
import { showGraphTaskNotice } from './graph-task-notice';
import { createGraphExtractionPorts } from './graph-extraction-repository';
import { openEntityMergeDialog } from './entity-merge-dialog';
import { openGraphMetricsDialog, type GraphMetricsSource } from './graph-metrics-dialog';
import { openConflictDialog } from './conflict-dialog';
import { manageGraphPapers } from './graph-paper-actions';
import {
  openEntityReviewDialog,
  refreshEntityReviewIfOpen,
} from './entity-review-dialog';
import { createEntityTranslator } from './entity-translation';
import { createEntitySynonymChecker } from './entity-synonym';
import { explainConfirmedEntities } from './graph-explanation-actions';
import {
  deleteGraphEntity,
  describeEntityDeletion,
  loadPendingReview,
  planEntityDeletion,
  reconcileIgnoredPendingCandidates,
  suggestGraphImageFileName,
  type GraphPaper,
} from '../../../modules/knowledge-graph/public';
import {
  describeResolutionResult,
  planConflictBatch,
  resolveRelationConflicts,
  scanRelationConflicts,
} from '../../../modules/knowledge-graph/public';
import { downloadGraphImage } from './graph-image-export';

/**
 * Extraction, confirmation and merge actions for the graph page.
 *
 * Split out of the page controller because the controller is about *rendering*
 * the graph, while this file is about *changing* it — a different reason to
 * change, and the split keeps both files small.
 *
 * The controller supplies the parts that belong to it through `configureGraphActions`
 * rather than importing back: this module is imported *by* the controller, so a
 * static import in the other direction would be a module cycle.
 */

export interface GraphActionContext {
  /** The graph id of the paper matching the open PDF, if any. */
  currentPaperId(): string | undefined;
  /** Paper ids and titles currently in the snapshot. */
  listPapers(): Array<{ paperId: string; title: string }>;
  /** Full paper records, needed by recall (folder, venue, year, abstract). */
  getPapers(): GraphPaper[];
  /** Display names by entity id, so recall reasons read as words not ids. */
  getEntityNames(): ReadonlyMap<string, string>;
  /** Snapshot slices the statistics report is computed from. */
  getMetricsSource(): GraphMetricsSource;
  /** How many edges touch each paper, so the paper list can say "no relations yet". */
  getRelationCounts(): ReadonlyMap<string, number>;
  /** Re-reads the snapshot and re-renders; owned by the controller. */
  reload(): Promise<void>;
  /** Ensures a renderer exists before an action that will trigger a redraw. */
  ensureReady(): void;
  /**
   * Renders the whole graph into a detached canvas for the PNG export.
   *
   * Owned by the controller because it owns the renderer; `null` means there is nothing to draw.
   */
  renderExportImage(): {
    canvas: HTMLCanvasElement;
    papers: number;
    entities: number;
  } | null;
}

let context: GraphActionContext | null = null;

export function configureGraphActions(next: GraphActionContext): void {
  context = next;
}

function requireContext(): GraphActionContext {
  if (!context) throw new Error('图谱写操作尚未装配（configureGraphActions 未调用）。');
  return context;
}

/**
 * Extraction progress readout.
 *
 * Shown in the page header rather than as a modal: extraction takes minutes and
 * the user must be able to keep reading and panning the graph while it runs.
 */
function setExtractionProgress(progress: ExtractionProgress): void {
  // The floating notice is the only progress surface now: the header's grey slot was easy to miss and
  // truncated the message. Extraction, relation analysis and explanation generation all report through
  // this one funnel, so one call here covers every long task on the page.
  const finished = progress.phase === 'done' || progress.phase === 'skipped';
  showGraphTaskNotice({
    message: progress.message,
    state: progress.phase === 'failed' ? 'error' : finished ? 'success' : 'active',
    ...(progress.totalBatches > 0
      ? { progress: Math.round((progress.completedBatches / progress.totalBatches) * 100) }
      : {}),
  });
  // A *failure* also opens the readable dialog: the plate is narrow and disappears after a few seconds,
  // so the reason someone has to act on cannot live only there.
  if (progress.phase === 'failed') {
    showAppError(progress.message, { title: '抽取失败', summary: '这次抽取没有完成，图谱未被改动。' });
  }
}

export { setExtractionProgress };

/**
 * Detects whether a paper has a full-text index.
 *
 * Extraction reads `getDocumentChunks`, so a paper that was never indexed has
 * nothing to extract from. Checking up front means the button can explain that
 * instead of failing after the user has already committed to a click — and the
 * check is cheap because it reads the same store the extraction would.
 */
/**
 * Whether the paper's full-text index is usable, and *why not* when it is not.
 *
 * The three cases must stay separate: "no chunks yet" is fixed by indexing, "chunks unreadable" is a storage problem, and
 * collapsing them into one boolean turned a readable IndexedDB failure into 「请先在知识库中建立索引」 — advice that
 * cannot work, because the index may well exist.
 */
async function probeFullTextIndex(documentId: string): Promise<{ ready: boolean; reason: 'empty' | 'unreadable' | '' ; error: string }> {
  try {
    const chunks = await getDocumentChunks(documentId);
    return chunks.some((chunk) => chunk.text.trim().length > 0)
      ? { ready: true, reason: '', error: '' }
      : { ready: false, reason: 'empty', error: '' };
  } catch (error) {
    return { ready: false, reason: 'unreadable', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Keeps the extraction buttons honest about whether they can work.
 *
 * Disabling with a reason is better than an enabled button that always errors.
 */
export async function refreshExtractionAvailability(): Promise<void> {
  const { currentPaperId, listPapers } = requireContext();
  const paperId = currentPaperId();
  if (!paperId) {
    knowledgeGraphExtractButton.disabled = true;
    knowledgeGraphExtractButton.title = '当前 PDF 尚未进入图谱，请先让文献进入知识库。';
  } else {
    const probe = await probeFullTextIndex(paperId);
    knowledgeGraphExtractButton.disabled = !probe.ready;
    knowledgeGraphExtractButton.title = probe.ready
      ? '对当前打开的文献全文抽取候选实体'
      : probe.reason === 'unreadable'
        ? `读取本地全文索引失败（${probe.error}）：这是存储问题，不是缺少索引。可以在知识库「打开原文」一次，让它重建索引。`
        : '这篇文献还没有全文索引：请先在知识库中为它建立索引，抽取需要正文内容。';
  }

  // The batch button only needs *some* paper to be indexed; individual papers
  // without an index are reported once as skipped rather than blocking the run.
  const papers = listPapers();
  knowledgeGraphBatchButton.disabled = papers.length === 0;
  knowledgeGraphBatchButton.title = papers.length
    ? '对图谱里的全部文献逐篇抽取（正文未变化的会跳过，不消耗 Token）'
    : '图谱里还没有文献。';
}

/** Runs extraction for the graph paper matching the open PDF. */
export async function extractEntitiesForCurrentPaper(): Promise<void> {
  const { currentPaperId, reload, ensureReady } = requireContext();
  ensureReady();
  // The graph must be loaded first: `currentPaperId` resolves against the
  // projected papers, and without the projection there is no id to extract for.
  await reload();

  const paperId = currentPaperId();
  if (!paperId) {
    setStatus('没有找到与当前 PDF 对应的图谱文献，请先让文献进入知识库。', true);
    return;
  }

  knowledgeGraphExtractButton.disabled = true;
  try {
    const result = await runEntityExtraction(createGraphExtractionPorts(), {
      paperId,
      onProgress: setExtractionProgress,
    });
    if (result.status === 'busy' || result.status === 'cancelled') {
      setStatus(result.reason ?? '抽取未能进行。', true);
      return;
    }
    if (result.status === 'skipped') {
      setStatus(result.reason ?? '正文未变化，已跳过抽取。');
      return;
    }
    setStatus(
      result.status === 'failed'
        ? `${result.reason ?? '抽取失败。'}（已保存 ${result.entitiesWritten} 个候选）`
        : `抽取完成：${result.candidatesFound} 个候选，其中新增 ${result.newEntityCount} 个。`,
      result.status === 'failed',
    );
    await afterExtraction();
  } finally {
    // Availability, not a bare `false`: the paper may still have no index, and
    // re-enabling the button would invite a click that can only fail.
    await refreshExtractionAvailability();
  }
}

/**
 * Extracts candidates for every paper in the graph.
 *
 * Papers without a full-text index are filtered out before the batch starts: a
 * run reporting "8 of 10 failed: no index" is noise rather than information, so
 * those are reported once as skipped instead.
 *
 * Already-extracted papers cost one chunk read each and no network calls, because
 * the single-paper runner skips unchanged input by fingerprint — which is what
 * makes re-running a batch cheap and safe.
 */
export async function extractEntitiesForAllPapers(): Promise<void> {
  const { listPapers, reload, ensureReady } = requireContext();
  ensureReady();
  await reload();

  const papers = listPapers();
  if (!papers.length) {
    setStatus('图谱里还没有文献。', true);
    return;
  }

  knowledgeGraphBatchButton.disabled = true;
  try {
    const indexed = new Set<string>();
    const unreadable: string[] = [];
    for (const paper of papers) {
      const probe = await probeFullTextIndex(paper.paperId);
      if (probe.ready) indexed.add(paper.paperId);
      else if (probe.reason === 'unreadable') unreadable.push(probe.error);
    }
    const titles = new Map(papers.map((paper) => [paper.paperId, paper.title]));
    const { targets, skippedForIndex } = selectBatchTargets(papers, indexed);

    if (!targets.length) {
      // A storage failure and a missing index need different actions, so they get different sentences.
      setStatus(
        unreadable.length === skippedForIndex.length
          ? `读取本地全文索引失败：${unreadable[0] ?? '未知错误'}。这不是「没有索引」，是存储读取出了问题；对这几篇各点一次「打开原文」可以触发重建。`
          : `这 ${skippedForIndex.length} 篇文献都还没有全文索引，请先在知识库中建立索引。`
            + (unreadable.length ? `（其中 ${unreadable.length} 篇是索引读取失败：${unreadable[0]}）` : ''),
        true,
      );
      return;
    }

    const result = await runBatchExtraction(
      {
        runPaper: async (paperId) => runEntityExtraction(createGraphExtractionPorts(), {
          paperId,
          onProgress: (progress) => setExtractionProgress({
            ...progress,
            message: `${titles.get(paperId) ?? paperId}：${progress.message}`,
          }),
        }),
      },
      {
        papers: targets,
        onProgress: (progress) => setExtractionProgress({
          phase: 'extracting',
          message: progress.message,
          completedBatches: progress.completedPapers,
          totalBatches: progress.totalPapers,
        }),
      },
    );

    setStatus(
      summarizeBatchResult(result)
      + (skippedForIndex.length ? `另有 ${skippedForIndex.length} 篇没有全文索引，已跳过。` : ''),
      result.papersFailed > 0,
    );
    await afterExtraction();
  } finally {
    await refreshExtractionAvailability();
  }
}

/** Shared tail for both extraction entries: refresh badge, snapshot and dialogs. */
async function afterExtraction(): Promise<void> {
  await refreshPendingCount();
  await requireContext().reload();
  await refreshEntityReviewIfOpen();
}

export async function refreshPendingCount(): Promise<void> {
  // Reconciled before counting: a candidate whose name is on the ignore list is not something to
  // review, so counting it made the badge say 9 while the dialog had nothing to show. Resolving
  // those records also stops the two from drifting apart again.
  await reconcileIgnoredPendingCandidates(knowledgeGraphRepository);
  // Same source as the dialog's list — the badge and the list must never be computed differently.
  const review = await loadPendingReview(knowledgeGraphRepository);
  knowledgeGraphPendingCountElement.textContent = String(review.total);
  knowledgeGraphPendingButton.disabled = review.total === 0;
}

/** One translator for the whole session, so its cache survives the dialog closing. */
const entityTranslator = createEntityTranslator();
/** One synonym checker for the session, for the same reason: an answered name-set is not re-asked. */
const entitySynonymChecker = createEntitySynonymChecker();

export async function openPendingEntityReview(): Promise<void> {
  const { listPapers } = requireContext();
  // Titles, so each candidate can say which document it came from instead of showing
  // a truncated graph id.
  const result = await openEntityReviewDialog({
    paperTitles: new Map(listPapers().map((paper) => [paper.paperId, paper.title])),
    // A Chinese gloss per name, on request. The translator is created once so names already paid
    // for are not paid for again the next time the dialog opens.
    translate: (terms) => entityTranslator.translate(terms),
    // Which of these names mean the same thing, on request. Only ever a suggestion: acting on it
    // renames a row, and the rename is what folds the two candidates into one entity.
    findSynonyms: (terms) => entitySynonymChecker.find(terms),
    // Fired (not awaited) once the entities are written: the dialog must close immediately, and the
    // explanations arrive on their own.
    explain: (names) => {
      void explainConfirmedEntities(names);
    },
  });
  if (result) {
    setStatus(
      result.confirmedCount
        ? `已确认 ${result.confirmedCount} 个实体，建立 ${result.edgesWritten} 条关系。`
        : '没有确认任何实体。',
    );
  }
  // The count and the snapshot are refreshed even when the dialog was dismissed: 忽略 / 不再提示
  // change the pending list without confirming anything, and a badge that keeps its old number makes
  // the button look broken.
  await refreshPendingCount();
  await requireContext().reload();
}

export async function openMergeReview(): Promise<void> {
  const applied = await openEntityMergeDialog();
  if (!applied) return;
  // Merges rewire edges, so the whole snapshot has to be re-read rather than
  // patched in place.
  await requireContext().reload();
}

/**
 * Deletes one entity and its edges, after explaining exactly what goes with it.
 *
 * The confirmation quotes the *current* edge count, and the delete itself re-reads the store rather
 * than trusting the page snapshot: an extraction or a relation run can add edges between the panel
 * rendering and the click, and deleting from a stale list would leave those new edges pointing at a
 * node that no longer exists.
 *
 * Papers are refused inside the module (`planEntityDeletion`), not here — the button is only rendered
 * for entities, but the rule belongs where the store is.
 */
export async function deleteGraphEntityFromInspector(
  entityId: string,
  entityName: string,
): Promise<void> {
  const { reload } = requireContext();
  try {
    const [entities, edges, papers] = await Promise.all([
      knowledgeGraphRepository.listEntities(),
      knowledgeGraphRepository.listEdges(),
      knowledgeGraphRepository.listPapers(),
    ]);
    const plan = planEntityDeletion({ entityId, entities, edges, papers });
    if (!plan.allowed) {
      setStatus(plan.reason ?? '这个节点不能删除。', true);
      return;
    }
    if (!window.confirm(describeEntityDeletion(plan, entityName))) return;

    const result = await deleteGraphEntity(entityId, knowledgeGraphRepository);
    if (!result.deleted) {
      setStatus(result.reason ?? '删除失败。', true);
      return;
    }
    setStatus(
      result.edgesDeleted
        ? `已删除节点「${entityName}」及其 ${result.edgesDeleted} 条连线。`
        : `已删除节点「${entityName}」。`,
    );
    await reload();
    await refreshPendingCount();
  } catch (error) {
    setStatus(`删除节点失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

/**
 * Counts contradictory conclusions and updates the header badge.
 *
 * Runs on every page load: it is one store read, and a conflict that exists but is
 * never surfaced is the same as the feature not existing. A store failure shows
 * `?` rather than `0` — "could not check" and "nothing wrong" are different, and
 * the badge is the only place the user can tell.
 */
export async function refreshConflictCount(): Promise<number> {
  try {
    const scan = await scanRelationConflicts(knowledgeGraphRepository);
    knowledgeGraphConflictsCountElement.textContent = String(scan.conflicts.length);
    knowledgeGraphConflictsButton.disabled = scan.conflicts.length === 0;
    knowledgeGraphConflictsButton.title = scan.conflicts.length
      ? `${scan.conflicts.length} 对文献存在互相矛盾的结论，点击决定保留哪一条`
      : '没有发现互相矛盾的结论';
    return scan.conflicts.length;
  } catch {
    knowledgeGraphConflictsCountElement.textContent = '?';
    knowledgeGraphConflictsButton.disabled = true;
    knowledgeGraphConflictsButton.title = '无法读取关系结论，请稍后重试';
    return 0;
  }
}

/**
 * Opens the conflict list and applies whatever the user approves.
 *
 * The re-scan inside `apply` is deliberate: the dialog can sit open while a batch
 * extraction or a paper removal changes the store, and writing a survivor from a
 * stale list could re-create an edge whose paper is already gone. A pair that
 * disappeared meanwhile lands in `staleSelections` and is reported rather than
 * silently dropped.
 */
export async function openConflictReview(): Promise<void> {
  const { listPapers, reload } = requireContext();
  let scan;
  try {
    scan = await scanRelationConflicts(knowledgeGraphRepository);
  } catch (error) {
    // Reported instead of thrown: the click handler cannot await this, so a
    // rejection would become an unhandled promise and the button would look dead.
    setStatus(
      `读取关系结论失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return;
  }
  if (!scan.conflicts.length) {
    setStatus(scan.summary);
    await refreshConflictCount();
    return;
  }

  const paperTitles = new Map(listPapers().map((paper) => [paper.paperId, paper.title]));
  const result = await openConflictDialog({
    conflicts: scan.conflicts,
    paperTitles,
    apply: async (selections) => {
      const fresh = await scanRelationConflicts(knowledgeGraphRepository);
      return resolveRelationConflicts(
        knowledgeGraphRepository,
        planConflictBatch(fresh.conflicts, { selections }),
      );
    },
  });
  if (!result) return;

  setStatus(describeResolutionResult(result));
  await refreshConflictCount();
  // Retiring a conclusion removes an edge, so the snapshot has to be re-read
  // rather than patched in place.
  if (result.pairs) await reload();
}

/**
 * Shows the graph quality report.
 *
 * Reloads first: the report is only worth reading if it describes the stored
 * graph, and the page snapshot can be minutes old after a batch run or an import.
 * The read is local and free, so there is no reason to report on stale numbers.
 */
export async function openGraphMetrics(): Promise<void> {
  const { reload, getMetricsSource } = requireContext();
  await reload();
  openGraphMetricsDialog(getMetricsSource());
}

/**
 * Opens the paper list: the knowledge base's documents as the graph sees them.
 *
 * Read-only. The graph projects the knowledge base, so nothing here can change membership;
 * deleting a paper happens in the knowledge base page, which the dialog links to.
 */
export function openPaperManager(): void {
  const { getPapers, getRelationCounts } = requireContext();
  manageGraphPapers({
    papers: getPapers(),
    relationCounts: getRelationCounts(),
  });
}

/**
 * Exports the current graph as a PNG image.
 *
 * No AI configuration needed: the picture shows whatever the canvas is already showing — the rule-derived keyword
 * layer, the user's own notes and filing, and any confirmed entities.
 */
export async function exportGraph(): Promise<void> {
  try {
    requireContext().ensureReady();
    const rendered = requireContext().renderExportImage();
    if (!rendered) {
      setStatus('图谱还没有可画的内容，先添加文献或抽取实体再导出。', true);
      return;
    }
    await downloadGraphImage(
      { canvas: rendered.canvas, fileName: suggestGraphImageFileName() },
      { papers: rendered.papers, entities: rendered.entities },
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

/**
 * Graph import used to live here.
 *
 * Removed with the button: the graph is a projection of the knowledge base, so a file that adds papers and entities
 * which no library document owns produces records the next sync has to treat as removed. Nothing replaced it — the
 * knowledge base is the way papers enter the graph.
 */

