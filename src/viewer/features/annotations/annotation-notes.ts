import { AnnotationEditorType } from "pdfjs-dist";
















import { annotationActionBar, annotationTypeLabel, contextCleanCopyButton, contextColors, contextCopyButton, contextDeleteHighlightButton, contextNoteButton, deleteHighlightNoteButton, editorModeButtons, freeTextSizeControl, highlightColorInput, highlightContextActions, highlightNotePopover, highlightNoteQuote, highlightNoteText, highlightNoteTitle, selectionContextMenu, textStatus, viewerElement } from "../../app/viewer-elements";
import { activeEditorMode, annotationEditor, contextHighlightEditor, contextSelectionRanges, contextSelectionText, nativeAnnotationNotes, openHighlightNoteEditor, pdfDocument, pdfViewer, restoredHelperNotesBySignature, selectedAnnotationEditor, selectedHighlightEditor } from "../../app/viewer-state";
import { setStatus } from "../recent-files/public";
import { forgetHelperNote, getAnnotationGeometrySignature, getEditorSerializedValue, getEditorStorageKeys, getRememberedHelperNote, isFreeTextEditor, isHighlightEditor, isInkEditor, isRecord, isStoredHighlightValue, markUnsavedChanges, normalizeStorageKey, rememberHelperNote } from "./annotation-persistence";
import { getViewerSelectionRawText } from "../../core/pdf-reader/public";
import { findAnnotationEditor, findHighlightNoteAnchor, setHighlightColor, syncFreeTextControls } from './annotation-editor';




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
  return editor?.div?.getAttribute("aria-label")?.trim() || "";
}



export function getEditorAnnotationId(editor: any): string {
  return (
    (typeof editor?.id === "string" && editor.id) ||
    (typeof editor?.uid === "string" && editor.uid) ||
    (typeof editor?.annotationElementId === "string" &&
      editor.annotationElementId) ||
    (typeof editor?._initialData?.annotationElementId === "string" &&
      editor._initialData.annotationElementId) ||
    (typeof editor?._initialData?.id === "string" && editor._initialData.id) ||
    ""
  );
}



export function extractCommentText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.contents === "string") return value.contents.trim();
  if (typeof value.str === "string") return value.str.trim();
  if (typeof value.richText?.str === "string") return value.richText.str.trim();
  if (typeof value.contentsObj?.str === "string")
    return value.contentsObj.str.trim();
  return "";
}



export function getAnnotationNoteFromValue(value: unknown): string {
  if (!isRecord(value)) return "";
  return (
    extractCommentText(value.pdfHelperNote) ||
    extractCommentText(value.comment) ||
    extractCommentText(value.popup) ||
    extractCommentText(value.contentsObj) ||
    extractCommentText(value.richText) ||
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

    if (getEditorStorageKeys(editor).includes(normalizedKey)) return editor;

    const editorSignature = getAnnotationGeometrySignature(
      getEditorSerializedValue(editor),
    );
    if (signature && editorSignature === signature) return editor;
  }

  return null;
}



export function getStoredOrLiveAnnotationNote(
  key: string,
  value: Record<string, unknown>,
): string {
  const storedNote = getAnnotationNoteFromValue(value);
  if (storedNote) return storedNote;

  const liveEditor = findLiveEditorForSerializedEntry(key, value);
  if (!liveEditor) return "";

  return getHighlightNote(liveEditor);
}



export function getHighlightNote(editor: any): string {
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
    (geometrySignature
      ? restoredHelperNotesBySignature.get(geometrySignature)?.trim()
      : "") ||
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

  let indicator = container.querySelector<HTMLElement>(
    ".pdf-helper-note-indicator",
  );
  if (!getHighlightNote(editor)) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "pdf-helper-note-indicator";
    indicator.textContent = "●";
    indicator.setAttribute("aria-label", "此高亮有笔记");
    container.append(indicator);
  }

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
  annotationEditor.value.setSelected(editor);
  selectedAnnotationEditor.value = editor;
  selectedHighlightEditor.value = isHighlightEditor(editor) ? editor : null;
  if (selectedHighlightEditor.value) updateHighlightNoteIndicator(editor);
  if (showActions) showAnnotationActionBar(editor);
}



export function selectHighlight(editor: any) {
  selectAnnotation(editor);
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



export function showHighlightNote(editor: any, focusEditor = false) {
  if (!editor?.div) return;
  selectHighlight(editor);
  const note = getHighlightNote(editor);
  openHighlightNoteEditor.value = editor;
  highlightNoteTitle.textContent = note ? "高亮笔记" : "添加笔记";
  highlightNoteQuote.textContent = getHighlightText(editor);
  highlightNoteText.value = note;
  deleteHighlightNoteButton.hidden = !note;
  positionFloatingElement(
    highlightNotePopover,
    editor.div.getBoundingClientRect(),
  );
  if (focusEditor) highlightNoteText.focus();
}



export function hideHighlightNote() {
  highlightNotePopover.hidden = true;
  openHighlightNoteEditor.value = null;
}



export function toggleHighlightNote(editor: any) {
  if (openHighlightNoteEditor.value === editor && !highlightNotePopover.hidden) {
    hideHighlightNote();
    return;
  }
  showHighlightNote(editor);
}



export function saveHighlightNote() {
  if (!selectedHighlightEditor.value) return;
  const text = highlightNoteText.value.trim();
  selectedHighlightEditor.value.comment = text || null;
  selectedHighlightEditor.value.pdfHelperNote = text || "";
  selectedHighlightEditor.value._pdfHelperNote = text || "";
  const annotationId = getEditorAnnotationId(selectedHighlightEditor.value);
  const signature = getAnnotationGeometrySignature(
    getEditorSerializedValue(selectedHighlightEditor.value),
  );
  const storageKeys = getEditorStorageKeys(selectedHighlightEditor.value);
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
  selectedHighlightEditor.value.addToAnnotationStorage?.();
  updateHighlightNoteIndicator(selectedHighlightEditor.value);
  markUnsavedChanges();
  setStatus(text ? "高亮笔记已保存。" : "高亮笔记已删除。");
  hideHighlightNote();
}



export function deleteSelectedAnnotation() {
  if (!annotationEditor.value || !selectedAnnotationEditor.value) return;
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



export function saveContextSelection() {
  const selection = window.getSelection();
  contextSelectionRanges.value = [];
  contextSelectionText.value = "";
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  )
    return;

  contextSelectionText.value = getViewerSelectionRawText();
  for (let index = 0; index < selection.rangeCount; index += 1) {
    contextSelectionRanges.value.push(selection.getRangeAt(index).cloneRange());
  }
}



export function restoreContextSelection() {
  const selection = window.getSelection();
  if (!selection || contextSelectionRanges.value.length === 0) return false;
  selection.removeAllRanges();
  for (const range of contextSelectionRanges.value) selection.addRange(range);
  return true;
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
  const isHighlightMenu = Boolean(editor);
  contextCopyButton.hidden = isHighlightMenu;
  contextCleanCopyButton.hidden = isHighlightMenu;
  contextColors.hidden = isHighlightMenu;
  highlightContextActions.hidden = false;
  contextDeleteHighlightButton.hidden = !isHighlightMenu;
  contextNoteButton.textContent =
    editor && getHighlightNote(editor) ? "编辑笔记" : "添加笔记";

  if (editor) {
    contextSelectionText.value = getHighlightText(editor);
  }

  selectionContextMenu.hidden = false;
  const menuRect = selectionContextMenu.getBoundingClientRect();
  selectionContextMenu.style.left = `${Math.min(clientX, window.innerWidth - menuRect.width - 8)}px`;
  selectionContextMenu.style.top = `${Math.min(clientY, window.innerHeight - menuRect.height - 8)}px`;
}



export async function createQuickHighlight(color: string): Promise<any | null> {
  if (!annotationEditor.value || !restoreContextSelection()) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const anchorNode = selection.anchorNode;
  const anchorElement =
    anchorNode?.nodeType === Node.TEXT_NODE
      ? anchorNode.parentElement
      : (anchorNode as Element | null);
  const textLayer = anchorElement?.closest<HTMLElement>(".textLayer");
  const pageElement = textLayer?.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!textLayer || !Number.isInteger(pageNumber) || pageNumber < 1)
    return null;

  const pageIndex = pageNumber - 1;
  const editorsBefore = new Set(annotationEditor.value.getEditors(pageIndex));
  annotationEditor.value.unselectAll();
  selectedAnnotationEditor.value = null;
  selectedHighlightEditor.value = null;
  hideAnnotationActionBar();
  hideSelectionContextMenu();

  try {
    await annotationEditor.value.updateMode(
      AnnotationEditorType.HIGHLIGHT,
      null,
      true,
    );
    if (!restoreContextSelection())
      throw new Error("文字选区已经失效，请重新选择。");
    setHighlightColor(color);
    annotationEditor.value.highlightSelection("context_menu");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    await annotationEditor.value.updateMode(AnnotationEditorType.NONE, null, true);
    setEditorMode(AnnotationEditorType.NONE);
    clearDomSelection();
  }

  const createdEditor = [...annotationEditor.value.getEditors(pageIndex)].find(
    (editor) => !editorsBefore.has(editor) && isHighlightEditor(editor),
  );

  if (!createdEditor) {
    setStatus("快速高亮创建失败，请重新选择文字后再试。", true);
    return null;
  }

  setStatus("高亮已创建，当前仍为移动/选择模式。");
  markUnsavedChanges();
  return createdEditor;
}



export async function highlightCurrentSelectionFromToolbar() {
  saveContextSelection();

  if (!contextSelectionText.value.trim()) {
    setEditorMode(AnnotationEditorType.NONE);
    setStatus("请先用鼠标选中文字，再点击“高亮”。", true);
    return;
  }

  await createQuickHighlight(highlightColorInput.value);
}



let editorModeTransitionTimeout: number | null = null;

export function finishEditorModeTransition(): void {
  viewerElement.classList.remove("pdf-helper-editor-mode-transition");
  if (editorModeTransitionTimeout !== null) {
    window.clearTimeout(editorModeTransitionTimeout);
    editorModeTransitionTimeout = null;
  }
}

export function setEditorMode(mode: number) {
  if (!pdfDocument.value) return;
  const modeWillChange = activeEditorMode.value !== mode;
  if (modeWillChange) {
    viewerElement.classList.add("pdf-helper-editor-mode-transition");
    if (editorModeTransitionTimeout !== null) {
      window.clearTimeout(editorModeTransitionTimeout);
    }
    // PDF.js normally emits annotationeditormodechanged after the affected
    // pages have rendered. Keep a timeout only as a fail-safe for interrupted
    // document loads so the transition class can never become permanent.
    editorModeTransitionTimeout = window.setTimeout(
      finishEditorModeTransition,
      3_000,
    );
  }
  pdfViewer.annotationEditorMode = { mode };
  activeEditorMode.value = mode;
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
    button.classList.toggle(
      "active",
      modeNames[button.dataset.editorMode || ""] === mode,
    );
  }

  if (mode === AnnotationEditorType.NONE) {
    textStatus.textContent =
      "选择模式：拖选可复制；单击批注后拖动，双击文本可修改";
  } else if (mode === AnnotationEditorType.HIGHLIGHT) {
    textStatus.textContent =
      "高亮模式：拖选文字生成高亮；完成后切回“移动/选择”";
  } else if (mode === AnnotationEditorType.INK) {
    textStatus.textContent =
      "画笔模式：按住鼠标绘制；完成后切回“移动/选择”再移动";
  } else if (mode === AnnotationEditorType.FREETEXT) {
    textStatus.textContent =
      "文本模式：点击页面输入；点击空白结束，切回“移动/选择”可拖动";
  }
}
