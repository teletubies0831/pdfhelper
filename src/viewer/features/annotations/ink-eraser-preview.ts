import {
  getInkSvgPath,
  getSurvivingInkPath,
  type InkEraserEntry,
  type InkEraserSession,
} from "./ink-eraser-session";

interface EntryPreview {
  sourcePath: SVGPathElement;
  originalPathData: string | null;
}

const previewByEntry = new WeakMap<InkEraserEntry, EntryPreview>();

function getEntryPreview(entry: InkEraserEntry): EntryPreview | null {
  const existing = previewByEntry.get(entry);
  if (existing) return existing;
  const sourcePath = getInkSvgPath(entry.editor);
  if (!sourcePath) return null;
  const preview: EntryPreview = {
    sourcePath,
    originalPathData: sourcePath.getAttribute("d"),
  };
  previewByEntry.set(entry, preview);
  return preview;
}

function renderEntry(entry: InkEraserEntry): void {
  const preview = getEntryPreview(entry);
  const matrix = preview?.sourcePath.getScreenCTM();
  if (!preview || !matrix) return;
  try {
    const inverse = matrix.inverse();
    preview.sourcePath.setAttribute(
      "d",
      getSurvivingInkPath(entry, (point) => ({
        x: inverse.a * point.x + inverse.c * point.y + inverse.e,
        y: inverse.b * point.x + inverse.d * point.y + inverse.f,
      })),
    );
  } catch {
    // A zoom/page rebuild can briefly invalidate the SVG matrix. The next
    // animation frame or the final PDF.js replacement remains authoritative.
  }
}

export function scheduleInkEraserPreview(
  session: InkEraserSession,
  entries: Iterable<InkEraserEntry>,
): void {
  for (const entry of entries) session.previewDirtyEntries.add(entry);
  if (session.previewFrameId !== null) return;
  session.previewFrameId = requestAnimationFrame(() => {
    session.previewFrameId = null;
    const dirtyEntries = [...session.previewDirtyEntries];
    session.previewDirtyEntries.clear();
    for (const entry of dirtyEntries) renderEntry(entry);
  });
}

export function flushInkEraserPreview(session: InkEraserSession): void {
  if (session.previewFrameId !== null) {
    cancelAnimationFrame(session.previewFrameId);
    session.previewFrameId = null;
  }
  const dirtyEntries = [...session.previewDirtyEntries];
  session.previewDirtyEntries.clear();
  for (const entry of dirtyEntries) renderEntry(entry);
}

export function clearInkEraserPreview(session: InkEraserSession): void {
  if (session.previewFrameId !== null) {
    cancelAnimationFrame(session.previewFrameId);
    session.previewFrameId = null;
  }
  session.previewDirtyEntries.clear();
  for (const entry of session.entries) {
    const preview = previewByEntry.get(entry);
    if (!preview) continue;
    if (preview.sourcePath.isConnected) {
      if (preview.originalPathData === null) {
        preview.sourcePath.removeAttribute("d");
      } else {
        preview.sourcePath.setAttribute("d", preview.originalPathData);
      }
    }
    previewByEntry.delete(entry);
  }
}
