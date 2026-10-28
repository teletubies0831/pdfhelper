/**
 * Pan/zoom viewport for the graph canvas.
 *
 * Kept separate from the renderer so the interaction layer and the layout code
 * can reason about coordinates without touching drawing code, and so the
 * clamping rules (which are easy to get subtly wrong) are testable in isolation.
 */

export interface GraphViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const MIN_GRAPH_SCALE = 0.15;
export const MAX_GRAPH_SCALE = 4;

export function createViewport(): GraphViewport {
  return { scale: 1, offsetX: 0, offsetY: 0 };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_GRAPH_SCALE, Math.max(MIN_GRAPH_SCALE, scale));
}

/**
 * Zooms around a screen anchor so the point under the cursor stays put.
 * `anchorX`/`anchorY` are canvas-relative pixel coordinates.
 */
export function zoomAt(
  viewport: GraphViewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): GraphViewport {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;
  const ratio = scale / viewport.scale;
  return {
    scale,
    offsetX: anchorX - (anchorX - viewport.offsetX) * ratio,
    offsetY: anchorY - (anchorY - viewport.offsetY) * ratio,
  };
}

export function panBy(
  viewport: GraphViewport,
  deltaX: number,
  deltaY: number,
): GraphViewport {
  return {
    scale: viewport.scale,
    offsetX: viewport.offsetX + deltaX,
    offsetY: viewport.offsetY + deltaY,
  };
}

export interface FitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 世界坐标尺寸.
 *
 * Grows with the node count so a 10-node graph is not squeezed into a corner and a 300-node graph is not one dense blob — but
 * it deliberately **does not depend on the canvas**, because that dependency is what made resizing the window rearrange the
 * graph. Lives here (not in the layout runner) so the rule is importable by tests without the layout runner's module barrel.
 */
export function layoutWorldSize(nodeCount: number): { width: number; height: number } {
  const clamped = Math.max(1, Math.min(400, nodeCount));
  const size = Math.round(760 + Math.sqrt(clamped) * 120);
  return { width: size, height: Math.round(size * 0.72) };
}

export function boundsOfPoints(
  points: Array<{ x: number; y: number; radius?: number }>,
): FitBounds | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const radius = point.radius ?? 0;
    minX = Math.min(minX, point.x - radius);
    minY = Math.min(minY, point.y - radius);
    maxX = Math.max(maxX, point.x + radius);
    maxY = Math.max(maxY, point.y + radius);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fits the given bounds into the canvas with padding.
 *
 * Labels are drawn below nodes, so the vertical padding is asymmetric: fitting
 * tightly would clip the bottom row's captions.
 */
export function fitViewport(
  bounds: FitBounds | null,
  canvasWidth: number,
  canvasHeight: number,
  padding = 48,
): GraphViewport {
  if (!bounds) return createViewport();
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const available = {
    width: Math.max(1, canvasWidth - padding * 2),
    height: Math.max(1, canvasHeight - padding * 2 - 18),
  };
  const scale = clampScale(Math.min(
    available.width / width,
    available.height / height,
    1.6,
  ));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    offsetX: canvasWidth / 2 - centerX * scale,
    offsetY: (canvasHeight - 18) / 2 - centerY * scale,
  };
}
