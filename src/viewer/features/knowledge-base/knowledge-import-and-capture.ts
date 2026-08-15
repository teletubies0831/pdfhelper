import { currentEnglishLearningResult, resolvedReadingMode, selectedKnowledgeRecordKey, selectedTextForAi, selectedTextPageNumber } from "../../core/pdf-reader/public";

import { saveReadingJournalEntry } from "../paper-card/public";
import { knowledgeImportInput } from "../../app/viewer-elements";

import { pdfViewer, sourceName } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getCurrentChapterContext, getEnglishLearningPlainText } from "../translation/public";
import { setStatus } from "../recent-files/public";
import type { SavedKnowledgeNote } from "../../core/pdf-reader/public";
import { addKnowledgeNote, renderKnowledgeBase } from './research-controller';

import { getKnowledgeRecordKey, normalizeKnowledgeTags, readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import { getKnowledgeExcerpt, setKnowledgePageStatus } from './knowledge-domain';

import { prepareKnowledgeEditorMarkdown } from "./knowledge-markdown-normalizer";

export async function importKnowledgeNotes(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { notes?: unknown }).notes)
        ? (parsed as { notes: unknown[] }).notes
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : [];
    const imported: SavedKnowledgeNote[] = [];
    const now = new Date().toISOString();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Record<string, unknown>;
      const title = typeof value.title === "string" ? value.title.trim() : "";
      const content =
        typeof value.content === "string" ? value.content.trim() : "";
      if (!title && !content) continue;
      imported.push({
        id: crypto.randomUUID(),
        title: title || getKnowledgeExcerpt(content).slice(0, 40) || "导入笔记",
        content,
        documentName:
          typeof value.documentName === "string" && value.documentName.trim()
            ? value.documentName.trim()
            : "导入内容",
        pageNumber:
          typeof value.pageNumber === "number" &&
          Number.isFinite(value.pageNumber)
            ? Math.max(1, Math.round(value.pageNumber))
            : undefined,
        positionLabel:
          typeof value.positionLabel === "string" && value.positionLabel.trim()
            ? value.positionLabel.trim()
            : "导入内容",
        category:
          typeof value.category === "string" && value.category.trim()
            ? value.category.trim()
            : "导入笔记",
        tags: normalizeKnowledgeTags(value.tags),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!imported.length) throw new Error("文件中没有可识别的笔记。");
    writeSavedKnowledgeNotes([...imported, ...readSavedKnowledgeNotes()]);
    selectedKnowledgeRecordKey.value = getKnowledgeRecordKey(
      "knowledge-note",
      imported[0]!.id,
    );
    setKnowledgePageStatus(`已导入 ${imported.length} 条笔记。`);
    renderKnowledgeBase();
  } catch (error) {
    setKnowledgePageStatus(
      `导入失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    knowledgeImportInput.value = "";
  }
}

export function saveTranslationAndExplanationAsNote(): void {
  const sourceText = selectedTextForAi.value.trim();
  const learningResult = currentEnglishLearningResult.value;
  const learningText = getEnglishLearningPlainText();
  if (!sourceText || !learningResult || !learningText) {
    setStatus("当前没有可保存的英语学习结果。", true);
    return;
  }

  const pageNumber = Math.max(
    1,
    selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
  );
  const chapter = getCurrentChapterContext(pageNumber).title;
  const isWord = learningResult.kind === "word";
  if (resolvedReadingMode.value !== "paper") {
    const entry = saveReadingJournalEntry({
      title: `${isWord ? "单词" : "句子"}：${getKnowledgeExcerpt(sourceText).slice(0, 34)}`,
      quote: sourceText,
      content: [
        isWord ? "## 单词学习" : "## 原句翻译",
        learningText,
      ].join("\n\n"),
      tags: isWord ? ["英语学习", "单词"] : ["英语学习", "原句翻译"],
      origin: "translation",
      pageNumber,
    });
    setStatus(`已保存“${entry.title}”到知识库。`);
    return;
  }
  const note = addKnowledgeNote({
    title: `${isWord ? "单词学习" : "原句翻译"}：${getKnowledgeExcerpt(sourceText).slice(0, 34)}`,
    content: [
      "原文",
      prepareKnowledgeEditorMarkdown(sourceText),
      "",
      isWord ? "单词学习" : "句子学习",
      prepareKnowledgeEditorMarkdown(learningText),
    ].join("\n"),
    documentName: sourceName.value ? getDisplayFileName(sourceName.value) : "未关联文档",
    pageNumber,
    positionLabel: `${chapter} · 第 ${pageNumber} 页`,
    category: "英语学习",
    tags: isWord ? ["英语学习", "单词"] : ["英语学习", "原句翻译"],
  });
  setStatus(`已保存“${note.title}”到知识库。`);
}

export function attachChatSaveAction(
  message: HTMLElement,
  question: string,
  answer: string,
  documentName: string,
  pageNumber: number,
): void {
  const actions = document.createElement("div");
  actions.className = "chat-message-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "保存为笔记";
  button.addEventListener("click", () => {
    const chapter = getCurrentChapterContext(pageNumber).title;
    if (resolvedReadingMode.value !== "paper") {
      const entry = saveReadingJournalEntry({
        title: question ? `AI 问答：${getKnowledgeExcerpt(question).slice(0, 34)}` : "AI 问答札记",
        quote: question,
        content: ["## AI 回答", answer].join("\n\n"),
        tags: ["AI 问答"],
        origin: "ai",
        pageNumber,
      });
      button.disabled = true;
      button.textContent = "已保存";
      setStatus(`已保存“${entry.title}”到知识库。`);
      return;
    }
    const note = addKnowledgeNote({
      title: question
        ? `AI 问答：${getKnowledgeExcerpt(question).slice(0, 34)}`
        : "AI 问答笔记",
      content: [`问题`, question, "", "AI 回答", answer].join("\n"),
      documentName,
      pageNumber,
      positionLabel: `${chapter} · 第 ${pageNumber} 页`,
      category: "AI 对话",
      tags: ["AI 问答"],
    });
    button.disabled = true;
    button.textContent = "已保存";
    setStatus(`已保存“${note.title}”到知识库。`);
  });
  actions.append(button);
  message.append(actions);
}
