





import { browser } from "wxt/browser";











import { clearTranslationHistoryButton, openTranslationHistoryButton, translationHistoryCountElement, translationHistoryDialog, translationHistoryDialogCount, translationHistoryDialogList, translationHistorySearchInput } from "../../app/viewer-elements";



import { pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getDocumentChatId } from "../../app/document-identity";
import { setStatus } from "../recent-files/public";
import { currentEnglishLearningResult, currentEnglishLearningSourceText, lastTranslatedText, selectedTextForAi, selectedTextPageNumber, translationHistoryDocumentKey, translationHistoryEntries, EnglishLearningResult, TranslationHistoryEntry } from "../../app/public";
import {
  migrateLegacyHistory,
  readDocumentHistory,
  writeDocumentHistory,
} from "./translation-history-repository";





import { renderVocabularyLearningResult, setTranslationSelectionEditor } from './learning-view';
import { renderSentenceLearningResult } from './sentence-card-view';
import { createLearningElement } from './selection-context';



const translationHistoryIndex = new Map<string, TranslationHistoryEntry>();




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
      // A sentence saved without its translation is not a cache hit, it is a hole: restoring it paints an empty
      // 「原句翻译」 and, because the cache short-circuits the request, the reader never gets a translation at all.
      // (Entries written by the two-stream card before this guard could be in that state.) Dropping them here means the
      // next selection translates the sentence properly.
      if (result.kind === "sentence" && !result.translation.trim()) return null;
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
    .sort((left, right) => right.updatedAt - left.updatedAt);
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
    restoredText,
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
  const inlineCount = document.querySelector<HTMLElement>(
    "#translation-inline-history-count",
  );
  if (inlineCount) inlineCount.textContent = String(translationHistoryEntries.value.length);
  clearTranslationHistoryButton.hidden = translationHistoryEntries.value.length === 0;
  openTranslationHistoryButton.classList.toggle(
    "has-records",
    translationHistoryEntries.value.length > 0,
  );
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}



export async function persistTranslationHistoryEntries(
  operationStartedAt = Date.now(),
): Promise<void> {
  try {
    // 一篇文献一个键（存储细节在 `translation-history-repository.ts`）：另一个 Viewer 页面在写别的文献时，两边不再互相覆盖。
    await writeDocumentHistory(
      translationHistoryDocumentKey.value,
      translationHistoryEntries.value,
      undefined,
      operationStartedAt,
    );
  } catch (error) {
    console.warn("PDFPal 无法保存英语学习历史。", error);
    throw error;
  }
}



export async function deleteTranslationHistoryEntry(id: string): Promise<void> {
  const operationStartedAt = Date.now();
  if (!(await refreshTranslationHistoryBeforeMutation())) return;
  translationHistoryEntries.value = translationHistoryEntries.value.filter(
    (entry) => entry.id !== id,
  );
  rebuildTranslationHistoryIndex();
  await persistTranslationHistoryEntries(operationStartedAt);
  renderTranslationHistory();
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}

/**
 * A second Viewer can clear this document while this page is open. Mutation must never use the cached list blindly: a non-empty
 * save is allowed to recreate a document after a clear, but it must contain only the user's new mutation, not stale entries.
 */
async function refreshTranslationHistoryBeforeMutation(): Promise<boolean> {
  const documentKey = getTranslationHistoryDocumentKey();
  const entries = await readHistoryForDocument(documentKey);
  if (getTranslationHistoryDocumentKey() !== documentKey) return false;
  translationHistoryDocumentKey.value = documentKey;
  translationHistoryEntries.value = entries;
  rebuildTranslationHistoryIndex();
  return true;
}



export async function ensureTranslationHistoryLoaded(): Promise<void> {
  const documentKey = getTranslationHistoryDocumentKey();
  if (documentKey === translationHistoryDocumentKey.value) return;
  const entries = await readHistoryForDocument(documentKey);
  // 读取期间用户可能已经切到别的 PDF：这一份结果属于旧文档，丢掉它，别让 key 与内容错位。
  if (getTranslationHistoryDocumentKey() !== documentKey) return;
  translationHistoryDocumentKey.value = documentKey;
  translationHistoryEntries.value = entries;
  rebuildTranslationHistoryIndex();
  renderTranslationHistory();
}

/**
 * 读取一篇文献的历史，必要时从旧格式迁移.
 *
 * The legacy layout kept every document's list inside one object; the first read of a document that has no per-document key triggers
 * the wholesale migration (see `migrateLegacyHistory`), so a user who upgrades keeps every document's history instead of only the one
 * they happen to open.
 *
 * The value is **re-read after migrating** instead of taken from the legacy snapshot: if another page migrated first and then saved a
 * newer entry for this document, that key is the truth — and the migration deliberately never overwrites it.
 */
async function readHistoryForDocument(documentKey: string): Promise<TranslationHistoryEntry[]> {
  const stored = await readDocumentHistory(documentKey);
  if (stored !== undefined) return readTranslationHistoryEntries(stored);
  const migrated = await migrateLegacyHistory();
  if (!migrated) return [];
  const afterMigration = await readDocumentHistory(documentKey);
  if (afterMigration !== undefined) return readTranslationHistoryEntries(afterMigration);
  // Do not fall back to `migrated[documentKey]`: `undefined` can mean that another Viewer wrote a deletion tombstone while this
  // page held the legacy snapshot. Returning that in-memory copy would render cleared history and a later save could resurrect it.
  return [];
}



function normalizeTranslationCacheText(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}



function getTranslationHistoryCacheKey(
  selectedText: string,
  sourceSentence: string,
  kind: EnglishLearningResult["kind"],
): string {
  const normalizedSelection = normalizeTranslationCacheText(selectedText);
  const normalizedSentence = normalizeTranslationCacheText(sourceSentence);
  return kind === "word"
    ? `word:${normalizedSelection}:${normalizedSentence}`
    : `sentence:${normalizedSentence}`;
}



function getTranslationHistoryEntryCacheKey(
  entry: TranslationHistoryEntry,
): string {
  if (entry.result.kind === "word") {
    return getTranslationHistoryCacheKey(
      entry.result.selectedWord || entry.result.word || entry.sourceText,
      entry.result.sentence || "",
      "word",
    );
  }
  return getTranslationHistoryCacheKey(
    entry.sourceText,
    entry.result.sourceText || entry.sourceText,
    "sentence",
  );
}



function rebuildTranslationHistoryIndex(): void {
  translationHistoryIndex.clear();
  // Entries are newest-first. Keep the newest result if old storage contains
  // duplicate semantic keys created by an earlier ID format.
  for (const entry of translationHistoryEntries.value) {
    const cacheKey = getTranslationHistoryEntryCacheKey(entry);
    if (!translationHistoryIndex.has(cacheKey)) {
      translationHistoryIndex.set(cacheKey, entry);
    }
  }
}



export async function findTranslationHistoryResult(
  selectedText: string,
  sourceSentence: string,
  kind: EnglishLearningResult["kind"],
): Promise<TranslationHistoryEntry | undefined> {
  await ensureTranslationHistoryLoaded();
  return translationHistoryIndex.get(
    getTranslationHistoryCacheKey(selectedText, sourceSentence, kind),
  );
}



export async function storeTranslationHistoryResult(
  sourceText: string,
  result: EnglishLearningResult,
): Promise<void> {
  const operationStartedAt = Date.now();
  if (!(await refreshTranslationHistoryBeforeMutation())) return;
  const normalizedSource = sourceText.replace(/\s+/g, " ").trim();
  if (!normalizedSource) return;
  const sourceSentence = result.kind === "word"
    ? result.sentence || ""
    : result.sourceText || normalizedSource;
  const cacheKey = getTranslationHistoryCacheKey(
    normalizedSource,
    sourceSentence,
    result.kind,
  );
  const entry: TranslationHistoryEntry = {
    id: cacheKey,
    sourceText: normalizedSource,
    pageNumber: Math.max(1, selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1),
    result,
    updatedAt: Date.now(),
  };
  translationHistoryEntries.value = [
    entry,
    ...translationHistoryEntries.value.filter(
      (item) => getTranslationHistoryEntryCacheKey(item) !== cacheKey,
    ),
  ];
  rebuildTranslationHistoryIndex();
  await persistTranslationHistoryEntries(operationStartedAt);
  renderTranslationHistory();
}



export async function clearCurrentTranslationHistory(): Promise<void> {
  const operationStartedAt = Date.now();
  if (!(await refreshTranslationHistoryBeforeMutation())) return;
  translationHistoryEntries.value = [];
  translationHistoryIndex.clear();
  await persistTranslationHistoryEntries(operationStartedAt);
  renderTranslationHistory();
  setStatus("已清空当前 PDF 的英语学习历史。");
}
