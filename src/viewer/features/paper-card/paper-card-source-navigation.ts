import {
  editingPaperOverviewId,
  navigateToPdfPageWhenVisible,
  openRemotePdf,
  paperCardReviewDocumentName,
} from "../../core/pdf-reader/public";
import { setStatus } from "../recent-files/public";
import {
  ensureSourcePdfOpen,
  isSourcePdfCurrentlyOpen,
} from "../../shared-ui/navigation/source-pdf-navigation";
import {
  closePaperCardPage,
  readSavedPaperOverviews,
} from "./paper-card-controller";
import { setPaperCardPageStatus } from "./paper-card-status";

function finishOpeningSourcePdf(
  documentName: string,
  statusMessage: string,
): void {
  closePaperCardPage("pdf");
  navigateToPdfPageWhenVisible(1);
  setStatus(`${statusMessage}“${documentName}”，并定位到第 1 页。`);
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

  if (isSourcePdfCurrentlyOpen(documentName, savedCard?.recentEntryId)) {
    finishOpeningSourcePdf(documentName, "已返回来源论文");
    return;
  }

  try {
    const sourceOpened = await ensureSourcePdfOpen(
      documentName,
      savedCard?.recentEntryId,
    );
    if (sourceOpened) {
      finishOpeningSourcePdf(documentName, "已打开来源论文");
      return;
    }
  } catch (error) {
    setPaperCardPageStatus(
      `打开来源论文失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return;
  }

  const sourceLocator = savedCard?.sourceLocator?.trim() || "";
  if (/^https?:\/\//i.test(sourceLocator)) {
    try {
      await openRemotePdf(sourceLocator);
      finishOpeningSourcePdf(documentName, "已打开来源论文");
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
