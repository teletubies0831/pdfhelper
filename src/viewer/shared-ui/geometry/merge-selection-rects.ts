export interface ClientSelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Combines adjacent browser range rectangles that belong to the same visual
 * line. PDF.js frequently returns one rectangle per text span.
 */
export function mergeSelectionRects<T extends ClientSelectionRect>(rects: T[]): T[] {
  const sorted = [...rects]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const merged: T[] = [];

  for (const rect of sorted) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...rect });
      continue;
    }

    const previousCenter = previous.top + previous.height / 2;
    const currentCenter = rect.top + rect.height / 2;
    const sameLine = Math.abs(previousCenter - currentCenter)
      <= Math.max(previous.height, rect.height) * 0.65;
    const horizontalGap = rect.left - previous.right;
    const closeEnough = horizontalGap <= Math.max(previous.height, rect.height);

    if (!sameLine || !closeEnough) {
      merged.push({ ...rect });
      continue;
    }

    previous.left = Math.min(previous.left, rect.left);
    previous.top = Math.min(previous.top, rect.top);
    previous.right = Math.max(previous.right, rect.right);
    previous.bottom = Math.max(previous.bottom, rect.bottom);
    previous.width = previous.right - previous.left;
    previous.height = previous.bottom - previous.top;
  }

  return merged;
}
