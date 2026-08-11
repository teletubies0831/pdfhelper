import { type PDFDocumentProxy } from "pdfjs-dist";







import { type ResolvedReadingMode } from "../../../shared/reading-mode";
















import type { CardType, KnowledgeFilter, KnowledgeFocus, KnowledgeKind, KnowledgePageMode, KnowledgeSource, SummaryScope } from '../core/pdf-reader/reader-controls';



export type KnowledgeResearchScope = "selected" | "filtered" | "all";



export interface SummaryContext {
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  text: string;
}



export interface SavedSummaryNote {
  id: string;
  documentName: string;
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  points: string[];
  createdAt: string;
}



export interface CardContext {
  cardType: CardType;
  text: string;
  documentName: string;
  pageNumber: number;
  positionLabel: string;
  sourceLocation: string;
}



export interface GeneratedCardContent {
  title: string;
  explanation: string;
  keyPoints: string[];
  purpose: string;
  understanding: string;
}



export interface SavedPaperCard extends GeneratedCardContent, CardContext {
  id: string;
  documentId?: string;
  paperOverviewId?: string;
  recentEntryId?: string;
  sourceLocator?: string;
  createdAt: string;
}



export interface PaperOverviewApiResponse {
  title?: unknown;
  authors?: unknown;
  venue_year?: unknown;
  research_area?: unknown;
  keywords?: unknown;
  one_sentence_summary?: unknown;
  research_problem?: unknown;
  core_innovation?: unknown;
  worth_reading?: unknown;
  problem_setup?: unknown;
  research_gap?: unknown;
  why_important?: unknown;
  topic_tags?: unknown;
  method_overview?: unknown;
  method_intuition?: unknown;
  method_steps?: unknown;
  key_assumptions?: unknown;
  notation_guide?: unknown;
  datasets?: unknown;
  experiment_setup?: unknown;
  metrics?: unknown;
  main_findings?: unknown;
  strongest_evidence?: unknown;
  comparison_with_prior_work?: unknown;
  limitations?: unknown;
  reading_status?: unknown;
  recommend_deep_reading?: unknown;
  reading_difficulty?: unknown;
  reading_value_score?: unknown;
  novelty_score?: unknown;
  evidence_score?: unknown;
  relevance_score?: unknown;
  method_clarity_score?: unknown;
  reading_advice?: unknown;
  suitable_stages?: unknown;
  prerequisites?: unknown;
  citation_points?: unknown;
  research_connection?: unknown;
  followup_questions?: unknown;
  weekly_plan?: unknown;
  detail?: unknown;
}



export interface PaperCardFormData {
  title: string;
  authors: string;
  venueYear: string;
  researchArea: string;
  keywords: string;
  oneSentenceSummary: string;
  researchProblem: string;
  coreInnovation: string;
  worthReading: string;
  problemSetup: string;
  researchGap: string;
  whyImportant: string;
  topicTags: string;
  methodOverview: string;
  methodIntuition: string;
  methodSteps: string;
  keyAssumptions: string;
  notationGuide: string;
  datasets: string;
  experimentSetup: string;
  metrics: string;
  mainFindings: string;
  strongestEvidence: string;
  comparisonWithPriorWork: string;
  limitations: string;
  readingStatus: string;
  recommendDeepReading: string;
  readingDifficulty: string;
  readingValueScore: string;
  readingAdvice: string;
  suitableStages: string;
  prerequisites: string;
  citationPoints: string;
  researchConnection: string;
  followupQuestions: string;
  weeklyPlan: string;
  personalNotes: string;
}



export interface SavedPaperOverview extends PaperCardFormData {
  id: string;
  documentName: string;
  documentId?: string;
  recentEntryId?: string;
  sourceLocator?: string;
  createdAt: string;
  updatedAt?: string;
}



export interface SavedKnowledgeNote {
  id: string;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel?: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  readingMode?: ResolvedReadingMode;
}



export interface SavedReadingJournalEntry {
  id: string;
  readingMode: ResolvedReadingMode;
  documentId: string;
  documentName: string;
  recentEntryId?: string;
  pageNumber: number;
  positionLabel: string;
  title: string;
  quote: string;
  content: string;
  tags: string[];
  origin: "ai" | "translation" | "user";
  createdAt: string;
  updatedAt: string;
}



export interface KnowledgeItemMeta {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  updatedAt?: string;
}



export type KnowledgeItemMetaStore = Record<string, KnowledgeItemMeta>;



export interface KnowledgeItem {
  recordKey: string;
  id: string;
  source: KnowledgeSource;
  kind: KnowledgeKind;
  originMode: ResolvedReadingMode;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}



export let aiSelectionUpdateFrame = { value: 0 };


export let selectedTextForAi = { value: "" };


export let selectedTextPageNumber = { value: 0 };


export let lastViewerSelectionText = { value: "" };


export let lastTranslatedText = { value: "" };


export let autoTranslateTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };


export let translationAbortController: { value: AbortController | null } = { value: null };


export let moreExamplesAbortController: { value: AbortController | null } = { value: null };


export let summaryAbortController: { value: AbortController | null } = { value: null };


export let activeSummaryScope: { value: SummaryScope } = { value: "selection" };


export let lastSummaryRequestKey = { value: "" };


export let lastSummaryPoints: { value: string[] } = { value: [] };


export let currentSummaryContext: { value: SummaryContext | null } = { value: null };


export let summaryGenerationTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };


export let cardAbortController: { value: AbortController | null } = { value: null };


export let activeCardType: { value: CardType } = { value: "method" };


export let lastCardRequestKey = { value: "" };


export let currentCardContext: { value: CardContext | null } = { value: null };


export let editingReadingJournalId: { value: string | null } = { value: null };


export let currentGeneratedCard: { value: GeneratedCardContent | null } = { value: null };


export let cardGenerationTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };


export let paperCardPageAbortController: { value: AbortController | null } = { value: null };


export let paperCardPageRequestId = { value: "" };


export let paperCardPageDocumentKey = { value: "" };


export let paperCardPageSourceCache: { value: {
  document: PDFDocumentProxy;
  text: string;
} | null } = { value: null };


export let editingPaperOverviewId: { value: string | null } = { value: null };


export let paperCardReviewDocumentName = { value: "" };


export let paperCardReturnTarget: { value: "pdf" | "knowledge" } = { value: "pdf" };


export let activeKnowledgeFilter: { value: KnowledgeFilter } = { value: "all" };


export let activeKnowledgeCategory = { value: "all" };


export let activeKnowledgeTag = { value: "" };


export let activeKnowledgeFocus: { value: KnowledgeFocus } = { value: "all" };


export let activeKnowledgeYear = { value: "all" };


export let activeKnowledgeVenue = { value: "all" };


export let activeKnowledgeReadingStatus = { value: "all" };


export let activeKnowledgePriority = { value: "all" };



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



export let currentEnglishLearningResult: { value: EnglishLearningResult | null } = { value: null };


export let currentEnglishLearningSourceText = { value: "" };


export let currentEnglishLearningSourceSentence = { value: "" };



export const TRANSLATION_HISTORY_STORAGE_KEY = "pdf-helper-translation-history-v1";


export const MAX_TRANSLATION_HISTORY_PER_DOCUMENT = 200;



export interface TranslationHistoryEntry {
  id: string;
  sourceText: string;
  pageNumber: number;
  result: EnglishLearningResult;
  updatedAt: number;
}



export type TranslationHistoryStore = Record<string, TranslationHistoryEntry[]>;



export let translationHistoryDocumentKey = { value: "" };


export let translationHistoryEntries: { value: TranslationHistoryEntry[] } = { value: [] };



export const APP_VIEW_SESSION_STORAGE_KEY = "pdf-helper-app-view-state-v1";



export type PersistedAppView = "viewer" | "knowledge" | "paper-review";



export interface PersistedAppViewState {
  view: PersistedAppView;
  knowledgeMode: KnowledgePageMode;
  knowledgeFilter: KnowledgeFilter;
  knowledgeCategory: string;
  knowledgeTag: string;
  knowledgeFocus: KnowledgeFocus;
  knowledgeYear: string;
  knowledgeVenue: string;
  knowledgeReadingStatus: string;
  knowledgePriority: string;
  knowledgeSearch: string;
  knowledgeSort: string;
  knowledgeGroup: string;
  knowledgeResearchScope: string;
  knowledgeResearchQuestion: string;
  knowledgeInsightQuestion: string;
  selectedKnowledgeRecordKey: string;
  selectedKnowledgeResearchKeys: string[];
  knowledgeScrollTop: number;
  reviewPaperOverviewId: string;
  paperCardScrollTop: number;
}
