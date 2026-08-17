import { type PDFDocumentProxy } from "pdfjs-dist";






import { isVisionAiConfigured, type AiImageAttachment } from "../../../../shared/ai";

import { createDocumentAgentId, type DocumentAgentRecord, type DocumentChunk, type DocumentOutlineItem } from "../../../../shared/document-agent";


import { getDocumentAgentRecord, getDocumentChunks } from "../../../../entrypoints/viewer/document-agent-store";

import { buildDocumentRetrievalContext, initializeDocumentKnowledge } from "../../../../entrypoints/viewer/document-agent-runtime";


import { extractPageText, getCurrentChapterContext, getOutlinePageItems, getSummaryLabels, renderSummaryPoints, setSummaryState, updateSummaryMetadata } from '../../features/translation/public';
import { getPdfFingerprint } from '../../features/annotations/public';
import { setStatus } from '../../features/recent-files/public';
import { documentKnowledgeCache, documentKnowledgeTasks, pdfDocument, pdfViewer, sourceName } from '../../app/viewer-state';
import { parseAiList, requestAiContent, updateChatActivity } from '../../shared-ui/markdown/markdown-renderer';
import { MAX_SUMMARY_SOURCE_LENGTH, SUMMARY_NOTES_STORAGE_KEY, activeAssistantView, activeSummaryScope, aiConfig, currentSummaryContext, getViewerSelectionText, lastSummaryPoints, lastSummaryRequestKey, selectedTextForAi, summaryAbortController, summaryGenerationTimer, visionAiConfig } from '../../core/pdf-reader/public';
import { inspectChatImageWithVision } from '../../features/assistant/public';
import { getDisplayFileName } from '../../core/pdf-reader/public';
import { summaryPanelElement, summaryScopeButtons } from '../../app/viewer-elements';
import { refreshKnowledgeBaseIfOpen } from '../../features/knowledge-base/public';
import type { SavedSummaryNote, SummaryContext, SummaryScope } from '../../core/pdf-reader/public';
import { readJsonValue, writeJsonValue } from '../../../platform/storage/browser-json-repository';



export function getDocumentAgentOutline(): DocumentOutlineItem[] {
  return getOutlinePageItems().map((item) => ({ ...item, depth: 0 }));
}


export async function ensureDocumentKnowledge(
  documentProxy: PDFDocumentProxy,
  assistantMessage: HTMLElement,
): Promise<{ record: DocumentAgentRecord; chunks: DocumentChunk[] }> {
  const fingerprint = getPdfFingerprint(documentProxy) || sourceName.value || "local-pdf";
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
      updateChatActivity(
        assistantMessage,
        "document-index",
        "已加载 PDF 本地索引",
        "done",
        `${storedChunks.length} 个文本块`,
      );
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
      extractPageText: (pageNumber) => extractPageText(documentProxy, pageNumber),
      getOutline: getDocumentAgentOutline,
      requestAi: requestAiContent,
      isCurrent: () => pdfDocument.value === documentProxy,
      onStatus: (status) => updateChatActivity(
        assistantMessage,
        "document-index",
        status.text,
        status.status === "error" ? "error" : status.status === "indexed" || status.status === "ready" || status.status === "needs-api-key" ? "done" : "active",
        status.total ? `${status.completed ?? 0}/${status.total}` : "",
      ),
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
    documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
    pageNumber,
    totalPages: documentProxy.numPages,
    readingMode: "paper",
  });
  return { content, model: visionAiConfig.value.model, cached: false };
}


export async function buildAgentEvidence(
  question: string,
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
  selectedText: string,
  userImageAttached: boolean,
  assistantMessage: HTMLElement,
): Promise<Awaited<ReturnType<typeof buildDocumentRetrievalContext>>> {
  const knowledge = await ensureDocumentKnowledge(documentProxy, assistantMessage);
  updateChatActivity(assistantMessage, "agent-plan", "Agent 正在规划工具 · document", "active");
  const currentPageText = await extractPageText(documentProxy, pageNumber).catch(() => "");
  const result = await buildDocumentRetrievalContext({
    question,
    currentPage: pageNumber,
    currentPageText,
    selectedText,
    readingMode: "paper",
    documentName: sourceName.value || "未命名 PDF",
    pageCount: documentProxy.numPages,
    record: knowledge.record,
    chunks: knowledge.chunks,
    outline: getDocumentAgentOutline(),
    extractPageText: (targetPage) => extractPageText(documentProxy, targetPage),
    requestAi: requestAiContent,
    hasVisionModel: isVisionAiConfigured(visionAiConfig.value),
    userImageAttached,
    inspectPageImage: (targetPage, targetQuestion) => inspectPdfPageWithVision(
      documentProxy,
      targetPage,
      targetQuestion,
    ),
  });
  console.groupCollapsed(`[PDFPal Agent] 证据检索完成 · ${result.planningRounds} 轮`);
  console.log("规划原因", result.plannerReason);
  console.log("工具调用结果", result.toolResults);
  console.log("送入最终回答的证据", result.text);
  console.groupEnd();
  result.toolResults.forEach((tool, index) => updateChatActivity(
    assistantMessage,
    `document-tool-${index}`,
    `Agent 已完成 · ${tool.name}`,
    "done",
    tool.pages.length ? `第 ${tool.pages.join("、")} 页` : tool.name,
  ));
  updateChatActivity(
    assistantMessage,
    "agent-plan",
    result.toolResults.length ? "Agent 检索完成" : "Agent 判断无需追加检索",
    "done",
    `${result.planningRounds} 轮`,
  );
  return result;
}


export async function buildSummaryContext(
  scope: SummaryScope,
): Promise<SummaryContext> {
  if (!pdfDocument.value) throw new Error("请先打开 PDF。");

  const documentAtStart = pdfDocument.value;
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const labels = getSummaryLabels(scope);
  let text = "";

  if (scope === "selection") {
    text = selectedTextForAi.value || getViewerSelectionText();
    if (!text) throw new Error("请先在 PDF 中选中需要总结的文字。");
  } else if (scope === "page") {
    text = await extractPageText(documentAtStart, pageNumber);
  } else {
    const chapter = getCurrentChapterContext(pageNumber);
    const pages: string[] = [];
    let currentLength = 0;

    for (
      let currentPage = chapter.startPage;
      currentPage <= chapter.endPage;
      currentPage += 1
    ) {
      if (pdfDocument.value !== documentAtStart)
        throw new Error("PDF 已切换，请重新总结。");
      const pageText = await extractPageText(documentAtStart, currentPage);
      if (!pageText) continue;

      const remainingLength = MAX_SUMMARY_SOURCE_LENGTH - currentLength;
      if (remainingLength <= 0) break;
      pages.push(pageText.slice(0, remainingLength));
      currentLength += pageText.length;
    }

    text = pages.join("\n\n");
  }

  text = text.trim().slice(0, MAX_SUMMARY_SOURCE_LENGTH);
  if (!text) throw new Error("当前范围没有可总结的文字内容。");

  return { ...labels, text };
}


export function cancelPendingSummaryGeneration(): void {
  if (summaryGenerationTimer.value !== null) {
    clearTimeout(summaryGenerationTimer.value);
    summaryGenerationTimer.value = null;
  }
}


export function scheduleSummaryGeneration(delay = 350): void {
  cancelPendingSummaryGeneration();
  summaryGenerationTimer.value = setTimeout(() => {
    summaryGenerationTimer.value = null;
    if (activeAssistantView.value === "summary" && !summaryPanelElement.hidden)
      void generateSummary();
  }, delay);
}


export function setActiveSummaryScope(scope: SummaryScope): void {
  activeSummaryScope.value = scope;
  lastSummaryRequestKey.value = "";
  lastSummaryPoints.value = [];
  currentSummaryContext.value = null;
  summaryAbortController.value?.abort();

  for (const button of summaryScopeButtons) {
    button.classList.toggle("active", button.dataset.summaryScope === scope);
  }

  updateSummaryMetadata();
  scheduleSummaryGeneration(0);
}


export async function generateSummary(force = false): Promise<void> {
  if (!pdfDocument.value) {
    setSummaryState("请先打开 PDF。", true);
    return;
  }

  summaryAbortController.value?.abort();
  const controller = new AbortController();
  summaryAbortController.value = controller;
  const scopeAtStart = activeSummaryScope.value;
  updateSummaryMetadata();
  setSummaryState("正在读取总结对象，请稍候…", false, false);

  try {
    const context = await buildSummaryContext(scopeAtStart);
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope.value)
      return;

    currentSummaryContext.value = context;
    updateSummaryMetadata(context);
    const requestKey = [
      context.scope,
      context.sourceLabel,
      context.positionLabel,
      context.text,
    ].join("\u0000");

    if (
      !force &&
      requestKey === lastSummaryRequestKey.value &&
      lastSummaryPoints.value.length > 0
    ) {
      renderSummaryPoints(lastSummaryPoints.value);
      return;
    }

    setSummaryState("正在生成核心要点，请稍候…");
    const summaryContent = await requestAiContent(
      [
        {
          role: "user",
          content: [
            `请总结下面的 PDF 内容。范围：${context.rangeLabel}；来源：${context.sourceLabel}；位置：${context.positionLabel}。`,
            "请输出 4—6 条简体中文核心要点，每行一条，不要添加标题、前言或结尾。",
            "",
            context.text,
          ].join("\n"),
        },
      ],
      {
        documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
        pageNumber: Math.max(1, pdfViewer.currentPageNumber || 1),
      },
    );
    const points = parseAiList(summaryContent).slice(0, 8);

    if (!points.length) throw new Error("模型没有返回总结内容。");
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope.value)
      return;

    lastSummaryRequestKey.value = requestKey;
    renderSummaryPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope.value)
      return;

    const message = error instanceof Error ? error.message : String(error);
    setSummaryState(`总结失败：${message}`, true);
  } finally {
    if (summaryAbortController.value === controller) summaryAbortController.value = null;
  }
}


export function readSavedSummaryNotes(): SavedSummaryNote[] {
  const value = readJsonValue<unknown>(SUMMARY_NOTES_STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
}


export function saveCurrentSummaryAsNote(): void {
  if (!currentSummaryContext.value || lastSummaryPoints.value.length === 0) {
    setStatus("当前没有可保存的总结要点。", true);
    return;
  }

  const note: SavedSummaryNote = {
    id: crypto.randomUUID(),
    documentName: getDisplayFileName(sourceName.value),
    scope: currentSummaryContext.value.scope,
    rangeLabel: currentSummaryContext.value.rangeLabel,
    sourceLabel: currentSummaryContext.value.sourceLabel,
    positionLabel: currentSummaryContext.value.positionLabel,
    points: [...lastSummaryPoints.value],
    createdAt: new Date().toISOString(),
  };
  const notes = [note, ...readSavedSummaryNotes()].slice(0, 100);
  writeJsonValue(SUMMARY_NOTES_STORAGE_KEY, notes);
  refreshKnowledgeBaseIfOpen();
  setStatus(`已将 ${lastSummaryPoints.value.length} 条总结要点保存为笔记。`);
}


export function resetSummaryState(): void {
  cancelPendingSummaryGeneration();
  summaryAbortController.value?.abort();
  summaryAbortController.value = null;
  activeSummaryScope.value = "selection";
  currentSummaryContext.value = null;
  lastSummaryRequestKey.value = "";
  lastSummaryPoints.value = [];

  for (const button of summaryScopeButtons) {
    button.classList.toggle(
      "active",
      button.dataset.summaryScope === "selection",
    );
  }

  updateSummaryMetadata();
  setSummaryState("选择总结范围后，将自动生成核心要点。");
}
