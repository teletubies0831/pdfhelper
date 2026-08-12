import {
  editingPaperOverviewId,
  paperCardReviewDocumentName,
} from "../../core/pdf-reader/public";
import {
  currentRecentEntryId,
  pdfDocument,
  sourceName,
} from "../../app/viewer-state";
import { getDisplayFileName, openRemotePdf } from "../../core/pdf-reader/public";
import {
  openRecentFile,
  readRecentFiles,
  setStatus,
} from "../recent-files/public";
import {
  closePaperCardPage,
  readSavedPaperOverviews,
} from "./paper-card-controller";
import { setPaperCardPageStatus } from "./paper-card-status";

function normalizeDocumentName(value: string): string {
  return getDisplayFileName(value)
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isExpectedPdfOpen(
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

  return (
    normalizeDocumentName(sourceName.value)
    === normalizeDocumentName(documentName)
  );
}

export async function openSavedPaperCardSourcePdf(): Promise<void> {
  const savedCard = editingPaperOverviewId.value
    ? readSavedPaperOverviews().find(
        (card) => card.id === editingPaperOverviewId.value,
      )
    : undefined;

  const documentName =
    savedCard?.documentName?.trim()
    || paperCardReviewDocumentName.value.trim();

  if (!documentName) {
    setPaperCardPageStatus("这张论文卡片没有记录来源 PDF。", true);
    return;
  }

  if (isExpectedPdfOpen(documentName, savedCard?.recentEntryId)) {
    closePaperCardPage("pdf");
    setStatus(`已返回来源论文“${documentName}”。`);
    return;
  }

  const recentEntries = await readRecentFiles();
  const normalizedTarget = normalizeDocumentName(documentName);

  const recentEntry =
    (savedCard?.recentEntryId
      ? recentEntries.find((entry) => entry.id === savedCard.recentEntryId)
      : undefined)
    ?? recentEntries.find(
      (entry) => normalizeDocumentName(entry.name) === normalizedTarget,
    );

  if (recentEntry) {
    await openRecentFile(recentEntry);

    if (isExpectedPdfOpen(documentName, recentEntry.id)) {
      closePaperCardPage("pdf");
      setStatus(`已打开来源论文“${documentName}”。`);
      return;
    }

    setPaperCardPageStatus(
      `来源文件“${documentName}”没有成功打开，请重新授权或从“文件”菜单打开一次。`,
      true,
    );
    return;
  }

  const sourceLocator = savedCard?.sourceLocator?.trim() || "";
  if (/^https?:\/\//i.test(sourceLocator)) {
    try {
      await openRemotePdf(sourceLocator);
      closePaperCardPage("pdf");
      setStatus(`已打开来源论文“${documentName}”。`);
      return;
    } catch (error) {
      setPaperCardPageStatus(
        `打开来源论文失败：${error instanceof Error ? error.message : String(error)}`,
        true,
      );
      return;
    }
  }

  setPaperCardPageStatus(
    `找不到来源文件“${documentName}”的最近打开记录。请先通过“文件”菜单打开一次该 PDF。`,
    true,
  );
}
