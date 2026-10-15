import { type PDFDocumentProxy } from "pdfjs-dist";

import {
  isVisionAiConfigured,
  type AiImageAttachment,
} from "../../../modules/ai/public";

import {
  createDocumentAgentId,
  executeDocumentToolCalls,
  getDocumentAgentRecord,
  getDocumentChunks,
  initializeDocumentKnowledge,
  type DocumentAgentRecord,
  type DocumentChunk,
  type DocumentOutlineItem,
} from "../../../modules/document-agent/public";
import type {
  DocumentToolCall,
  DocumentToolResult,
} from "../../../modules/document-agent/public";
import type { AiDocumentContext } from "../../../modules/ai/public";

import {
  extractPageText,
  getOutlinePageItems,
} from "../../features/translation/public";
import { getPdfFingerprint } from "../../app/document-identity";
import {
  documentKnowledgeCache,
  documentKnowledgeTasks,
  pdfDocument,
  pdfViewer,
  sourceName,
} from "../../app/viewer-state";
import {
  requestAiContent,
  updateChatActivity,
} from "../../shared-ui/markdown/markdown-renderer";
import { inspectChatImageWithVision } from "../../features/assistant/chat-image-service";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { aiConfig, visionAiConfig } from "../../app/public";



export function getDocumentAgentOutline(): DocumentOutlineItem[] {
  return getOutlinePageItems().map((item) => ({ ...item, depth: 0 }));
}

export async function ensureDocumentKnowledge(
  documentProxy: PDFDocumentProxy,
  assistantMessage: HTMLElement | null,
): Promise<{ record: DocumentAgentRecord; chunks: DocumentChunk[] }> {
  const fingerprint =
    getPdfFingerprint(documentProxy) || sourceName.value || "local-pdf";
  const documentId = createDocumentAgentId(
    fingerprint,
    sourceName.value || "未命名 PDF",
    documentProxy.numPages,
  );
  const cached = documentKnowledgeCache.get(documentId);
  if (cached) return cached;
  const running = documentKnowledgeTasks.get(documentId);
  if (running) return running;

  const task = (async () => {
    const storedRecord = await getDocumentAgentRecord(documentId);
    const storedChunks = await getDocumentChunks(documentId);
    if (storedRecord && storedChunks.length > 0) {
      const restored = { record: storedRecord, chunks: storedChunks };
      documentKnowledgeCache.set(documentId, restored);
      if (assistantMessage) {
        updateChatActivity(
          assistantMessage,
          "document-index",
          "已加载 PDF 本地索引",
          "done",
          `${storedChunks.length} 个文本块`,
        );
      }
      return restored;
    }

    const initialized = await initializeDocumentKnowledge({
      fingerprint,
      name: sourceName.value || "未命名 PDF",
      pageCount: documentProxy.numPages,
      readingMode: "paper",
      providerId: aiConfig.value.providerId,
      model: aiConfig.value.model,
      // 首次只建立本地索引；不在打开文档时额外消耗模型 Token 生成全文摘要。
      hasApiKey: false,
      extractPageText: (pageNumber) =>
        extractPageText(documentProxy, pageNumber),
      getOutline: getDocumentAgentOutline,
      requestAi: requestAiContent,
      isCurrent: () => pdfDocument.value === documentProxy,
      onStatus: (status) => {
        if (!assistantMessage) return;
        updateChatActivity(
          assistantMessage,
          "document-index",
          status.text,
          status.status === "error"
            ? "error"
            : status.status === "indexed" ||
                status.status === "ready" ||
                status.status === "needs-api-key"
              ? "done"
              : "active",
          status.total ? `${status.completed ?? 0}/${status.total}` : "",
        );
      },
    });
    const result = { record: initialized.record, chunks: initialized.chunks };
    documentKnowledgeCache.set(documentId, result);
    return result;
  })();
  documentKnowledgeTasks.set(documentId, task);
  try {
    return await task;
  } finally {
    documentKnowledgeTasks.delete(documentId);
  }
}

export async function inspectPdfPageWithVision(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
  question: string,
): Promise<{ content: string; model: string; cached: boolean }> {
  const page = await documentProxy.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.65 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const canvasContext = canvas.getContext("2d", { alpha: false });
  if (!canvasContext) throw new Error("浏览器无法渲染 PDF 页面图像。");
  canvasContext.fillStyle = "#fff";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext, viewport }).promise;
  const attachment: AiImageAttachment = {
    id: `pdf-page-${pageNumber}`,
    name: `PDF 第 ${pageNumber} 页.png`,
    mediaType: "image/jpeg",
    dataUrl: canvas.toDataURL("image/jpeg", 0.88),
    width: canvas.width,
    height: canvas.height,
  };
  const content = await inspectChatImageWithVision(attachment, question, {
    documentName: sourceName.value
      ? getDisplayFileName(sourceName.value)
      : undefined,
    pageNumber,
    totalPages: documentProxy.numPages,
    readingMode: "paper",
  });
  return { content, model: visionAiConfig.value.model, cached: false };
}

const APPLICATION_DOCUMENT_TOOL_NAMES: Record<string, DocumentToolCall["name"]> = {
  "document.search": "search_document",
  "document.readPages": "read_pages",
  "document.readSection": "read_section",
  "document.getProfile": "get_document_profile",
  "document.getOutline": "get_document_outline",
  "document.inspectPageImage": "inspect_page_image",
};

export async function executeViewerDocumentTool(
  applicationName: string,
  argumentsValue: Record<string, unknown>,
  context?: AiDocumentContext,
): Promise<DocumentToolResult> {
  const toolName = APPLICATION_DOCUMENT_TOOL_NAMES[applicationName];
  if (!toolName) throw new Error(`未知的当前 PDF 工具：${applicationName}`);
  const documentAtStart = pdfDocument.value;
  if (!documentAtStart) throw new Error("当前没有打开 PDF，无法调用文档工具。");

  const currentPage = Math.max(
    1,
    Math.min(
      documentAtStart.numPages,
      context?.pageNumber || pdfViewer.currentPageNumber || 1,
    ),
  );
  const knowledge = await ensureDocumentKnowledge(documentAtStart, null);
  if (pdfDocument.value !== documentAtStart) {
    throw new Error("PDF 已切换，请在新文档中重新调用工具。");
  }
  const question = [
    argumentsValue.query,
    argumentsValue.question,
    argumentsValue.title,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0)
    || "读取当前 PDF 中的相关证据";
  const [result] = await executeDocumentToolCalls(
    [{ name: toolName, arguments: argumentsValue }],
    {
      question,
      currentPage,
      currentPageText:
        context?.pageText?.trim()
        || await extractPageText(documentAtStart, currentPage).catch(() => ""),
      selectedText: context?.selectedText?.trim() || "",
      readingMode: "paper",
      documentName: sourceName.value || "未命名 PDF",
      pageCount: documentAtStart.numPages,
      record: knowledge.record,
      chunks: knowledge.chunks,
      outline: getDocumentAgentOutline(),
      extractPageText: (targetPage) => extractPageText(documentAtStart, targetPage),
      requestAi: requestAiContent,
      hasVisionModel: isVisionAiConfigured(visionAiConfig.value),
      inspectPageImage: (targetPage, targetQuestion) =>
        inspectPdfPageWithVision(documentAtStart, targetPage, targetQuestion),
    },
  );
  if (!result) throw new Error(`文档工具 ${applicationName} 没有返回结果。`);
  return result;
}
