import {
  computeLayout,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutNode,
} from '../../../modules/knowledge-graph/public';
import { layoutWorldSize, zoomAt, type GraphViewport } from './graph-viewport';
import type { GraphCanvasRenderer } from './graph-canvas-renderer';
import type { GraphViewportController } from './graph-viewport-controller';

/**
 * Layout scheduling and viewport framing for the graph canvas.
 *
 * Two rules live here, and both come from the same complaint ("the graph rescales when I resize the window, and dragging it
 * does nothing"):
 *
 * 1. **The layout runs in world coordinates, not screen coordinates.** It used to be computed with the *canvas* width and
 *    height, so the same graph got a different shape every time the window changed — wider window, wider spread. The world
 *    is now a fixed size derived from the node count, and the viewport is what maps it onto the canvas.
 * 2. **Re-layout only when the content changed.** Positions are cached under a model signature (node ids + edge ids), so a
 *    resize, a hover, a filter redraw or a reload with the same content keeps every node exactly where the user left it.
 *
 * The initial fit still happens once after the first layout — fitting on every redraw threw away wherever the user had
 * panned to (see `graph-viewport-controller.ts`).
 */

export interface GraphLayoutRunnerDeps {
  getRenderer(): GraphCanvasRenderer | null;
  viewport(): GraphViewportController;
  /** Canvas size in CSS pixels, used only for zoom anchors, never for the layout itself. */
  canvasSize(): { width: number; height: number };
  /** Above this node count the layout runs a cheap preview pass instead of settling. */
  previewNodeBudget: number;
}

export interface GraphLayoutRunner {
  /** Re-lays out the current model on the next animation frame (a no-op when the content did not change). */
  schedule(): void;
  /** Fits the view; a no-op after the first fit (see `graph-viewport-controller.ts`). */
  fitOnce(): void;
  zoom(factor: number, anchorX?: number, anchorY?: number): void;
  fit(): void;
  /** Re-measures the canvas after a window/workspace change and redraws, without moving the graph. */
  resize(): void;
  /** Forgets the cached positions, so the next `schedule()` runs the force layout again. */
  invalidate(): void;
}

/**
 * Identity of the content being laid out: same nodes and edges, same positions.
 */
function modelSignature(model: {
  nodes: ReadonlyArray<{ id: string }>;
  edges: ReadonlyArray<{ sourceId: string; targetId: string }>;
}): string {
  const nodes = model.nodes.map((node) => node.id).sort().join('|');
  const edges = model.edges.map((edge) => `${edge.sourceId}>${edge.targetId}`).sort().join('|');
  return `${model.nodes.length}:${nodes}#${model.edges.length}:${edges}`;
}

export function createGraphLayoutRunner(deps: GraphLayoutRunnerDeps): GraphLayoutRunner {
  let frame: number | null = null;
  let laidOutSignature = '';
  /** 上次算出的坐标，按节点 id 索引；模型重建后重新套用，而不是重算. */
  let laidOutPositions: Map<string, { x: number; y: number }> = new Map();

  const fitOnce = (): void => {
    deps.viewport().fitOnce(deps.getRenderer()?.getModel().nodes ?? []);
  };

  return {
    schedule() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const renderer = deps.getRenderer();
        if (!renderer) return;
        const model = renderer.getModel();
        if (!model.nodes.length) {
          renderer.render();
          return;
        }
        const signature = modelSignature(model);
        // Same content → reuse the computed positions. This is what makes a window resize (and every redraw) a pure re-frame.
        //
        // The reuse has to *re-apply* them: `buildRenderModel` creates every node at (0,0) and positions are only stamped on
        // afterwards, so a fresh model built by a redraw (selecting a node, changing a filter, a reload) starts collapsed at
        // the origin. Skipping the apply because "the signature did not change" is exactly the bug that made a click collapse
        // the whole graph into one blob.
        if (signature !== laidOutSignature) {
          const { width, height } = layoutWorldSize(model.nodes.length);
          laidOutPositions = computeLayout(
            model.nodes.map((node) => ({
              id: node.id,
              radius: node.radius,
              weight: node.kind === 'paper' ? 1 : 0.4,
              fixed: false,
              // The layout needs to know which nodes are documents: paper-to-paper links are the widest
              // ones, and "touches one paper only" is what makes a node a private satellite.
              kind: node.kind === 'paper' ? 'paper' : node.kind === 'entity' ? 'entity' : 'user',
            } satisfies LayoutNode)),
            model.edges.map((edge) => ({
              source: edge.sourceId,
              target: edge.targetId,
              strength: Math.max(0.4, edge.edge.confidence),
            })),
            {
              ...DEFAULT_LAYOUT_OPTIONS,
              iterations: model.nodes.length > deps.previewNodeBudget
                ? 90
                : DEFAULT_LAYOUT_OPTIONS.iterations,
              width,
              height,
            },
          );
          laidOutSignature = signature;
        }
        if (laidOutPositions.size) renderer.applyPositions(laidOutPositions);
        // The first layout is what makes the node positions real, so the initial fit has to happen here rather than in
        // the load path.
        fitOnce();
        renderer.render();
      });
    },

    fitOnce,

    zoom(factor: number, anchorX?: number, anchorY?: number) {
      if (!deps.getRenderer()) return;
      const { width, height } = deps.canvasSize();
      const viewport: GraphViewport = deps.viewport().get();
      deps.viewport().set(zoomAt(viewport, factor, anchorX ?? width / 2, anchorY ?? height / 2));
    },

    fit() {
      deps.viewport().fit(deps.getRenderer()?.getModel().nodes ?? []);
    },

    resize() {
      const renderer = deps.getRenderer();
      if (!renderer) return;
      // Only the backing store changes: positions are world-space, so nothing moves and the pan/zoom the user chose survives.
      renderer.syncSize();
      renderer.render();
    },

    invalidate() {
      laidOutSignature = '';
      laidOutPositions = new Map();
    },
  };
}
