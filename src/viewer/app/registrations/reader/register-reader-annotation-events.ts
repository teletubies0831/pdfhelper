import { AnnotationEditorType } from "pdfjs-dist";

import {
  annotationActionBar,
  closeHighlightNoteButton,
  contextCleanCopyButton,
  contextCopyButton,
  contextDeleteHighlightButton,
  contextNoteButton,
  deleteAnnotationButton,
  deleteHighlightNoteButton,
  editorModeButtons,
  freeTextColorInput,
  freeTextSizeDownButton,
  freeTextSizeInput,
  freeTextSizeUpButton,
  highlightColorHistoryButtons,
  highlightColorInput,
  highlightNotePopover,
  highlightNoteText,
  inkThicknessControl,
  quickHighlightButtons,
  saveHighlightNoteButton,
  selectionContextMenu,
  viewerElement,
} from "../../viewer-elements";
import { normalizeCopiedText } from "../../../core/pdf-reader/public";

import {
  annotationEditor,
  contextHighlightEditor,
  contextSelectionText,
  lastPointerDown,
  pdfDocument,
} from "../../viewer-state";

import {
  clearDomSelection,
  clearSelectedAnnotationState,
  createQuickHighlight,
  deleteSelectedAnnotation,
  deleteSelectedHighlight,
  findAnnotationEditor,
  findAnnotationEditorAtPoint,
  getFreeTextSize,
  getHighlightNote,
  hideAnnotationActionBar,
  hideHighlightNote,
  hideSelectionContextMenu,
  highlightCurrentSelectionFromToolbar,
  installInkEraserInteractions,
  isEditableOrControl,
  isHighlightEditor,
  isInkMode,
  isPointInsideSavedSelection,
  isPointInsideTextGlyph,
  isTextSelectionMode,
  openAnnotationSizePopover,
  saveContextSelection,
  saveHighlightNote,
  selectAnnotation,
  selectHighlight,
  setEditorMode,
  setFreeTextColor,
  setFreeTextSize,
  setHighlightColor,
  setInkEraserMode,
  showAnnotationActionBar,
  showHighlightNote,
  showSelectionContextMenuAt,
  toggleHighlightNote,
} from "../../../features/annotations/public";
import { setStatus } from "../../../features/recent-files/public";

export function registerReaderAnnotationEvents(): void {
  const pointerHighlightCache = new WeakMap<PointerEvent, any | null>();
  let contextSelectionCapturedOnPointerDown = false;
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

  for (const button of editorModeButtons) {
    button.addEventListener("pointerdown", () => {
      if (button.dataset.editorMode === "highlight") saveContextSelection();
    });

    button.addEventListener("click", (event) => {
      setInkEraserMode(false);
      const mode = button.dataset.editorMode;
      if (mode === "select") setEditorMode(AnnotationEditorType.NONE);
      if (mode === "highlight") {
        void highlightCurrentSelectionFromToolbar(event.detail > 0);
        return;
      }
      if (mode === "ink") {
        setEditorMode(AnnotationEditorType.INK);
        openAnnotationSizePopover(inkThicknessControl, button);
      }
      if (mode === "text") setEditorMode(AnnotationEditorType.FREETEXT);
    });
  }

  installInkEraserInteractions();

  highlightColorInput.addEventListener("input", () => {
    setHighlightColor(highlightColorInput.value, false);
  });

  highlightColorInput.addEventListener("change", () => {
    setHighlightColor(highlightColorInput.value);
  });

  for (const button of highlightColorHistoryButtons) {
    button.addEventListener("click", () => {
      const color = button.dataset.highlightColor;
      if (color) setHighlightColor(color);
    });
  }

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
      const createdEditor = await createQuickHighlight(
        highlightColorInput.value,
      );
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
      contextSelectionCapturedOnPointerDown = false;
      if (
        event.button === 2 &&
        pdfDocument.value &&
        isTextSelectionMode() &&
        !isEditableOrControl(event.target)
      ) {
        saveContextSelection();
        contextSelectionCapturedOnPointerDown = Boolean(
          contextSelectionText.value,
        );
        return;
      }

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

    if (!contextSelectionCapturedOnPointerDown) saveContextSelection();
    contextSelectionCapturedOnPointerDown = false;
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
      event.button === 0 ? getPointerHighlight(event) : null;
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
    if (isHighlightEditor(editor)) {
      selectAnnotation(editor, false);
    } else {
      selectAnnotation(editor);
    }
    if (isHighlightEditor(editor) && getHighlightNote(editor))
      toggleHighlightNote(editor);
  });

  document.addEventListener("pointerdown", (event) => {
    if (isInkMode()) return;

    const annotationAtPoint =
      event instanceof PointerEvent ? getPointerHighlight(event) : null;
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
}
