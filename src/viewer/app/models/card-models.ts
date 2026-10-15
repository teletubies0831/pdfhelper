import type { CardType } from "../../core/pdf-reader/reader-controls";
import { createStateCell } from "../state-cell";

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

export const cardAbortController = createStateCell<AbortController | null>(null);

export const activeCardType = createStateCell<CardType>("method");

export const lastCardRequestKey = createStateCell("");

export const currentCardContext = createStateCell<CardContext | null>(null);

export const editingReadingJournalId = createStateCell<string | null>(null);

export const currentGeneratedCard = createStateCell<GeneratedCardContent | null>(null);

export const cardGenerationTimer = createStateCell<ReturnType<typeof setTimeout> | null>(null);
