import type {
  GraphEdge,
  GraphEntity,
  GraphPaper,
} from '../contracts.ts';
import { createEdgeOriginKey, createGraphId } from './graph-identity.ts';

/**
 * Graph condensation for large corpora.
 *
 * Truncation alone is a bad answer to scale: cutting the node list at an arbitrary
 * boundary drops structure the user asked to see, and — because the cap is applied
 * to whatever ordering happens to reach it — it can hide papers behind keyword
 * noise. Condensing first is better, because it removes nodes that carry almost no
 * structure while keeping every paper and every real hub.
 *
 * The rule is **degree**, not type:
 *
 * - A node with degree 1 hangs off exactly one thing. Two hundred such nodes are
 *   two hundred leaves: they make a hairball, and each one individually tells the
 *   reader almost nothing.
 * - A node with degree ≥ 2 is where structure lives — it is what connects two
 *   papers, which is the entire point of the graph.
 *
 * Leaves are folded into one synthetic node per *owner* (the paper or hub they hang
 * from), labelled with the count. The aggregate is honest: it does not claim the
 * leaves are one thing, it says how many were folded and lets the user expand by
 * focusing a node.
 */

export interface CondenseOptions {
  /**
   * Degree at or below which a node may be folded.
   *
   * 1 by default: only true leaves. Raising it folds small clusters, which is a
   * different trade the caller can opt into.
   */
  leafDegree?: number;
  /**
   * Node count above which condensation runs.
   *
   * Below it, nothing is folded: on a small graph every node is worth showing, and
   * folding would hide information the user has room to see.
   *
   * This is the *only* bound. There is deliberately no separate "max leaves per
   * aggregate": an earlier version had one, and it silently truncated 60 leaves to
   * a cap of 40 while still reporting the aggregate as complete — a hidden limit
   * that made the count misleading. If fewer nodes are wanted, that is what
   * `threshold` and `leafDegree` are for.
   */
  threshold?: number;
}

export const DEFAULT_CONDENSE_THRESHOLD = 240;

/** Id prefix for synthetic aggregate nodes, so they are identifiable. */
export const AGGREGATE_NODE_PREFIX = 'aggregate:';

export interface CondensationResult {
  papers: GraphPaper[];
  entities: GraphEntity[];
  edges: GraphEdge[];
  /** How many entities were folded away. */
  foldedEntityCount: number;
  /** How many synthetic aggregate nodes were created. */
  aggregateCount: number;
  /** True when condensation ran at all. */
  condensed: boolean;
}

export function isAggregateNodeId(id: string): boolean {
  return id.startsWith(AGGREGATE_NODE_PREFIX);
}

export function aggregateNodeId(ownerKind: string, ownerId: string): string {
  return `${AGGREGATE_NODE_PREFIX}${ownerKind}:${ownerId}`;
}

/**
 * Degree of every node, counted over the edges given.
 *
 * Counts *edges*, not distinct neighbours: two parallel relations between the same
 * pair are two reasons the node is not a leaf.
 */
export function computeDegree(edges: readonly GraphEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

/**
 * Folds low-degree entities into per-owner aggregate nodes.
 *
 * Papers are never folded: they are the graph's subject, so a paper node exists
 * even when it has degree 1. That asymmetry is the point — the graph is *about*
 * documents, and the user's own material is what they came to navigate.
 */
export function condenseGraph(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
  options: CondenseOptions = {},
): CondensationResult {
  const threshold = options.threshold ?? DEFAULT_CONDENSE_THRESHOLD;
  const leafDegree = options.leafDegree ?? 1;

  const unchanged = (): CondensationResult => ({
    papers: [...papers],
    entities: [...entities],
    edges: [...edges],
    foldedEntityCount: 0,
    aggregateCount: 0,
    condensed: false,
  });

  const totalNodes = papers.length + entities.length;
  if (totalNodes <= threshold) return unchanged();

  const degree = computeDegree(edges);
  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));

  // Candidate leaves: entities at or below the leaf degree. Already-synthetic
  // aggregates are excluded, so condensing an already-condensed graph is stable
  // rather than folding aggregates into aggregates.
  const leaves = entities.filter((entity) => (
    !isAggregateNodeId(entity.entityId)
    && (degree.get(entity.entityId) ?? 0) <= leafDegree
  ));
  if (!leaves.length) return unchanged();

  const leafIds = new Set(leaves.map((entity) => entity.entityId));

  // Owner of a leaf is the single node it hangs from. A leaf with degree 0 has no
  // owner and is dropped: an isolated entity is not connected to anything the
  // graph is showing.
  const ownerByLeafId = new Map<string, { kind: 'paper' | 'entity'; id: string }>();
  for (const edge of edges) {
    const pairs: Array<[string, 'paper' | 'entity', string]> = [];
    // An endpoint is an owner for the other side only when the other side is a
    // paper or an entity; a note or folder cannot own a knowledge entity.
    if (edge.targetKind === 'paper' || edge.targetKind === 'entity') {
      pairs.push([edge.source, edge.targetKind, edge.target]);
    }
    if (edge.sourceKind === 'paper' || edge.sourceKind === 'entity') {
      pairs.push([edge.target, edge.sourceKind, edge.source]);
    }
    for (const [leafId, ownerKind, ownerId] of pairs) {
      if (!leafIds.has(leafId)) continue;
      // Prefer a paper owner when a leaf somehow touches two things: papers are
      // the graph's subject, and grouping under one keeps the aggregate label
      // meaningful.
      const existing = ownerByLeafId.get(leafId);
      if (!existing || ownerKind === 'paper') {
        ownerByLeafId.set(leafId, { kind: ownerKind, id: ownerId });
      }
    }
  }

  const leavesByOwner = new Map<string, string[]>();
  const droppedLeaves = new Set<string>();
  for (const leaf of leaves) {
    const owner = ownerByLeafId.get(leaf.entityId);
    if (!owner) {
      droppedLeaves.add(leaf.entityId);
      continue;
    }
    const key = `${owner.kind}:${owner.id}`;
    const bucket = leavesByOwner.get(key);
    if (bucket) bucket.push(leaf.entityId);
    else leavesByOwner.set(key, [leaf.entityId]);
  }

  const now = Date.now();
  const aggregateEntities: GraphEntity[] = [];
  const aggregateEdges: GraphEdge[] = [];
  const foldedIds = new Set<string>([...droppedLeaves]);
  const foldedByOwnerId = new Map<string, string[]>();

  for (const [ownerKey, leafIdsForOwner] of leavesByOwner) {
    const separator = ownerKey.indexOf(':');
    const ownerKind = ownerKey.slice(0, separator) as 'paper' | 'entity';
    const ownerId = ownerKey.slice(separator + 1);
    const chosen = leafIdsForOwner;
    if (!chosen.length) continue;
    for (const id of chosen) foldedIds.add(id);
    foldedByOwnerId.set(ownerId, chosen);

    const ownerLabel = ownerKind === 'paper'
      ? papers.find((paper) => paper.paperId === ownerId)?.title ?? ownerId
      : entityById.get(ownerId)?.name ?? ownerId;
    const nodeId = aggregateNodeId(ownerKind, ownerId);
    aggregateEntities.push({
      entityId: nodeId,
      name: `${ownerLabel} · 折叠 ${chosen.length} 项`,
      normalizedName: nodeId,
      aliases: [],
      type: 'Concept',
      // Marked confirmed so it renders as structure rather than as a pending
      // suggestion: it is a view artefact, not a candidate awaiting review.
      status: 'confirmed',
      // No confidence: this is not a claim about the world, it is a container.
      confidence: 0,
      sourcePaperId: ownerKind === 'paper' ? ownerId : '',
      evidence: [],
      mergedInto: null,
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    });

    // One edge from the owner to the aggregate, representing every folded relation.
    aggregateEdges.push({
      edgeId: createGraphId('edge'),
      source: ownerId,
      sourceKind: ownerKind,
      target: nodeId,
      targetKind: 'entity',
      type: 'RELATED_TO',
      confidence: 0,
      evidence: [],
      sourcePaperId: ownerKind === 'paper' ? ownerId : null,
      origin: 'rule',
      originKey: createEdgeOriginKey(ownerId, nodeId, 'RELATED_TO', true),
      provenance: {},
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!foldedIds.size) return unchanged();

  const keptEdges = edges.filter(
    (edge) => !foldedIds.has(edge.source) && !foldedIds.has(edge.target),
  );

  return {
    papers: [...papers],
    entities: [
      ...entities.filter((entity) => !foldedIds.has(entity.entityId)),
      ...aggregateEntities,
    ],
    edges: [...keptEdges, ...aggregateEdges],
    foldedEntityCount: foldedIds.size,
    aggregateCount: aggregateEntities.length,
    condensed: true,
  };
}

/** One-line summary of what condensation did, for the graph status line. */
export function describeCondensation(result: CondensationResult): string {
  if (!result.condensed) return '';
  return `已折叠 ${result.foldedEntityCount} 个低连接节点为 ${result.aggregateCount} 组`;
}
