import type { GraphEdge, GraphEntity, GraphPaper } from '../contracts.ts';

/**
 * Removing a paper from the graph.
 *
 * A paper can leave the projection for real reasons: the user deletes the file,
 * the reading record is cleared, or the library is rebuilt. Whatever the cause,
 * leaving its entities, edges and extraction jobs behind produces a graph that
 * claims relationships to a document that no longer exists — and an orphaned
 * `done` job is worse than clutter, because a later re-add of the same paper
 * would silently skip extraction and show stale candidates.
 */

export interface PaperCleanupPort {
  listEntities(): Promise<GraphEntity[]>;
  listEdges(): Promise<GraphEdge[]>;
  deletePaper(paperId: string): Promise<void>;
  deleteEntities(entityIds: string[]): Promise<void>;
  deleteEdges(edgeIds: string[]): Promise<void>;
  /** Drops the paper's extraction jobs so a re-add re-extracts. */
  deleteJobsForPaper(paperId: string): Promise<number>;
}

export interface PaperCleanupResult {
  deletedPaper: boolean;
  deletedEntityIds: string[];
  deletedEdgeIds: string[];
  deletedJobCount: number;
}

/**
 * Plans removal for one paper.
 *
 * Entity deletion is deliberately conservative:
 *
 * - **Only entities this paper is the source of are candidates for deletion.** An
 *   entity whose `sourcePaperId` is another paper is shared knowledge; deleting it
 *   here would destroy relationships the user built.
 * - **An entity kept alive by another paper's edge is never deleted**, even if it
 *   was first extracted from this one. Extraction provenance is not the same as
 *   usage: paper B may confirm an entity paper A introduced, and B is still here.
 *
 * Net effect: removing a paper removes exactly the knowledge that only that paper
 * supported. An entity that survives keeps its `sourcePaperId` pointing at the
 * removed paper, which is historical provenance rather than a live reference —
 * nothing resolves entities by looking up their source paper.
 */
export function planPaperCleanup(
  paperId: string,
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
): {
  entityIdsToDelete: string[];
  edgeIdsToDelete: string[];
  /** Entities of this paper that survive because another paper still uses them. */
  entityIdsRetained: string[];
} {
  // Edges directly attached to the paper are gone regardless.
  const paperEdges = edges.filter(
    (edge) => (edge.sourceKind === 'paper' && edge.source === paperId)
      || (edge.targetKind === 'paper' && edge.target === paperId),
  );
  const edgeIdsToDelete = new Set(paperEdges.map((edge) => edge.edgeId));

  const ownedEntityIds = entities
    .filter((entity) => entity.sourcePaperId === paperId && entity.status !== 'merged')
    .map((entity) => entity.entityId);

  const entityIdsToDelete: string[] = [];
  const entityIdsRetained: string[] = [];
  for (const entityId of ownedEntityIds) {
    // Any surviving edge that touches this entity means another paper still
    // depends on it.
    const stillUsed = edges.some((edge) => (
      !edgeIdsToDelete.has(edge.edgeId)
      && ((edge.sourceKind === 'entity' && edge.source === entityId)
        || (edge.targetKind === 'entity' && edge.target === entityId))
    ));
    if (stillUsed) entityIdsRetained.push(entityId);
    else entityIdsToDelete.push(entityId);
  }

  // Guard, not a routine path: given the retention rule above, every edge into a
  // to-be-deleted entity already belongs to an edge attached to this paper, so it
  // is already scheduled. This loop exists so that a future change to the
  // retention rule cannot silently produce an edge with a missing endpoint, which
  // is the one invariant the renderer relies on.
  for (const edge of edges) {
    const touchesDeletedEntity = entityIdsToDelete.some((entityId) => (
      (edge.sourceKind === 'entity' && edge.source === entityId)
      || (edge.targetKind === 'entity' && edge.target === entityId)
    ));
    if (touchesDeletedEntity) edgeIdsToDelete.add(edge.edgeId);
  }

  return {
    entityIdsToDelete,
    edgeIdsToDelete: [...edgeIdsToDelete],
    entityIdsRetained,
  };
}

export async function removePaperFromGraph(
  paperId: string,
  port: PaperCleanupPort,
): Promise<PaperCleanupResult> {
  const [entities, edges] = await Promise.all([
    port.listEntities(),
    port.listEdges(),
  ]);
  const plan = planPaperCleanup(paperId, entities, edges);

  if (plan.edgeIdsToDelete.length) await port.deleteEdges(plan.edgeIdsToDelete);
  if (plan.entityIdsToDelete.length) await port.deleteEntities(plan.entityIdsToDelete);
  await port.deletePaper(paperId);
  const deletedJobCount = await port.deleteJobsForPaper(paperId);

  return {
    deletedPaper: true,
    deletedEntityIds: plan.entityIdsToDelete,
    deletedEdgeIds: plan.edgeIdsToDelete,
    deletedJobCount,
  };
}

/**
 * Prunes edges whose endpoints no longer exist.
 *
 * A safety net rather than the primary mechanism: the graph's invariant is that
 * every edge endpoint is present, and a partially interrupted cleanup (page
 * closed between two writes) can break it. Cheap to run on refresh, and it turns
 * a corrupt-looking graph into a self-healing one.
 */
export function findDanglingEdgeIds(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
): string[] {
  const paperIds = new Set(papers.map((paper) => paper.paperId));
  const entityIds = new Set(entities.map((entity) => entity.entityId));
  return edges
    .filter((edge) => {
      const sourceExists = edge.sourceKind === 'paper'
        ? paperIds.has(edge.source)
        : entityIds.has(edge.source);
      const targetExists = edge.targetKind === 'paper'
        ? paperIds.has(edge.target)
        : entityIds.has(edge.target);
      return !sourceExists || !targetExists;
    })
    .map((edge) => edge.edgeId);
}
