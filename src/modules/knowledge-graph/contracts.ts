/**
 * Knowledge graph contracts.
 *
 * The graph is stored in its own IndexedDB database as plain object stores
 * rather than a graph database: every query the viewer needs (a paper's
 * entities, an entity's papers, a paper's edges, a focus subgraph) is served
 * from an in-memory adjacency index built from these records.
 */

export const KNOWLEDGE_GRAPH_SCHEMA_VERSION = 1;

export const ENTITY_TYPES = [
  'Method',
  'Task',
  'Dataset',
  'Metric',
  'Concept',
  'Claim',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Paper -> Paper, Paper -> Entity and Entity -> Entity relationships are the
 * knowledge-graph layer. `HAS_KEYWORD` is the stage-1 fallback that keeps the
 * graph useful before any AI extraction has run.
 */
export const PAPER_PAPER_EDGE_TYPES = [
  'CITES',
  'EXTENDS',
  'IMPROVES',
  'COMPARES_WITH',
  'SIMILAR_TO',
] as const;

export const PAPER_ENTITY_EDGE_TYPES = [
  'PROPOSES',
  'USES',
  'EVALUATES_ON',
  'REPORTS',
  'MENTIONS',
] as const;

export const ENTITY_ENTITY_EDGE_TYPES = [
  'ALIAS_OF',
  'PART_OF',
  'RELATED_TO',
  'SUBCLASS_OF',
] as const;

export const KEYWORD_EDGE_TYPES = ['HAS_KEYWORD'] as const;

/**
 * Edges the user's own material creates.
 *
 * These are not model output: the user filed the paper, highlighted the sentence,
 * wrote the note. Keeping them in their own group is what lets the UI treat them
 * as one class (`origin: 'user'`) rather than pattern-matching four type strings.
 */
export const USER_EDGE_TYPES = [
  'IN_FOLDER',
  'HIGHLIGHTED',
  'TAGGED',
  'ANNOTATED_AS',
] as const;

/**
 * A recorded negative relationship judgement.
 *
 * Exists because "the model looked and found nothing" is information that must be
 * cached. Without a record for it, `collectJudgedPairKeys` would keep offering
 * the same pair on every run and the user would pay for the same negative answer
 * repeatedly. It is a real edge rather than a side table because it needs the
 * same `originKey` uniqueness and the same cleanup-on-rejudgement path as any
 * other conclusion.
 *
 * Rendered distinctly and normally filtered out: a graph littered with "checked,
 * nothing found" lines would be worse than one that shows nothing at all.
 */
export const NEGATIVE_EDGE_TYPES = ['NO_RELATION'] as const;

/**
 * Edges the canvas derives for itself; **never persisted**.
 *
 * `SHARED_ENTITIES` exists because two papers that share several confirmed entities are visibly
 * related — they are two hops apart through those entities — but on a canvas of a dozen nodes that
 * structure is impossible to see. Drawing it costs nothing: no model call, no stored record, no
 * projection. It is recomputed on every redraw from the current entities, so it can never go stale.
 */
export const DERIVED_EDGE_TYPES = ['SHARED_ENTITIES'] as const;

export const EDGE_TYPES = [
  ...PAPER_PAPER_EDGE_TYPES,
  ...PAPER_ENTITY_EDGE_TYPES,
  ...ENTITY_ENTITY_EDGE_TYPES,
  ...KEYWORD_EDGE_TYPES,
  ...USER_EDGE_TYPES,
  ...NEGATIVE_EDGE_TYPES,
  ...DERIVED_EDGE_TYPES,
] as const;

export type PaperPaperEdgeType = (typeof PAPER_PAPER_EDGE_TYPES)[number];
export type NegativeEdgeType = (typeof NEGATIVE_EDGE_TYPES)[number];
export type PaperEntityEdgeType = (typeof PAPER_ENTITY_EDGE_TYPES)[number];
export type EntityEntityEdgeType = (typeof ENTITY_ENTITY_EDGE_TYPES)[number];
export type UserEdgeType = (typeof USER_EDGE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Undirected types are rendered without an arrow head and are normalised so
 * that `source < target`, which keeps a repeated write hit the same record
 * instead of creating a mirrored duplicate.
 */
export const UNDIRECTED_EDGE_TYPES: readonly EdgeType[] = [
  'SIMILAR_TO',
  'RELATED_TO',
  'SHARED_ENTITIES',
];

/** Where an edge came from. Drives the rendered line style and the inspector copy. */
export type EdgeOrigin = 'ai' | 'rule' | 'user';

/**
 * What a graph node represents.
 *
 * Beyond papers and entities, the personal graph adds the user's own material.
 * These are real node kinds rather than attributes of a paper because the user
 * organises by folder and tag, and "everything I annotated" is a view of the
 * graph rather than a property of any one document.
 */
export type GraphNodeKind =
  | 'paper'
  | 'entity'
  | 'note'
  | 'highlight'
  | 'folder'
  | 'tag'
  /** The single anchor every personal node also connects to. */
  | 'user';

export interface GraphUserNode {
  id: string;
  kind: 'note' | 'highlight' | 'folder' | 'tag' | 'user';
  label: string;
  /** Paper the node belongs to, when it belongs to one. */
  paperId?: string;
  /** Items created before this may be filtered out by the UI. */
  createdAt: number;
}

export interface GraphEvidence {
  /** Paper the quote was taken from. */
  paperId: string;
  pageNumber: number;
  quote: string;
  chunkId?: string;
  chunkHeading?: string;
}

export type ExtractionStatus =
  | 'none'
  | 'queued'
  | 'extracting'
  | 'ready'
  | 'error';

/**
 * Graph-perspective projection of a paper. This is deliberately NOT a second
 * source of truth: bibliographic fields are copied from the document-agent
 * paper library when the graph page opens, and `documentAgentId` is the join
 * key back to the authoritative record.
 */
export interface GraphPaper {
  /** `documentId` from the document-agent library; the graph's paper id. */
  paperId: string;
  documentAgentId: string;
  fingerprint: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string;
  doi: string;
  abstract: string;
  folderId: string | null;
  /** Stage-1 keyword layer, copied from the paper library during projection. */
  keywords: string[];
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  extractedAt: number | null;
  projectionVersion: number;
  createdAt: number;
  updatedAt: number;
}

export type EntityStatus = 'pending' | 'confirmed' | 'rejected' | 'merged';

export interface GraphEntity {
  entityId: string;
  name: string;
  /** Lower-cased, punctuation-stripped form used for exact-match merging. */
  normalizedName: string;
  aliases: string[];
  type: EntityType;
  status: EntityStatus;
  confidence: number;
  sourcePaperId: string;
  evidence: GraphEvidence[];
  /**
   * One short sentence saying what this entity refers to in its paper.
   *
   * Generated when the user confirms the entity into the graph (never by batch extraction, which
   * only proposes candidates) and shown in the inspector. Optional because every entity confirmed
   * before this existed has none, and because a failed model call must leave the record untouched.
   */
  description?: string;
  /** When `description` was last generated; absent on records that never had one. */
  descriptionUpdatedAt?: number | null;
  /** Set when `status === 'merged'`; points at the surviving entity. */
  mergedInto: string | null;
  userEdited: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  edgeId: string;
  source: string;
  sourceKind: GraphNodeKind;
  target: string;
  targetKind: GraphNodeKind;
  type: EdgeType;
  confidence: number;
  evidence: GraphEvidence[];
  sourcePaperId: string | null;
  origin: EdgeOrigin;
  /**
   * Deterministic idempotency key. A unique index on this field is what stops a
   * repeated relationship judgement from spending tokens twice.
   */
  originKey: string;
  provenance: GraphEdgeProvenance;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdgeProvenance {
  model?: string;
  connectionId?: string;
  promptVersion?: string;
  judgedAt?: number;
  /**
   * Set when this edge survived a conflict with other conclusions for the same
   * papers.
   *
   * Recorded because "this conclusion won" is information the user should be able
   * to inspect later — and because without it the next conflict scan would look at
   * the remaining edge and have no way to know it had already been adjudicated.
   */
  resolvedAt?: number;
  resolvedBy?: 'rule' | 'user';
  /** The verdicts this edge superseded, kept as an audit trail. */
  resolvedAgainst?: string;
}

export interface KnowledgeGraphSettings {
  key: 'knowledge-graph-settings';
  /** Stage-1 keyword layer; users can turn it off once entities exist. */
  keywordLayerEnabled: boolean;
  autoExtractOnImport: boolean;
  minConfidenceToAutoCheck: number;
  entityMergeSimilarityThreshold: number;
  relationTopK: number;
  maximalRecallCandidates: number;
  maxConcurrentAiRequests: number;
  /**
   * Hard cap on candidates kept from one extraction response, by confidence.
   *
   * The prompt deliberately states no quota — "at most N" is read as a target, and a target is what
   * fills the list with generic words. The ceiling lives in code as a truncation instead, which
   * still bounds the writes and the review list without inviting padding.
   */
  extractionMaxCandidatesPerChunk: number;
  /**
   * Batches sent to the model at once during extraction. Matches
   * `maxConcurrentAiRequests` by default rather than replacing it, so the graph
   * has one place that limits how hard the provider is pushed.
   */
  maxConcurrentExtractionBatches: number;
  embeddingMode: 'off' | 'local' | 'api';
  ignoredEntityNames: string[];
  /**
   * Entity pairs the user judged to be *different* things.
   *
   * The alignment scorer is a string comparison: `s-XOR` / `b-XOR` score 0.70 because they share
   * three letters, and no threshold separates that from a real misspelling. So the answer has to be
   * remembered, or the same wrong suggestion returns on every open — which is exactly what makes
   * such a dialog unusable after the tenth time.
   *
   * Keys are `mergePairKey(a, b)`; order-independent so a rescan produces the same key.
   */
  mergeRejections: string[];
  schemaVersion: number;
}

export const DEFAULT_KNOWLEDGE_GRAPH_SETTINGS: KnowledgeGraphSettings = {
  key: 'knowledge-graph-settings',
  keywordLayerEnabled: true,
  autoExtractOnImport: false,
  minConfidenceToAutoCheck: 0.75,
  entityMergeSimilarityThreshold: 0.86,
  relationTopK: 5,
  maximalRecallCandidates: 40,
  maxConcurrentAiRequests: 2,
  extractionMaxCandidatesPerChunk: 12,
  maxConcurrentExtractionBatches: 2,
  embeddingMode: 'off',
  ignoredEntityNames: [],
  mergeRejections: [],
  schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
};

/** Full user-visible graph payload, as handed to the renderer. */
export interface GraphSnapshot {
  papers: GraphPaper[];
  entities: GraphEntity[];
  /** The user's own material, projected from notes/highlights/folders/tags. */
  userNodes: GraphUserNode[];
  edges: GraphEdge[];
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string'
    && (ENTITY_TYPES as readonly string[]).includes(value);
}

export function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === 'string'
    && (EDGE_TYPES as readonly string[]).includes(value);
}

export function isUndirectedEdgeType(type: EdgeType): boolean {
  return UNDIRECTED_EDGE_TYPES.includes(type);
}
