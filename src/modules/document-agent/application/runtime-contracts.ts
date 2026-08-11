import type { AiConversationMessage, AiStreamStartMessage } from "../../../../shared/ai";
import { type DocumentAgentRecord, type DocumentChunk, type DocumentOutlineItem, type DocumentProfile, type DocumentSectionProfile, type DocumentToolResult } from "../../../../shared/document-agent";
import type { ResolvedReadingMode } from "../../../../shared/reading-mode";




export type AiRequester = (
  messages: AiConversationMessage[],
  context?: AiStreamStartMessage['context'],
) => Promise<string>;


export interface DocumentKnowledgeStatus {
  text: string;
  status: DocumentAgentRecord['processingStatus'];
  completed?: number;
  total?: number;
}


export interface InitializeDocumentKnowledgeOptions {
  fingerprint: string;
  name: string;
  pageCount: number;
  readingMode: ResolvedReadingMode;
  providerId: string;
  model: string;
  hasApiKey: boolean;
  force?: boolean;
  extractPageText(pageNumber: number): Promise<string>;
  getOutline(): DocumentOutlineItem[];
  requestAi: AiRequester;
  isCurrent(): boolean;
  onStatus(status: DocumentKnowledgeStatus): void;
}


export interface InitializedDocumentKnowledge {
  documentId: string;
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
  restored: boolean;
}


export interface BuildRetrievalContextOptions {
  question: string;
  currentPage: number;
  currentPageText: string;
  selectedText: string;
  readingMode: ResolvedReadingMode;
  documentName: string;
  pageCount: number;
  record: DocumentAgentRecord | null;
  chunks: DocumentChunk[];
  outline: DocumentOutlineItem[];
  extractPageText(pageNumber: number): Promise<string>;
  requestAi: AiRequester;
  hasVisionModel: boolean;
  userImageAttached?: boolean;
  inspectPageImage?(pageNumber: number, question: string): Promise<{ content: string; model: string; cached: boolean }>;
}


export interface DocumentRetrievalContext {
  text: string;
  sourcePages: number[];
  toolResults: DocumentToolResult[];
  plannerReason: string;
  planningRounds: number;
}


export function pauseForBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}


export function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}


export function toPositivePage(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : fallback;
}


export function parseProfile(content: string, chunkSummaries: string[]): DocumentProfile {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效的论文档案 JSON。');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.flatMap((value): DocumentSectionProfile[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const section = value as Record<string, unknown>;
      const title = toStringValue(section.title);
      const summary = toStringValue(section.summary);
      if (!title && !summary) return [];
      return [{
        title: title || '未命名章节',
        startPage: toPositivePage(section.startPage),
        endPage: toPositivePage(section.endPage, toPositivePage(section.startPage)),
        summary,
      }];
    })
    : [];
  return {
    oneSentenceSummary: toStringValue(parsed.oneSentenceSummary),
    researchProblem: toStringValue(parsed.researchProblem),
    method: toStringValue(parsed.method),
    evidence: toStringValue(parsed.evidence),
    conclusions: toStringValue(parsed.conclusions),
    limitations: toStringValue(parsed.limitations),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map(toStringValue).filter(Boolean).slice(0, 30)
      : [],
    sections,
    chunkSummaries,
  };
}


export function profileToText(profile: DocumentProfile): string {
  const sections = profile.sections
    .map((section) => `- ${section.title}（第 ${section.startPage}-${section.endPage} 页）：${section.summary}`)
    .join('\n');
  return [
    `一句话总结：${profile.oneSentenceSummary}`,
    `研究问题：${profile.researchProblem}`,
    `方法：${profile.method}`,
    `证据/实验：${profile.evidence}`,
    `结论：${profile.conclusions}`,
    `局限性：${profile.limitations}`,
    `关键词：${profile.keywords.join('、')}`,
    sections ? `章节：\n${sections}` : '',
  ].filter(Boolean).join('\n');
}


export function attachChunkHeadings(chunks: DocumentChunk[], outline: DocumentOutlineItem[]): void {
  if (outline.length === 0) return;
  const ordered = [...outline].sort((left, right) => left.pageNumber - right.pageNumber);
  for (const chunk of chunks) {
    let heading = '';
    for (const item of ordered) {
      if (item.pageNumber > chunk.startPage) break;
      heading = item.title;
    }
    if (heading) chunk.heading = heading;
  }
}
