import {
  clearRecentFilesButton,
  closeRecentFilesButton,
  fileInput,
  openFileButton,
  recentFilesButton,
  recentFilesDialog,
} from "../../viewer-elements";
import { openFindBar } from "../../../core/pdf-reader/public";

import {
  initializeHighlightColorHistory,
  installAnnotationSizePopoverDismissal,
  installHighlightNotePointerHover,
  installHighlightNoteTextEditingProtection,
  installInkThicknessInteractions,
  setHighlightColor,
} from "../../../features/annotations/public";
import {
  hideRecentFilesDialog,
  renderRecentFiles,
  requestFileReadPermission,
  setRecentEntryOpenHandler,
  showRecentFilesDialog,
  writeRecentFiles,
} from "../../../features/recent-files/public";
import { openPdf, openPdfBatch, openRemotePdf } from "../../document-open";

import type { FilePickerWindow } from "../../viewer-types";

export function registerReaderFileOpenEvents(): void {
  // Recent-files knows how to list and bookkeep entries; the actual opening
  // choreography (permissions + document-open) is injected here.
  setRecentEntryOpenHandler(async (entry, requestPermission) => {
    if (entry.kind === "local") {
      if (!entry.fileHandle)
      throw new Error("这条最近记录没有可用的文件句柄，请重新打开一次 PDF。");
      if (requestPermission) {
        const hasPermission = await requestFileReadPermission(entry.fileHandle);
      if (!hasPermission) throw new Error("没有获得读取该 PDF 的权限。");
      }
      const file = await entry.fileHandle.getFile();
      await openPdf(
        await file.arrayBuffer(),
        file.name,
        entry.fileHandle,
        false,
      );
      return;
    }

    if (entry.kind === "remote" && entry.url) {
      await openRemotePdf(entry.url);
      return;
    }

    throw new Error("最近记录无效。");
  });
  setHighlightColor(initializeHighlightColorHistory());
  installHighlightNoteTextEditingProtection();
  installAnnotationSizePopoverDismissal();
  installInkThicknessInteractions();

  for (const searchButton of document.querySelectorAll<HTMLButtonElement>(
    "#outline-search-button, #reader-search-button",
  )) {
    searchButton.addEventListener("click", openFindBar);
  }
  installHighlightNotePointerHover();

  recentFilesButton.addEventListener("click", () => {
    showRecentFilesDialog();
  });

  closeRecentFilesButton.addEventListener("click", () => {
    hideRecentFilesDialog();
  });

  recentFilesDialog.addEventListener("pointerdown", (event) => {
    if (event.target === recentFilesDialog) hideRecentFilesDialog();
  });

  clearRecentFilesButton.addEventListener("click", async () => {
    await writeRecentFiles([]);
    await renderRecentFiles();
  });

  openFileButton.addEventListener("click", async (event) => {
    event.preventDefault();
    // Opening a new document opens a new tab; the active tab is untouched, so
    // no unsaved-changes prompt is needed here (tab switch/close prompt).

    const pickerWindow = window as FilePickerWindow;
    if (typeof pickerWindow.showOpenFilePicker === "function") {
      try {
        // Multiple selection: opening a batch one file at a time is the slowest
        // possible path for the user's most common action (adding papers).
        const handles = await pickerWindow.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: "PDF 文件",
              accept: {
                "application/pdf": [".pdf"],
              },
            },
          ],
        });

        if (!handles || !handles.length) return;
        const items = [];
        for (const handle of handles) {
          const file = await handle.getFile();
          items.push({ name: file.name, data: await file.arrayBuffer(), fileHandle: handle });
        }
        await openPdfBatch(items);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        console.warn(
          "File System Access API 打开失败，降级到普通文件选择。",
          error,
        );
      }
    }

    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) return;
    const items = [];
    for (const file of files) {
      items.push({ name: file.name, data: await file.arrayBuffer(), fileHandle: null });
    }
    // Cleared before opening so re-picking the same files fires `change` again.
    fileInput.value = "";
    await openPdfBatch(items);
  });
}
