/**
 * Knowledge graph module public API.
 *
 * The viewer feature and any future agent tooling talk to the graph only
 * through this barrel. Everything below the barrel (domain rules, funnel
 * scoring, IndexedDB adapters) is an implementation detail.
 */

export * from './contracts.ts';
export * from './contracts-jobs.ts';
export * from './contracts-user-graph.ts';

export {
  areSameEntityName,
  normalizeEntityAliases,
  normalizeEntityName,
  tokenizeEntityName,
} from './domain/entity-normalization.ts';

export {
  characterDice,
  DEFAULT_ENTITY_MERGE_THRESHOLD,
  editSimilarity,
  ENTITY_SIMILARITY_REVIEW_FLOOR,
  entitySimilarity,
  fuzzyTokenOverlap,
  levenshteinDistance,
  suggestEntityMerges,
  tokenJaccard,
  TOKEN_MATCH_SIMILARITY,
  type EntitySimilarityResult,
  type EntitySimilaritySignals,
  type MergeCandidateInput,
  type MergeSuggestion,
  type SimilarityOptions,
} from './domain/entity-similarity.ts';

export {
  createEdgeOriginKey,
  createGraphId,
  isUniqueConstraintError,
  normalizeEdgeEndpoints,
  pruneDanglingEdges,
} from './domain/graph-identity.ts';

export {
  buildAdjacency,
  buildSubgraph,
  findIndirectlyConnectedPapers,
  isRenderableEdge,
  DEFAULT_MAX_SUBGRAPH_NODES,
  type GraphSubgraph,
  type SubgraphFilter,
  type SubgraphRequest,
} from './domain/graph-query.ts';

export {
  findRemovedPaperIds,
  projectPaperFromSource,
  syncPaperProjections,
  type PaperGraphMetadata,
  type ProjectionSyncResult,
} from './domain/paper-projection.ts';

export {
  SHARED_PAPER_DEGREE,
  buildNodeRoleIndex,
  paperDegreeOf,
  type NodeRoleIndex,
} from './domain/paper-degree.ts';

export {
  attachEntityDescriptions,
  buildEntityExplanationPrompt,
  buildExplanationUserMessage,
  buildStreamingExplanationPrompt,
  describeExplanationResult,
  explainEntityDescriptions,
  normalizeExplanation,
  normalizeStreamingExplanation,
  parseEntityExplanations,
  planExplanationTargets,
  EXPLANATIONS_PER_CALL,
  EXPLANATION_PROMPT_VERSION,
  MAX_EXPLANATION_CHARACTERS,
  type EntityExplanationPorts,
  type EntityExplanationRepository,
  type EntityExplanationResult,
  type ExplanationMessageItem,
  type ExplanationTarget,
} from './application/entity-explanations.ts';

export {
  computeLayout,
  createInitialPositions,
  springForLink,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutEdge,
  type LayoutNode,
  type LayoutNodeKind,
  type LayoutOptions,
  type LayoutPoint,
  type LinkSpring,
} from './domain/graph-force-layout.ts';

export {
  joinKnowledgePaperSources,
  knowledgePaperIds,
  type GraphPaperSource,
  type KnowledgePaperJoinInput,
} from './application/paper-source.ts';

export {
  KNOWLEDGE_GRAPH_PROJECTION_VERSION,
  shouldWriteProjection,
} from './domain/paper-projection-plan.ts';

export {
  buildRenderModel,
  confidenceAlpha,
  dashPatternForOrigin,
  distanceToSegment,
  isDirectedEdgeType,
  radiusForDegree,
  truncateLabel,
  ENTITY_NODE_RADIUS,
  PAPER_NODE_RADIUS,
  type GraphRenderEdge,
  type GraphRenderModel,
  type GraphRenderNode,
} from './domain/graph-render-model.ts';

export {
  baseRadiusFor,
  cullRenderModel,
  isHubNode,
  nodeWithinBounds,
  pointWithinBounds,
  segmentCrossesBounds,
  shouldDrawLabel,
  visibleWorldBounds,
  HUB_RADIUS_BONUS,
  LABEL_BOX_BOTTOM,
  LABEL_SCALE_FLOOR,
  PERSONAL_LABEL_SCALE_FLOOR,
  type CullStats,
  type CulledRenderModel,
  type CullingViewport,
  type WorldBounds,
} from './domain/graph-culling.ts';

export {
  buildKeywordEdges,
  buildKeywordEntities,
  findStaleKeywordOriginKeys,
  keywordNodeLabel,
  keywordSlug,
  KEYWORD_NODE_PREFIX,
} from './application/keyword-layer.ts';

export {
  loadGraphSnapshot,
  refreshGraphProjection,
  type GraphPersistencePort,
  type GraphSnapshotPort,
  type RefreshGraphResult,
} from './application/graph-service.ts';

export { isUndirected } from './domain/edge-rules.ts';

export {
  EDGE_TYPE_LABELS,
  describeEdgeType,
  edgeTypeLabel,
} from './domain/edge-labels.ts';

export {
  buildSharedEntityBridges,
  MIN_SHARED_ENTITIES_FOR_BRIDGE,
  type SharedEntityBridge,
} from './domain/shared-entity-bridges.ts';

export {
  abbreviationLeadsName,
  extractAbbreviationPairs,
  isAbbreviationOf,
  isDeclaredAbbreviationOf,
  suggestAbbreviationMerges,
  ABBREVIATION_INITIALS_SCORE,
  ABBREVIATION_STATED_SCORE,
  type AbbreviationCandidate,
  type AbbreviationPair,
  type AbbreviationSuggestion,
} from './domain/entity-abbreviations.ts';

export {
  extractJsonObject,
  groupCandidatesByType,
  parseEntityCandidates,
  shouldPreCheckCandidate,
  type CandidateParseContext,
  type CandidateParseResult,
} from './application/candidate-parsing.ts';

export {
  buildPaperEntityEdge,
  mergeEvidence,
  pickCanonicalEntity,
  planEntityConfirmation,
  planEntityMerge,
  MAX_EVIDENCE_PER_ENTITY,
  type AcceptedCandidate,
  type ConfirmationPlan,
  type MergeEntityPlan,
  type PlanContext,
} from './application/entity-planning.ts';

export {
  buildMergeReview,
  groupMergeRowsByKeep,
  loadMergeReview,
  orderMergePairsForBatch,
  selectMergeCandidates,
  type MergeReviewSummary,
  type MergeReviewSummarySource,
  type MergeSuggestionRow,
} from './application/merge-review.ts';

export {
  findDanglingEdgeIds,
  planPaperCleanup,
  removePaperFromGraph,
  type PaperCleanupPort,
  type PaperCleanupResult,
} from './application/paper-cleanup.ts';

export {
  describeHighlightCapture,
  planHighlightCapture,
  type CapturedHighlight,
  type HighlightCaptureInput,
  type HighlightCapturePlan,
} from './application/highlight-capture.ts';

export {
  buildFolderEdges,
  buildTagEdges,
  collectFolderAncestors,
  findStalePersonalOriginKeys,
  folderNodeId,
  highlightNodeId,
  noteNodeId,
  projectPersonalGraph,
  tagNodeId,
  USER_NODE_ID,
  type PersonalGraphInput,
  type PersonalGraphProjection,
} from './application/personal-graph.ts';

export type { PersonalGraphInput as ProjectPersonalGraphInput } from './application/personal-graph.ts';

export {
  buildRelationJudgementPrompt,
  buildRelationEdge,
  buildJudgementReviewRows,
  buildVerdictEdge,
  filterAcceptedJudgements,
  isPaperPaperConclusion,
  parseRelationJudgements,
  planRelationJudgementWrites,
  MAX_RELATION_EVIDENCE,
  MAX_RELATION_QUOTE_LENGTH,
  RELATION_NONE,
  RELATION_PROMPT_VERSION,
  type JudgementReviewRow,
  type ParsedRelation,
  type RelationJudgementPlan,
  type RelationParseResult,
  type RelationVerdict,
} from './application/relation-judgement.ts';

export {
  emptyBridgeDrops,
  nameSupportedByQuotes,
  parseBridgeSuggestions,
  quoteAppearsIn,
  totalBridgeDrops,
  MAX_BRIDGES_PER_PAIR,
  type BridgeDropStats,
  type BridgeParseOptions,
  type RelationBridgeSuggestion,
} from './relation-exports.ts';

export {
  deriveTagRecords,
  hashTagName,
  normalizeTagName,
  planTagAssignments,
  tagIdForName,
  type TagAssignment,
  type TagEdgePlan,
} from './domain/tag-identity.ts';

export {
  aggregateNodeId,
  computeDegree,
  condenseGraph,
  describeCondensation,
  isAggregateNodeId,
  AGGREGATE_NODE_PREFIX,
  DEFAULT_CONDENSE_THRESHOLD,
  type CondensationResult,
  type CondenseOptions,
} from './domain/graph-condensation.ts';

export {
  describeConflicts,
  findRelationConflicts,
  planConflictResolution,
  resolveByRank,
  RELATION_RANK,
  type ConflictResolutionPlan,
  type RelationConflict,
} from './application/conflict-resolution.ts';

export {
  describeResolutionResult,
  planConflictBatch,
  resolveRelationConflicts,
  scanRelationConflicts,
  type ConflictApplyPorts,
  type ConflictApplyResult,
  type ConflictBatchPlan,
  type ConflictScan,
  type ConflictScanOptions,
  type ConflictScanPorts,
} from './application/conflict-service.ts';

export {
  createGraphSnapshot,
  describeImportPlan,
  parseGraphSnapshot,
  planGraphImport,
  suggestSnapshotFileName,
  GRAPH_SNAPSHOT_FORMAT,
  GRAPH_SNAPSHOT_VERSION,
  type GraphImportPlan,
  type GraphSnapshotDocument,
  type GraphSnapshotParseResult,
  type GraphSnapshotSources,
  type ImportStrategy,
} from './application/graph-transfer.ts';

export {
  describeBridgeDrops,
  describeRelationResult,
  isFullyJudged,
  previewRelationAnalysis,
  runRelationAnalysis,
  PENDING_ENTITY_HINT,
  type RelationAnalysisPorts,
  type RelationAnalysisResult,
  type RelationJudgementDecision,
  type RelationJudgementReview,
  type RelationPreview,
  type RelationReviewAcceptance,
  type RunRelationAnalysisOptions,
} from './application/relation-runner.ts';

// Bridge concepts and node deletion live in their own small barrel: they are what a knowledge-graph
// *edit* can touch beyond relations, and grouping them here keeps this file inside the architecture
// check's line limit. `export *` on purpose — the list is that file's own concern.
export * from './relation-exports.ts';

export {
  computeGraphMetrics,
  formatGraphMetrics,
  isKeywordNodeId,
  suggestGraphImprovements,
  type EdgeCompositionMetrics,
  type EntityFunnelMetrics,
  type EntityReuseMetrics,
  type GraphMetrics,
  type GraphScaleMetrics,
} from './application/graph-metrics.ts';

export {
  buildSelectedCandidatePairs,
  collectJudgedPairKeys,
  cosineSimilarity,
  estimateJudgementTokens,
  recallCandidatePairs,
  relationPairKey,
  selectTopKForJudgement,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MIN_RECALL_SCORE,
  DEFAULT_VECTOR_THRESHOLD,
  MAX_SELECTED_PAPERS,
  PAPER_RELATION_EDGE_TYPES,
  RECALL_WEIGHTS,
  type RecallOptions,
  type RelationCandidatePair,
} from './application/relation-recall.ts';

export {
  runBatchExtraction,
  selectBatchTargets,
  summarizeBatchResult,
  type BatchExtractionOptions,
  type BatchExtractionResult,
  type BatchExtractionRunnerPorts,
  type BatchPaperOutcome,
  type BatchProgress,
  type BatchTargetPaper,
} from './application/batch-extraction.ts';

export {
  buildPendingReview,
  clearMergeRejections,
  confirmEntityCandidates,
  dismissEntityCandidates,
  ignoreEntityName,
  loadPendingReview,
  mergeGraphEntities,
  readCandidatesFromModelResponse,
  reconcileIgnoredPendingCandidates,
  rejectMergeSuggestion,
  unignoreEntityName,
  type ConfirmCandidatesResult,
  type DismissCandidatesResult,
  type GraphEntityRepositoryPort,
  type MergeEntitiesResult,
  type PendingReviewCandidate,
  type PendingReviewGroup,
  type PendingReviewSummary,
} from './application/entity-service.ts';

export {
  mergePairKey,
  normalizeMergeRejections,
  MAX_MERGE_REJECTIONS,
} from './domain/merge-rejection.ts';

export {
  IndexedDbKnowledgeGraphRepository,
  type KnowledgeGraphRepository,
} from './adapters/indexed-db/knowledge-graph-repository.ts';

export { normalizeKnowledgeGraphSettings } from './domain/graph-settings.ts';

export {
  canResumeJob,
  createJobRecord,
  cursorFromProgress,
  extractionInputFingerprint,
  isJobComplete,
  isTerminalJobStatus,
  jobProgressOf,
  jobRetryDelayMs,
  markJobCancelled,
  markJobDone,
  markJobFailed,
  markJobProgress,
  markJobRunning,
  remainingBatches,
  shouldRetryJob,
  MAX_JOB_ATTEMPTS,
  type JobProgress,
} from './application/job-policy.ts';

export {
  IndexedDbExtractionJobRepository,
  type ExtractionJobRepository,
} from './adapters/indexed-db/extraction-job-repository.ts';

export {
  buildEntityExtractionPrompt,
  buildExtractionUserMessage,
  overviewLeadAsAbstract,
  planExtractionBatches,
  DEFAULT_MAX_CANDIDATES_PER_CHUNK,
  EXTRACTION_CHUNKS_PER_CALL,
  EXTRACTION_ENTITY_TYPES,
  EXTRACTION_MAX_INPUT_CHARACTERS,
  EXTRACTION_PROMPT_VERSION,
  MAX_OVERVIEW_LEAD_CHARACTERS,
  type ExtractionBatch,
  type ExtractionUserMessageInput,
} from './application/extraction-plan.ts';

export {
  contiguousCompletedCount,
  runWithConcurrency,
  type RunTasksOptions,
  type TaskOutcome,
} from './domain/concurrency.ts';

export {
  findMatchingEntity,
  planPendingCandidateUpsert,
  type PendingCandidateInput,
  type PendingUpsertPlan,
} from './application/pending-candidates.ts';

export {
  isExtractionRunning,
  resetExtractionRunsForTest,
  runEntityExtraction,
  type ExtractionProgress,
  type ExtractionRunResponse,
  type ExtractionRunResult,
  type ExtractionRunnerPorts,
  type RunExtractionOptions,
} from './application/extraction-runner.ts';

export {
  KNOWLEDGE_GRAPH_DATABASE_NAME,
  KNOWLEDGE_GRAPH_DATABASE_VERSION,
  openKnowledgeGraphDatabase,
} from './adapters/indexed-db/knowledge-graph-database.ts';

import { listKnowledgeDocuments } from '../knowledge/public';
import {
  paperLibraryTools,
  type PaperLibraryRecord,
} from '../memory/public';
import { IndexedDbKnowledgeGraphRepository } from './adapters/indexed-db/knowledge-graph-repository.ts';
import {
  loadGraphSnapshot,
  refreshGraphProjection,
  type RefreshGraphResult,
} from './application/graph-service.ts';
import { planPaperCleanup } from './application/paper-cleanup.ts';
import {
  joinKnowledgePaperSources,
  knowledgePaperIds,
  type GraphPaperSource,
} from './application/paper-source.ts';
import { IndexedDbExtractionJobRepository } from './adapters/indexed-db/extraction-job-repository.ts';
import type {
  GraphEdge,
  GraphPaper,
  GraphSnapshot,
  GraphUserNode,
  KnowledgeGraphSettings,
} from './contracts.ts';

export const knowledgeGraphRepository = new IndexedDbKnowledgeGraphRepository();

export interface KnowledgeGraphOverview {
  snapshot: GraphSnapshot;
  settings: KnowledgeGraphSettings;
  refresh: RefreshGraphResult;
}

/**
 * Supplies the personal layer (notes, highlights, folders, tags).
 *
 * Injected because projecting it needs storage access and a document-name to
 * paper-id join, both of which belong to the viewer feature. Absent, the snapshot
 * has no personal nodes.
 */
export type PersonalGraphProvider = (papers: readonly GraphPaper[]) => Promise<{
  nodes: GraphUserNode[];
  edges: GraphEdge[];
}>;

/**
 * How many library records are consulted for bibliographic enrichment.
 *
 * A cap exists in `paperLibraryTools.searchPapers` itself (100), and the enrichment is
 * best-effort by nature: exceeding it costs a document its `year`/`abstract`/`keywords`,
 * which weakens relation recall for that document but never removes it from the graph.
 * Membership is decided by the knowledge base, which has no such cap.
 */
const LIBRARY_ENRICHMENT_LIMIT = 100;

/**
 * The authoritative paper set: the knowledge base, enriched with library metadata.
 *
 * The knowledge base decides *who* is in the graph; the reading history only supplies
 * bibliographic fields. That asymmetry is the whole point — reading a PDF must not put it in
 * the graph, and a knowledge-base deletion must be final.
 */
async function readPaperSources(): Promise<GraphPaperSource[]> {
  const libraryRecords = await paperLibraryTools.searchPapers({ limit: LIBRARY_ENRICHMENT_LIMIT });
  return joinKnowledgePaperSources({
    documents: listKnowledgeDocuments(),
    libraryRecords: libraryRecords as PaperLibraryRecord[],
  });
}

/**
 * Drops the papers the graph is no longer allowed to hold, cascade-style.
 *
 * Allowed = in the knowledge base, and nothing else. Anything else is deleted together with the
 * entities, edges and extraction jobs only it supported.
 */
async function prunePapersOutsideKnowledgeBase(): Promise<string[]> {
  const allowed = knowledgePaperIds(listKnowledgeDocuments());
  const papers = await knowledgeGraphRepository.listPapers();
  return pruneGraphPapers(new Set(
    papers.map((paper) => paper.paperId).filter((paperId) => !allowed.has(paperId)),
  ));
}

/**
 * Single entry point the graph page uses on open: project the knowledge base into the graph,
 * refresh the keyword layer, then load everything renderable.
 *
 * The projection and the cleanup read the same authority in the same pass, so the snapshot can
 * never show a paper the knowledge base no longer has — which is what made a knowledge-base
 * deletion look successful until the next sync brought the paper back.
 */
export async function openKnowledgeGraph(
  personal?: PersonalGraphProvider,
): Promise<KnowledgeGraphOverview> {
  const settings = await knowledgeGraphRepository.readSettings();
  const refresh = await refreshGraphProjection(
    await readPaperSources(),
    knowledgeGraphRepository,
    { keywordLayerEnabled: settings.keywordLayerEnabled },
  );
  await prunePapersOutsideKnowledgeBase();
  const snapshot = await loadGraphSnapshot(knowledgeGraphRepository, {
    keywordLayerEnabled: settings.keywordLayerEnabled,
    personal,
  });
  return { snapshot, settings, refresh };
}

export async function regenerateKeywordLayer(): Promise<RefreshGraphResult> {
  const settings = await knowledgeGraphRepository.readSettings();
  return refreshGraphProjection(
    await readPaperSources(),
    knowledgeGraphRepository,
    { keywordLayerEnabled: settings.keywordLayerEnabled },
  );
}

/**
 * Removes graph papers the knowledge base no longer contains.
 *
 * The full projection sync (`openKnowledgeGraph`) already does this, but it only runs on an
 * explicit "重新同步". A plain load — which is what happens whenever the graph page is revisited
 * — used to read whatever was stored, so emptying the knowledge base left the graph reporting
 * "10 篇文献" with nothing on the canvas. The graph must not outlive the knowledge base it
 * projects.
 *
 * Deliberately narrow: it only deletes, never re-projects, so a plain load stays a read plus at
 * most one cleanup pass. Every deletion goes through `pruneGraphPapers`, which removes the paper,
 * the entities it solely supported and its edges in one transaction (an interrupted cleanup
 * would leave edges whose endpoint is gone), plus the paper's extraction job — a leftover
 * `done` job makes re-adding the same paper skip extraction and show stale candidates.
 */
export async function pruneRemovedGraphPapers(): Promise<string[]> {
  return prunePapersOutsideKnowledgeBase();
}

/** Deletes the given papers (and what only they supported) from the graph. */
async function pruneGraphPapers(paperIds: ReadonlySet<string>): Promise<string[]> {
  const papers = await knowledgeGraphRepository.listPapers();
  const toPrune = papers
    .map((paper) => paper.paperId)
    .filter((paperId) => paperIds.has(paperId));
  if (!toPrune.length) return [];

  const [entities, edges] = await Promise.all([
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const jobRepository = new IndexedDbExtractionJobRepository();
  for (const paperId of toPrune) {
    const plan = planPaperCleanup(paperId, entities, edges);
    await knowledgeGraphRepository.deletePaperCascade(
      paperId,
      plan.entityIdsToDelete,
      plan.edgeIdsToDelete,
    );
    await jobRepository.deleteJobsForPaper(paperId);
  }
  return toPrune;
}

export async function readGraphSnapshot(
  personal?: PersonalGraphProvider,
): Promise<GraphSnapshot> {
  const settings = await knowledgeGraphRepository.readSettings();
  return loadGraphSnapshot(knowledgeGraphRepository, {
    keywordLayerEnabled: settings.keywordLayerEnabled,
    personal,
  });
}
