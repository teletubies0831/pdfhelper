





import { browser } from "wxt/browser";











import { clearTranslationHistoryButton, openTranslationHistoryButton, translationHistoryCountElement, translationHistoryDialog, translationHistoryDialogCount, translationHistoryDialogList, translationHistorySearchInput } from "../../app/viewer-elements";
import { MAX_TRANSLATION_HISTORY_PER_DOCUMENT, TRANSLATION_HISTORY_STORAGE_KEY, currentEnglishLearningResult, currentEnglishLearningSourceText, lastTranslatedText, selectedTextForAi, selectedTextPageNumber, translationHistoryDocumentKey, translationHistoryEntries } from "../../core/pdf-reader/public";


import { pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getDocumentChatId } from "../assistant/public";
import { setStatus } from "../recent-files/public";



import type { EnglishLearningResult, TranslationHistoryEntry, TranslationHistoryStore } from "../../core/pdf-reader/public";
import { renderSentenceLearningResult, renderVocabularyLearningResult, setTranslationSelectionEditor } from './learning-view';
import { createLearningElement } from './selection-context';




export function getTranslationHistoryDocumentKey(): string {
  if (pdfDocument.value) return getDocumentChatId(pdfDocument.value);
  return `source:${sourceName.value || "untitled"}`;
}



export function isStoredEnglishLearningResult(value: unknown): value is EnglishLearningResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "sentence") return typeof record.translation === "string";
  return record.kind === "word"
    && typeof record.word === "string"
    && typeof record.meaningInSentence === "string"
    && typeof record.sentence === "string";
}



export function readTranslationHistoryEntries(value: unknown): TranslationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry): TranslationHistoryEntry | null => {
      if (
        typeof entry.id !== "string"
        || typeof entry.sourceText !== "string"
        || !isStoredEnglishLearningResult(entry.result)
      ) return null;
      const storedResult = entry.result;
      const result: EnglishLearningResult = storedResult.kind === "word"
        ? {
            ...storedResult,
            selectedWord:
              typeof storedResult.selectedWord === "string"
                ? storedResult.selectedWord
                : storedResult.word,
            wordForm:
              typeof storedResult.wordForm === "string"
                ? storedResult.wordForm
                : "",
            namedEntityType:
              typeof storedResult.namedEntityType === "string"
                ? storedResult.namedEntityType
                : "",
            partsOfSpeech: Array.isArray(storedResult.partsOfSpeech)
              ? storedResult.partsOfSpeech
              : [],
            senses: Array.isArray(storedResult.senses)
              ? storedResult.senses
              : [],
            forms: Array.isArray(storedResult.forms)
              ? storedResult.forms
              : [],
            examples: Array.isArray(storedResult.examples)
              ? storedResult.examples.filter(
                  (example) => example?.source !== "document",
                )
              : [],
          }
        : {
            ...storedResult,
            sourceText:
              typeof storedResult.sourceText === "string"
                ? storedResult.sourceText
                : entry.sourceText,
            keywords: Array.isArray(storedResult.keywords)
              ? storedResult.keywords
              : [],
          };
      return {
        id: entry.id,
        sourceText: entry.sourceText,
        pageNumber:
          typeof entry.pageNumber === "number" && Number.isFinite(entry.pageNumber)
            ? Math.max(1, entry.pageNumber)
            : 1,
        result,
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : 0,
      };
    })
    .filter((entry): entry is TranslationHistoryEntry => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_TRANSLATION_HISTORY_PER_DOCUMENT);
}



export function getTranslationHistoryLabel(entry: TranslationHistoryEntry): string {
  if (entry.result.kind === "word") {
    return entry.result.selectedWord || entry.result.word || entry.sourceText;
  }
  return entry.sourceText.replace(/\s+/g, " ").trim().slice(0, 42);
}



export function restoreTranslationHistoryEntry(entry: TranslationHistoryEntry): void {
  const restoredText = entry.result.kind === "word"
    ? entry.result.selectedWord || entry.result.word || entry.sourceText
    : entry.sourceText;
  selectedTextForAi.value = restoredText;
  selectedTextPageNumber.value = entry.pageNumber;
  lastTranslatedText.value = restoredText;
  currentEnglishLearningResult.value = entry.result;
  currentEnglishLearningSourceText.value = restoredText;
  setTranslationSelectionEditor(
    restoredText,
    entry.result.kind === "word" ? entry.result.sentence : "",
    entry.result.kind === "word" ? entry.result.sentenceTranslation : "",
  );
  if (entry.result.kind === "word") {
    renderVocabularyLearningResult(entry.result);
  } else {
    renderSentenceLearningResult(entry.result);
  }
}



export function createTranslationHistoryRow(
  entry: TranslationHistoryEntry,
): HTMLElement {
  const row = createLearningElement("div", "translation-history-row");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "translation-history-item";
  const title = getTranslationHistoryLabel(entry);
  button.append(
    createLearningElement(
      "strong",
      "translation-history-item-title",
      entry.result.kind === "word" ? title : `句子 · ${title}`,
    ),
    createLearningElement(
      "span",
      "translation-history-item-meta",
      `第 ${entry.pageNumber} 页 · 点击恢复`,
    ),
  );
  button.addEventListener("click", () => {
    restoreTranslationHistoryEntry(entry);
    translationHistoryDialog.hidden = true;
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "translation-history-delete";
  deleteButton.textContent = "×";
  deleteButton.title = `删除“${title}”`;
  deleteButton.setAttribute("aria-label", `删除“${title}”`);
  deleteButton.addEventListener("click", () => {
    void deleteTranslationHistoryEntry(entry.id);
  });
  row.append(button, deleteButton);
  return row;
}



export function getFilteredTranslationHistoryEntries(): TranslationHistoryEntry[] {
  const query = translationHistorySearchInput.value
    .toLocaleLowerCase("zh-CN")
    .trim();
  if (!query) return translationHistoryEntries.value;
  return translationHistoryEntries.value.filter((entry) =>
    `${entry.sourceText}\n${JSON.stringify(entry.result)}`
      .toLocaleLowerCase("zh-CN")
      .includes(query),
  );
}



export function renderTranslationHistoryDialog(): void {
  const entries = getFilteredTranslationHistoryEntries();
  translationHistoryDialogCount.textContent = translationHistorySearchInput.value.trim()
    ? `${entries.length} / ${translationHistoryEntries.value.length} 条记录`
    : `${translationHistoryEntries.value.length} 条记录`;
  if (!entries.length) {
    translationHistoryDialogList.replaceChildren(
      createLearningElement(
        "p",
        "translation-history-empty",
        translationHistoryEntries.value.length
          ? "没有找到匹配的历史记录。"
          : "当前 PDF 还没有英语学习历史。",
      ),
    );
    return;
  }
  translationHistoryDialogList.replaceChildren(
    ...entries.map(createTranslationHistoryRow),
  );
}



export function renderTranslationHistory(): void {
  translationHistoryCountElement.textContent = String(translationHistoryEntries.value.length);
  clearTranslationHistoryButton.hidden = translationHistoryEntries.value.length === 0;
  openTranslationHistoryButton.classList.toggle(
    "has-records",
    translationHistoryEntries.value.length > 0,
  );
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}



export async function persistTranslationHistoryEntries(): Promise<void> {
  const stored = await browser.storage.local.get(TRANSLATION_HISTORY_STORAGE_KEY);
  const store = { ...(stored[TRANSLATION_HISTORY_STORAGE_KEY] ?? {}) } as TranslationHistoryStore;
  if (translationHistoryEntries.value.length) {
    store[translationHistoryDocumentKey.value] = translationHistoryEntries.value;
  } else {
    delete store[translationHistoryDocumentKey.value];
  }
  await browser.storage.local.set({ [TRANSLATION_HISTORY_STORAGE_KEY]: store });
}



export async function deleteTranslationHistoryEntry(id: string): Promise<void> {
  translationHistoryEntries.value = translationHistoryEntries.value.filter(
    (entry) => entry.id !== id,
  );
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}



export async function ensureTranslationHistoryLoaded(): Promise<void> {
  const documentKey = getTranslationHistoryDocumentKey();
  if (documentKey === translationHistoryDocumentKey.value) return;
  const stored = await browser.storage.local.get(TRANSLATION_HISTORY_STORAGE_KEY);
  const store = stored[TRANSLATION_HISTORY_STORAGE_KEY] as TranslationHistoryStore | undefined;
  translationHistoryDocumentKey.value = documentKey;
  translationHistoryEntries.value = readTranslationHistoryEntries(store?.[documentKey]);
  renderTranslationHistory();
}



export async function storeTranslationHistoryResult(
  sourceText: string,
  result: EnglishLearningResult,
): Promise<void> {
  await ensureTranslationHistoryLoaded();
  const normalizedSource = sourceText.replace(/\s+/g, " ").trim();
  if (!normalizedSource) return;
  const id = `${result.kind}:${normalizedSource.toLocaleLowerCase()}`;
  const entry: TranslationHistoryEntry = {
    id,
    sourceText: normalizedSource,
    pageNumber: Math.max(1, selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1),
    result,
    updatedAt: Date.now(),
  };
  translationHistoryEntries.value = [
    entry,
    ...translationHistoryEntries.value.filter((item) => item.id !== id),
  ].slice(0, MAX_TRANSLATION_HISTORY_PER_DOCUMENT);
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
}



export async function clearCurrentTranslationHistory(): Promise<void> {
  await ensureTranslationHistoryLoaded();
  translationHistoryEntries.value = [];
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
  setStatus("已清空当前 PDF 的英语学习历史。");
}
