import {
  DEFAULT_KNOWLEDGE_GRAPH_SETTINGS,
  KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  type KnowledgeGraphSettings,
} from '../contracts.ts';
import { normalizeMergeRejections } from './merge-rejection.ts';

/**
 * Settings normalization.
 *
 * Lives in the domain layer, not in the IndexedDB adapter, so the clamping rules
 * are testable without a database and so a corrupt stored record can never
 * produce a broken runtime configuration (a `relationTopK` of 10,000 would turn
 * one "analyse relations" click into an unbounded token spend).
 */function clampThreshold(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function clampCount(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

export function normalizeKnowledgeGraphSettings(
  value: Partial<KnowledgeGraphSettings> | undefined | null,
): KnowledgeGraphSettings {
  const source = value ?? {};
  const embeddingMode = source.embeddingMode === 'local' || source.embeddingMode === 'api'
    ? source.embeddingMode
    : 'off';
  return {
    key: 'knowledge-graph-settings',
    keywordLayerEnabled: source.keywordLayerEnabled !== false,
    autoExtractOnImport: source.autoExtractOnImport === true,
    minConfidenceToAutoCheck: clampThreshold(
      source.minConfidenceToAutoCheck,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.minConfidenceToAutoCheck,
    ),
    entityMergeSimilarityThreshold: clampThreshold(
      source.entityMergeSimilarityThreshold,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.entityMergeSimilarityThreshold,
    ),
    relationTopK: clampCount(
      source.relationTopK,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.relationTopK,
      1,
      20,
    ),
    maximalRecallCandidates: clampCount(
      source.maximalRecallCandidates,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.maximalRecallCandidates,
      5,
      200,
    ),
    maxConcurrentAiRequests: clampCount(
      source.maxConcurrentAiRequests,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.maxConcurrentAiRequests,
      1,
      6,
    ),
    extractionMaxCandidatesPerChunk: clampCount(
      source.extractionMaxCandidatesPerChunk,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.extractionMaxCandidatesPerChunk,
      1,
      50,
    ),
    maxConcurrentExtractionBatches: clampCount(
      source.maxConcurrentExtractionBatches,
      DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.maxConcurrentExtractionBatches,
      1,
      6,
    ),
    embeddingMode,
    ignoredEntityNames: Array.isArray(source.ignoredEntityNames)
      ? source.ignoredEntityNames
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
      : [],
    mergeRejections: normalizeMergeRejections(source.mergeRejections),
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  };
}
