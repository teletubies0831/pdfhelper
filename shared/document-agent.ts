import type { AiConversationMessage } from './ai';
import type { ResolvedReadingMode } from './reading-mode';

export const DOCUMENT_AGENT_SCHEMA_VERSION = 1;
export const DOCUMENT_AGENT_INDEX_VERSION = 1;

export type DocumentAgentProcessingStatus =
  | 'new'
  | 'extracting'
  | 'indexed'
  | 'analyzing'
  | 'ready'
  | 'needs-api-key'
  | 'error';

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
  knowledgeBoundary: 'whole-document' | 'current-position';
  targetChunkCharacters: number;
  chunkOverlapCharacters: number;
  chunkPages(pages: DocumentPageText[], documentId: string): DocumentChunk[];
  buildChunkAnalysisPrompt(chunkLabel: string): string;
  buildProfileSynthesisPrompt(): string;
}

const normalizeWhitespace = (value: string): string => value
  .replace(/\u00ad/g, '')
  .replace(/[\t ]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

function splitLongText(text: string, maxCharacters: number, overlapCharacters: number): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= maxCharacters) return [normalized];

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + maxCharacters);
    if (end < normalized.length) {
      const preferredBoundary = Math.max(
        normalized.lastIndexOf('\n\n', end),
        normalized.lastIndexOf('. ', end),
        normalized.lastIndexOf('。', end),
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

function chunkPagesByCharacterBudget(
  pages: DocumentPageText[],
  documentId: string,
  targetCharacters: number,
  overlapCharacters: number,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let order = 0;
  let buffer = '';
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
    buffer = overlapCharacters > 0 ? text.slice(-overlapCharacters) : '';
  };

  for (const page of pages) {
    const pageParts = splitLongText(page.text, targetCharacters, overlapCharacters);
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

const PAPER_STRATEGY: DocumentAgentStrategy = {
  id: 'paper',
  autoAnalyzeWholeDocument: true,
  knowledgeBoundary: 'whole-document',
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
  buildChunkAnalysisPrompt: (chunkLabel) => [
    `Read all source text in ${chunkLabel}. Create a dense retrieval note for later questions.`,
    'Separate author claims, methods, equations, experimental evidence, conclusions, and limitations.',
    'Answer in 300-700 Chinese characters using Markdown. Preserve important LaTeX equations and page references.',
    'Only report information actually present in the source. Include useful search keywords.',
  ].join('\n'),
  buildProfileSynthesisPrompt: () => [
    'The following notes cover every chunk of one paper. Synthesize a whole-paper profile.',
    'Return only a JSON object with this exact shape:',
    '{"oneSentenceSummary":"", "researchProblem":"", "method":"", "evidence":"", "conclusions":"", "limitations":"", "keywords":[""], "sections":[{"title":"", "startPage":1, "endPage":1, "summary":""}]}',
    'All natural-language fields must be Simplified Chinese. Do not invent numbers, findings, or page locations.',
  ].join('\n'),
};

const GENERAL_STRATEGY: DocumentAgentStrategy = {
  id: 'general',
  autoAnalyzeWholeDocument: false,
  knowledgeBoundary: 'whole-document',
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
  buildChunkAnalysisPrompt: (chunkLabel) => `Summarize the themes, facts, concepts, and conclusions in ${chunkLabel} in Simplified Chinese.`,
  buildProfileSynthesisPrompt: () => 'Synthesize the chunk notes into a document profile in Simplified Chinese.',
};

// Novel mode deliberately limits model-visible knowledge to the current reading position.
// It can reuse the same storage and tools without allowing retrieval from unread pages.
const NOVEL_STRATEGY: DocumentAgentStrategy = {
  id: 'novel',
  autoAnalyzeWholeDocument: false,
  knowledgeBoundary: 'current-position',
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
  buildChunkAnalysisPrompt: (chunkLabel) => `Record only characters, events, and relationships already revealed in ${chunkLabel}. Do not predict later events. Answer in Simplified Chinese.`,
  buildProfileSynthesisPrompt: () => 'Synthesize only already-read notes into a spoiler-free reading memory in Simplified Chinese.',
};

const STRATEGIES: Record<ResolvedReadingMode, DocumentAgentStrategy> = {
  general: GENERAL_STRATEGY,
  paper: PAPER_STRATEGY,
  novel: NOVEL_STRATEGY,
};

export function getDocumentAgentStrategy(mode: ResolvedReadingMode): DocumentAgentStrategy {
  return STRATEGIES[mode] ?? GENERAL_STRATEGY;
}

export function createDocumentAgentId(
  fingerprint: string,
  name: string,
  pageCount: number,
): string {
  if (fingerprint.trim()) return `pdf:${fingerprint.trim()}`;
  let hash = 2166136261;
  const source = `${name.trim().toLowerCase()}|${pageCount}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pdf:fallback:${(hash >>> 0).toString(16)}:${pageCount}`;
}

function tokenizeForSearch(value: string): string[] {
  const normalized = value.toLowerCase().normalize('NFKC');
  const latin = normalized.match(/[a-z0-9][a-z0-9_+.-]{1,}/g) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const hanBigrams = hanRuns.flatMap((run) => {
    const tokens: string[] = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
    return tokens;
  });
  return Array.from(new Set([...latin, ...hanBigrams])).slice(0, 80);
}

export interface DocumentSearchResult {
  chunk: DocumentChunk;
  score: number;
  matchedTerms: string[];
}

export function searchDocumentChunks(
  chunks: DocumentChunk[],
  query: string,
  limit = 5,
  maximumPage?: number,
): DocumentSearchResult[] {
  const terms = tokenizeForSearch(query);
  const normalizedQuery = query.toLowerCase().normalize('NFKC').trim();
  return chunks
    .filter((chunk) => maximumPage === undefined || chunk.startPage <= maximumPage)
    .map((chunk) => {
      const haystack = `${chunk.heading ?? ''}\n${chunk.summary ?? ''}\n${chunk.text}`
        .toLowerCase()
        .normalize('NFKC');
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      let score = matchedTerms.length * 4;
      for (const term of matchedTerms) score += Math.min(8, haystack.split(term).length - 1);
      if (normalizedQuery.length >= 4 && haystack.includes(normalizedQuery)) score += 24;
      if (chunk.summary && matchedTerms.some((term) => chunk.summary?.toLowerCase().includes(term))) score += 5;
      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.order - right.chunk.order)
    .slice(0, Math.max(1, Math.min(10, limit)));
}

export type DocumentToolName =
  | 'search_document'
  | 'read_pages'
  | 'read_section'
  | 'get_document_profile'
  | 'get_document_outline'
  | 'inspect_page_image';

export interface DocumentToolCall {
  name: DocumentToolName;
  arguments: Record<string, unknown>;
}

export interface DocumentToolResult {
  name: DocumentToolName;
  label: string;
  pages: number[];
  content: string;
}

export interface DocumentToolDecision {
  decision: 'answer' | 'use_tools';
  reason: string;
  calls: DocumentToolCall[];
}

export interface DocumentToolPlanningContext {
  question: string;
  currentPage: number;
  totalPages: number;
  selectedText?: string;
  currentPageText?: string;
  visionAvailable?: boolean;
  userImageAttached?: boolean;
  outlineTitles?: string[];
  previousResults?: DocumentToolResult[];
  round?: number;
}

export const DOCUMENT_TOOL_DESCRIPTIONS = [
  {
    name: 'search_document',
    description: 'Search the complete locally indexed document for relevant concepts, methods, evidence, or results.',
    arguments: { query: 'Search question or keywords', limit: 'Integer from 1 to 8; default 5' },
  },
  {
    name: 'read_pages',
    description: 'Read source text from a specific page range.',
    arguments: { startPage: 'First page', endPage: 'Last page; at most 8 consecutive pages' },
  },
  {
    name: 'read_section',
    description: 'Read the complete section identified by its outline title, including continuation pages until the next peer section.',
    arguments: { title: 'Section title, for example Introduction, Method, Experiments, or Conclusion' },
  },
  {
    name: 'get_document_profile',
    description: 'Read the whole-paper profile created during first-time processing.',
    arguments: {},
  },
  {
    name: 'get_document_outline',
    description: 'Read the PDF outline and section page numbers.',
    arguments: {},
  },
  {
    name: 'inspect_page_image',
    description: 'Visually inspect a PDF page when the question depends on a figure, chart, equation, table, diagram, image, or page layout that text extraction cannot preserve.',
    arguments: { pageNumber: 'Page to inspect', question: 'What visual information to inspect' },
  },
] as const;

export function buildDocumentToolPlanningPrompt(context: DocumentToolPlanningContext): string {
  const {
    question,
    currentPage,
    totalPages,
    selectedText = '',
    currentPageText = '',
    visionAvailable = false,
    userImageAttached = false,
    outlineTitles = [],
    previousResults = [],
    round = 1,
  } = context;
  const tools = visionAvailable
    ? DOCUMENT_TOOL_DESCRIPTIONS
    : DOCUMENT_TOOL_DESCRIPTIONS.filter((tool) => tool.name !== 'inspect_page_image');
  const evidence = previousResults.length
    ? previousResults.map((result, index) => [
      `Evidence ${index + 1}: ${result.label}`,
      result.pages.length ? `Pages: ${result.pages.join(', ')}` : 'Pages: document-level',
      result.content.slice(0, 3500),
    ].join('\n')).join('\n\n')
    : 'No document tools have been called yet.';
  return [
    'You are the evidence controller for a PDF reading agent. You do not answer the user directly.',
    `Planning round: ${round}.`,
    `Available tools: ${JSON.stringify(tools)}`,
    'Return JSON only in one of these forms:',
    '{"decision":"answer","reason":"why the accumulated evidence is sufficient","calls":[]}',
    '{"decision":"use_tools","reason":"what evidence is still missing","calls":[{"name":"search_document","arguments":{"query":"...","limit":5}}]}',
    'Use at most 3 calls in this round. Choose tools from the semantic scope of the question, not from a hard-coded keyword rule.',
    'First identify the evidence scope requested by the user, then compare it with the evidence actually available. Choose answer only when every material claim requested is already supported inside that evidence.',
    'If any part of the requested scope lies outside the selected text, current page, or accumulated results, choose use_tools. Never choose answer merely because you can infer or recall a plausible response from general knowledge.',
    'The final answering model will receive only the selected text, current-page text, and tool results. If the requested claim cannot be supported by that evidence, decision must be use_tools.',
    'Treat the visible page as a narrow observation. It does not automatically represent a complete section, a cross-page explanation, the whole document, or the meaning of a figure.',
    'Typical choices: search_document locates relevant evidence anywhere; read_section gathers a complete logical section; read_pages verifies exact neighboring pages; get_document_profile answers broad document-level questions; get_document_outline discovers structure; inspect_page_image resolves visual evidence lost by text extraction.',
    'After tool results are supplied, reassess them. You may request another tool round when they reveal a better page, section, term, figure, or evidence gap.',
    outlineTitles.length
      ? `Known PDF outline titles: ${JSON.stringify(outlineTitles.slice(0, 80))}`
      : 'The PDF has no usable outline titles. Locate relevant material with search_document or read_pages before assuming a section boundary.',
    userImageAttached
      ? 'The user attached an image to this chat turn. The attached image is handled outside these PDF tools. Do not call inspect_page_image unless the user explicitly refers to a figure or page inside the PDF.'
      : '',
    visionAvailable
      ? 'Use inspect_page_image only when the answer depends on a figure, chart, table, equation, diagram, screenshot, or spatial layout.'
      : 'No vision tool is configured. Do not invent visual details that are absent from extracted text.',
    `Current page: ${currentPage} / ${totalPages}.`,
    selectedText.trim()
      ? `Selected text:\n${selectedText.trim().slice(0, 5000)}`
      : 'Selected text: none.',
    currentPageText.trim()
      ? `Current-page text excerpt:\n${currentPageText.trim().slice(0, 6000)}`
      : 'Current-page text: unavailable.',
    `Accumulated tool evidence:\n${evidence}`,
    `User question: ${question}`,
  ].join('\n');
}

export function parseDocumentToolDecision(content: string): DocumentToolDecision {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) {
    return { decision: 'answer', reason: 'Planner returned no valid JSON.', calls: [] };
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      decision?: unknown;
      reason?: unknown;
      calls?: unknown;
    };
    const names = new Set<DocumentToolName>([
      'search_document',
      'read_pages',
      'read_section',
      'get_document_profile',
      'get_document_outline',
      'inspect_page_image',
    ]);
    const calls = (Array.isArray(parsed.calls) ? parsed.calls : [])
      .filter((call): call is { name: DocumentToolName; arguments?: unknown } => (
        Boolean(call)
        && typeof call === 'object'
        && names.has((call as { name?: DocumentToolName }).name as DocumentToolName)
      ))
      .slice(0, 3)
      .map((call) => ({
        name: call.name,
        arguments: call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
          ? call.arguments as Record<string, unknown>
          : {},
      }));
    const decision = parsed.decision === 'use_tools' && calls.length ? 'use_tools' : 'answer';
    return {
      decision,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : decision === 'use_tools'
          ? 'More document evidence is required.'
          : 'The available evidence is sufficient.',
      calls,
    };
  } catch {
    return { decision: 'answer', reason: 'Planner returned malformed JSON.', calls: [] };
  }
}

export function parseDocumentToolPlan(content: string): DocumentToolCall[] {
  return parseDocumentToolDecision(content).calls;
}

export function formatDocumentToolResults(results: DocumentToolResult[]): string {
  return results.map((result, index) => [
    `## Tool result ${index + 1}: ${result.label}`,
    result.pages.length ? `Source pages: ${result.pages.join(', ')}` : 'Source: document profile',
    result.content,
  ].join('\n')).join('\n\n');
}
