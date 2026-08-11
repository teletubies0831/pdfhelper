

import { hasUnsavedChanges, isOpeningDocument, isSavingAnnotatedPdf, pdfDocument, savedAnnotationSnapshot, unsavedChangesCheckHandle } from "../../app/viewer-state";
import { updateControls } from "../../core/pdf-reader/public";


import { getSerializableAnnotationEntries } from "./embedded-helper-payload";

export function getCurrentAnnotationSnapshot(): string {
  if (!pdfDocument.value) return "";

  try {
    const entries = getSerializableAnnotationEntries().sort(
      ([leftKey], [rightKey]) =>
        String(leftKey).localeCompare(String(rightKey)),
    );
    return JSON.stringify(entries);
  } catch (error) {
    console.warn("PDF Helper annotation snapshot failed.", error);
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
}

export function scheduleUnsavedChangesCheck() {
  if (unsavedChangesCheckHandle.value !== null) {
    window.clearTimeout(unsavedChangesCheckHandle.value);
  }

  unsavedChangesCheckHandle.value = window.setTimeout(() => {
    unsavedChangesCheckHandle.value = null;
    updateUnsavedChangesFromSnapshot();
    updateControls();
  }, 0);
}

export function markSavedChanges() {
  if (unsavedChangesCheckHandle.value !== null) {
    window.clearTimeout(unsavedChangesCheckHandle.value);
    unsavedChangesCheckHandle.value = null;
  }

  savedAnnotationSnapshot.value = getCurrentAnnotationSnapshot();
  hasUnsavedChanges.value = false;
}
