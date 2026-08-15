
















import { resolvedReadingMode } from "../../core/pdf-reader/public";
import { currentRecentEntryId, pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getCurrentChapterContext, jumpToPdfCitations } from "../translation/public";
import { getDisplayFileName, navigateToPdfPageWhenVisible } from "../../core/pdf-reader/public";
import {
  preserveReadingPositionForSourceNavigation,
  setStatus,
} from "../recent-files/public";
import { getDocumentChatId } from "../assistant/public";
import { getKnowledgeExcerpt, normalizeKnowledgeTags, readReadingJournalEntries, refreshKnowledgeBaseIfOpen, writeReadingJournalEntries } from "../knowledge-base/public";
import type { SavedReadingJournalEntry } from "../../core/pdf-reader/public";
import { ensureSourcePdfOpen } from "../../shared-ui/navigation/source-pdf-navigation";




export function getCurrentJournalContext(): Pick<SavedReadingJournalEntry, "documentId" | "documentName" | "recentEntryId" | "pageNumber" | "positionLabel"> {
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const chapter = getCurrentChapterContext(pageNumber).title;
  return {
    documentId: pdfDocument.value ? getDocumentChatId(pdfDocument.value) : "",
    documentName: sourceName.value ? getDisplayFileName(sourceName.value) : "未关联文档",
    recentEntryId: currentRecentEntryId.value ?? undefined,
    pageNumber,
    positionLabel: `${chapter} · 第 ${pageNumber} 页`,
  };
}



export function saveReadingJournalEntry(input: {
  title: string;
  quote?: string;
  content: string;
  tags?: string[];
  origin: SavedReadingJournalEntry["origin"];
  pageNumber?: number;
}): SavedReadingJournalEntry {
  if (!pdfDocument.value) throw new Error("请先打开 PDF。");
  const now = new Date().toISOString();
  const context = getCurrentJournalContext();
  const pageNumber = Math.max(1, input.pageNumber ?? context.pageNumber);
  const entry: SavedReadingJournalEntry = {
    id: crypto.randomUUID(),
    readingMode: resolvedReadingMode.value,
    documentId: context.documentId,
    documentName: context.documentName,
    recentEntryId: context.recentEntryId,
    pageNumber,
    positionLabel: pageNumber === context.pageNumber ? context.positionLabel : `第 ${pageNumber} 页`,
    title: input.title.trim() || getKnowledgeExcerpt(input.quote || input.content).slice(0, 42) || "知识库笔记",
    quote: input.quote?.trim() ?? "",
    content: input.content.trim(),
    tags: normalizeKnowledgeTags(input.tags ?? []),
    origin: input.origin,
    createdAt: now,
    updatedAt: now,
  };
  writeReadingJournalEntries([
    entry,
    ...readReadingJournalEntries().filter((item) => item.id !== entry.id),
  ]);
  refreshKnowledgeBaseIfOpen();
  return entry;
}



export async function openReadingJournalSource(entry: SavedReadingJournalEntry): Promise<void> {
  const sourceOpened = await ensureSourcePdfOpen(
    entry.documentName,
    entry.recentEntryId,
  );
  if (!sourceOpened || !pdfDocument.value) {
    setStatus(
      `找不到“${entry.documentName}”的文件记录，请通过“文件”重新打开该 PDF。`,
      true,
    );
    return;
  }

  if (
    currentRecentEntryId.value
    && currentRecentEntryId.value !== entry.recentEntryId
  ) {
    writeReadingJournalEntries(
      readReadingJournalEntries().map((candidate) =>
        candidate.id === entry.id
          ? {
              ...candidate,
              recentEntryId: currentRecentEntryId.value ?? undefined,
              updatedAt: new Date().toISOString(),
            }
          : candidate,
      ),
    );
  }

  const pageNumber = Math.min(pdfDocument.value.numPages, Math.max(1, entry.pageNumber));
  if (entry.quote.trim()) {
    await jumpToPdfCitations(pageNumber, [entry.quote]);
  } else {
    await preserveReadingPositionForSourceNavigation();
    navigateToPdfPageWhenVisible(pageNumber);
  }
  setStatus(`已定位到“${entry.title}”的原文：第 ${pageNumber} 页。`);
}
