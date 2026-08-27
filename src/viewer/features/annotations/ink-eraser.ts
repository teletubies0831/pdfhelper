import { AnnotationEditorType } from "pdfjs-dist";

import {
  editorModeButtons,
  eraseSelectedAnnotationButton,
  inkEraserSizeControl,
  inkEraserSizeInput,
  inkEraserSizeValue,
  textStatus,
  viewerElement,
} from "../../app/viewer-elements";
import {
  activeEditorMode,
  annotationEditor,
  pdfDocument,
  selectedAnnotationEditor,
} from "../../app/viewer-state";
import { setStatus } from "../recent-files/public";
import { type InkScreenPoint } from "./ink-eraser-geometry";
import {
  clearInkEraserPreview,
  flushInkEraserPreview,
  scheduleInkEraserPreview,
} from "./ink-eraser-preview";
import {
  buildInkEraserSession,
  eraseInkSweep,
  getInkSvgPath,
  getSurvivingInkPaths,
  INK_ERASER_RADIUS_PX,
  isPointInsideSerializedInk,
  type SurvivingInkPaths,
  type InkEraserEntry,
  type InkEraserSession,
} from "./ink-eraser-session";
import { markUnsavedChanges } from "./annotation-persistence";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";
import {
  closeAnnotationSizePopover,
  openAnnotationSizePopover,
} from "./annotation-size-popover";

const REPLACEMENT_ANNOTATION_GUARD_PREFIX = "pdfpal-ink-eraser";
const INK_ERASER_SIZE_STORAGE_KEY = "pdf-helper-ink-eraser-size-v1";
const INK_ERASER_SIZE_MIN = 8;
const INK_ERASER_SIZE_MAX = 64;
const INK_ERASER_SIZE_DEFAULT = INK_ERASER_RADIUS_PX * 2;

interface PreparedReplacement {
  editor: any;
  layer: any;
  guardId: string;
}

function isPointInRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function getPageElementAtPoint(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const directPage = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(".pdfViewer .page");
  if (directPage) return directPage;
  return (
    Array.from(viewerElement.querySelectorAll<HTMLElement>(".page")).find(
      (page) =>
        isPointInRect(clientX, clientY, page.getBoundingClientRect()),
    ) ?? null
  );
}

function getReplacementRect(
  entry: InkEraserEntry,
  strokes: ArrayLike<number>[],
): number[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (let index = 0; index < stroke.length; index += 2) {
      minX = Math.min(minX, stroke[index]!);
      maxX = Math.max(maxX, stroke[index]!);
      minY = Math.min(minY, stroke[index + 1]!);
      maxY = Math.max(maxY, stroke[index + 1]!);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return Array.isArray(entry.serialized.rect)
      ? [...entry.serialized.rect]
      : [0, 0, 1, 1];
  }
  const margin = Math.max(0.5, Number(entry.serialized.thickness) / 2 || 0.5);
  return [minX - margin, minY - margin, maxX + margin, maxY + margin];
}

function createReplacementData(
  entry: InkEraserEntry,
  paths: SurvivingInkPaths,
  guardId: string,
): Record<string, any> {
  const data: Record<string, any> = {
    ...entry.serialized,
    annotationElementId: guardId,
    // Untouched strokes retain their original PDF.js Bezier controls. Only
    // split strokes are rebuilt, using the same curve algorithm as preview.
    paths,
    rect: getReplacementRect(entry, paths.points),
  };
  delete data.id;
  delete data.deleted;
  delete data.isCopy;
  delete data.popupRef;
  return data;
}

function setDrawVisibility(editor: any, visible: boolean): void {
  // PDF.js keeps all ink editors from one page inside the same SVG. Hiding
  // ownerSVGElement would therefore blank every stroke on the page while a
  // replacement is prepared. Only the replacement path itself is buffered.
  const path = getInkSvgPath(editor);
  if (path) path.style.visibility = visible ? "" : "hidden";
}

async function prepareReplacement(
  entry: InkEraserEntry,
  paths: SurvivingInkPaths,
  index: number,
): Promise<PreparedReplacement> {
  const guardId = `${REPLACEMENT_ANNOTATION_GUARD_PREFIX}-${index}-${crypto.randomUUID()}`;
  const editor = await entry.layer.deserialize(
    createReplacementData(entry, paths, guardId),
  );
  if (!editor) throw new Error("PDF.js 无法重建擦除后的画笔墨迹。");
  setDrawVisibility(editor, false);
  return { editor, layer: entry.layer, guardId };
}

function addReplacementWithoutOwnUndo(
  replacement: PreparedReplacement,
): void {
  // PDF.js normally gives every newly attached editor its own undo entry. A
  // temporary annotation id suppresses that nested entry so one eraser drag is
  // exactly one undoable operation; it is cleared immediately after attach.
  replacement.editor.annotationElementId = replacement.guardId;
  replacement.layer.addOrRebuild(replacement.editor);
  replacement.editor.annotationElementId = null;
  setDrawVisibility(replacement.editor, true);
}

function discardPreparedReplacement(replacement: PreparedReplacement): void {
  try {
    replacement.editor.setParent?.(null);
  } catch {
    setDrawVisibility(replacement.editor, false);
  }
}

async function commitEraserSession(session: InkEraserSession): Promise<void> {
  const changes = session.entries
    .filter((entry) => entry.changed)
    .map((entry) => ({ entry, paths: getSurvivingInkPaths(entry) }));
  if (changes.length === 0) {
    clearInkEraserPreview(session);
    setStatus("没有擦到画笔墨迹。", false);
    resetToolHint();
    return;
  }

  applying = true;
  eraseSelectedAnnotationButton.setAttribute("aria-busy", "true");
  const prepared: Array<PreparedReplacement | null> = [];
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!;
      prepared.push(
        change.paths.points.length > 0
          ? await prepareReplacement(change.entry, change.paths, index)
          : null,
      );
    }
    if (pdfDocument.value !== session.document || !annotationEditor.value) {
      for (const replacement of prepared) {
        if (replacement) discardPreparedReplacement(replacement);
      }
      clearInkEraserPreview(session);
      return;
    }

    const uiManager = annotationEditor.value as any;
    const apply = () => {
      for (const replacement of prepared) {
        if (replacement) addReplacementWithoutOwnUndo(replacement);
      }
      // Restore the original path data before removing its editor so undo can
      // rebuild the exact source. All changes happen in one task after the
      // replacement is visible, hence there is no intermediate paint.
      clearInkEraserPreview(session);
      for (const { entry } of changes) entry.editor.remove();
    };
    const undo = () => {
      for (const replacement of prepared) replacement?.editor.remove();
      for (const { entry } of changes) uiManager.rebuild(entry.editor);
    };
    uiManager.addCommands({
      cmd: apply,
      undo,
      post: markUnsavedChanges,
      mustExec: true,
    });
    selectedAnnotationEditor.value = null;
    markUnsavedChanges();
    setStatus("已擦除经过的画笔线段，可使用撤销恢复。", false);
  } catch (error) {
    clearInkEraserPreview(session);
    for (const replacement of prepared) {
      if (replacement) discardPreparedReplacement(replacement);
    }
    console.warn("PDFPal ink eraser failed to rebuild the remaining strokes.", error);
    setStatus("画笔擦除失败，原墨迹已保留。", true);
  } finally {
    applying = false;
    eraseSelectedAnnotationButton.removeAttribute("aria-busy");
    resetToolHint();
  }
}

let active = false;
let applying = false;
let currentSession: InkEraserSession | null = null;
let installed = false;
let eraserCursor: HTMLDivElement | null = null;
let eraserDiameterPx = INK_ERASER_SIZE_DEFAULT;

function normalizeEraserDiameter(value: number): number {
  return Math.min(
    INK_ERASER_SIZE_MAX,
    Math.max(
      INK_ERASER_SIZE_MIN,
      Number.isFinite(value) ? Math.round(value / 2) * 2 : INK_ERASER_SIZE_DEFAULT,
    ),
  );
}

function setInkEraserSize(value: number, persist = true): void {
  eraserDiameterPx = normalizeEraserDiameter(value);
  inkEraserSizeInput.value = String(eraserDiameterPx);
  inkEraserSizeValue.value = String(eraserDiameterPx);
  if (persist) {
    try {
      writeJsonValue(INK_ERASER_SIZE_STORAGE_KEY, eraserDiameterPx);
    } catch {
      // Erasing remains available even if browser preference storage fails.
    }
  }
  eraserCursor?.style.setProperty(
    "--pdf-helper-eraser-diameter",
    `${eraserDiameterPx}px`,
  );
}

function getEraserCursor(): HTMLDivElement {
  if (eraserCursor) return eraserCursor;
  eraserCursor = document.createElement("div");
  eraserCursor.className = "pdf-helper-ink-eraser-cursor";
  eraserCursor.setAttribute("aria-hidden", "true");
  eraserCursor.style.setProperty(
    "--pdf-helper-eraser-diameter",
    `${eraserDiameterPx}px`,
  );
  document.body.append(eraserCursor);
  return eraserCursor;
}

function hideEraserCursor(): void {
  if (eraserCursor) eraserCursor.hidden = true;
}

function updateEraserCursor(clientX: number, clientY: number): void {
  if (!active || !getPageElementAtPoint(clientX, clientY)) {
    hideEraserCursor();
    return;
  }
  const cursor = getEraserCursor();
  const radius = eraserDiameterPx / 2;
  cursor.hidden = false;
  cursor.style.transform = `translate3d(${clientX - radius}px, ${clientY - radius}px, 0)`;
}

function resetToolHint(): void {
  if (active) {
    textStatus.textContent =
      "橡皮擦模式：按住鼠标擦过画笔，只删除经过的连续线段";
    return;
  }
  const hints: Record<number, string> = {
    [AnnotationEditorType.NONE]:
      "选择模式：拖选可复制；单击批注后拖动，双击文本可修改",
    [AnnotationEditorType.HIGHLIGHT]:
      "高亮模式：拖选文字生成高亮；完成后切回“选择”",
    [AnnotationEditorType.INK]:
      "画笔模式：按住鼠标绘制；墨迹完成后固定在页面上，不可移动",
    [AnnotationEditorType.FREETEXT]:
      "文本模式：点击页面输入；点击空白结束，切回“选择”可编辑",
  };
  textStatus.textContent = hints[activeEditorMode.value] ?? "";
}

function syncToolbarState(): void {
  const modeNames: Record<string, number> = {
    select: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    ink: AnnotationEditorType.INK,
    text: AnnotationEditorType.FREETEXT,
  };
  for (const button of editorModeButtons) {
    const selected =
      !active &&
      modeNames[button.dataset.editorMode || ""] === activeEditorMode.value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  eraseSelectedAnnotationButton.classList.toggle("active", active);
  eraseSelectedAnnotationButton.setAttribute("aria-pressed", String(active));
}

function cancelCurrentSession(): void {
  const session = currentSession;
  if (!session) return;
  currentSession = null;
  clearInkEraserPreview(session);
  if (viewerElement.hasPointerCapture?.(session.pointerId)) {
    viewerElement.releasePointerCapture(session.pointerId);
  }
}

export function isInkEraserMode(): boolean {
  return active;
}

export function setInkEraserMode(enabled: boolean): void {
  const nextActive = enabled && Boolean(pdfDocument.value);
  if (!nextActive) cancelCurrentSession();
  if (nextActive) closeAnnotationSizePopover();
  else closeAnnotationSizePopover(inkEraserSizeControl);
  active = nextActive;
  if (!active) hideEraserCursor();
  viewerElement.classList.toggle("pdf-helper-ink-eraser-mode", active);
  syncToolbarState();
  if (active) {
    // Keep the PDF.js mode unchanged to avoid rebuilding page layers, but end
    // its grouped drawing session so the newest strokes enter our snapshot.
    (annotationEditor.value as any)?.currentLayer?.endDrawingSession?.(false);
    annotationEditor.value?.unselectAll();
    selectedAnnotationEditor.value = null;
  }
  resetToolHint();
  if (active) {
    openAnnotationSizePopover(
      inkEraserSizeControl,
      eraseSelectedAnnotationButton,
    );
  }
}

export function isPointInsideInkShape(
  editor: any,
  clientX: number,
  clientY: number,
): boolean {
  return isPointInsideSerializedInk(editor, clientX, clientY);
}

function beginSession(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  updateEraserCursor(event.clientX, event.clientY);
  // Always consume primary input in eraser mode. If an empty page click leaked
  // to the underlying ink mode, PDF.js would accidentally start a new stroke.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (applying || !annotationEditor.value || currentSession) return;
  (annotationEditor.value as any).currentLayer?.endDrawingSession?.(false);
  const pageElement = getPageElementAtPoint(event.clientX, event.clientY);
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !pdfDocument.value) return;
  const point = { x: event.clientX, y: event.clientY };
  currentSession = buildInkEraserSession(
    annotationEditor.value,
    pdfDocument.value,
    event.pointerId,
    pageNumber - 1,
    point,
    eraserDiameterPx / 2,
  );
  if (!currentSession) {
    setStatus("当前页没有可擦除的画笔墨迹。", false);
    return;
  }
  try {
    viewerElement.setPointerCapture?.(event.pointerId);
  } catch {
    // Capture is optional; capture-phase handlers still block PDF.js drawing.
  }
  const hitEntries = eraseInkSweep(currentSession, point, point);
  if (hitEntries.length > 0) {
    scheduleInkEraserPreview(currentSession, hitEntries);
    textStatus.textContent = "正在擦除画笔线段，松开鼠标后可撤销";
  }
}

function moveSession(event: PointerEvent): void {
  if (active) updateEraserCursor(event.clientX, event.clientY);
  const session = currentSession;
  if (!active || !session || session.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const coalesced = event.getCoalescedEvents?.() ?? [event];
  let lastPoint: InkScreenPoint = session.lastPoint;
  const hitEntries = new Set<InkEraserEntry>();
  for (const sample of coalesced) {
    const nextPoint = { x: sample.clientX, y: sample.clientY };
    for (const entry of eraseInkSweep(session, lastPoint, nextPoint)) {
      hitEntries.add(entry);
    }
    lastPoint = nextPoint;
  }
  const eventPoint = { x: event.clientX, y: event.clientY };
  if (lastPoint.x !== eventPoint.x || lastPoint.y !== eventPoint.y) {
    for (const entry of eraseInkSweep(session, lastPoint, eventPoint)) {
      hitEntries.add(entry);
    }
    lastPoint = eventPoint;
  }
  session.lastPoint = lastPoint;
  if (hitEntries.size > 0) {
    scheduleInkEraserPreview(session, hitEntries);
    textStatus.textContent = "正在擦除画笔线段，松开鼠标后可撤销";
  }
}

function finishSession(event: PointerEvent, cancelled: boolean): void {
  const session = currentSession;
  if (!session || session.pointerId !== event.pointerId) return;
  currentSession = null;
  if (viewerElement.hasPointerCapture?.(event.pointerId)) {
    viewerElement.releasePointerCapture(event.pointerId);
  }
  if (active) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  if (cancelled) {
    clearInkEraserPreview(session);
    setStatus("已取消本次画笔擦除。", false);
    resetToolHint();
    return;
  }
  flushInkEraserPreview(session);
  void commitEraserSession(session);
}

export function installInkEraserInteractions(): void {
  if (installed) return;
  installed = true;
  setInkEraserSize(
    Number.parseInt(
      String(
        readJsonValue(
          INK_ERASER_SIZE_STORAGE_KEY,
          Number.parseInt(inkEraserSizeInput.value, 10),
        ),
      ),
      10,
    ),
    false,
  );
  inkEraserSizeInput.addEventListener("input", () => {
    setInkEraserSize(Number.parseInt(inkEraserSizeInput.value, 10));
  });
  inkEraserSizeInput.addEventListener("change", () => {
    closeAnnotationSizePopover(inkEraserSizeControl);
  });
  eraseSelectedAnnotationButton.addEventListener("click", () => {
    setInkEraserMode(!active);
  });
  viewerElement.addEventListener("pointerdown", beginSession, { capture: true });
  viewerElement.addEventListener("pointermove", moveSession, { capture: true });
  viewerElement.addEventListener("pointerleave", () => {
    if (!currentSession) hideEraserCursor();
  });
  viewerElement.addEventListener(
    "pointerup",
    (event) => finishSession(event, false),
    { capture: true },
  );
  viewerElement.addEventListener(
    "pointercancel",
    (event) => finishSession(event, true),
    { capture: true },
  );
  window.addEventListener("blur", () => {
    hideEraserCursor();
    cancelCurrentSession();
  });
}
