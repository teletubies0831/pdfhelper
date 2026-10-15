import {
  findBar,
  recentFilesDialog,
  redoAnnotationButton,
  smartCopyButton,
  translationHistoryDialog,
  undoAnnotationButton,
} from "../../viewer-elements";
import {
  closeFindBar,
  getViewerSelectionRawText,
  getViewerSelectionText,
  openFindBar,
} from "../../../core/pdf-reader/public";

import { annotationEditor, pdfDocument, selectedAnnotationEditor } from "../../viewer-state";

import {
  deleteSelectedAnnotation,
  isInkEraserMode,
  setInkEraserMode,
} from "../../../features/annotations/public";
import { hideRecentFilesDialog, setStatus } from "../../../features/recent-files/public";
import { saveAnnotatedPdf } from "../../document-save";
import { isTextInputTarget } from "../../../shared-ui/interaction/interaction-boundary";
import { interactionBoundary } from "../../interaction-boundary";

export function registerReaderKeyboardEvents(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      const isEditingText = isTextInputTarget(event.target) || event.target instanceof HTMLSelectElement;
      const ownsPdf = interactionBoundary.ownsPdfKeyboard(event);
      if (event.defaultPrevented || event.isComposing) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        pdfDocument.value && ownsPdf && !isEditingText && !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        void saveAnnotatedPdf();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
        pdfDocument.value && ownsPdf && !isEditingText && !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        openFindBar();
        return;
      }
      if (event.key === "Escape" && !recentFilesDialog.hidden && interactionBoundary.ownsRegion(event, recentFilesDialog)) {
        event.preventDefault();
        hideRecentFilesDialog();
        return;
      }
      if (event.key === "Escape" && !translationHistoryDialog.hidden && interactionBoundary.ownsRegion(event, translationHistoryDialog)) {
        event.preventDefault();
        translationHistoryDialog.hidden = true;
        return;
      }
      if (event.key === "Escape" && ownsPdf && !findBar.hidden) {
        event.preventDefault();
        closeFindBar();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !isEditingText && ownsPdf && !event.altKey &&
        pdfDocument.value &&
        (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
      ) {
        event.preventDefault();
        event.stopPropagation();
        const redo = event.key.toLowerCase() === "y" || event.shiftKey;
        if (redo) annotationEditor.value?.redo();
        else annotationEditor.value?.undo();
        return;
      }
      if (event.key === "Escape" && ownsPdf && isInkEraserMode()) {
        event.preventDefault();
        setInkEraserMode(false);
  setStatus("已退出橡皮擦模式。");
        return;
      }
      if (
        event.key === "Delete" &&
        selectedAnnotationEditor.value &&
        !isEditingText && ownsPdf
      ) {
        event.preventDefault();
        event.stopPropagation();
        deleteSelectedAnnotation();
      }
    },
    true,
  );

  undoAnnotationButton.addEventListener("click", () =>
    annotationEditor.value?.undo(),
  );

  redoAnnotationButton.addEventListener("click", () =>
    annotationEditor.value?.redo(),
  );

  smartCopyButton.addEventListener("click", async () => {
    const text = getViewerSelectionText();
    if (!text) {
    setStatus("请先在PDF中选择要复制的文字。", true);
      return;
    }

    await navigator.clipboard.writeText(text);
    setStatus(`已整理并复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
  });

  smartCopyButton.addEventListener("mousedown", (event) => {
    // Keep the PDF selection active while the toolbar button is pressed.
    event.preventDefault();
  });

  document.addEventListener(
    "copy",
    (event) => {
      if (!interactionBoundary.ownsPdfClipboard(event)) return;
      const text = getViewerSelectionRawText();
      if (!text || !event.clipboardData) return;

      // PDF.js annotation editing captures every copy event. Text selections
      // must be handled first so normal Ctrl+C still behaves like a reader.
      event.stopImmediatePropagation();
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    setStatus(`已复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
    },
    { capture: true },
  );
}
