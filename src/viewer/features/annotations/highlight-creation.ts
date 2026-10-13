import { AnnotationEditorType } from "pdfjs-dist";

import { highlightColorInput, viewerElement } from "../../app/viewer-elements";
import {
  annotationEditor,
  contextSelectionRanges,
  contextSelectionText,
  SELECT_TOOL_EDITOR_BACKING_MODE,
  selectedAnnotationEditor,
  selectedHighlightEditor,
} from "../../app/viewer-state";
import { getViewerSelectionRawText } from "../../core/pdf-reader/public";
import { setStatus } from "../recent-files/public";
import {
  getAnnotationGeometrySignature,
  getEditorSerializedValue,
  getEditorStorageKeys,
  isHighlightEditor,
  markUnsavedChanges,
} from "./annotation-persistence";
import { setHighlightColor } from "./annotation-editor";
import {
  chooseHighlightSelectionText,
  setHighlightEditorText,
} from "./annotation-highlight-content";
import { rememberHighlightText } from "./annotation-highlight-index";
import {
  clearDomSelection,
  hideAnnotationActionBar,
  hideSelectionContextMenu,
} from "./annotation-notes";
import { setEditorMode } from "./annotation-tool-mode";

export function saveContextSelection(): void {
  const selection = window.getSelection();
  contextSelectionRanges.value = [];
  contextSelectionText.value = "";
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  ) {
    return;
  }

  contextSelectionText.value = chooseHighlightSelectionText(
    selection.toString(),
    getViewerSelectionRawText(),
  );
  for (let index = 0; index < selection.rangeCount; index += 1) {
    contextSelectionRanges.value.push(selection.getRangeAt(index).cloneRange());
  }
}

export function restoreContextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || contextSelectionRanges.value.length === 0) return false;
  selection.removeAllRanges();
  for (const range of contextSelectionRanges.value) selection.addRange(range);
  return true;
}

function attachHighlightSelectionText(
  editor: any,
  selectedText: string,
): { signature: string; storageKeys: string[] } {
  const highlightText = setHighlightEditorText(editor, selectedText);
  const signature = getAnnotationGeometrySignature(
    getEditorSerializedValue(editor),
  );
  const storageKeys = getEditorStorageKeys(editor);
  if (!highlightText) return { signature, storageKeys };

  if (storageKeys.length === 0) {
    rememberHighlightText(undefined, signature, highlightText);
  } else {
    for (const key of storageKeys) {
      rememberHighlightText(key, signature, highlightText);
    }
  }
  return { signature, storageKeys };
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
  if (!textLayer || !Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const pageIndex = pageNumber - 1;
  const selectedText = contextSelectionText.value;
  let createdEditor: any | null = null;
  let createdSignature = "";
  let createdStorageKeys: string[] = [];
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
    if (!restoreContextSelection()) {
      throw new Error("文字选区已经失效，请重新选择。");
    }
    setHighlightColor(color);
    // Enabling the mode can deserialize existing annotations. Snapshot only
    // after that work so a restored editor cannot be mistaken for the new one.
    const editorsBefore = new Set(annotationEditor.value.getEditors(pageIndex));
    annotationEditor.value.highlightSelection("context_menu");

    // Bind the exact selection before switching mode. PDF.js may recreate all
    // editor objects during that switch, making reference-based detection pick
    // an arbitrary old highlight.
    createdEditor = [...annotationEditor.value.getEditors(pageIndex)].find(
      (editor) => !editorsBefore.has(editor) && isHighlightEditor(editor),
    ) ?? null;
    if (!createdEditor) {
      throw new Error("快速高亮创建失败，请重新选择文字后再试。");
    }

    const identity = attachHighlightSelectionText(createdEditor, selectedText);
    createdSignature = identity.signature;
    createdStorageKeys = identity.storageKeys;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    await annotationEditor.value.updateMode(
      SELECT_TOOL_EDITOR_BACKING_MODE,
      null,
      true,
    );
    setEditorMode(AnnotationEditorType.NONE);
    clearDomSelection();
  }

  if (!createdEditor) return null;

  const liveEditor = [...annotationEditor.value.getEditors(pageIndex)].find(
    (editor) => {
      if (!isHighlightEditor(editor)) return false;
      if (editor === createdEditor) return true;
      const keys = getEditorStorageKeys(editor);
      if (
        createdStorageKeys.length > 0 &&
        keys.some((key) => createdStorageKeys.includes(key))
      ) {
        return true;
      }
      return Boolean(
        createdSignature &&
        getAnnotationGeometrySignature(getEditorSerializedValue(editor)) ===
          createdSignature,
      );
    },
  ) ?? createdEditor;
  attachHighlightSelectionText(liveEditor, selectedText);

  setStatus("高亮已创建，当前仍为选择模式。");
  markUnsavedChanges();
  return liveEditor;
}

export async function highlightCurrentSelectionFromToolbar(
  selectionCapturedOnPointerDown = false,
): Promise<void> {
  if (!selectionCapturedOnPointerDown) saveContextSelection();

  if (!contextSelectionText.value.trim()) {
    setEditorMode(AnnotationEditorType.NONE);
    setStatus("请先用鼠标选中文字，再点击“高亮”。", true);
    return;
  }

  await createQuickHighlight(highlightColorInput.value);
}
