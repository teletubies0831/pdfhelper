import type { GraphEdge, GraphEntity, GraphPaper } from '../contracts.ts';
import { createEdgeOriginKey } from './graph-identity.ts';

/**
 * Papers that share several confirmed entities, drawn as a direct line.
 *
 * Two papers sharing a confirmed entity are already two hops apart in the graph — that is the whole
 * point of the entity layer — but on a canvas of a dozen nodes the two-hop path is invisible: the eye
 * sees a hub with spokes, not "these two documents are about the same thing". A direct line says it.
 *
 * Three rules keep this honest:
 *
 * - **Derived, never stored.** These edges exist only in the render pass; `DERIVED_EDGE_TYPES` marks
 *   them, no repository ever sees one, and they are recomputed from the current entities on every
 *   redraw — so they cannot go stale or leak into an export.
 * - **Only confirmed entities count.** A pending candidate is a suggestion; drawing structure from
 *   suggestions would let the model assert relationships the user never accepted.
 * - **Never on top of a judged pair.** If the pair already carries a conclusion (or a recorded "no
 *   relation"), that record is the better answer and a second line is only clutter.
 */

/** How many shared confirmed entities make two papers worth linking directly. */
export const MIN_SHARED_ENTITIES_FOR_BRIDGE = 2;

export interface SharedEntityBridge {
  edge: GraphEdge;
  sharedEntityIds: string[];
}

/**
 * One bridge edge per qualifying paper pair.
 *
 * `judgedPairKeys` holds the pairs that already have a paper-to-paper conclusion (`relationPairKey`
 * format, i.e. sorted ids joined by `|`); those are skipped.
 */
export function buildSharedEntityBridges(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
  options: {
    minShared?: number;
    judgedPairKeys?: ReadonlySet<string>;
    now?: number;
  } = {},
): SharedEntityBridge[] {
  if (papers.length < 2) return [];
  const minShared = Math.max(1, options.minShared ?? MIN_SHARED_ENTITIES_FOR_BRIDGE);
  const judged = options.judgedPairKeys ?? new Set<string>();
  const now = options.now ?? Date.now();

  const confirmedEntityIds = new Set(
    entities
      .filter((entity) => entity.status === 'confirmed')
      .map((entity) => entity.entityId),
  );
  if (!confirmedEntityIds.size) return [];

  const knownPapers = new Set(papers.map((paper) => paper.paperId));
  // entityId -> papers linked to it, from the stored `paper -> entity` edges.
  const papersByEntity = new Map<string, Set<string>>();
  for (const edge of edges) {
    const paperToEntity = edge.sourceKind === 'paper' && edge.targetKind === 'entity';
    const entityToPaper = edge.sourceKind === 'entity' && edge.targetKind === 'paper';
    if (!paperToEntity && !entityToPaper) continue;
    const entityId = paperToEntity ? edge.target : edge.source;
    const paperId = paperToEntity ? edge.source : edge.target;
    if (!confirmedEntityIds.has(entityId) || !knownPapers.has(paperId)) continue;
    const bucket = papersByEntity.get(entityId);
    if (bucket) bucket.add(paperId);
    else papersByEntity.set(entityId, new Set([paperId]));
  }

  // Sorted pair key -> shared entity ids, so the result does not depend on edge order.
  const sharedByPair = new Map<string, string[]>();
  for (const [entityId, paperIds] of papersByEntity) {
    if (paperIds.size < 2) continue;
    const list = [...paperIds].sort();
    for (let left = 0; left < list.length; left += 1) {
      for (let right = left + 1; right < list.length; right += 1) {
        const key = `${list[left]}|${list[right]}`;
        const bucket = sharedByPair.get(key);
        if (bucket) bucket.push(entityId);
        else sharedByPair.set(key, [entityId]);
      }
    }
  }

  const bridges: SharedEntityBridge[] = [];
  for (const [pairKey, sharedEntityIds] of [...sharedByPair.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (sharedEntityIds.length < minShared) continue;
    if (judged.has(pairKey)) continue;
    const [leftPaperId, rightPaperId] = pairKey.split('|');
    if (!leftPaperId || !rightPaperId) continue;
    const originKey = createEdgeOriginKey(leftPaperId, rightPaperId, 'SHARED_ENTITIES', true);
    bridges.push({
      sharedEntityIds: [...sharedEntityIds].sort(),
      edge: {
        edgeId: `edge:${originKey}`,
        source: leftPaperId,
        sourceKind: 'paper',
        target: rightPaperId,
        targetKind: 'paper',
        type: 'SHARED_ENTITIES',
        // Not a probability: "two shared confirmed entities" is a fact, and the value is what makes
        // the line legible (width scales with confidence) rather than a claim about certainty.
        confidence: 1,
        evidence: [],
        sourcePaperId: leftPaperId,
        origin: 'rule',
        originKey,
        provenance: {},
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  return bridges;
}
