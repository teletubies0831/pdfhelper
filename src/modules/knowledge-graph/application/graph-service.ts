import type {
  EdgeType,
  GraphEdge,
  GraphEntity,
  GraphPaper,
  GraphSnapshot,
  GraphUserNode,
} from '../contracts.ts';
import type { GraphPaperSource } from './paper-source.ts';
import { syncPaperProjections } from '../domain/paper-projection.ts';
import { shouldWriteProjection } from '../domain/paper-projection-plan.ts';
import {
  buildKeywordEdges,
  buildKeywordEntities,
  findStaleKeywordOriginKeys,
} from './keyword-layer.ts';

export interface RefreshGraphResult {
  papersWritten: number;
  keywordEdgesWritten: number;
  keywordEdgesRemoved: number;
}

/**
 * What a projection refresh needs from storage.
 *
 * Deliberately no `deletePaper`: cleaning up a paper has to go through the cascade in
 * `application/paper-cleanup.ts`, and offering a bare delete here is what let callers strand
 * entities and edges behind a deleted paper.
 */
export interface GraphPersistencePort {
  listPapers(): Promise<GraphPaper[]>;
  putPapers(papers: GraphPaper[]): Promise<void>;
  listEntities(): Promise<GraphEntity[]>;
  listEdges(): Promise<GraphEdge[]>;
  putEdge(edge: GraphEdge): Promise<boolean>;
  deleteEdgesByOriginKeys(originKeys: string[]): Promise<void>;
}

/**
 * Recomputes the graph's paper projection from the authoritative paper sources
 * (see `application/paper-source.ts`) and refreshes the rule-derived keyword layer.
 *
 * Nothing here calls the network: this is the zero-cost path that keeps the
 * graph populated and correct even when the user has not configured an API key.
 *
 * **Deletion is deliberately not this function's job.** Deleting a paper here would remove
 * the paper row and strand the entities and edges that only it supported; the caller runs
 * `pruneGraphPapers` instead, which removes them in one cascade transaction together with the
 * paper's extraction job. `findRemovedPaperIds` reports which papers those are.
 */
export async function refreshGraphProjection(
  sources: GraphPaperSource[],
  repository: GraphPersistencePort,
  options: { keywordLayerEnabled: boolean; now?: number },
): Promise<RefreshGraphResult> {
  const now = options.now ?? Date.now();
  const existingPapers = await repository.listPapers();
  const sync = syncPaperProjections(sources, existingPapers, new Map(), now);

  if (sync.written) {
    const existingByPaperId = new Map(
      existingPapers.map((paper) => [paper.paperId, paper]),
    );
    await repository.putPapers(
      sync.papers.filter((paper) => shouldWriteProjection(
        existingByPaperId.get(paper.paperId),
        paper,
      )),
    );
  }

  let keywordEdgesWritten = 0;
  let keywordEdgesRemoved = 0;
  if (options.keywordLayerEnabled) {
    const existingEdges = await repository.listEdges();
    for (const paper of sync.papers) {
      const stale = findStaleKeywordOriginKeys(paper, existingEdges);
      if (stale.length) {
        await repository.deleteEdgesByOriginKeys(stale);
        keywordEdgesRemoved += stale.length;
      }
      for (const edge of buildKeywordEdges(paper, existingEdges, now)) {
        const written = await repository.putEdge(edge);
        if (written) keywordEdgesWritten += 1;
      }
    }
  }

  return {
    papersWritten: sync.written,
    keywordEdgesWritten,
    keywordEdgesRemoved,
  };
}

export interface GraphSnapshotPort extends GraphPersistencePort {
  listEntities(): Promise<GraphEntity[]>;
  listEdges(): Promise<GraphEdge[]>;
}

/**
 * Assembles the renderable snapshot: stored papers, stored entities plus the
 * synthesised keyword nodes, the user's own material, and the edges that connect
 * them.
 *
 * `personal` is injected rather than read here because projecting the personal
 * graph needs storage access and a document-name to paper-id join, both of which
 * belong to the viewer feature. Absent, the snapshot simply has no personal
 * nodes — a graph with fewer nodes is better than one that invents them.
 */
export async function loadGraphSnapshot(
  repository: GraphSnapshotPort,
  options: {
    keywordLayerEnabled: boolean;
    now?: number;
    personal?: (papers: readonly GraphPaper[]) => Promise<{
      nodes: GraphUserNode[];
      edges: GraphEdge[];
    }>;
  } = { keywordLayerEnabled: true },
): Promise<GraphSnapshot> {
  const [papers, allEntities, storedEdges] = await Promise.all([
    repository.listPapers(),
    repository.listEntities(),
    repository.listEdges(),
  ]);
  // Only entities the graph actually stands behind. `rejected` records are candidates the user
  // refused — they are kept for the statistics report, but they are not nodes: counting them made
  // the canvas report "未连接 4" with nothing to look at. `merged` records are tombstones whose
  // name and edges live on the survivor.
  const storedEntities = allEntities.filter((entity) => (
    entity.status !== 'rejected' && entity.status !== 'merged'
  ));
  const edges = storedEdges;

  const keywordEdges = options.keywordLayerEnabled
    ? edges.filter((edge) => edge.type === 'HAS_KEYWORD')
    : [];
  const keywordEntities = buildKeywordEntities(
    keywordEdges,
    papers,
    options.now ?? Date.now(),
  );
  const visibleEdges = options.keywordLayerEnabled
    ? edges
    : edges.filter((edge) => edge.type !== 'HAS_KEYWORD');

  const personal = options.personal
    ? await options.personal(papers)
    : { nodes: [] as GraphUserNode[], edges: [] as GraphEdge[] };

  const storedEntityIds = new Set(storedEntities.map((entity) => entity.entityId));
  return {
    papers,
    entities: [
      ...storedEntities,
      ...keywordEntities.filter((entity) => !storedEntityIds.has(entity.entityId)),
    ],
    userNodes: personal.nodes,
    edges: [...visibleEdges, ...personal.edges],
  };
}
