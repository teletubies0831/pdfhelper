import { AnnotationEditorType } from "pdfjs-dist";

import {
  editorModeButtons,
  textStatus,
  viewerElement,
} from "../../app/viewer-elements";
import {
  activeEditorMode,
  pdfDocument,
  pdfViewer,
  SELECT_TOOL_EDITOR_BACKING_MODE,
} from "../../app/viewer-state";
import { setInkEraserMode } from "./ink-eraser";
import { closeAnnotationSizePopover } from "./annotation-size-popover";

let editorModeTransitionTimeout: number | null = null;

export function finishEditorModeTransition(): void {
  viewerElement.classList.remove("pdf-helper-editor-mode-transition");
  if (editorModeTransitionTimeout !== null) {
    window.clearTimeout(editorModeTransitionTimeout);
    editorModeTransitionTimeout = null;
  }
}

function getBackingMode(mode: number): number {
  return mode === AnnotationEditorType.NONE
    ? SELECT_TOOL_EDITOR_BACKING_MODE
    : mode;
}

function syncModePresentation(mode: number): void {
  viewerElement.classList.toggle(
    "pdf-helper-select-mode",
    mode === AnnotationEditorType.NONE,
  );
  viewerElement.classList.toggle(
    "pdf-helper-ink-mode",
    mode === AnnotationEditorType.INK,
  );

  const modeNames: Record<string, number> = {
    select: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    ink: AnnotationEditorType.INK,
    text: AnnotationEditorType.FREETEXT,
  };
  for (const button of editorModeButtons) {
    const selected = modeNames[button.dataset.editorMode || ""] === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  const hints: Record<number, string> = {
    [AnnotationEditorType.NONE]:
      "选择模式：拖选可复制；单击批注后拖动，双击文本可修改",
    [AnnotationEditorType.HIGHLIGHT]:
      "高亮模式：拖选文字生成高亮；完成后切回“选择”",
    [AnnotationEditorType.INK]:
      "画笔模式：按住鼠标绘制；墨迹完成后固定在页面上，不可移动",
    [AnnotationEditorType.FREETEXT]:
      "文本模式：点击页面输入；点击空白结束，切回“选择”可编辑已有批注",
  };
  textStatus.textContent = hints[mode] ?? "";
}

export function setEditorMode(mode: number): void {
  if (!pdfDocument.value) return;
  closeAnnotationSizePopover();
  setInkEraserMode(false);

  const backingMode = getBackingMode(mode);
  // PDF.js exposes a numeric getter at runtime, while its bundled TypeScript
  // declaration only models the object-shaped setter.
  const backingModeWillChange =
    Number((pdfViewer as any).annotationEditorMode) !== backingMode;
  if (backingModeWillChange) {
    viewerElement.classList.add("pdf-helper-editor-mode-transition");
    if (editorModeTransitionTimeout !== null) {
      window.clearTimeout(editorModeTransitionTimeout);
    }
    editorModeTransitionTimeout = window.setTimeout(
      finishEditorModeTransition,
      3_000,
    );
  } else {
    finishEditorModeTransition();
  }

  // NONE remains PDFPal's logical Select value, but PDF.js stays in an
  // enabled backing mode. That preserves editor DOM, note markers, and exact
  // free-text metrics instead of handing annotations to native rendering.
  activeEditorMode.value = mode;
  syncModePresentation(mode);
  pdfViewer.annotationEditorMode = { mode: backingMode };
}
