
















import { MAX_CARD_SOURCE_LENGTH, SAVED_CARDS_STORAGE_KEY, SAVED_PAPER_OVERVIEWS_STORAGE_KEY, activeAssistantView, activeCardType, cardAbortController, cardGenerationTimer, currentCardContext, currentGeneratedCard, getViewerSelectionText, lastCardRequestKey, selectedTextForAi, selectedTextPageNumber } from "../../core/pdf-reader/public";
import { cardExplanationElement, cardGeneratedContentElement, cardGenerationStatusElement, cardKeyPointsElement, cardPurposeElement, cardSourceLocationElement, cardSourceSnippetElement, cardTitleElement, cardTypeButtons, cardUnderstandingElement, cardsPanelElement } from "../../app/viewer-elements";
import { currentFileHandle, currentRecentEntryId, pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getCurrentChapterContext } from "../translation/public";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { parseAiJson, requestAiContent } from "../../shared-ui/markdown/markdown-renderer";
import { setStatus } from "../recent-files/public";
import { getDocumentChatId } from "../assistant/public";
import { refreshKnowledgeBaseIfOpen } from "../knowledge-base/public";
import type { CardContext, CardType, GeneratedCardContent, SavedPaperCard, SavedPaperOverview } from "../../core/pdf-reader/public";
import { readSavedPaperOverviews } from './paper-card-controller';
import { readJsonValue, writeJsonValue } from '../../../platform/storage/browser-json-repository';





export function getCardTypeLabel(cardType: CardType): string {
  return {
    concept: "概念",
    method: "方法",
    experiment: "实验",
    viewpoint: "观点",
  }[cardType];
}



export function setCardState(
  message: string,
  isError = false,
  clearCard = true,
): void {
  if (clearCard) {
    currentGeneratedCard.value = null;
    cardGeneratedContentElement.hidden = true;
  }
  cardGenerationStatusElement.textContent = message;
  cardGenerationStatusElement.classList.toggle("error", isError);
  cardGenerationStatusElement.hidden = false;
}



export function renderGeneratedCard(
  content: GeneratedCardContent,
  context: CardContext,
): void {
  cardTitleElement.textContent = content.title;
  cardExplanationElement.textContent = content.explanation;
  cardPurposeElement.textContent = content.purpose;
  cardUnderstandingElement.textContent = content.understanding;
  cardSourceLocationElement.textContent = context.sourceLocation;

  const points = content.keyPoints.map((point) => {
    const item = document.createElement("li");
    item.textContent = point;
    return item;
  });
  cardKeyPointsElement.replaceChildren(...points);

  currentGeneratedCard.value = content;
  currentCardContext.value = context;
  cardGenerationStatusElement.hidden = true;
  cardGenerationStatusElement.classList.remove("error");
  cardGeneratedContentElement.hidden = false;
}



export function updateCardSourceSnippet(): void {
  const text = selectedTextForAi.value || getViewerSelectionText();
  if (!text) {
    cardSourceSnippetElement.textContent =
      "请在左侧 PDF 中选择需要制作卡片的论文原文。";
    cardSourceSnippetElement.title = "";
    return;
  }

  cardSourceSnippetElement.textContent = text;
  cardSourceSnippetElement.title = text;
}



export function buildCardContext(): CardContext {
  if (!pdfDocument.value) throw new Error("请先打开 PDF。");

  const text = (selectedTextForAi.value || getViewerSelectionText())
    .trim()
    .slice(0, MAX_CARD_SOURCE_LENGTH);
  if (!text) throw new Error("请先在 PDF 中选中需要制作卡片的原文。");

  const pageNumber = Math.max(
    1,
    selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
  );
  const chapter = getCurrentChapterContext(pageNumber);
  const documentName = getDisplayFileName(sourceName.value);
  const positionLabel = chapter.title;

  return {
    cardType: activeCardType.value,
    text,
    documentName,
    pageNumber,
    positionLabel,
    sourceLocation: `${positionLabel} · 第 ${pageNumber} 页`,
  };
}



export function cancelPendingCardGeneration(): void {
  if (cardGenerationTimer.value !== null) {
    clearTimeout(cardGenerationTimer.value);
    cardGenerationTimer.value = null;
  }
}



export function scheduleCardGeneration(delay = 350): void {
  cancelPendingCardGeneration();
  cardGenerationTimer.value = setTimeout(() => {
    cardGenerationTimer.value = null;
    if (activeAssistantView.value === "cards" && !cardsPanelElement.hidden)
      void generatePaperCard();
  }, delay);
}



export function setActiveCardType(cardType: CardType): void {
  activeCardType.value = cardType;
  lastCardRequestKey.value = "";
  currentCardContext.value = null;
  currentGeneratedCard.value = null;
  cardAbortController.value?.abort();

  for (const button of cardTypeButtons) {
    button.classList.toggle("active", button.dataset.cardType === cardType);
  }

  updateCardSourceSnippet();
  scheduleCardGeneration(0);
}



export async function generatePaperCard(force = false): Promise<void> {
  updateCardSourceSnippet();

  if (!pdfDocument.value) {
    setCardState("请先打开 PDF。", true);
    return;
  }

  let context: CardContext;
  try {
    context = buildCardContext();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCardState(message, true);
    return;
  }

  const requestKey = [context.cardType, context.pageNumber, context.text].join(
    "\u0000",
  );
  if (
    !force &&
    requestKey === lastCardRequestKey.value &&
    currentGeneratedCard.value &&
    currentCardContext.value
  ) {
    renderGeneratedCard(currentGeneratedCard.value, currentCardContext.value);
    return;
  }

  cardAbortController.value?.abort();
  const controller = new AbortController();
  cardAbortController.value = controller;
  setCardState("正在读取原文并生成卡片，请稍候…");

  try {
    const cardContent = await requestAiContent(
      [
        {
          role: "user",
          content: [
            `请根据下面原文生成“${getCardTypeLabel(context.cardType)}”学习卡片。`,
            `文档：${context.documentName}；页码：${context.pageNumber}；位置：${context.positionLabel}。`,
            "必须只输出 JSON，不要使用 Markdown 代码块。JSON 字段固定为：",
            '{"title":"卡片标题","explanation":"核心解释","key_points":["要点1","要点2","要点3"],"purpose":"作用或解决的问题","understanding":"便于学习者理解的通俗表述"}',
            "",
            context.text,
          ].join("\n"),
        },
      ],
      {
        documentName: context.documentName,
        pageNumber: context.pageNumber,
      },
    );
    const payload = parseAiJson(cardContent);

    if (
      typeof payload.title !== "string" ||
      typeof payload.explanation !== "string" ||
      !Array.isArray(payload.key_points) ||
      payload.key_points.some((item) => typeof item !== "string") ||
      typeof payload.purpose !== "string" ||
      typeof payload.understanding !== "string"
    ) {
      throw new Error("卡片接口没有返回完整的结构化内容。");
    }

    const content: GeneratedCardContent = {
      title: payload.title.trim(),
      explanation: payload.explanation.trim(),
      keyPoints: payload.key_points.map((item) => item.trim()).filter(Boolean),
      purpose: payload.purpose.trim(),
      understanding: payload.understanding.trim(),
    };

    if (
      !content.title ||
      !content.explanation ||
      content.keyPoints.length === 0 ||
      !content.purpose ||
      !content.understanding
    ) {
      throw new Error("模型返回的卡片内容不完整。");
    }
    if (controller.signal.aborted) return;

    lastCardRequestKey.value = requestKey;
    renderGeneratedCard(content, context);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setCardState(`卡片生成失败：${message}`, true);
  } finally {
    if (cardAbortController.value === controller) cardAbortController.value = null;
  }
}



export function formatGeneratedCardText(
  context: CardContext,
  content: GeneratedCardContent,
): string {
  return [
    `卡片类型：${getCardTypeLabel(context.cardType)}`,
    `卡片标题：${content.title}`,
    `核心解释：${content.explanation}`,
    `关键要点：\n${content.keyPoints.map((point) => `• ${point}`).join("\n")}`,
    `作用 / 解决的问题：${content.purpose}`,
    `我的理解：${content.understanding}`,
    `来源位置：${context.documentName} · ${context.sourceLocation}`,
  ].join("\n\n");
}



export function readSavedPaperCards(): SavedPaperCard[] {
  const value = readJsonValue<unknown>(SAVED_CARDS_STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
}



export function getCurrentPaperSourceLocator(): string {
  if (currentFileHandle.value && currentRecentEntryId.value) {
    return `local-file-handle:${currentRecentEntryId.value}`;
  }
  if (sourceName.value.startsWith("http://") || sourceName.value.startsWith("https://")) {
    return sourceName.value;
  }
  return currentRecentEntryId.value ? `recent-entry:${currentRecentEntryId.value}` : sourceName.value;
}



export function createPaperOverviewFromReadingCard(
  card: GeneratedCardContent & CardContext,
  documentId: string,
): SavedPaperOverview {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    documentName: card.documentName,
    documentId,
    recentEntryId: currentRecentEntryId.value ?? undefined,
    sourceLocator: getCurrentPaperSourceLocator(),
    title: card.documentName.replace(/\.pdf$/i, "") || card.title,
    authors: "",
    venueYear: "",
    researchArea: "",
    keywords: "",
    oneSentenceSummary: card.explanation,
    researchProblem: card.purpose,
    coreInnovation: card.cardType === "method" ? card.explanation : "",
    worthReading: "",
    problemSetup: "",
    researchGap: "",
    whyImportant: "",
    topicTags: getCardTypeLabel(card.cardType),
    methodOverview: card.cardType === "method" ? card.keyPoints.join("\n") : "",
    methodIntuition: "",
    methodSteps: "",
    keyAssumptions: "",
    notationGuide: "",
    datasets: "",
    experimentSetup: card.cardType === "experiment" ? card.explanation : "",
    metrics: "",
    mainFindings: card.cardType === "viewpoint" ? card.explanation : "",
    strongestEvidence: "",
    comparisonWithPriorWork: "",
    limitations: "",
    readingStatus: "精读中",
    recommendDeepReading: "建议按需精读",
    readingDifficulty: "中等",
    readingValueScore: "",
    readingAdvice: "",
    suitableStages: "",
    prerequisites: "",
    citationPoints: "",
    researchConnection: "",
    followupQuestions: "",
    weeklyPlan: "",
    personalNotes: "",
    createdAt: now,
    updatedAt: now,
  };
}



export function saveCurrentPaperCard(): void {
  if (!currentCardContext.value || !currentGeneratedCard.value) {
    setStatus("当前没有可保存的论文卡片。", true);
    return;
  }
  const cardContext = currentCardContext.value;
  const generatedCard = currentGeneratedCard.value;

  const documentId = pdfDocument.value ? getDocumentChatId(pdfDocument.value) : "";
  const overviews = readSavedPaperOverviews();
  let overview = overviews.find((item) =>
    Boolean(documentId && item.documentId === documentId),
  ) ?? overviews.find((item) => item.documentName === cardContext.documentName);
  if (!overview) {
    overview = createPaperOverviewFromReadingCard(
      { ...cardContext, ...generatedCard },
      documentId,
    );
    writeJsonValue(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, [overview, ...overviews].slice(0, 100));
  }

  const card: SavedPaperCard = {
    id: crypto.randomUUID(),
    ...cardContext,
    ...generatedCard,
    documentId: documentId || overview.documentId,
    paperOverviewId: overview.id,
    recentEntryId: currentRecentEntryId.value ?? overview.recentEntryId,
    sourceLocator: getCurrentPaperSourceLocator(),
    createdAt: new Date().toISOString(),
  };
  const cards = [card, ...readSavedPaperCards()].slice(0, 100);
  writeJsonValue(SAVED_CARDS_STORAGE_KEY, cards);
  refreshKnowledgeBaseIfOpen();
  setStatus(`已保存“${card.title}”，并关联到论文阅读卡片。`);
}



export function resetCardState(): void {
  cancelPendingCardGeneration();
  cardAbortController.value?.abort();
  cardAbortController.value = null;
  activeCardType.value = "method";
  lastCardRequestKey.value = "";
  currentCardContext.value = null;
  currentGeneratedCard.value = null;

  for (const button of cardTypeButtons) {
    button.classList.toggle("active", button.dataset.cardType === "method");
  }

  updateCardSourceSnippet();
  setCardState("选择原文后，将自动生成论文卡片。");
}
