
















import { viewerElement } from "../../app/viewer-elements";
import { selectionRenderFrame, selectionRenderSettleFrame } from "../../app/viewer-state";







export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}



export function trimSelectionRangeWhitespace(range: Range): Range {
  const trimmed = range.cloneRange();

  // PDF.js text items frequently keep the whitespace beside a word in the
  // same text node. Browsers can retain that whitespace in a double-click
  // range, so remove it before asking the browser for the visual rectangles.
  if (trimmed.startContainer.nodeType === Node.TEXT_NODE) {
    const text = trimmed.startContainer.textContent ?? "";
    let offset = trimmed.startOffset;
    while (offset < text.length && /\s/.test(text.charAt(offset))) {
      offset += 1;
    }
    if (offset !== trimmed.startOffset) {
      trimmed.setStart(trimmed.startContainer, offset);
    }
  }

  if (trimmed.endContainer.nodeType === Node.TEXT_NODE) {
    const text = trimmed.endContainer.textContent ?? "";
    let offset = trimmed.endOffset;
    while (offset > 0 && /\s/.test(text.charAt(offset - 1))) {
      offset -= 1;
    }
    if (offset !== trimmed.endOffset) {
      // Avoid creating an inverted range for selections that contain only
      // whitespace. In that rare case we keep the browser's original range.
      try {
        trimmed.setEnd(trimmed.endContainer, offset);
      } catch {
        return range;
      }
    }
  }

  return trimmed.collapsed ? range : trimmed;
}



export function isPageSizedSelectionArtifact(
  rect: DOMRect,
  pageBounds: DOMRect,
): boolean {
  // Chrome can briefly expose the PDF.js page/text-layer container as an
  // additional range rectangle when a drag selection is being finalized. It
  // is not a selected glyph fragment; accepting it would paint the entire
  // page blue until a later selection update replaces the geometry.
  const overlapWidth = Math.max(
    0,
    Math.min(rect.right, pageBounds.right) - Math.max(rect.left, pageBounds.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(rect.bottom, pageBounds.bottom) - Math.max(rect.top, pageBounds.top),
  );
  const widthCoverage = overlapWidth / Math.max(pageBounds.width, 1);
  const heightCoverage = overlapHeight / Math.max(pageBounds.height, 1);
  return widthCoverage >= 0.9 && heightCoverage >= 0.65;
}



export function clearCustomSelection() {
  document
    .querySelectorAll(".pdf-helper-selection-overlay")
    .forEach((element) => element.remove());
}



export function getSelectionHeightRatio(): number {
  const ratioValue = getComputedStyle(document.documentElement)
    .getPropertyValue("--pdf-selection-height-ratio")
    .trim();
  return Math.min(1, Math.max(0.35, Number.parseFloat(ratioValue) || 0.68));
}



/**
 * Mirrors the browser's selection geometry instead of reconstructing it from
 * individual PDF.js text nodes. A PDF text layer often splits a visual word
 * into several spans; rebuilding ranges from those spans can widen the first
 * or last fragment and can join unrelated lines. `Range#getClientRects()` is
 * the browser's authoritative list of selected visual fragments.
 */
export function collectNativeSelectionRects(
  range: Range,
  pages: readonly HTMLElement[],
): Map<HTMLElement, SelectionRect[]> {
  const visualRange = trimSelectionRangeWhitespace(range);
  const pageBounds = pages.map((page) => ({
    page,
    bounds: page.getBoundingClientRect(),
  }));
  const rectsByPage = new Map<HTMLElement, SelectionRect[]>();

  for (const rect of Array.from(visualRange.getClientRects())) {
    if (rect.width <= 0.5 || rect.height <= 1) continue;

    let matchedPage: HTMLElement | undefined;
    let matchedBounds: DOMRect | undefined;
    let greatestOverlap = 0;
    for (const { page, bounds } of pageBounds) {
      const overlapWidth = Math.max(
        0,
        Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top),
      );
      const overlap = overlapWidth * overlapHeight;
      if (overlap > greatestOverlap) {
        greatestOverlap = overlap;
        matchedPage = page;
        matchedBounds = bounds;
      }
    }
    if (!matchedPage || !matchedBounds) continue;
    if (isPageSizedSelectionArtifact(rect, matchedBounds)) continue;

    const pageRects = rectsByPage.get(matchedPage) ?? [];
    // `getBoundingClientRect()` is expressed in viewport pixels, while an
    // absolutely-positioned child of the page uses the page's local CSS
    // pixels. They normally match, but diverge at some zoom/transform states.
    // Convert explicitly so the custom overlay stays aligned at every zoom.
    const scaleX = matchedPage.clientWidth / matchedBounds.width || 1;
    const scaleY = matchedPage.clientHeight / matchedBounds.height || 1;
    const left = (rect.left - matchedBounds.left) * scaleX;
    const top = (rect.top - matchedBounds.top) * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;
    pageRects.push({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    });
    rectsByPage.set(matchedPage, pageRects);
  }

  return rectsByPage;
}



export function deduplicateSelectionRects(rects: readonly SelectionRect[]) {
  const seen = new Set<string>();
  return rects.filter((rect) => {
    // A range spanning nested text-layer nodes may report an identical visual
    // fragment more than once. Remove only exact (sub-pixel) duplicates; do
    // not merge neighbouring rectangles, because their gap is part of the
    // browser's real selection geometry.
    const key = [rect.left, rect.top, rect.width, rect.height]
      .map((value) => value.toFixed(2))
      .join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}



export function getSelectionOverlayColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--pdf-selection-color")
      .trim() || "rgb(19 75 135 / 22%)"
  );
}



export function drawCustomSelectionRect(
  context: CanvasRenderingContext2D,
  rect: SelectionRect,
  color: string,
) {
  const height = rect.height * getSelectionHeightRatio();
  const top = rect.top + (rect.height - height) / 2;
  // Native PDF text rectangles already include the exact glyph advance. Do
  // not add horizontal "breathing room": on a double-click it looks like the
  // adjacent left/right spaces were selected as well.
  const left = rect.left;
  const width = rect.width;

  // A native Range may include overlapping rectangles for nested PDF.js text
  // spans. Painting the new rectangle after erasing its own area forms a true
  // visual union: overlaps have the same opacity as the rest of the selection,
  // without guessing line baselines or joining unrelated text fragments.
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillRect(left, top, width, height);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = color;
  context.fillRect(left, top, width, height);
  context.restore();
}



function getSelectionRangePages(
  range: Range,
  pages: readonly HTMLElement[],
): readonly HTMLElement[] {
  const getPage = (node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
    return element?.closest<HTMLElement>(".pdfViewer .page") ?? null;
  };
  const startPage = getPage(range.startContainer);
  const endPage = getPage(range.endContainer);
  const startPageNumber = Number(startPage?.dataset.pageNumber);
  const endPageNumber = Number(endPage?.dataset.pageNumber);
  if (
    !Number.isInteger(startPageNumber)
    || !Number.isInteger(endPageNumber)
  ) {
    return pages;
  }

  const firstPageNumber = Math.min(startPageNumber, endPageNumber);
  const lastPageNumber = Math.max(startPageNumber, endPageNumber);
  return pages.filter((page) => {
    const pageNumber = Number(page.dataset.pageNumber);
    return pageNumber >= firstPageNumber && pageNumber <= lastPageNumber;
  });
}

export function renderCustomSelection() {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  ) {
    clearCustomSelection();
    return;
  }

  const pages = Array.from(
    viewerElement.querySelectorAll<HTMLElement>(".pdfViewer .page"),
  );
  const existingOverlays = new Map<HTMLElement, HTMLElement>();
  for (const overlay of Array.from(
    viewerElement.querySelectorAll<HTMLElement>(
      ".pdf-helper-selection-overlay",
    ),
  )) {
    const page = overlay.closest<HTMLElement>(".pdfViewer .page");
    if (page) existingOverlays.set(page, overlay);
    else overlay.remove();
  }
  const rectsByPage = new Map<HTMLElement, SelectionRect[]>();

  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (range.collapsed) continue;

    for (const [page, selectedRects] of collectNativeSelectionRects(
      range,
      getSelectionRangePages(range, pages),
    )) {
      const pageRects = rectsByPage.get(page) ?? [];
      pageRects.push(...selectedRects);
      rectsByPage.set(page, pageRects);
    }
  }

  for (const [page, pageRects] of rectsByPage) {
    let overlay = existingOverlays.get(page);
    let canvas = overlay?.querySelector<HTMLCanvasElement>("canvas") ?? null;
    if (!overlay || !canvas) {
      overlay?.remove();
      overlay = document.createElement("div");
      overlay.className = "pdf-helper-selection-overlay";
      canvas = document.createElement("canvas");
      overlay.append(canvas);
      page.append(overlay);
    }
    existingOverlays.delete(page);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, page.clientWidth);
    const height = Math.max(1, page.clientHeight);
    const canvasWidth = Math.round(width * pixelRatio);
    const canvasHeight = Math.round(height * pixelRatio);
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      overlay.remove();
      continue;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const color = getSelectionOverlayColor();
    for (const rect of deduplicateSelectionRects(pageRects)) {
      drawCustomSelectionRect(context, rect, color);
    }
  }

  for (const overlay of existingOverlays.values()) {
    overlay.remove();
  }
}



export function scheduleCustomSelectionRender() {
  cancelAnimationFrame(selectionRenderFrame.value);
  cancelAnimationFrame(selectionRenderSettleFrame.value);
  // `selectionchange` can fire before Chromium has finished resolving PDF.js
  // text-layer fragments. Wait for the next paint as well so we sample the
  // stable, text-level rectangles instead of that transient container rect.
  selectionRenderFrame.value = requestAnimationFrame(() => {
    selectionRenderFrame.value = 0;
    selectionRenderSettleFrame.value = requestAnimationFrame(() => {
      selectionRenderSettleFrame.value = 0;
      renderCustomSelection();
    });
  });
}



export function mergeHighlightBoxes<
  T extends { x: number; y: number; width: number; height: number },
>(boxes: T[]): T[] {
  const sorted = [...boxes]
    .filter((box) => box.width > 0 && box.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

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
      Math.abs(previousCenterY - boxCenterY) <=
      Math.max(previous.height, box.height) * 0.65;

    const gap = box.x - (previous.x + previous.width);

    const closeEnough = gap <= Math.max(previous.height, box.height) * 0.9;

    if (sameLine && closeEnough) {
      const left = Math.min(previous.x, box.x);
      const top = Math.min(previous.y, box.y);
      const right = Math.max(previous.x + previous.width, box.x + box.width);
      const bottom = Math.max(previous.y + previous.height, box.y + box.height);

      previous.x = left;
      previous.y = top;
      previous.width = right - left;
      previous.height = bottom - top;
    } else {
      merged.push({ ...box });
    }
  }

  return merged.map((box) => {
    const padding = box.height * 0.08;

    return {
      ...box,
      x: Math.max(0, box.x - padding),
      width: box.width + padding * 2,
    };
  });
}
