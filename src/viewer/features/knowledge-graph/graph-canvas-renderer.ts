import {
  buildRenderModel,
  confidenceAlpha,
  cullRenderModel,
  dashPatternForOrigin,
  distanceToSegment,
  isDirectedEdgeType,
  showsArrowHead,
  nodeWithinBounds,
  segmentCrossesBounds,
  shouldDrawLabel,
  truncateLabel,
  visibleWorldBounds,
  type CullStats,
  type EdgeOrigin,
  type EdgeType,
  type GraphRenderEdge,
  type GraphRenderModel,
  type GraphRenderNode,
  type WorldBounds,
} from '../../../modules/knowledge-graph/public';
import { planGraphImage } from '../../../modules/knowledge-graph/public';
import type { GraphTheme } from './graph-theme';
import { isPersonalKind, nodeFill } from './graph-theme';
import type { GraphViewport } from './graph-viewport';
export type RenderNode = GraphRenderNode;
export type RenderEdge = GraphRenderEdge;
export type RenderModel = GraphRenderModel;

export interface RenderState {
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  /** Node ids matching the current search, drawn with a highlight ring. */
  matchedNodeIds: ReadonlySet<string>;
  /** Node ids currently hidden by filters, drawn faded. */
  dimmedNodeIds: ReadonlySet<string>;
}

/**
 * What the last frame actually drew, plus what it skipped.
 *
 * Exposed for tests: the canvas has no observable output in a headless run, so
 * "did culling actually happen" would otherwise be unverifiable, and a regression
 * that silently draws everything again is invisible until someone opens a large
 * library.
 */
export interface RenderFrameStats extends CullStats {
  labelsDrawn: number;
  /** Nodes/edges skipped because the viewport does not show them. */
  culled: boolean;
}

export { buildRenderModel, confidenceAlpha, dashPatternForOrigin, distanceToSegment, truncateLabel };

export function strokeStyleForOrigin(origin: EdgeOrigin, theme: GraphTheme): string {
  if (origin === 'ai') return theme.edgeAi;
  if (origin === 'user') return theme.edgeUser;
  return theme.edgeRule;
}

function drawArrow(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = 7;
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(toX, toY);
  context.lineTo(
    toX - size * Math.cos(angle - Math.PI / 7),
    toY - size * Math.sin(angle - Math.PI / 7),
  );
  context.lineTo(
    toX - size * Math.cos(angle + Math.PI / 7),
    toY - size * Math.sin(angle + Math.PI / 7),
  );
  context.closePath();
  context.fill();
  context.restore();
}

const LABEL_FONT = '11px system-ui, "Segoe UI", sans-serif';

/**
 * Opacity multiplier for edges that are not selected.
 *
 * Measured against the screenshot that prompted this: at full alpha the lines were the loudest
 * thing on the canvas. 0.45 keeps the structure visible while letting the nodes win.
 */
const EDGE_QUIET_ALPHA = 0.45;

/**
 * Extra muting for an edge that leads into a shared (multi-paper) entity.
 *
 * The shared nodes are what make a corpus a graph, but they are not what the reader is looking at: the
 * documents are. At the ordinary quiet weight those lines dominated a small canvas and every paper
 * looked like part of one blob. The edge is still there and still clickable — it is just no longer the
 * loudest thing in the picture.
 */
const BRIDGE_EDGE_ALPHA = 0.55;

/** Padding around a caption's text inside its plate. */
const LABEL_PLATE_PADDING_X = 3;
const LABEL_PLATE_PADDING_Y = 1;

/** Zoom at which the derived bridge earns its caption; below this the text is not legible anyway. */
const BRIDGE_LABEL_SCALE = 1.1;

/**
 * Paint order: the user's own markers first, then hubs, then the documents.
 *
 * The graph is *about* the papers, so they are drawn last and stay on top; a sticky
 * note must never hide the document it is attached to.
 */
const DRAW_ORDER_BY_KIND: Record<string, number> = {
  note: 0, highlight: 0, tag: 0, user: 1, folder: 1, entity: 2, paper: 3,
};

export function orderNodesForDrawing(nodes: readonly RenderNode[]): RenderNode[] {
  return [...nodes].sort(
    (left, right) => (DRAW_ORDER_BY_KIND[left.kind] ?? 0) - (DRAW_ORDER_BY_KIND[right.kind] ?? 0),
  );
}

/**
 * Canvas 2D renderer.
 *
 * Deliberately imperative and dependency-free: the extension CSP has no
 * `unsafe-eval`, and every visual rule the graph needs (AI vs rule vs user
 * edges, confidence width, hover and selection rings) is easier to own here
 * than to fight a third-party style system for.
 */
export class GraphCanvasRenderer {
  private context: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private model: RenderModel = {
    nodes: [],
    edges: [],
    nodeById: new Map(),
    bridgeNodeIds: new Set(),
  };
  /**
   * Node draw order, computed when the model is set.
   *
   * Sorting inside `render()` allocated and sorted the whole node array **every
   * frame** — including every pointer-move during a pan — for an order that only
   * changes when the model does.
   */
  private drawOrder: RenderNode[] = [];
  private theme: GraphTheme;
  private viewport: GraphViewport;
  private state: RenderState = {
    hoveredNodeId: null,
    selectedNodeId: null,
    selectedEdgeId: null,
    matchedNodeIds: new Set(),
    dimmedNodeIds: new Set(),
  };
  private devicePixelRatio = 1;
  private lastFrameEdges: readonly RenderEdge[] = [];
  private frameStats: RenderFrameStats = {
    totalNodes: 0,
    totalEdges: 0,
    nodesDrawn: 0,
    edgesDrawn: 0,
    nodesCulled: 0,
    edgesCulled: 0,
    edgesUnresolved: 0,
    fullFrame: true,
    labelsDrawn: 0,
    culled: false,
  };

  constructor(
    canvas: HTMLCanvasElement,
    theme: GraphTheme,
    viewport: GraphViewport,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建知识图谱画布上下文。');
    this.canvas = canvas;
    this.context = context;
    this.theme = theme;
    this.viewport = viewport;
  }

  setTheme(theme: GraphTheme): void {
    this.theme = theme;
  }

  setViewport(viewport: GraphViewport): void {
    this.viewport = viewport;
  }

  setModel(model: RenderModel): void {
    this.model = model;
    this.drawOrder = orderNodesForDrawing(model.nodes);
  }

  setState(state: RenderState): void {
    this.state = state;
  }

  getModel(): RenderModel {
    return this.model;
  }

  /** Draw-call counts for the most recent frame; diagnostics, not UI. */
  getRenderStats(): RenderFrameStats {
    return { ...this.frameStats };
  }

  /**
   * Edge ids the most recent frame drew; diagnostics, not UI.
   *
   * A reference to the list the frame already built, so asking costs nothing on the
   * drawing path — but it is the only way to assert *which* edge survived culling
   * rather than how many.
   */
  getDrawnEdgeIds(): string[] {
    return this.lastFrameEdges.map((item) => item.edge.edgeId);
  }

  /** Applies node positions produced by the layout pass. */
  applyPositions(positions: Map<string, { x: number; y: number }>): void {
    for (const node of this.model.nodes) {
      const point = positions.get(node.id);
      if (point) {
        node.x = point.x;
        node.y = point.y;
      }
    }
  }

  /**
   * Resizes the backing store to the element size times DPR.
   * Returns true when the size actually changed, so callers can skip redraws.
   */
  syncSize(): boolean {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    this.devicePixelRatio = ratio;
    return true;
  }

  render(): void {
    const { context } = this;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = this.theme.background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.scale(this.devicePixelRatio, this.devicePixelRatio);
    this.drawGrid(context);
    context.translate(this.viewport.offsetX, this.viewport.offsetY);
    context.scale(this.viewport.scale, this.viewport.scale);

    // Narrow the frame to what the viewport can actually show. Bounds come from the
    // CSS-pixel size of the canvas, because the viewport transform is expressed in
    // CSS pixels while the backing store is scaled by the device pixel ratio.
    const bounds = visibleWorldBounds(
      this.viewport,
      width / this.devicePixelRatio,
      height / this.devicePixelRatio,
    );
    const culled = cullRenderModel(this.model, bounds);
    this.lastFrameEdges = culled.edges;
    this.frameStats = {
      ...culled.stats,
      labelsDrawn: 0,
      culled: !culled.stats.fullFrame,
    };

    this.drawEdges(context, culled.edges);
    this.drawNodes(context, new Set(culled.nodes.map((node) => node.id)));
    context.restore();
  }

  /**
   * Renders the whole model into a detached canvas, fitted to the image size.
   *
   * The export has to show the *whole* graph, not the current viewport: the page canvas is whatever the window
   * is, at whatever pan and zoom the user left it, so a screenshot of it would crop. The drawing code, though,
   * is exactly the same — it reads `canvas`, `context`, `viewport`, `state` and `devicePixelRatio` off the
   * instance. Those are swapped for the duration of one frame and restored afterwards, which keeps a single
   * implementation of "how a graph looks" instead of a second painter that would drift.
   *
   * The state is neutralised on purpose: a hover ring, a selection or a search highlight belong to the user's
   * pointer, not to a file someone will look at later.
   */
  renderWholeGraphImage(options: { maxSize?: number } = {}): HTMLCanvasElement | null {
    const plan = planGraphImage(
      this.model.nodes.map((node) => ({ x: node.x, y: node.y })),
      options,
    );
    if (plan.empty) return null;

    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(plan.width * ratio));
    target.height = Math.max(1, Math.round(plan.height * ratio));
    const context = target.getContext('2d');
    if (!context) throw new Error('无法创建导出用的画布上下文。');

    const saved = {
      canvas: this.canvas,
      context: this.context,
      viewport: this.viewport,
      state: this.state,
      devicePixelRatio: this.devicePixelRatio,
      lastFrameEdges: this.lastFrameEdges,
      frameStats: this.frameStats,
    };
    this.canvas = target;
    this.context = context;
    this.viewport = { scale: plan.scale, offsetX: plan.offsetX, offsetY: plan.offsetY };
    this.state = {
      hoveredNodeId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      matchedNodeIds: new Set(),
      dimmedNodeIds: new Set(),
    };
    this.devicePixelRatio = ratio;
    try {
      this.render();
    } finally {
      this.canvas = saved.canvas;
      this.context = saved.context;
      this.viewport = saved.viewport;
      this.state = saved.state;
      this.devicePixelRatio = saved.devicePixelRatio;
      this.lastFrameEdges = saved.lastFrameEdges;
      this.frameStats = saved.frameStats;
    }
    return target;
  }

  private drawGrid(context: CanvasRenderingContext2D): void {    const spacing = 32 * this.viewport.scale;
    if (spacing < 14) return;
    const offsetX = this.viewport.offsetX % spacing;
    const offsetY = this.viewport.offsetY % spacing;
    context.save();
    context.strokeStyle = this.theme.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = offsetX; x < this.canvas.width / this.devicePixelRatio; x += spacing) {
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, this.canvas.height / this.devicePixelRatio);
    }
    for (let y = offsetY; y < this.canvas.height / this.devicePixelRatio; y += spacing) {
      context.moveTo(0, Math.round(y) + 0.5);
      context.lineTo(this.canvas.width / this.devicePixelRatio, Math.round(y) + 0.5);
    }
    context.stroke();
    context.restore();
  }

  private drawEdges(context: CanvasRenderingContext2D, edges: readonly RenderEdge[]): void {
    const { state } = this;
    for (const item of edges) {
      const source = this.model.nodeById.get(item.sourceId);
      const target = this.model.nodeById.get(item.targetId);
      if (!source || !target) continue;

      const dimmed = state.dimmedNodeIds.has(source.id)
        || state.dimmedNodeIds.has(target.id);
      const highlighted = state.selectedEdgeId === item.edge.edgeId
        || state.selectedNodeId === source.id
        || state.selectedNodeId === target.id;
      // An edge into a shared entity is deliberately the quietest thing on the canvas. It is the line
      // that ties documents together, and at the same weight as a paper's own methods it made the
      // whole corpus look like one connected lump — the independence of each paper is the message.
      const bridging = this.model.bridgeNodeIds.has(source.id)
        || this.model.bridgeNodeIds.has(target.id);
      const quietAlpha = EDGE_QUIET_ALPHA * (bridging ? BRIDGE_EDGE_ALPHA : 1);

      context.save();
      // Edges are context, not content. At full strength a dozen lines out of one paper read as the
      // subject of the picture, and the nodes they connect became the background.
      context.globalAlpha = dimmed ? 0.08 : confidenceAlpha(item.edge.confidence)
        * (highlighted ? 1 : quietAlpha);
      context.strokeStyle = highlighted
        ? this.theme.edgeHighlight
        : strokeStyleForOrigin(item.edge.origin, this.theme);
      context.lineWidth = highlighted
        ? 2.6
        : 1 + Math.min(1.4, item.edge.confidence * 1.4);
      context.setLineDash(dashPatternForOrigin(item.edge.origin));

      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.stroke();
      context.restore();

      // Undirected types (SIMILAR_TO, RELATED_TO) get no arrow head — and neither does a directed verdict the model
      // never oriented: its endpoints are a database ordering, not a direction.
      if (showsArrowHead(item.edge)) {
        context.save();
        context.globalAlpha = dimmed
          ? 0.08
          : confidenceAlpha(item.edge.confidence) * (highlighted ? 1 : quietAlpha);
        drawArrow(
          context,
          source.x,
          source.y,
          target.x,
          target.y,
          highlighted
            ? this.theme.edgeHighlight
            : strokeStyleForOrigin(item.edge.origin, this.theme),
        );
        context.restore();
      }

      // No relation text on ordinary lines. With a dozen edges leaving one paper the canvas became a
      // wall of `MENTIONS`, drawn *between* the nodes it was labelling, and the type was unreadable at
      // fit-to-view anyway. The relation is read by clicking the edge: the inspector shows it in
      // words. What stays on the canvas is the encoding that works at a glance — colour by origin
      // and dash pattern by rule-vs-ai.
      //
      // The one exception is the derived shared-entity bridge: there are at most a handful of them,
      // and their whole purpose is to be recognised without a click. It is labelled only once the
      // view is zoomed in enough for 10px text to be legible.
      if (item.edge.type === 'SHARED_ENTITIES' && !dimmed && this.viewport.scale >= BRIDGE_LABEL_SCALE) {
        this.drawEdgeCaption(context, 'SHARED_ENTITIES', source, target);
      }
    }
  }

  /** Muted caption on a derived bridge; the only edge text left on the canvas. */
  private drawEdgeCaption(
    context: CanvasRenderingContext2D,
    text: string,
    source: RenderNode,
    target: RenderNode,
  ): void {
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    context.save();
    // The font has to be set *before* measuring: `measureText` uses the current font, so measuring
    // first sized the plate to whatever the previous draw left behind.
    context.font = LABEL_FONT;
    const width = context.measureText(text).width;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = this.theme.labelPlate;
    context.beginPath();
    context.roundRect(
      midX - width / 2 - 3,
      midY - 8,
      width + 6,
      15,
      3,
    );
    context.fill();
    context.fillStyle = this.theme.edgeLabel;
    context.fillText(text, midX, midY);
    context.restore();
  }

  private drawNodes(context: CanvasRenderingContext2D, drawnNodeIds: ReadonlySet<string>): void {
    const { state } = this;
    // Iterating the cached draw order and skipping what the viewport does not show
    // keeps the ordering exact (personal markers and hubs first, documents last, so
    // the nodes the graph is *about* are never hidden) without re-sorting per frame.
    // The per-node cost here is a set lookup; the per-node cost that mattered was the
    // dozen canvas calls, and those are skipped.
    for (const node of this.drawOrder) {
      if (!drawnNodeIds.has(node.id)) continue;
      const dimmed = state.dimmedNodeIds.has(node.id);
      const hovered = state.hoveredNodeId === node.id;
      const selected = state.selectedNodeId === node.id;
      const matched = state.matchedNodeIds.has(node.id);
      const fill = nodeFill(node.kind, this.theme, node.entity?.type);

      context.save();
      context.globalAlpha = dimmed ? 0.2 : 1;

      // Personal nodes are drawn as rounded squares rather than circles: the shape
      // carries "this is the user's own thing" without relying on colour alone,
      // which matters because the graph already uses colour for provenance.
      if (isPersonalKind(node.kind)) {
        const size = node.radius * 1.7;
        context.beginPath();
        context.roundRect(
          node.x - size / 2,
          node.y - size / 2,
          size,
          size,
          Math.max(2, size * 0.25),
        );
        context.fillStyle = fill;
        context.fill();
      } else {
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = fill;
        context.fill();
      }

      context.beginPath();
      if (isPersonalKind(node.kind)) {
        const size = node.radius * 1.7;
        context.roundRect(
          node.x - size / 2,
          node.y - size / 2,
          size,
          size,
          Math.max(2, size * 0.25),
        );
      } else {
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      }
      if (hovered || selected || matched) {
        context.lineWidth = selected ? 3 : 2;
        context.strokeStyle = selected
          ? this.theme.nodeSelected
          : matched
            ? this.theme.nodeMatched
            : this.theme.nodeHover;
      } else {
        context.lineWidth = 1.5;
        context.strokeStyle = this.theme.nodeStroke;
      }
      context.stroke();

      if (node.kind === 'paper') {
        // A small inner dot distinguishes documents from hubs at a glance.
        context.beginPath();
        context.arc(node.x, node.y, Math.max(2, node.radius * 0.3), 0, Math.PI * 2);
        context.fillStyle = this.theme.paperNodeCore;
        context.fill();
      }

      // Captions are the most expensive per-node draw and the first thing to become
      // unreadable as the view zooms out, so the rule lives in the domain layer where
      // it can be tested: papers/entities/folders keep theirs, dense personal markers
      // wait for a readable scale, and far out only hubs are named. Anything the user
      // is pointing at is always labelled.
      const interactive = hovered || selected || matched;
      if (shouldDrawLabel(node, { scale: this.viewport.scale, interactive })) {
        context.font = LABEL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.globalAlpha = dimmed ? 0.25 : 1;
        // Short captions keep the canvas readable; the full name is shown on hover (below) and in
        // the inspector, so nothing is lost — only deferred.
        this.drawLabel(
          context,
          hovered ? node.label.trim() : truncateLabel(node.label),
          node.x,
          node.y + node.radius + 4,
        );
        this.frameStats.labelsDrawn += 1;
      }
      context.restore();
    }
  }

  /**
   * Draws a caption on a translucent plate.
   *
   * Without the plate a label that crossed a line was half unreadable, and with the graph spread out
   * the labels sit in the middle of the tangle rather than at its edge.
   */
  private drawLabel(
    context: CanvasRenderingContext2D,
    text: string,
    centreX: number,
    topY: number,
  ): void {
    const width = context.measureText(text).width;
    const fontSize = 11;
    const paddingX = LABEL_PLATE_PADDING_X / this.viewport.scale;
    const paddingY = LABEL_PLATE_PADDING_Y / this.viewport.scale;
    context.save();
    context.fillStyle = this.theme.labelPlate;
    context.beginPath();
    context.roundRect(
      centreX - width / 2 - paddingX,
      topY - paddingY,
      width + paddingX * 2,
      fontSize + paddingY * 2,
      3,
    );
    context.fill();
    context.fillStyle = this.theme.label;
    context.fillText(text, centreX, topY);
    context.restore();
  }

  /** Converts a pointer event position into world coordinates. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.viewport.offsetX) / this.viewport.scale,
      y: (clientY - rect.top - this.viewport.offsetY) / this.viewport.scale,
    };
  }

  /**
   * Topmost node under the pointer, or null.
   *
   * Only visible nodes are considered: the pointer is on screen, so anything it can
   * hit is on screen too, and scanning the whole model on every pointer move is what
   * made hovering a large graph expensive.
   */
  hitTestNode(clientX: number, clientY: number): RenderNode | null {
    const point = this.screenToWorld(clientX, clientY);
    // Hit radius gets a small constant pad so thin nodes stay clickable.
    const pad = 3 / this.viewport.scale;
    const bounds = this.visibleBounds();
    for (let index = this.drawOrder.length - 1; index >= 0; index -= 1) {
      const node = this.drawOrder[index]!;
      const dx = node.x - point.x;
      const dy = node.y - point.y;
      const radius = node.radius + pad;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (!nodeWithinBounds(node, bounds)) continue;
      return node;
    }
    return null;
  }

  /** Nearest edge within `tolerance` screen pixels of the pointer, or null. */
  hitTestEdge(clientX: number, clientY: number, tolerance = 6): RenderEdge | null {
    const point = this.screenToWorld(clientX, clientY);
    const worldTolerance = tolerance / this.viewport.scale;
    const bounds = this.visibleBounds();
    let best: RenderEdge | null = null;
    let bestDistance = worldTolerance;

    for (const item of this.model.edges) {
      const source = this.model.nodeById.get(item.sourceId);
      const target = this.model.nodeById.get(item.targetId);
      if (!source || !target) continue;
      // Same rule as drawing: an edge that crosses the viewport is clickable even
      // when both of its endpoints are off-screen.
      if (!segmentCrossesBounds(source.x, source.y, target.x, target.y, bounds)) continue;
      const distance = distanceToSegment(
        point.x,
        point.y,
        source.x,
        source.y,
        target.x,
        target.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    return best;
  }

  private visibleBounds(): WorldBounds {
    return visibleWorldBounds(
      this.viewport,
      this.canvas.width / this.devicePixelRatio,
      this.canvas.height / this.devicePixelRatio,
    );
  }
}
