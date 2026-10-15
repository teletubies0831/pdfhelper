import type { PDFDocumentProxy } from "pdfjs-dist";

import { readJsonValue } from "../../../infrastructure/storage/browser-json-repository";
import {
  getDisplayFileName,
  getViewerSelectionText,
  MAX_SUMMARY_SOURCE_LENGTH,
  SUMMARY_NOTES_STORAGE_KEY,
  type SummaryScope,
} from "../../core/pdf-reader/public";
import {
  parseAiList,
  requestAiContent,
} from "../../shared-ui/markdown/markdown-renderer";
import {
  activeAssistantView,
  activeSummaryScope,
  currentSummaryContext,
  lastSummaryPoints,
  lastSummaryRequestKey,
  selectedTextForAi,
  summaryAbortController,
  summaryGenerationTimer,
  type SavedSummaryNote,
  type SummaryContext,
} from "../../app/public";
import {
  summaryPanelElement,
  summaryScopeButtons,
} from "../../app/viewer-elements";
import {
  pdfDocument,
  pdfViewer,
  sourceName,
} from "../../app/viewer-state";
import {
  extractPageText,
  getCurrentChapterContext,
  getSummaryLabels,
  renderSummaryPoints,
  setSummaryState,
  updateSummaryMetadata,
} from "./citation-and-summary";

export async function buildSummaryContext(
  scope: SummaryScope,
): Promise<SummaryContext> {
  if (!pdfDocument.value) throw new Error("请先打开 PDF。");

  const documentAtStart: PDFDocumentProxy = pdfDocument.value;
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
        documentName: sourceName.value
          ? getDisplayFileName(sourceName.value)
          : undefined,
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
    if (summaryAbortController.value === controller)
      summaryAbortController.value = null;
  }
}

export function readSavedSummaryNotes(): SavedSummaryNote[] {
  const value = readJsonValue<unknown>(SUMMARY_NOTES_STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
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
