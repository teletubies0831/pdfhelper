
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
  let label = toggleNotesButton.querySelector<HTMLElement>(
    "[data-toggle-notes-label]",
  );
  if (!label) {
    label = document.createElement("span");
    label.dataset.toggleNotesLabel = "";
    toggleNotesButton.append(label);
  }
  label.textContent = areNoteIndicatorsHidden.value
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

/**
 * 关闭**后台**标签页前的确认.
 *
 * `confirmDiscardUnsavedChanges()` reads the *active* document's flag, so it cannot answer for a background tab. Background
 * tabs do carry unsaved annotations (switching away snapshots them, it does not resolve them), which is why closing one used
 * to discard the user's work without a word.
 */
export function confirmDiscardTabChanges(tabName: string, unsaved: boolean): boolean {
  if (!unsaved) return true;
  return window.confirm(
    `「${tabName}」有未保存的批注或笔记。关闭这个标签页会丢弃这些更改，确定关闭吗？`,
  );
}
