/**
 * Fitting the whole graph into one exported image.
 *
 * The PNG export has to work from a canvas whose size is not the on-screen size: the page canvas is
 * whatever the window happens to be, at whatever pan and zoom the user left it, and the bitmap must show
 * the **whole** graph rather than the current viewport. So the geometry is planned here, away from the
 * canvas, and it is the only part that needs a test — the drawing itself is the renderer's existing work.
 *
 * Deliberately import-free: this is arithmetic over node positions.
 */

export interface GraphImagePoint {
  x: number;
  y: number;
}

export interface GraphImagePlanOptions {
  /** Cap for the longer side, in CSS pixels. Height follows the graph's aspect ratio. */
  maxSize?: number;
  /** Blank margin around the drawing; must leave room for node radii and any label overhang. */
  padding?: number;
  /** Scales outside this range make the picture either unreadable or absurdly large. */
  minScale?: number;
  maxScale?: number;
}

export interface GraphImagePlan {
  /** CSS-pixel size of the image. The renderer multiplies these by the pixel ratio. */
  width: number;
  height: number;
  scale: number;
  /** Added to a world coordinate, then scaled, gives the pixel coordinate. */
  offsetX: number;
  offsetY: number;
  /** True when there is nothing to draw; callers must not export an empty picture. */
  empty: boolean;
  nodeCount: number;
}

const DEFAULT_MAX_SIZE = 2_400;
const DEFAULT_PADDING = 56;
const DEFAULT_MIN_SCALE = 0.4;
const DEFAULT_MAX_SCALE = 1.6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Computes size, scale and offset for a whole-graph image.
 *
 * A single node still gets a sensible picture rather than a division by zero: both spans are floored at 1
 * world unit, so the scale lands on the maximum instead of infinity.
 */
export function planGraphImage(
  points: readonly GraphImagePoint[],
  options: GraphImagePlanOptions = {},
): GraphImagePlan {
  const maxSize = Math.max(200, options.maxSize ?? DEFAULT_MAX_SIZE);
  const padding = Math.max(0, options.padding ?? DEFAULT_PADDING);
  const minScale = options.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;

  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!usable.length) {
    return {
      width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0, empty: true, nodeCount: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of usable) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const fit = Math.min((maxSize - padding * 2) / spanX, (maxSize - padding * 2) / spanY);
  const scale = clamp(Number.isFinite(fit) && fit > 0 ? fit : minScale, minScale, maxScale);

  return {
    width: Math.min(maxSize, Math.ceil(spanX * scale + padding * 2)),
    height: Math.min(maxSize, Math.ceil(spanY * scale + padding * 2)),
    scale,
    offsetX: padding - minX * scale,
    offsetY: padding - minY * scale,
    empty: false,
    nodeCount: usable.length,
  };
}

/** `pdfpal-knowledge-graph-20261018-1530.png` — sortable, and no characters a file system dislikes. */
export function suggestGraphImageFileName(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `pdfpal-knowledge-graph-${stamp}.png`;
}
