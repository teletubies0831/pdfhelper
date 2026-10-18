import { setStatus } from "./status-bar";
import {
  openPdfInTab,
} from "./document-tabs";
import {
  describePdfBatch,
  describePdfBatchFailures,
  runPdfBatch,
  type PdfBatchItem,
  type PdfBatchResult,
} from "./document-open-batch";
import { showAppError } from "./error-dialog";
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
  // Returns the tab (or null on failure) so batch opening can tell the two apart.
  // Returning void here made *every* batch item look like a failure: the opener's
  // result was undefined, and undefined was treated as "did not open".
  return openPdfInTab(data, name, fileHandle);
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

/**
 * Opens several PDFs, one tab each.
 *
 * Sequential by design: every open rewrites the same viewer state, so parallel opens
 * would interleave and leave one file's tab holding another file's document. A file
 * that fails to open is reported and skipped rather than aborting the batch — picking
 * twenty papers and getting nothing because one of them is corrupt is a much worse
 * outcome than getting nineteen.
 */
export async function openPdfBatch(items: readonly PdfBatchItem[]): Promise<PdfBatchResult> {
  if (!items.length) {
    setStatus('没有选择任何文件。');
    return { requested: 0, opened: 0, failures: [] };
  }

  const result = await runPdfBatch(items, {
    open: (item) => openPdf(item.data, item.name, item.fileHandle as FileHandleLike | null, false),
    onProgress: (position, total, name) => {
      setStatus(total > 1 ? `正在打开 ${position}/${total}：${name}…` : `正在打开 ${name}…`);
    },
  });

  setStatus(describePdfBatch(result), result.opened === 0);
  const detail = describePdfBatchFailures(result);
  if (detail) {
    showAppError(detail, {
      title: '部分文献未能打开',
      summary: `共选择 ${result.requested} 个文件，成功 ${result.opened} 个。`,
    });
  }
  return result;
}

