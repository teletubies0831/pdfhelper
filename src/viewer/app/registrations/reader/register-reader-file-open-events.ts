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
import { openPdf, openRemotePdf } from "../../document-open";

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
        const [fileHandle] = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: [
            {
    description: "PDF 文件",
              accept: {
                "application/pdf": [".pdf"],
              },
            },
          ],
        });

        if (!fileHandle) return;
        const file = await fileHandle.getFile();
        await openPdf(await file.arrayBuffer(), file.name, fileHandle, false);
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
    const file = fileInput.files?.[0];
    if (!file) return;
    await openPdf(await file.arrayBuffer(), file.name, null, false);
    fileInput.value = "";
  });
}
