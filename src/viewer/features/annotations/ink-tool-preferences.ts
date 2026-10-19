import { AnnotationEditorParamsType } from "pdfjs-dist";

import {
  inkColorButtons,
  inkColorInput,
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

/**
 * The pen's colour, remembered like its thickness.
 *
 * The highlighter has offered a colour picker (and three recent colours) for a while, while the pen was
 * stuck on PDF.js's default black — the user's report. The presets live in the template; this key only
 * remembers which one (or which custom colour) was last used.
 */
const INK_COLOR_STORAGE_KEY = "pdf-helper-ink-color-v1";
const INK_COLOR_DEFAULT = inkColorButtons[0]?.dataset.inkColor ?? "#000000";

let inkCursor: HTMLDivElement | null = null;
let cursorInteractionsInstalled = false;
let inkToolInteractionsInstalled = false;
let currentInkColor = INK_COLOR_DEFAULT;

function normalizeInkColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

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
  // The ring is drawn in the pen's own colour, so the preview says what the next stroke will look like.
  inkCursor.style.setProperty("--pdf-helper-ink-color", currentInkColor);
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

/** The pen colour in force, from storage when it holds a usable value. */
export function getInkColor(): string {
  return normalizeInkColor(readJsonValue(INK_COLOR_STORAGE_KEY, INK_COLOR_DEFAULT))
    ?? INK_COLOR_DEFAULT;
}

export function setInkColor(color: string, persist = true): void {
  const normalized = normalizeInkColor(color);
  if (!normalized) return;
  currentInkColor = normalized;
  inkColorInput.value = normalized;
  for (const button of inkColorButtons) {
    button.setAttribute(
      "aria-pressed",
      String(normalizeInkColor(button.dataset.inkColor) === normalized),
    );
  }
  inkCursor?.style.setProperty("--pdf-helper-ink-color", normalized);
  if (persist) {
    try {
      writeJsonValue(INK_COLOR_STORAGE_KEY, normalized);
    } catch {
      // The tool must remain usable when extension storage is unavailable.
    }
  }
  // Same rule as the thickness: with nothing selected PDF.js applies the parameter to the *next*
  // stroke, so a finished drawing is never recoloured by picking a new colour.
  annotationEditor.value?.unselectAll();
  annotationEditor.value?.updateParams(
    AnnotationEditorParamsType.INK_COLOR,
    normalized,
  );
}

/**
 * Wires the pen's popover: thickness, colour, and the colour preview under the pointer.
 *
 * One installation flag for both controls rather than one each — they are two rows of the same plate and
 * installing them apart could leave a plate with a working slider and a dead palette.
 */
export function installInkToolInteractions(): void {
  if (inkToolInteractionsInstalled) return;
  inkToolInteractionsInstalled = true;
  setInkThickness(getInkThickness(), false);
  setInkColor(getInkColor(), false);
  inkThicknessInput.addEventListener("input", () => {
    setInkThickness(Number.parseInt(inkThicknessInput.value, 10));
  });
  inkThicknessInput.addEventListener("change", () => {
    closeAnnotationSizePopover(inkThicknessControl);
  });
  inkColorInput.addEventListener("input", () => {
    setInkColor(inkColorInput.value, false);
  });
  inkColorInput.addEventListener("change", () => {
    setInkColor(inkColorInput.value);
  });
  for (const button of inkColorButtons) {
    button.addEventListener("click", () => {
      const color = normalizeInkColor(button.dataset.inkColor);
      if (color) setInkColor(color);
      // Picking a colour is the whole errand; leaving the popover open would cover the page it is
      // about to be drawn on.
      closeAnnotationSizePopover(inkThicknessControl);
    });
  }
  installInkCursorInteractions();
}
