
















import { SAVED_PAPER_OVERVIEWS_STORAGE_KEY, editingPaperOverviewId, paperCardPageAbortController, paperCardPageDocumentKey, paperCardPageSourceCache, paperCardReturnTarget, paperCardReviewDocumentName, persistCurrentAppViewState, selectedKnowledgeRecordKey } from "../../core/pdf-reader/public";
import { aiPanelToggleButton, appFrame, knowledgeBaseEntryButton, knowledgeBasePageElement, paperCardDocumentNameElement, paperCardFormElement, paperCardPageElement, paperCardSectionButtons, paperKeywordsInput, paperPersonalNotesInput, paperResearchAreaInput, paperTitleInput } from "../../app/viewer-elements";
import { currentRecentEntryId, pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";


import { getDocumentChatId, setCurrentApplicationView } from "../assistant/public";
import { getKnowledgeRecordKey, openKnowledgeEditor, refreshKnowledgeBaseIfOpen, renderKnowledgeBase, setKnowledgePageStatus } from "../knowledge-base/public";
import type { KnowledgeItem, PaperCardFormData, SavedPaperOverview } from "../../core/pdf-reader/public";
import { cancelActivePaperOverviewRequest, clearPaperCardReviewState, collectPaperCardFormData, renderPaperCardForm, schedulePaperCardTextareaRefresh, setPaperCardEditMode, setPaperCardPageMode, setPaperCardPageStatus, updatePaperCardDocumentName } from './paper-card-form';
import { generatePaperOverviewCard } from './paper-card-generator';
import { getCurrentPaperSourceLocator } from './reading-card';
import { readJsonValue, writeJsonValue } from '../../../platform/storage/browser-json-repository';
import { setStatus } from "../recent-files/public";




export function openPaperCardPage(): void {
  clearPaperCardReviewState();
  knowledgeBasePageElement.hidden = false;
  appFrame?.classList.add("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  paperCardPageElement.hidden = false;
  appFrame?.classList.add("paper-card-page-open", "paper-card-review-overlay-open");
  aiPanelToggleButton?.classList.remove("active");
  setCurrentApplicationView("paper-card");
  updatePaperCardDocumentName();
  setPaperCardEditMode(false);
  paperCardPageElement.scrollTop = 0;
  setActivePaperCardSection("paper-card-section-overview");
  schedulePaperCardTextareaRefresh();
  void generatePaperOverviewCard();
}



export function setActivePaperCardSection(sectionId: string): void {
  for (const button of paperCardSectionButtons) {
    button.classList.toggle(
      "active",
      button.dataset.paperCardSection === sectionId,
    );
  }
}



export function syncPaperCardSectionFromScroll(container: HTMLElement): void {
  if (paperCardPageElement.hidden || !paperCardSectionButtons.length) return;
  const containerTop = container.getBoundingClientRect().top;
  let closestId = "";
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const button of paperCardSectionButtons) {
    const sectionId = button.dataset.paperCardSection;
    if (!sectionId) continue;
    const section = document.getElementById(sectionId);
    if (!section || !container.contains(section)) continue;
    const distance = Math.abs(section.getBoundingClientRect().top - containerTop - 12);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = sectionId;
    }
  }
  if (closestId) setActivePaperCardSection(closestId);
}



export function openSavedPaperOverviewReview(item: KnowledgeItem): void {
  if (item.source !== "paper-overview") {
    openKnowledgeEditor(item);
    return;
  }

  const card = readSavedPaperOverviews().find(
    (candidate) => candidate.id === item.id,
  );
  if (!card) {
    setKnowledgePageStatus(
      "这张论文卡片已经不存在，请刷新知识库后重试。",
      true,
    );
    renderKnowledgeBase();
    return;
  }

  paperCardPageAbortController.value?.abort();
  cancelActivePaperOverviewRequest();
  paperCardPageAbortController.value = null;
  editingPaperOverviewId.value = card.id;
  paperCardReviewDocumentName.value = card.documentName || item.documentName;
  paperCardReturnTarget.value = "knowledge";
  paperCardPageDocumentKey.value = `saved:${card.id}`;
  paperCardPageSourceCache.value = null;

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.add("active");
  paperCardPageElement.hidden = false;
  appFrame?.classList.add("paper-card-page-open");
  aiPanelToggleButton?.classList.remove("active");
  setCurrentApplicationView("paper-card");

  setPaperCardPageMode("review");
  updatePaperCardDocumentName();
  renderPaperCardForm(card);
  paperPersonalNotesInput.value = card.personalNotes || "";
  paperCardFormElement.dataset.paperReady = "true";
  document.dispatchEvent(
    new CustomEvent("pdf-helper:paper-card-ready", {
      detail: {
        title: paperTitleInput.value.trim(),
        keywords: paperKeywordsInput.value.trim(),
        researchArea: paperResearchAreaInput.value.trim(),
        documentName: paperCardDocumentNameElement.value.trim(),
      },
    }),
  );
  setPaperCardEditMode(false);
  setPaperCardPageStatus();
  paperCardPageElement.scrollTop = 0;
  schedulePaperCardTextareaRefresh();
  persistCurrentAppViewState();
}



export function closePaperCardPage(destination: "pdf" | "knowledge" = "pdf"): void {
  paperCardPageAbortController.value?.abort();
  cancelActivePaperOverviewRequest();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove("paper-card-page-open", "paper-card-review-overlay-open");

  const returnToKnowledge = destination === "knowledge";
  clearPaperCardReviewState();

  if (returnToKnowledge) {
    knowledgeBasePageElement.hidden = false;
    appFrame?.classList.add("knowledge-base-page-open");
    knowledgeBaseEntryButton.classList.add("active");
    aiPanelToggleButton?.classList.remove("active");
    setCurrentApplicationView("knowledge");
    renderKnowledgeBase();
    return;
  }

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  aiPanelToggleButton?.classList.add("active");
  setCurrentApplicationView("viewer");
  persistCurrentAppViewState();
}

export function openPaperCardSource(): void {
  const expectedDocumentName = paperCardReviewDocumentName.value.trim();
  const currentDocumentName = sourceName.value
    ? getDisplayFileName(sourceName.value)
    : "";
  if (!pdfDocument.value || (expectedDocumentName && currentDocumentName !== expectedDocumentName)) {
    setStatus(`请先打开来源文件“${expectedDocumentName || "对应论文"}”。`, true);
    return;
  }
  closePaperCardPage("pdf");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pdfViewer.currentPageNumber = 1;
      pdfViewer.scrollPageIntoView({ pageNumber: 1 });
      setStatus("已返回论文原文第 1 页。");
    });
  });
}



export function readSavedPaperOverviews(): SavedPaperOverview[] {
  const value = readJsonValue<unknown>(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
}



export function savePaperOverviewCard(): void {
  const data = collectPaperCardFormData();
  if (!data.title && !data.oneSentenceSummary) {
    setPaperCardPageStatus("当前没有可保存的论文卡片内容。", true);
    return;
  }

  const now = new Date().toISOString();
  const cards = readSavedPaperOverviews();

  if (editingPaperOverviewId.value) {
    const existing = cards.find((card) => card.id === editingPaperOverviewId.value);
    if (!existing) {
      setPaperCardPageStatus("原论文卡片已经不存在，无法保存修改。", true);
      return;
    }

    const updatedCards = cards.map((card) =>
      card.id === editingPaperOverviewId.value
        ? {
            ...card,
            ...data,
            documentId:
              card.documentId || (pdfDocument.value ? getDocumentChatId(pdfDocument.value) : undefined),
            recentEntryId: card.recentEntryId || currentRecentEntryId.value || undefined,
            sourceLocator: card.sourceLocator || getCurrentPaperSourceLocator(),
            documentName:
              paperCardDocumentNameElement.value.trim() ||
              paperCardReviewDocumentName.value ||
              card.documentName,
            updatedAt: now,
          }
        : card,
    );
    writeJsonValue(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, updatedCards);
    selectedKnowledgeRecordKey.value = getKnowledgeRecordKey(
      "paper-overview",
      editingPaperOverviewId.value,
    );
    setPaperCardPageStatus(
      `已保存“${data.title || existing.documentName}”的复习修改。`,
    );
    return;
  }

  const card: SavedPaperOverview = {
    id: crypto.randomUUID(),
    documentName:
      paperCardDocumentNameElement.value.trim() ||
      (sourceName.value ? getDisplayFileName(sourceName.value) : "未命名论文"),
    documentId: pdfDocument.value ? getDocumentChatId(pdfDocument.value) : undefined,
    recentEntryId: currentRecentEntryId.value ?? undefined,
    sourceLocator: getCurrentPaperSourceLocator(),
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  writeJsonValue(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, [card, ...cards].slice(0, 100));
  refreshKnowledgeBaseIfOpen();
  setPaperCardPageStatus(
    `已保存“${data.title || card.documentName}”论文卡片。`,
  );
}



export function formatPaperOverviewMarkdown(data: PaperCardFormData): string {
  return [
    `# ${data.title || "论文阅读卡片"}`,
    "",
    `- 作者：${data.authors || "原文未明确出现"}`,
    `- 会议 / 期刊与年份：${data.venueYear || "原文未明确出现"}`,
    `- 研究领域：${data.researchArea || "原文未明确出现"}`,
    `- 关键词：${data.keywords || "原文未明确出现"}`,
    "",
    "## 一句话总结",
    "",
    data.oneSentenceSummary || "原文未明确出现",
    "",
    "## 解决的核心问题",
    "",
    data.researchProblem || "原文未明确出现",
    "",
    "## 核心思想与创新",
    "",
    data.coreInnovation || "原文未明确出现",
    "",
    "## 关键实验结果",
    "",
    data.mainFindings || "原文未明确出现",
    "",
    "## 对我的研究价值",
    "",
    data.researchConnection || "原文未明确出现",
    "",
    "## 阅读决策",
    "",
    `- 建议：${data.recommendDeepReading || "原文未明确出现"}`,
    `- 领域相关度：${data.suitableStages || "原文未明确出现"}`,
    `- 阅读难度：${data.readingDifficulty || "原文未明确出现"}`,
    `- 价值评分：${data.readingValueScore || "原文未明确出现"} / 10`,
    `- 判断理由：${data.worthReading || "原文未明确出现"}`,
    "",
    "## 下一步建议",
    "",
    `- 先看什么：${data.readingAdvice || "原文未明确出现"}`,
    `- 实验复现：${data.followupQuestions || "原文未明确出现"}`,
    `- 做笔记：${data.weeklyPlan || "原文未明确出现"}`,
    `- 可产出：${data.citationPoints || "原文未明确出现"}`,
    "",
    "## 推荐延伸阅读",
    "",
    data.comparisonWithPriorWork || "原文未明确列出可确认的延伸阅读",
    "",
    "## 我的备注",
    "",
    data.personalNotes || "",
  ].join("\\n");
}



export function exportPaperOverviewCard(): void {
  const data = collectPaperCardFormData();
  if (!data.title && !data.oneSentenceSummary) {
    setPaperCardPageStatus("当前没有可导出的论文卡片内容。", true);
    return;
  }

  const blob = new Blob([formatPaperOverviewMarkdown(data)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const baseName = (data.title || getDisplayFileName(sourceName.value) || "论文卡片")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 80);
  anchor.href = url;
  anchor.download = `${baseName}-论文卡片.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  setPaperCardPageStatus("论文卡片已导出为 Markdown 文件。");
}
