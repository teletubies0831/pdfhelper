import {
  type EdgeType,
  type EntityType,
  type GraphEdge,
  type GraphEntity,
  type GraphEvidence,
} from '../contracts.ts';
import { createEdgeOriginKey, createGraphId } from '../domain/graph-identity.ts';
import { normalizeEntityAliases, normalizeEntityName } from '../domain/entity-normalization.ts';
import { clampConfidence, isUndirected } from '../domain/edge-rules.ts';

/**
 * Pure planning layer for entity confirmation and merging.
 *
 * Everything here computes *what should be written* and touches no database.
 * The repository then applies the result inside one transaction. Two reasons for
 * that split:
 *
 * - Confirmations must be atomic. A user pressing "confirm" must never end up
 *   with entities marked confirmed and no `Paper -> Entity` edge to show for it,
 *   which is exactly what a sequence of independent writes can produce if the
 *   view closes midway.
 * - The rules are the interesting part and are testable without IndexedDB.
 */

export interface AcceptedCandidate {
  /** Display name; may be edited by the user before confirming. */
  name: string;
  type: EntityType;
  confidence: number;
  evidence: GraphEvidence[];
  /** Other spellings carried over from extraction, so the survivor keeps the paper's names. */
  aliases?: string[];
}

export interface PlanContext {
  paperId: string;
  /** Which `Paper -> Entity` relationship the confirmation creates. */
  edgeType?: EdgeType;
  now?: number;
  /** Canonical order for evidence quotes, used to keep writes idempotent. */
  maxEvidencePerEntity?: number;
}

export interface ConfirmationPlan {
  entities: GraphEntity[];
  /** Fully-formed edges including direction, confidence and evidence. */
  edges: GraphEdge[];
  /** `normalizedName -> entityId` for entities touched by this plan. */
  entityIdByNormalizedName: Map<string, string>;
  /** Candidates whose normalized name is already ignored by the user. */
  skippedIgnored: string[];
}

/** Maximum evidence quotes retained per entity, ordered by citation order. */
export const MAX_EVIDENCE_PER_ENTITY = 12;

function evidenceKey(item: GraphEvidence): string {
  return `${item.paperId}|${item.pageNumber}|${item.quote}`;
}

/**
 * Merges evidence lists, de-duplicating and capping.
 *
 * Ordering is deterministic (`paperId`, then page, then quote) rather than
 * insertion-ordered: a re-confirmation after a page reload must produce byte
 * identical evidence arrays, otherwise every write looks like a change.
 */
export function mergeEvidence(
  existing: readonly GraphEvidence[],
  incoming: readonly GraphEvidence[],
  limit = MAX_EVIDENCE_PER_ENTITY,
): GraphEvidence[] {
  const byKey = new Map<string, GraphEvidence>();
  for (const item of [...existing, ...incoming]) {
    if (!item.paperId) continue;
    byKey.set(evidenceKey(item), item);
  }
  return [...byKey.values()]
    .sort((left, right) => (
      left.paperId.localeCompare(right.paperId)
      || left.pageNumber - right.pageNumber
      || left.quote.localeCompare(right.quote)
    ))
    .slice(0, limit);
}

/**
 * Picks the entity that a candidate should land on.
 *
 * Preference order is deliberate: a confirmed entity always wins over a pending
 * one (the user already made that decision), then the one with the most evidence,
 * then the oldest — and finally the id, so the outcome never depends on array
 * order or on `Map` iteration.
 *
 * `merged` records are excluded outright. Landing a candidate on a tombstone
 * would fork the alias chain: the next alignment pass would find the tombstone's
 * name missing from the survivor and could resurrect it as a second entity.
 */
export function pickCanonicalEntity(
  candidates: readonly GraphEntity[],
): GraphEntity | undefined {
  const usable = candidates.filter((entity) => entity.status !== 'merged');
  if (!usable.length) return undefined;
  return [...usable].sort((left, right) => {
    const leftConfirmed = left.status === 'confirmed' ? 1 : 0;
    const rightConfirmed = right.status === 'confirmed' ? 1 : 0;
    if (leftConfirmed !== rightConfirmed) return rightConfirmed - leftConfirmed;
    if (left.evidence.length !== right.evidence.length) {
      return right.evidence.length - left.evidence.length;
    }
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.entityId.localeCompare(right.entityId);
  })[0];
}

/**
 * Builds the plan for confirming a set of extracted candidates.
 *
 * Reuses an existing entity when one already carries the same normalized name,
 * otherwise creates one. Either way the result is a `confirmed` entity plus the
 * paper's edge to it — which is what makes two papers sharing an entity two hops
 * apart and therefore automatically connected.
 */
export function planEntityConfirmation(
  accepted: readonly AcceptedCandidate[],
  existingEntities: readonly GraphEntity[],
  context: PlanContext,
): ConfirmationPlan {
  const now = context.now ?? Date.now();
  const edgeType: EdgeType = context.edgeType ?? 'USES';
  // Keyed by identity, not appended: two candidates in one batch that normalize
  // to the same entity must collapse to ONE write row and ONE edge. Appending
  // would produce two rows for the same entityId and — worse — two edges sharing
  // an `originKey` with different edge ids, which the unique index rejects and
  // would abort the whole confirmation transaction.
  const entityById = new Map<string, GraphEntity>();
  const edgeByOriginKey = new Map<string, GraphEdge>();
  const entityIdByNormalizedName = new Map<string, string>();
  const byNormalizedName = new Map<string, GraphEntity[]>();
  /** Alias key → entities, so a candidate that looks like an abbreviation finds its expansion. */
  const byAliasKey = new Map<string, GraphEntity[]>();

  const indexEntity = (entity: GraphEntity): void => {
    const bucket = byNormalizedName.get(entity.normalizedName);
    if (bucket) bucket.push(entity);
    else byNormalizedName.set(entity.normalizedName, [entity]);
    for (const alias of entity.aliases) {
      const key = normalizeEntityName(alias);
      if (!key) continue;
      const aliasBucket = byAliasKey.get(key);
      if (aliasBucket) aliasBucket.push(entity);
      else byAliasKey.set(key, [entity]);
    }
  };

  for (const entity of existingEntities) {
    // Merged entities are excluded: their edges and aliases live on the survivor.
    if (entity.status === 'merged') continue;
    indexEntity(entity);
  }

  for (const candidate of accepted) {
    const normalized = normalizeEntityName(candidate.name);
    if (!normalized) continue;

    // Look in the *working* set, not the original array: a previous candidate in
    // this same batch may already have created the entity, and reading from the
    // input list would create a twin for a name that appears twice in one
    // response.
    //
    // An exact normalized-name match is the identity rule and always wins. Only when there is none
    // are aliases consulted — either the candidate's own (the paper told us this spelling means that
    // entity) or an existing entity's — because that is the one bridge string similarity cannot
    // build: `BP heuristic` shares almost nothing with `Boyar-Peralta heuristic`.
    const aliasKeys = [normalized, ...(candidate.aliases ?? []).map((alias) => normalizeEntityName(alias))]
      .filter(Boolean);
    const existing = pickCanonicalEntity(byNormalizedName.get(normalized) ?? [])
      ?? pickCanonicalEntity(aliasKeys.flatMap((key) => byAliasKey.get(key) ?? []));
    const evidence = mergeEvidence(existing?.evidence ?? [], candidate.evidence);

    if (existing) {
      const aliases = normalizeEntityAliases([
        ...existing.aliases,
        // Preserve the display variant the model used when it differs from the
        // stored name, so future alignments can match on either spelling.
        ...(existing.name === candidate.name ? [] : [candidate.name]),
        ...(candidate.aliases ?? []),
      ]);
      const updated: GraphEntity = {
        ...existing,
        aliases,
        status: 'confirmed',
        confidence: Math.max(existing.confidence, clampConfidence(candidate.confidence)),
        evidence,
        updatedAt: now,
      };
      entityById.set(updated.entityId, updated);
      byNormalizedName.set(normalized, [updated]);
      entityIdByNormalizedName.set(normalized, updated.entityId);
      indexEntity(updated);
      recordPaperEntityEdge(
        edgeByOriginKey,
        buildPaperEntityEdge(
          context.paperId,
          updated.entityId,
          edgeType,
          updated.confidence,
          evidence,
          now,
        ),
      );
      continue;
    }

    const created: GraphEntity = {
      entityId: createGraphId('entity'),
      name: candidate.name,
      normalizedName: normalized,
      // The paper's other names for this thing, carried over from extraction.
      aliases: normalizeEntityAliases(candidate.aliases ?? []),
      type: candidate.type,
      status: 'confirmed',
      confidence: clampConfidence(candidate.confidence),
      sourcePaperId: context.paperId,
      evidence,
      mergedInto: null,
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    };
    entityById.set(created.entityId, created);
    // Register in the working set so a second candidate with the same normalized
    // name in the same batch lands on this entity instead of creating a twin.
    byNormalizedName.set(normalized, [created]);
    entityIdByNormalizedName.set(normalized, created.entityId);
    indexEntity(created);
    recordPaperEntityEdge(
      edgeByOriginKey,
      buildPaperEntityEdge(
        context.paperId,
        created.entityId,
        edgeType,
        created.confidence,
        evidence,
        now,
      ),
    );
  }

  return {
    entities: [...entityById.values()],
    edges: [...edgeByOriginKey.values()],
    entityIdByNormalizedName,
    skippedIgnored: [],
  };
}

/**
 * Records a planned edge, keeping the first id for a given `originKey`.
 *
 * Re-entering the same key (the same paper re-confirming the same entity) must
 * reuse the original edge id and merge evidence rather than stage a second
 * record — the unique index would reject the duplicate and abort the batch.
 */
function recordPaperEntityEdge(
  target: Map<string, GraphEdge>,
  edge: GraphEdge,
): void {
  const existing = target.get(edge.originKey);
  if (!existing) {
    target.set(edge.originKey, edge);
    return;
  }
  target.set(edge.originKey, {
    ...edge,
    edgeId: existing.edgeId,
    createdAt: existing.createdAt,
    confidence: Math.max(existing.confidence, edge.confidence),
    evidence: mergeEvidence(existing.evidence, edge.evidence),
  });
}

/**
 * Builds a `Paper -> Entity` edge with a deterministic idempotency key.
 *
 * The key is what stops a second confirmation of the same candidate from
 * creating a duplicate edge, and it is decided here (pure) rather than in the
 * repository so the rule is testable.
 */
export function buildPaperEntityEdge(
  paperId: string,
  entityId: string,
  type: EdgeType,
  confidence: number,
  evidence: readonly GraphEvidence[],
  now = Date.now(),
  existing?: GraphEdge,
): GraphEdge {
  const originKey = createEdgeOriginKey(paperId, entityId, type, isUndirected(type));
  const [source, target] = isUndirected(type) && entityId < paperId
    ? [entityId, paperId]
    : [paperId, entityId];
  return {
    edgeId: existing?.edgeId ?? createGraphId('edge'),
    source,
    sourceKind: source === paperId ? 'paper' : 'entity',
    target,
    targetKind: target === paperId ? 'paper' : 'entity',
    type,
    confidence: clampConfidence(confidence),
    evidence: mergeEvidence(existing?.evidence ?? [], evidence),
    sourcePaperId: paperId,
    origin: 'ai',
    originKey,
    provenance: existing?.provenance ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export interface MergeEntityPlan {
  /** Surviving entity, with merged aliases and evidence. */
  keep: GraphEntity;
  /** Tombstone for the absorbed entity; `mergedInto` points at the survivor. */
  absorbed: GraphEntity;
  /** Edges to write (endpoints redirected to the survivor). */
  edges: GraphEdge[];
  /** Origin keys whose existing records must be deleted before the writes. */
  dropOriginKeys: string[];
}

/**
 * Plans folding `mergeEntityId` into `keepEntityId`.
 *
 * Two hazards this handles explicitly:
 * - A redirected edge can collide with an edge that already exists between the
 *   survivor and the same neighbour (`CITES|p1|e1` from both sides). Colliding
 *   keys are dropped from the write set instead of being written, because the
 *   unique `originKey` index would otherwise abort the whole transaction.
 * - The absorbed name becomes an alias of the survivor, so a future extraction
 *   that emits the old spelling lands on the survivor rather than resurrecting
 *   a duplicate.
 */
export function planEntityMerge(
  keepEntityId: string,
  mergeEntityId: string,
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
  now = Date.now(),
): MergeEntityPlan | null {
  const keep = entities.find((entity) => entity.entityId === keepEntityId);
  const merge = entities.find((entity) => entity.entityId === mergeEntityId);
  if (!keep || !merge || keep.entityId === merge.entityId) return null;
  // Refuse to fold into a tombstone; that would orphan the whole chain.
  if (keep.status === 'merged' || merge.status === 'merged') return null;

  const survivor: GraphEntity = {
    ...keep,
    // Confirmed wins, so merging a confirmed entity into a pending one does not
    // silently downgrade it.
    status: keep.status === 'confirmed' || merge.status === 'confirmed'
      ? 'confirmed'
      : keep.status,
    aliases: normalizeEntityAliases([...keep.aliases, merge.name, ...merge.aliases]),
    confidence: Math.max(keep.confidence, merge.confidence),
    evidence: mergeEvidence(keep.evidence, merge.evidence),
    type: keep.type,
    updatedAt: now,
  };

  const absorbed: GraphEntity = {
    ...merge,
    status: 'merged',
    mergedInto: keep.entityId,
    aliases: [],
    updatedAt: now,
  };

  const touched = edges.filter(
    (edge) => edge.source === mergeEntityId || edge.target === mergeEntityId,
  );
  // Keys already occupied by edges that survive untouched.
  const occupied = new Set(
    edges
      .filter((edge) => !touched.includes(edge))
      .map((edge) => edge.originKey),
  );

  const rewritten: GraphEdge[] = [];
  const dropOriginKeys: string[] = [];

  for (const edge of touched) {
    dropOriginKeys.push(edge.originKey);
    const source = edge.source === mergeEntityId ? keep.entityId : edge.source;
    const target = edge.target === mergeEntityId ? keep.entityId : edge.target;
    // A self-loop can appear when both endpoints were the same entity, or when
    // the survivor already sat on the other end. Neither is a real relationship.
    if (source === target) continue;

    const originKey = createEdgeOriginKey(source, target, edge.type, isUndirected(edge.type));
    if (occupied.has(originKey)) continue;
    occupied.add(originKey);

    const [orderedSource, orderedTarget] = isUndirected(edge.type) && target < source
      ? [target, source]
      : [source, target];

    rewritten.push({
      ...edge,
      source: orderedSource,
      sourceKind: orderedSource === keep.entityId ? 'entity' : edge.sourceKind,
      target: orderedTarget,
      targetKind: orderedTarget === keep.entityId ? 'entity' : edge.targetKind,
      originKey,
      updatedAt: now,
    });
  }

  return { keep: survivor, absorbed, edges: rewritten, dropOriginKeys };
}
