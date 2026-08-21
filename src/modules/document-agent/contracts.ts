import type { AiConversationMessage } from "../../../shared/ai";
import type { ResolvedReadingMode } from "../../../shared/reading-mode";

export const DOCUMENT_AGENT_SCHEMA_VERSION = 1;

export const DOCUMENT_AGENT_INDEX_VERSION = 1;

export type DocumentAgentProcessingStatus =
  | "new"
  | "extracting"
  | "indexed"
  | "analyzing"
  | "ready"
  | "needs-api-key"
  | "error";

export interface DocumentPageText {
  pageNumber: number;
  text: string;
}

export interface DocumentOutlineItem {
  title: string;
  pageNumber: number;
  depth: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  order: number;
  startPage: number;
  endPage: number;
  text: string;
  heading?: string;
  summary?: string;
  keywords?: string[];
}

export interface DocumentSectionProfile {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
}

export interface DocumentProfile {
  oneSentenceSummary: string;
  researchProblem: string;
  method: string;
  evidence: string;
  conclusions: string;
  limitations: string;
  keywords: string[];
  sections: DocumentSectionProfile[];
  chunkSummaries: string[];
}

export interface DocumentAgentRecord {
  id: string;
  fingerprint: string;
  name: string;
  readingMode: ResolvedReadingMode;
  pageCount: number;
  indexVersion: number;
  processingStatus: DocumentAgentProcessingStatus;
  profile?: DocumentProfile;
  providerId?: string;
  model?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentAgentSession {
  id: string;
  documentId: string;
  title: string;
  messages: AiConversationMessage[];
  conversationSummary?: string;
  summarizedMessageCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentAgentStrategy {
  id: ResolvedReadingMode;
  autoAnalyzeWholeDocument: boolean;
  knowledgeBoundary: "whole-document" | "current-position";
  targetChunkCharacters: number;
  chunkOverlapCharacters: number;
  chunkPages(pages: DocumentPageText[], documentId: string): DocumentChunk[];
  buildChunkAnalysisPrompt(chunkLabel: string): string;
  buildProfileSynthesisPrompt(): string;
}
