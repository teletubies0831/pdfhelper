import {
  currentFileHandle,
  hasUnsavedChanges,
  isSavingAnnotatedPdf,
  pdfDocument,
} from "../../app/viewer-state";
import { autoSaveAnnotationsInput } from "../../app/viewer-elements";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";

const AUTO_SAVE_ANNOTATIONS_STORAGE_KEY =
  "pdf-helper-auto-save-annotations-v1";
const AUTO_SAVE_DELAY_MS = 1_500;

let autoSaveTimer: number | null = null;
let autoSaveHandler: (() => Promise<boolean>) | null = null;
let initialized = false;
let autoSaveEnabled = readJsonValue<boolean>(
  AUTO_SAVE_ANNOTATIONS_STORAGE_KEY,
  false,
);

export function isAnnotationAutoSaveEnabled(): boolean {
  return autoSaveEnabled;
}

export function cancelScheduledAnnotationAutoSave(): void {
  if (autoSaveTimer === null) return;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
}

async function hasAutomaticWritePermission(): Promise<boolean> {
  const handle = currentFileHandle.value;
  if (!handle?.queryPermission) return false;
  try {
    return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

async function runAnnotationAutoSave(): Promise<void> {
  autoSaveTimer = null;
  if (
    !autoSaveHandler ||
    !isAnnotationAutoSaveEnabled() ||
    !pdfDocument.value ||
    !hasUnsavedChanges.value ||
    isSavingAnnotatedPdf.value ||
    !(await hasAutomaticWritePermission())
  ) {
    return;
  }
  await autoSaveHandler();
}

export function scheduleAnnotationAutoSave(): void {
  cancelScheduledAnnotationAutoSave();
  if (!isAnnotationAutoSaveEnabled() || !hasUnsavedChanges.value) return;
  autoSaveTimer = window.setTimeout(
    () => void runAnnotationAutoSave(),
    AUTO_SAVE_DELAY_MS,
  );
}

export function initializeAnnotationAutoSave(
  saveHandler: () => Promise<boolean>,
): void {
  autoSaveHandler = saveHandler;
  autoSaveAnnotationsInput.checked = isAnnotationAutoSaveEnabled();
  if (initialized) return;
  initialized = true;
  autoSaveAnnotationsInput.addEventListener("change", () => {
    autoSaveEnabled = autoSaveAnnotationsInput.checked;
    try {
      writeJsonValue(
        AUTO_SAVE_ANNOTATIONS_STORAGE_KEY,
        autoSaveEnabled,
      );
    } catch {
      // Keep the in-memory preference usable when browser storage is blocked.
    }
    if (autoSaveAnnotationsInput.checked) scheduleAnnotationAutoSave();
    else cancelScheduledAnnotationAutoSave();
  });
}
