import type { GraphCanvasRenderer } from './graph-canvas-renderer';
import type { GraphViewportController } from './graph-viewport-controller';

/**
 * Pointer, wheel and click behaviour for the graph canvas.
 *
 * Split out of the page controller because it is a different reason to change: this
 * file is about *gestures* — how a drag becomes a pan, when a press is a click rather
 * than a drag, what the cursor says — while the page owns what a selection means.
 * Keeping it separate is also what keeps the page under the repo's file-size limit.
 */

/** What the gesture code needs from the page, and nothing more. */
export interface GraphCanvasInteractionPorts {
  /** The renderer, or null before the first load. */
  getRenderer(): GraphCanvasRenderer | null;
  viewport: GraphViewportController;
  /** Scales the view around a point in canvas coordinates. */
  zoom(factor: number, anchorX: number, anchorY: number): void;
  /**
   * Reports what the user clicked.
   *
   * `null` for both means "empty canvas": clearing the inspector is the page's
   * decision, not this file's.
   */
  select(nodeId: string | null, edgeId: string | null): void;
}

/**
 * Distance in CSS pixels below which a press counts as a click.
 *
 * Without this, the tiny movement in every real click was read as a drag and the
 * click was swallowed, which made nodes feel unselectable.
 */
const DRAG_THRESHOLD_PX = 4;

export function registerGraphCanvasInteraction(
  canvas: HTMLCanvasElement,
  ports: GraphCanvasInteractionPorts,
): void {
  let activePointerId: number | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    // One canvas gesture owns the viewport at a time. A second finger must not install a second set of move/up handlers.
    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startViewport = ports.viewport.get();
    const origin = { offsetX: startViewport.offsetX, offsetY: startViewport.offsetY };
    let dragged = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      ports.viewport.set({
        scale: startViewport.scale,
        offsetX: origin.offsetX + dx,
        offsetY: origin.offsetY + dy,
      });
    };

    const cleanup = (): void => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      activePointerId = null;
    };

    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      if (dragged) return;
      handleClick(upEvent.clientX, upEvent.clientY);
    };

    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === event.pointerId) cleanup();
    };

    const onLostPointerCapture = (lostEvent: PointerEvent): void => {
      if (lostEvent.pointerId === event.pointerId) cleanup();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('lostpointercapture', onLostPointerCapture);
  });

  canvas.addEventListener('pointermove', (event) => {
    const renderer = ports.getRenderer();
    if (!renderer) return;
    // Nodes are the only clickable thing, so the cursor is the whole affordance.
    const node = renderer.hitTestNode(event.clientX, event.clientY);
    canvas.style.cursor = node ? 'pointer' : 'grab';
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      // The page must not scroll while the graph zooms; the canvas owns the wheel.
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      ports.zoom(
        event.deltaY < 0 ? 1.12 : 1 / 1.12,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );

  /** Nodes win over edges: a node is drawn on top, so the click looked like a node. */
  function handleClick(clientX: number, clientY: number): void {
    const renderer = ports.getRenderer();
    if (!renderer) return;
    const node = renderer.hitTestNode(clientX, clientY);
    if (node) {
      ports.select(node.id, null);
      return;
    }
    const edge = renderer.hitTestEdge(clientX, clientY);
    if (edge) {
      ports.select(null, edge.edge.edgeId);
      return;
    }
    ports.select(null, null);
  }
}
