import { createStateCell } from "../state-cell";

export interface VocabularyExample {
  sentence: string;
  translation: string;
  usage: string;
  source?: "document" | "generated";
}

export interface VocabularyPartOfSpeech {
  label: string;
  meaning: string;
}

export interface VocabularySense extends VocabularyPartOfSpeech {
  definitionEn: string;
}

export interface VocabularyWordForm {
  label: string;
  value: string;
}

export interface VocabularyLearningResult {
  kind: "word";
  selectionComplete: boolean;
  selectedWord: string;
  word: string;
  wordForm: string;
  namedEntityType: string;
  pronunciation: string;
  partsOfSpeech: VocabularyPartOfSpeech[];
  senses: VocabularySense[];
  forms: VocabularyWordForm[];
  meaningInSentence: string;
  sentence: string;
  sentenceTranslation: string;
  examples: VocabularyExample[];
}

export interface SentenceKeyword {
  word: string;
  partOfSpeech: string;
  meaningInSentence: string;
  reason: string;
}

export interface SentenceLearningResult {
  kind: "sentence";
  sourceText: string;
  translation: string;
  keywords: SentenceKeyword[];
}

export type EnglishLearningResult = VocabularyLearningResult | SentenceLearningResult;

export const TRANSLATION_HISTORY_STORAGE_KEY = "pdf-helper-translation-history-v1";

/**
 * 新格式：`pdf-helper-translation-history-v1::<documentKey>`，一篇文献一个键.
 *
 * The old layout kept every document's list in one object under the single key above, so two Viewer pages writing different
 * documents still rewrote the same value — and the later write threw away both the other document's list and the other page's new
 * entries. One key per document makes concurrent pages independent; only two pages editing the *same* document can still race.
 */
export const TRANSLATION_HISTORY_KEY_PREFIX = "pdf-helper-translation-history-v1::";

export interface TranslationHistoryEntry {
  id: string;
  sourceText: string;
  pageNumber: number;
  result: EnglishLearningResult;
  updatedAt: number;
}

export type TranslationHistoryStore = Record<string, TranslationHistoryEntry[]>;

// Shared selection state used by translation, summary and card features.
export const aiSelectionUpdateFrame = createStateCell(0);

export const selectedTextForAi = createStateCell("");

export const selectedTextPageNumber = createStateCell(0);

export const lastViewerSelectionText = createStateCell("");

export const lastTranslatedText = createStateCell("");

export const autoTranslateTimer = createStateCell<ReturnType<typeof setTimeout> | null>(null);

export const translationAbortController = createStateCell<AbortController | null>(null);

export const moreExamplesAbortController = createStateCell<AbortController | null>(null);

export const currentEnglishLearningResult = createStateCell<EnglishLearningResult | null>(null);

export const currentEnglishLearningSourceText = createStateCell("");

export const currentEnglishLearningSourceSentence = createStateCell("");

export const translationHistoryDocumentKey = createStateCell("");

export const translationHistoryEntries = createStateCell<TranslationHistoryEntry[]>([]);
