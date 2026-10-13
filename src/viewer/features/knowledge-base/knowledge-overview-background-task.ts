import { browser } from "wxt/browser";
import type { AiRuntimeResponse } from "../../../modules/ai/public";
import { MAX_PAPER_CARD_SOURCE_LENGTH } from "../../core/pdf-reader/public";
import { getKnowledgeDocument, updateKnowledgeDocument } from "./knowledge-corpus-repository";

const activeOverviews = new Map<string, Promise<string>>();

export function isKnowledgeOverviewActive(documentId: string): boolean {
  return activeOverviews.has(documentId);
}

export interface ExtractedKnowledgePage {
  pageNumber: number;
  text: string;
}

export function getDocumentOverviewPageNumbers(totalPages: number): number[] {
  if (totalPages <= 30) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const targetCount = Math.min(36, Math.max(20, Math.ceil(Math.sqrt(totalPages) * 2)));
  const pages = new Set<number>([1, 2, 3, 4, totalPages - 2, totalPages - 1, totalPages]);
  for (let index = 0; index < targetCount; index += 1) {
    pages.add(Math.round(1 + (index / (targetCount - 1)) * (totalPages - 1)));
  }
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

function buildDocumentOverviewSample(
  pages: ExtractedKnowledgePage[],
  pageCount: number,
): string {
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page.text]));
  const selectedPageNumbers = getDocumentOverviewPageNumbers(pageCount);
  const perPageLimit = Math.max(
    900,
    Math.floor((MAX_PAPER_CARD_SOURCE_LENGTH - selectedPageNumbers.length * 18) / selectedPageNumbers.length),
  );
  const chunks: string[] = [];
  for (const pageNumber of selectedPageNumbers) {
    const pageText = pageByNumber.get(pageNumber)?.trim();
    if (!pageText) continue;
    const header = `\n\n[第 ${pageNumber} 页]\n`;
    const clipped = pageText.slice(0, perPageLimit);
    chunks.push(`${header}${clipped}`);
  }
  return chunks.join("").slice(0, MAX_PAPER_CARD_SOURCE_LENGTH).trim();
}

type OverviewInput = {
  documentId: string;
  documentName: string;
  recentEntryId?: string;
  pageCount: number;
  pages: ExtractedKnowledgePage[];
  onProgress?: (message: string) => void;
};

export function generateAndSaveKnowledgeOverview(input: OverviewInput): Promise<string> {
  const existing = activeOverviews.get(input.documentId);
  if (existing) return existing;
  const pending = Promise.resolve().then(() => generateOverview(input)).finally(() => {
    if (activeOverviews.get(input.documentId) !== pending) return;
    activeOverviews.delete(input.documentId);
    window.dispatchEvent(new CustomEvent("pdf-helper:knowledge-corpus-change"));
  });
  activeOverviews.set(input.documentId, pending);
  return pending;
}

async function generateOverview(input: OverviewInput): Promise<string> {
  const text = buildDocumentOverviewSample(input.pages, input.pageCount);
  if (!text) throw new Error("PDF 没有可用于生成概览的文字内容。");
  const requestId = `pdf-overview:${crypto.randomUUID()}`;

  updateKnowledgeDocument(input.documentId, {
    overviewStatus: "generating",
    overviewError: undefined,
    overviewRequestId: requestId,
    overviewProgress: "正在生成 PDF 概览，已有内容暂时保留；新结果完成后会自动更新。遇到限流会自动等待重试。",
  });
  input.onProgress?.("全文索引已完成，正在后台生成 PDF 概览；遇到供应商限流会自动等待重试，长文可能需要几分钟。");

  const onMessage = (message: unknown): undefined => {
    if (!message || typeof message !== 'object') return;
    const progress = message as Record<string, unknown>;
    if (progress.type !== 'pdf-helper:ai-document-overview-progress' || progress.requestId !== requestId ||
        typeof progress.content !== 'string' || !progress.content.trim() || typeof progress.message !== 'string') return;
    if (getKnowledgeDocument(input.documentId)?.overviewRequestId !== requestId) return;
    updateKnowledgeDocument(input.documentId, {
      overviewDraftMarkdown: progress.content,
      overviewDraftComplete: progress.complete === true,
      overviewProgress: progress.message,
    });
    input.onProgress?.(progress.message);
  };
  browser.runtime.onMessage.addListener(onMessage);

  try {
    const response = await browser.runtime.sendMessage({
      type: "pdf-helper:ai-generate-document-overview",
      requestId,
      documentName: input.documentName,
      pageCount: input.pageCount,
      text,
    }) as AiRuntimeResponse;
    if (!response?.ok || !response.content?.trim()) {
      throw new Error(response?.error || "AI 模型没有返回有效的 PDF 概览。");
    }
    const markdown = response.content.trim();
    if (getKnowledgeDocument(input.documentId)?.overviewRequestId !== requestId) return markdown;
    updateKnowledgeDocument(input.documentId, {
      overviewStatus: "ready",
      overviewMarkdown: markdown,
      overviewGeneratedAt: new Date().toISOString(),
      overviewError: undefined,
      overviewDraftMarkdown: undefined,
      overviewDraftComplete: undefined,
      overviewProgress: undefined,
    });
    return markdown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (getKnowledgeDocument(input.documentId)?.overviewRequestId === requestId) {
      updateKnowledgeDocument(input.documentId, {
        overviewStatus: "error",
        overviewError: message,
      });
    }
    throw error;
  } finally {
    browser.runtime.onMessage.removeListener(onMessage);
  }
}
