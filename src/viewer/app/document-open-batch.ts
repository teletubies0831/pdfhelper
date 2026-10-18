/**
 * Opening several PDFs at once.
 *
 * The picker can hand back any number of files, and the reader has to absorb them
 * into one tab per document. Two decisions shape this file:
 *
 * - **Sequential, not parallel.** Every open mutates the same viewer state (the
 *   attached document, the outline, the reader position), so opening in parallel
 *   would interleave those mutations and leave the last writer's state attached to
 *   the first file's tab.
 * - **A failure is reported, not fatal.** One unreadable file in a batch of twenty
 *   must not stop the other nineteen, and the user has to be told which ones failed
 *   instead of silently receiving fewer tabs than files they picked.
 *
 * The opener is injected so this logic is testable without PDF.js, a file picker or
 * a DOM.
 */

export interface PdfBatchItem {
  name: string;
  data: ArrayBuffer | Uint8Array;
  fileHandle: unknown;
}

export interface PdfBatchFailure {
  name: string;
  message: string;
}

export interface PdfBatchResult {
  requested: number;
  opened: number;
  failures: PdfBatchFailure[];
}

export interface RunPdfBatchOptions<TItem extends PdfBatchItem> {
  /**
   * Opens one item.
   *
   * Reporting convention: **throw**, or return `null`/`false`, to report a failure.
   * Anything else — including `undefined` from a void-style opener — counts as
   * opened. This is deliberately strict about what counts as failure: treating
   * "returned nothing" as failure marked every item in a batch as failed while the
   * documents were in fact opening fine.
   */
  open: (item: TItem) => Promise<unknown>;
  /** Called before each item, with 1-based position, for a "3/8" readout. */
  onProgress?: (position: number, total: number, name: string) => void;
}

export async function runPdfBatch<TItem extends PdfBatchItem>(
  items: readonly TItem[],
  options: RunPdfBatchOptions<TItem>,
): Promise<PdfBatchResult> {
  const failures: PdfBatchFailure[] = [];
  let opened = 0;

  for (const [index, item] of items.entries()) {
    options.onProgress?.(index + 1, items.length, item.name);
    try {
      const result = await options.open(item);
      if (result === null || result === false) {
        failures.push({ name: item.name, message: '未能打开该文件。' });
        continue;
      }
      opened += 1;
    } catch (error) {
      failures.push({
        name: item.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { requested: items.length, opened, failures };
}

/** One-line summary for the status bar. */
export function describePdfBatch(result: PdfBatchResult): string {
  if (!result.requested) return '没有选择任何文件。';
  if (!result.failures.length) {
    return result.opened === 1
      ? '已打开 1 篇文献。'
      : `已打开 ${result.opened} 篇文献。`;
  }
  return `已打开 ${result.opened} / ${result.requested} 篇文献，${result.failures.length} 篇失败。`;
}

/** Detail text for the error dialog, or null when nothing failed. */
export function describePdfBatchFailures(result: PdfBatchResult): string | null {
  if (!result.failures.length) return null;
  const lines = result.failures.map((failure) => `· ${failure.name}：${failure.message}`);
  return [`以下 ${result.failures.length} 篇文献未能打开：`, ...lines].join('\n');
}
