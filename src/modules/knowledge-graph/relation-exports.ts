/**
 * Barrel for the two graph features that grew their own modules: bridge concepts and node deletion.
 *
 * Split out of `public.ts` when that file passed the 700-line limit. Re-exported from there, so nothing
 * outside the module imports this path: the architecture check requires cross-feature imports to target
 * `public.ts`, and this file exists only to keep the barrel readable.
 */

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
} from './application/relation-bridges.ts';

export {
  planBridgeEntityWrites,
  planManualBridgeWrites,
  ABSTRACT_EVIDENCE_PAGE,
  type BridgeEntityPlan,
  type ManualBridgeInput,
} from './application/bridge-entities.ts';

export {
  deleteGraphEntity,
  describeEntityDeletion,
  planEntityDeletion,
  type EntityDeletionPlan,
  type EntityDeletionPorts,
  type EntityDeletionRequest,
  type EntityDeletionResult,
} from './application/entity-deletion.ts';

export {
  countEntitiesMissingExplanation,
  describeBulkExplanationResult,
  explainMissingDescriptions,
  MAX_EXPLANATION_ROUNDS,
  type BulkExplanationResult,
} from './application/entity-explanations.ts';
