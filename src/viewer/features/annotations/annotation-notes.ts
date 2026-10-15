import { annotationActionBar, annotationTypeLabel, contextCleanCopyButton, contextColors, contextCopyButton, contextDeleteHighlightButton, contextNoteButton, deleteHighlightNoteButton, freeTextSizeControl, highlightContextActions, highlightNotePopover, highlightNoteQuote, highlightNoteText, highlightNoteTitle, selectionContextMenu, viewerElement } from "../../app/viewer-elements";
import { annotationEditor, contextHighlightEditor, contextSelectionText, nativeAnnotationNotes, openHighlightNoteEditor, pdfDocument, selectedAnnotationEditor, selectedHighlightEditor } from "../../app/viewer-state";
import { setStatus } from "../../app/status-bar";
import { forgetHelperNote, getAnnotationGeometrySignature, getEditorSerializedValue, getEditorStorageKeys, getRememberedHelperNote, isFreeTextEditor, isHighlightEditor, isInkEditor, isRecord, isStoredHighlightValue, markUnsavedChanges, normalizeStorageKey, rememberHelperNote } from "./annotation-persistence";
import { findAnnotationEditor, findHighlightNoteAnchor, syncFreeTextControls } from './annotation-editor';
import { getHighlightEditorText, getStoredHighlightText, setHighlightEditorText } from "./annotation-highlight-content";
import { getRememberedHighlightText } from "./annotation-highlight-index";
import { extractCommentText, getAnnotationNoteFromValue } from "./annotation-comment-content";

export function clearDomSelection() {
  window.getSelection()?.removeAllRanges();
}



export function clearSelectedAnnotationState() {
  annotationEditor.value?.unselectAll();
  selectedAnnotationEditor.value = null;
  selectedHighlightEditor.value = null;
  contextHighlightEditor.value = null;
  hideSelectionContextMenu();
  hideHighlightNote();
  hideAnnotationActionBar();
}



export function findHighlightEditor(target: EventTarget | null): any | null {
  const editor = findAnnotationEditor(target, { includeHighlight: true });
  return isHighlightEditor(editor) ? editor : null;
}



export function getHighlightText(editor: any): string {
  const directText = getHighlightEditorText(editor);
  if (directText) return directText;

  const signature = getAnnotationGeometrySignature(
    getEditorSerializedValue(editor),
  );
  const rememberedText = getRememberedHighlightText(
    getEditorStorageKeys(editor),
    signature,
  );
  return rememberedText
    ? setHighlightEditorText(editor, rememberedText)
    : "";
}



export function getStoredOrLiveHighlightText(
  key: string,
  value: Record<string, unknown>,
): string {
  const storedText = getStoredHighlightText(value);
  if (storedText) return storedText;

  const liveEditor = findLiveEditorForSerializedEntry(key, value);
  return liveEditor ? getHighlightText(liveEditor) : "";
}



export function getEditorAnnotationId(editor: any): string {
  return (
    (typeof editor?.annotationElementId === "string" &&
      editor.annotationElementId) ||
    (typeof editor?._initialData?.annotationElementId === "string" &&
      editor._initialData.annotationElementId) ||
    (typeof editor?._initialData?.id === "string" &&
      !/^pdfjs_internal_editor_/.test(editor._initialData.id) && editor._initialData.id) ||
    ""
  );
}



export function findLiveEditorForSerializedEntry(
  key: string,
  value: Record<string, unknown>,
): any | null {
  if (!annotationEditor.value || !Number.isInteger(value.pageIndex)) return null;

  const normalizedKey = normalizeStorageKey(key);
  const signature = getAnnotationGeometrySignature(value);
  const pageIndex = value.pageIndex as number;

  for (const editor of annotationEditor.value.getEditors(pageIndex)) {
    if (isStoredHighlightValue(value) && !isHighlightEditor(editor)) continue;

    const editorSignature = getAnnotationGeometrySignature(
      getEditorSerializedValue(editor),
    );
    if (signature && editorSignature === signature) return editor;
    if (signature && editorSignature) continue;
    if (getEditorStorageKeys(editor).includes(normalizedKey)) return editor;
  }

  return null;
}



export function getStoredOrLiveAnnotationNote(
  key: string,
  value: Record<string, unknown>,
): string {
  if (typeof value.pdfHelperNote === "string") return value.pdfHelperNote.trim();
  if (isRecord(value.comment) && value.comment.deleted === true) return "";
  const storedNote = getAnnotationNoteFromValue(value);
  if (storedNote) return storedNote;

  const liveEditor = findLiveEditorForSerializedEntry(key, value);
  if (!liveEditor) return "";

  return getHighlightNote(liveEditor);
}



export function getHighlightNote(editor: any): string {
  if (typeof editor?.pdfHelperNote === "string") return editor.pdfHelperNote.trim();
  if (typeof editor?._pdfHelperNote === "string") return editor._pdfHelperNote.trim();
  if (editor?.comment?.deleted === true) return "";
  if (typeof editor?._initialData?.pdfHelperNote === "string" && !extractCommentText(editor?.comment)) {
    return editor._initialData.pdfHelperNote.trim();
  }
  const annotationId = getEditorAnnotationId(editor);
  const geometrySignature = getAnnotationGeometrySignature(
    getEditorSerializedValue(editor),
  );
  const storageKeys = getEditorStorageKeys(editor);
  const note =
    extractCommentText(editor?.pdfHelperNote) ||
    extractCommentText(editor?._pdfHelperNote) ||
    extractCommentText(editor?.comment) ||
    extractCommentText(editor?._initialData?.pdfHelperNote) ||
    extractCommentText(editor?._initialData?.comment) ||
    extractCommentText(editor?._initialData?.contentsObj) ||
    extractCommentText(editor?._initialData?.richText) ||
    extractCommentText(editor?.data?.pdfHelperNote) ||
    extractCommentText(editor?.data?.contentsObj) ||
    getRememberedHelperNote(storageKeys, geometrySignature) ||
    (annotationId ? nativeAnnotationNotes.get(annotationId)?.trim() : "") ||
    "";

  if (note) {
    editor.pdfHelperNote = note;
    editor._pdfHelperNote = note;
    for (const key of storageKeys)
      rememberHelperNote(key, geometrySignature, note);
  }

  return note;
}



export function collectNativeAnnotationNotes(pageNumber?: number) {
  const pageSelector =
    typeof pageNumber === "number"
      ? `.page[data-page-number="${pageNumber}"]`
      : ".page";

  for (const page of Array.from(
    viewerElement.querySelectorAll<HTMLElement>(pageSelector),
  )) {
    const highlightAnnotations = page.querySelectorAll<HTMLElement>(
      ".annotationLayer .highlightAnnotation[data-annotation-id]",
    );

    for (const highlightAnnotation of Array.from(highlightAnnotations)) {
      const annotationId = highlightAnnotation.dataset.annotationId;
      if (!annotationId) continue;

      const ownPopupText = highlightAnnotation
        .querySelector<HTMLElement>(".popupContent")
        ?.textContent?.trim();
      const nextPopup = highlightAnnotation.nextElementSibling;
      const siblingPopupText = nextPopup?.classList.contains("popupAnnotation")
        ? nextPopup
            .querySelector<HTMLElement>(".popupContent")
            ?.textContent?.trim()
        : "";
      const note = ownPopupText || siblingPopupText || "";

      if (note) {
        nativeAnnotationNotes.set(annotationId, note);
      }
    }
  }
}



export function updateHighlightNoteIndicator(editor: any) {
  const container = editor?.div as HTMLDivElement | null;
  if (!container) return;

  const note = getHighlightNote(editor);

  let indicator = container.querySelector<HTMLElement>(
    ".pdf-helper-note-indicator",
  );
  if (!note) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    indicator = document.createElement("button");
    indicator.setAttribute("type", "button");
    indicator.className = "pdf-helper-note-indicator";
    const icon = document.createElement("img");
    icon.className = "pdf-helper-note-icon";
    icon.src = "/resources/note-marker.svg?v=yellow-1";
    icon.alt = "";
    icon.draggable = false;
    const preview = document.createElement("span");
    preview.className = "pdf-helper-note-preview";
    preview.setAttribute("role", "tooltip");
    indicator.append(icon);
    indicator.append(preview);
    indicator.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    indicator.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHighlightNote(editor);
    });
    container.append(indicator);
  }

  const preview = indicator.querySelector<HTMLElement>(
    ".pdf-helper-note-preview",
  );
  if (preview) preview.textContent = note;

  const isOpen =
    openHighlightNoteEditor.value === editor && !highlightNotePopover.hidden;
  indicator.classList.toggle("is-open", isOpen);
  indicator.setAttribute(
    "aria-label",
    isOpen ? "关闭笔记编辑" : `编辑笔记：${note}`,
  );

  const anchor = findHighlightNoteAnchor(container);
  if (anchor) {
    indicator.style.left = `${anchor.x}px`;
    indicator.style.top = `${anchor.y}px`;
  } else {
    indicator.style.left = "";
    indicator.style.top = "";
  }
}



export function refreshHighlightNoteIndicators(pageNumber?: number) {
  if (!annotationEditor.value) return;
  collectNativeAnnotationNotes(pageNumber);

  const pageIndexes =
    typeof pageNumber === "number"
      ? [pageNumber - 1]
      : Array.from({ length: pdfDocument.value?.numPages ?? 0 }, (_, index) => index);

  for (const pageIndex of pageIndexes) {
    if (pageIndex < 0) continue;
    for (const editor of annotationEditor.value.getEditors(pageIndex)) {
      if (isHighlightEditor(editor)) updateHighlightNoteIndicator(editor);
    }
  }
}



let highlightNoteIndicatorRefreshFrame = 0;
let refreshAllHighlightNoteIndicators = false;
const pendingHighlightNoteIndicatorPages = new Set<number>();

export function scheduleHighlightNoteIndicatorRefresh(pageNumber?: number) {
  if (typeof pageNumber === "number") {
    if (!refreshAllHighlightNoteIndicators) {
      pendingHighlightNoteIndicatorPages.add(pageNumber);
    }
  } else {
    refreshAllHighlightNoteIndicators = true;
    pendingHighlightNoteIndicatorPages.clear();
  }

  if (highlightNoteIndicatorRefreshFrame) return;

  highlightNoteIndicatorRefreshFrame = requestAnimationFrame(() => {
    highlightNoteIndicatorRefreshFrame = 0;

    if (refreshAllHighlightNoteIndicators) {
      refreshAllHighlightNoteIndicators = false;
      pendingHighlightNoteIndicatorPages.clear();
      refreshHighlightNoteIndicators();
      return;
    }

    const pageNumbers = [...pendingHighlightNoteIndicatorPages];
    pendingHighlightNoteIndicatorPages.clear();
    for (const pendingPageNumber of pageNumbers) {
      refreshHighlightNoteIndicators(pendingPageNumber);
    }
  });
}



export function getAnnotationTypeName(editor: any): string {
  if (isHighlightEditor(editor)) return "高亮";
  if (isFreeTextEditor(editor)) return "文本";
  if (isInkEditor(editor)) return "画笔";
  return "批注";
}



export function hideAnnotationActionBar() {
  annotationActionBar.hidden = true;
  freeTextSizeControl.hidden = true;
}



export function showAnnotationActionBar(editor: any) {
  if (!editor?.div) return;
  const isTextEditor = isFreeTextEditor(editor);
  annotationTypeLabel.hidden = true;
  freeTextSizeControl.hidden = !isTextEditor;
  if (isTextEditor) syncFreeTextControls(editor);
  annotationTypeLabel.textContent = `${getAnnotationTypeName(editor)}批注`;
  annotationActionBar.hidden = false;
  const anchor = editor.div.getBoundingClientRect();
  const rect = annotationActionBar.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, anchor.right - rect.width),
    window.innerWidth - rect.width - 8,
  );
  const preferredTop = anchor.top - rect.height - 8;
  const top =
    preferredTop >= 8
      ? preferredTop
      : Math.min(anchor.bottom + 8, window.innerHeight - rect.height - 8);
  annotationActionBar.style.left = `${left}px`;
  annotationActionBar.style.top = `${top}px`;
}



export function selectAnnotation(editor: any, showActions = true) {
  if (!annotationEditor.value || !editor) return;
  // Ink is edited exclusively by the pen/eraser workflow. Let pointer input
  // pass through to the PDF text layer and never expose the generic Delete UI.
  if (isInkEditor(editor)) {
    annotationEditor.value.unselectAll();
    selectedAnnotationEditor.value = null;
    selectedHighlightEditor.value = null;
    hideAnnotationActionBar();
    return;
  }
  annotationEditor.value.setSelected(editor);
  selectedAnnotationEditor.value = editor;
  selectedHighlightEditor.value = isHighlightEditor(editor) ? editor : null;
  if (selectedHighlightEditor.value) updateHighlightNoteIndicator(editor);
  if (showActions) showAnnotationActionBar(editor);
}



export function selectHighlight(editor: any) {
  selectAnnotation(editor, false);
}



export function positionFloatingElement(element: HTMLElement, anchor: DOMRect) {
  element.hidden = false;
  const rect = element.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, anchor.right + 10),
    window.innerWidth - rect.width - 8,
  );
  const top = Math.min(
    Math.max(8, anchor.top),
    window.innerHeight - rect.height - 8,
  );
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}


export function installHighlightNoteTextEditingProtection() {
  highlightNoteText.addEventListener("focus", () => {
    // PDF.js otherwise keeps the highlight selected while its note is edited.
    // Keep selectedHighlightEditor for saving, but clear the PDF.js selection
    // so its Delete shortcut cannot remove the annotation.
    annotationEditor.value?.unselectAll();
    selectedAnnotationEditor.value = null;
    hideAnnotationActionBar();
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target === highlightNoteText &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        // Preserve the textarea's default deletion while preventing PDF.js
        // document-level shortcuts from receiving the same key event.
        event.stopPropagation();
      }
    },
    true,
  );
}



export function showHighlightNote(editor: any, focusEditor = false) {
  if (!editor?.div) return;
  if (
    openHighlightNoteEditor.value &&
    openHighlightNoteEditor.value !== editor
  ) {
    hideHighlightNote();
  }
  selectAnnotation(editor, false);
  const note = getHighlightNote(editor);
  openHighlightNoteEditor.value = editor;
  highlightNoteTitle.textContent = note ? "高亮笔记" : "添加笔记";
  highlightNoteQuote.textContent = getHighlightText(editor);
  highlightNoteText.value = note;
  deleteHighlightNoteButton.hidden = true;
  positionFloatingElement(
    highlightNotePopover,
    editor.div.getBoundingClientRect(),
  );
  updateHighlightNoteIndicator(editor);
  if (focusEditor) highlightNoteText.focus();
}



export function hideHighlightNote() {
  const editor = openHighlightNoteEditor.value;
  highlightNotePopover.hidden = true;
  openHighlightNoteEditor.value = null;
  if (editor) updateHighlightNoteIndicator(editor);
}



export function toggleHighlightNote(editor: any) {
  if (openHighlightNoteEditor.value === editor && !highlightNotePopover.hidden) {
    hideHighlightNote();
    return;
  }
  showHighlightNote(editor);
}



export function saveHighlightNote() {
  // Selection can change while the popover is open. Save to its owner.
  const editor = openHighlightNoteEditor.value;
  if (!editor || highlightNotePopover.hidden) return;
  const text = highlightNoteText.value.trim();
  editor.comment = text || null;
  editor.pdfHelperNote = text;
  editor._pdfHelperNote = text;
  const annotationId = getEditorAnnotationId(editor);
  const signature = getAnnotationGeometrySignature(
    getEditorSerializedValue(editor),
  );
  const storageKeys = getEditorStorageKeys(editor);
  if (annotationId) {
    if (text) {
      nativeAnnotationNotes.set(annotationId, text);
    } else {
      nativeAnnotationNotes.delete(annotationId);
    }
  }
  for (const key of storageKeys) {
    if (text) {
      rememberHelperNote(key, signature, text);
    } else {
      forgetHelperNote(key, signature);
    }
  }
  if (storageKeys.length === 0 && signature) {
    if (text) rememberHelperNote(undefined, signature, text);
    else forgetHelperNote(undefined, signature);
  }
  editor.addToAnnotationStorage?.();
  updateHighlightNoteIndicator(editor);
  markUnsavedChanges();
  setStatus(text ? "高亮笔记已保存。" : "高亮笔记已删除。");
  hideHighlightNote();
}



export function deleteSelectedAnnotation() {
  if (!annotationEditor.value || !selectedAnnotationEditor.value) return;
  if (isInkEditor(selectedAnnotationEditor.value)) {
    annotationEditor.value.unselectAll();
    selectedAnnotationEditor.value = null;
    hideAnnotationActionBar();
    setStatus("画笔墨迹请使用橡皮擦删除。", true);
    return;
  }
  const typeName = getAnnotationTypeName(selectedAnnotationEditor.value);
  annotationEditor.value.setSelected(selectedAnnotationEditor.value);
  annotationEditor.value.delete();
  selectedAnnotationEditor.value = null;
  selectedHighlightEditor.value = null;
  contextHighlightEditor.value = null;
  hideHighlightNote();
  hideSelectionContextMenu();
  hideAnnotationActionBar();
  markUnsavedChanges();
  setStatus(`${typeName}批注已删除，可使用撤销恢复。`);
}



export function deleteSelectedHighlight() {
  deleteSelectedAnnotation();
}



export function hideSelectionContextMenu() {
  selectionContextMenu.hidden = true;
}



export function showSelectionContextMenuAt(
  clientX: number,
  clientY: number,
  editor: any | null,
) {
  contextHighlightEditor.value = editor;
  contextCopyButton.hidden = false;
  contextCleanCopyButton.hidden = false;
  contextColors.hidden = false;
  highlightContextActions.hidden = false;
  contextDeleteHighlightButton.hidden = !editor;
  contextNoteButton.textContent =
    editor && getHighlightNote(editor) ? "编辑笔记" : "添加笔记";

  if (editor) {
    contextSelectionText.value = getHighlightText(editor);
  } else {
    annotationEditor.value?.unselectAll();
    selectedAnnotationEditor.value = null;
    selectedHighlightEditor.value = null;
    hideAnnotationActionBar();
  }

  selectionContextMenu.hidden = false;
  const menuRect = selectionContextMenu.getBoundingClientRect();
  selectionContextMenu.style.left = `${Math.min(clientX, window.innerWidth - menuRect.width - 8)}px`;
  selectionContextMenu.style.top = `${Math.min(clientY, window.innerHeight - menuRect.height - 8)}px`;
}


