import {
  buildSharedEntityBridges,
  collectJudgedPairKeys,
  isRenderableEdge,
} from '../../../modules/knowledge-graph/public';
import {
  buildSubgraph,
  condenseGraph,
  describeCondensation,
  knowledgeGraphRepository,
  openKnowledgeGraph,
  pruneRemovedGraphPapers,
  readGraphSnapshot,
  runBatchExtraction,
  runEntityExtraction,
  selectBatchTargets,
  summarizeBatchResult,
  type ExtractionProgress,
  type GraphEdge,
  type GraphEntity,
  type GraphPaper,
  type GraphSnapshot,
  type GraphUserNode,
  type SubgraphRequest,
} from '../../../modules/knowledge-graph/public';
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
} from '../../app/public';
import { getDocumentChunks } from '../../../modules/document-agent/public';
import { getPdfFingerprint } from '../../app/document-identity';
import {
  knowledgeGraphCanvasElement,
  knowledgeGraphCountsElement,
  knowledgeGraphEmptyElement,
  knowledgeGraphEmptyHintElement,
  knowledgeGraphEntryButton,
  knowledgeGraphBatchButton,
  knowledgeGraphExtractButton,
  knowledgeGraphFilterConfidenceInput,
  knowledgeGraphFilterConfidenceValue,
  knowledgeGraphFilterEntityInput,
  knowledgeGraphFilterOriginAiInput,
  knowledgeGraphFilterOriginRuleInput,
  knowledgeGraphFilterOriginUserInput,
  knowledgeGraphFilterPaperInput,
  knowledgeGraphFocusAllButton,
  knowledgeGraphFocusCurrentButton,
  knowledgeGraphFocusHopsInput,
  knowledgeGraphFocusHopsValue,
  knowledgeGraphInspectorElement,
  knowledgeGraphMergeButton,
  knowledgeGraphPendingButton,
  knowledgeGraphPendingCountElement,
  knowledgeGraphSearchInput,
  aiPanelToggleButton,
} from '../../app/viewer-elements';
import { setCurrentApplicationView } from '../../app/application-navigation';
import { persistCurrentAppViewState } from '../../app/app-view-persistence';
import { setStatus } from '../../app/status-bar';
import { showAppError } from '../../app/error-dialog';
import { getActiveWorkspaceView, transitionWorkspaceView } from '../../app/workspace-navigation';
import {
  buildRenderModel,
  GraphCanvasRenderer,
  type RenderEdge,
  type RenderNode,
} from './graph-canvas-renderer';
import {
  clearInspector,
  renderEdgeInspector,
  renderEntityInspector,
  renderPaperInspector,
  type InspectorActions,
} from './graph-inspector';
import { resolveGraphTheme } from './graph-theme';
import {
  boundsOfPoints,
  createViewport,
  fitViewport,
} from './graph-viewport';
import { createGraphViewportController } from './graph-viewport-controller';
import { createGraphLayoutRunner } from './graph-layout-runner';
import { hideGraphTaskNotice } from './graph-task-notice';
import { setPageStatus, updateEmptyState } from './graph-page-status';
import { syncFilterControls } from './graph-filter-controls';
import { registerGraphCanvasInteraction } from './graph-canvas-interaction';
import { installExtractionDiagnostics } from './graph-entity-actions';
import {
  describeGraphView,
  shouldAnnounceGraphLoad,
  type GraphLoadReason,
  type GraphViewReport,
} from './graph-view-report';
import {
  collectMatchedNodeIds,
  filterVisibleEdges,
  filterVisibleNodes,
  type GraphFilterState,
} from './graph-view-filters';
import { openGraphSourcePdf } from './graph-source-navigation';
import { createGraphExtractionPorts } from './graph-extraction-repository';
import { configureGraphActions } from './graph-entity-actions';
import {
  configureExplanationActions,
  currentExplanationProgress,
} from './graph-explanation-actions';
import { readPersonalGraph } from './graph-personal-repository';
import {
  buildPersonalProvider as buildGraphPersonalProvider,
  type PersonalGraphProvider,
} from './graph-personal-provider';
import { collectKnowledgeItems } from '../knowledge-base/public';
import {
  refreshConflictCount,
  refreshExtractionAvailability,
  refreshPendingCount,
  deleteGraphEntityFromInspector,
  setExtractionProgress,
} from './graph-entity-actions';
import { configureRelationActions, rejudgePaperRelation } from './graph-relation-actions';
import { regenerateEntityExplanation } from './graph-explanation-actions';
import {
  openEntityReviewDialog,
  refreshEntityReviewIfOpen,
} from './entity-review-dialog';
import { openEntityMergeDialog } from './entity-merge-dialog';

/** Above this node count the layout gets a cheap preview pass instead of settling. */
const LAYOUT_NODE_BUDGET = 320;

/**
 * Above this node count, degree-1 leaves are folded before rendering.
 *
 * Higher than `LAYOUT_NODE_BUDGET`: condensation is a visible structural change, so it happens only once the graph is
 * genuinely too big to read, whereas the layout budget is an internal performance knob.
 */
const CONDENSE_THRESHOLD = 240;

/** Set by `redraw` so the counts line can report what was folded. */
let condensationNote = '';

let renderer: GraphCanvasRenderer | null = null;
/** Pan/zoom state and the "fit once after layout" rule — see `graph-viewport-controller.ts`. */
const viewportController = createGraphViewportController({
  initial: createViewport(),
  measure: () => ({
    width: knowledgeGraphCanvasElement.clientWidth || 900,
    height: knowledgeGraphCanvasElement.clientHeight || 600,
  }),
  apply: (next) => {
    renderer?.setViewport(next);
    renderer?.render();
  },
});
let snapshot: GraphSnapshot = { papers: [], entities: [], userNodes: [], edges: [] };
let visibleEdgeIds = new Set<string>();
let openToken = 0;
let loaded = false;
let loading: Promise<void> | null = null;
/** The last projection's summary, so an explicit 重新同步 can report it even when it piggy-backed on a silent load. */
let lastSyncSummary = '';

/** Layout pass + viewport framing; see `graph-layout-runner.ts` for why it is its own file. */
const layoutRunner = createGraphLayoutRunner({
  getRenderer: () => renderer,
  viewport: () => viewportController,
  canvasSize: () => ({
    width: Math.max(320, knowledgeGraphCanvasElement.clientWidth || 900),
    height: Math.max(240, knowledgeGraphCanvasElement.clientHeight || 600),
  }),
  previewNodeBudget: LAYOUT_NODE_BUDGET,
});

/** The open document's graph id, or undefined when nothing matching is stored. */
function currentPaperId(): string | undefined {
  const fingerprint = getPdfFingerprint();
  if (!fingerprint) return undefined;
  return snapshot.papers.find((paper) => paper.fingerprint === fingerprint)?.paperId;
}

function currentSubgraphRequest(): SubgraphRequest {
  const paperId = graphFocusMode.value === 'current' ? currentPaperId() : undefined;
  return {
    focusId: paperId,
    focusKind: paperId ? 'paper' : undefined,
    hops: graphFocusHops.value,
    minConfidence: graphMinConfidence.value,
    maxNodes: LAYOUT_NODE_BUDGET,
  };
}

/** The current filter state, in the shape `graph-view-filters.ts` takes. */
function currentFilterState(): GraphFilterState {
  return {
    showPapers: graphShowPapers.value,
    showEntities: graphShowEntities.value,
    showOriginAi: graphShowOriginAi.value,
    showOriginRule: graphShowOriginRule.value,
    showOriginUser: graphShowOriginUser.value,
    searchQuery: graphSearchQuery.value,
    // The same floor the slider sets, applied to nodes as well as edges: the control is labelled
    // 置信度下限, and it used to only cull edges — so moving it barely changed the picture.
    minConfidence: graphMinConfidence.value,
  };
}

/**
 * Rebuilds the visible subgraph from the current filters. Single funnel for canvas, counts and selection bookkeeping, so the
 * three cannot disagree about what is on screen.
 */
function redraw(): void {
  if (!renderer) return;

  // Condense before the subgraph, not after: truncation cuts whatever ordering reaches the cap, so running it first can hide
  // papers behind keyword noise. Folding degree-1 leaves keeps every paper and every real hub.
  const condensed = condenseGraph(
    snapshot.papers,
    snapshot.entities,
    snapshot.edges,
    { threshold: CONDENSE_THRESHOLD },
  );
  condensationNote = describeCondensation(condensed);

  // Papers that share several confirmed entities get a direct line. Derived per redraw from the
  // current entities — never stored — and skipped for pairs that already carry a judged conclusion.
  const bridges = buildSharedEntityBridges(
    condensed.papers,
    condensed.entities,
    condensed.edges,
    { judgedPairKeys: collectJudgedPairKeys(condensed.edges) },
  );
  const renderEdges = [
    ...condensed.edges,
    ...bridges.map((bridge) => bridge.edge),
  ];

  const subgraph = buildSubgraph(
    currentSubgraphRequest(),
    condensed.papers,
    condensed.entities,
    renderEdges,
    snapshot.userNodes,
  );
  const nodes = filterVisibleNodes(subgraph.papers, subgraph.entities, currentFilterState());
  // Personal nodes share the "user" origin toggle with user edges: one switch for
  // "show me my own material" rather than two that can contradict each other.
  const userNodes = graphShowOriginUser.value ? subgraph.userNodes : [];
  const visibleIds = new Set([
    ...nodes.papers.map((paper) => paper.paperId),
    ...nodes.entities.map((entity) => entity.entityId),
    ...userNodes.map((node) => node.id),
  ]);
  const edges = filterVisibleEdges(subgraph.edges, currentFilterState()).filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );

  renderer.setModel(buildRenderModel(
    nodes.papers,
    nodes.entities,
    edges,
    userNodes,
  ));
  visibleEdgeIds = new Set(edges.map((edge) => edge.edgeId));

  scheduleLayout();

  renderer.setState({
    hoveredNodeId: null,
    selectedNodeId: graphSelectedNodeId.value || null,
    selectedEdgeId: graphSelectedEdgeId.value || null,
    matchedNodeIds: collectMatchedNodeIds(snapshot.papers, snapshot.entities, graphSearchQuery.value),
    dimmedNodeIds: new Set(
      [...snapshot.papers.map((paper) => paper.paperId),
        ...snapshot.entities.map((entity) => entity.entityId)]
        .filter((id) => !visibleIds.has(id)),
    ),
  });

  const connectedIds = new Set<string>();
  // Bridges count as connections: a pair linked only by shared entities is drawn as linked, and the
  // counts must not call it 未连接 while the canvas draws a line.
  for (const edge of renderEdges) {
    // A negative verdict is a cache entry, not a relationship, so it never connects anything.
    if (!isRenderableEdge(edge)) continue;
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  const allNodeIds = [
    ...condensed.papers.map((paper) => paper.paperId),
    ...condensed.entities.map((entity) => entity.entityId),
  ];
  const unconnectedNodes = allNodeIds.filter((id) => !connectedIds.has(id)).length;
  const hiddenByFilters = Math.max(
    0,
    allNodeIds.length - unconnectedNodes - visibleIds.size,
  );
  const report = describeGraphView({
    visiblePapers: nodes.papers.length,
    visibleEntities: nodes.entities.length,
    visibleUserNodes: userNodes.length,
    visibleEdges: edges.length,
    unconnectedNodes,
    hiddenByFilters,
    truncated: subgraph.truncated,
    condensationNote,
    totalPapers: snapshot.papers.length,
    totalEntities: snapshot.entities.length,
    totalEdges: renderEdges.filter(isRenderableEdge).length,
    // Negatives are counted separately: they are the reason an empty canvas is empty
    // even though the pairs *have* been judged.
    unrelatedPairCount: renderEdges.filter((edge) => !isRenderableEdge(edge)).length,
  });
  knowledgeGraphCountsElement.textContent = report.countsText;
  updateEmptyState(report);
}

/**
 * Layout and framing live in `graph-layout-runner.ts`: they run on their own clock (an animation
 * frame, then one fit), which is a different reason to change than the page's state funnel.
 */
function scheduleLayout(): void {
  layoutRunner.schedule();
}

export function zoomKnowledgeGraph(factor: number, anchorX?: number, anchorY?: number): void {
  layoutRunner.zoom(factor, anchorX, anchorY);
}

export function fitKnowledgeGraph(): void {
  layoutRunner.fit();
}

/**
 * Re-measures the canvas after the window or the workspace changed.
 *
 * It does **not** fit: node positions live in world coordinates, so a resize only changes how much of the world is on screen.
 */
export function resizeKnowledgeGraphCanvas(): void {
  layoutRunner.resize();
}

function buildInspectorActions(): InspectorActions {
  return {
    openPaperSource(paper, pageNumber, quote) {
      void openGraphSourcePdf(paper, pageNumber, quote).then((opened) => {
        if (!opened) {
          setPageStatus('未找到该论文对应的本地文件，可能已被移动或删除。', true);
        }
      });
    },
    rejudgeRelation(leftPaperId, rightPaperId) {
      // The pass re-reads the snapshot itself, so the canvas is refreshed only once
      // the new conclusion has actually been written.
      void rejudgePaperRelation(leftPaperId, rightPaperId);
    },
    explainEntity(entityName) {
      // Also re-reads and re-renders when the answer lands, so the panel updates in place.
      void regenerateEntityExplanation(entityName);
    },
    deleteEntity(entityId, entityName) {
      // Confirmation, cascade and the reload all happen in the action: the panel must not guess at
      // what the store currently holds.
      void deleteGraphEntityFromInspector(entityId, entityName);
    },
    focusNode(nodeId, kind) {
      graphSelectedNodeId.value = nodeId;
      graphSelectedEdgeId.value = '';
      // Focusing a paper switches the page to the "current paper" lens; focusing
      // a hub entity keeps the whole graph but rings and inspects that entity,
      // because an entity focus has no single paper to centre on.
      graphFocusMode.value = kind === 'paper' ? 'current' : 'all';
      syncFilterControls();
      redraw();
      redrawInspector();
    },
  };
}

function redrawInspector(): void {
  if (!renderer) return;
  const actions = buildInspectorActions();
  const edgeId = graphSelectedEdgeId.value;
  if (edgeId && visibleEdgeIds.has(edgeId)) {
    const item = renderer.getModel().edges.find(
      (candidate) => candidate.edge.edgeId === edgeId,
    );
    if (item) {
      renderEdgeInspector(item.edge, snapshot, actions);
      return;
    }
  }
  const nodeId = graphSelectedNodeId.value;
  const node = nodeId ? renderer.getModel().nodeById.get(nodeId) : undefined;
  if (node) {
    if (node.kind === 'paper' && node.paper) {
      renderPaperInspector(node.paper, snapshot, actions);
      return;
    }
    if (node.entity) {
      renderEntityInspector(node.entity, snapshot, actions, currentExplanationProgress());
      return;
    }
    // A personal node (「我的标注」) has neither a paper nor an entity behind it. Falling through to `clearInspector`
    // is deliberate: selecting one used to leave the *previous* node's panel on screen, with its actions still live.
  }
  clearInspector();
}

/**
 * The personal layer, assembled in its own file.
 *
 * Re-exported under the page's own name so the load path reads as one sequence;
 * what it does (capture the open document's highlights, join document names to
 * papers, read the stored copy) is a different reason to change than rendering.
 */
function buildPersonalProvider(): PersonalGraphProvider {
  return buildGraphPersonalProvider();
}

function ensureRenderer(): GraphCanvasRenderer {
  if (!renderer) {
    renderer = new GraphCanvasRenderer(
      knowledgeGraphCanvasElement,
      resolveGraphTheme(),
      viewportController.get(),
    );
  }
  renderer.syncSize();
  return renderer;
}

/** Re-filters and redraws without touching the database. */
export function rerenderKnowledgeGraph(): void {
  ensureRenderer();
  // Controls and canvas are two views of the same state, so they are re-synced
  // together — without this the "全局图谱 / 当前论文" buttons kept the highlight of the
  // previously selected one while the canvas already showed the new lens.
  syncFilterControls();
  redraw();
  redrawInspector();
}

/**
 * Loads the graph and redraws.
 *
 * `reason` decides whether the floating status plate appears: automatic loads are silent (they run on every entry, and a
 * plate saying 「已同步：写入 0 篇文献」 on every visit is noise over the canvas), only 「重新同步」 announces. Errors are
 * always reported, whatever the mode.
 */
async function loadAndRender(force: boolean, options: { reason?: GraphLoadReason } = {}): Promise<void> {
  if (loading) return loading;
  const announce = shouldAnnounceGraphLoad(options.reason ?? 'action');
  loading = (async () => {
    if (announce) setPageStatus(force ? '正在重新同步文献库…' : '正在读取图谱…', false, 'active');
    try {
      if (force) {
        const overview = await openKnowledgeGraph(buildPersonalProvider());
        snapshot = overview.snapshot;
        lastSyncSummary = `已同步：写入 ${overview.refresh.papersWritten} 篇文献`
          + `，关键词边 +${overview.refresh.keywordEdgesWritten}`
          + `，共 ${overview.snapshot.papers.length} 篇`;
        if (announce) setPageStatus(lastSyncSummary);
      } else {
        // A plain load must not show papers the knowledge base no longer has (the projection used to be trusted as-is,
        // so emptying the knowledge base left the graph reporting papers that exist nowhere), and it prunes on every
        // entry — a document removed while this page was hidden would otherwise stay wrong until a manual sync.
        const pruned = await pruneRemovedGraphPapers();
        snapshot = await readGraphSnapshot(buildPersonalProvider());
        // Pruning is not routine: the user cannot see it any other way, so it is announced even in silent mode.
        if (announce) {
          setPageStatus(
            pruned.length
              ? `已载入 ${snapshot.papers.length} 篇文献（清理了 ${pruned.length} 篇不在知识库中的记录）`
              : `已载入 ${snapshot.papers.length} 篇文献`,
          );
        } else if (pruned.length) {
          setPageStatus(`已清理 ${pruned.length} 篇不在知识库中的图谱记录。`);
        }
      }
      loaded = true;
    } catch (error) {
      snapshot = { papers: [], entities: [], userNodes: [], edges: [] };
      loaded = true;
      setPageStatus(error instanceof Error ? error.message : String(error), true);
    }
    // A graph that emptied out has to be fitted again when it fills up, otherwise the
    // first graph after a clean-up inherits a view that was fitted to nothing.
    if (!snapshot.papers.length && !snapshot.entities.length) viewportController.invalidate();
    syncFilterControls();
    redraw();
    redrawInspector();
    // Deliberately *not* fitting here: see `fitOnceAfterLayout`. A reload triggered by
    // an action (statistics, conflicts, a finished extraction) must leave the user
    // where they were instead of snapping the canvas back to the origin.
    renderer?.render();
    // Availability depends on the projection (which resolves the paper id) and on
    // the chunk store, so it is evaluated after the snapshot settles.
    void refreshExtractionAvailability();
    void refreshPendingCount();
    // Conflicts are read from the store rather than derived from the rendered
    // snapshot, so the badge counts what is actually stored.
    void refreshConflictCount();
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/**
 * Shows the graph page.
 *
 * Every entry runs a **full projection**, not just a re-read: the cheaper plain load could only remove papers, so a
 * document added to the knowledge base never appeared until 重新同步 — which also left the extract buttons disabled. The
 * projection is incremental (`shouldWriteProjection`), so an unchanged knowledge base still writes nothing.
 */
export function renderKnowledgeGraph(): void {
  ensureRenderer();
  void loadAndRender(true, { reason: 'entry' });
}

/** One selection through one funnel: a click that hits nothing clears both, and the inspector empties with it. */
function applyCanvasSelection(nodeId: string | null, edgeId: string | null): void {
  graphSelectedNodeId.value = nodeId ?? '';
  graphSelectedEdgeId.value = edgeId ?? '';
  redraw();
  redrawInspector();
}

/** Pan, zoom and click hit-testing for the graph canvas. */
export function registerKnowledgeGraphCanvasEvents(): void {
  registerGraphCanvasInteraction(knowledgeGraphCanvasElement, {
    getRenderer: () => renderer,
    viewport: viewportController,
    zoom: zoomKnowledgeGraph,
    select: applyCanvasSelection,
  });
  installExtractionDiagnostics();
}

export function openKnowledgeGraphPage(): void {
  const token = ++openToken;
  knowledgeGraphEntryButton.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');
  setCurrentApplicationView('graph');
  void transitionWorkspaceView('graph').then(() => {
    if (token !== openToken || getActiveWorkspaceView() !== 'graph') return;
    requestAnimationFrame(() => {
      if (token !== openToken || getActiveWorkspaceView() !== 'graph') return;
      ensureRenderer();
      knowledgeGraphCanvasElement.style.cursor = 'grab';
      setStatus('知识图谱：点击节点或连线查看详情与原文证据。');
      renderKnowledgeGraph();
      // Pending counts are read from the store, not the rendered snapshot, so the
      // badge is right even when no candidates are confirmed yet.
      void refreshPendingCount();
      void refreshConflictCount();
    });
  });
}

export function closeKnowledgeGraphPage(): void {
  if (getActiveWorkspaceView() !== 'graph') return;
  openToken += 1;
  // The toast is a fixed-position plate on `body`, so it would otherwise float over the reader.
  hideGraphTaskNotice();
  knowledgeGraphEntryButton.classList.remove('active');
  aiPanelToggleButton?.classList.add('active');
  setCurrentApplicationView('viewer');
  void transitionWorkspaceView('viewer');
  persistCurrentAppViewState();
}

export function refreshKnowledgeGraphIfOpen(): void {
  if (getActiveWorkspaceView() === 'graph') void loadAndRender(true, { reason: 'refresh' });
}

export async function resyncKnowledgeGraph(): Promise<void> {
  // An automatic sync may already be in flight (the page was just opened). The button must still report something rather
  // than look dead, so it waits for that run and announces its summary.
  if (loading) {
    await loading;
    if (lastSyncSummary) setPageStatus(lastSyncSummary);
    return;
  }
  // The one place the status plate is wanted: an explicit sync answers "did it do anything?".
  return loadAndRender(true, { reason: 'resync' });
}

export function isKnowledgeGraphLoaded(): boolean {
  return loaded;
}

/** Inspect panel container; also used by the responsive layout check. */
export function isKnowledgeGraphInspectorVisible(): boolean {
  return !knowledgeGraphInspectorElement.hidden;
}

/**
 * Wires the entity actions (extraction, confirmation, merge) to this controller.
 *
 * The actions live in `graph-entity-actions.ts` because they are a different
 * reason to change than rendering; they receive the parts of the controller they
 * need instead of importing it, which keeps the module graph acyclic.
 */
function installGraphActions(): void {
  configureGraphActions({
    currentPaperId,
    listPapers: () => snapshot.papers.map((paper) => ({
      paperId: paper.paperId,
      title: paper.title,
    })),
    // Recall needs folder, venue, year and abstract, so it takes the full
    // records rather than the id/title projection used for display.
    getPapers: () => snapshot.papers,
    getEntityNames: () => new Map(
      snapshot.entities.map((entity) => [entity.entityId, entity.name]),
    ),
    // The statistics report counts user-origin edges too, so it takes the same
    // personal-layer snapshot the canvas renders.
    getMetricsSource: () => ({
      papers: snapshot.papers,
      entities: snapshot.entities,
      edges: snapshot.edges,
    }),
    // Edges per paper: the paper list says "no relations yet" with this, which is why a
    // document can be in the graph and still have no node on the canvas.
    getRelationCounts: () => {
      const counts = new Map<string, number>();
      for (const edge of snapshot.edges) {
        if (edge.sourceKind === 'paper') {
          counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
        }
        if (edge.targetKind === 'paper') {
          counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
        }
      }
      return counts;
    },
    reload: () => loadAndRender(false),
    ensureReady: () => {
      ensureRenderer();
    },
    // The image is rendered from the *current* model, so what the user sees (filters applied, layout settled) is
    // what gets exported — but at a size fitted to the whole graph instead of the window.
    renderExportImage: () => {
      ensureRenderer();
      const canvas = renderer?.renderWholeGraphImage() ?? null;
      if (!canvas) return null;
      return { canvas, papers: snapshot.papers.length, entities: snapshot.entities.length };
    },
  });
  // The explanation actions keep their own context: one live stream, a button that must be disabled
  // while it runs, and failures that stay visible next to that button.
  configureExplanationActions({
    getPapers: () => snapshot.papers,
    reload: () => loadAndRender(false),
    refreshInspector: () => redrawInspector(),
    setProgress: ({ message, done }) => setExtractionProgress({
      phase: done ? 'done' : 'extracting',
      message,
      completedBatches: 0,
      totalBatches: 0,
    }),
  });
  // Relation analysis needs the paper list twice (the picker and recall) and reports progress through
  // the same header line extraction uses.
  configureRelationActions({
    getPapers: () => snapshot.papers,
    getEntityNames: () => new Map(
      snapshot.entities.map((entity) => [entity.entityId, entity.name]),
    ),
    currentPaperId,
    reload: () => loadAndRender(false),
    ensureReady: () => {
      ensureRenderer();
    },
    setProgress: ({ message, done }) => setExtractionProgress({
      phase: done ? 'done' : 'extracting',
      message,
      completedBatches: 0,
      totalBatches: 0,
    }),
    refreshAvailability: refreshExtractionAvailability,
  });
}

export { installGraphActions };

export { knowledgeGraphEntryButton };
