import { AnnotationEditorParamsType, AnnotationEditorType, type AnnotationEditorUIManager } from "pdfjs-dist";
















import { freeTextColorInput, freeTextSizeInput, highlightColorInput, viewerElement } from "../../app/viewer-elements";
import { activeEditorMode, annotationEditor, annotationEditorWarmUpInFlight, contextSelectionRanges, isOpeningDocument, pdfDocument, restoredAnnotationWarmUpPending, selectedAnnotationEditor } from "../../app/viewer-state";
import { FREE_TEXT_DEFAULT_SIZE, FREE_TEXT_MAX_SIZE, FREE_TEXT_MIN_SIZE, isFreeTextEditor, isHighlightEditor, isInkEditor, markSavedChanges, markUnsavedChanges, rgbColorToHex } from "./annotation-persistence";
import { updateControls } from "../../core/pdf-reader/public";
import { getSelectionHeightRatio, mergeHighlightBoxes } from '../text-selection/public';
import { scheduleHighlightNoteIndicatorRefresh } from './annotation-notes';




export function installHighlightGeometry(uiManager: AnnotationEditorUIManager) {
  const getOriginalBoxes = uiManager.getSelectionBoxes.bind(uiManager);

  uiManager.getSelectionBoxes = (textLayer: HTMLElement | null) => {
    const boxes = getOriginalBoxes(textLayer);
    if (!boxes) return null;

    const ratio = getSelectionHeightRatio();
    const rotation = textLayer?.getAttribute("data-main-rotation") ?? "0";
    const usesHorizontalHeight = rotation === "90" || rotation === "270";

    const adjustedBoxes = boxes.map((box) => {
      if (usesHorizontalHeight) {
        const width = box.width * ratio;
        return { ...box, x: box.x + (box.width - width) / 2, width };
      }

      const height = box.height * ratio;
      return { ...box, y: box.y + (box.height - height) / 2, height };
    });

    if (usesHorizontalHeight) {
      return adjustedBoxes;
    }

    return mergeHighlightBoxes(adjustedBoxes);
  };
}



export function setHighlightColor(color: string) {
  highlightColorInput.value = color;
  annotationEditor.value?.updateParams(
    AnnotationEditorParamsType.HIGHLIGHT_COLOR,
    color,
  );
}



export function getFreeTextSize(): number {
  const value = Number.parseInt(freeTextSizeInput.value, 10);
  return Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(
      FREE_TEXT_MIN_SIZE,
      Number.isFinite(value) ? value : FREE_TEXT_DEFAULT_SIZE,
    ),
  );
}



export function setFreeTextSize(size: number) {
  const normalizedSize = Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(FREE_TEXT_MIN_SIZE, Math.round(size)),
  );
  freeTextSizeInput.value = String(normalizedSize);
  annotationEditor.value?.updateParams(
    AnnotationEditorParamsType.FREETEXT_SIZE,
    normalizedSize,
  );
  if (isFreeTextEditor(selectedAnnotationEditor.value)) markUnsavedChanges();
}



export function setFreeTextColor(color: string) {
  freeTextColorInput.value = color;
  annotationEditor.value?.updateParams(
    AnnotationEditorParamsType.FREETEXT_COLOR,
    color,
  );
  if (isFreeTextEditor(selectedAnnotationEditor.value)) markUnsavedChanges();
}



export function getEditorParamValue(editor: any, type: number): unknown {
  const properties = editor?.propertiesToUpdate;
  if (!Array.isArray(properties)) return null;
  const pair = properties.find(
    (entry) => Array.isArray(entry) && entry[0] === type,
  );
  return pair?.[1] ?? null;
}



export function syncFreeTextControls(editor: any) {
  if (!isFreeTextEditor(editor)) return;

  const size = Number(
    getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_SIZE),
  );
  if (Number.isFinite(size)) {
    freeTextSizeInput.value = String(
      Math.min(
        FREE_TEXT_MAX_SIZE,
        Math.max(FREE_TEXT_MIN_SIZE, Math.round(size)),
      ),
    );
  }

  const color = rgbColorToHex(
    getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_COLOR) ??
      editor?.color,
  );
  if (color) freeTextColorInput.value = color;
}



export async function warmUpAnnotationEditorManager(
  uiManager: AnnotationEditorUIManager,
) {
  if (!pdfDocument.value) return;
  const documentAtStart = pdfDocument.value;

  try {
    await uiManager.updateMode(AnnotationEditorType.HIGHLIGHT, null, false);
    await uiManager.updateMode(AnnotationEditorType.NONE, null, false);
  } catch (error) {
    console.warn("PDF Helper annotation editor warm-up failed.", error);
  } finally {
    if (pdfDocument.value !== documentAtStart) return;
    activeEditorMode.value = AnnotationEditorType.NONE;
    viewerElement.classList.toggle("pdf-helper-ink-mode", false);
    scheduleHighlightNoteIndicatorRefresh();
    if (isOpeningDocument.value) markSavedChanges();
    updateControls();
  }
}



export function hasAnyAnnotationEditor(): boolean {
  if (!annotationEditor.value || !pdfDocument.value) return false;

  for (let pageIndex = 0; pageIndex < pdfDocument.value.numPages; pageIndex += 1) {
    for (const _editor of annotationEditor.value.getEditors(pageIndex)) return true;
  }

  return false;
}



export function scheduleRestoredAnnotationEditorWarmUp() {
  if (
    !restoredAnnotationWarmUpPending.value ||
    !annotationEditor.value ||
    annotationEditorWarmUpInFlight.value
  ) {
    return;
  }

  annotationEditorWarmUpInFlight.value = true;
  window.setTimeout(() => {
    void (async () => {
      try {
        if (!annotationEditor.value) return;
        await warmUpAnnotationEditorManager(annotationEditor.value);
        if (hasAnyAnnotationEditor()) {
          restoredAnnotationWarmUpPending.value = false;
        }
      } finally {
        annotationEditorWarmUpInFlight.value = false;
      }
    })();
  }, 50);
}



export function findAnnotationEditor(
  target: EventTarget | null,
  options: { includeHighlight?: boolean } = {},
): any | null {
  if (!(target instanceof Element) || !annotationEditor.value) return null;
  const includeHighlight = options.includeHighlight ?? true;
  const editorElement = target.closest<HTMLDivElement>(
    ".highlightEditor, .freeTextEditor, .inkEditor, .stampEditor, .signatureEditor",
  );
  const pageElement = target.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!editorElement || !Number.isInteger(pageNumber) || pageNumber < 1)
    return null;

  for (const editor of annotationEditor.value.getEditors(pageNumber - 1)) {
    if (!includeHighlight && isHighlightEditor(editor)) continue;
    if (editor.div === editorElement || editor.div?.contains(target))
      return editor;
  }
  return null;
}



export function isPointInRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  padding = 0,
): boolean {
  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}



export function isPointInsideHighlightShape(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  if (isPointInsideHighlightClipPath(editorElement, clientX, clientY))
    return true;

  const internal = editorElement.querySelector<HTMLElement>(".internal");
  if (!internal) return false;

  const editorPointerEvents = {
    value: editorElement.style.getPropertyValue("pointer-events"),
    priority: editorElement.style.getPropertyPriority("pointer-events"),
  };
  const internalPointerEvents = {
    value: internal.style.getPropertyValue("pointer-events"),
    priority: internal.style.getPropertyPriority("pointer-events"),
  };

  try {
    editorElement.style.setProperty("pointer-events", "auto", "important");
    internal.style.setProperty("pointer-events", "auto", "important");
    const hit = document.elementFromPoint(clientX, clientY);
    return hit === internal || internal.contains(hit);
  } finally {
    editorElement.style.setProperty(
      "pointer-events",
      editorPointerEvents.value,
      editorPointerEvents.priority,
    );
    internal.style.setProperty(
      "pointer-events",
      internalPointerEvents.value,
      internalPointerEvents.priority,
    );
  }
}



export function isPointInsideHighlightClipPath(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = editorElement.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    !isPointInRect(clientX, clientY, rect)
  )
    return false;

  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute("d");
  if (!d || typeof Path2D === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return false;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return context.isPointInPath(new Path2D(d), x, y);
  } catch {
    return false;
  }
}



export function isPointInsideHighlightNoteIndicator(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const indicator = editorElement.querySelector<HTMLElement>(
    ".pdf-helper-note-indicator",
  );
  if (!indicator) return false;

  const rect = indicator.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    isPointInRect(clientX, clientY, rect, 2)
  );
}



export function extractUrlFragmentId(value: string): string {
  const urlMatch = value.match(/url\((["']?)(.*?)\1\)/);
  const rawUrl = urlMatch?.[2] ?? value;
  const hashIndex = rawUrl.lastIndexOf("#");
  return hashIndex >= 0
    ? rawUrl.slice(hashIndex + 1)
    : rawUrl.replace(/^#/, "");
}



export function getHighlightClipPath(
  editorElement: HTMLElement,
): SVGPathElement | null {
  const internal = editorElement.querySelector<HTMLElement>(".internal");
  if (!internal) return null;

  const clipPathValue =
    internal.style.clipPath || getComputedStyle(internal).clipPath;
  const clipPathId = extractUrlFragmentId(clipPathValue);
  if (!clipPathId) return null;

  const clipPath = document.getElementById(clipPathId);
  const href = clipPath
    ?.querySelector<SVGUseElement>("use")
    ?.getAttribute("href");
  if (!href) return null;

  return document.getElementById(
    extractUrlFragmentId(href),
  ) as SVGPathElement | null;
}



export function getHighlightPathPoints(
  editorElement: HTMLElement,
): Array<{ x: number; y: number }> {
  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute("d");
  if (!d) return [];

  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let command = "";
  let index = 0;
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  const isCommandToken = (token: string) => /^[a-zA-Z]$/.test(token);
  const readNumber = () => {
    const value = Number(tokens[index]);
    index += 1;
    return value;
  };
  const hasNumber = () => {
    const token = tokens[index];
    return token !== undefined && !isCommandToken(token);
  };
  const addPoint = (nextX: number, nextY: number) => {
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    x = nextX;
    y = nextY;
    points.push({ x, y });
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (isCommandToken(token)) {
      command = token;
      index += 1;
    }

    const relative = command === command.toLowerCase();
    const normalizedCommand = command.toUpperCase();
    const absoluteX = (value: number) => (relative ? x + value : value);
    const absoluteY = (value: number) => (relative ? y + value : value);

    if (normalizedCommand === "M") {
      if (!hasNumber()) continue;
      const nextX = absoluteX(readNumber());
      const nextY = absoluteY(readNumber());
      addPoint(nextX, nextY);
      subpathStartX = x;
      subpathStartY = y;
      command = relative ? "l" : "L";
      continue;
    }

    if (normalizedCommand === "L") {
      while (hasNumber())
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "H") {
      while (hasNumber()) addPoint(absoluteX(readNumber()), y);
      continue;
    }

    if (normalizedCommand === "V") {
      while (hasNumber()) addPoint(x, absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "C") {
      while (hasNumber()) {
        // Control points are useful for bounding/anchoring too, so keep them.
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === "S" || normalizedCommand === "Q") {
      while (hasNumber()) {
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === "T") {
      while (hasNumber())
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "Z") {
      addPoint(subpathStartX, subpathStartY);
      continue;
    }

    // Unknown command. Skip following numbers to avoid an infinite loop.
    while (hasNumber()) index += 1;
  }

  return points;
}



export function findHighlightNoteAnchor(
  editorElement: HTMLElement,
): { x: number; y: number } | null {
  const rect = editorElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const points = getHighlightPathPoints(editorElement);
  if (points.length > 0) {
    const minY = Math.min(...points.map((point) => point.y));
    const lineTolerance = Math.max(
      0.01,
      Math.min(0.08, 18 / Math.max(rect.height, 1)),
    );
    const topLinePoints = points.filter(
      (point) => point.y <= minY + lineTolerance,
    );
    let topRightPoint = topLinePoints[0] ?? points[0];
    for (const point of topLinePoints) {
      if (!topRightPoint || point.x > topRightPoint.x) topRightPoint = point;
    }

    if (topRightPoint) {
      return {
        x: Math.max(0, Math.min(rect.width, topRightPoint.x * rect.width)),
        y: Math.max(0, Math.min(rect.height, topRightPoint.y * rect.height)),
      };
    }
  }

  return { x: rect.width, y: 0 };
}



export function isPointInsideEditor(
  editor: any,
  clientX: number,
  clientY: number,
): boolean {
  const editorElement = editor?.div as HTMLElement | null;
  if (!editorElement) return false;

  if (isHighlightEditor(editor)) {
    return (
      isPointInsideHighlightNoteIndicator(editorElement, clientX, clientY) ||
      isPointInsideHighlightShape(editorElement, clientX, clientY)
    );
  }

  if (isInkEditor(editor)) {
    return false;
  }

  if (isFreeTextEditor(editor)) {
    const contentElements = Array.from(
      editorElement.querySelectorAll<HTMLElement>(
        '[contenteditable="true"], .internal',
      ),
    );
    const candidates =
      contentElements.length > 0 ? contentElements : [editorElement];
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        isPointInRect(clientX, clientY, rect, 1)
      );
    });
  }

  const rect = editorElement.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    isPointInRect(clientX, clientY, rect, 1)
  );
}



export function findAnnotationEditorAtPoint(
  clientX: number,
  clientY: number,
  options: { highlightOnly?: boolean; includeHighlight?: boolean } = {},
): any | null {
  if (!annotationEditor.value) return null;
  const includeHighlight = options.includeHighlight ?? true;

  const hit = document.elementFromPoint(clientX, clientY);
  const pageElement = hit?.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const editors = [...annotationEditor.value.getEditors(pageNumber - 1)].reverse();
  for (const editor of editors) {
    if (!includeHighlight && isHighlightEditor(editor)) continue;
    if (options.highlightOnly && !isHighlightEditor(editor)) continue;
    if (isPointInsideEditor(editor, clientX, clientY)) return editor;
  }
  return null;
}



export function isPointInsideSavedSelection(
  clientX: number,
  clientY: number,
): boolean {
  for (const range of contextSelectionRanges.value) {
    for (const rect of range.getClientRects()) {
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        isPointInRect(clientX, clientY, rect, 2)
      ) {
        return true;
      }
    }
  }
  return false;
}



export function isEditableOrControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      Boolean(
        target.closest(
          'button, input, textarea, select, [contenteditable="true"]',
        ),
      ))
  );
}



export function isTextSelectionMode(): boolean {
  return (
    activeEditorMode.value === AnnotationEditorType.NONE ||
    activeEditorMode.value === AnnotationEditorType.HIGHLIGHT
  );
}



export function isInkMode(): boolean {
  return activeEditorMode.value === AnnotationEditorType.INK;
}



