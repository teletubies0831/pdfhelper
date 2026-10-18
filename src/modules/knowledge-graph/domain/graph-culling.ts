import {
  ENTITY_NODE_RADIUS,
  PAPER_NODE_RADIUS,
  USER_NODE_RADIUS,
  type GraphRenderEdge,
  type GraphRenderModel,
  type GraphRenderNode,
} from './graph-render-model.ts';

/**
 * Viewport culling and label thinning for the graph canvas.
 *
 * A whole-graph view has to stay responsive when the user's library is large, and
 * the per-frame cost is dominated by draw calls: every node is an arc plus a stroke
 * (plus an inner dot and a caption for documents), and every edge is a
 * save/restore pair, a path and often an arrow head. Drawing what is off-screen is
 * pure waste, so the frame is narrowed to the visible rectangle first.
 *
 * This lives in the domain layer — not next to the canvas element — because the
 * edge rule is the one everybody gets wrong and it is worth unit-testing: **an edge
 * whose endpoints are both outside the viewport must still be drawn when the
 * segment crosses it.** Culling on "both endpoints visible" makes long edges blink
 * out of existence exactly when the user zooms in to follow them.
 */

/** The viewport transform, structurally compatible with the viewer's type. */
export interface CullingViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Captions are drawn below a node with a 4px gap and an 11px font, so the visible
 * box of a node is taller at the bottom than its radius suggests. Ignoring that
 * makes labels pop in and out along the bottom edge.
 */
export const LABEL_BOX_BOTTOM = 18;

/**
 * Below this scale, labels are reserved for hubs: at a glance-level zoom a large
 * graph is a hairball, and thousands of illegible captions cost the most while
 * telling the user the least.
 */
export const LABEL_SCALE_FLOOR = 0.45;

/** Dense personal markers only get captions when the view is close enough to read them. */
export const PERSONAL_LABEL_SCALE_FLOOR = 0.55;

/**
 * Extra radius over the base that makes a node a hub, in the units
 * `radiusForDegree` produces: `log2(degree + 1) * 3.2`, so +6 corresponds to a
 * degree of 3 or more. Tying the label rule to the same curve that sizes the node
 * keeps "big enough to name" and "big enough to see" the same judgement.
 */
export const HUB_RADIUS_BONUS = 6;

/**
 * World-space rectangle that maps to the canvas.
 *
 * The margin is given in **screen** pixels and converted to world units, so the
 * cull band stays visually constant: a fixed world margin would be too small when
 * zoomed in and absurdly large when zoomed out.
 */
/**
 * `-0` and `0` are equal numerically but not under `Object.is`, and a bounds struct
 * that sometimes holds `-0` surprises anything that compares or keys on it (the
 * negative sign survives `JSON.stringify` too). One line here beats debugging that.
 */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function visibleWorldBounds(
  viewport: CullingViewport,
  canvasWidth: number,
  canvasHeight: number,
  marginPixels = 48,
): WorldBounds {
  // A zero or negative scale would divide by zero; the viewer clamps it, but a
  // culling function that returns infinities on bad input is a trap.
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  const margin = marginPixels / scale;
  return {
    minX: normalizeZero(-viewport.offsetX / scale - margin),
    maxX: (canvasWidth - viewport.offsetX) / scale + margin,
    minY: normalizeZero(-viewport.offsetY / scale - margin),
    maxY: (canvasHeight - viewport.offsetY) / scale + margin,
  };
}

export function pointWithinBounds(x: number, y: number, bounds: WorldBounds): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/**
 * True when any part of the node's drawn box is inside the bounds.
 *
 * The box is asymmetric: a node's caption hangs below it, so a node just under the
 * bottom edge still has visible pixels.
 */
export function nodeWithinBounds(
  node: Pick<GraphRenderNode, 'x' | 'y' | 'radius'>,
  bounds: WorldBounds,
): boolean {
  return node.x + node.radius >= bounds.minX
    && node.x - node.radius <= bounds.maxX
    && node.y + node.radius + LABEL_BOX_BOTTOM >= bounds.minY
    && node.y - node.radius <= bounds.maxY;
}

/**
 * True when the segment intersects the rectangle (Liang–Barsky clipping).
 *
 * Slab test on the parametric form: the first early return is only valid for a
 * *point*, so endpoints outside the box prove nothing on their own.
 */
export function segmentCrossesBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bounds: WorldBounds,
): boolean {
  if (pointWithinBounds(x1, y1, bounds) || pointWithinBounds(x2, y2, bounds)) return true;

  let enter = 0;
  let exit = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clips: Array<[number, number]> = [
    [-dx, x1 - bounds.minX],
    [dx, bounds.maxX - x1],
    [-dy, y1 - bounds.minY],
    [dy, bounds.maxY - y1],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      // Parallel to this edge: outside it means the segment misses entirely.
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > exit) return false;
      if (ratio > enter) enter = ratio;
    } else {
      if (ratio < enter) return false;
      if (ratio < exit) exit = ratio;
    }
  }
  return true;
}

/**
 * A node big enough to be named at a glance.
 *
 * Derived from `radiusForDegree`, so this is "degree ≥ 3" rather than an arbitrary
 * size threshold.
 */
export function isHubNode(node: Pick<GraphRenderNode, 'kind' | 'radius'>): boolean {
  const base = baseRadiusFor(node.kind);
  return node.radius >= base + HUB_RADIUS_BONUS;
}

export function baseRadiusFor(kind: GraphRenderNode['kind']): number {
  if (kind === 'paper') return PAPER_NODE_RADIUS;
  if (kind === 'entity') return ENTITY_NODE_RADIUS;
  return USER_NODE_RADIUS;
}

/** Kinds whose captions are worth drawing even when the view is far out. */
const ALWAYS_LABEL_KINDS = new Set(['paper', 'entity', 'folder']);

/**
 * Whether a node's caption is drawn at this scale.
 *
 * Papers, entities and folders keep their captions at any readable zoom; the dense
 * personal markers (notes, highlights, tags, the user anchor) wait until they can
 * actually be read; and far out, only hubs are named. Hover, selection and search
 * matches always win — the user is pointing at that node, so it must be identified.
 */
export function shouldDrawLabel(
  node: Pick<GraphRenderNode, 'kind' | 'radius'>,
  options: { scale: number; interactive?: boolean },
): boolean {
  if (options.interactive) return true;
  if (!ALWAYS_LABEL_KINDS.has(node.kind)) return options.scale > PERSONAL_LABEL_SCALE_FLOOR;
  if (options.scale > LABEL_SCALE_FLOOR) return true;
  return isHubNode(node);
}

export interface CullStats {
  totalNodes: number;
  totalEdges: number;
  nodesDrawn: number;
  edgesDrawn: number;
  /** Nodes dropped because the viewport does not show them. */
  nodesCulled: number;
  /** Edges dropped because the viewport does not show them. */
  edgesCulled: number;
  /**
   * Edges dropped because an endpoint is missing from the model.
   *
   * Counted separately from `edgesCulled` on purpose: this is a broken model, not a
   * viewport decision. Folding the two together would make every frame claim it had
   * culled something whenever one dangling edge existed, which is exactly the signal
   * that tells a caller whether culling is working.
   */
  edgesUnresolved: number;
  /** True when the *viewport* removed nothing, i.e. it already contains the graph. */
  fullFrame: boolean;
}

export interface CulledRenderModel {
  /** Nodes to draw, in the model's order. */
  nodes: GraphRenderNode[];
  /** Edges to draw, in the model's order. */
  edges: GraphRenderEdge[];
  /**
   * **Every** node, not just the visible ones.
   *
   * Deliberately complete: a visible edge can legitimately have an off-screen
   * endpoint (it crosses the viewport), and the renderer resolves both endpoints
   * through this map to draw it. A culled map would silently break exactly the long
   * edges the culling rule exists to preserve.
   */
  nodeById: Map<string, GraphRenderNode>;
  stats: CullStats;
}

/**
 * Narrows a render model to what the viewport can show.
 *
 * Nodes and edges are filtered independently: an edge survives if its segment
 * crosses the visible rectangle, regardless of whether its endpoints do.
 */
export function cullRenderModel(
  model: GraphRenderModel,
  bounds: WorldBounds,
): CulledRenderModel {
  const nodes = model.nodes.filter((node) => nodeWithinBounds(node, bounds));

  const edges: GraphRenderEdge[] = [];
  let edgesCulled = 0;
  let edgesUnresolved = 0;
  for (const edge of model.edges) {
    const source = model.nodeById.get(edge.sourceId);
    const target = model.nodeById.get(edge.targetId);
    if (!source || !target) {
      edgesUnresolved += 1;
      continue;
    }
    if (!segmentCrossesBounds(source.x, source.y, target.x, target.y, bounds)) {
      edgesCulled += 1;
      continue;
    }
    edges.push(edge);
  }

  const nodesCulled = model.nodes.length - nodes.length;
  return {
    nodes,
    edges,
    nodeById: model.nodeById,
    stats: {
      totalNodes: model.nodes.length,
      totalEdges: model.edges.length,
      nodesDrawn: nodes.length,
      edgesDrawn: edges.length,
      nodesCulled,
      edgesCulled,
      edgesUnresolved,
      // Only the viewport decides this: a broken model must not look like culling.
      fullFrame: nodesCulled === 0 && edgesCulled === 0,
    },
  };
}
