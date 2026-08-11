
import { toggleNotesButton, viewerElement } from "../../app/viewer-elements";
import { areNoteIndicatorsHidden, hasUnsavedChanges } from "../../app/viewer-state";

import { hideHighlightNote } from "./annotations";



export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function updateNoteIndicatorsVisibility() {
  viewerElement.classList.toggle(
    "pdf-helper-notes-hidden",
    areNoteIndicatorsHidden.value,
  );
  toggleNotesButton.textContent = areNoteIndicatorsHidden.value
    ? "显示笔记"
    : "隐藏笔记";
  if (areNoteIndicatorsHidden.value) hideHighlightNote();
}

export function confirmDiscardUnsavedChanges(): boolean {
  if (!hasUnsavedChanges.value) return true;
  return window.confirm(
    "当前 PDF 有未保存的批注或笔记。是否放弃这些更改并继续？",
  );
}
