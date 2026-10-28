import {
  currentRecentEntryId,
  pdfDocument,
  sourceName,
} from "../../app/viewer-state";
import { browser } from "wxt/browser";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { openRecentFile, readRecentFiles } from "../../features/recent-files/public";
import {
  getDocumentFileHandle,
  linkKnowledgeDocumentSource,
  paperNameKey,
  putDocumentFileHandle,
} from "../../../modules/knowledge/public";
import { requestSourcePageAfterOpen } from "../../features/recent-files/public";
import type { FileHandleLike, FilePickerWindow } from "../../app/viewer-types";
import {
  normalizePdfFileName,
  sourcePdfMatchesOpenDocument,
} from "./source-pdf-match";

function normalizePdfName(value: string): string {
  return normalizePdfFileName(getDisplayFileName(value));
}

/**
 * Finds the recent file that belongs to a document, by id first and then by name.
 *
 * Two name rules, in this order: the exact name, then the *paper* name — the one with the decorations a save adds
 * stripped off. The second rule is what lets the knowledge base open the annotated copy (`论文-pdfpal.pdf`) of a record
 * that is still called `论文.pdf`. `readRecentFiles` returns newest first, so when both files are recent the one the
 * user saved last wins.
 */
function findRecentEntryFor<T extends { id: string; name: string }>(
  documentName: string,
  recentEntryId: string | undefined,
  entries: readonly T[],
): T | undefined {
  if (recentEntryId) {
    const byId = entries.find((entry) => entry.id === recentEntryId);
    if (byId) return byId;
  }
  const normalizedTarget = normalizePdfName(documentName);
  const exact = entries.find(
    (entry) => normalizePdfName(entry.name) === normalizedTarget,
  );
  if (exact) return exact;
  const targetKey = paperNameKey(documentName);
  if (!targetKey) return undefined;
  return entries.find((entry) => paperNameKey(entry.name) === targetKey);
}

/**
 * 当前打开的 PDF 是否就是这份文献的源文件.
 *
 * 规则本身在 `source-pdf-match.ts`（纯函数，可单独测试）：给了条目 id 就以它为准，没给才退回文件名比较。
 *
 * `sourceName` may be a full URL for a remote PDF; it is converted to its display file name here, before the comparison, because the
 * record's name is a file name. Skipping this step made an open remote PDF stop matching its own record.
 */
export function isSourcePdfCurrentlyOpen(
  documentName: string,
  recentEntryId?: string,
): boolean {
  return sourcePdfMatchesOpenDocument({
    hasOpenDocument: Boolean(pdfDocument.value),
    openEntryId: currentRecentEntryId.value,
    requestedEntryId: recentEntryId,
    openName: getDisplayFileName(sourceName.value),
    targetName: documentName,
  });
}

export async function ensureSourcePdfOpen(
  documentName: string,
  recentEntryId?: string,
  documentId?: string,
): Promise<boolean> {
  if (isSourcePdfCurrentlyOpen(documentName, recentEntryId)) return true;

  // The durable link first: the recent list keeps 12 entries, and a record that rotated out of it used to look like a
  // deleted file even though the file had never moved.
  if (documentId) {
    const handle = await getDocumentFileHandle(documentId);
    if (handle) {
      const permission = await handle.queryPermission?.({ mode: "read" });
      // A prompt needs a user gesture; the caller is a click handler, so asking here is legitimate.
      const granted = permission === "granted"
        || (permission !== "denied" && await handle.requestPermission?.({ mode: "read" }) === "granted");
      if (granted) {
        try {
          const file = await handle.getFile();
          // Dynamic on purpose: `document-tabs` reaches back here through the knowledge base, and a static import would
          // be a module cycle (the architecture check refuses it).
          const { openPdfInTab } = await import("../../app/document-tabs");
          const tab = await openPdfInTab(await file.arrayBuffer(), file.name, handle as never);
          return Boolean(tab);
        } catch (error) {
          console.warn("PDFPal 无法打开已关联的本地文件，改查最近打开。", error);
        }
      }
    }
  }

  const entries = await readRecentFiles();
  const recentEntry = findRecentEntryFor(documentName, recentEntryId, entries);

  if (!recentEntry) return false;

  await openRecentFile(recentEntry);
  return isSourcePdfCurrentlyOpen(documentName, recentEntry.id);
}

/**
 * Re-links a record to a file the user picks.
 *
 * The recovery path for a link that rotted: the file is opened, remembered as recent, and its handle stored against the
 * record, so the next 「打开原文」 does not need the picker. The record id never changes — a new fingerprint (a saved
 * annotated copy) is recorded as an alias by `linkKnowledgeDocumentSource`.
 */
export async function relinkSourcePdfFromPicker(
  documentId: string,
  documentName: string,
): Promise<boolean> {
  const pickerWindow = window as FilePickerWindow;
  let file: File | null = null;
  let handle: FileHandleLike | null = null;
  if (typeof pickerWindow.showOpenFilePicker === "function") {
    try {
      const handles = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: [{ description: "PDF 文件", accept: { "application/pdf": [".pdf"] } }],
      });
      handle = handles?.[0] ?? null;
      if (handle) file = await handle.getFile();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      console.warn("文件选择失败，改试普通输入框。", error);
    }
  }
  if (!file) return false;

  // Same reason as above: the tab module cannot be imported statically from here.
  const { openPdfInTab } = await import("../../app/document-tabs");
  const tab = await openPdfInTab(await file.arrayBuffer(), file.name, handle as never);
  if (!tab) return false;
  await putDocumentFileHandle(documentId, handle as never);
  linkKnowledgeDocumentSource(documentId, {
    sourceDocumentId: tab.documentId,
    recentEntryId: tab.recentEntryId ?? undefined,
  });
  // The stored name is the library's label; keep it, but record that the file now open is the same paper.
  console.info(`PDFPal 已把「${documentName}」关联到 ${file.name}。`);
  return true;
}

async function resolveSourceRecentEntry(
  documentName: string,
  recentEntryId?: string,
) {
  const entries = await readRecentFiles();
  return findRecentEntryFor(documentName, recentEntryId, entries);
}

export async function openSourcePdfInNewTab(
  documentName: string,
  recentEntryId?: string,
  pageNumber = 0,
): Promise<boolean> {
  const recentEntry = await resolveSourceRecentEntry(documentName, recentEntryId);
  if (!recentEntry) return false;

  const viewerUrl = new URL(browser.runtime.getURL("/viewer.html"));
  viewerUrl.searchParams.set("recentEntryId", recentEntry.id);
  // Only an *explicit* page becomes a URL param. Writing `page=1` here was worse than useless: the reader treats a page
  // param as "jump here", so it overrode the saved reading position and every reopen started at the first page.
  if (pageNumber > 1) viewerUrl.searchParams.set("page", String(Math.round(pageNumber)));
  await browser.tabs.create({
    url: viewerUrl.toString(),
    active: true,
  });
  return true;
}

export async function openSourcePdfFromKnowledge(
  documentName: string,
  recentEntryId?: string,
  pageNumber = 0,
  documentId?: string,
): Promise<boolean> {
  if (pdfDocument.value) {
    // A new tab resolves the file by recent-entry id, so it can only work while the entry still exists. With a durable
    // handle and no entry, open in this tab instead — that path registers a fresh recent entry and re-links implicitly.
    if (await resolveSourceRecentEntry(documentName, recentEntryId)) {
      return openSourcePdfInNewTab(documentName, recentEntryId, pageNumber);
    }
  }
  // The same-tab path has no URL to carry a page, so the request is parked for the pages-init restore to consume.
  requestSourcePageAfterOpen(pageNumber);
  return ensureSourcePdfOpen(documentName, recentEntryId, documentId);
}
