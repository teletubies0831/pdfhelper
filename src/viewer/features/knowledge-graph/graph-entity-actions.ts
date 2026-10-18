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
  knowledgeGraphExtractProgressElement,
  knowledgeGraphMergeButton,
  knowledgeGraphImportButton,
  knowledgeGraphMetricsButton,
  knowledgeGraphPendingButton,
  knowledgeGraphPendingCountElement,
  knowledgeGraphRelationButton,
} from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';
import { showAppError } from '../../app/error-dialog';
import { createGraphExtractionPorts, createRelationAnalysisPorts } from './graph-extraction-repository';
import { openEntityMergeDialog } from './entity-merge-dialog';
import { openGraphMetricsDialog, type GraphMetricsSource } from './graph-metrics-dialog';
import { openConflictDialog } from './conflict-dialog';
import { openRelationReviewDialog } from './relation-review-dialog';
import { manageGraphPapers } from './graph-paper-actions';
import {
  openEntityReviewDialog,
  refreshEntityReviewIfOpen,
} from './entity-review-dialog';
import { createEntityTranslator } from './entity-translation';
import { createEntitySynonymChecker } from './entity-synonym';
import { explainConfirmedEntities } from './graph-explanation-actions';
import {
  describeRelationResult,
  loadPendingReview,
  reconcileIgnoredPendingCandidates,
  relationPairKey,
  runRelationAnalysis,
  type GraphPaper,
  type ImportStrategy,
  type RelationPreview,
} from '../../../modules/knowledge-graph/public';
import {
  describeResolutionResult,
  planConflictBatch,
  resolveRelationConflicts,
  scanRelationConflicts,
} from '../../../modules/knowledge-graph/public';
import {
  applyGraphImport,
  exportKnowledgeGraph,
  pickSnapshotFile,
  previewGraphImport,
  reportExportResult,
} from './graph-transfer-controller';

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
  knowledgeGraphExtractProgressElement.textContent = progress.message;
  knowledgeGraphExtractProgressElement.classList.toggle('error', progress.phase === 'failed');
  // Progress stays in the header (it must not block panning), but a *failure* opens
  // the readable dialog: that slot is 260px wide with an ellipsis, which used to cut
  // the reason off mid-sentence — the user could see that extraction failed but not why.
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
async function hasFullTextIndex(documentId: string): Promise<boolean> {
  try {
    const chunks = await getDocumentChunks(documentId);
    return chunks.some((chunk) => chunk.text.trim().length > 0);
  } catch {
    return false;
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
    const indexed = await hasFullTextIndex(paperId);
    knowledgeGraphExtractButton.disabled = !indexed;
    knowledgeGraphExtractButton.title = indexed
      ? '对当前打开的文献全文抽取候选实体'
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
    for (const paper of papers) {
      if (await hasFullTextIndex(paper.paperId)) indexed.add(paper.paperId);
    }
    const titles = new Map(papers.map((paper) => [paper.paperId, paper.title]));
    const { targets, skippedForIndex } = selectBatchTargets(papers, indexed);

    if (!targets.length) {
      setStatus(
        `这 ${skippedForIndex.length} 篇文献都还没有全文索引，请先在知识库中建立索引。`,
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
 * Above this many estimated tokens, the user is asked before anything is sent.
 *
 * A threshold rather than a prompt every time: this is the only feature that
 * spends tokens without the user typing a message, but a confirmation dialog for
 * every small run would be noise the user learns to dismiss without reading —
 * which is worse than no prompt at all.
 */
export const RELATION_CONFIRM_TOKEN_THRESHOLD = 2_000;

/**
 * Runs on-demand paper-to-paper relation judgement.
 *
 * The order is deliberate: recall is free, so the price is known before the user
 * is asked, and declining leaves the graph and the token balance untouched.
 *
 * One more step sits between the request and the write: the **review**. A stored
 * conclusion is also the cache — the pair is never asked about again — so writing
 * verdicts the user has not seen would make the model's mistakes permanent, and the
 * negative ones would not even be visible on the canvas.
 */
export async function analyzePaperRelations(): Promise<void> {
  await runRelationPass();
}

/**
 * Re-judges one existing paper pair, from the 「重新判断」 action in the edge inspector.
 *
 * A stored conclusion is also the cache, so without an explicit request the pair
 * could never be re-asked and a wrong verdict would be permanent. Recall is
 * narrowed to the two papers involved: the user asked about *this* pair, not for
 * another batch of candidates, and the reply replaces the old conclusion through
 * the same retire-then-write plan a normal run uses.
 */
export async function rejudgePaperRelation(leftPaperId: string, rightPaperId: string): Promise<void> {
  const { getPapers } = requireContext();
  const papers = getPapers();
  const left = papers.find((paper) => paper.paperId === leftPaperId);
  const right = papers.find((paper) => paper.paperId === rightPaperId);
  if (!left || !right) {
    setStatus('这两篇文献已不在文献库中，无法重新判断。', true);
    return;
  }
  await runRelationPass({
    papers: [left, right],
    forcePairs: new Set([relationPairKey(left.paperId, right.paperId)]),
  });
}

function relationPassConfirmText(preview: RelationPreview, forced: boolean): string {
  if (forced) {
    return `即将重新判断这 1 对文献的关系，预计消耗约 ${preview.estimatedTokens} tokens。\n\n`
      + '新的结论会替换这对文献原有的结论。\n\n继续吗？';
  }
  return `即将判断 ${preview.selected.length} 对论文的关系，预计消耗约 ${preview.estimatedTokens} tokens。\n\n`
    + `召回候选 ${preview.candidates.length} 对，只对前 ${preview.selected.length} 对调用模型。\n`
    + '已判断过的论文对会被跳过，不重复消耗。\n\n继续吗？';
}

async function runRelationPass(forced?: {
  papers: GraphPaper[];
  forcePairs: ReadonlySet<string>;
}): Promise<void> {
  const { getPapers, getEntityNames, reload, ensureReady } = requireContext();
  ensureReady();
  await reload();

  const papers = forced?.papers ?? getPapers();
  if (papers.length < 2) {
    setStatus('至少需要两篇文献才能判断关系。', true);
    return;
  }

  knowledgeGraphRelationButton.disabled = true;
  try {
    const settings = await knowledgeGraphRepository.readSettings();
    const paperTitles = new Map(getPapers().map((paper) => [paper.paperId, paper.title]));
    // Only used to explain an empty recall: pending entities are invisible to recall
    // because shared entities count only once confirmed, which is the usual reason a
    // corpus with plenty of candidates recalls nothing.
    const pendingEntityCount = (await loadPendingReview(knowledgeGraphRepository)).total;
    const result = await runRelationAnalysis(createRelationAnalysisPorts(), {
      papers,
      topK: settings.relationTopK,
      maxCandidates: settings.maximalRecallCandidates,
      entityNames: getEntityNames(),
      pendingEntityCount,
      ...(forced ? { forcePairs: forced.forcePairs } : {}),
      onPreview: async (preview) => {
        if (preview.estimatedTokens < RELATION_CONFIRM_TOKEN_THRESHOLD) return true;
        return window.confirm(relationPassConfirmText(preview, Boolean(forced)));
      },
      onJudged: async (review) => {
        const accepted = await openRelationReviewDialog({
          rows: review.rows,
          paperTitles,
          ...(review.model ? { model: review.model } : {}),
          rejectedCount: review.rejectedCount,
        });
        // `null` means the review was dismissed: decline to write rather than
        // accepting claims on the user's behalf.
        return accepted ?? null;
      },
      onProgress: (message) => setExtractionProgress({
        phase: 'extracting',
        message,
        completedBatches: 0,
        totalBatches: 0,
      }),
    });

    setStatus(describeRelationResult(result), result.status === 'failed');
    if (result.edgesWritten) await reload();
  } finally {
    await refreshExtractionAvailability();
  }
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
 * Exports the whole graph to a JSON file.
 *
 * Available without any AI configuration: the graph already holds the rule-derived
 * keyword layer, the user's own notes and filing, and any confirmed entities, so
 * exporting is useful even for a user who never configured a key.
 */
export async function exportGraph(): Promise<void> {
  try {
    reportExportResult(await exportKnowledgeGraph());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

/**
 * Imports a graph snapshot, asking for the strategy up front.
 *
 * The choice is explicit rather than guessed: `replace` is what "restore a
 * backup" means, `merge` is what "complete this machine from the other one"
 * means, and picking for the user risks destroying a graph they meant to extend.
 */
export async function importGraph(): Promise<void> {
  const file = await pickSnapshotFile();
  if (!file) return;

  const replace = window.confirm(
    '导入方式：\n\n'
    + '确定 = 替换现有图谱（恢复备份）\n'
    + '取消 = 合并进现有图谱（保留已有记录，只补充缺失的）\n\n'
    + '两种方式都不会重新抽取，也不会消耗 Token。',
  );
  const strategy: ImportStrategy = replace ? 'replace' : 'merge';

  const { preview, error } = await previewGraphImport(file, strategy);
  if (!preview) {
    setStatus(error ?? '导入失败。', true);
    return;
  }

  const unrecognized = Object.entries(preview.dropped).filter(([, count]) => count > 0);
  const lossNote = unrecognized.length
    ? `\n\n文件中的 ${unrecognized.map(([kind, count]) => `${count} 个${kind}`).join('、')} 无法识别，将被跳过。`
    : '';
  if (!window.confirm(`${preview.summary}${lossNote}\n\n确认导入吗？`)) {
    setStatus('已取消导入。');
    return;
  }

  knowledgeGraphImportButton.disabled = true;
  try {
    const result = await applyGraphImport(preview.plan);
    setStatus(
      `已导入（${result.strategy === 'replace' ? '替换' : '合并'}）：`
      + `${result.papers} 篇文献，${result.entities} 个实体，${result.edges} 条边。`,
    );
    await refreshPendingCount();
    await requireContext().reload();
  } catch (error) {
    setStatus(
      `导入失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    knowledgeGraphImportButton.disabled = false;
  }
}
