import {
  graphFocusHops,
  graphFocusMode,
  graphMinConfidence,
  graphSearchQuery,
  graphSelectedEdgeId,
  graphSelectedNodeId,
  graphShowEntities,
  graphShowOriginAi,
  graphShowOriginRule,
  graphShowOriginUser,
  graphShowPapers,
} from '../public';
import { scheduleAppViewStateSave } from '../app-ui';
import { setGraphRenderHandler } from '../application-navigation';
import {
  knowledgeGraphBackButton,
  knowledgeGraphEntryButton,
  knowledgeGraphFilterConfidenceInput,
  knowledgeGraphFilterConfidenceValue,
  knowledgeGraphFilterEntityInput,
  knowledgeGraphFilterOriginAiInput,
  knowledgeGraphFilterOriginRuleInput,
  knowledgeGraphFilterOriginUserInput,
  knowledgeGraphFilterPaperInput,
  knowledgeGraphFitButton,
  knowledgeGraphFocusAllButton,
  knowledgeGraphFocusCurrentButton,
  knowledgeGraphFocusHopsInput,
  knowledgeGraphFocusHopsValue,
  knowledgeGraphMergeButton,
  knowledgeGraphExplainAllButton,
  knowledgeGraphMetricsButton,
  knowledgeGraphPapersButton,
  knowledgeGraphConflictsButton,
  knowledgeGraphPendingButton,
  knowledgeGraphRelationButton,
  knowledgeGraphRefreshButton,
  knowledgeGraphSearchInput,
  knowledgeGraphExtractButton,
  knowledgeGraphExportButton,
  knowledgeGraphImportButton,
  knowledgeGraphBatchButton,
  knowledgeGraphZoomInButton,
  knowledgeGraphZoomOutButton,
} from "../viewer-elements";
import {
  analyzePaperRelations,
  closeKnowledgeGraphPage,
  exportGraph,
  importGraph,
  extractEntitiesForAllPapers,
  extractEntitiesForCurrentPaper,
  fitKnowledgeGraph,
  installGraphActions,
  openKnowledgeGraphPage,
  openGraphMetrics,
  openPaperManager,
  openConflictReview,
  openMergeReview,
  openPendingEntityReview,
  refreshKnowledgeGraphIfOpen,
  refreshPendingCount,
  registerConflictEvents,
  registerEntityMergeEvents,
  registerEntityReviewEvents,
  registerGraphMetricsEvents,
  registerRelationReviewEvents,
  registerRelationPickerEvents,
  registerPapersDialogEvents,
  registerKnowledgeGraphCanvasEvents,
  explainAllMissingEntities,
  renderKnowledgeGraph,
  rerenderKnowledgeGraph,
  resyncKnowledgeGraph,
  zoomKnowledgeGraph,
} from "../../features/knowledge-graph/public";

export function registerKnowledgeGraphEvents(): void {
  // The app navigation hook points at the graph feature, mirroring the
  // knowledge-base render hook so `app/` never imports a feature.
  setGraphRenderHandler(renderKnowledgeGraph);

  // Entity actions receive the controller's capabilities here rather than
  // importing it, keeping the module graph acyclic.
  installGraphActions();

  knowledgeGraphEntryButton.addEventListener("click", openKnowledgeGraphPage);
  knowledgeGraphBackButton.addEventListener("click", closeKnowledgeGraphPage);

  knowledgeGraphRefreshButton.addEventListener("click", () => {
    void resyncKnowledgeGraph();
  });

  // Extraction and candidate review. Both are kicked off from the header and
  // report through the page status area, so the user can keep panning the graph.
  knowledgeGraphExtractButton.addEventListener("click", () => {
    void extractEntitiesForCurrentPaper();
  });

  knowledgeGraphBatchButton.addEventListener("click", () => {
    void extractEntitiesForAllPapers();
  });

  knowledgeGraphPendingButton.addEventListener("click", () => {
    void openPendingEntityReview();
  });

  knowledgeGraphMergeButton.addEventListener("click", () => {
    void openMergeReview();
  });

  // One click to give every entity that has no meaning one. Batched and confirmed above a threshold,
  // because it is the only action here that can spend tokens on hundreds of entities at once.
  knowledgeGraphExplainAllButton.addEventListener("click", () => {
    void explainAllMissingEntities();
  });

  knowledgeGraphRelationButton.addEventListener("click", () => {
    void analyzePaperRelations();
  });

  knowledgeGraphExportButton.addEventListener("click", () => {
    void exportGraph();
  });

  // The statistics report is the answer to "was any of this worth the tokens",
  // so it sits with the token-spending buttons rather than in the sidebar.
  knowledgeGraphMetricsButton.addEventListener("click", () => {
    void openGraphMetrics();
  });

  // Read-only on purpose: the graph projects the knowledge base, so membership is edited
  // there. This list exists because a paper with no relations has no node to click.
  knowledgeGraphPapersButton.addEventListener("click", () => {
    openPaperManager();
  });

  // Contradictory conclusions are a repair action, so it sits beside the other
  // token-spending buttons and carries its own badge.
  knowledgeGraphConflictsButton.addEventListener("click", () => {
    void openConflictReview();
  });

  knowledgeGraphImportButton.addEventListener("click", () => {
    void importGraph();
  });

  registerEntityReviewEvents();
  registerEntityMergeEvents();
  registerGraphMetricsEvents();
  registerConflictEvents();
  registerRelationReviewEvents();
  registerRelationPickerEvents();
  registerPapersDialogEvents();

  knowledgeGraphFitButton.addEventListener("click", fitKnowledgeGraph);
  knowledgeGraphZoomInButton.addEventListener("click", () => zoomKnowledgeGraph(1.2));
  knowledgeGraphZoomOutButton.addEventListener("click", () => zoomKnowledgeGraph(1 / 1.2));

  knowledgeGraphSearchInput.addEventListener("input", () => {
    graphSearchQuery.value = knowledgeGraphSearchInput.value;
    graphSelectedEdgeId.value = "";
    rerenderKnowledgeGraph();
    scheduleAppViewStateSave();
  });

  knowledgeGraphFilterPaperInput.addEventListener("change", () => {
    graphShowPapers.value = knowledgeGraphFilterPaperInput.checked;
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFilterEntityInput.addEventListener("change", () => {
    graphShowEntities.value = knowledgeGraphFilterEntityInput.checked;
    rerenderKnowledgeGraph();
  });

  // Edge provenance toggles: hiding rule-derived edges is how a user says
  // "only show me things an AI actually judged".
  knowledgeGraphFilterOriginAiInput.addEventListener("change", () => {
    graphShowOriginAi.value = knowledgeGraphFilterOriginAiInput.checked;
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFilterOriginRuleInput.addEventListener("change", () => {
    graphShowOriginRule.value = knowledgeGraphFilterOriginRuleInput.checked;
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFilterOriginUserInput.addEventListener("change", () => {
    graphShowOriginUser.value = knowledgeGraphFilterOriginUserInput.checked;
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFilterConfidenceInput.addEventListener("input", () => {
    const value = Number(knowledgeGraphFilterConfidenceInput.value);
    graphMinConfidence.value = Number.isFinite(value) ? value : 0;
    knowledgeGraphFilterConfidenceValue.value = graphMinConfidence.value.toFixed(2);
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFocusAllButton.addEventListener("click", () => {
    graphFocusMode.value = "all";
    graphSelectedEdgeId.value = "";
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFocusCurrentButton.addEventListener("click", () => {
    graphFocusMode.value = "current";
    graphSelectedEdgeId.value = "";
    graphSelectedNodeId.value = "";
    rerenderKnowledgeGraph();
  });

  knowledgeGraphFocusHopsInput.addEventListener("input", () => {
    const value = Number(knowledgeGraphFocusHopsInput.value);
    graphFocusHops.value = Number.isFinite(value)
      ? Math.min(3, Math.max(1, Math.round(value)))
      : 1;
    knowledgeGraphFocusHopsValue.value = String(graphFocusHops.value);
    rerenderKnowledgeGraph();
  });

  registerKnowledgeGraphCanvasEvents();
  registerKnowledgeGraphLayoutEvents();
}

/**
 * Canvas sizing and data refresh on window changes.
 *
 * The canvas has no intrinsic size, so a resize or a workspace switch leaves the
 * backing store at the old dimensions until something redraws it.
 */
function registerKnowledgeGraphLayoutEvents(): void {
  window.addEventListener("resize", () => {
    if (!isGraphVisible()) return;
    fitKnowledgeGraph();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshKnowledgeGraphIfOpen();
  });

  registerCorpusChangeSync();
}

/**
 * Re-projects when the knowledge base changes while this page is open.
 *
 * The graph is a projection of the knowledge base, and adding a document happens from the toolbar
 * on *this* page ("添加到知识库"). Without this the new paper only appeared after a manual 重新同步 —
 * which is why the extract buttons stayed disabled right after the document was added.
 *
 * Debounced because indexing writes the corpus record repeatedly (progress, status, chunk count);
 * a resync per write would re-read the store dozens of times for one document.
 */
const CORPUS_SYNC_DEBOUNCE_MS = 600;
let corpusSyncTimer: number | null = null;

function registerCorpusChangeSync(): void {
  window.addEventListener("pdf-helper:knowledge-corpus-change", () => {
    if (!isGraphVisible()) return;
    if (corpusSyncTimer !== null) window.clearTimeout(corpusSyncTimer);
    corpusSyncTimer = window.setTimeout(() => {
      corpusSyncTimer = null;
      // Checked again: the user may have navigated away during the debounce.
      if (!isGraphVisible()) return;
      void resyncKnowledgeGraph();
    }, CORPUS_SYNC_DEBOUNCE_MS);
  });
}

function isGraphVisible(): boolean {
  return !document.getElementById("knowledge-graph-page")?.hidden;
}
