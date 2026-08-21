import type { ResolvedReadingMode } from "../../../shared/reading-mode";
import type {
  DocumentAgentStrategy,
  DocumentChunk,
  DocumentPageText,
} from "./contracts";

export const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\u00ad/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function splitLongText(
  text: string,
  maxCharacters: number,
  overlapCharacters: number,
): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= maxCharacters) return [normalized];

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + maxCharacters);
    if (end < normalized.length) {
      const preferredBoundary = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("。", end),
      );
      if (preferredBoundary > cursor + Math.floor(maxCharacters * 0.58)) {
        end = preferredBoundary + 1;
      }
    }
    const part = normalized.slice(cursor, end).trim();
    if (part) parts.push(part);
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - overlapCharacters);
  }
  return parts;
}

export function chunkPagesByCharacterBudget(
  pages: DocumentPageText[],
  documentId: string,
  targetCharacters: number,
  overlapCharacters: number,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let order = 0;
  let buffer = "";
  let startPage = 1;
  let endPage = 1;

  const pushBuffer = (): void => {
    const text = buffer.trim();
    if (!text) return;
    chunks.push({
      id: `${documentId}:chunk:${order}`,
      documentId,
      order,
      startPage,
      endPage,
      text,
    });
    order += 1;
    buffer = overlapCharacters > 0 ? text.slice(-overlapCharacters) : "";
  };

  for (const page of pages) {
    const pageParts = splitLongText(
      page.text,
      targetCharacters,
      overlapCharacters,
    );
    for (const pagePart of pageParts) {
      const markedPart = `[Page ${page.pageNumber}]\n${pagePart}`;
      if (!buffer) startPage = page.pageNumber;
      if (buffer && buffer.length + markedPart.length + 2 > targetCharacters) {
        pushBuffer();
        startPage = page.pageNumber;
      }
      buffer = buffer ? `${buffer}\n\n${markedPart}` : markedPart;
      endPage = page.pageNumber;
    }
  }
  pushBuffer();
  return chunks;
}

export const PAPER_STRATEGY: DocumentAgentStrategy = {
  id: "paper",
  autoAnalyzeWholeDocument: true,
  knowledgeBoundary: "whole-document",
  targetChunkCharacters: 9000,
  chunkOverlapCharacters: 500,
  chunkPages(pages, documentId) {
    return chunkPagesByCharacterBudget(
      pages,
      documentId,
      this.targetChunkCharacters,
      this.chunkOverlapCharacters,
    );
  },
  buildChunkAnalysisPrompt: (chunkLabel) =>
    [
      `Read all source text in ${chunkLabel}. Create a dense retrieval note for later questions.`,
      "Separate author claims, methods, equations, experimental evidence, conclusions, and limitations.",
      "Answer in 300-700 Chinese characters using Markdown. Preserve important LaTeX equations and page references.",
      "Only report information actually present in the source. Include useful search keywords.",
    ].join("\n"),
  buildProfileSynthesisPrompt: () =>
    [
      "The following notes cover every chunk of one paper. Synthesize a whole-paper profile.",
      "Return only a JSON object with this exact shape:",
      '{"oneSentenceSummary":"", "researchProblem":"", "method":"", "evidence":"", "conclusions":"", "limitations":"", "keywords":[""], "sections":[{"title":"", "startPage":1, "endPage":1, "summary":""}]}',
      "All natural-language fields must be Simplified Chinese. Do not invent numbers, findings, or page locations.",
    ].join("\n"),
};

export const GENERAL_STRATEGY: DocumentAgentStrategy = {
  id: "general",
  autoAnalyzeWholeDocument: false,
  knowledgeBoundary: "whole-document",
  targetChunkCharacters: 8000,
  chunkOverlapCharacters: 450,
  chunkPages(pages, documentId) {
    return chunkPagesByCharacterBudget(
      pages,
      documentId,
      this.targetChunkCharacters,
      this.chunkOverlapCharacters,
    );
  },
  buildChunkAnalysisPrompt: (chunkLabel) =>
    `Summarize the themes, facts, concepts, and conclusions in ${chunkLabel} in Simplified Chinese.`,
  buildProfileSynthesisPrompt: () =>
    "Synthesize the chunk notes into a document profile in Simplified Chinese.",
};

// Novel mode deliberately limits model-visible knowledge to the current reading position.
// It can reuse the same storage and tools without allowing retrieval from unread pages.
export const NOVEL_STRATEGY: DocumentAgentStrategy = {
  id: "novel",
  autoAnalyzeWholeDocument: false,
  knowledgeBoundary: "current-position",
  targetChunkCharacters: 7000,
  chunkOverlapCharacters: 600,
  chunkPages(pages, documentId) {
    return chunkPagesByCharacterBudget(
      pages,
      documentId,
      this.targetChunkCharacters,
      this.chunkOverlapCharacters,
    );
  },
  buildChunkAnalysisPrompt: (chunkLabel) =>
    `Record only characters, events, and relationships already revealed in ${chunkLabel}. Do not predict later events. Answer in Simplified Chinese.`,
  buildProfileSynthesisPrompt: () =>
    "Synthesize only already-read notes into a spoiler-free reading memory in Simplified Chinese.",
};

export const STRATEGIES: Record<ResolvedReadingMode, DocumentAgentStrategy> = {
  general: GENERAL_STRATEGY,
  paper: PAPER_STRATEGY,
  novel: NOVEL_STRATEGY,
};

export function getDocumentAgentStrategy(
  mode: ResolvedReadingMode,
): DocumentAgentStrategy {
  return STRATEGIES[mode] ?? GENERAL_STRATEGY;
}
