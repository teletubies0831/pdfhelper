import {
  currentRecentEntryId,
  pdfDocument,
  sourceName,
} from "../../app/viewer-state";
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
