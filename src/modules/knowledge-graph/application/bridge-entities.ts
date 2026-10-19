import {
  type EdgeType,
  type EntityType,
  type GraphEdge,
  type GraphEntity,
  type GraphEvidence,
} from '../contracts.ts';
import { createGraphId } from '../domain/graph-identity.ts';
import { normalizeEntityName } from '../domain/entity-normalization.ts';
import { clampConfidence, isUndirected } from '../domain/edge-rules.ts';
import { createEdgeOriginKey } from '../domain/graph-identity.ts';
import { mergeEvidence } from './entity-planning.ts';
import { relationPairKey } from './relation-recall.ts';
import type { RelationBridgeSuggestion } from './relation-bridges.ts';

/**
 * Writes for the two things 「分析关系」 can add besides a relation edge.
 *
 * - **Bridge entities**: a concept both papers actually discuss, with a verified quote from each.
 * - **Manual nodes**: the node the user typed after refusing a `NONE` verdict.
 *
 * Both end up in the same place — a confirmed entity with a `MENTIONS` edge to each paper — because
 * that is what the canvas already knows how to draw, and what makes the two papers' connection visible
 * without a second mechanism. What differs is authority: a bridge entity is the model's suggestion that
 * the user ticked, while a manual node is the user's own assertion and must never be second-guessed.
 */

/** Page number used for evidence taken from an abstract or an overview rather than a page. */
export const ABSTRACT_EVIDENCE_PAGE = 0;

export interface BridgeEntityPlan {
  /** Entity records to write (new or newly confirmed). */
  entities: GraphEntity[];
  /** `Paper -> Entity` edges to write. */
  edges: GraphEdge[];
  createdEntityIds: string[];
  reusedEntityIds: string[];
  /** Origin keys to retire before writing (used by the manual path to drop a `NO_RELATION`). */
  dropOriginKeys: string[];
}

function mentionsEdge(
  paperId: string,
  entityId: string,
  confidence: number,
  evidence: GraphEvidence[],
  origin: 'ai' | 'user',
  now: number,
  promptVersion?: string,
): GraphEdge {
  const type: EdgeType = 'MENTIONS';
  const originKey = createEdgeOriginKey(paperId, entityId, type, isUndirected(type));
  return {
    edgeId: createGraphId('edge'),
    source: paperId,
    sourceKind: 'paper',
    target: entityId,
    targetKind: 'entity',
    type,
    confidence: clampConfidence(confidence),
    evidence: mergeEvidence([], evidence),
    sourcePaperId: paperId,
    origin,
    originKey,
    provenance: promptVersion ? { promptVersion } : {},
    createdAt: now,
    updatedAt: now,
  };
}

function evidenceFor(paperId: string, quote: string): GraphEvidence {
  return {
    paperId,
    // No page: the text came from the abstract/overview the model was shown, not from a page of the
    // PDF. 0 is the marker for that, and the inspector renders it as 「摘要」 instead of 「第 0 页」.
    pageNumber: ABSTRACT_EVIDENCE_PAGE,
    quote,
    chunkHeading: '摘要/概览',
  };
}

/** Finds a live entity with this normalized name, preferring a confirmed one. */
function findEntity(
  entities: readonly GraphEntity[],
  normalized: string,
): GraphEntity | undefined {
  const candidates = entities.filter((entity) => (
    entity.status !== 'rejected'
    && entity.status !== 'merged'
    && (entity.normalizedName || normalizeEntityName(entity.name)) === normalized
  ));
  return candidates.find((entity) => entity.status === 'confirmed') ?? candidates[0];
}

/**
 * Plans the entity records for accepted bridge suggestions.
 *
 * Deduplication is by normalized name against the whole store: two pairs proposing `Booth 乘法器` must
 * produce **one** entity connected to three papers, not three entities with one edge each. A suggestion
 * that lands on a pending entity confirms it — the user ticked the row, which is the consent the pending
 * state was waiting for.
 */
export function planBridgeEntityWrites(
  bridges: readonly RelationBridgeSuggestion[],
  entities: readonly GraphEntity[],
  options: { now?: number; promptVersion?: string } = {},
): BridgeEntityPlan {
  const now = options.now ?? Date.now();
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
  const updatedById = new Map<string, GraphEntity>();
  const edges: GraphEdge[] = [];
  const writtenOriginKeys = new Set<string>();
  const createdEntityIds: string[] = [];
  const reusedEntityIds: string[] = [];

  for (const bridge of bridges) {
    const normalized = normalizeEntityName(bridge.name);
    if (!normalized) continue;
    const evidence = bridge.evidence.map((item) => evidenceFor(item.paperId, item.quote));
    const existing = findEntity([...byId.values(), ...updatedById.values()], normalized);

    let entityId: string;
    if (existing) {
      entityId = existing.entityId;
      const confirmed: GraphEntity = {
        ...existing,
        status: 'confirmed',
        confidence: Math.max(existing.confidence, bridge.confidence),
        evidence: mergeEvidence(existing.evidence, evidence),
        updatedAt: now,
      };
      updatedById.set(entityId, confirmed);
      if (!reusedEntityIds.includes(entityId)) reusedEntityIds.push(entityId);
    } else {
      entityId = createGraphId('entity');
      const created: GraphEntity = {
        entityId,
        name: bridge.name,
        normalizedName: normalized,
        aliases: [],
        type: bridge.type,
        status: 'confirmed',
        confidence: clampConfidence(bridge.confidence),
        sourcePaperId: bridge.evidence[0]?.paperId ?? '',
        evidence: mergeEvidence([], evidence),
        mergedInto: null,
        userEdited: false,
        createdAt: now,
        updatedAt: now,
      };
      updatedById.set(entityId, created);
      createdEntityIds.push(entityId);
    }

    for (const item of bridge.evidence) {
      const edge = mentionsEdge(
        item.paperId,
        entityId,
        bridge.confidence,
        [evidenceFor(item.paperId, item.quote)],
        'ai',
        now,
        options.promptVersion,
      );
      if (writtenOriginKeys.has(edge.originKey)) continue;
      writtenOriginKeys.add(edge.originKey);
      edges.push(edge);
    }
  }

  return {
    entities: [...updatedById.values()],
    edges,
    createdEntityIds,
    reusedEntityIds,
    dropOriginKeys: [],
  };
}

export interface ManualBridgeInput {
  /** The pair the user refused to accept as "no relation". */
  pairKey: string;
  name: string;
  type: EntityType;
  /** Optional one-line meaning, stored as the entity's description. */
  description?: string;
}

/**
 * Plans the node the user typed in place of a `NONE` verdict.
 *
 * Two rules the user asked for explicitly:
 * - **No quality gate.** A hand-typed name is authority, not a model suggestion; only an empty name is
 *   refused. Duplicates *are* checked: typing an existing name connects to that entity instead of
 *   creating a twin, which is the only way manual entry can be allowed to be this free.
 * - **The negative verdict is retired.** Leaving `NO_RELATION` in place would have the inspector claim
 *   the two papers are unrelated while the canvas draws a shared entity between them.
 */
export function planManualBridgeWrites(
  input: ManualBridgeInput,
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
  options: { now?: number } = {},
): BridgeEntityPlan & { rejectedReason?: string } {
  const now = options.now ?? Date.now();
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) {
    return {
      entities: [],
      edges: [],
      createdEntityIds: [],
      reusedEntityIds: [],
      dropOriginKeys: [],
      rejectedReason: '请填写节点名称。',
    };
  }
  const normalized = normalizeEntityName(name);
  const existing = findEntity(entities, normalized);
  const updated: GraphEntity[] = [];
  const createdEntityIds: string[] = [];
  const reusedEntityIds: string[] = [];
  let entityId: string;

  if (existing) {
    entityId = existing.entityId;
    updated.push({
      ...existing,
      status: 'confirmed',
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      updatedAt: now,
    });
    reusedEntityIds.push(entityId);
  } else {
    entityId = createGraphId('entity');
    updated.push({
      entityId,
      name,
      normalizedName: normalized,
      aliases: [],
      type: input.type,
      status: 'confirmed',
      // The user asserted it, so the confidence is not an estimate.
      confidence: 1,
      sourcePaperId: '',
      evidence: [],
      mergedInto: null,
      userEdited: true,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    });
    createdEntityIds.push(entityId);
  }

  const [leftPaperId, rightPaperId] = input.pairKey.split('|');
  const mentions: GraphEdge[] = [];
  for (const paperId of [leftPaperId, rightPaperId]) {
    if (!paperId) continue;
    mentions.push(mentionsEdge(paperId, entityId, 1, [], 'user', now));
  }

  const dropOriginKeys = edges
    .filter((edge) => (
      edge.type === 'NO_RELATION'
      && edge.sourceKind === 'paper'
      && edge.targetKind === 'paper'
      && relationPairKey(edge.source, edge.target) === input.pairKey
    ))
    .map((edge) => edge.originKey);

  return {
    entities: updated,
    edges: mentions,
    createdEntityIds,
    reusedEntityIds,
    dropOriginKeys,
  };
}
