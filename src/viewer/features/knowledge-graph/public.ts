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
  resizeKnowledgeGraphCanvas,
  resyncKnowledgeGraph,
  zoomKnowledgeGraph,
} from './knowledge-graph-page';

export {
  configureGraphActions,
  deleteGraphEntityFromInspector,
  exportGraph,
  extractEntitiesForAllPapers,
  extractEntitiesForCurrentPaper,
  openConflictReview,
  openGraphMetrics,
  openPaperManager,
  openMergeReview,
  openPendingEntityReview,
  refreshConflictCount,
  refreshExtractionAvailability,
  refreshPendingCount,
  setExtractionProgress,
  type GraphActionContext,
} from './graph-entity-actions';

export {
  configureExplanationActions,
  currentExplanationProgress,
  explainAllMissingEntities,
  explainConfirmedEntities,
  regenerateEntityExplanation,
  BULK_EXPLAIN_CONFIRM_THRESHOLD,
  type ExplanationActionContext,
} from './graph-explanation-actions';

export {
  configureRelationActions,
  analyzePaperRelations,
  rejudgePaperRelation,
  RELATION_CONFIRM_TOKEN_THRESHOLD,
  type RelationActionContext,
} from './graph-relation-actions';

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
  isRelationPickerOpen,
  openRelationPaperPicker,
  registerRelationPickerEvents,
  type RelationPickerPaper,
  type RelationPickerResult,
} from './relation-paper-picker';

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
