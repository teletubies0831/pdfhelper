






import { DEFAULT_AI_CONFIG, DEFAULT_VISION_AI_CONFIG, type AiConfig, type AiConversationMessage, type AiImageAttachment, type VisionAiConfig } from "../../../shared/ai";
import { type ReadingModePreference, type ResolvedReadingMode } from "../../../shared/reading-mode";


import { DEFAULT_CONVERSATION_MEMORY_CONFIG, type ConversationMemoryConfig } from "../../../shared/memory";






import { aiSettingsButton, appFrame, assistantChatPanel, assistantSettingsPanel, assistantToolsRuntime, assistantViewButtons, chatInput, knowledgeGroupSelect, knowledgeInsightQuestionInput, knowledgeMainElement, knowledgeResearchQuestionInput, knowledgeResearchScopeSelect, knowledgeSearchInput, knowledgeSortSelect, paperCardPageElement, settingsModalBackdrop } from "./viewer-elements";
import { refreshLongTermMemoryList, resetSettingsPresentation } from "../features/assistant/public";
import { cancelPendingAutomaticTranslation } from "../features/translation/public";
import { collectKnowledgeItems, openKnowledgeBasePage, setKnowledgePageMode } from "../features/knowledge-base/public";
import { cancelPendingCardGeneration, openSavedPaperOverviewReview } from "../features/paper-card/public";
import { cancelPendingSummaryGeneration } from "../services/document-agent/viewer-document-agent";
import { activateAiTab } from "./bootstrap";
import { APP_VIEW_SESSION_STORAGE_KEY, activeKnowledgeCategory, activeKnowledgeFilter, activeKnowledgeFocus, activeKnowledgePriority, activeKnowledgeReadingStatus, activeKnowledgeTag, activeKnowledgeVenue, activeKnowledgeYear, editingPaperOverviewId } from './feature-models';
import type { KnowledgeItem, PersistedAppView, PersistedAppViewState } from './feature-models';
import type { KnowledgePageMode } from '../core/pdf-reader/reader-controls';




export function readPersistedAppViewState(): PersistedAppViewState | null {
  try {
    const raw = sessionStorage.getItem(APP_VIEW_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedAppViewState>;
    if (
      value.view !== "viewer" &&
      value.view !== "knowledge" &&
      value.view !== "paper-review"
    ) {
      return null;
    }
    return {
      view: value.view,
      knowledgeMode:
        value.knowledgeMode === "qa" || value.knowledgeMode === "insights"
          ? value.knowledgeMode
          : "library",
      knowledgeFilter:
        value.knowledgeFilter === "note" ||
        value.knowledgeFilter === "reading-card" ||
        value.knowledgeFilter === "paper-card"
          ? value.knowledgeFilter
          : "all",
      knowledgeCategory:
        typeof value.knowledgeCategory === "string"
          ? value.knowledgeCategory
          : "all",
      knowledgeTag:
        typeof value.knowledgeTag === "string" ? value.knowledgeTag : "",
      knowledgeFocus:
        value.knowledgeFocus === "todo" ||
        value.knowledgeFocus === "deep" ||
        value.knowledgeFocus === "finished" ||
        value.knowledgeFocus === "citable" ||
        value.knowledgeFocus === "replicate" ||
        value.knowledgeFocus === "related" ||
        value.knowledgeFocus === "methods"
          ? value.knowledgeFocus
          : "all",
      knowledgeYear:
        typeof value.knowledgeYear === "string" ? value.knowledgeYear : "all",
      knowledgeVenue:
        typeof value.knowledgeVenue === "string" ? value.knowledgeVenue : "all",
      knowledgeReadingStatus:
        typeof value.knowledgeReadingStatus === "string"
          ? value.knowledgeReadingStatus
          : "all",
      knowledgePriority:
        typeof value.knowledgePriority === "string"
          ? value.knowledgePriority
          : "all",
      knowledgeSearch:
        typeof value.knowledgeSearch === "string" ? value.knowledgeSearch : "",
      knowledgeSort:
        typeof value.knowledgeSort === "string"
          ? value.knowledgeSort
          : "newest",
      knowledgeGroup:
        typeof value.knowledgeGroup === "string"
          ? value.knowledgeGroup
          : "none",
      knowledgeResearchScope:
        typeof value.knowledgeResearchScope === "string"
          ? value.knowledgeResearchScope
          : "selected",
      knowledgeResearchQuestion:
        typeof value.knowledgeResearchQuestion === "string"
          ? value.knowledgeResearchQuestion
          : "",
      knowledgeInsightQuestion:
        typeof value.knowledgeInsightQuestion === "string"
          ? value.knowledgeInsightQuestion
          : "",
      selectedKnowledgeRecordKey:
        typeof value.selectedKnowledgeRecordKey === "string"
          ? value.selectedKnowledgeRecordKey
          : "",
      selectedKnowledgeResearchKeys: Array.isArray(
        value.selectedKnowledgeResearchKeys,
      )
        ? value.selectedKnowledgeResearchKeys.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
      knowledgeScrollTop: Number.isFinite(value.knowledgeScrollTop)
        ? Number(value.knowledgeScrollTop)
        : 0,
      reviewPaperOverviewId:
        typeof value.reviewPaperOverviewId === "string"
          ? value.reviewPaperOverviewId
          : "",
      paperCardScrollTop: Number.isFinite(value.paperCardScrollTop)
        ? Number(value.paperCardScrollTop)
        : 0,
    };
  } catch {
    return null;
  }
}



export function getCurrentPersistedAppView(): PersistedAppView {
  if (!paperCardPageElement.hidden && editingPaperOverviewId.value)
    return "paper-review";
  if (appFrame?.classList.contains("knowledge-base-page-open"))
    return "knowledge";
  return "viewer";
}



export function persistCurrentAppViewState(): void {
  const state: PersistedAppViewState = {
    view: getCurrentPersistedAppView(),
    knowledgeMode: activeKnowledgePageMode.value,
    knowledgeFilter: activeKnowledgeFilter.value,
    knowledgeCategory: activeKnowledgeCategory.value,
    knowledgeTag: activeKnowledgeTag.value,
    knowledgeFocus: activeKnowledgeFocus.value,
    knowledgeYear: activeKnowledgeYear.value,
    knowledgeVenue: activeKnowledgeVenue.value,
    knowledgeReadingStatus: activeKnowledgeReadingStatus.value,
    knowledgePriority: activeKnowledgePriority.value,
    knowledgeSearch: knowledgeSearchInput.value,
    knowledgeSort: knowledgeSortSelect.value,
    knowledgeGroup: knowledgeGroupSelect.value,
    knowledgeResearchScope: knowledgeResearchScopeSelect.value,
    knowledgeResearchQuestion: knowledgeResearchQuestionInput.value,
    knowledgeInsightQuestion: knowledgeInsightQuestionInput.value,
    selectedKnowledgeRecordKey: selectedKnowledgeRecordKey.value,
    selectedKnowledgeResearchKeys: Array.from(selectedKnowledgeResearchKeys.value),
    knowledgeScrollTop: knowledgeMainElement?.scrollTop ?? 0,
    reviewPaperOverviewId: editingPaperOverviewId.value || "",
    paperCardScrollTop: paperCardPageElement.scrollTop,
  };

  try {
    sessionStorage.setItem(APP_VIEW_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the application must remain usable.
  }
}



export function applyPersistedKnowledgeState(state: PersistedAppViewState): void {
  activeKnowledgePageMode.value = "library";
  activeKnowledgeFilter.value = "all";
  activeKnowledgeCategory.value = "all";
  activeKnowledgeTag.value = "";
  activeKnowledgeFocus.value = "all";
  activeKnowledgeYear.value = state.knowledgeYear;
  activeKnowledgeVenue.value = state.knowledgeVenue;
  activeKnowledgeReadingStatus.value = "all";
  activeKnowledgePriority.value = "all";
  selectedKnowledgeRecordKey.value = state.selectedKnowledgeRecordKey;
  selectedKnowledgeResearchKeys.value = new Set(state.selectedKnowledgeResearchKeys);

  knowledgeSearchInput.value = state.knowledgeSearch;
  knowledgeSortSelect.value = state.knowledgeSort;
  knowledgeGroupSelect.value = "none";
  knowledgeResearchScopeSelect.value = state.knowledgeResearchScope;
  knowledgeResearchQuestionInput.value = state.knowledgeResearchQuestion;
  knowledgeInsightQuestionInput.value = state.knowledgeInsightQuestion;
}



export function restoreAppViewAfterRefresh(): void {
  const state = readPersistedAppViewState();
  if (!state || state.view === "viewer") return;

  applyPersistedKnowledgeState(state);

  if (state.view === "paper-review" && state.reviewPaperOverviewId) {
    const item = collectKnowledgeItems().find(
      (candidate) =>
        candidate.source === "paper-overview" &&
        candidate.id === state.reviewPaperOverviewId,
    );
    if (item) {
      openSavedPaperOverviewReview(item);
      requestAnimationFrame(() => {
        paperCardPageElement.scrollTop = Math.max(0, state.paperCardScrollTop);
      });
      return;
    }
  }

  openKnowledgeBasePage();
  setKnowledgePageMode(state.knowledgeMode);
  requestAnimationFrame(() => {
    if (knowledgeMainElement) {
      knowledgeMainElement.scrollTop = Math.max(0, state.knowledgeScrollTop);
    }
  });
}



export let selectedKnowledgeRecordKey = { value: "" };


export let knowledgeEditorTargetKey: { value: string | null } = { value: null };


export let activeKnowledgePageMode: { value: KnowledgePageMode } = { value: "library" };


export let selectedKnowledgeResearchKeys = { value: new Set<string>() };


export let activeKnowledgeInsightPrompt =
  { value: "请综合材料生成一份研究洞察报告，包含：文献共识、关键分歧、方法演进、尚未解决的问题、3 个有依据的新想法、每个想法的可检验假设与最小验证方案。" };


export let lastKnowledgeResearchAnswer = { value: "" };


export let lastKnowledgeResearchQuestion = { value: "" };


export let lastKnowledgeResearchItems: { value: KnowledgeItem[] } = { value: [] };


export let knowledgeResearchPending = { value: false };


export let aiConfig: { value: AiConfig } = { value: { ...DEFAULT_AI_CONFIG } };


export let conversationMemoryConfig: { value: ConversationMemoryConfig } = { value: {
  ...DEFAULT_CONVERSATION_MEMORY_CONFIG,
} };


export let aiConfigLoaded = { value: false };


export let visionAiConfig: { value: VisionAiConfig } = { value: { ...DEFAULT_VISION_AI_CONFIG } };


export let chatHistory: { value: AiConversationMessage[] } = { value: [] };


export let chatConversationSummary = { value: "" };


export let chatSummarizedMessageCount = { value: 0 };


export let chatRequestPending = { value: false };


export let chatPersistenceQueue: { value: Promise<void> } = { value: Promise.resolve() };


export let pendingChatImages: { value: AiImageAttachment[] } = { value: [] };


export let chatImagePreviewOverlay: { value: HTMLElement | null } = { value: null };


export let readingModePreference: { value: ReadingModePreference } = { value: "auto" };


export let resolvedReadingMode: { value: ResolvedReadingMode } = { value: "general" };


export let readingModeDetectionPending = { value: false };


export let readingModeDocumentKey = { value: "" };


export let readingModeRationale = { value: "" };


export let readingModeError = { value: "" };


export type AssistantView = "chat" | "translate" | "summary" | "cards";


export let activeAssistantView: { value: AssistantView } = { value: "chat" };



export function setAssistantView(view: AssistantView): void {
  activeAssistantView.value = view;
  const showChat = view === "chat";
  for (const button of assistantViewButtons) {
    const isActive = button.dataset.assistantView === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  assistantChatPanel.hidden = !showChat;
  assistantToolsRuntime.classList.toggle("active", !showChat);
  assistantToolsRuntime.setAttribute("aria-hidden", String(showChat));

  if (view !== "translate") cancelPendingAutomaticTranslation();
  if (view !== "summary") cancelPendingSummaryGeneration();
  if (view !== "cards") cancelPendingCardGeneration();

  if (showChat) {
    window.setTimeout(() => chatInput.focus(), 0);
  } else {
    activateAiTab(view);
  }
}



export let settingsCloseAnimationTimer: number | undefined;



export function showSettingsSavedFeedback(): void {
  aiSettingsButton.classList.remove("saved");
  aiSettingsButton.setAttribute("aria-label", "打开 AI 设置");
}



export function setDeepSeekSettingsOpen(open: boolean): void {
  if (assistantSettingsPanel.parentElement !== document.body) {
    document.body.append(assistantSettingsPanel);
  }

  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer);
    settingsCloseAnimationTimer = undefined;
  }

  if (open) {
    assistantSettingsPanel.hidden = false;
    settingsModalBackdrop.hidden = false;
    settingsModalBackdrop.setAttribute("aria-hidden", "false");
    if (appFrame) appFrame.inert = true;
    document.body.classList.add("settings-modal-open");
    aiSettingsButton.classList.add("active");
    aiSettingsButton.setAttribute("aria-expanded", "true");
    resetSettingsPresentation();

    // Commit the resting state before entering so both opacity and transform
    // interpolate. This is one small layout read, not a per-frame layout cost.
    assistantSettingsPanel.classList.remove("is-open");
    settingsModalBackdrop.classList.remove("is-open");
    void assistantSettingsPanel.offsetWidth;
    assistantSettingsPanel.classList.add("is-open");
    settingsModalBackdrop.classList.add("is-open");

    void refreshLongTermMemoryList();
  } else {
    assistantSettingsPanel.classList.remove("is-open");
    settingsModalBackdrop.classList.remove("is-open");
    settingsModalBackdrop.setAttribute("aria-hidden", "true");
    if (appFrame) appFrame.inert = false;
    document.body.classList.remove("settings-modal-open");
    aiSettingsButton.classList.remove("active");
    aiSettingsButton.setAttribute("aria-expanded", "false");

    settingsCloseAnimationTimer = window.setTimeout(() => {
      assistantSettingsPanel.hidden = true;
      settingsModalBackdrop.hidden = true;
      settingsCloseAnimationTimer = undefined;
    }, 340);
    aiSettingsButton.focus({ preventScroll: true });
  }
}
