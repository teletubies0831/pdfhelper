/**
 * Returns the vertical ratio used when turning a native text selection into a
 * persistent PDF.js highlight annotation.
 */
export function getSelectionHeightRatio(): number {
  const ratioValue = getComputedStyle(document.documentElement)
    .getPropertyValue("--pdf-selection-height-ratio")
    .trim();
  return Math.min(1, Math.max(0.35, Number.parseFloat(ratioValue) || 0.68));
}

/**
 * Coalesces neighbouring annotation rectangles on the same visual line.
 * Native selection rendering is intentionally left to the browser; this
 * helper is only used to persist PDF.js highlight geometry.
 */
export function mergeHighlightBoxes<
  T extends { x: number; y: number; width: number; height: number },
>(boxes: T[]): T[] {
  const sorted = [...boxes]
    .filter((box) => box.width > 0 && box.height > 0)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const merged: T[] = [];

  for (const box of sorted) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...box });
      continue;
    }

    const previousCenterY = previous.y + previous.height / 2;
    const boxCenterY = box.y + box.height / 2;
    const sameLine =
      Math.abs(previousCenterY - boxCenterY)
      <= Math.max(previous.height, box.height) * 0.65;
    const gap = box.x - (previous.x + previous.width);
    const closeEnough = gap <= Math.max(previous.height, box.height) * 0.9;

    if (!sameLine || !closeEnough) {
      merged.push({ ...box });
      continue;
    }

    const left = Math.min(previous.x, box.x);
    const top = Math.min(previous.y, box.y);
    const right = Math.max(previous.x + previous.width, box.x + box.width);
    const bottom = Math.max(previous.y + previous.height, box.y + box.height);
    previous.x = left;
    previous.y = top;
    previous.width = right - left;
    previous.height = bottom - top;
  }

  return merged.map((box) => {
    const horizontalPadding = box.height * 0.08;
    return {
      ...box,
      x: Math.max(0, box.x - horizontalPadding),
      width: box.width + horizontalPadding * 2,
    };
  });
}
