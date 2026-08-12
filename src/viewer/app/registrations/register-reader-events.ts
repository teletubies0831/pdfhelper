import { AnnotationEditorType } from "pdfjs-dist";
















import { annotationActionBar, clearRecentFilesButton, closeHighlightNoteButton, closeRecentFilesButton, contextCleanCopyButton, contextCopyButton, contextDeleteHighlightButton, contextNoteButton, deleteAnnotationButton, deleteHighlightNoteButton, editorModeButtons, eraseSelectedAnnotationButton, fileInput, findBar, findCloseButton, findInput, findNextButton, findPreviousButton, freeTextColorInput, freeTextSizeDownButton, freeTextSizeInput, freeTextSizeUpButton, highlightColorInput, highlightNotePopover, highlightNoteText, nextButton, openFileButton, pageNumberInput, previousButton, quickCurrentLocationButton, quickHighlightButtons, quickLastLocationButton, recentFilesButton, recentFilesDialog, redoAnnotationButton, saveHighlightNoteButton, selectionContextMenu, smartCopyButton, translationHistoryDialog, undoAnnotationButton, viewerElement, zoomInButton, zoomOutButton } from "../viewer-elements";
import { getViewerSelectionRawText, getViewerSelectionText, navigateToPdfPageWhenVisible, normalizeCopiedText, updateControls } from "../../core/pdf-reader/public";



import { annotationEditor, contextHighlightEditor, contextSelectionText, lastPointerDown, pdfDocument, pdfViewer, selectedAnnotationEditor } from "../viewer-state";

import { confirmDiscardUnsavedChanges, isHighlightEditor } from "../../features/annotations/public";
import { hideRecentFilesDialog, renderRecentFiles, returnToLastReadingPosition, setStatus, showRecentFilesDialog, writeRecentFiles } from "../../features/recent-files/public";
import { closeFindBar, openFindBar, openPdf, runSearch, saveAnnotatedPdf } from "../../core/pdf-reader/public";
import { clearDomSelection, clearSelectedAnnotationState, createQuickHighlight, deleteSelectedAnnotation, deleteSelectedHighlight, findAnnotationEditor, findAnnotationEditorAtPoint, getFreeTextSize, getHighlightNote, hideAnnotationActionBar, hideHighlightNote, hideSelectionContextMenu, highlightCurrentSelectionFromToolbar, isEditableOrControl, isInkMode, isPointInsideSavedSelection, isPointInsideTextGlyph, isTextSelectionMode, saveContextSelection, saveHighlightNote, selectAnnotation, selectHighlight, setEditorMode, setFreeTextColor, setFreeTextSize, setHighlightColor, showAnnotationActionBar, showHighlightNote, showSelectionContextMenuAt, toggleHighlightNote } from "../../features/annotations/public";


import type { FilePickerWindow } from "../viewer-types";


export function registerReaderEvents(): void {
  for (const searchButton of document.querySelectorAll<HTMLButtonElement>(
    "#outline-search-button, #reader-search-button",
  )) {
    searchButton.addEventListener("click", openFindBar);
  }
  const pointerHighlightCache = new WeakMap<PointerEvent, any | null>();
  const getPointerHighlight = (event: PointerEvent): any | null => {
    if (pointerHighlightCache.has(event)) {
      return pointerHighlightCache.get(event) ?? null;
    }
    const highlight = findAnnotationEditorAtPoint(
      event.clientX,
      event.clientY,
      { highlightOnly: true },
    );
    pointerHighlightCache.set(event, highlight);
    return highlight;
  };

  recentFilesButton.addEventListener("click", () => {
      showRecentFilesDialog();
    });
  
  closeRecentFilesButton.addEventListener("click", () => {
      hideRecentFilesDialog();
    });
  
  recentFilesDialog.addEventListener("pointerdown", (event) => {
      if (event.target === recentFilesDialog) hideRecentFilesDialog();
    });
  
  clearRecentFilesButton.addEventListener("click", async () => {
      await writeRecentFiles([]);
      await renderRecentFiles();
    });
  
  openFileButton.addEventListener("click", async (event) => {
      event.preventDefault();
      if (pdfDocument.value && !confirmDiscardUnsavedChanges()) return;
    
      const pickerWindow = window as FilePickerWindow;
      if (typeof pickerWindow.showOpenFilePicker === "function") {
        try {
          const [fileHandle] = await pickerWindow.showOpenFilePicker({
            multiple: false,
            types: [
              {
                description: "PDF 文件",
                accept: {
                  "application/pdf": [".pdf"],
                },
              },
            ],
          });
    
          if (!fileHandle) return;
          const file = await fileHandle.getFile();
          await openPdf(await file.arrayBuffer(), file.name, fileHandle, false);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.warn(
            "File System Access API 打开失败，降级到普通文件选择。",
            error,
          );
        }
      }
    
      fileInput.click();
    });
  
  fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      await openPdf(await file.arrayBuffer(), file.name, null, false);
      fileInput.value = "";
    });
  
  previousButton.addEventListener("click", () => {
      if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1;
    });
  
  nextButton.addEventListener("click", () => {
      if (pdfDocument.value && pdfViewer.currentPageNumber < pdfDocument.value.numPages) {
        pdfViewer.currentPageNumber += 1;
      }
    });
  
  pageNumberInput.addEventListener("change", () => {
      const page = Number(pageNumberInput.value);
      if (
        pdfDocument.value &&
        Number.isInteger(page) &&
        page >= 1 &&
        page <= pdfDocument.value.numPages
      ) {
        navigateToPdfPageWhenVisible(page);
      } else {
        updateControls();
      }
  });

  quickCurrentLocationButton.addEventListener("click", () => {
    navigateToPdfPageWhenVisible(pdfViewer.currentPageNumber);
  });

  quickLastLocationButton.addEventListener("click", () => {
    returnToLastReadingPosition();
  });
  
  zoomOutButton.addEventListener("click", () => {
      pdfViewer.currentScale = Math.max(0.25, pdfViewer.currentScale / 1.1);
    });
  
  zoomInButton.addEventListener("click", () => {
      pdfViewer.currentScale = Math.min(5, pdfViewer.currentScale * 1.1);
    });
  
  findBar.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(false, true);
    });
  
  findInput.addEventListener("input", () => runSearch(false, false));
  
  findPreviousButton.addEventListener("click", () => runSearch(true, true));
  
  findNextButton.addEventListener("click", () => runSearch(false, true));
  
  findCloseButton.addEventListener("click", closeFindBar);
  
  for (const button of editorModeButtons) {
      button.addEventListener("pointerdown", () => {
        if (button.dataset.editorMode === "highlight") saveContextSelection();
      });
    
      button.addEventListener("click", () => {
        const mode = button.dataset.editorMode;
        if (mode === "select") setEditorMode(AnnotationEditorType.NONE);
        if (mode === "highlight") {
          void highlightCurrentSelectionFromToolbar();
          return;
        }
        if (mode === "ink") setEditorMode(AnnotationEditorType.INK);
        if (mode === "text") setEditorMode(AnnotationEditorType.FREETEXT);
      });
    }

  eraseSelectedAnnotationButton.addEventListener("click", deleteSelectedAnnotation);
  
  highlightColorInput.addEventListener("input", () => {
      setHighlightColor(highlightColorInput.value);
    });
  
  freeTextColorInput.addEventListener("input", () => {
      setFreeTextColor(freeTextColorInput.value);
    });
  
  freeTextSizeInput.addEventListener("change", () => {
      setFreeTextSize(getFreeTextSize());
    });
  
  freeTextSizeDownButton.addEventListener("click", () => {
      setFreeTextSize(getFreeTextSize() - 2);
    });
  
  freeTextSizeUpButton.addEventListener("click", () => {
      setFreeTextSize(getFreeTextSize() + 2);
    });
  
  selectionContextMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
  
  for (const button of quickHighlightButtons) {
      button.addEventListener("click", () => {
        const color = button.dataset.quickHighlightColor;
        if (!color) return;
    
        if (contextHighlightEditor.value && annotationEditor.value) {
          selectHighlight(contextHighlightEditor.value);
          setHighlightColor(color);
          hideSelectionContextMenu();
        } else {
          void createQuickHighlight(color);
        }
      });
    }
  
  contextCopyButton.addEventListener("click", async () => {
      if (!contextSelectionText.value) return;
      await navigator.clipboard.writeText(contextSelectionText.value);
      setStatus(
        `已复制 ${contextSelectionText.value.length.toLocaleString("zh-CN")} 个字符。`,
      );
      hideSelectionContextMenu();
    });
  
  contextCleanCopyButton.addEventListener("click", async () => {
      if (!contextSelectionText.value) return;
      const text = normalizeCopiedText(contextSelectionText.value);
      await navigator.clipboard.writeText(text);
      setStatus(`已整理并复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
      hideSelectionContextMenu();
    });
  
  contextNoteButton.addEventListener("click", () => {
      hideSelectionContextMenu();
    
      if (contextHighlightEditor.value) {
        showHighlightNote(contextHighlightEditor.value, true);
        return;
      }
    
      void (async () => {
        const createdEditor = await createQuickHighlight(highlightColorInput.value);
        if (createdEditor) showHighlightNote(createdEditor, true);
      })();
    });
  
  contextDeleteHighlightButton.addEventListener("click", () => {
      if (!contextHighlightEditor.value) return;
      selectHighlight(contextHighlightEditor.value);
      deleteSelectedHighlight();
    });
  
  viewerElement.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.button !== 0 ||
          !pdfDocument.value ||
          !isTextSelectionMode() ||
          isEditableOrControl(event.target)
        ) {
          return;
        }
    
        const directAnnotation = findAnnotationEditor(event.target, {
          includeHighlight: false,
        });
        if (directAnnotation && !isHighlightEditor(directAnnotation)) return;
    
        const pointHighlight = getPointerHighlight(event);
        if (pointHighlight) return;
    
        if (isPointInsideTextGlyph(event.clientX, event.clientY)) return;
    
        event.preventDefault();
        event.stopImmediatePropagation();
        clearDomSelection();
        clearSelectedAnnotationState();
      },
      { capture: true },
    );
  
  viewerElement.addEventListener("contextmenu", (event) => {
      if (isInkMode()) return;
    
      saveContextSelection();
      if (
        contextSelectionText.value &&
        annotationEditor.value &&
        isPointInsideSavedSelection(event.clientX, event.clientY)
      ) {
        event.preventDefault();
        showSelectionContextMenuAt(event.clientX, event.clientY, null);
        return;
      }
    
      const highlightEditor = findAnnotationEditorAtPoint(
        event.clientX,
        event.clientY,
        {
          highlightOnly: true,
        },
      );
      if (highlightEditor) {
        event.preventDefault();
        selectHighlight(highlightEditor);
        showSelectionContextMenuAt(event.clientX, event.clientY, highlightEditor);
        return;
      }
    
      const annotation =
        findAnnotationEditor(event.target, { includeHighlight: false }) ??
        findAnnotationEditorAtPoint(event.clientX, event.clientY, {
          includeHighlight: false,
        });
    
      if (annotation) {
        event.preventDefault();
        selectAnnotation(annotation);
        showAnnotationActionBar(annotation);
        return;
      }
    
      if (!contextSelectionText.value || !annotationEditor.value) return;
    
      event.preventDefault();
      showSelectionContextMenuAt(event.clientX, event.clientY, null);
    });
  
  viewerElement.addEventListener("pointerdown", (event) => {
      if (isInkMode()) return;
    
      lastPointerDown.value = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
    
      const editor = findAnnotationEditor(event.target, {
        includeHighlight: false,
      });
      if (editor) {
        selectAnnotation(editor, false);
        hideAnnotationActionBar();
        return;
      }
    
      const pointHighlight =
        event.button === 0
          ? getPointerHighlight(event)
          : null;
      if (pointHighlight) return;
    
      clearSelectedAnnotationState();
    });
  
  viewerElement.addEventListener("click", (event) => {
      if (isInkMode()) return;
    
      if (lastPointerDown.value?.button !== 0) return;
      const moved =
        !lastPointerDown.value ||
        Math.hypot(
          event.clientX - lastPointerDown.value.x,
          event.clientY - lastPointerDown.value.y,
        ) > 4;
      if (moved) return;
    
      const editor =
        findAnnotationEditorAtPoint(event.clientX, event.clientY, {
          highlightOnly: true,
        }) ??
        findAnnotationEditor(event.target, { includeHighlight: false }) ??
        findAnnotationEditorAtPoint(event.clientX, event.clientY, {
          includeHighlight: false,
        });
      if (!editor) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        return;
      }
    
      clearDomSelection();
      selectAnnotation(editor);
      if (isHighlightEditor(editor) && getHighlightNote(editor))
        toggleHighlightNote(editor);
    });
  
  document.addEventListener("pointerdown", (event) => {
      if (isInkMode()) return;
    
      const annotationAtPoint =
        event instanceof PointerEvent
          ? getPointerHighlight(event)
          : null;
      if (!selectionContextMenu.contains(event.target as Node))
        hideSelectionContextMenu();
      if (
        !highlightNotePopover.contains(event.target as Node) &&
        !isHighlightEditor(annotationAtPoint)
      ) {
        hideHighlightNote();
      }
      if (
        !annotationActionBar.contains(event.target as Node) &&
        !annotationAtPoint &&
        !findAnnotationEditor(event.target, { includeHighlight: false })
      ) {
        hideAnnotationActionBar();
      }
    });
  
  annotationActionBar.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );
  
  deleteAnnotationButton.addEventListener("click", deleteSelectedAnnotation);
  
  highlightNotePopover.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );
  
  closeHighlightNoteButton.addEventListener("click", hideHighlightNote);
  
  saveHighlightNoteButton.addEventListener("click", saveHighlightNote);
  
  deleteHighlightNoteButton.addEventListener("click", () => {
      highlightNoteText.value = "";
      saveHighlightNote();
    });
  
  document.addEventListener(
      "keydown",
      (event) => {
        const target = event.target as HTMLElement | null;
        const isEditingText =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          Boolean(target?.isContentEditable);
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s" &&
          pdfDocument.value
        ) {
          event.preventDefault();
          event.stopPropagation();
          void saveAnnotatedPdf();
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f" &&
          pdfDocument.value
        ) {
          event.preventDefault();
          event.stopPropagation();
          openFindBar();
          return;
        }
        if (event.key === "Escape" && !recentFilesDialog.hidden) {
          event.preventDefault();
          hideRecentFilesDialog();
          return;
        }
        if (event.key === "Escape" && !translationHistoryDialog.hidden) {
          event.preventDefault();
          translationHistoryDialog.hidden = true;
          return;
        }
        if (event.key === "Escape" && !findBar.hidden) {
          event.preventDefault();
          closeFindBar();
          return;
        }
        if (event.key === "Delete" && selectedAnnotationEditor.value && !isEditingText) {
          event.preventDefault();
          event.stopPropagation();
          deleteSelectedAnnotation();
        }
      },
      true,
    );
  
  undoAnnotationButton.addEventListener("click", () => annotationEditor.value?.undo());
  
  redoAnnotationButton.addEventListener("click", () => annotationEditor.value?.redo());
  
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
