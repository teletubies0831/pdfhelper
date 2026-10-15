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
