import { requiredElement } from "./required-element";

export const undoAnnotationButton =
  requiredElement<HTMLButtonElement>("undo-annotation");

export const redoAnnotationButton =
  requiredElement<HTMLButtonElement>("redo-annotation");

export const eraseSelectedAnnotationButton =
  requiredElement<HTMLButtonElement>("erase-selected-annotation");

export const smartCopyButton = requiredElement<HTMLButtonElement>("smart-copy");

export const saveAnnotatedPdfButton =
  requiredElement<HTMLButtonElement>("save-annotated-pdf");

export const toggleNotesButton = requiredElement<HTMLButtonElement>("toggle-notes");

export const highlightColorInput =
  requiredElement<HTMLInputElement>("highlight-color");

export const highlightColorHistoryButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(
    "[data-highlight-color-history-index]",
  ),
);

export const freeTextSizeInput = requiredElement<HTMLInputElement>("free-text-size");

export const freeTextColorInput = requiredElement<HTMLInputElement>("free-text-color");

export const freeTextSizeDownButton = requiredElement<HTMLButtonElement>(
  "free-text-size-down",
);

export const freeTextSizeUpButton =
  requiredElement<HTMLButtonElement>("free-text-size-up");

export const selectionContextMenu = requiredElement<HTMLElement>(
  "selection-context-menu",
);

export const contextCopyButton = requiredElement<HTMLButtonElement>("context-copy");

export const contextCleanCopyButton =
  requiredElement<HTMLButtonElement>("context-clean-copy");

export const contextColors = requiredElement<HTMLElement>("context-colors");

export const highlightContextActions = requiredElement<HTMLElement>(
  "highlight-context-actions",
);

export const contextNoteButton = requiredElement<HTMLButtonElement>("context-note");

export const contextDeleteHighlightButton = requiredElement<HTMLButtonElement>(
  "context-delete-highlight",
);

export const highlightNotePopover = requiredElement<HTMLElement>(
  "highlight-note-popover",
);

export const highlightNoteTitle = requiredElement<HTMLElement>("highlight-note-title");

export const highlightNoteQuote = requiredElement<HTMLElement>("highlight-note-quote");

export const highlightNoteText = requiredElement<HTMLTextAreaElement>(
  "highlight-note-text",
);

export const closeHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "close-highlight-note",
);

export const deleteHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "delete-highlight-note",
);

export const saveHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "save-highlight-note",
);

export const annotationActionBar = requiredElement<HTMLElement>(
  "annotation-action-bar",
);

export const annotationTypeLabel = requiredElement<HTMLElement>(
  "annotation-type-label",
);

export const deleteAnnotationButton =
  requiredElement<HTMLButtonElement>("delete-annotation");

export const freeTextSizeControl = requiredElement<HTMLElement>(
  "free-text-size-control",
);

export const quickHighlightButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(
    "[data-quick-highlight-color-history-index]",
  ),
);

export const editorModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-editor-mode]"),
);
