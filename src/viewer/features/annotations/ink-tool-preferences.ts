import { AnnotationEditorParamsType } from "pdfjs-dist";

import {
  inkThicknessControl,
  inkThicknessInput,
  inkThicknessValue,
  viewerElement,
} from "../../app/viewer-elements";
import { annotationEditor, pdfViewer } from "../../app/viewer-state";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";
import { closeAnnotationSizePopover } from "./annotation-size-popover";

const INK_THICKNESS_STORAGE_KEY = "pdf-helper-ink-thickness-v1";
const INK_THICKNESS_MIN = 1;
const INK_THICKNESS_MAX = 20;
const INK_THICKNESS_DEFAULT = 3;

let inkCursor: HTMLDivElement | null = null;
let cursorInteractionsInstalled = false;
let thicknessInteractionsInstalled = false;

function getInkCursorDiameter(): number {
  const zoom = Number.isFinite(pdfViewer.currentScale)
    ? pdfViewer.currentScale
    : 1;
  const thickness = Number.parseInt(inkThicknessInput.value, 10);
  return Math.max(4, thickness * zoom);
}

function getInkCursor(): HTMLDivElement {
  if (inkCursor) return inkCursor;
  inkCursor = document.createElement("div");
  inkCursor.className = "pdf-helper-ink-cursor";
  inkCursor.setAttribute("aria-hidden", "true");
  document.body.append(inkCursor);
  return inkCursor;
}

function hideInkCursor(): void {
  if (inkCursor) inkCursor.hidden = true;
}

function updateInkCursor(event: PointerEvent): void {
  const active =
    viewerElement.classList.contains("pdf-helper-ink-mode") &&
    !viewerElement.classList.contains("pdf-helper-ink-eraser-mode");
  const page = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest(".pdfViewer .page");
  if (!active || !page) {
    hideInkCursor();
    return;
  }
  const diameter = getInkCursorDiameter();
  const cursor = getInkCursor();
  cursor.hidden = false;
  cursor.style.setProperty(
    "--pdf-helper-ink-cursor-diameter",
    `${diameter}px`,
  );
  cursor.style.transform = `translate3d(${event.clientX - diameter / 2}px, ${event.clientY - diameter / 2}px, 0)`;
}

export function getInkThickness(): number {
  const stored = Number.parseInt(
    String(
      readJsonValue(
        INK_THICKNESS_STORAGE_KEY,
        Number.parseInt(inkThicknessInput.value, 10),
      ),
    ),
    10,
  );
  return Math.min(
    INK_THICKNESS_MAX,
    Math.max(
      INK_THICKNESS_MIN,
      Number.isFinite(stored) ? stored : INK_THICKNESS_DEFAULT,
    ),
  );
}

export function setInkThickness(thickness: number, persist = true): void {
  const normalized = Math.min(
    INK_THICKNESS_MAX,
    Math.max(INK_THICKNESS_MIN, Math.round(thickness)),
  );
  inkThicknessInput.value = String(normalized);
  inkThicknessValue.value = String(normalized);
  if (persist) {
    try {
      writeJsonValue(INK_THICKNESS_STORAGE_KEY, normalized);
    } catch {
      // The tool must remain usable when extension storage is unavailable.
    }
  }
  // Completed ink is intentionally never selectable. With no selected editor,
  // PDF.js applies this parameter to the next stroke instead of mutating an
  // existing drawing.
  annotationEditor.value?.unselectAll();
  annotationEditor.value?.updateParams(
    AnnotationEditorParamsType.INK_THICKNESS,
    normalized,
  );
}

export function installInkCursorInteractions(): void {
  if (cursorInteractionsInstalled) return;
  cursorInteractionsInstalled = true;
  document.addEventListener("pointermove", updateInkCursor, {
    capture: true,
    passive: true,
  });
  window.addEventListener("blur", hideInkCursor);
}

export function installInkThicknessInteractions(): void {
  if (thicknessInteractionsInstalled) return;
  thicknessInteractionsInstalled = true;
  setInkThickness(getInkThickness(), false);
  inkThicknessInput.addEventListener("input", () => {
    setInkThickness(Number.parseInt(inkThicknessInput.value, 10));
  });
  inkThicknessInput.addEventListener("change", () => {
    closeAnnotationSizePopover(inkThicknessControl);
  });
  installInkCursorInteractions();
}
