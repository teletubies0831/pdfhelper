import { boundsOfPoints, fitViewport } from './graph-viewport';
import type { GraphViewport } from './graph-viewport';

/**
 * Where the graph canvas is looking.
 *
 * Split out of the page controller because this is the third time its rules have
 * needed to change (viewport culling, first-layout fitting, keeping the user's
 * position across reloads), and each of those is a rule about *the viewport*, not about
 * rendering the page. Keeping it separate is also what keeps the controller under the
 * repo's file-size limit.
 */
export interface GraphViewportController {
  /** Reads the current viewport. */
  get(): GraphViewport;
  /** Replaces it (used by pan, zoom and fit). */
  set(next: GraphViewport): void;
  /**
   * Fits the laid-out content, but only the first time.
   *
   * Fitting before the layout pass was doubly wrong: the fit was computed against the
   * pre-layout positions (so the canvas could look empty once the layout moved the
   * nodes away), and refitting on every reload threw away wherever the user had panned
   * and zoomed to.
   */
  fitOnce(points: ReadonlyArray<{ x: number; y: number; radius?: number }>): boolean;
  /** Fits unconditionally — the 适应画布 button and explicit requests. */
  fit(points: ReadonlyArray<{ x: number; y: number; radius?: number }>): void;
  /** Marks the view as needing a fresh fit, e.g. after the graph emptied out. */
  invalidate(): void;
}

export function createGraphViewportController(options: {
  initial: GraphViewport;
  /** CSS-pixel size of the canvas. */
  measure: () => { width: number; height: number };
  /** Applies a viewport to the renderer. */
  apply: (viewport: GraphViewport) => void;
}): GraphViewportController {
  let viewport = options.initial;
  let fitted = false;

  const fitBounds = (points: ReadonlyArray<{ x: number; y: number; radius?: number }>) => {
    const { width, height } = options.measure();
    return fitViewport(boundsOfPoints([...points]), width, height);
  };

  return {
    get() {
      return viewport;
    },
    set(next) {
      viewport = next;
      options.apply(viewport);
    },
    fitOnce(points) {
      if (fitted) return false;
      fitted = true;
      viewport = fitBounds(points);
      options.apply(viewport);
      return true;
    },
    fit(points) {
      fitted = true;
      viewport = fitBounds(points);
      options.apply(viewport);
    },
    invalidate() {
      fitted = false;
    },
  };
}
