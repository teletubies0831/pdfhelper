

import { hasUnsavedChanges, isOpeningDocument, isSavingAnnotatedPdf, pdfDocument, savedAnnotationSnapshot, unsavedChangesCheckHandle } from "../../app/viewer-state";
import { updateControls } from "../../core/pdf-reader/public";


import { getSerializableAnnotationEntries } from "./embedded-helper-payload";
import {
  cancelScheduledAnnotationAutoSave,
  scheduleAnnotationAutoSave,
} from "./annotation-auto-save";

export function getCurrentAnnotationSnapshot(): string {
  if (!pdfDocument.value) return "";

  try {
    const entries = getSerializableAnnotationEntries().sort(
      ([leftKey], [rightKey]) =>
        String(leftKey).localeCompare(String(rightKey)),
    );
    return JSON.stringify(entries);
  } catch (error) {
    console.warn("PDFPal annotation snapshot failed.", error);
    return "";
  }
}

export function updateUnsavedChangesFromSnapshot() {
  if (!pdfDocument.value || isSavingAnnotatedPdf.value || isOpeningDocument.value) return;
  hasUnsavedChanges.value =
    getCurrentAnnotationSnapshot() !== savedAnnotationSnapshot.value;
}

export function markUnsavedChanges() {
  updateUnsavedChangesFromSnapshot();
  updateControls();
  scheduleAnnotationAutoSave();
}

export function scheduleUnsavedChangesCheck() {
  if (unsavedChangesCheckHandle.value !== null) {
    window.clearTimeout(unsavedChangesCheckHandle.value);
  }

  unsavedChangesCheckHandle.value = window.setTimeout(() => {
    unsavedChangesCheckHandle.value = null;
    updateUnsavedChangesFromSnapshot();
    updateControls();
    scheduleAnnotationAutoSave();
  }, 0);
}

/**
 * Records that the current annotations are now in the file.
 *
 * `snapshot` is what was actually embedded, captured at that moment. Re-reading the storage here instead (the previous
 * behaviour) meant edits made while the file was being written — pdf-lib load/save plus a possible permission prompt,
 * hundreds of milliseconds to seconds — were stamped as saved even though the file did not contain them: no unsaved
 * marker, no close-tab prompt, and the work was lost silently.
 */
export function markSavedChanges(snapshot: string = getCurrentAnnotationSnapshot()) {
  if (unsavedChangesCheckHandle.value !== null) {
    window.clearTimeout(unsavedChangesCheckHandle.value);
    unsavedChangesCheckHandle.value = null;
  }

  savedAnnotationSnapshot.value = snapshot;
  // Anything newer than the write stays unsaved, so the marker, the close prompt and auto-save all keep working.
  hasUnsavedChanges.value = getCurrentAnnotationSnapshot() !== snapshot;
  cancelScheduledAnnotationAutoSave();
  if (hasUnsavedChanges.value) scheduleAnnotationAutoSave();
  updateControls();
}

/**
 * Re-establishes "saved vs unsaved" after the viewer switches to another tab.
 *
 * Each tab keeps its own baseline: an edit made in tab A before the switch must still be unsaved when A comes back, and
 * stamping the current state as saved (the previous behaviour) both hid the change and silenced the close prompt while
 * the tab strip kept showing ●.
 */
export function restoreAnnotationSaveState(
  savedSnapshot: string,
  hasUnsaved: boolean,
): void {
  if (unsavedChangesCheckHandle.value !== null) {
    window.clearTimeout(unsavedChangesCheckHandle.value);
    unsavedChangesCheckHandle.value = null;
  }
  savedAnnotationSnapshot.value = savedSnapshot;
  hasUnsavedChanges.value = hasUnsaved;
  if (hasUnsaved) scheduleAnnotationAutoSave();
  updateControls();
}
