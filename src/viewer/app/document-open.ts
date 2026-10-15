import { setStatus } from "./status-bar";
import {
  openPdfInTab,
} from "./document-tabs";
import type { FileHandleLike } from "./viewer-types";

/**
 * Document-open entry points. Since the viewer is multi-tab, every open
 * becomes a new tab (or re-activates the tab that already holds the same
 * document); the full orchestration lives in app/document-tabs.ts.
 *
 * `shouldConfirmUnsavedChanges` is kept for call-site compatibility: opening
 * a different document never touches the active tab, and re-activating an
 * already-open tab always prompts when the active tab has unsaved work.
 */
export async function openPdf(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null = null,
  _shouldConfirmUnsavedChanges = true,
) {
  await openPdfInTab(data, name, fileHandle);
}

export async function openRemotePdf(url: string) {
  setStatus(`正在下载 ${url}…`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    await openPdfInTab(await response.arrayBuffer(), url, null, { url });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}
