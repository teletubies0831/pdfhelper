import { SAVED_CARDS_STORAGE_KEY, SAVED_PAPER_OVERVIEWS_STORAGE_KEY, SUMMARY_NOTES_STORAGE_KEY, knowledgeEditorTargetKey, selectedKnowledgeRecordKey, selectedKnowledgeResearchKeys } from "../../core/pdf-reader/public";
import { readSavedSummaryNotes } from "../../services/document-agent/viewer-document-agent";
import { openReadingJournalSource, readSavedPaperCards, readSavedPaperOverviews } from "../paper-card/public";
import { knowledgeEditorBodyInput, knowledgeEditorCategoryInput, knowledgeEditorTagsInput, knowledgeEditorTitleInput } from "../../app/viewer-elements";

import { pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getCurrentChapterContext } from "../translation/public";
import { setStatus } from "../recent-files/public";
import type { KnowledgeItem } from "../../core/pdf-reader/public";
import { addKnowledgeNote, closeKnowledgeBasePage, getSelectedKnowledgeItem, renderKnowledgeBase } from './research-controller';

import { collectKnowledgeItems, getKnowledgeRecordKey, normalizeKnowledgeCategory, normalizeKnowledgeTags, readKnowledgeItemMetaStore, readReadingJournalEntries, readSavedKnowledgeNotes, writeKnowledgeItemMetaStore, writeReadingJournalEntries, writeSavedKnowledgeNotes } from './knowledge-repository';
import { getKnowledgeExcerpt, setKnowledgePageStatus } from './knowledge-domain';
import { writeJsonValue } from '../../../platform/storage/browser-json-repository';
import { closeKnowledgeEditor } from "./knowledge-editor-dialog";
import { ensureSourcePdfOpen } from "../../shared-ui/navigation/source-pdf-navigation";

export function saveKnowledgeEditor(): void {
  const title = knowledgeEditorTitleInput.value.trim();
  const content = knowledgeEditorBodyInput.value.trim();
  const category = normalizeKnowledgeCategory(
    knowledgeEditorCategoryInput.value,
  );
  const tags = normalizeKnowledgeTags(
    knowledgeEditorTagsInput.value.split(/[,，]/).map((tag) => tag.trim()),
  );
  if (!title && !content) {
    setKnowledgePageStatus("请至少填写标题或正文。", true);
    return;
  }

  if (!knowledgeEditorTargetKey.value) {
    const pageNumber = pdfDocument.value
      ? Math.max(1, pdfViewer.currentPageNumber || 1)
      : undefined;
    const chapter = pageNumber
      ? getCurrentChapterContext(pageNumber).title
      : "";
    const saved = addKnowledgeNote({
      title: title || getKnowledgeExcerpt(content).slice(0, 40) || "未命名笔记",
      content,
      documentName: sourceName.value ? getDisplayFileName(sourceName.value) : "未关联文档",
      pageNumber,
      positionLabel: pageNumber ? `${chapter} · 第 ${pageNumber} 页` : "未定位",
      category,
      tags,
    });
    selectedKnowledgeRecordKey.value = getKnowledgeRecordKey(
      "knowledge-note",
      saved.id,
    );
  } else {
    const item = collectKnowledgeItems().find(
      (candidate) => candidate.recordKey === knowledgeEditorTargetKey.value,
    );
    if (!item) {
      setKnowledgePageStatus("这条内容已不存在，请刷新后重试。", true);
      return;
    }
    const now = new Date().toISOString();
    if (item.source === "knowledge-note") {
      const notes = readSavedKnowledgeNotes().map((note) =>
        note.id === item.id
          ? {
              ...note,
              title: title || item.title,
              content,
              category,
              tags,
              updatedAt: now,
            }
          : note,
      );
      writeSavedKnowledgeNotes(notes);
    } else {
      const metaStore = readKnowledgeItemMetaStore();
      metaStore[item.recordKey] = {
        title: title || item.title,
        content,
        category,
        tags,
        updatedAt: now,
      };
      writeKnowledgeItemMetaStore(metaStore);
    }
    selectedKnowledgeRecordKey.value = item.recordKey;
  }

  closeKnowledgeEditor();
  setKnowledgePageStatus("笔记内容已保存。");
  renderKnowledgeBase();
}

export function deleteKnowledgeItem(
  item: KnowledgeItem,
  closeEditorAfterDelete = false,
): boolean {
  if (!window.confirm(`确定删除“${item.title}”吗？此操作不可撤销。`)) {
    return false;
  }

  if (item.source === "knowledge-note") {
    writeSavedKnowledgeNotes(
      readSavedKnowledgeNotes().filter((note) => note.id !== item.id),
    );
  } else if (item.source === "reading-journal") {
    writeReadingJournalEntries(
      readReadingJournalEntries().filter((entry) => entry.id !== item.id),
    );
  } else if (item.source === "summary-note") {
    writeJsonValue(
      SUMMARY_NOTES_STORAGE_KEY,
      readSavedSummaryNotes().filter((note) => note.id !== item.id),
    );
  } else if (item.source === "reading-card") {
    writeJsonValue(
      SAVED_CARDS_STORAGE_KEY,
      readSavedPaperCards().filter((card) => card.id !== item.id),
    );
  } else {
    writeJsonValue(
      SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
      readSavedPaperOverviews().filter((card) => card.id !== item.id),
    );
  }

  const metaStore = readKnowledgeItemMetaStore();
  delete metaStore[item.recordKey];
  writeKnowledgeItemMetaStore(metaStore);
  selectedKnowledgeResearchKeys.value.delete(item.recordKey);

  if (selectedKnowledgeRecordKey.value === item.recordKey) {
    selectedKnowledgeRecordKey.value = "";
  }

  if (closeEditorAfterDelete) closeKnowledgeEditor();
  setKnowledgePageStatus(`已删除“${item.title}”。`);
  renderKnowledgeBase();
  return true;
}

export function deleteSelectedKnowledgeItem(): void {
  const item = getSelectedKnowledgeItem();
  if (!item) return;
  deleteKnowledgeItem(item);
}

export async function openSelectedKnowledgeSource(): Promise<void> {
  const item =
    getSelectedKnowledgeItem()
    ?? (knowledgeEditorTargetKey.value
      ? collectKnowledgeItems().find(
          (candidate) => candidate.recordKey === knowledgeEditorTargetKey.value,
        )
      : undefined);

  if (!item) return;

  if (item.source === "reading-journal") {
    const entry = readReadingJournalEntries().find(
      (candidate) => candidate.id === item.id,
    );
    if (!entry) return;

    closeKnowledgeEditor();
    closeKnowledgeBasePage();
    await openReadingJournalSource(entry);
    return;
  }

  const targetPageNumber =
    item.pageNumber ?? (item.source === "paper-overview" ? 1 : undefined);

  if (!targetPageNumber) {
    setKnowledgePageStatus("这条内容没有记录原文位置。", true);
    return;
  }

  const sourceOpened = await ensureSourcePdfOpen(item.documentName);
  if (!sourceOpened || !pdfDocument.value) {
    setKnowledgePageStatus(
      `无法自动打开来源文件“${item.documentName}”。请先通过“文件”打开一次该 PDF，使它出现在最近文件记录中。`,
      true,
    );
    return;
  }

  const pageNumber = Math.min(
    pdfDocument.value.numPages,
    Math.max(1, targetPageNumber),
  );

  closeKnowledgeEditor();
  closeKnowledgeBasePage();

  const jumpToSourcePage = () => {
    if (!pdfDocument.value) return;
    pdfViewer.currentPageNumber = pageNumber;
    pdfViewer.scrollPageIntoView({ pageNumber });
    setStatus(`已打开“${item.documentName}”，并定位到第 ${pageNumber} 页。`);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(jumpToSourcePage);
  });
  window.setTimeout(jumpToSourcePage, 260);
}
