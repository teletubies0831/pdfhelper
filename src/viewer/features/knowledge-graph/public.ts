export {
  closeKnowledgeGraphPage,
  fitKnowledgeGraph,
  isKnowledgeGraphInspectorVisible,
  isKnowledgeGraphLoaded,
  openKnowledgeGraphPage,
  refreshKnowledgeGraphIfOpen,
  registerKnowledgeGraphCanvasEvents,
  renderKnowledgeGraph,
  rerenderKnowledgeGraph,
  resyncKnowledgeGraph,
  zoomKnowledgeGraph,
} from './knowledge-graph-page';

export {
  analyzePaperRelations,
  configureGraphActions,
  exportGraph,
  extractEntitiesForAllPapers,
  extractEntitiesForCurrentPaper,
  importGraph,
  openConflictReview,
  openGraphMetrics,
  openPaperManager,
  openMergeReview,
  openPendingEntityReview,
  refreshConflictCount,
  refreshExtractionAvailability,
  refreshPendingCount,
  RELATION_CONFIRM_TOKEN_THRESHOLD,
  type GraphActionContext,
} from './graph-entity-actions';

export { installGraphActions } from './knowledge-graph-page';

export { openGraphSourcePdf } from './graph-source-navigation';

export {
  isEntityReviewOpen,
  openEntityReviewDialog,
  refreshEntityReviewIfOpen,
  registerEntityReviewEvents,
  type ReviewDialogResult,
} from './entity-review-dialog';

export {
  isMergeDialogOpen,
  openEntityMergeDialog,
  registerEntityMergeEvents,
} from './entity-merge-dialog';

export {
  isGraphMetricsOpen,
  openGraphMetricsDialog,
  registerGraphMetricsEvents,
  type GraphMetricsSource,
} from './graph-metrics-dialog';

export {
  isConflictDialogOpen,
  openConflictDialog,
  registerConflictEvents,
  type ConflictDialogInput,
} from './conflict-dialog';

export {
  isRelationReviewOpen,
  openRelationReviewDialog,
  registerRelationReviewEvents,
  type RelationReviewDialogInput,
} from './relation-review-dialog';

export {
  isPapersDialogOpen,
  openPapersDialog,
  registerPapersDialogEvents,
  type PapersDialogInput,
  type PapersDialogPaper,
} from './papers-dialog';

export {
  createGraphExtractionPorts,
  createRelationAnalysisPorts,
  deleteExtractionJobsForPaper,
  extractionJobRepository,
  removeGraphPaper,
} from './graph-extraction-repository';

export type { InspectorActions } from './graph-inspector';
