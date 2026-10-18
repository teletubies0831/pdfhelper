import {
  computeLayout,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutNode,
} from '../../../modules/knowledge-graph/public';
import { zoomAt, type GraphViewport } from './graph-viewport';
import type { GraphCanvasRenderer } from './graph-canvas-renderer';
import type { GraphViewportController } from './graph-viewport-controller';

/**
 * Layout scheduling and viewport framing for the graph canvas.
 *
 * Split out of the page controller because it is the one part that runs on its own clock: layout is
 * deferred to an animation frame (opening the page must not block the shell's first paint), and the
 * fit-to-view happens exactly once *after* the first real layout. Keeping that timing in one small
 * file is what makes the "never refit on reload" rule auditable.
 */

export interface GraphLayoutRunnerDeps {
  getRenderer(): GraphCanvasRenderer | null;
  viewport(): GraphViewportController;
  /** Canvas size in CSS pixels, with the same fallbacks the layout has always used. */
  canvasSize(): { width: number; height: number };
  /** Above this node count the layout runs a cheap preview pass instead of settling. */
  previewNodeBudget: number;
}

export interface GraphLayoutRunner {
  /** Re-lays out the current model on the next animation frame. */
  schedule(): void;
  /** Fits the view; a no-op after the first fit (see `graph-viewport-controller.ts`). */
  fitOnce(): void;
  zoom(factor: number, anchorX?: number, anchorY?: number): void;
  fit(): void;
}

export function createGraphLayoutRunner(deps: GraphLayoutRunnerDeps): GraphLayoutRunner {
  let frame: number | null = null;

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
        const { width: canvasWidth, height: canvasHeight } = deps.canvasSize();
        const positions = computeLayout(
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
            width: canvasWidth,
            height: canvasHeight,
          },
        );
        renderer.applyPositions(positions);
        // The first layout is what makes the node positions real, so the initial fit has to happen
        // here rather than in the load path.
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
  };
}
