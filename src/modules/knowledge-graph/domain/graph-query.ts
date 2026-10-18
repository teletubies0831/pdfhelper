import type {
  EdgeType,
  GraphEdge,
  GraphEntity,
  GraphNodeKind,
  GraphPaper,
  GraphUserNode,
} from '../contracts.ts';
import { NEGATIVE_EDGE_TYPES } from '../contracts.ts';

export interface SubgraphFilter {
  edgeTypes?: readonly EdgeType[];
  minConfidence?: number;
}

export interface SubgraphRequest extends SubgraphFilter {
  /** Focus node id (`paperId` or `entityId`). Omit for the whole graph. */
  focusId?: string;
  focusKind?: GraphNodeKind;
  /** How many hops away from the focus to keep. Defaults to 1. */
  hops?: number;
  maxNodes?: number;
}

export interface GraphSubgraph {
  papers: GraphPaper[];
  entities: GraphEntity[];
  /** Personal nodes (notes, highlights, folders, tags, the user anchor). */
  userNodes: GraphUserNode[];
  edges: GraphEdge[];
  /** True when `maxNodes` truncated the result. */
  truncated: boolean;
}

export const DEFAULT_MAX_SUBGRAPH_NODES = 400;

function nodeKey(kind: GraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function edgeEndpoints(edge: GraphEdge): Array<[GraphNodeKind, string]> {
  return [
    [edge.sourceKind, edge.source],
    [edge.targetKind, edge.target],
  ];
}

/**
 * Adjacency index over the graph. Built in memory on demand: the graph is small
 * enough (hundreds to low thousands of records) that a Map beats any persisted
 * index, and it keeps the repository interface trivial.
 */
export function buildAdjacency(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    for (const [kind, id] of edgeEndpoints(edge)) {
      const key = nodeKey(kind, id);
      const bucket = adjacency.get(key);
      if (bucket) bucket.push(edge);
      else adjacency.set(key, [edge]);
    }
  }
  for (const bucket of adjacency.values()) {
    bucket.sort((left, right) => right.confidence - left.confidence);
  }
  return adjacency;
}

/**
 * Edges that must never reach the canvas.
 *
 * A `NO_RELATION` record is a **cache entry**: it exists so the same pair is not paid for twice. It
 * is not a relationship, and drawing it made the graph claim things it had explicitly denied — worse
 * once edge labels were removed, because a negative then looked exactly like a real conclusion.
 */
export function isRenderableEdge(edge: GraphEdge): boolean {
  return !(NEGATIVE_EDGE_TYPES as readonly string[]).includes(edge.type);
}

function edgePassesFilter(edge: GraphEdge, filter: SubgraphFilter): boolean {
  if (!isRenderableEdge(edge)) return false;
  if (filter.edgeTypes && !filter.edgeTypes.includes(edge.type)) return false;
  if (typeof filter.minConfidence === 'number' && edge.confidence < filter.minConfidence) {
    return false;
  }
  return true;
}

/**
 * Breadth-first neighbourhood around a focus node.
 *
 * Two papers that share a confirmed entity are two hops apart through that
 * entity, so this walk alone produces "papers are indirectly connected" without
 * any additional AI judgement and without materialising Paper->Paper edges.
 */
export function buildSubgraph(
  request: SubgraphRequest,
  papers: GraphPaper[],
  entities: GraphEntity[],
  edges: GraphEdge[],
  userNodes: readonly GraphUserNode[] = [],
): GraphSubgraph {
  const passing = edges.filter((edge) => edgePassesFilter(edge, request));
  const papersById = new Map(papers.map((paper) => [paper.paperId, paper]));
  const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const userById = new Map(userNodes.map((node) => [node.id, node]));

  if (!request.focusId || !request.focusKind) {
    // Whole graph: still honour the node cap so a huge store cannot stall the
    // renderer, keeping the highest-confidence edges.
    const maxNodes = request.maxNodes ?? DEFAULT_MAX_SUBGRAPH_NODES;
    const ranked = [...passing].sort(
      (left, right) => right.confidence - left.confidence,
    );
    const keptPapers = new Map<string, GraphPaper>();
    const keptEntities = new Map<string, GraphEntity>();
    const keptUserNodes = new Map<string, GraphUserNode>();
    const keptEdges: GraphEdge[] = [];
    for (const edge of ranked) {
      const keptCount = keptPapers.size + keptEntities.size + keptUserNodes.size;
      if (keptCount >= maxNodes) {
        return finalize(
          keptPapers, keptEntities, keptUserNodes, keptEdges,
          papersById, entitiesById, userById, true,
        );
      }
      collectEndpoint(edge, papersById, entitiesById, userById, keptPapers, keptEntities, keptUserNodes);
      keptEdges.push(edge);
    }
    return finalize(
      keptPapers, keptEntities, keptUserNodes, keptEdges,
      papersById, entitiesById, userById, false,
    );
  }

  const maxNodes = request.maxNodes ?? DEFAULT_MAX_SUBGRAPH_NODES;
  const hops = Math.max(1, Math.min(4, request.hops ?? 1));
  const adjacency = buildAdjacency(passing);

  const visited = new Set<string>([nodeKey(request.focusKind, request.focusId)]);
  let frontier: Array<[GraphNodeKind, string]> = [[request.focusKind, request.focusId]];
  const keptEdges: GraphEdge[] = [];
  const keptEdgeIds = new Set<string>();
  let truncated = false;

  for (let hop = 0; hop < hops; hop += 1) {
    const next: Array<[GraphNodeKind, string]> = [];
    for (const [kind, id] of frontier) {
      for (const edge of adjacency.get(nodeKey(kind, id)) ?? []) {
        if (!keptEdgeIds.has(edge.edgeId)) {
          keptEdgeIds.add(edge.edgeId);
          keptEdges.push(edge);
        }
        for (const [neighbourKind, neighbourId] of edgeEndpoints(edge)) {
          const neighbourKey = nodeKey(neighbourKind, neighbourId);
          if (visited.has(neighbourKey)) continue;
          if (visited.size >= maxNodes) {
            truncated = true;
            continue;
          }
          visited.add(neighbourKey);
          next.push([neighbourKind, neighbourId]);
        }
      }
    }
    if (!next.length) break;
    frontier = next;
  }

  const keptPapers = new Map<string, GraphPaper>();
  const keptEntities = new Map<string, GraphEntity>();
  const keptUserNodes = new Map<string, GraphUserNode>();
  for (const key of visited) {
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator) as GraphNodeKind;
    const id = key.slice(separator + 1);
    if (kind === 'paper') {
      const paper = papersById.get(id);
      if (paper) keptPapers.set(id, paper);
    } else if (kind === 'entity') {
      const entity = entitiesById.get(id);
      if (entity) keptEntities.set(id, entity);
    } else {
      const node = userById.get(id);
      if (node) keptUserNodes.set(id, node);
    }
  }

  return finalize(
    keptPapers, keptEntities, keptUserNodes, keptEdges,
    papersById, entitiesById, userById, truncated,
  );
}

/** Adds the endpoint records an edge refers to, if they exist. */
function collectEndpoint(
  edge: GraphEdge,
  papersById: Map<string, GraphPaper>,
  entitiesById: Map<string, GraphEntity>,
  userById: Map<string, GraphUserNode>,
  keptPapers: Map<string, GraphPaper>,
  keptEntities: Map<string, GraphEntity>,
  keptUserNodes: Map<string, GraphUserNode>,
): void {
  for (const [kind, id] of edgeEndpoints(edge)) {
    if (kind === 'paper') {
      const paper = papersById.get(id);
      if (paper) keptPapers.set(id, paper);
    } else if (kind === 'entity') {
      const entity = entitiesById.get(id);
      if (entity) keptEntities.set(id, entity);
    } else {
      const node = userById.get(id);
      if (node) keptUserNodes.set(id, node);
    }
  }
}

function finalize(
  keptPapers: Map<string, GraphPaper>,
  keptEntities: Map<string, GraphEntity>,
  keptUserNodes: Map<string, GraphUserNode>,
  keptEdges: GraphEdge[],
  papersById: Map<string, GraphPaper>,
  entitiesById: Map<string, GraphEntity>,
  userById: Map<string, GraphUserNode>,
  truncated: boolean,
): GraphSubgraph {
  const visible = (kind: GraphNodeKind, id: string): boolean => {
    if (kind === 'paper') return keptPapers.has(id);
    if (kind === 'entity') return keptEntities.has(id);
    return keptUserNodes.has(id);
  };

  const visibleEdges = keptEdges.filter(
    (edge) => visible(edge.sourceKind, edge.source) && visible(edge.targetKind, edge.target),
  );

  // Backfill endpoint records that survived only because an edge referenced
  // them, so the renderer never draws an edge to a missing node.
  for (const edge of visibleEdges) {
    collectEndpoint(
      edge, papersById, entitiesById, userById, keptPapers, keptEntities, keptUserNodes,
    );
  }

  return {
    papers: [...keptPapers.values()],
    entities: [...keptEntities.values()],
    userNodes: [...keptUserNodes.values()],
    edges: visibleEdges,
    truncated,
  };
}

/**
 * Papers indirectly connected to `paperId` through confirmed shared entities.
 * This is the "shared entity automatically links papers" requirement, computed
 * on read with no LLM involvement.
 */
export function findIndirectlyConnectedPapers(
  paperId: string,
  edges: GraphEdge[],
  minConfidence = 0,
): Array<{ paperId: string; viaEntityIds: string[] }> {
  const adjacency = buildAdjacency(edges.filter((edge) => edge.confidence >= minConfidence));
  const viaByPaperId = new Map<string, Set<string>>();

  for (const edge of adjacency.get(nodeKey('paper', paperId)) ?? []) {
    if (edge.sourceKind !== 'entity' && edge.targetKind !== 'entity') continue;
    const entityId = edge.sourceKind === 'entity' ? edge.source : edge.target;
    for (const entityEdge of adjacency.get(nodeKey('entity', entityId)) ?? []) {
      if (entityEdge.sourceKind !== 'paper' && entityEdge.targetKind !== 'paper') continue;
      const otherPaperId = entityEdge.sourceKind === 'paper'
        ? entityEdge.source
        : entityEdge.target;
      if (otherPaperId === paperId) continue;
      const bucket = viaByPaperId.get(otherPaperId);
      if (bucket) bucket.add(entityId);
      else viaByPaperId.set(otherPaperId, new Set([entityId]));
    }
  }

  return [...viaByPaperId.entries()]
    .map(([otherPaperId, entityIds]) => ({
      paperId: otherPaperId,
      viaEntityIds: [...entityIds],
    }))
    .sort((left, right) => right.viaEntityIds.length - left.viaEntityIds.length);
}
