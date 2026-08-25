import {
  currentRecentEntryId,
  pdfDocument,
  sourceName,
} from "../../app/viewer-state";
import { browser } from "wxt/browser";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { openRecentFile, readRecentFiles } from "../../features/recent-files/public";

function normalizePdfName(value: string): string {
  return getDisplayFileName(value)
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
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
  const normalizedTarget = normalizePdfName(documentName);

  const recentEntry =
    (recentEntryId
      ? entries.find((entry) => entry.id === recentEntryId)
      : undefined)
    ?? entries.find(
      (entry) => normalizePdfName(entry.name) === normalizedTarget,
    );

  if (!recentEntry) return false;

  await openRecentFile(recentEntry);
  return isSourcePdfCurrentlyOpen(documentName, recentEntry.id);
}

async function resolveSourceRecentEntry(
  documentName: string,
  recentEntryId?: string,
) {
  const entries = await readRecentFiles();
  const normalizedTarget = normalizePdfName(documentName);
  return (
    (recentEntryId
      ? entries.find((entry) => entry.id === recentEntryId)
      : undefined) ??
    entries.find((entry) => normalizePdfName(entry.name) === normalizedTarget)
  );
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
