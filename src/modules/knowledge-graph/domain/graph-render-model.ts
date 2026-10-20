import type {
  EdgeOrigin,
  GraphEdge,
  GraphEntity,
  GraphPaper,
  GraphUserNode,
} from '../contracts.ts';
import { isUndirectedEdgeType } from '../contracts.ts';
import { buildNodeRoleIndex } from './paper-degree.ts';

/** Paper-paper verdicts whose meaning depends on which way the arrow points. */
const DIRECTIONAL_VERDICT_TYPES = ['CITES', 'EXTENDS', 'IMPROVES'] as const;

/**
 * Pure geometry and visual-encoding rules for the graph canvas.
 *
 * These live in the domain layer (not next to the canvas element) so they can be
 * unit-tested without a DOM: the confidence-to-width mapping and the
 * origin-to-dash mapping are the graph's entire visual trust language, and they
 * are exactly the kind of thing that silently regresses.
 */

export interface GraphRenderNode {
  id: string;
  kind: 'paper' | 'entity' | 'note' | 'highlight' | 'folder' | 'tag' | 'user';
  label: string;
  x: number;
  y: number;
  radius: number;
  confidence: number;
  paper?: GraphPaper;
  entity?: GraphEntity;
  userNode?: GraphUserNode;
}

export interface GraphRenderEdge {
  edge: GraphEdge;
  sourceId: string;
  targetId: string;
}

export interface GraphRenderModel {
  nodes: GraphRenderNode[];
  edges: GraphRenderEdge[];
  nodeById: Map<string, GraphRenderNode>;
  /**
   * Entities that connect two or more papers.
   *
   * Carried on the model rather than recomputed in the renderer so the canvas dims exactly the edges
   * that lead to a shared entity — the ones that hold documents together and therefore must not
   * outshine the documents themselves.
   */
  bridgeNodeIds: Set<string>;
}

export const PAPER_NODE_RADIUS = 14;
export const ENTITY_NODE_RADIUS = 8;
/**
 * Personal nodes are drawn small: they are the user's own annotations, and in a
 * whole-graph view they must not compete visually with the documents and the
 * knowledge hubs that the graph is about.
 */
export const USER_NODE_RADIUS = 6;

/** Confidence drives edge opacity as well as width. */
export function confidenceAlpha(confidence: number): number {
  return 0.35 + Math.min(1, Math.max(0, confidence)) * 0.65;
}

/**
 * Line dash per provenance.
 *
 * Solid means a model actually judged this relationship; dashed means a local
 * rule derived it; dotted means the user asserted it. Without this distinction a
 * "same folder" rule edge looks exactly like an AI conclusion.
 */
export function dashPatternForOrigin(origin: EdgeOrigin): number[] {
  if (origin === 'ai') return [];
  if (origin === 'user') return [2, 4];
  return [7, 6];
}

/**
 * Undirected relationship types are drawn without an arrow head.
 *
 * Delegates to the contract's list instead of repeating two of its three entries: the derived `SHARED_ENTITIES` edge was
 * missing here, so "these two papers mention the same thing" — a symmetric fact whose endpoints are sorted by id — was
 * drawn with an arbitrary arrow.
 */
export function isDirectedEdgeType(type: GraphEdge['type']): boolean {
  return !isUndirectedEdgeType(type);
}

/**
 * Whether the canvas should draw an arrow head on this edge.
 *
 * A `CITES` / `EXTENDS` / `IMPROVES` conclusion only has a direction when the model judged one; the endpoints by
 * themselves are just a database ordering (see `GraphEdge.direction`). An edge with a directed type but no recorded
 * direction is therefore drawn as a plain line — an arrow that is right half the time is worse than no arrow at all.
 */
export function showsArrowHead(edge: GraphEdge): boolean {
  if (!isDirectedEdgeType(edge.type)) return false;
  if (!DIRECTIONAL_VERDICT_TYPES.includes(edge.type as (typeof DIRECTIONAL_VERDICT_TYPES)[number])) return true;
  return Boolean(edge.direction);
}

/**
 * Radius grows sub-linearly with degree so a hub does not swallow the canvas.
 */
export function radiusForDegree(baseRadius: number, degree: number): number {
  if (degree <= 1) return baseRadius;
  return baseRadius + Math.min(12, Math.log2(degree + 1) * 3.2);
}

/**
 * Characters a canvas caption keeps.
 *
 * Lowered from 18 after looking at a real canvas: adjacent long names still ran into each other, and
 * the words that carry the meaning are usually the first two. The full name is one hover away (the
 * renderer draws it untruncated for the hovered node) and is always in the inspector.
 */
const LABEL_MAX_CHARS = 12;

export function truncateLabel(label: string, maxChars = LABEL_MAX_CHARS): string {
  const trimmed = label.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Shortest distance from a point to a line segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function buildRenderModel(
  papers: GraphPaper[],
  entities: GraphEntity[],
  edges: GraphEdge[],
  userNodes: readonly GraphUserNode[] = [],
): GraphRenderModel {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphRenderNode[] = [];
  for (const paper of papers) {
    nodes.push({
      id: paper.paperId,
      kind: 'paper',
      label: paper.title,
      x: 0,
      y: 0,
      radius: radiusForDegree(PAPER_NODE_RADIUS, degree.get(paper.paperId) ?? 0),
      confidence: 1,
      paper,
    });
  }
  for (const entity of entities) {
    nodes.push({
      id: entity.entityId,
      kind: 'entity',
      label: entity.name,
      x: 0,
      y: 0,
      radius: radiusForDegree(ENTITY_NODE_RADIUS, degree.get(entity.entityId) ?? 0),
      confidence: entity.confidence,
      entity,
    });
  }
  for (const userNode of userNodes) {
    nodes.push({
      id: userNode.id,
      kind: userNode.kind,
      label: userNode.label,
      x: 0,
      y: 0,
      radius: radiusForDegree(USER_NODE_RADIUS, degree.get(userNode.id) ?? 0),
      // Personal nodes are assertions, not estimates.
      confidence: 1,
      userNode,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // Endpoint-existence is enforced here so the renderer and the hit-tester can
  // never be handed an edge whose node is missing.
  const renderEdges = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .map((edge) => ({ edge, sourceId: edge.source, targetId: edge.target }));

  // Roles are read from the *drawn* edges, so the dimming matches what is on screen: with the second
  // paper filtered out, an entity is no longer a bridge in the current view.
  const paperIds = new Set(papers.map((paper) => paper.paperId));
  const bridgeNodeIds = buildNodeRoleIndex(
    renderEdges.map((item) => ({ source: item.sourceId, target: item.targetId })),
    paperIds,
  ).bridgeNodeIds;

  return { nodes, edges: renderEdges, nodeById, bridgeNodeIds };
}
