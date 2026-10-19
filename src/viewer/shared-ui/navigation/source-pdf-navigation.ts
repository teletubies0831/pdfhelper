import {
  currentRecentEntryId,
  pdfDocument,
  sourceName,
} from "../../app/viewer-state";
import { browser } from "wxt/browser";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { openRecentFile, readRecentFiles } from "../../features/recent-files/public";
import { paperNameKey } from "../../../modules/knowledge/public";

function normalizePdfName(value: string): string {
  return getDisplayFileName(value)
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

export function isSourcePdfCurrentlyOpen(
  documentName: string,
  recentEntryId?: string,
): boolean {
  if (!pdfDocument.value) return false;

  if (
    recentEntryId
    && currentRecentEntryId.value
    && currentRecentEntryId.value === recentEntryId
  ) {
    return true;
  }

  return normalizePdfName(sourceName.value) === normalizePdfName(documentName);
}

export async function ensureSourcePdfOpen(
  documentName: string,
  recentEntryId?: string,
): Promise<boolean> {
  if (isSourcePdfCurrentlyOpen(documentName, recentEntryId)) return true;

  const entries = await readRecentFiles();
  const recentEntry = findRecentEntryFor(documentName, recentEntryId, entries);

  if (!recentEntry) return false;

  await openRecentFile(recentEntry);
  return isSourcePdfCurrentlyOpen(documentName, recentEntry.id);
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
  pageNumber = 1,
): Promise<boolean> {
  const recentEntry = await resolveSourceRecentEntry(documentName, recentEntryId);
  if (!recentEntry) return false;

  const viewerUrl = new URL(browser.runtime.getURL("/viewer.html"));
  viewerUrl.searchParams.set("recentEntryId", recentEntry.id);
  viewerUrl.searchParams.set("page", String(Math.max(1, Math.round(pageNumber))));
  await browser.tabs.create({
    url: viewerUrl.toString(),
    active: true,
  });
  return true;
}

export async function openSourcePdfFromKnowledge(
  documentName: string,
  recentEntryId?: string,
  pageNumber = 1,
): Promise<boolean> {
  if (pdfDocument.value) {
    return openSourcePdfInNewTab(documentName, recentEntryId, pageNumber);
  }
  return ensureSourcePdfOpen(documentName, recentEntryId);
}
