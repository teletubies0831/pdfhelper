
















import { recentFilesDialog, recentFilesList, statusText, viewerContainer } from "../../app/viewer-elements";
import { currentRecentEntryId, isOpeningDocument, isRestoringReadingPosition, lastReadingPosition, pdfDocument, pdfViewer, pendingReadingPosition, readingPositionSaveHandle } from "../../app/viewer-state";
import { navigateToPdfPageWhenVisible, updateControls } from "../../core/pdf-reader/public";
import { getDisplayFileName, openPdf, openRemotePdf } from "../../core/pdf-reader/public";

import type { FileHandleLike } from "../../app/viewer-types";
import { confirmDiscardUnsavedChanges } from '../annotations/public';
import { RECENT_FILES_LIMIT, type ReadingPosition, type RecentPdfEntry } from './contracts';
import { readRecentFiles, writeRecentFiles } from './recent-files-repository';

let temporarySourceNavigationEntryId: string | null = null;

function isTemporarySourceNavigationActive(): boolean {
  return Boolean(
    currentRecentEntryId.value
    && temporarySourceNavigationEntryId === currentRecentEntryId.value,
  );
}

async function writeCurrentEntryReadingPosition(
  recentEntryId: string,
  readingPosition: ReadingPosition,
): Promise<void> {
  const entries = await readRecentFiles();
  const entry = entries.find((item) => item.id === recentEntryId);
  if (!entry) return;

  const updatedEntry: RecentPdfEntry = {
    ...entry,
    lastOpenedAt: Date.now(),
    readingPosition,
  };
  await writeRecentFiles([
    updatedEntry,
    ...entries.filter((item) => item.id !== recentEntryId),
  ]);
}





export function setStatus(message: string, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}



export function createRecentEntryId(
  kind: RecentPdfEntry["kind"],
  name: string,
): string {
  const suffix =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${name}:${suffix}`;
}



export async function findSameRecentLocalEntry(
  fileHandle: FileHandleLike,
  entries: RecentPdfEntry[],
  name: string,
): Promise<RecentPdfEntry | null> {
  for (const entry of entries) {
    if (entry.kind !== "local" || !entry.fileHandle) continue;
    try {
      if (
        fileHandle.isSameEntry &&
        (await fileHandle.isSameEntry(entry.fileHandle))
      ) {
        return entry;
      }
    } catch {
      // Some browsers can throw if an old handle is no longer available.
    }
  }

  return (
    entries.find((entry) => entry.kind === "local" && entry.name === name) ??
    null
  );
}



export async function rememberRecentPdf(
  name: string,
  fileHandle: FileHandleLike | null,
  url?: string,
): Promise<RecentPdfEntry | null> {
  // Opening a document starts a new reading session. Any previous temporary
  // source-navigation guard must not leak into the newly opened session.
  temporarySourceNavigationEntryId = null;
  try {
    const entries = await readRecentFiles();
    let entry: RecentPdfEntry | null = null;

    if (fileHandle) {
      const existingEntry = await findSameRecentLocalEntry(
        fileHandle,
        entries,
        name,
      );
      entry = {
        ...existingEntry,
        id: existingEntry?.id ?? createRecentEntryId("local", name),
        name,
        kind: "local",
        lastOpenedAt: Date.now(),
        fileHandle,
      };
    } else if (url) {
      const existingEntry = entries.find((item) => item.id === `remote:${url}`);
      entry = {
        ...existingEntry,
        id: `remote:${url}`,
        name,
        kind: "remote",
        lastOpenedAt: Date.now(),
        url,
      };
    }

    if (!entry) return null;

    const nextEntries = [
      entry,
      ...entries.filter((item) => item.id !== entry.id),
    ].slice(0, RECENT_FILES_LIMIT);
    await writeRecentFiles(nextEntries);
    if (!recentFilesDialog.hidden) void renderRecentFiles();
    return entry;
  } catch (error) {
    console.warn("PDF Helper failed to remember recent PDF.", error);
    return null;
  }
}



export async function removeRecentFile(id: string) {
  const entries = await readRecentFiles();
  await writeRecentFiles(entries.filter((entry) => entry.id !== id));
}



export function formatRecentTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}



export function getCurrentReadingPosition(): ReadingPosition | null {
  if (!pdfDocument.value) return null;

  return {
    pageNumber: Math.min(
      pdfDocument.value.numPages,
      Math.max(1, Math.round(pdfViewer.currentPageNumber || 1)),
    ),
    scrollTop: Math.max(0, Math.round(viewerContainer.scrollTop)),
    scrollLeft: Math.max(0, Math.round(viewerContainer.scrollLeft)),
    scale: Math.max(0.1, Math.min(10, Number(pdfViewer.currentScale) || 1)),
    updatedAt: Date.now(),
  };
}



export function cancelReadingPositionSave() {
  if (readingPositionSaveHandle.value === null) return;
  window.clearTimeout(readingPositionSaveHandle.value);
  readingPositionSaveHandle.value = null;
}



export async function persistCurrentReadingPosition() {
  readingPositionSaveHandle.value = null;
  if (
    !pdfDocument.value ||
    !currentRecentEntryId.value ||
    isOpeningDocument.value ||
    isRestoringReadingPosition.value ||
    isTemporarySourceNavigationActive()
  )
    return;

  const readingPosition = getCurrentReadingPosition();
  const recentEntryId = currentRecentEntryId.value;
  if (!readingPosition || !recentEntryId) return;

  try {
    await writeCurrentEntryReadingPosition(recentEntryId, readingPosition);
  } catch (error) {
    console.warn("PDF Helper failed to persist reading position.", error);
  }
}



export function scheduleReadingPositionSave() {
  if (
    !pdfDocument.value ||
    !currentRecentEntryId.value ||
    isOpeningDocument.value ||
    isRestoringReadingPosition.value ||
    isTemporarySourceNavigationActive()
  )
    return;
  cancelReadingPositionSave();
  readingPositionSaveHandle.value = window.setTimeout(() => {
    void persistCurrentReadingPosition();
  }, 600);
}

/**
 * Freezes the user's real reading position before a temporary "view source"
 * jump. Programmatic page/scroll events remain excluded from persistence until
 * the user returns through the quick "last reading" action.
 */
export async function preserveReadingPositionForSourceNavigation(): Promise<void> {
  const recentEntryId = currentRecentEntryId.value;
  if (!pdfDocument.value || !recentEntryId) return;
  if (temporarySourceNavigationEntryId === recentEntryId) return;

  cancelReadingPositionSave();
  const readingPosition =
    isOpeningDocument.value || isRestoringReadingPosition.value
      ? lastReadingPosition.value ?? getCurrentReadingPosition()
      : getCurrentReadingPosition();
  if (!readingPosition) return;

  lastReadingPosition.value = readingPosition;
  temporarySourceNavigationEntryId = recentEntryId;
  updateControls();

  try {
    await writeCurrentEntryReadingPosition(recentEntryId, readingPosition);
  } catch (error) {
    console.warn(
      "PDF Helper failed to preserve the reading position before source navigation.",
      error,
    );
  }
}



export function restoreReadingPositionAfterPagesInit() {
  const position = pendingReadingPosition.value;
  pendingReadingPosition.value = null;

  if (!pdfDocument.value || !position) {
    pdfViewer.currentScaleValue = "page-width";
    return;
  }

  restoreReadingPosition(position);
}



export function restoreReadingPosition(position: ReadingPosition) {
  if (!pdfDocument.value) return;
  isRestoringReadingPosition.value = true;
  const pageNumber = Math.min(
    pdfDocument.value.numPages,
    Math.max(1, Math.round(position.pageNumber || 1)),
  );
  const scale = Number(position.scale);

  if (Number.isFinite(scale) && scale > 0) {
    pdfViewer.currentScale = Math.max(0.1, Math.min(10, scale));
  } else {
    pdfViewer.currentScaleValue = "page-width";
  }

  navigateToPdfPageWhenVisible(pageNumber);

  const applyPosition = () => {
    viewerContainer.scrollTop = Math.max(
      0,
      Number.isFinite(position.scrollTop)
        ? position.scrollTop
        : viewerContainer.scrollTop,
    );
    viewerContainer.scrollLeft = Math.max(
      0,
      Number.isFinite(position.scrollLeft) ? position.scrollLeft : 0,
    );
    updateControls();
  };

  requestAnimationFrame(() => {
    applyPosition();
    window.setTimeout(() => {
      applyPosition();
      isRestoringReadingPosition.value = false;
    }, 250);
  });
}



export function returnToLastReadingPosition() {
  const position = lastReadingPosition.value;
  if (!position) return;
  if (temporarySourceNavigationEntryId === currentRecentEntryId.value) {
    temporarySourceNavigationEntryId = null;
  }
  restoreReadingPosition(position);
}



export async function requestFileReadPermission(
  fileHandle: FileHandleLike,
): Promise<boolean> {
  const descriptor = { mode: "read" as const };
  const currentPermission = await fileHandle.queryPermission?.(descriptor);
  if (!currentPermission || currentPermission === "granted") return true;
  if (!fileHandle.requestPermission) return false;
  return (await fileHandle.requestPermission(descriptor)) === "granted";
}



export async function openRecentFile(entry: RecentPdfEntry) {
  if (pdfDocument.value && !confirmDiscardUnsavedChanges()) return;
  hideRecentFilesDialog();

  try {
    if (entry.kind === "local") {
      if (!entry.fileHandle)
        throw new Error("这条最近记录没有可用的文件句柄，请重新打开一次 PDF。");
      const hasPermission = await requestFileReadPermission(entry.fileHandle);
      if (!hasPermission) throw new Error("没有获得读取该 PDF 的权限。");
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
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}



export async function restoreMostRecentPdf(): Promise<boolean> {
  if (pdfDocument.value || isOpeningDocument.value) return false;

  try {
    const [entry] = await readRecentFiles();
    if (!entry) return false;

    if (entry.kind === "remote" && entry.url) {
      await openRemotePdf(entry.url);
      return pdfDocument.value !== null;
    }

    if (entry.kind !== "local" || !entry.fileHandle) return false;
    const descriptor = { mode: "read" as const };
    const permission = await entry.fileHandle.queryPermission?.(descriptor);
    if (permission && permission !== "granted") {
      setStatus("点击“文件 → 最近打开”即可继续上次阅读。", false);
      return false;
    }

    const file = await entry.fileHandle.getFile();
    await openPdf(await file.arrayBuffer(), file.name, entry.fileHandle, false);
    return pdfDocument.value !== null;
  } catch (error) {
    console.warn("PDF Helper failed to restore the most recent PDF.", error);
    setStatus("未能自动打开上次阅读的 PDF，可从“文件 → 最近打开”重试。", true);
    return false;
  }
}



export async function renderRecentFiles() {
  recentFilesList.textContent = "";

  try {
    const entries = await readRecentFiles();

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "recent-files-empty";
      empty.textContent =
        "暂无最近打开记录。用“打开PDF”打开一次文件后，这里会自动记录。";
      recentFilesList.append(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "recent-file-item";

      const openButton = document.createElement("button");
      openButton.className = "recent-file-open";
      openButton.type = "button";
      openButton.title = entry.name;

      const name = document.createElement("span");
      name.className = "recent-file-name";
      name.textContent = getDisplayFileName(entry.name);

      const meta = document.createElement("span");
      meta.className = "recent-file-meta";
      const positionText = entry.readingPosition?.pageNumber
        ? ` · 上次读到第 ${entry.readingPosition.pageNumber} 页`
        : "";
      meta.textContent = `${entry.kind === "local" ? "本地文件" : "远程 PDF"} · ${formatRecentTime(
        entry.lastOpenedAt,
      )}${positionText}`;

      openButton.append(name, meta);
      openButton.addEventListener("click", () => {
        void openRecentFile(entry);
      });

      const removeButton = document.createElement("button");
      removeButton.className = "recent-file-remove";
      removeButton.type = "button";
      removeButton.title = "移除记录";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await removeRecentFile(entry.id);
        await renderRecentFiles();
      });

      item.append(openButton, removeButton);
      recentFilesList.append(item);
    }
  } catch (error) {
    const empty = document.createElement("div");
    empty.className = "recent-files-empty";
    empty.textContent = error instanceof Error ? error.message : String(error);
    recentFilesList.append(empty);
  }
}



export function showRecentFilesDialog() {
  recentFilesDialog.hidden = false;
  void renderRecentFiles();
}



export function hideRecentFilesDialog() {
  recentFilesDialog.hidden = true;
}
