import {
  AnnotationMode,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  GlobalWorkerOptions,
  getDocument,
  type AnnotationEditorUIManager,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { browser } from "wxt/browser";
import "pdfjs-dist/web/pdf_viewer.css";
import "katex/dist/katex.min.css";

import {
  AI_CONFIG_STORAGE_KEY,
  AI_PROVIDERS,
  AI_STREAM_PORT_NAME,
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  VISION_AI_CONFIG_STORAGE_KEY,
  isVisionAiConfigured,
  normalizeAiBaseUrl,
  normalizeAiMaxOutputTokens,
  type AiConfig,
  type AiConversationMessage,
  type AiImageAttachment,
  type AiMemoryCandidate,
  type AiProviderId,
  type AiReasoningMode,
  type AiRuntimeResponse,
  type AiNativeToolCall,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type AiStreamToolResult,
  type VisionAiConfig,
  type VisionAiMode,
} from "../../shared/ai";
import {
  READING_MODE_STORAGE_KEY,
  getReadingModeLabel,
  isReadingModePreference,
  type ReadingModePreference,
  type ReadingModeState,
  type ResolvedReadingMode,
} from "../../shared/reading-mode";
import {
  createDocumentAgentId,
  type DocumentAgentRecord,
  type DocumentChunk,
  type DocumentOutlineItem,
} from "../../shared/document-agent";
import { getAgentToolDefinitionByApiName } from "../../shared/agent-tools";
import {
  CONVERSATION_MEMORY_CONFIG_STORAGE_KEY,
  DEFAULT_CONVERSATION_MEMORY_CONFIG,
  normalizeConversationMemoryConfig,
  type ConversationMemoryConfig,
  type LongTermMemory,
  type MemoryToolCall,
} from "../../shared/memory";
import {
  getDocumentAgentRecord,
  getDocumentChunks,
  getLatestDocumentSession,
  putDocumentSession,
} from "./document-agent-store";
import { executeMemoryTool, memoryTools } from "./memory-store";
import {
  buildDocumentRetrievalContext,
  initializeDocumentKnowledge,
} from "./document-agent-runtime";

import "./style.css";

import { installOnlineRelatedPapers } from "./online-related-papers";
import { installCurrentPaperCcfRank } from "./ccf-rank";

type WritableFileStreamLike = {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
};

type FileHandlePermissionDescriptor = {
  mode?: "read" | "readwrite";
};

type FileHandlePermissionState = "granted" | "denied" | "prompt";

type FileHandleLike = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFileStreamLike>;
  isSameEntry?: (other: FileHandleLike) => Promise<boolean>;
  queryPermission?: (
    descriptor?: FileHandlePermissionDescriptor,
  ) => Promise<FileHandlePermissionState>;
  requestPermission?: (
    descriptor?: FileHandlePermissionDescriptor,
  ) => Promise<FileHandlePermissionState>;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileHandleLike[]>;
};

GlobalWorkerOptions.workerSrc = workerUrl;

const openFileButton = requiredElement<HTMLElement>("open-file");
const fileInput = requiredElement<HTMLInputElement>("file-input");
const recentFilesButton = requiredElement<HTMLButtonElement>(
  "recent-files-button",
);
const recentFilesDialog = requiredElement<HTMLElement>("recent-files-dialog");
const recentFilesList = requiredElement<HTMLElement>("recent-files-list");
const closeRecentFilesButton =
  requiredElement<HTMLButtonElement>("close-recent-files");
const clearRecentFilesButton =
  requiredElement<HTMLButtonElement>("clear-recent-files");
const documentNameElement = requiredElement<HTMLElement>("document-name");
const previousButton = requiredElement<HTMLButtonElement>("previous-page");
const nextButton = requiredElement<HTMLButtonElement>("next-page");
const pageNumberInput = requiredElement<HTMLInputElement>("page-number");
const pageCountElement = requiredElement<HTMLElement>("page-count");
const zoomOutButton = requiredElement<HTMLButtonElement>("zoom-out");
const zoomInButton = requiredElement<HTMLButtonElement>("zoom-in");
const zoomValueElement = requiredElement<HTMLElement>("zoom-value");
const findBar = requiredElement<HTMLFormElement>("find-bar");
const findInput = requiredElement<HTMLInputElement>("find-input");
const findCount = requiredElement<HTMLElement>("find-count");
const findPreviousButton = requiredElement<HTMLButtonElement>("find-previous");
const findNextButton = requiredElement<HTMLButtonElement>("find-next");
const findCloseButton = requiredElement<HTMLButtonElement>("find-close");
const statusText = requiredElement<HTMLElement>("status-text");
const textStatus = requiredElement<HTMLElement>("text-status");
const viewerContainer = requiredElement<HTMLDivElement>("viewer-container");
const viewerElement = requiredElement<HTMLDivElement>("viewer");
const citationReturnButton = requiredElement<HTMLButtonElement>(
  "citation-return-button",
);
const citationReturnPosition = requiredElement<HTMLElement>(
  "citation-return-position",
);
const undoAnnotationButton =
  requiredElement<HTMLButtonElement>("undo-annotation");
const redoAnnotationButton =
  requiredElement<HTMLButtonElement>("redo-annotation");
const smartCopyButton = requiredElement<HTMLButtonElement>("smart-copy");
const saveAnnotatedPdfButton =
  requiredElement<HTMLButtonElement>("save-annotated-pdf");
const toggleNotesButton = requiredElement<HTMLButtonElement>("toggle-notes");
const highlightColorInput =
  requiredElement<HTMLInputElement>("highlight-color");
const freeTextSizeInput = requiredElement<HTMLInputElement>("free-text-size");
const freeTextColorInput = requiredElement<HTMLInputElement>("free-text-color");
const freeTextSizeDownButton = requiredElement<HTMLButtonElement>(
  "free-text-size-down",
);
const freeTextSizeUpButton =
  requiredElement<HTMLButtonElement>("free-text-size-up");
const selectionContextMenu = requiredElement<HTMLElement>(
  "selection-context-menu",
);
const contextCopyButton = requiredElement<HTMLButtonElement>("context-copy");
const contextCleanCopyButton =
  requiredElement<HTMLButtonElement>("context-clean-copy");
const contextColors = requiredElement<HTMLElement>("context-colors");
const highlightContextActions = requiredElement<HTMLElement>(
  "highlight-context-actions",
);
const contextNoteButton = requiredElement<HTMLButtonElement>("context-note");
const contextDeleteHighlightButton = requiredElement<HTMLButtonElement>(
  "context-delete-highlight",
);
const highlightNotePopover = requiredElement<HTMLElement>(
  "highlight-note-popover",
);
const highlightNoteTitle = requiredElement<HTMLElement>("highlight-note-title");
const highlightNoteQuote = requiredElement<HTMLElement>("highlight-note-quote");
const highlightNoteText = requiredElement<HTMLTextAreaElement>(
  "highlight-note-text",
);
const closeHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "close-highlight-note",
);
const deleteHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "delete-highlight-note",
);
const saveHighlightNoteButton = requiredElement<HTMLButtonElement>(
  "save-highlight-note",
);
const annotationActionBar = requiredElement<HTMLElement>(
  "annotation-action-bar",
);
const annotationTypeLabel = requiredElement<HTMLElement>(
  "annotation-type-label",
);
const deleteAnnotationButton =
  requiredElement<HTMLButtonElement>("delete-annotation");
const freeTextSizeControl = requiredElement<HTMLElement>(
  "free-text-size-control",
);
const quickHighlightButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-quick-highlight-color]"),
);
const editorModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-editor-mode]"),
);
const appFrame = document.querySelector<HTMLElement>(".app-frame");
const outlineToggleButton = document.getElementById("outline-toggle");
const aiPanelToggleButton = document.getElementById("ai-panel-toggle");
const focusModeButton = requiredElement<HTMLButtonElement>("focus-mode-toggle");
const focusModeLabel = requiredElement<HTMLElement>("focus-mode-label");
const readingModeSelect = requiredElement<HTMLSelectElement>(
  "reading-mode-select",
);
const detectReadingModeButton = requiredElement<HTMLButtonElement>(
  "detect-reading-mode",
);
const readingModeStatus = requiredElement<HTMLElement>("reading-mode-status");
const aiSettingsButton =
  requiredElement<HTMLButtonElement>("ai-settings-button");
const paperCardEntryButton = document.getElementById("paper-card-entry");
const paperCardPageElement = requiredElement<HTMLElement>("paper-card-page");
const paperCardPageTitleElement = requiredElement<HTMLElement>(
  "paper-card-page-title",
);
const paperCardPageSubtitleElement = requiredElement<HTMLElement>(
  "paper-card-page-subtitle",
);
const paperCardBackButton =
  requiredElement<HTMLButtonElement>("paper-card-back");
const editPaperCardButton =
  requiredElement<HTMLButtonElement>("edit-paper-card");
const returnToPdfButton = requiredElement<HTMLButtonElement>("return-to-pdf");
const regeneratePaperCardButton = requiredElement<HTMLButtonElement>(
  "regenerate-paper-card",
);
const savePaperCardPageButton = requiredElement<HTMLButtonElement>(
  "save-paper-card-page",
);
const exportPaperCardButton =
  requiredElement<HTMLButtonElement>("export-paper-card");
const paperCardDocumentNameElement = requiredElement<HTMLTextAreaElement>(
  "paper-card-document-name",
);
const paperCardPageStatusElement = requiredElement<HTMLElement>(
  "paper-card-page-status",
);
const paperCardFormElement =
  requiredElement<HTMLFormElement>("paper-card-form");
const paperTitleInput = requiredElement<HTMLTextAreaElement>("paper-title");
const paperAuthorsInput = requiredElement<HTMLTextAreaElement>("paper-authors");
const paperVenueYearInput =
  requiredElement<HTMLTextAreaElement>("paper-venue-year");
const paperResearchAreaInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-area",
);
const paperKeywordsInput = requiredElement<HTMLInputElement>("paper-keywords");
const paperOneSentenceSummaryInput = requiredElement<HTMLTextAreaElement>(
  "paper-one-sentence-summary",
);
const paperResearchProblemInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-problem",
);
const paperCoreInnovationInput = requiredElement<HTMLTextAreaElement>(
  "paper-core-innovation",
);
const paperWorthReadingInput = requiredElement<HTMLTextAreaElement>(
  "paper-worth-reading",
);
const paperProblemSetupInput = requiredElement<HTMLTextAreaElement>(
  "paper-problem-setup",
);
const paperResearchGapInput =
  requiredElement<HTMLTextAreaElement>("paper-research-gap");
const paperWhyImportantInput = requiredElement<HTMLTextAreaElement>(
  "paper-why-important",
);
const paperTopicTagsInput =
  requiredElement<HTMLTextAreaElement>("paper-topic-tags");
const paperMethodOverviewInput = requiredElement<HTMLTextAreaElement>(
  "paper-method-overview",
);
const paperMethodIntuitionInput = requiredElement<HTMLTextAreaElement>(
  "paper-method-intuition",
);
const paperMethodStepsInput =
  requiredElement<HTMLTextAreaElement>("paper-method-steps");
const paperKeyAssumptionsInput = requiredElement<HTMLTextAreaElement>(
  "paper-key-assumptions",
);
const paperNotationGuideInput = requiredElement<HTMLTextAreaElement>(
  "paper-notation-guide",
);
const paperDatasetsInput =
  requiredElement<HTMLTextAreaElement>("paper-datasets");
const paperExperimentSetupInput = requiredElement<HTMLTextAreaElement>(
  "paper-experiment-setup",
);
const paperMetricsInput = requiredElement<HTMLTextAreaElement>("paper-metrics");
const paperMainFindingsInput = requiredElement<HTMLTextAreaElement>(
  "paper-main-findings",
);
const paperStrongestEvidenceInput = requiredElement<HTMLTextAreaElement>(
  "paper-strongest-evidence",
);
const paperComparisonPriorWorkInput = requiredElement<HTMLTextAreaElement>(
  "paper-comparison-prior-work",
);
const paperLimitationsInput =
  requiredElement<HTMLTextAreaElement>("paper-limitations");
const paperReadingStatusInput = requiredElement<HTMLSelectElement>(
  "paper-reading-status",
);
const paperRecommendDeepReadingInput = requiredElement<HTMLSelectElement>(
  "paper-recommend-deep-reading",
);
const paperReadingDifficultyInput = requiredElement<HTMLSelectElement>(
  "paper-reading-difficulty",
);
const paperReadingValueScoreInput = requiredElement<HTMLInputElement>(
  "paper-reading-value-score",
);
const paperReadingAdviceInput = requiredElement<HTMLTextAreaElement>(
  "paper-reading-advice",
);
const paperSuitableStagesInput = requiredElement<HTMLTextAreaElement>(
  "paper-suitable-stages",
);
const paperPrerequisitesInput = requiredElement<HTMLTextAreaElement>(
  "paper-prerequisites",
);
const paperCitationPointsInput = requiredElement<HTMLTextAreaElement>(
  "paper-citation-points",
);
const paperResearchConnectionInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-connection",
);
const paperFollowupQuestionsInput = requiredElement<HTMLTextAreaElement>(
  "paper-followup-questions",
);
const paperWeeklyPlanInput =
  requiredElement<HTMLTextAreaElement>("paper-weekly-plan");
const paperPersonalNotesInput = requiredElement<HTMLTextAreaElement>(
  "paper-personal-notes",
);
const knowledgeBaseEntryButton = requiredElement<HTMLButtonElement>(
  "knowledge-base-entry",
);
const knowledgeBasePageElement = requiredElement<HTMLElement>(
  "knowledge-base-page",
);
const knowledgeMainElement = requiredElement<HTMLElement>(
  "knowledge-library-view",
).closest<HTMLElement>(".knowledge-main");
if (!knowledgeMainElement) throw new Error("缺少知识库主内容区域");
const knowledgeBaseBackButton = requiredElement<HTMLButtonElement>(
  "knowledge-base-back",
);
const knowledgeFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-filter]"),
);
const knowledgeCountAllElement = requiredElement<HTMLElement>(
  "knowledge-count-all",
);
const knowledgeCountNoteElement = requiredElement<HTMLElement>(
  "knowledge-count-note",
);
const knowledgeCountReadingCardElement = requiredElement<HTMLElement>(
  "knowledge-count-reading-card",
);
const knowledgeCountPaperCardElement = requiredElement<HTMLElement>(
  "knowledge-count-paper-card",
);
const knowledgeCategoryListElement = requiredElement<HTMLElement>(
  "knowledge-category-list",
);
const knowledgeTagListElement =
  requiredElement<HTMLElement>("knowledge-tag-list");
const knowledgeRecentSummaryElement = requiredElement<HTMLElement>(
  "knowledge-recent-summary",
);
const knowledgePageTitleElement = requiredElement<HTMLElement>(
  "knowledge-page-title",
);
const knowledgeTotalCountElement = requiredElement<HTMLElement>(
  "knowledge-total-count",
);
const knowledgeDocumentCountElement = requiredElement<HTMLElement>(
  "knowledge-document-count",
);
const knowledgeRefreshButton =
  requiredElement<HTMLButtonElement>("knowledge-refresh");
const knowledgeImportButton =
  requiredElement<HTMLButtonElement>("knowledge-import");
const knowledgeImportInput = requiredElement<HTMLInputElement>(
  "knowledge-import-input",
);
const knowledgeNewNoteButton =
  requiredElement<HTMLButtonElement>("knowledge-new-note");
const knowledgeSearchInput = requiredElement<HTMLInputElement>(
  "knowledge-search-input",
);
const knowledgeSortSelect = requiredElement<HTMLSelectElement>(
  "knowledge-sort-select",
);
const knowledgeGroupSelect = requiredElement<HTMLSelectElement>(
  "knowledge-group-select",
);
const knowledgePageStatusElement = requiredElement<HTMLElement>(
  "knowledge-page-status",
);
const knowledgeListElement = requiredElement<HTMLElement>("knowledge-list");
const knowledgePageSubtitleElement = document.getElementById(
  "knowledge-page-subtitle",
) as HTMLElement | null;
const knowledgeDashboardMetricsElement = document.getElementById(
  "knowledge-dashboard-metrics",
) as HTMLElement | null;
const knowledgeStudentWorkbenchElement = document.getElementById(
  "knowledge-student-workbench",
) as HTMLElement | null;
const knowledgeWeeklyTasksElement = document.getElementById(
  "knowledge-weekly-tasks",
) as HTMLElement | null;
const knowledgeFocusButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-focus]"),
);
const knowledgeFocusCountTodoElement = document.getElementById(
  "knowledge-focus-count-todo",
) as HTMLElement | null;
const knowledgeFocusCountDeepElement = document.getElementById(
  "knowledge-focus-count-deep",
) as HTMLElement | null;
const knowledgeFocusCountFinishedElement = document.getElementById(
  "knowledge-focus-count-finished",
) as HTMLElement | null;
const knowledgeFocusCountCitableElement = document.getElementById(
  "knowledge-focus-count-citable",
) as HTMLElement | null;
const knowledgeFocusCountReplicateElement = document.getElementById(
  "knowledge-focus-count-replicate",
) as HTMLElement | null;
const knowledgeFocusCountRelatedElement = document.getElementById(
  "knowledge-focus-count-related",
) as HTMLElement | null;
const knowledgeFocusCountMethodsElement = document.getElementById(
  "knowledge-focus-count-methods",
) as HTMLElement | null;
const knowledgeYearFilterSelect = document.getElementById(
  "knowledge-year-filter",
) as HTMLSelectElement | null;
const knowledgeVenueFilterSelect = document.getElementById(
  "knowledge-venue-filter",
) as HTMLSelectElement | null;
const knowledgeReadingStatusFilterSelect = document.getElementById(
  "knowledge-reading-status-filter",
) as HTMLSelectElement | null;
const knowledgePriorityFilterSelect = document.getElementById(
  "knowledge-priority-filter",
) as HTMLSelectElement | null;
const knowledgeClearFiltersButton = document.getElementById(
  "knowledge-clear-filters",
) as HTMLButtonElement | null;
const knowledgeBatchOrganizeButton = document.getElementById(
  "knowledge-batch-organize",
) as HTMLButtonElement | null;
const knowledgeModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-mode]"),
);
const knowledgeLibraryView = requiredElement<HTMLElement>(
  "knowledge-library-view",
);
const knowledgeResearchView = requiredElement<HTMLElement>(
  "knowledge-research-view",
);
const knowledgeResearchHeading = requiredElement<HTMLElement>(
  "knowledge-research-heading",
);
const knowledgeResearchDescription = requiredElement<HTMLElement>(
  "knowledge-research-description",
);
const knowledgeResearchScopeSelect = requiredElement<HTMLSelectElement>(
  "knowledge-research-scope",
);
const knowledgeResearchScopeSummary = requiredElement<HTMLElement>(
  "knowledge-research-scope-summary",
);
const knowledgeSelectVisibleButton = requiredElement<HTMLButtonElement>(
  "knowledge-select-visible",
);
const knowledgeClearSelectionButton = requiredElement<HTMLButtonElement>(
  "knowledge-clear-selection",
);
const knowledgeQaControls = requiredElement<HTMLElement>(
  "knowledge-qa-controls",
);
const knowledgeInsightControls = requiredElement<HTMLElement>(
  "knowledge-insight-controls",
);
const knowledgeResearchQuestionInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-research-question",
);
const knowledgeInsightQuestionInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-insight-question",
);
const knowledgeQuestionPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-question]"),
);
const knowledgeInsightPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-insight]"),
);
const knowledgeRunResearchButton = requiredElement<HTMLButtonElement>(
  "knowledge-run-research",
);
const knowledgeClearResearchButton = requiredElement<HTMLButtonElement>(
  "knowledge-clear-research",
);
const knowledgeResearchStatus = requiredElement<HTMLElement>(
  "knowledge-research-status",
);
const knowledgeResearchResult = requiredElement<HTMLElement>(
  "knowledge-research-result",
);
const knowledgeResearchResultKind = requiredElement<HTMLElement>(
  "knowledge-research-result-kind",
);
const knowledgeResearchResultTitle = requiredElement<HTMLElement>(
  "knowledge-research-result-title",
);
const knowledgeResearchResultBody = requiredElement<HTMLElement>(
  "knowledge-research-result-body",
);
const knowledgeResearchSourceList = requiredElement<HTMLElement>(
  "knowledge-research-source-list",
);
const knowledgeSaveResearchResultButton = requiredElement<HTMLButtonElement>(
  "knowledge-save-research-result",
);
const knowledgeDetailCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-detail-close",
);
const knowledgeDetailEmptyElement = requiredElement<HTMLElement>(
  "knowledge-detail-empty",
);
const knowledgeDetailContentElement = requiredElement<HTMLElement>(
  "knowledge-detail-content",
);
const knowledgeDetailTypeElement = requiredElement<HTMLElement>(
  "knowledge-detail-type",
);
const knowledgeDetailTimeElement = requiredElement<HTMLElement>(
  "knowledge-detail-time",
);
const knowledgeDetailTitleElement = requiredElement<HTMLElement>(
  "knowledge-detail-title",
);
const knowledgeDetailTagsElement = requiredElement<HTMLElement>(
  "knowledge-detail-tags",
);
const knowledgeDetailDocumentElement = requiredElement<HTMLElement>(
  "knowledge-detail-document",
);
const knowledgeDetailPositionElement = requiredElement<HTMLElement>(
  "knowledge-detail-position",
);
const knowledgeDetailCreatedElement = requiredElement<HTMLElement>(
  "knowledge-detail-created",
);
const knowledgeDetailUpdatedElement = requiredElement<HTMLElement>(
  "knowledge-detail-updated",
);
const knowledgeDetailBodyElement = requiredElement<HTMLElement>(
  "knowledge-detail-body",
);
const knowledgeRelatedSummaryElement = requiredElement<HTMLElement>(
  "knowledge-related-summary",
);
const knowledgeOpenSourceButton = requiredElement<HTMLButtonElement>(
  "knowledge-open-source",
);
const knowledgeEditItemButton = requiredElement<HTMLButtonElement>(
  "knowledge-edit-item",
);
const knowledgeDeleteItemButton = requiredElement<HTMLButtonElement>(
  "knowledge-delete-item",
);
const knowledgeEditorDialog = requiredElement<HTMLElement>(
  "knowledge-editor-dialog",
);
const knowledgeEditorForm = requiredElement<HTMLFormElement>(
  "knowledge-editor-form",
);
const knowledgeEditorHeading = requiredElement<HTMLElement>(
  "knowledge-editor-heading",
);
const knowledgeEditorSource = requiredElement<HTMLElement>(
  "knowledge-editor-source",
);
const knowledgeEditorCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-close",
);
const knowledgeEditorCancelButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-cancel",
);
const knowledgeEditorTitleInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-title",
);
const knowledgeEditorCategoryInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-category",
);
const knowledgeEditorTagsInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-tags",
);
const knowledgeEditorBodyInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-editor-body",
);
const assistantViewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-assistant-view]"),
);
const assistantChatPanel = requiredElement<HTMLElement>("assistant-chat-panel");
const assistantSettingsPanel = requiredElement<HTMLElement>(
  "assistant-settings-panel",
);
const settingsModalBackdrop = requiredElement<HTMLElement>(
  "settings-modal-backdrop",
);
const assistantToolsRuntime = requiredElement<HTMLElement>(
  "assistant-tools-runtime",
);
const closeDeepSeekSettingsButton = requiredElement<HTMLButtonElement>(
  "close-deepseek-settings",
);
const chatMessagesElement = requiredElement<HTMLElement>("chat-messages");
const chatForm = requiredElement<HTMLFormElement>("chat-form");
const chatInput = requiredElement<HTMLTextAreaElement>("chat-input");
const chatAttachmentsElement = requiredElement<HTMLElement>("chat-attachments");
const chatImageInput = requiredElement<HTMLInputElement>("chat-image-input");
const chatImageButton = requiredElement<HTMLButtonElement>("chat-image-button");
const chatSendButton = requiredElement<HTMLButtonElement>("chat-send");
const clearChatButton = requiredElement<HTMLButtonElement>("clear-chat");
const chatProviderStatus = requiredElement<HTMLElement>("chat-provider-status");
const aiProviderSelect = requiredElement<HTMLSelectElement>("ai-provider");
const deepSeekApiKeyInput =
  requiredElement<HTMLInputElement>("deepseek-api-key");
const deepSeekModelSelect =
  requiredElement<HTMLSelectElement>("deepseek-model");
const translationModelSelect =
  requiredElement<HTMLSelectElement>("translation-model");
const deepSeekMaxOutputTokensInput = requiredElement<HTMLInputElement>(
  "deepseek-max-output-tokens",
);
const deepSeekThinkingSelect =
  requiredElement<HTMLSelectElement>("deepseek-thinking");
const deepSeekBaseUrlInput =
  requiredElement<HTMLInputElement>("deepseek-base-url");
const deepSeekSettingsStatus = requiredElement<HTMLElement>(
  "deepseek-settings-status",
);
const saveDeepSeekSettingsButton = requiredElement<HTMLButtonElement>(
  "save-deepseek-settings",
);
const testDeepSeekButton = requiredElement<HTMLButtonElement>("test-deepseek");
const visionAiModeSelect = requiredElement<HTMLSelectElement>("vision-ai-mode");
const visionAiFields = requiredElement<HTMLElement>("vision-ai-fields");
const visionApiKeyInput = requiredElement<HTMLInputElement>("vision-api-key");
const visionModelInput = requiredElement<HTMLInputElement>("vision-model");
const visionBaseUrlInput = requiredElement<HTMLInputElement>("vision-base-url");
const visionSettingsStatus = requiredElement<HTMLElement>(
  "vision-settings-status",
);
const testVisionAiButton = requiredElement<HTMLButtonElement>("test-vision-ai");
const chatCompressionTriggerCharactersInput = requiredElement<HTMLInputElement>(
  "chat-compression-trigger-characters",
);
const chatCompressionMaxRecentMessagesInput = requiredElement<HTMLInputElement>(
  "chat-compression-max-recent-messages",
);
const chatCompressionKeepRecentMessagesInput = requiredElement<HTMLInputElement>(
  "chat-compression-keep-recent-messages",
);
const longTermMemoryCount = requiredElement<HTMLElement>(
  "long-term-memory-count",
);
const longTermMemoryList = requiredElement<HTMLElement>(
  "long-term-memory-list",
);
const refreshLongTermMemoriesButton = requiredElement<HTMLButtonElement>(
  "refresh-long-term-memories",
);
const aiTabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".ai-tabs button"),
);
const aiTabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-ai-panel]"),
);
const selectedSnippetElement =
  requiredElement<HTMLTextAreaElement>("selected-snippet");
const selectedSnippetMathPreview = requiredElement<HTMLElement>(
  "selected-snippet-math-preview",
);
const translationSourceSentenceField = requiredElement<HTMLElement>(
  "translation-source-sentence-field",
);
const translationSourceSentenceInput = requiredElement<HTMLTextAreaElement>(
  "translation-source-sentence",
);
const translationSourceSentenceTranslation = requiredElement<HTMLElement>(
  "translation-source-sentence-translation",
);
const translationSourceSentenceMathPreview = requiredElement<HTMLElement>(
  "translation-source-sentence-math-preview",
);
const applyTranslationEditButton = requiredElement<HTMLButtonElement>(
  "apply-translation-edit",
);
const translationLearningHintElement = requiredElement<HTMLElement>(
  "translation-learning-hint",
);
const translationLearningTitleElement = requiredElement<HTMLElement>(
  "translation-learning-title",
);
const translationResultElement =
  requiredElement<HTMLElement>("translation-result");
const saveTranslationNoteButton = requiredElement<HTMLButtonElement>(
  "save-translation-note",
);
const generateMoreExamplesButton = requiredElement<HTMLButtonElement>(
  "generate-more-examples",
);
const translationHistoryCountElement = requiredElement<HTMLElement>(
  "translation-history-count",
);
const clearTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "clear-translation-history",
);
const openTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "open-translation-history",
);
const translationHistoryDialog = requiredElement<HTMLElement>(
  "translation-history-dialog",
);
const closeTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "close-translation-history",
);
const translationHistorySearchInput = requiredElement<HTMLInputElement>(
  "translation-history-search",
);
const translationHistoryDialogCount = requiredElement<HTMLElement>(
  "translation-history-dialog-count",
);
const translationHistoryDialogList = requiredElement<HTMLElement>(
  "translation-history-dialog-list",
);
const copyTranslationButton =
  requiredElement<HTMLButtonElement>("copy-translation");
const summaryPanelElement = requiredElement<HTMLElement>("summary-panel");
const summaryRangeElement = requiredElement<HTMLElement>("summary-range");
const summarySourceElement = requiredElement<HTMLElement>("summary-source");
const summaryPositionElement = requiredElement<HTMLElement>("summary-position");
const summaryResultElement = requiredElement<HTMLElement>("summary-result");
const summaryScopeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-summary-scope]"),
);
const copySummaryButton = requiredElement<HTMLButtonElement>("copy-summary");
const saveSummaryNoteButton =
  requiredElement<HTMLButtonElement>("save-summary-note");
const cardsPanelElement = requiredElement<HTMLElement>("cards-panel");
const cardSourceSnippetElement = requiredElement<HTMLElement>(
  "card-source-snippet",
);
const cardGenerationStatusElement = requiredElement<HTMLElement>(
  "card-generation-status",
);
const cardGeneratedContentElement = requiredElement<HTMLElement>(
  "card-generated-content",
);
const cardTitleElement = requiredElement<HTMLElement>("card-title");
const cardExplanationElement = requiredElement<HTMLElement>("card-explanation");
const cardKeyPointsElement =
  requiredElement<HTMLUListElement>("card-key-points");
const cardPurposeElement = requiredElement<HTMLElement>("card-purpose");
const cardUnderstandingElement =
  requiredElement<HTMLElement>("card-understanding");
const cardSourceLocationElement = requiredElement<HTMLElement>(
  "card-source-location",
);
const cardTypeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-card-type]"),
);
const copyCardButton = requiredElement<HTMLButtonElement>("copy-card");
const saveCardButton = requiredElement<HTMLButtonElement>("save-card");
const outlineList = document.querySelector<HTMLElement>(".outline-list");

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: viewerContainer,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
  // Keep the PDF annotation layer enabled so native internal citations and
  // external links remain interactive. PDF Helper's own editor layer stays
  // independent from it.
  annotationMode: AnnotationMode.ENABLE,
  annotationEditorHighlightColors:
    "yellow=#FFF066,green=#9BE7A5,blue=#8EC5FF,pink=#FF9FC9,orange=#FFC078",
  removePageBorders: false,
  enableAutoLinking: true,
});

linkService.setViewer(pdfViewer);

let pdfDocument: PDFDocumentProxy | null = null;
let sourceName = "";
const documentKnowledgeCache = new Map<string, {
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
}>();
const documentKnowledgeTasks = new Map<string, Promise<{
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
}>>();
let annotationEditor: AnnotationEditorUIManager | null = null;
let activeEditorMode = AnnotationEditorType.NONE;
let canUndoAnnotation = false;
let canRedoAnnotation = false;
let hasUnsavedChanges = false;
let savedAnnotationSnapshot = "";
let unsavedChangesCheckHandle: number | null = null;
let isOpeningDocument = false;
let isSavingAnnotatedPdf = false;
let restoredAnnotationWarmUpPending = false;
let annotationEditorWarmUpInFlight = false;
let currentFileHandle: FileHandleLike | null = null;
let currentRecentEntryId: string | null = null;
let pendingReadingPosition: ReadingPosition | null = null;
let readingPositionSaveHandle: number | null = null;
let isRestoringReadingPosition = false;
let suppressInternalNavigationCapture = false;
let isReturningFromInternalNavigation = false;
const internalNavigationHistory: InternalNavigationEntry[] = [];
let areNoteIndicatorsHidden = false;
let sourcePdfBytes: Uint8Array | null = null;
let selectionRenderFrame = 0;
let contextSelectionRanges: Range[] = [];
let contextSelectionText = "";
let selectedAnnotationEditor: any | null = null;
let selectedHighlightEditor: any | null = null;
let contextHighlightEditor: any | null = null;
let openHighlightNoteEditor: any | null = null;
const nativeAnnotationNotes = new Map<string, string>();
const restoredHelperNotesBySignature = new Map<string, string>();
const restoredHelperNotesByStorageKey = new Map<string, string>();
let lastPointerDown: {
  x: number;
  y: number;
  button: number;
} | null = null;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as T;
}

function setStatus(message: string, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function openRecentFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      RECENT_FILES_DB_NAME,
      RECENT_FILES_DB_VERSION,
    );

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECENT_FILES_STORE_NAME)) {
        db.createObjectStore(RECENT_FILES_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开最近文件数据库。"));
  });
}

async function readRecentFiles(): Promise<RecentPdfEntry[]> {
  if (!("indexedDB" in window)) return [];
  const db = await openRecentFilesDb();

  try {
    const transaction = db.transaction(RECENT_FILES_STORE_NAME, "readonly");
    const store = transaction.objectStore(RECENT_FILES_STORE_NAME);
    const entries = await idbRequestToPromise<RecentPdfEntry[]>(store.getAll());
    return entries
      .filter((entry) => entry && entry.name && entry.id)
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  } finally {
    db.close();
  }
}

async function writeRecentFiles(entries: RecentPdfEntry[]) {
  if (!("indexedDB" in window)) return;
  const db = await openRecentFilesDb();

  try {
    const transaction = db.transaction(RECENT_FILES_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_FILES_STORE_NAME);
    store.clear();

    for (const entry of entries.slice(0, RECENT_FILES_LIMIT)) {
      store.put(entry);
    }

    await idbTransactionDone(transaction);
  } finally {
    db.close();
  }
}

function createRecentEntryId(
  kind: RecentPdfEntry["kind"],
  name: string,
): string {
  const suffix =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${name}:${suffix}`;
}

async function findSameRecentLocalEntry(
  fileHandle: FileHandleLike,
  entries: RecentPdfEntry[],
  name: string,
): Promise<RecentPdfEntry | null> {
  for (const entry of entries) {
    if (entry.kind !== "local" || !entry.fileHandle) continue;
    try {
      if (
        fileHandle.isSameEntry &&
        (await fileHandle.isSameEntry(entry.fileHandle))
      ) {
        return entry;
      }
    } catch {
      // Some browsers can throw if an old handle is no longer available.
    }
  }

  return (
    entries.find((entry) => entry.kind === "local" && entry.name === name) ??
    null
  );
}

async function rememberRecentPdf(
  name: string,
  fileHandle: FileHandleLike | null,
  url?: string,
): Promise<RecentPdfEntry | null> {
  try {
    const entries = await readRecentFiles();
    let entry: RecentPdfEntry | null = null;

    if (fileHandle) {
      const existingEntry = await findSameRecentLocalEntry(
        fileHandle,
        entries,
        name,
      );
      entry = {
        ...existingEntry,
        id: existingEntry?.id ?? createRecentEntryId("local", name),
        name,
        kind: "local",
        lastOpenedAt: Date.now(),
        fileHandle,
      };
    } else if (url) {
      const existingEntry = entries.find((item) => item.id === `remote:${url}`);
      entry = {
        ...existingEntry,
        id: `remote:${url}`,
        name,
        kind: "remote",
        lastOpenedAt: Date.now(),
        url,
      };
    }

    if (!entry) return null;

    const nextEntries = [
      entry,
      ...entries.filter((item) => item.id !== entry.id),
    ].slice(0, RECENT_FILES_LIMIT);
    await writeRecentFiles(nextEntries);
    if (!recentFilesDialog.hidden) void renderRecentFiles();
    return entry;
  } catch (error) {
    console.warn("PDF Helper failed to remember recent PDF.", error);
    return null;
  }
}

async function removeRecentFile(id: string) {
  const entries = await readRecentFiles();
  await writeRecentFiles(entries.filter((entry) => entry.id !== id));
}

function formatRecentTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getCurrentReadingPosition(): ReadingPosition | null {
  if (!pdfDocument) return null;

  return {
    pageNumber: Math.min(
      pdfDocument.numPages,
      Math.max(1, Math.round(pdfViewer.currentPageNumber || 1)),
    ),
    scrollTop: Math.max(0, Math.round(viewerContainer.scrollTop)),
    scrollLeft: Math.max(0, Math.round(viewerContainer.scrollLeft)),
    scale: Math.max(0.1, Math.min(10, Number(pdfViewer.currentScale) || 1)),
    updatedAt: Date.now(),
  };
}

function cancelReadingPositionSave() {
  if (readingPositionSaveHandle === null) return;
  window.clearTimeout(readingPositionSaveHandle);
  readingPositionSaveHandle = null;
}

async function persistCurrentReadingPosition() {
  readingPositionSaveHandle = null;
  if (
    !pdfDocument ||
    !currentRecentEntryId ||
    isOpeningDocument ||
    isRestoringReadingPosition
  )
    return;

  const readingPosition = getCurrentReadingPosition();
  if (!readingPosition) return;

  try {
    const entries = await readRecentFiles();
    const entry = entries.find((item) => item.id === currentRecentEntryId);
    if (!entry) return;

    const updatedEntry: RecentPdfEntry = {
      ...entry,
      lastOpenedAt: Date.now(),
      readingPosition,
    };
    await writeRecentFiles([
      updatedEntry,
      ...entries.filter((item) => item.id !== currentRecentEntryId),
    ]);
  } catch (error) {
    console.warn("PDF Helper failed to persist reading position.", error);
  }
}

function scheduleReadingPositionSave() {
  if (
    !pdfDocument ||
    !currentRecentEntryId ||
    isOpeningDocument ||
    isRestoringReadingPosition
  )
    return;
  cancelReadingPositionSave();
  readingPositionSaveHandle = window.setTimeout(() => {
    void persistCurrentReadingPosition();
  }, 600);
}

function restoreReadingPositionAfterPagesInit() {
  const position = pendingReadingPosition;
  pendingReadingPosition = null;

  if (!pdfDocument || !position) {
    pdfViewer.currentScaleValue = "page-width";
    return;
  }

  isRestoringReadingPosition = true;
  const pageNumber = Math.min(
    pdfDocument.numPages,
    Math.max(1, Math.round(position.pageNumber || 1)),
  );
  const scale = Number(position.scale);

  if (Number.isFinite(scale) && scale > 0) {
    pdfViewer.currentScale = Math.max(0.1, Math.min(10, scale));
  } else {
    pdfViewer.currentScaleValue = "page-width";
  }

  pdfViewer.currentPageNumber = pageNumber;

  const applyPosition = () => {
    viewerContainer.scrollTop = Math.max(
      0,
      Number.isFinite(position.scrollTop)
        ? position.scrollTop
        : viewerContainer.scrollTop,
    );
    viewerContainer.scrollLeft = Math.max(
      0,
      Number.isFinite(position.scrollLeft) ? position.scrollLeft : 0,
    );
    updateControls();
  };

  requestAnimationFrame(() => {
    applyPosition();
    window.setTimeout(() => {
      applyPosition();
      isRestoringReadingPosition = false;
    }, 250);
  });
}

async function requestFileReadPermission(
  fileHandle: FileHandleLike,
): Promise<boolean> {
  const descriptor = { mode: "read" as const };
  const currentPermission = await fileHandle.queryPermission?.(descriptor);
  if (!currentPermission || currentPermission === "granted") return true;
  if (!fileHandle.requestPermission) return false;
  return (await fileHandle.requestPermission(descriptor)) === "granted";
}

async function openRecentFile(entry: RecentPdfEntry) {
  if (pdfDocument && !confirmDiscardUnsavedChanges()) return;
  hideRecentFilesDialog();

  try {
    if (entry.kind === "local") {
      if (!entry.fileHandle)
        throw new Error("这条最近记录没有可用的文件句柄，请重新打开一次 PDF。");
      const hasPermission = await requestFileReadPermission(entry.fileHandle);
      if (!hasPermission) throw new Error("没有获得读取该 PDF 的权限。");
      const file = await entry.fileHandle.getFile();
      await openPdf(
        await file.arrayBuffer(),
        file.name,
        entry.fileHandle,
        false,
      );
      return;
    }

    if (entry.kind === "remote" && entry.url) {
      await openRemotePdf(entry.url);
      return;
    }

    throw new Error("最近记录无效。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function renderRecentFiles() {
  recentFilesList.textContent = "";

  try {
    const entries = await readRecentFiles();

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "recent-files-empty";
      empty.textContent =
        "暂无最近打开记录。用“打开PDF”打开一次文件后，这里会自动记录。";
      recentFilesList.append(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "recent-file-item";

      const openButton = document.createElement("button");
      openButton.className = "recent-file-open";
      openButton.type = "button";
      openButton.title = entry.name;

      const name = document.createElement("span");
      name.className = "recent-file-name";
      name.textContent = getDisplayFileName(entry.name);

      const meta = document.createElement("span");
      meta.className = "recent-file-meta";
      const positionText = entry.readingPosition?.pageNumber
        ? ` · 上次读到第 ${entry.readingPosition.pageNumber} 页`
        : "";
      meta.textContent = `${entry.kind === "local" ? "本地文件" : "远程 PDF"} · ${formatRecentTime(
        entry.lastOpenedAt,
      )}${positionText}`;

      openButton.append(name, meta);
      openButton.addEventListener("click", () => {
        void openRecentFile(entry);
      });

      const removeButton = document.createElement("button");
      removeButton.className = "recent-file-remove";
      removeButton.type = "button";
      removeButton.title = "移除记录";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await removeRecentFile(entry.id);
        await renderRecentFiles();
      });

      item.append(openButton, removeButton);
      recentFilesList.append(item);
    }
  } catch (error) {
    const empty = document.createElement("div");
    empty.className = "recent-files-empty";
    empty.textContent = error instanceof Error ? error.message : String(error);
    recentFilesList.append(empty);
  }
}

function showRecentFilesDialog() {
  recentFilesDialog.hidden = false;
  void renderRecentFiles();
}

function hideRecentFilesDialog() {
  recentFilesDialog.hidden = true;
}

function getCurrentAnnotationSnapshot(): string {
  if (!pdfDocument) return "";

  try {
    const entries = getSerializableAnnotationEntries().sort(
      ([leftKey], [rightKey]) =>
        String(leftKey).localeCompare(String(rightKey)),
    );
    return JSON.stringify(entries);
  } catch (error) {
    console.warn("PDF Helper annotation snapshot failed.", error);
    return "";
  }
}

function updateUnsavedChangesFromSnapshot() {
  if (!pdfDocument || isSavingAnnotatedPdf || isOpeningDocument) return;
  hasUnsavedChanges =
    getCurrentAnnotationSnapshot() !== savedAnnotationSnapshot;
}

function markUnsavedChanges() {
  updateUnsavedChangesFromSnapshot();
}

function scheduleUnsavedChangesCheck() {
  if (unsavedChangesCheckHandle !== null) {
    window.clearTimeout(unsavedChangesCheckHandle);
  }

  unsavedChangesCheckHandle = window.setTimeout(() => {
    unsavedChangesCheckHandle = null;
    updateUnsavedChangesFromSnapshot();
    updateControls();
  }, 0);
}

function markSavedChanges() {
  if (unsavedChangesCheckHandle !== null) {
    window.clearTimeout(unsavedChangesCheckHandle);
    unsavedChangesCheckHandle = null;
  }

  savedAnnotationSnapshot = getCurrentAnnotationSnapshot();
  hasUnsavedChanges = false;
}

type EmbeddedHelperAnnotations = {
  format: "pdf-helper.annotations";
  version: 1;
  app: "PDF Helper";
  sourceName: string;
  fingerprint: string;
  savedAt: string;
  entries: Array<[string, unknown]>;
  notes?: EmbeddedHelperNote[];
};

type EmbeddedHelperNote = {
  key?: string;
  signature?: string;
  note: string;
};

const PDF_HELPER_ATTACHMENT_NAME = "pdfhelper.json";
const PDF_HELPER_ATTACHMENT_DESCRIPTION =
  "PDF Helper internal annotation data. Open with PDF Helper to restore enhanced reading notes.";
const DEFAULT_HIGHLIGHT_RGB = [255, 240, 102] as const;
const FREE_TEXT_MIN_SIZE = 4;
const FREE_TEXT_MAX_SIZE = 72;
const FREE_TEXT_DEFAULT_SIZE = 16;
const RECENT_FILES_DB_NAME = "pdf-helper-recent-files";
const RECENT_FILES_DB_VERSION = 1;
const RECENT_FILES_STORE_NAME = "recent-files";
const RECENT_FILES_LIMIT = 12;

type RecentPdfEntry = {
  id: string;
  name: string;
  kind: "local" | "remote";
  lastOpenedAt: number;
  readingPosition?: ReadingPosition;
  fileHandle?: FileHandleLike;
  url?: string;
};

type ReadingPosition = {
  pageNumber: number;
  scrollTop: number;
  scrollLeft: number;
  scale: number;
  updatedAt: number;
};

type InternalNavigationEntry = ReadingPosition & {
  documentKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPdfFingerprint(
  documentProxy: PDFDocumentProxy | null = pdfDocument,
): string {
  return (
    documentProxy?.fingerprints?.find((fingerprint): fingerprint is string =>
      Boolean(fingerprint),
    ) || ""
  );
}

function normalizeStorageKey(key: string): string {
  return key.replace(/^(pdf-helper-)+/, "");
}

function getEditorTypeValue(editor: any): unknown {
  return (
    editor?.editorType ??
    editor?._type ??
    editor?.annotationEditorType ??
    editor?._initialData?.annotationEditorType ??
    editor?._initialData?.annotationType ??
    editor?.data?.annotationEditorType ??
    editor?.data?.annotationType
  );
}

function hasEditorClass(editor: any, className: string): boolean {
  return Boolean(
    (editor?.div as HTMLElement | null)?.classList?.contains(className),
  );
}

function isHighlightEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "highlight" ||
    type === AnnotationEditorType.HIGHLIGHT ||
    editor?.constructor?._type === "highlight" ||
    editor?.constructor?._editorType === AnnotationEditorType.HIGHLIGHT ||
    hasEditorClass(editor, "highlightEditor")
  );
}

function isFreeTextEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "freeText" ||
    type === AnnotationEditorType.FREETEXT ||
    editor?.constructor?._type === "freeText" ||
    editor?.constructor?._editorType === AnnotationEditorType.FREETEXT ||
    hasEditorClass(editor, "freeTextEditor")
  );
}

function isInkEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "ink" ||
    type === AnnotationEditorType.INK ||
    editor?.constructor?._type === "ink" ||
    editor?.constructor?._editorType === AnnotationEditorType.INK ||
    hasEditorClass(editor, "inkEditor")
  );
}

function isStoredHighlightValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.annotationType === AnnotationEditorType.HIGHLIGHT ||
    value.annotationEditorType === AnnotationEditorType.HIGHLIGHT
  );
}

function hexColorToRgb(color: string): number[] | null {
  const normalized = color.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function normalizeRgbColor(value: unknown): number[] | null {
  if (typeof value === "string") return hexColorToRgb(value);

  const numbers = flattenFiniteNumbers(value);
  if (numbers.length < 3) return null;

  return numbers
    .slice(0, 3)
    .map((channel) => Math.min(255, Math.max(0, Math.round(channel))));
}

function rgbColorToHex(value: unknown): string | null {
  const rgb = normalizeRgbColor(value);
  if (!rgb) return null;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function sanitizeAnnotationStorageValue(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...value };

  // Runtime/UI fields must not be serialized back into pdf.js. They are valid
  // while an editor is alive, but stale copies can break deserialization after
  // reopening a PDF.
  for (const key of [
    "_uiManager",
    "uiManager",
    "parent",
    "div",
    "editor",
    "colorManager",
    "colorName",
    "hcmColor",
    "hcmColorName",
    "nonHCMColorName",
  ]) {
    delete output[key];
  }

  if (isStoredHighlightValue(output)) {
    const color =
      normalizeRgbColor(output.color) ?? DEFAULT_HIGHLIGHT_RGB.slice();
    output.color = color;
    if (output.highlightColor !== undefined) delete output.highlightColor;
  }

  return output;
}

function flattenFiniteNumbers(value: unknown, output: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.push(value);
  } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    for (const item of Array.from(value as unknown as ArrayLike<number>)) {
      if (typeof item === "number" && Number.isFinite(item)) output.push(item);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) flattenFiniteNumbers(item, output);
  }
  return output;
}

function getNumberArraySignature(value: unknown): string {
  return flattenFiniteNumbers(value)
    .map((number) => number.toFixed(3))
    .join(",");
}

function getAnnotationGeometrySignature(value: unknown): string {
  if (!isRecord(value) || !Number.isInteger(value.pageIndex)) return "";

  const annotationType =
    value.annotationType ?? value.annotationEditorType ?? "";
  const rect = getNumberArraySignature(value.rect);
  const quadPoints = getNumberArraySignature(value.quadPoints);
  const outlines = isRecord(value.outlines)
    ? getNumberArraySignature(value.outlines.points)
    : "";

  return [value.pageIndex, annotationType, rect, quadPoints, outlines].join(
    "|",
  );
}

function getEditorSerializedValue(editor: any): unknown {
  try {
    const serialized = editor?.serialize?.(false);
    if (serialized) return serialized;
  } catch {
    // Fall back to initial/internal data below.
  }

  return editor?._initialData ?? editor?.data ?? null;
}

function getEditorStorageKeys(editor: any): string[] {
  const serialized = getEditorSerializedValue(editor);
  const keys = [
    editor?.id,
    editor?.uid,
    editor?.annotationElementId,
    editor?._initialData?.id,
    editor?._initialData?.annotationElementId,
    editor?.data?.id,
    editor?.data?.annotationElementId,
    isRecord(serialized) ? serialized.id : undefined,
    isRecord(serialized) ? serialized.annotationElementId : undefined,
  ];

  return Array.from(
    new Set(
      keys
        .filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        )
        .map(normalizeStorageKey),
    ),
  );
}

function rememberHelperNote(
  key: string | undefined,
  signature: string | undefined,
  note: string,
) {
  const normalizedNote = note.trim();
  if (!normalizedNote) return;

  if (key)
    restoredHelperNotesByStorageKey.set(
      normalizeStorageKey(key),
      normalizedNote,
    );
  if (signature) restoredHelperNotesBySignature.set(signature, normalizedNote);
}

function forgetHelperNote(
  key: string | undefined,
  signature: string | undefined,
) {
  if (key) restoredHelperNotesByStorageKey.delete(normalizeStorageKey(key));
  if (signature) restoredHelperNotesBySignature.delete(signature);
}

function getRememberedHelperNote(keys: string[], signature: string): string {
  for (const key of keys) {
    const note = restoredHelperNotesByStorageKey
      .get(normalizeStorageKey(key))
      ?.trim();
    if (note) return note;
  }

  return (
    (signature ? restoredHelperNotesBySignature.get(signature)?.trim() : "") ||
    ""
  );
}

function toJsonSafeAnnotationValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typedArray = value as unknown as ArrayLike<number> & {
      constructor: { name: string };
    };
    return {
      __pdfHelperTypedArray: typedArray.constructor.name,
      values: Array.from(typedArray),
    };
  }

  if (Array.isArray(value)) return value.map(toJsonSafeAnnotationValue);

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = toJsonSafeAnnotationValue(nestedValue);
    }
    return output;
  }

  return value;
}

function fromJsonSafeAnnotationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJsonSafeAnnotationValue);

  if (isRecord(value)) {
    if (
      typeof value.__pdfHelperTypedArray === "string" &&
      Array.isArray(value.values)
    ) {
      const values = value.values as number[];
      switch (value.__pdfHelperTypedArray) {
        case "Float32Array":
          return new Float32Array(values);
        case "Float64Array":
          return new Float64Array(values);
        case "Uint8Array":
          return new Uint8Array(values);
        case "Uint8ClampedArray":
          return new Uint8ClampedArray(values);
        case "Uint16Array":
          return new Uint16Array(values);
        case "Uint32Array":
          return new Uint32Array(values);
        case "Int8Array":
          return new Int8Array(values);
        case "Int16Array":
          return new Int16Array(values);
        case "Int32Array":
          return new Int32Array(values);
        default:
          return values;
      }
    }

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = fromJsonSafeAnnotationValue(nestedValue);
    }
    return output;
  }

  return value;
}

function getSerializableAnnotationEntries(): Array<[string, unknown]> {
  if (!pdfDocument) return [];
  const serializable = (pdfDocument as any).annotationStorage?.serializable;
  const map = serializable?.map;
  if (!(map instanceof Map)) return [];

  return Array.from(map.entries())
    .filter(([, value]) => {
      if (!isRecord(value) || value.deleted === true) return false;
      return (
        Number.isInteger(value.pageIndex) &&
        (value.annotationType !== undefined ||
          value.annotationEditorType !== undefined)
      );
    })
    .map(([key, value]) => {
      const normalizedKey = String(key);
      const note = getStoredOrLiveAnnotationNote(normalizedKey, value);
      const output = { ...value };

      if (note) {
        output.pdfHelperNote = note;
        if (isStoredHighlightValue(output)) {
          output.comment = note;
        }
      }

      return [
        normalizedKey,
        toJsonSafeAnnotationValue(sanitizeAnnotationStorageValue(output)),
      ];
    });
}

function getSerializableHelperNotes(): EmbeddedHelperNote[] {
  if (!pdfDocument) return [];

  const notes = new Map<string, EmbeddedHelperNote>();
  const addNote = (
    key: string | undefined,
    signature: string | undefined,
    note: string,
  ) => {
    const normalizedNote = note.trim();
    if (!normalizedNote) return;
    const normalizedKey = key ? normalizeStorageKey(key) : undefined;
    const id = `${normalizedKey || ""}|${signature || ""}|${normalizedNote}`;
    notes.set(id, {
      ...(normalizedKey ? { key: normalizedKey } : {}),
      ...(signature ? { signature } : {}),
      note: normalizedNote,
    });
  };

  const serializable = (pdfDocument as any).annotationStorage?.serializable;
  const map = serializable?.map;
  if (map instanceof Map) {
    for (const [key, value] of map.entries()) {
      if (!isRecord(value)) continue;
      const note = getStoredOrLiveAnnotationNote(String(key), value);
      addNote(String(key), getAnnotationGeometrySignature(value), note);
    }
  }

  if (annotationEditor) {
    for (
      let pageIndex = 0;
      pageIndex < (pdfDocument?.numPages ?? 0);
      pageIndex += 1
    ) {
      for (const editor of annotationEditor.getEditors(pageIndex)) {
        if (!isHighlightEditor(editor)) continue;
        const note = getHighlightNote(editor);
        if (!note) continue;
        const signature = getAnnotationGeometrySignature(
          getEditorSerializedValue(editor),
        );
        const keys = getEditorStorageKeys(editor);
        if (keys.length === 0) {
          addNote(undefined, signature, note);
        } else {
          for (const key of keys) addNote(key, signature, note);
        }
      }
    }
  }

  return Array.from(notes.values());
}

function createEmbeddedHelperPayload(): EmbeddedHelperAnnotations {
  if (!pdfDocument) throw new Error("PDF 尚未打开。");
  const entries = getSerializableAnnotationEntries();
  return {
    format: "pdf-helper.annotations",
    version: 1,
    app: "PDF Helper",
    sourceName,
    fingerprint: getPdfFingerprint(pdfDocument),
    savedAt: new Date().toISOString(),
    entries,
    notes: getSerializableHelperNotes(),
  };
}

function parseEmbeddedHelperPayload(
  rawJson: string,
): EmbeddedHelperAnnotations | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  if (payload.format !== "pdf-helper.annotations") return null;
  if (payload.version !== 1) return null;
  if (!Array.isArray(payload.entries)) return null;

  return payload as EmbeddedHelperAnnotations;
}

function decodeAttachmentContent(content: unknown): string | null {
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (content instanceof ArrayBuffer)
    return new TextDecoder().decode(new Uint8Array(content));
  if (Array.isArray(content))
    return new TextDecoder().decode(new Uint8Array(content));
  if (typeof content === "string") return content;
  return null;
}

async function readEmbeddedHelperPayload(
  documentProxy: PDFDocumentProxy,
): Promise<EmbeddedHelperAnnotations | null> {
  const attachments = (await documentProxy.getAttachments()) as Record<
    string,
    { content?: unknown; filename?: string }
  > | null;
  if (!attachments) return null;

  const candidates: EmbeddedHelperAnnotations[] = [];
  for (const [name, attachment] of Object.entries(attachments)) {
    const filename = attachment.filename || name;
    if (
      filename !== PDF_HELPER_ATTACHMENT_NAME &&
      name !== PDF_HELPER_ATTACHMENT_NAME
    )
      continue;
    const rawJson = decodeAttachmentContent(attachment.content);
    if (!rawJson) continue;
    const payload = parseEmbeddedHelperPayload(rawJson);
    if (payload) candidates.push(payload);
  }

  return (
    candidates.sort(
      (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt),
    )[0] ?? null
  );
}

async function embedHelperAnnotationsIntoPdf(): Promise<{
  bytes: Uint8Array;
  count: number;
}> {
  if (!pdfDocument || !sourcePdfBytes)
    throw new Error("PDF 尚未打开，无法保存批注。");
  const payload = createEmbeddedHelperPayload();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const { PDFDocument: PdfLibDocument } = await import("pdf-lib");
  const pdfDoc = await PdfLibDocument.load(sourcePdfBytes, {
    ignoreEncryption: true,
  });
  const now = new Date();

  await pdfDoc.attach(jsonBytes, PDF_HELPER_ATTACHMENT_NAME, {
    mimeType: "application/json",
    description: PDF_HELPER_ATTACHMENT_DESCRIPTION,
    creationDate: now,
    modificationDate: now,
  });

  const bytes = await pdfDoc.save();
  (pdfDocument as any).annotationStorage?.resetModified?.();
  return { bytes, count: payload.entries.length };
}

async function requestFileWritePermission(
  fileHandle: FileHandleLike,
): Promise<boolean> {
  const descriptor: FileHandlePermissionDescriptor = { mode: "readwrite" };

  try {
    const currentPermission = await fileHandle.queryPermission?.(descriptor);
    if (currentPermission === "granted") return true;

    if (fileHandle.requestPermission) {
      const requestedPermission =
        await fileHandle.requestPermission(descriptor);
      return requestedPermission === "granted";
    }

    return currentPermission !== "denied";
  } catch {
    // Some browser/extension combinations do not expose permission helpers but
    // still prompt from createWritable(). Let that path decide.
    return true;
  }
}

function downloadEmbeddedPdfBytes(blob: Blob) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName =
    sourceName
      .split("/")
      .pop()
      ?.replace(/\.pdf$/i, "") || "document";
  link.href = blobUrl;
  link.download = `${safeDecodeURIComponent(baseName)}-pdfhelper.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

async function writeEmbeddedPdfBytes(
  bytes: Uint8Array,
): Promise<"overwritten" | "downloaded" | "permission-denied-downloaded"> {
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  const blob = new Blob([blobBuffer], { type: "application/pdf" });

  if (currentFileHandle) {
    const hasWritePermission =
      await requestFileWritePermission(currentFileHandle);
    if (!hasWritePermission) {
      downloadEmbeddedPdfBytes(blob);
      return "permission-denied-downloaded";
    }

    try {
      const writable = await currentFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "overwritten";
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotAllowedError"))
        throw error;
      downloadEmbeddedPdfBytes(blob);
      return "permission-denied-downloaded";
    }
  }

  downloadEmbeddedPdfBytes(blob);
  return "downloaded";
}

function restoreHelperNoteIndexes(notes: unknown) {
  if (!Array.isArray(notes)) return;

  for (const item of notes) {
    if (!isRecord(item)) continue;
    const note = extractCommentText(item.note);
    if (!note) continue;
    const key = typeof item.key === "string" ? item.key : undefined;
    const signature =
      typeof item.signature === "string" ? item.signature : undefined;
    rememberHelperNote(key, signature, note);
  }
}

function restoreEmbeddedHelperPayload(
  payload: EmbeddedHelperAnnotations | null,
): number {
  if (!payload) return 0;

  // Fingerprint is kept as metadata only. Embedding pdfhelper.json changes the PDF
  // bytes and can change pdf.js' calculated fingerprint, so it must not block
  // restoring data that is already inside the currently opened PDF.

  let restoredCount = 0;
  const annotationStorage = (pdfDocument as any)?.annotationStorage;
  if (!annotationStorage) return 0;
  restoreHelperNoteIndexes(payload.notes);

  for (const [key, storedValue] of payload.entries) {
    const value = fromJsonSafeAnnotationValue(storedValue);
    if (!isRecord(value)) continue;
    if (
      !Number.isInteger(value.pageIndex) ||
      (value.annotationType === undefined &&
        value.annotationEditorType === undefined)
    ) {
      continue;
    }

    const normalizedKey = normalizeStorageKey(String(key));
    const signature = getAnnotationGeometrySignature(value);
    const note =
      getAnnotationNoteFromValue(value) ||
      getRememberedHelperNote(
        [normalizedKey, `pdf-helper-${normalizedKey}`],
        signature,
      );
    if (note) {
      value.pdfHelperNote = note;
      if (isStoredHighlightValue(value)) {
        value.comment = note;
      }

      rememberHelperNote(normalizedKey, signature, note);
    }

    const restoredValue = sanitizeAnnotationStorageValue(value);
    annotationStorage.setValue(`pdf-helper-${normalizedKey}`, {
      ...restoredValue,
      isClone: true,
    });
    restoredCount += 1;
  }

  annotationStorage.resetModified?.();
  return restoredCount;
}

async function restoreHelperAnnotations(
  documentProxy: PDFDocumentProxy,
): Promise<number> {
  const payload = await readEmbeddedHelperPayload(documentProxy);
  return restoreEmbeddedHelperPayload(payload);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function updateNoteIndicatorsVisibility() {
  viewerElement.classList.toggle(
    "pdf-helper-notes-hidden",
    areNoteIndicatorsHidden,
  );
  toggleNotesButton.textContent = areNoteIndicatorsHidden
    ? "显示笔记"
    : "隐藏笔记";
  if (areNoteIndicatorsHidden) hideHighlightNote();
}

function confirmDiscardUnsavedChanges(): boolean {
  if (!hasUnsavedChanges) return true;
  return window.confirm(
    "当前 PDF 有未保存的批注或笔记。是否放弃这些更改并继续？",
  );
}

function updateControls() {
  const hasDocument = pdfDocument !== null;
  const page = hasDocument ? pdfViewer.currentPageNumber : 0;
  const pages = pdfDocument?.numPages ?? 0;
  const scale = hasDocument ? pdfViewer.currentScale : 1;

  pageNumberInput.value = String(page);
  pageNumberInput.max = String(Math.max(1, pages));
  pageCountElement.textContent = String(pages);
  zoomValueElement.textContent = `${Math.round(scale * 100)}%`;

  for (const control of [
    previousButton,
    nextButton,
    pageNumberInput,
    zoomOutButton,
    zoomInButton,
    findInput,
    findPreviousButton,
    findNextButton,
    smartCopyButton,
    saveAnnotatedPdfButton,
    toggleNotesButton,
    copySummaryButton,
    saveSummaryNoteButton,
    copyCardButton,
    saveCardButton,
    ...summaryScopeButtons,
    ...cardTypeButtons,
    freeTextSizeInput,
    freeTextColorInput,
    freeTextSizeDownButton,
    freeTextSizeUpButton,
    ...editorModeButtons,
  ]) {
    control.disabled = !hasDocument;
  }

  previousButton.disabled = !hasDocument || page <= 1;
  nextButton.disabled = !hasDocument || page >= pages;
  undoAnnotationButton.disabled = !hasDocument || !canUndoAnnotation;
  redoAnnotationButton.disabled = !hasDocument || !canRedoAnnotation;
  updateOutlineActivePage();
}

function setLeftPanelCollapsed(collapsed: boolean) {
  appFrame?.classList.toggle("left-panel-collapsed", collapsed);
  outlineToggleButton?.classList.toggle("active", !collapsed);
}

function setFocusMode(enabled: boolean): void {
  if (!appFrame) return;

  appFrame.classList.toggle("focus-mode", enabled);
  const isEnabled = appFrame.classList.contains("focus-mode");
  focusModeButton.classList.toggle("active", isEnabled);
  focusModeButton.setAttribute("aria-pressed", String(isEnabled));
  focusModeButton.title = isEnabled
    ? "恢复顶部工具栏"
    : "隐藏顶部工具栏，专注阅读 PDF";
  focusModeLabel.textContent = isEnabled ? "退出专注" : "专注模式";
}

function updateOutlineActivePage() {
  if (!outlineList) return;
  const currentPage = String(pdfViewer.currentPageNumber || "");
  for (const button of Array.from(
    outlineList.querySelectorAll<HTMLButtonElement>("button"),
  )) {
    button.classList.toggle(
      "active",
      button.dataset.outlinePage === currentPage,
    );
  }
}

function clearOutlineList(message: string) {
  if (!outlineList) return;
  outlineList.textContent = "";
  const placeholder = document.createElement("div");
  placeholder.className = "outline-empty";
  placeholder.textContent = message;
  outlineList.appendChild(placeholder);
}

async function getDestinationPageNumber(
  documentProxy: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    const explicitDest =
      typeof dest === "string"
        ? await documentProxy.getDestination(dest)
        : await dest;
    if (!Array.isArray(explicitDest)) return null;

    const [destRef] = explicitDest;
    if (destRef && typeof destRef === "object") {
      const cachedPageNumber = (documentProxy as any).cachedPageNumber?.(
        destRef,
      );
      if (Number.isInteger(cachedPageNumber)) return cachedPageNumber;
      return (await documentProxy.getPageIndex(destRef)) + 1;
    }

    if (Number.isInteger(destRef)) return (destRef as number) + 1;
  } catch {
    return null;
  }

  return null;
}

function appendOutlineButton({
  label,
  depth,
  pageNumber,
  onClick,
}: {
  label: string;
  depth: number;
  pageNumber?: number;
  onClick: () => void;
}) {
  if (!outlineList) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.paddingLeft = `${12 + depth * 18}px`;
  if (pageNumber) button.dataset.outlinePage = String(pageNumber);
  button.addEventListener("click", onClick);
  outlineList.appendChild(button);
}

async function renderOutlineItems(
  documentProxy: PDFDocumentProxy,
  items: Array<{ title?: string; dest?: unknown; items?: unknown[] }>,
  depth = 0,
) {
  for (const item of items) {
    const title = item.title?.trim() || "未命名目录项";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.style.paddingLeft = `${12 + depth * 18}px`;
    button.addEventListener("click", () => {
      if (item.dest) void navigateToDestinationWithoutReturnHistory(item.dest);
    });
    outlineList?.appendChild(button);

    if (item.dest) {
      void getDestinationPageNumber(documentProxy, item.dest).then(
        (pageNumber) => {
          if (!pageNumber || pdfDocument !== documentProxy) return;
          button.dataset.outlinePage = String(pageNumber);
          updateOutlineActivePage();
          updateSummaryMetadata();
        },
      );
    }

    if (Array.isArray(item.items) && item.items.length > 0) {
      await renderOutlineItems(documentProxy, item.items as any, depth + 1);
    }
  }
}

async function renderDocumentOutline(documentProxy: PDFDocumentProxy) {
  if (!outlineList) return;
  outlineList.textContent = "";

  try {
    const outline = (await documentProxy.getOutline()) as Array<{
      title?: string;
      dest?: unknown;
      items?: unknown[];
    }> | null;
    if (pdfDocument !== documentProxy) return;

    if (outline && outline.length > 0) {
      await renderOutlineItems(documentProxy, outline);
      updateOutlineActivePage();
      updateSummaryMetadata();
      return;
    }
  } catch (error) {
    console.warn("PDF Helper outline load failed.", error);
  }

  if (pdfDocument !== documentProxy) return;
  outlineList.textContent = "";
  const pageCount = documentProxy.numPages;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    appendOutlineButton({
      label: `第 ${pageNumber} 页`,
      depth: 0,
      pageNumber,
      onClick: () => {
        pdfViewer.currentPageNumber = pageNumber;
      },
    });
  }
  updateOutlineActivePage();
  updateSummaryMetadata();
}

function normalizeCopiedText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, "$1$2")
    .replace(/[\t ]+\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/\s*\n\s*/g, " ")
        .replace(/[\t ]{2,}/g, " ")
        .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function getViewerSelectionRawText(): string {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  ) {
    return "";
  }
  const reconstructed = getSelectionSurroundingText().selected;
  return reconstructed || selection.toString();
}

function getViewerSelectionText(): string {
  return normalizeCopiedText(getViewerSelectionRawText());
}

const AUTO_TRANSLATE_DELAY_MS = 700;
const MAX_SUMMARY_SOURCE_LENGTH = 18_000;
const MAX_CARD_SOURCE_LENGTH = 18_000;
const MAX_PAPER_CARD_SOURCE_LENGTH = 55_000;
const SUMMARY_NOTES_STORAGE_KEY = "pdf-helper-summary-notes-v1";
const SAVED_CARDS_STORAGE_KEY = "pdf-helper-saved-cards-v1";
const SAVED_PAPER_OVERVIEWS_STORAGE_KEY = "pdf-helper-paper-overviews-v1";
const KNOWLEDGE_NOTES_STORAGE_KEY = "pdf-helper-knowledge-notes-v1";
const KNOWLEDGE_ITEM_META_STORAGE_KEY = "pdf-helper-knowledge-item-meta-v1";
const PAPER_CARD_INLINE_DRAFT_STORAGE_KEY = "pdf-helper-paper-inline-drafts-v2";

type SummaryScope = "selection" | "page" | "chapter";
type CardType = "concept" | "method" | "experiment" | "viewpoint";
type KnowledgeKind = "note" | "reading-card" | "paper-card";
type KnowledgeFilter = "all" | KnowledgeKind;
type KnowledgeSource =
  | "knowledge-note"
  | "summary-note"
  | "reading-card"
  | "paper-overview";
type KnowledgePageMode = "library" | "qa" | "insights";
type KnowledgeFocus =
  | "all"
  | "todo"
  | "deep"
  | "finished"
  | "citable"
  | "replicate"
  | "related"
  | "methods";
type KnowledgeResearchScope = "selected" | "filtered" | "all";

interface SummaryContext {
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  text: string;
}

interface SavedSummaryNote {
  id: string;
  documentName: string;
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  points: string[];
  createdAt: string;
}

interface CardContext {
  cardType: CardType;
  text: string;
  documentName: string;
  pageNumber: number;
  positionLabel: string;
  sourceLocation: string;
}

interface GeneratedCardContent {
  title: string;
  explanation: string;
  keyPoints: string[];
  purpose: string;
  understanding: string;
}

interface SavedPaperCard extends GeneratedCardContent, CardContext {
  id: string;
  createdAt: string;
}

interface PaperOverviewApiResponse {
  title?: unknown;
  authors?: unknown;
  venue_year?: unknown;
  research_area?: unknown;
  keywords?: unknown;
  one_sentence_summary?: unknown;
  research_problem?: unknown;
  core_innovation?: unknown;
  worth_reading?: unknown;
  problem_setup?: unknown;
  research_gap?: unknown;
  why_important?: unknown;
  topic_tags?: unknown;
  method_overview?: unknown;
  method_intuition?: unknown;
  method_steps?: unknown;
  key_assumptions?: unknown;
  notation_guide?: unknown;
  datasets?: unknown;
  experiment_setup?: unknown;
  metrics?: unknown;
  main_findings?: unknown;
  strongest_evidence?: unknown;
  comparison_with_prior_work?: unknown;
  limitations?: unknown;
  reading_status?: unknown;
  recommend_deep_reading?: unknown;
  reading_difficulty?: unknown;
  reading_value_score?: unknown;
  novelty_score?: unknown;
  evidence_score?: unknown;
  relevance_score?: unknown;
  method_clarity_score?: unknown;
  reading_advice?: unknown;
  suitable_stages?: unknown;
  prerequisites?: unknown;
  citation_points?: unknown;
  research_connection?: unknown;
  followup_questions?: unknown;
  weekly_plan?: unknown;
  detail?: unknown;
}

interface PaperCardFormData {
  title: string;
  authors: string;
  venueYear: string;
  researchArea: string;
  keywords: string;
  oneSentenceSummary: string;
  researchProblem: string;
  coreInnovation: string;
  worthReading: string;
  problemSetup: string;
  researchGap: string;
  whyImportant: string;
  topicTags: string;
  methodOverview: string;
  methodIntuition: string;
  methodSteps: string;
  keyAssumptions: string;
  notationGuide: string;
  datasets: string;
  experimentSetup: string;
  metrics: string;
  mainFindings: string;
  strongestEvidence: string;
  comparisonWithPriorWork: string;
  limitations: string;
  readingStatus: string;
  recommendDeepReading: string;
  readingDifficulty: string;
  readingValueScore: string;
  readingAdvice: string;
  suitableStages: string;
  prerequisites: string;
  citationPoints: string;
  researchConnection: string;
  followupQuestions: string;
  weeklyPlan: string;
  personalNotes: string;
}

interface SavedPaperOverview extends PaperCardFormData {
  id: string;
  documentName: string;
  createdAt: string;
  updatedAt?: string;
}

interface SavedKnowledgeNote {
  id: string;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel?: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeItemMeta {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  updatedAt?: string;
}

type KnowledgeItemMetaStore = Record<string, KnowledgeItemMeta>;

interface KnowledgeItem {
  recordKey: string;
  id: string;
  source: KnowledgeSource;
  kind: KnowledgeKind;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

let aiSelectionUpdateFrame = 0;
let selectedTextForAi = "";
let selectedTextPageNumber = 0;
let lastViewerSelectionText = "";
let lastTranslatedText = "";
let autoTranslateTimer: ReturnType<typeof setTimeout> | null = null;
let translationAbortController: AbortController | null = null;
let moreExamplesAbortController: AbortController | null = null;
let summaryAbortController: AbortController | null = null;
let activeSummaryScope: SummaryScope = "selection";
let lastSummaryRequestKey = "";
let lastSummaryPoints: string[] = [];
let currentSummaryContext: SummaryContext | null = null;
let summaryGenerationTimer: ReturnType<typeof setTimeout> | null = null;
let cardAbortController: AbortController | null = null;
let activeCardType: CardType = "method";
let lastCardRequestKey = "";
let currentCardContext: CardContext | null = null;
let currentGeneratedCard: GeneratedCardContent | null = null;
let cardGenerationTimer: ReturnType<typeof setTimeout> | null = null;
let paperCardPageAbortController: AbortController | null = null;
let paperCardPageDocumentKey = "";
let paperCardPageSourceCache: {
  document: PDFDocumentProxy;
  text: string;
} | null = null;
let editingPaperOverviewId: string | null = null;
let paperCardReviewDocumentName = "";
let paperCardReturnTarget: "pdf" | "knowledge" = "pdf";
let activeKnowledgeFilter: KnowledgeFilter = "all";
let activeKnowledgeCategory = "all";
let activeKnowledgeTag = "";
let activeKnowledgeFocus: KnowledgeFocus = "all";
let activeKnowledgeYear = "all";
let activeKnowledgeVenue = "all";
let activeKnowledgeReadingStatus = "all";
let activeKnowledgePriority = "all";

interface VocabularyExample {
  sentence: string;
  translation: string;
  usage: string;
  source?: "document" | "generated";
}

interface VocabularyPartOfSpeech {
  label: string;
  meaning: string;
}

interface VocabularySense extends VocabularyPartOfSpeech {
  definitionEn: string;
}

interface VocabularyWordForm {
  label: string;
  value: string;
}

interface VocabularyLearningResult {
  kind: "word";
  selectionComplete: boolean;
  selectedWord: string;
  word: string;
  wordForm: string;
  namedEntityType: string;
  pronunciation: string;
  partsOfSpeech: VocabularyPartOfSpeech[];
  senses: VocabularySense[];
  forms: VocabularyWordForm[];
  meaningInSentence: string;
  sentence: string;
  sentenceTranslation: string;
  examples: VocabularyExample[];
}

interface SentenceKeyword {
  word: string;
  partOfSpeech: string;
  meaningInSentence: string;
  reason: string;
}

interface SentenceLearningResult {
  kind: "sentence";
  sourceText: string;
  translation: string;
  keywords: SentenceKeyword[];
}

type EnglishLearningResult = VocabularyLearningResult | SentenceLearningResult;

let currentEnglishLearningResult: EnglishLearningResult | null = null;
let currentEnglishLearningSourceText = "";
let currentEnglishLearningSourceSentence = "";

const TRANSLATION_HISTORY_STORAGE_KEY = "pdf-helper-translation-history-v1";
const MAX_TRANSLATION_HISTORY_PER_DOCUMENT = 200;

interface TranslationHistoryEntry {
  id: string;
  sourceText: string;
  pageNumber: number;
  result: EnglishLearningResult;
  updatedAt: number;
}

type TranslationHistoryStore = Record<string, TranslationHistoryEntry[]>;

let translationHistoryDocumentKey = "";
let translationHistoryEntries: TranslationHistoryEntry[] = [];

const APP_VIEW_SESSION_STORAGE_KEY = "pdf-helper-app-view-state-v1";

type PersistedAppView = "viewer" | "knowledge" | "paper-review";

interface PersistedAppViewState {
  view: PersistedAppView;
  knowledgeMode: KnowledgePageMode;
  knowledgeFilter: KnowledgeFilter;
  knowledgeCategory: string;
  knowledgeTag: string;
  knowledgeFocus: KnowledgeFocus;
  knowledgeYear: string;
  knowledgeVenue: string;
  knowledgeReadingStatus: string;
  knowledgePriority: string;
  knowledgeSearch: string;
  knowledgeSort: string;
  knowledgeGroup: string;
  knowledgeResearchScope: string;
  knowledgeResearchQuestion: string;
  knowledgeInsightQuestion: string;
  selectedKnowledgeRecordKey: string;
  selectedKnowledgeResearchKeys: string[];
  knowledgeScrollTop: number;
  reviewPaperOverviewId: string;
  paperCardScrollTop: number;
}

function readPersistedAppViewState(): PersistedAppViewState | null {
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

function getCurrentPersistedAppView(): PersistedAppView {
  if (!paperCardPageElement.hidden && editingPaperOverviewId)
    return "paper-review";
  if (!knowledgeBasePageElement.hidden) return "knowledge";
  return "viewer";
}

function persistCurrentAppViewState(): void {
  const state: PersistedAppViewState = {
    view: getCurrentPersistedAppView(),
    knowledgeMode: activeKnowledgePageMode,
    knowledgeFilter: activeKnowledgeFilter,
    knowledgeCategory: activeKnowledgeCategory,
    knowledgeTag: activeKnowledgeTag,
    knowledgeFocus: activeKnowledgeFocus,
    knowledgeYear: activeKnowledgeYear,
    knowledgeVenue: activeKnowledgeVenue,
    knowledgeReadingStatus: activeKnowledgeReadingStatus,
    knowledgePriority: activeKnowledgePriority,
    knowledgeSearch: knowledgeSearchInput.value,
    knowledgeSort: knowledgeSortSelect.value,
    knowledgeGroup: knowledgeGroupSelect.value,
    knowledgeResearchScope: knowledgeResearchScopeSelect.value,
    knowledgeResearchQuestion: knowledgeResearchQuestionInput.value,
    knowledgeInsightQuestion: knowledgeInsightQuestionInput.value,
    selectedKnowledgeRecordKey,
    selectedKnowledgeResearchKeys: Array.from(selectedKnowledgeResearchKeys),
    knowledgeScrollTop: knowledgeMainElement?.scrollTop ?? 0,
    reviewPaperOverviewId: editingPaperOverviewId || "",
    paperCardScrollTop: paperCardPageElement.scrollTop,
  };

  try {
    sessionStorage.setItem(APP_VIEW_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the application must remain usable.
  }
}

function applyPersistedKnowledgeState(state: PersistedAppViewState): void {
  activeKnowledgePageMode = state.knowledgeMode;
  activeKnowledgeFilter = state.knowledgeFilter;
  activeKnowledgeCategory = state.knowledgeCategory;
  activeKnowledgeTag = state.knowledgeTag;
  activeKnowledgeFocus = state.knowledgeFocus;
  activeKnowledgeYear = state.knowledgeYear;
  activeKnowledgeVenue = state.knowledgeVenue;
  activeKnowledgeReadingStatus = state.knowledgeReadingStatus;
  activeKnowledgePriority = state.knowledgePriority;
  selectedKnowledgeRecordKey = state.selectedKnowledgeRecordKey;
  selectedKnowledgeResearchKeys = new Set(state.selectedKnowledgeResearchKeys);

  knowledgeSearchInput.value = state.knowledgeSearch;
  knowledgeSortSelect.value = state.knowledgeSort;
  knowledgeGroupSelect.value = state.knowledgeGroup;
  knowledgeResearchScopeSelect.value = state.knowledgeResearchScope;
  knowledgeResearchQuestionInput.value = state.knowledgeResearchQuestion;
  knowledgeInsightQuestionInput.value = state.knowledgeInsightQuestion;
}

function restoreAppViewAfterRefresh(): void {
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

let selectedKnowledgeRecordKey = "";
let knowledgeEditorTargetKey: string | null = null;
let activeKnowledgePageMode: KnowledgePageMode = "library";
let selectedKnowledgeResearchKeys = new Set<string>();
let activeKnowledgeInsightPrompt =
  "请综合材料生成一份研究洞察报告，包含：文献共识、关键分歧、方法演进、尚未解决的问题、3 个有依据的新想法、每个想法的可检验假设与最小验证方案。";
let lastKnowledgeResearchAnswer = "";
let lastKnowledgeResearchQuestion = "";
let lastKnowledgeResearchItems: KnowledgeItem[] = [];
let knowledgeResearchPending = false;
let aiConfig: AiConfig = { ...DEFAULT_AI_CONFIG };
let conversationMemoryConfig: ConversationMemoryConfig = {
  ...DEFAULT_CONVERSATION_MEMORY_CONFIG,
};
let aiConfigLoaded = false;
let visionAiConfig: VisionAiConfig = { ...DEFAULT_VISION_AI_CONFIG };
let chatHistory: AiConversationMessage[] = [];
let chatConversationSummary = "";
let chatSummarizedMessageCount = 0;
let chatRequestPending = false;
let chatPersistenceQueue: Promise<void> = Promise.resolve();
let pendingChatImages: AiImageAttachment[] = [];
let chatImagePreviewOverlay: HTMLElement | null = null;
let readingModePreference: ReadingModePreference = "auto";
let resolvedReadingMode: ResolvedReadingMode = "general";
let readingModeDetectionPending = false;
let readingModeDocumentKey = "";
let readingModeRationale = "";
let readingModeError = "";
type AssistantView = "chat" | "translate" | "summary" | "cards";
let activeAssistantView: AssistantView = "chat";

function setAssistantView(view: AssistantView): void {
  activeAssistantView = view;
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

let settingsSavedFeedbackTimer: number | undefined;
let settingsCloseAnimationTimer: number | undefined;

function showSettingsSavedFeedback(): void {
  if (settingsSavedFeedbackTimer !== undefined) {
    window.clearTimeout(settingsSavedFeedbackTimer);
  }

  aiSettingsButton.classList.add("saved");
  aiSettingsButton.textContent = "✓ 已保存";
  aiSettingsButton.setAttribute("aria-label", "AI 设置已保存");

  settingsSavedFeedbackTimer = window.setTimeout(() => {
    aiSettingsButton.classList.remove("saved");
    aiSettingsButton.textContent = "⚙ 设置";
    aiSettingsButton.setAttribute("aria-label", "打开 AI 设置");
    settingsSavedFeedbackTimer = undefined;
  }, 1400);
}

function setDeepSeekSettingsOpen(open: boolean): void {
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

    // Commit the resting state before entering so both opacity and transform
    // interpolate. This is one small layout read, not a per-frame layout cost.
    assistantSettingsPanel.classList.remove("is-open");
    settingsModalBackdrop.classList.remove("is-open");
    void assistantSettingsPanel.offsetWidth;
    assistantSettingsPanel.classList.add("is-open");
    settingsModalBackdrop.classList.add("is-open");

    void refreshLongTermMemoryList();
    window.setTimeout(() => deepSeekApiKeyInput.focus(), 0);
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

async function requestAiContent(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage["context"] = {},
  configOverride?: Pick<AiConfig, "model" | "reasoning" | "maxOutputTokens">,
): Promise<string> {
  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent = "请先配置并保存模型供应商的 API Key。";
    throw new Error("请先在右上角“设置”中配置 API Key。");
  }

  const response = (await browser.runtime.sendMessage({
    type: "pdf-helper:ai-chat",
    messages,
    configOverride,
    context: {
      ...context,
      readingMode: context.readingMode ?? resolvedReadingMode,
    },
  })) as AiRuntimeResponse;

  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || "AI 模型没有返回有效内容。");
  }
  return response.content.trim();
}

function parseAiList(content: string): string[] {
  const points = content
    .replace(/^```(?:markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean);
  return points.length > 1 ? points : [content.trim()].filter(Boolean);
}

function parseAiJson(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回有效 JSON。");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

interface MarkdownMathToken {
  expression: string;
  displayMode: boolean;
}

interface MarkdownCitationToken {
  pageNumber: number;
  quotes: string[];
}

// A citation may intentionally contain a full paragraph. Keep one page worth
// of text available so the click target can resolve and highlight the complete
// source range instead of forcing the model to cite only a short sentence.
const PDF_CITATION_PATTERN_SOURCE = String.raw`\[\[PDF:P(\d{1,5})\|([\s\S]{2,6000}?)\]\]`;

function createPdfCitationPattern(): RegExp {
  return new RegExp(PDF_CITATION_PATTERN_SOURCE, "g");
}

function protectMarkdownCitations(content: string): {
  markdown: string;
  tokens: MarkdownCitationToken[];
} {
  const tokens: MarkdownCitationToken[] = [];
  const output: string[] = [];
  let cursor = 0;
  let previousCitation:
    | { tokenIndex: number; sourceEnd: number }
    | undefined;

  for (const match of content.matchAll(createPdfCitationPattern())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const gap = content.slice(cursor, start);
    output.push(gap);

    const pageNumber = Number(match[1]);
    const quote = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || quote.length < 2) {
      cursor = end;
      previousCitation = undefined;
      continue;
    }

    const previousToken = previousCitation
      ? tokens[previousCitation.tokenIndex]
      : undefined;
    const separator = previousCitation
      ? content.slice(previousCitation.sourceEnd, start)
      : "";
    const isAdjacentSamePage =
      Boolean(previousToken) &&
      previousToken?.pageNumber === pageNumber &&
      separator.length <= 16 &&
      !/[\p{L}\p{N}]/u.test(separator);

    if (isAdjacentSamePage && previousToken) {
      const normalizedQuote = normalizeCitationMatchText(quote);
      if (
        !previousToken.quotes.some(
          (existingQuote) =>
            normalizeCitationMatchText(existingQuote) === normalizedQuote,
        )
      ) {
        previousToken.quotes.push(quote);
      }
      previousCitation = {
        tokenIndex: previousCitation!.tokenIndex,
        sourceEnd: end,
      };
    } else {
      const tokenIndex = tokens.push({ pageNumber, quotes: [quote] }) - 1;
      output.push(`PDFHELPERCITATIONTOKEN${tokenIndex}END`);
      previousCitation = { tokenIndex, sourceEnd: end };
    }
    cursor = end;
  }

  output.push(content.slice(cursor));
  return { markdown: output.join(""), tokens };
}

function restoreMarkdownCitations(
  container: HTMLElement,
  tokens: MarkdownCitationToken[],
): void {
  if (tokens.length === 0) return;
  const tokenPattern = /PDFHELPERCITATIONTOKEN(\d+)END/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    tokenPattern.lastIndex = 0;
    if (!tokenPattern.test(value)) continue;
    tokenPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(tokenPattern)) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(value.slice(cursor, start));
      const token = tokens[Number(match[1])];
      if (token) {
        const citation = document.createElement("button");
        citation.type = "button";
        citation.className = "pdf-source-citation";
        citation.dataset.pdfPage = String(token.pageNumber);
        citation.dataset.pdfQuote = token.quotes[0] ?? "";
        citation.dataset.pdfQuotes = JSON.stringify(token.quotes);
        citation.dataset.citationTooltip =
          token.quotes.length > 1
            ? `点击跳转到第 ${token.pageNumber} 页并高亮 ${token.quotes.length} 处原文`
            : `点击跳转到第 ${token.pageNumber} 页：${(token.quotes[0] ?? "").slice(0, 88)}${(token.quotes[0]?.length ?? 0) > 88 ? "…" : ""}`;
        citation.setAttribute("aria-label", citation.dataset.citationTooltip);
        citation.textContent =
          token.quotes.length > 1
            ? `第 ${token.pageNumber} 页 · 查看 ${token.quotes.length} 处原文`
            : `第 ${token.pageNumber} 页 · 查看原文`;
        fragment.append(citation);
      }
      cursor = start + match[0].length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

function normalizeBareLatexMath(content: string): string {
  return content.replace(
    /(^|[^$\\\w])(\d+(?:\.\d+)?\^\{[^{}\n]{1,80}\})(?![$])/g,
    (_match, prefix: string, expression: string) => `${prefix}$${expression}$`,
  );
}

function repairUnclosedInlineMathLines(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const delimiters: number[] = [];
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "$" || line[index - 1] === "\\") continue;
        if (line[index - 1] === "$" || line[index + 1] === "$") continue;
        delimiters.push(index);
      }
      if (delimiters.length % 2 === 0) return line;
      const opener = delimiters.at(-1);
      if (opener === undefined) return line;
      const candidate = line.slice(opener + 1).trim();
      const looksLikeLatex =
        candidate.length >= 3 &&
        candidate.length <= 2000 &&
        (/\\[A-Za-z]+/.test(candidate) ||
          /[_^](?:\{|[A-Za-z0-9])/.test(candidate) ||
          /(?:^|\s)[A-Za-z][A-Za-z0-9_{}^]*\s*=/.test(candidate));
      return looksLikeLatex ? `${line}$` : line;
    })
    .join("\n");
}

function protectMarkdownMath(content: string): {
  markdown: string;
  tokens: MarkdownMathToken[];
} {
  const tokens: MarkdownMathToken[] = [];
  const addToken = (expression: string, displayMode: boolean): string => {
    const index =
      tokens.push({ expression: expression.trim(), displayMode }) - 1;
    return `PDFHELPERMATHTOKEN${index}END`;
  };

  let markdown = normalizeBareLatexMath(content)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression: string) =>
      addToken(expression, true),
    )
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) =>
      addToken(expression, true),
    )
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) =>
      addToken(expression, false),
    );

  // Models occasionally wrap one inline formula across several Markdown
  // lines. Accept soft line breaks inside $...$, but never cross an empty
  // paragraph; otherwise one unmatched currency/document dollar sign could
  // consume a large part of the answer.
  markdown = markdown.replace(
    /(^|[^\\$])\$((?:[^$\r\n]|\r?\n(?!\s*\r?\n)){1,2000}?)\$/g,
    (_match, prefix: string, expression: string) =>
      `${prefix}${addToken(expression.replace(/\s*\r?\n\s*/g, " "), false)}`,
  );
  // Some providers occasionally omit the closing dollar entirely. Repair it
  // only when the unmatched tail is unmistakably LaTeX, then tokenize again.
  markdown = repairUnclosedInlineMathLines(markdown).replace(
    /(^|[^\\$])\$([^$\r\n]{1,2000}?)\$/g,
    (_match, prefix: string, expression: string) =>
      `${prefix}${addToken(expression, false)}`,
  );
  return { markdown, tokens };
}

function restoreMarkdownMath(
  container: HTMLElement,
  tokens: MarkdownMathToken[],
): void {
  if (tokens.length === 0) return;

  const tokenPattern = /PDFHELPERMATHTOKEN(\d+)END/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    tokenPattern.lastIndex = 0;
    if (!tokenPattern.test(value)) continue;

    tokenPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(tokenPattern)) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(value.slice(cursor, start));

      const token = tokens[Number(match[1])];
      if (token) {
        const math = document.createElement("span");
        math.className = token.displayMode
          ? "pdf-helper-math display"
          : "pdf-helper-math inline";
        math.setAttribute("aria-label", token.expression);
        math.innerHTML = katex.renderToString(token.expression, {
          displayMode: token.displayMode,
          output: "htmlAndMathml",
          strict: false,
          throwOnError: false,
          trust: false,
        });
        fragment.append(math);
      }
      cursor = start + match[0].length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

function renderChatMarkdown(
  container: HTMLElement,
  content: string,
  renderCitations = true,
  fitMath = true,
): void {
  const citationResult = renderCitations
    ? protectMarkdownCitations(content)
    : {
        markdown: content.replace(createPdfCitationPattern(), ""),
        tokens: [] as MarkdownCitationToken[],
      };
  const mathResult = protectMarkdownMath(citationResult.markdown);
  const html = marked.parse(mathResult.markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
  container.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img"],
    USE_PROFILES: { html: true },
  });
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  restoreMarkdownMath(container, mathResult.tokens);
  restoreMarkdownCitations(container, citationResult.tokens);
  enhanceRenderedTables(container);
  if (fitMath) {
    window.requestAnimationFrame(() => fitDisplayMath(container));
  }
}

function enhanceRenderedTables(container: HTMLElement): void {
  for (const table of container.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.classList.contains("chat-markdown-table")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "chat-markdown-table";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "可横向滚动的表格");
    wrapper.tabIndex = 0;
    table.before(wrapper);
    wrapper.append(table);
  }
}

function fitDisplayMath(container: HTMLElement): void {
  for (const wrapper of container.querySelectorAll<HTMLElement>(
    ".pdf-helper-math.display",
  )) {
    wrapper.classList.remove("needs-horizontal-scroll");
    wrapper.style.removeProperty("--pdf-math-scale");

    const math = wrapper.querySelector<HTMLElement>(".katex");
    const availableWidth = wrapper.clientWidth;
    if (!math || availableWidth <= 0) continue;

    const naturalWidth = math.scrollWidth;
    if (naturalWidth <= availableWidth - 4) continue;

    const scale = Math.max(
      0.72,
      Math.min(1, (availableWidth - 8) / naturalWidth),
    );
    wrapper.style.setProperty("--pdf-math-scale", scale.toFixed(3));

    // KaTeX does not safely line-wrap every construct. Keep a subtle scroll
    // fallback only for exceptionally long formulas after readable scaling.
    if (math.scrollWidth > wrapper.clientWidth + 3) {
      wrapper.classList.add("needs-horizontal-scroll");
    }
  }
}

type ChatActivityState = "active" | "done" | "error";

function updateChatActivity(
  message: HTMLElement,
  key: string,
  label: string,
  state: ChatActivityState,
  detail = "",
): void {
  let activity = message.querySelector<HTMLElement>(".chat-message-activity");
  if (!activity) {
    activity = document.createElement("div");
    activity.className = "chat-message-activity";
    activity.setAttribute("aria-live", "polite");
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "chat-activity-summary";
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-label", "展开工具活动详情");
    const summaryIcon = document.createElement("span");
    summaryIcon.className = "chat-activity-summary-icon";
    summaryIcon.setAttribute("aria-hidden", "true");
    const summaryText = document.createElement("span");
    summaryText.className = "chat-activity-summary-label";
    const summaryDetail = document.createElement("small");
    summaryDetail.className = "chat-activity-summary-detail";
    const summaryChevron = document.createElement("span");
    summaryChevron.className = "chat-activity-summary-chevron";
    summaryChevron.setAttribute("aria-hidden", "true");
    summaryChevron.textContent = "›";
    summary.append(summaryIcon, summaryText, summaryDetail, summaryChevron);
    summary.addEventListener("click", () => {
      const expanded = !activity?.classList.contains("is-expanded");
      activity?.classList.toggle("is-expanded", expanded);
      summary.setAttribute("aria-expanded", String(expanded));
    });
    const details = document.createElement("div");
    details.className = "chat-activity-details";
    activity.append(summary, details);
    const firstContent = message.querySelector(
      ".chat-message-reasoning, .chat-message-content",
    );
    if (firstContent) message.insertBefore(activity, firstContent);
    else message.append(activity);
  }

  // Keep the DOM resilient when an activity was created by an older build or
  // survived a hot reload. Existing rows are moved under the collapsible body.
  let summary = activity.querySelector<HTMLButtonElement>(".chat-activity-summary");
  let details = activity.querySelector<HTMLElement>(".chat-activity-details");
  if (!summary) {
    summary = document.createElement("button");
    summary.type = "button";
    summary.className = "chat-activity-summary";
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-label", "展开工具活动详情");
    summary.innerHTML = '<span class="chat-activity-summary-icon" aria-hidden="true"></span><span class="chat-activity-summary-label"></span><small class="chat-activity-summary-detail"></small><span class="chat-activity-summary-chevron" aria-hidden="true">›</span>';
    summary.addEventListener("click", () => {
      const expanded = !activity?.classList.contains("is-expanded");
      activity?.classList.toggle("is-expanded", expanded);
      summary?.setAttribute("aria-expanded", String(expanded));
    });
    activity.prepend(summary);
  }
  if (!details) {
    details = document.createElement("div");
    details.className = "chat-activity-details";
    for (const oldRow of Array.from(activity.querySelectorAll<HTMLElement>(".chat-activity-row"))) {
      details.append(oldRow);
    }
    activity.append(details);
  }

  let row = Array.from(
    details.querySelectorAll<HTMLElement>(".chat-activity-row"),
  ).find((item) => item.dataset.activityKey === key);
  if (!row) {
    row = document.createElement("div");
    row.className = "chat-activity-row";
    row.dataset.activityKey = key;
    const icon = document.createElement("span");
    icon.className = "chat-activity-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "chat-activity-label";
    const secondary = document.createElement("small");
    secondary.className = "chat-activity-detail";
    row.append(icon, text, secondary);
    details.append(row);
  }

  row.dataset.state = state;
  const text = row.querySelector<HTMLElement>(".chat-activity-label");
  const secondary = row.querySelector<HTMLElement>(".chat-activity-detail");
  if (text) text.textContent = label;
  if (secondary) {
    secondary.textContent = detail;
    secondary.hidden = !detail;
  }
  const rows = Array.from(details.querySelectorAll<HTMLElement>(".chat-activity-row"));
  const latest = [...rows].reverse().find((item) => item.dataset.state === "active") ?? rows.at(-1);
  if (latest) {
    const summaryLabel = summary.querySelector<HTMLElement>(".chat-activity-summary-label");
    const summaryDetail = summary.querySelector<HTMLElement>(".chat-activity-summary-detail");
    const summaryIcon = summary.querySelector<HTMLElement>(".chat-activity-summary-icon");
    const latestLabel = latest.querySelector<HTMLElement>(".chat-activity-label")?.textContent ?? label;
    const latestDetail = latest.querySelector<HTMLElement>(".chat-activity-detail")?.textContent ?? "";
    summaryLabel && (summaryLabel.textContent = latestLabel);
    summaryDetail && (summaryDetail.textContent = rows.length > 1 ? `+${rows.length - 1} 个步骤` : latestDetail);
    if (summaryDetail) summaryDetail.hidden = rows.length <= 1 && !latestDetail;
    summary.dataset.state = latest.dataset.state ?? state;
    summaryIcon?.setAttribute("aria-label", latest.dataset.state ?? state);
    activity.dataset.stepCount = String(rows.length);
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

function failActiveChatActivities(
  message: HTMLElement,
  detail = "本轮请求失败，已停止等待。",
): void {
  for (const activity of message.querySelectorAll<HTMLElement>(
    ".chat-message-activity",
  )) {
    let hadActiveRow = false;
    for (const row of activity.querySelectorAll<HTMLElement>(
      '.chat-activity-row[data-state="active"]',
    )) {
      hadActiveRow = true;
      row.dataset.state = "error";
    }

    // The spinner is driven by the compact summary, not only by its detail
    // rows.  Mark both states so an error cannot leave the summary rotating.
    const summary = activity.querySelector<HTMLButtonElement>(
      ".chat-activity-summary",
    );
    if (hadActiveRow || summary?.dataset.state === "active") {
      activity.dataset.state = "error";
      summary?.setAttribute("data-state", "error");
      summary?.setAttribute("aria-label", "请求失败，展开查看详情");
      const label = summary?.querySelector<HTMLElement>(
        ".chat-activity-summary-label",
      );
      const summaryDetail = summary?.querySelector<HTMLElement>(
        ".chat-activity-summary-detail",
      );
      if (label) label.textContent = "请求失败";
      if (summaryDetail) {
        summaryDetail.textContent = detail;
        summaryDetail.hidden = false;
      }
    }
  }
}

function renderChatMessageImages(
  message: HTMLElement,
  images: AiImageAttachment[] | undefined,
): void {
  message.querySelector(".chat-message-images")?.remove();
  if (!images?.length) return;
  const gallery = document.createElement("div");
  gallery.className = "chat-message-images";
  for (const attachment of images) {
    const image = document.createElement("img");
    image.className = "chat-message-image";
    image.src = attachment.dataUrl;
    image.alt = attachment.name || "聊天截图";
    image.title = attachment.name || "聊天截图";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute(
      "aria-label",
      `放大查看 ${attachment.name || "聊天截图"}`,
    );
    gallery.append(image);
  }
  const body = message.querySelector(".chat-message-content");
  if (body) message.insertBefore(gallery, body);
  else message.append(gallery);
}

function closeChatImagePreview(): void {
  const overlay = chatImagePreviewOverlay;
  if (!overlay) return;
  chatImagePreviewOverlay = null;
  overlay.classList.remove("visible");
  window.setTimeout(() => overlay.remove(), 160);
}

function openChatImagePreview(source: string, alternativeText: string): void {
  closeChatImagePreview();
  const overlay = document.createElement("div");
  overlay.className = "chat-image-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "截图大图预览；再次点击退出");
  overlay.tabIndex = -1;

  const image = document.createElement("img");
  image.className = "chat-image-preview-image";
  image.src = source;
  image.alt = alternativeText || "聊天截图大图";
  const hint = document.createElement("div");
  hint.className = "chat-image-preview-hint";
  hint.textContent = "再次点击退出查看 · Esc 关闭";
  overlay.append(image, hint);
  overlay.addEventListener("click", closeChatImagePreview);
  document.body.append(overlay);
  chatImagePreviewOverlay = overlay;
  requestAnimationFrame(() => overlay.classList.add("visible"));
  overlay.focus();
}

function updateChatReasoning(
  message: HTMLElement,
  content: string,
  streaming: boolean,
): void {
  let details = message.querySelector<HTMLDetailsElement>(
    ".chat-message-reasoning",
  );
  if (!content.trim()) {
    if (!streaming) details?.remove();
    return;
  }

  if (!details) {
    details = document.createElement("details");
    details.className = "chat-message-reasoning";
    details.open = true;

    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.className = "chat-reasoning-label";
    const state = document.createElement("span");
    state.className = "chat-reasoning-state";
    summary.append(label, state);

    const body = document.createElement("div");
    body.className = "chat-reasoning-content";
    details.append(summary, body);
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      details?.classList.toggle("expanded");
      if (details) details.open = true;
      const nextState = details?.querySelector<HTMLElement>(
        ".chat-reasoning-state",
      );
      if (nextState) {
        nextState.textContent = details?.classList.contains("expanded")
          ? "点击收起"
          : "点击展开";
      }
    });

    const answerBody = message.querySelector(".chat-message-content");
    if (answerBody) message.insertBefore(details, answerBody);
    else message.append(details);
  }

  const label = details.querySelector<HTMLElement>(".chat-reasoning-label");
  const state = details.querySelector<HTMLElement>(".chat-reasoning-state");
  const body = details.querySelector<HTMLElement>(".chat-reasoning-content");
  if (label) label.textContent = streaming ? "正在思考…" : "思考过程";
  if (state) {
    state.textContent = streaming
      ? "生成中"
      : details.classList.contains("expanded")
        ? "点击收起"
        : "点击展开";
  }
  if (body) renderChatMarkdown(body, content, true, !streaming);
}

function updateChatMessage(
  message: HTMLElement,
  content: string,
  options: { pending?: boolean; streaming?: boolean; error?: boolean } = {},
): void {
  message.classList.toggle("pending", Boolean(options.pending));
  message.classList.toggle("streaming", Boolean(options.streaming));
  message.classList.toggle("error", Boolean(options.error));
  const body = message.querySelector<HTMLElement>(".chat-message-content");
  if (!body) return;

  if (message.classList.contains("assistant") && !options.error) {
    renderChatMarkdown(
      body,
      content,
      !options.streaming,
      !options.streaming,
    );
  } else {
    body.textContent = content;
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

function appendChatMessage(
  role: "user" | "assistant",
  content: string,
  options: {
    pending?: boolean;
    error?: boolean;
    images?: AiImageAttachment[];
  } = {},
): HTMLElement {
  const message = document.createElement("article");
  message.className = `chat-message ${role}`;
  message.classList.toggle("pending", Boolean(options.pending));
  message.classList.toggle("error", Boolean(options.error));

  const roleLabel = document.createElement("div");
  roleLabel.className = "chat-message-role";
  roleLabel.textContent = role === "user" ? "你" : "PDF Helper";

  const body = document.createElement("div");
  body.className = "chat-message-content";

  message.append(roleLabel, body);
  chatMessagesElement.append(message);
  renderChatMessageImages(message, options.images);
  updateChatMessage(message, content, options);
  return message;
}

const MAX_CHAT_IMAGE_COUNT = 3;
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_CHAT_IMAGE_EDGE = 1600;

async function createChatImageAttachment(
  blob: Blob,
  fallbackName = "screenshot.png",
): Promise<AiImageAttachment> {
  if (!blob.type.startsWith("image/")) throw new Error("只能添加图片文件。");
  if (blob.size > MAX_CHAT_IMAGE_BYTES)
    throw new Error("单张图片不能超过 15 MB。");

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(
      1,
      MAX_CHAT_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法处理这张图片。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      id: crypto.randomUUID(),
      name: blob instanceof File && blob.name ? blob.name : fallbackName,
      mediaType: "image/jpeg",
      dataUrl: canvas.toDataURL("image/jpeg", 0.88),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

function renderPendingChatImages(): void {
  chatAttachmentsElement.replaceChildren();
  chatAttachmentsElement.hidden = pendingChatImages.length === 0;
  for (const attachment of pendingChatImages) {
    const item = document.createElement("div");
    item.className = "chat-attachment";
    const image = document.createElement("img");
    image.src = attachment.dataUrl;
    image.alt = attachment.name;
    image.title = attachment.name;
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `放大查看 ${attachment.name}`);
    image.addEventListener("click", () =>
      openChatImagePreview(image.src, image.alt),
    );
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openChatImagePreview(image.src, image.alt);
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chat-attachment-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `移除 ${attachment.name}`);
    removeButton.addEventListener("click", () => {
      pendingChatImages = pendingChatImages.filter(
        (imageItem) => imageItem.id !== attachment.id,
      );
      renderPendingChatImages();
    });
    item.append(image, removeButton);
    chatAttachmentsElement.append(item);
  }
}

async function addChatImageFiles(files: Iterable<Blob>): Promise<void> {
  const availableSlots = MAX_CHAT_IMAGE_COUNT - pendingChatImages.length;
  if (availableSlots <= 0) {
    setStatus(`一次最多添加 ${MAX_CHAT_IMAGE_COUNT} 张截图。`, true);
    return;
  }
  const candidates = Array.from(files).slice(0, availableSlots);
  for (const [index, file] of candidates.entries()) {
    try {
      pendingChatImages.push(
        await createChatImageAttachment(file, `screenshot-${index + 1}.png`),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  renderPendingChatImages();
  chatInput.focus();
}

function clearPendingChatImages(): void {
  pendingChatImages = [];
  chatImageInput.value = "";
  renderPendingChatImages();
}

async function inspectChatImageWithVision(
  attachment: AiImageAttachment,
  question: string,
  context: AiStreamStartMessage["context"],
): Promise<string> {
  if (!isVisionAiConfigured(visionAiConfig)) {
    throw new Error("请先在“设置 → 视觉模型”中启用并配置视觉模型。");
  }
  const response = (await browser.runtime.sendMessage({
    type: "pdf-helper:ai-vision",
    prompt: [
      "这是用户随聊天消息附加的截图。",
      question
        ? `用户问题：${question.slice(0, 2000)}`
        : "用户希望你分析这张截图。",
      "请准确识别截图中的文字、公式、图表、界面状态和重要空间关系。",
      "输出可直接交给主语言模型使用的中文事实说明；不确定的地方明确标注，不要猜测。",
    ].join("\n"),
    imageDataUrl: attachment.dataUrl,
    context,
  })) as AiRuntimeResponse;
  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || `视觉模型未能分析 ${attachment.name}。`);
  }
  return response.content.trim();
}

async function executeNativeToolCalls(
  calls: AiNativeToolCall[],
  context: AiStreamStartMessage["context"],
): Promise<AiStreamToolResult[]> {
  return Promise.all(calls.map(async (call): Promise<AiStreamToolResult> => {
    const definition = getAgentToolDefinitionByApiName(call.name);
    const toolName = definition?.name ?? call.name;
    console.info("[PDF Helper Agent] native tool call", {
      toolCallId: call.id,
      requestedName: call.name,
      toolName,
      arguments: call.arguments,
    });
    try {
      if (toolName.startsWith("memory.") || toolName.startsWith("library.")) {
        const args = { ...(call.arguments ?? {}) } as Record<string, unknown>;
        if (toolName === "library.getPaper" && typeof args.documentId === "string" && !args.id) {
          args.id = args.documentId;
          delete args.documentId;
        }
        const result = await executeMemoryTool({
          name: toolName as MemoryToolCall["name"],
          arguments: args as never,
        });
        const content = JSON.stringify(result, null, 2).slice(0, 16000);
        console.info("[PDF Helper Agent] native tool result", { toolCallId: call.id, toolName, result });
        return { toolCallId: call.id, name: toolName, ok: result.ok, content };
      }
      const evidence = context?.agentEvidence?.trim()
        || context?.pageText?.trim()
        || context?.documentText?.trim()
        || "当前轮次没有可用的文档证据。";
      const content = JSON.stringify({
        tool: toolName,
        status: "already_prepared",
        sourcePages: context?.sourcePages ?? [],
        evidence: evidence.slice(0, 14000),
      });
      console.info("[PDF Helper Agent] native document tool result", { toolCallId: call.id, toolName });
      return { toolCallId: call.id, name: toolName, ok: true, content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[PDF Helper Agent] native tool failed", { toolCallId: call.id, toolName, error: message });
      return { toolCallId: call.id, name: toolName, ok: false, content: message };
    }
  }));
}

function requestAiStream(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage["context"],
  onDelta: (delta: {
    content?: string;
    reasoningContent?: string;
    toolCalls?: AiNativeToolCall[];
    toolResults?: AiStreamToolResult[];
  }) => void,
): Promise<{
  content: string;
  reasoningContent: string;
  requestId: string;
  requestMessages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;
}> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_STREAM_PORT_NAME });

  return new Promise((resolve, reject) => {
    let settled = false;
    let content = "";
    let reasoningContent = "";
    let debugConversation: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      toolCalls?: AiNativeToolCall[];
      toolCallId?: string;
    }> = [];
    const handledToolRounds = new Set<number>();

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
      try {
        port.disconnect();
      } catch {
        // The background may already have closed the port.
      }
    };

    port.onMessage.addListener((value: unknown) => {
      const message = value as AiStreamServerMessage;
      if (!message || message.requestId !== requestId) return;

      if (message.type === "started") {
        const debug = message.debug;
        console.groupCollapsed(`[PDF Helper AI] 聊天请求 · ${message.model}`);
        if (debug) {
          debugConversation = debug.messages.map((item) => ({ ...item }));
          console.log("模型配置", {
            provider: debug.providerId,
            model: debug.model,
            baseUrl: debug.baseUrl,
            reasoning: debug.reasoning,
            maxOutputTokens: debug.maxOutputTokens,
          });
          console.log("Native tools payload", {
            toolChoice: debug.toolChoice ?? "none",
            tools: debug.nativeTools ?? [],
          });
          const [systemMessage, ...conversationMessages] = debug.messages;
          if (systemMessage)
            console.log("System Prompt\n", systemMessage.content);
          conversationMessages.forEach((item, index) => {
            console.log(
              `${item.role === "user" ? "User" : item.role === "tool" ? "Tool" : "Assistant"} Prompt #${index + 1}\n`,
              item.content,
            );
          });
          console.log(
            "可用 Agent 工具（已随请求发送）",
            debug.availableTools.length
              ? debug.availableTools
              : "没有向模型发送工具定义",
          );
          console.log(
            "本轮回答前已完成的工具调用",
            debug.completedTools.length
              ? debug.completedTools
              : "本轮回答前未执行工具",
          );
          console.log("完整模型对话（实际发送内容）", debugConversation);
        }
        console.groupEnd();
        return;
      }
      if (message.type === "delta") {
        content += message.content;
        onDelta({ content: message.content });
        return;
      }
      if (message.type === "reasoning-delta") {
        reasoningContent += message.content;
        onDelta({ reasoningContent: message.content });
        return;
      }
      if (message.type === "tool-calls") {
        if (handledToolRounds.has(message.round)) return;
        handledToolRounds.add(message.round);
        console.info("[PDF Helper AI] native Agent tool calls", {
          requestId,
          round: message.round,
          calls: message.calls,
        });
        debugConversation.push({
          role: "assistant",
          content: "",
          toolCalls: message.calls,
        });
        onDelta({ toolCalls: message.calls });
        void executeNativeToolCalls(message.calls, context).then((results) => {
          console.info("[PDF Helper AI] native Agent tool results", { requestId, round: message.round, results });
          onDelta({ toolResults: results });
          results.forEach((result) => {
            debugConversation.push({
              role: "tool",
              content: result.content,
              toolCallId: result.toolCallId,
            });
          });
          port.postMessage({ type: "tool-results", requestId, results });
        }).catch((error) => {
          const errorText = error instanceof Error ? error.message : String(error);
          const results = message.calls.map((call) => ({
            toolCallId: call.id,
            name: call.name,
            ok: false,
            content: errorText,
          }));
          onDelta({ toolResults: results });
          results.forEach((result) => {
            debugConversation.push({
              role: "tool",
              content: result.content,
              toolCallId: result.toolCallId,
            });
          });
          port.postMessage({ type: "tool-results", requestId, results });
        });
        return;
      }
      if (message.type === "done") {
        if (message.debug) {
          debugConversation = message.debug.messages.map((item) => ({
            ...item,
          }));
        }
        const completedConversation = [
          ...debugConversation,
          { role: "assistant" as const, content },
        ];
        console.groupCollapsed(
          `[PDF Helper AI] 聊天响应完成 · ${message.model}`,
        );
        const systemMessage = completedConversation.find(
          (item) => item.role === "system",
        );
        if (systemMessage)
          console.log("System Prompt / 角色设定\n", systemMessage.content);
        console.log("发送给模型的全部历史对话", debugConversation);
        console.log("思考过程\n", reasoningContent || "本轮没有返回思考过程");
        console.log("最终回答\n", content);
        console.log("流式完成信息", message.completion ?? {
          contentLength: content.length,
          reasoningLength: reasoningContent.length,
          note: "供应商未返回完成诊断",
        });
        console.log("完整模型对话（包含最终回答）", completedConversation);
        console.log(
          "完整模型对话 JSON（可直接复制）\n",
          JSON.stringify(completedConversation, null, 2),
        );
        console.groupEnd();
        finish(() =>
          resolve({
            content,
            reasoningContent,
            requestId,
            requestMessages: debugConversation.map((item) => ({ ...item })),
          }),
        );
        return;
      }
      if (message.type === "error") {
        console.groupCollapsed(`[PDF Helper AI] 聊天请求失败 · ${requestId}`);
        console.error("错误原因", message.error);
        console.log("安全诊断（不包含 API Key）", message.details ?? "后台未返回诊断详情");
        console.log("失败前已接收内容", {
          contentLength: content.length,
          reasoningLength: reasoningContent.length,
          content,
          reasoningContent,
        });
        console.log("本轮实际发送上下文", debugConversation);
        console.groupEnd();
        const streamError = Object.assign(new Error(message.error), {
          requestId,
          details: message.details,
        });
        finish(() => reject(streamError));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      const error = Object.assign(
        new Error("AI 流式连接已中断，请重新加载扩展后再试。"),
        { requestId },
      );
      console.error("[PDF Helper AI] 流式连接异常中断", {
        requestId,
        contentLength: content.length,
        reasoningLength: reasoningContent.length,
      });
      reject(error);
    });

    const startMessage: AiStreamStartMessage = {
      type: "start",
      requestId,
      messages,
      context: {
        ...context,
        readingMode: context?.readingMode ?? resolvedReadingMode,
      },
    };
    port.postMessage(startMessage);
  });
}

function renderChatConversation(messages: AiConversationMessage[]): void {
  chatHistory = messages.map((message) => ({
    ...message,
    images: message.images?.map((image) => ({ ...image })),
  }));
  chatMessagesElement.replaceChildren();
  for (const message of chatHistory) {
    appendChatMessage(message.role, message.content, {
      images: message.images,
    });
  }
  if (chatHistory.length > 0) {
    requestAnimationFrame(() => {
      chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    });
    return;
  }
  appendChatMessage(
    "assistant",
    "你好，我可以结合当前 PDF 和你选中的文字回答问题。选中一段原文后，可以直接让我翻译、解释或总结。",
  );
}

function resetChatConversation(): void {
  clearPendingChatImages();
  chatConversationSummary = "";
  chatSummarizedMessageCount = 0;
  renderChatConversation([]);
}

function getDocumentChatId(documentProxy: PDFDocumentProxy): string {
  return createDocumentAgentId(
    getPdfFingerprint(documentProxy),
    sourceName,
    documentProxy.numPages,
  );
}

function queueChatConversationPersistence(
  documentProxy: PDFDocumentProxy | null,
): Promise<void> {
  if (!documentProxy || !("indexedDB" in window)) return Promise.resolve();
  const documentId = getDocumentChatId(documentProxy);
  const title = sourceName ? getDisplayFileName(sourceName) : "未命名 PDF";
  const messages = chatHistory.map((message) => ({
    ...message,
    images: message.images?.map((image) => ({ ...image })),
  }));
  const conversationSummary = chatConversationSummary;
  const summarizedMessageCount = chatSummarizedMessageCount;
  chatPersistenceQueue = chatPersistenceQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await getLatestDocumentSession(documentId);
      const now = Date.now();
      await putDocumentSession({
        id: existing?.id ?? `${documentId}:chat:default`,
        documentId,
        title,
        messages,
        conversationSummary: conversationSummary || undefined,
        summarizedMessageCount: summarizedMessageCount || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    })
    .catch((error) => {
      console.warn("[PDF Helper 对话存储] 保存失败", {
        documentId,
        error,
      });
    });
  return chatPersistenceQueue;
}

async function restoreChatConversation(
  documentProxy: PDFDocumentProxy,
): Promise<void> {
  if (!("indexedDB" in window)) {
    resetChatConversation();
    return;
  }
  const documentId = getDocumentChatId(documentProxy);
  try {
    await chatPersistenceQueue;
    const session = await getLatestDocumentSession(documentId);
    if (pdfDocument !== documentProxy) return;
    const storedMessages = (session?.messages ?? [])
      .filter(
        (message): message is AiConversationMessage =>
          (message?.role === "user" || message?.role === "assistant") &&
          typeof message.content === "string" &&
          Boolean(message.content.trim()),
      )
      .map((message) => ({
        ...message,
        images: Array.isArray(message.images)
          ? message.images.filter(
              (image) =>
                image &&
                typeof image.id === "string" &&
                typeof image.name === "string" &&
                typeof image.dataUrl === "string" &&
                image.dataUrl.startsWith("data:image/"),
            )
          : undefined,
      }));
    const messages: AiConversationMessage[] = [];
    let citationsChanged = false;
    for (const message of storedMessages) {
      if (
        message.role !== "assistant" ||
        !createPdfCitationPattern().test(message.content)
      ) {
        messages.push(message);
        continue;
      }
      const validatedContent = await validatePdfCitations(
        message.content,
        documentProxy,
      );
      citationsChanged ||= validatedContent !== message.content;
      messages.push({ ...message, content: validatedContent });
    }
    if (pdfDocument !== documentProxy) return;
    chatConversationSummary =
      typeof session?.conversationSummary === "string"
        ? session.conversationSummary.trim().slice(0, 12000)
        : "";
    chatSummarizedMessageCount = chatConversationSummary
      ? Math.min(
          messages.length,
          Math.max(0, Math.trunc(Number(session?.summarizedMessageCount) || 0)),
        )
      : 0;
    renderChatConversation(messages);
    if (citationsChanged) void queueChatConversationPersistence(documentProxy);
    console.info("[PDF Helper 对话存储] 已恢复当前 PDF 对话", {
      documentId,
      messages: messages.length,
      citationsRevalidated: citationsChanged,
      summarizedMessages: chatSummarizedMessageCount,
      updatedAt: session?.updatedAt,
    });
  } catch (error) {
    if (pdfDocument === documentProxy) resetChatConversation();
    console.warn("[PDF Helper 对话存储] 恢复失败", {
      documentId,
      error,
    });
  }
}

async function prepareChatRequestHistory(
  assistantMessage: HTMLElement,
  documentProxy: PDFDocumentProxy | null,
): Promise<{
  messages: AiConversationMessage[];
  summary?: string;
}> {
  const unsummarizedMessages = chatHistory.slice(chatSummarizedMessageCount);
  const unsummarizedCharacters = unsummarizedMessages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  const shouldCompress =
    unsummarizedMessages.length >
      conversationMemoryConfig.compressionMaxRecentMessages ||
    unsummarizedCharacters >
      conversationMemoryConfig.compressionTriggerCharacters;
  if (!shouldCompress) {
    return {
      messages: unsummarizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      summary: chatConversationSummary || undefined,
    };
  }

  const compressThrough = Math.max(
    chatSummarizedMessageCount,
    chatHistory.length - conversationMemoryConfig.compressionKeepRecentMessages,
  );
  const messagesToCompress = chatHistory
    .slice(chatSummarizedMessageCount, compressThrough)
    .map((message) => ({ role: message.role, content: message.content }));
  if (messagesToCompress.length === 0) {
    return {
      messages: unsummarizedMessages.slice(
        -conversationMemoryConfig.compressionMaxRecentMessages,
      ),
      summary: chatConversationSummary || undefined,
    };
  }

  updateChatActivity(
    assistantMessage,
    "conversation-compression",
    "正在压缩较早对话",
    "active",
    `${messagesToCompress.length} 条`,
  );
  console.groupCollapsed("[PDF Helper AI] 对话上下文压缩");
  console.log("已有长期摘要\n", chatConversationSummary || "（无）");
  console.log("本次压缩对话\n", messagesToCompress);
  console.groupEnd();

  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-compress-conversation",
      previousSummary: chatConversationSummary || undefined,
      messages: messagesToCompress,
    })) as AiRuntimeResponse;
    if (!response?.ok || !response.content?.trim()) {
      throw new Error(response?.error || "模型没有返回有效的对话摘要。");
    }
    chatConversationSummary = response.content.trim().slice(0, 12000);
    chatSummarizedMessageCount = compressThrough;
    console.log("[PDF Helper AI] 对话长期摘要\n", chatConversationSummary);
    updateChatActivity(
      assistantMessage,
      "conversation-compression",
      "较早对话已压缩",
      "done",
      `${chatSummarizedMessageCount} 条已归入长期摘要`,
    );
    void queueChatConversationPersistence(documentProxy);
    return {
      messages: chatHistory
        .slice(chatSummarizedMessageCount)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
      summary: chatConversationSummary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[PDF Helper AI] 对话压缩失败，回退到最近对话", error);
    updateChatActivity(
      assistantMessage,
      "conversation-compression",
      "对话压缩失败，已使用最近记录",
      "error",
      message,
    );
    return {
      messages: unsummarizedMessages.slice(
        -conversationMemoryConfig.compressionMaxRecentMessages,
      ),
      summary: chatConversationSummary || undefined,
    };
  }
}

function updateDeepSeekProviderStatus(): void {
  const modelLabel =
    deepSeekModelSelect.selectedOptions[0]?.textContent?.trim() ||
    aiConfig.model;
  chatProviderStatus.textContent = aiConfig.apiKey
    ? `${modelLabel} · 已配置`
    : "AI 尚未配置";
  chatProviderStatus.classList.toggle("configured", Boolean(aiConfig.apiKey));
}

function readDeepSeekConfigFromForm(): AiConfig {
  const providerId = aiProviderSelect.value as AiProviderId;
  return {
    providerId,
    apiKey: deepSeekApiKeyInput.value.trim(),
    baseUrl: normalizeAiBaseUrl(deepSeekBaseUrlInput.value, providerId),
    model: deepSeekModelSelect.value,
    translationModel: translationModelSelect.value,
    reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
    maxOutputTokens: normalizeAiMaxOutputTokens(
      deepSeekMaxOutputTokensInput.value,
    ),
  };
}

async function loadLongTermMemoryContext(
  documentProxy: PDFDocumentProxy | null,
): Promise<{ text: string; memories: LongTermMemory[] }> {
  try {
    const documentId = documentProxy ? getDocumentChatId(documentProxy) : "";
    const all = await memoryTools.list({ limit: 100 });
    const relevant = all
      .filter((memory) =>
        memory.scope === "global" ||
        memory.scope === "project" ||
        (memory.scope === "pdf" && memory.scopeId === documentId),
      )
      .sort(
        (left, right) =>
          right.importance + right.confidence -
          (left.importance + left.confidence),
      )
      .slice(0, 10);
    const text = relevant
      .map(
        (memory) =>
          `- [${memory.category}/${memory.key}] ${memory.content}`,
      )
      .join("\n");
    console.info("[PDF Helper 长期记忆] 本轮检索", {
      documentId: documentId || undefined,
      count: relevant.length,
      memories: relevant,
    });
    return { text, memories: relevant };
  } catch (error) {
    console.warn("[PDF Helper 长期记忆] 检索失败，本轮不注入长期记忆", error);
    return { text: "", memories: [] };
  }
}

async function extractAndStoreLongTermMemories(
  userMessage: string,
  assistantMessage: string,
  documentProxy: PDFDocumentProxy | null,
  documentName: string,
  requestId?: string,
  assistantElement?: HTMLElement,
): Promise<void> {
  const currentUserIndex = chatHistory.findLastIndex(
    (message) => message.role === "user" && message.content.trim() === userMessage.trim(),
  );
  const confirmedMemoryProposal = findConfirmedMemoryProposal(
    chatHistory,
    currentUserIndex,
  );
  const durableMemorySignal =
    /记住|以后|今后|长期|一直|默认|偏好|我(?:更)?喜欢|我希望|我习惯|我的研究方向|我(?:主要|目前|现在)研究|我的项目|项目目标|回答时|不要再|改为/i;
  if (!durableMemorySignal.test(userMessage) && !confirmedMemoryProposal) {
    console.debug("[PDF Helper 长期记忆] 本轮没有持续性表达，跳过异步提取", {
      requestId,
    });
    return;
  }
  if (assistantElement) {
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "长期记忆工具正在更新",
      "active",
    );
  }
  try {
    const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
    const existing = await memoryTools.list({ limit: 100 });
    console.info("[PDF Helper 长期记忆] 异步提取开始", {
      requestId,
      documentId,
      userMessage,
    });
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-extract-long-term-memory",
      userMessage,
      assistantMessage,
      confirmedMemoryProposal: confirmedMemoryProposal || undefined,
      documentId,
      documentName: documentName
        ? getDisplayFileName(documentName)
        : undefined,
      existingMemories: existing.map((memory) => ({
        key: memory.key,
        content: memory.content,
        scope: memory.scope,
        scopeId: memory.scopeId,
      })),
    })) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || "长期记忆提取失败。");

    const fixedProgramRulePattern =
      /latex|markdown|api\s*key|原文引用|查看原文|点击定位|截图优先|全文注入|公式渲染/i;
    const localCandidates = [
      ...createLocalExplicitMemoryCandidates(userMessage),
      ...(confirmedMemoryProposal
        ? createLocalExplicitMemoryCandidates(`请记住：${confirmedMemoryProposal}`)
        : []),
    ];
    const mergedCandidates = new Map<string, AiMemoryCandidate>();
    for (const candidate of response.memoryCandidates ?? []) {
      mergedCandidates.set(candidate.key, candidate);
    }
    for (const candidate of localCandidates) {
      if (candidate.key.startsWith("profile.personal.likes.")) {
        // A provider may use the old singleton key for a multi-value fact.
        // Prefer the deterministic local key so separate likes can coexist.
        mergedCandidates.delete("profile.personal.likes");
      }
      mergedCandidates.set(candidate.key, candidate);
    }
    const candidates = [...mergedCandidates.values()].filter(
      (candidate) =>
        candidate.sourceType === "explicit" &&
        candidate.confidence >= 0.9 &&
        !fixedProgramRulePattern.test(`${candidate.key} ${candidate.content}`),
    );
    console.info("[PDF Helper 工具调用] memory.upsert", {
      requestId,
      confirmedMemoryProposal: confirmedMemoryProposal || undefined,
      candidates,
      execution: "async-after-response",
    });
    const legacyLikesMemories = candidates.some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )
      ? existing.filter((memory) => memory.key === "profile.personal.likes")
      : [];
    const stored = await Promise.all(
      candidates.map((candidate) =>
        memoryTools.upsert({
          key: candidate.key,
          category: candidate.category,
          content: candidate.content,
          scope: candidate.scope,
          scopeId: candidate.scope === "pdf" ? documentId : undefined,
          confidence: candidate.confidence,
          importance: candidate.importance,
          sourceType: "explicit",
          sourceConversationId: requestId,
          sourcePdfId: documentId,
        }),
      ),
    );
    if (legacyLikesMemories.length > 0) {
      await Promise.all(
        legacyLikesMemories.map((memory) => memoryTools.forget(memory.id)),
      );
      console.info("[PDF Helper 长期记忆] 已移除旧的单值喜好记录", {
        removed: legacyLikesMemories,
      });
    }
    const logPayload = {
      requestId,
      candidateCount: response.memoryCandidates?.length ?? 0,
      localCandidateCount: localCandidates.length,
      storedCount: stored.length,
      stored,
    };
    if (stored.length > 0) {
      console.info("[PDF Helper 工具结果] memory.upsert", stored);
      console.info("[PDF Helper 长期记忆] 写入成功", logPayload);
      if (assistantElement) {
        updateChatActivity(
          assistantElement,
          "long-term-memory",
          "长期记忆工具已更新",
          "done",
          `${stored.length} 条`,
        );
      }
    } else {
      console.info("[PDF Helper 长期记忆] 本轮没有可写入条目", logPayload);
      if (assistantElement) {
        updateChatActivity(
          assistantElement,
          "long-term-memory",
          "长期记忆工具未发现新条目",
          "done",
        );
      }
    }
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
  } catch (error) {
    console.warn("[PDF Helper 长期记忆] 异步提取失败，不影响当前回答", error);
    if (assistantElement) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "长期记忆工具更新失败",
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function findConfirmedMemoryProposal(
  messages: AiConversationMessage[],
  userMessageIndex: number,
): string {
  if (userMessageIndex < 1) return "";
  const confirmation = messages[userMessageIndex]?.content.trim() ?? "";
  if (!/^(?:是的|是|确认|可以|好的?|对|没错|就这样|记住吧|请记住)[。.!！?？]*$/i.test(confirmation)) {
    return "";
  }
  const previousAssistant = [...messages.slice(0, userMessageIndex)]
    .reverse()
    .find((message) => message.role === "assistant");
  const text = previousAssistant?.content.trim() ?? "";
  if (!/(?:长期记忆|永久记住|记住|保存).{0,30}(?:吗|？|\?|候选|偏好)|(?:确认|同意).{0,30}(?:更新|写入|记住)/i.test(text)) {
    return "";
  }
  const proposalLines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•>|]+|\d+[.)、])\s*/, "").trim())
    .filter(Boolean)
    .filter((line) =>
      /^(?:用户|偏好|项目|研究方向|回答时|以后|今后)/.test(line)
      && !/[吗？?]$/.test(line)
      && !/(?:确认的话|回复|回答“|回答「|我就更新|是否)/.test(line),
    );
  return proposalLines.join(" ").slice(0, 1200);
}

function createLocalExplicitMemoryCandidates(
  userMessage: string,
): AiMemoryCandidate[] {
  const content = userMessage.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!content) return [];

  const candidates: AiMemoryCandidate[] = [];
  const responseStyleSignal =
    /(?:记住|以后|今后|每次|一直|默认|需要你|请你|我希望).{0,160}(?:回答|回复|称呼|语气|口吻|开头|结尾|格式)|(?:回答|回复).{0,160}(?:每次|以后|都要|不要|改为)|用户(?:明确)?要求.{0,160}(?:回答|回复|称呼|语气|口吻|开头|结尾|格式)/i;
  if (responseStyleSignal.test(content)) {
    candidates.push({
      key: "preference.response.style",
      category: "preference",
      content: `用户明确要求长期遵循以下回答偏好：${content}`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.9,
    });
  }

  const likesMatch = content.match(/我(?:很|更|最)?喜欢([^，。！？;；\n]{1,80})/i);
  if (likesMatch?.[1]) {
    const likedThing = likesMatch[1].trim();
    candidates.push({
      key: `profile.personal.likes.${createStableMemoryKeySuffix(likedThing)}`,
      category: "profile",
      content: `用户明确表示喜欢${likedThing}。`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.65,
    });
  }

  const rememberMatch = content.match(
    /(?:^|[，。！？;；\s])(?:请)?记住[:：]?\s*([^。！？;；\n]{2,220})/i,
  );
  if (rememberMatch?.[1] && candidates.length === 0) {
    const rememberedFact = rememberMatch[1].trim();
    candidates.push({
      key: `fact.explicit.${createStableMemoryKeySuffix(rememberedFact)}`,
      category: "fact",
      content: `用户明确要求长期记住：${rememberedFact}。`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.75,
    });
  }

  return candidates;
}

function createStableMemoryKeySuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC").toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface ImmediateMemoryWriteResult {
  stored: LongTermMemory[];
  contextText: string;
  completedTools: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
}

function isExplicitMemoryForgetRequest(value: string): boolean {
  const hasAction = /删除|删掉|移除|忘记|(?:不要|别|不再)\s*记住/u.test(value);
  const hasTargetCue = /记忆|这条|这个|喜欢|不喜欢|偏好|习惯|研究方向|项目|设置|内容|列表|残留|条目|记住|memory\.(?:search|list|forget)|工具/u.test(value);
  return hasAction && hasTargetCue;
}

function extractMemoryForgetTarget(value: string): string {
  const candidates = [
    value.match(/(?:把|将)\s*(.+?)(?:这条|这个(?:长期)?记忆)?\s*(?:删除|删掉|移除|忘记)(?:了|吧)?/u)?.[1],
    value.match(/(?:请)?(?:删除|删掉|移除|忘记)\s*(.+?)(?:这条|这个(?:长期)?记忆)?(?:了|吧)?$/u)?.[1],
    value.match(/(?:不要|别|不再)\s*记住\s*(.+?)(?:这条|这个(?:长期)?记忆)?(?:了|吧|吗)?$/u)?.[1],
    value.match(/(.+?)(?:这条|这个(?:长期)?记忆)?\s*(?:删除|删掉|移除|忘记)(?:了|吧)?$/u)?.[1],
  ];
  return (candidates.find((candidate) => candidate?.trim()) ?? "")
    .replace(/^(?:请|帮我)\s*/u, "")
    .trim();
}

function normalizeMemoryForgetText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/用户明确(?:表示|要求(?:长期)?记住)|用户(?:说|表示)|长期记忆|这条记忆|这个记忆|那条记忆|这条|这个|那条|那个|偏好|记录|记忆|请|帮我|把|将|删除|删掉|移除|忘记|了|吧/gu, "")
    .replace(/^[我吾]想?要?/u, "")
    .replace(/[\s,，。.!！?？:：;；"“”'‘’、]/gu, "")
    .trim();
}

async function executeExplicitMemoryForget(
  userMessage: string,
  assistantElement: HTMLElement,
): Promise<ImmediateMemoryWriteResult> {
  const operationId = crypto.randomUUID();
  const target = extractMemoryForgetTarget(userMessage);
  updateChatActivity(
    assistantElement,
    "long-term-memory",
    "Agent 正在调用工具 · memory.list",
    "active",
    target || "memory.list",
  );
  try {
    const existing = await memoryTools.list({ limit: 100 });
    const normalizedTarget = normalizeMemoryForgetText(target);
    const matches = normalizedTarget.length >= 2
      ? existing.filter((memory) => {
        const normalizedMemory = normalizeMemoryForgetText(`${memory.content} ${memory.key}`);
        return normalizedMemory.length >= 2
          && (normalizedMemory.includes(normalizedTarget) || normalizedTarget.includes(normalizedMemory));
      })
      : [];
    if (!matches.length) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "Agent 未找到可删除的记忆",
        "done",
        target || "请提供要删除的内容",
      );
      return {
        stored: [],
        contextText: `用户要求删除长期记忆${target ? `“${target}”` : ""}，但当前没有找到可匹配的已有条目，因此没有新增或修改任何记忆。`,
        completedTools: [{ name: "memory.list", arguments: { limit: 100 } }],
      };
    }

    const deleted: LongTermMemory[] = [];
    const completedTools: ImmediateMemoryWriteResult["completedTools"] = [
      { name: "memory.list", arguments: { limit: 100 } },
    ];
    for (const memory of matches.slice(0, 5)) {
      const toolKey = `memory-forget-${memory.id}`;
      updateChatActivity(
        assistantElement,
        toolKey,
        "Agent 正在调用工具 · memory.forget",
        "active",
        memory.content,
      );
      console.info("[PDF Helper Agent 工具调用] memory.forget", {
        operationId,
        id: memory.id,
        content: memory.content,
      });
      const result = await executeMemoryTool({
        name: "memory.forget",
        arguments: { id: memory.id },
      });
      console.info("[PDF Helper Agent 工具结果] memory.forget", { operationId, result });
      if (result.ok && result.data === true) {
        deleted.push(memory);
        completedTools.push({ name: "memory.forget", arguments: { id: memory.id } });
        updateChatActivity(assistantElement, toolKey, "Agent 已完成 · memory.forget", "done", memory.content);
      } else {
        updateChatActivity(
          assistantElement,
          toolKey,
          "Agent 工具失败 · memory.forget",
          "error",
          result.error || "记忆条目不存在",
        );
      }
    }
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      deleted.length ? "Agent 已删除长期记忆" : "Agent 未删除任何记忆",
      deleted.length ? "done" : "error",
      `${deleted.length} 条`,
    );
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
    return {
      stored: [],
      contextText: deleted.length
        ? [
          `Agent 已在最终回答前调用 memory.forget，删除 ${deleted.length} 条长期记忆：`,
          ...deleted.map((memory) => `- ${memory.content}`),
          "请明确告诉用户删除了哪些内容。",
        ].join("\n")
        : "Agent 尝试调用 memory.forget，但没有成功删除匹配条目。",
      completedTools,
    };
  } catch (error) {
    console.error("[PDF Helper Agent 工具失败] memory.forget", { operationId, error });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 工具失败 · memory.forget",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { stored: [], contextText: "Agent 删除长期记忆失败。", completedTools: [] };
  }
}

async function persistImmediateExplicitMemories(
  userMessage: string,
  documentProxy: PDFDocumentProxy | null,
  assistantElement: HTMLElement,
): Promise<ImmediateMemoryWriteResult> {
  if (isExplicitMemoryForgetRequest(userMessage)) {
    return executeExplicitMemoryForget(userMessage, assistantElement);
  }
  const currentUserIndex = chatHistory.findLastIndex(
    (message) => message.role === "user" && message.content.trim() === userMessage.trim(),
  );
  const confirmedProposal = findConfirmedMemoryProposal(
    chatHistory,
    currentUserIndex,
  );
  const durableMemorySignal =
    /记住|以后|今后|长期|一直|默认|偏好|我(?:更)?喜欢|我希望|我习惯|我的研究方向|我(?:主要|目前|现在)研究|我的项目|项目目标|回答时|不要再|改为/i;
  const directCandidates = createLocalExplicitMemoryCandidates(userMessage);
  const confirmedCandidates = confirmedProposal
    ? createLocalExplicitMemoryCandidates(`请记住：${confirmedProposal}`)
    : [];
  if (
    !durableMemorySignal.test(userMessage) &&
    !confirmedProposal &&
    directCandidates.length === 0
  ) {
    return { stored: [], contextText: "", completedTools: [] };
  }

  updateChatActivity(
    assistantElement,
    "long-term-memory",
    "Agent 正在判断是否调用 memory.upsert",
    "active",
  );
  const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
  const operationId = crypto.randomUUID();
  try {
    const existing = await memoryTools.list({ limit: 100 });
    const previousAssistantMessage = [...chatHistory.slice(0, currentUserIndex)]
      .reverse()
      .find((message) => message.role === "assistant")?.content ?? "";
    let modelCandidates: AiMemoryCandidate[] = [];
    try {
      console.info("[PDF Helper 模型工具决策] 请求判断长期记忆写入", {
        operationId,
        userMessage,
        confirmedProposal: confirmedProposal || undefined,
      });
      const response = (await browser.runtime.sendMessage({
        type: "pdf-helper:ai-plan-long-term-memory-tools",
        userMessage,
        assistantMessage: previousAssistantMessage,
        confirmedMemoryProposal: confirmedProposal || undefined,
        documentId,
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        existingMemories: existing.map((memory) => ({
          key: memory.key,
          content: memory.content,
          scope: memory.scope,
          scopeId: memory.scopeId,
        })),
      })) as AiRuntimeResponse;
      if (!response?.ok) {
        throw new Error(response?.error || "长期记忆工具决策失败。");
      }
      modelCandidates = response.memoryCandidates ?? [];
      console.info("[PDF Helper Agent Tool] 模型返回原生 tool_calls", {
        operationId,
        toolCalls: response.toolCalls ?? [],
        candidates: modelCandidates,
      });
    } catch (planningError) {
      console.warn(
        "[PDF Helper 模型工具决策] 模型判断失败，使用明确指令兜底",
        { operationId, error: planningError },
      );
    }

    const fixedProgramRulePattern =
      /latex|markdown|api\s*key|原文引用|查看原文|点击定位|截图优先|全文注入|公式渲染/i;
    const mergedCandidates = new Map<string, AiMemoryCandidate>();
    for (const candidate of modelCandidates) {
      mergedCandidates.set(`${candidate.key}:${candidate.scope}`, candidate);
    }
    for (const candidate of [...directCandidates, ...confirmedCandidates]) {
      // A generic local fact is only a provider-failure fallback. When the
      // model produced a semantic key, keep that single, clearer memory.
      if (candidate.key.startsWith("fact.explicit.") && modelCandidates.length > 0) {
        continue;
      }
      if (candidate.key.startsWith("profile.personal.likes.")) {
        mergedCandidates.delete("profile.personal.likes:global");
      }
      mergedCandidates.set(`${candidate.key}:${candidate.scope}`, candidate);
    }
    const candidates = [...mergedCandidates.values()].filter(
      (candidate) =>
        candidate.sourceType === "explicit" &&
        candidate.confidence >= 0.9 &&
        !fixedProgramRulePattern.test(`${candidate.key} ${candidate.content}`),
    );
    if (candidates.length === 0) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "模型未请求写入长期记忆",
        "done",
      );
      return { stored: [], contextText: "", completedTools: [] };
    }

    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 正在调用工具 · memory.upsert",
      "active",
      `${candidates.length} 条待写入`,
    );
    console.info("[PDF Helper 工具调用] memory.upsert", {
      operationId,
      candidates,
      requestedBy: "model-memory-planner",
      execution: "before-main-model",
    });
    const stored = await Promise.all(
      candidates.map((candidate) => memoryTools.upsert({
        ...candidate,
        scopeId: candidate.scope === "pdf" ? documentId : undefined,
        sourceConversationId: operationId,
        sourcePdfId: documentId,
      })),
    );
    if (candidates.some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )) {
      await Promise.all(
        existing
          .filter((memory) => memory.key === "profile.personal.likes")
          .map((memory) => memoryTools.forget(memory.id)),
      );
    }
    console.info("[PDF Helper 工具结果] memory.upsert", {
      operationId,
      stored,
    });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 已完成 · memory.upsert",
      "done",
      `${stored.length} 条`,
    );
    stored.forEach((memory, index) => {
      updateChatActivity(
        assistantElement,
        `long-term-memory-result-${index}`,
        `已记住：${memory.content}`,
        "done",
        memory.scope === "global" ? "全局" : memory.scope === "project" ? "项目" : "当前 PDF",
      );
    });
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
    return {
      stored,
      contextText: [
        `模型已在主回答生成前请求调用 memory.upsert，应用已执行成功，共写入 ${stored.length} 条长期记忆：`,
        ...stored.map((memory) => `- ${memory.key}：${memory.content}`),
        "生成最终回答时，请明确、简洁地告诉用户已经记住了哪些内容。",
      ].join("\n"),
      completedTools: candidates.map((candidate) => ({
        name: "memory.upsert",
        arguments: {
          key: candidate.key,
          category: candidate.category,
          content: candidate.content,
          scope: candidate.scope,
        },
      })),
    };
  } catch (error) {
    console.error("[PDF Helper 工具失败] memory.upsert", {
      operationId,
      error,
    });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 工具失败 · memory.upsert",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { stored: [], contextText: "", completedTools: [] };
  }
}

interface KnowledgeAgentResult {
  contextText: string;
  completedTools: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

async function runKnowledgeAgentTools(
  userMessage: string,
  documentProxy: PDFDocumentProxy | null,
  assistantElement: HTMLElement,
): Promise<KnowledgeAgentResult> {
  // Explicit deletion is handled by the guarded memory.forget path above so
  // the planner cannot accidentally turn a forget request into memory.upsert.
  if (isExplicitMemoryForgetRequest(userMessage)) {
    return { contextText: "", completedTools: [] };
  }
  const relevantIntent = /长期记忆|记住了什么|你记得|忘记|删除.{0,8}记忆|以前|历史|读过|看过|文献库|相关文献|哪篇论文/i;
  if (!relevantIntent.test(userMessage)) {
    return { contextText: "", completedTools: [] };
  }
  const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
  updateChatActivity(assistantElement, "knowledge-agent", "Agent 正在规划工具 · memory/library", "active");
  try {
    const response = await browser.runtime.sendMessage({
      type: "pdf-helper:ai-plan-knowledge-tools",
      userMessage,
      documentId,
      documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
    }) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || "记忆/文献工具规划失败。");
    const calls = response.toolCalls ?? [];
    const results: Array<{ call: typeof calls[number]; result: Awaited<ReturnType<typeof executeMemoryTool>> }> = [];
    for (const call of calls.slice(0, 5)) {
      const args = { ...call.arguments };
      if (call.name === "library.getPaper" && !args.id && typeof args.documentId === "string") {
        args.id = args.documentId;
      }
      if (call.name === "memory.forget" && !/(?:忘记|删除|移除)/i.test(userMessage)) {
        console.warn("[PDF Helper Agent] 已阻止没有用户明确授权的 memory.forget", call);
        continue;
      }
      const executable = { name: call.name, arguments: args } as MemoryToolCall;
      updateChatActivity(
        assistantElement,
        `knowledge-tool-${call.id}`,
        `Agent 正在调用工具 · ${call.name}`,
        "active",
        call.name.startsWith("library.") ? "历史文献" : "长期记忆",
      );
      console.info(`[PDF Helper 工具调用] ${call.name}`, executable.arguments);
      const result = await executeMemoryTool(executable);
      console.info(`[PDF Helper 工具结果] ${call.name}`, result);
      results.push({ call, result });
      updateChatActivity(
        assistantElement,
        `knowledge-tool-${call.id}`,
        result.ok ? `Agent 已完成 · ${call.name}` : `Agent 工具失败 · ${call.name}`,
        result.ok ? "done" : "error",
        result.ok ? "" : result.error || "未知错误",
      );
    }
    updateChatActivity(
      assistantElement,
      "knowledge-agent",
      results.length ? "记忆/文献工具执行完成" : "本轮无需调用记忆/文献工具",
      "done",
      results.length ? `${results.length} 次调用` : "",
    );
    return {
      contextText: results.length
        ? [
          "【Agent 记忆/历史文献工具结果】",
          ...results.map(({ call, result }) => [
            `${call.name}：${result.ok ? "成功" : "失败"}`,
            JSON.stringify(result.ok ? result.data : { error: result.error }, null, 2).slice(0, 10000),
          ].join("\n")),
        ].join("\n\n")
        : "",
      completedTools: results.filter(({ result }) => result.ok).map(({ call }) => ({
        name: call.name,
        arguments: call.arguments,
      })),
    };
  } catch (error) {
    console.error("[PDF Helper Agent] 记忆/文献工具流程失败", error);
    updateChatActivity(
      assistantElement,
      "knowledge-agent",
      "记忆/文献工具流程失败",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { contextText: "", completedTools: [] };
  }
}

function readConversationMemoryConfigFromForm(): ConversationMemoryConfig {
  return normalizeConversationMemoryConfig({
    compressionTriggerCharacters:
      Number(chatCompressionTriggerCharactersInput.value),
    compressionMaxRecentMessages:
      Number(chatCompressionMaxRecentMessagesInput.value),
    compressionKeepRecentMessages:
      Number(chatCompressionKeepRecentMessagesInput.value),
  });
}

function populateConversationMemoryConfigForm(
  config: ConversationMemoryConfig,
): void {
  chatCompressionTriggerCharactersInput.value = String(
    config.compressionTriggerCharacters,
  );
  chatCompressionMaxRecentMessagesInput.value = String(
    config.compressionMaxRecentMessages,
  );
  chatCompressionKeepRecentMessagesInput.value = String(
    config.compressionKeepRecentMessages,
  );
  chatCompressionKeepRecentMessagesInput.max = String(
    Math.max(2, config.compressionMaxRecentMessages - 1),
  );
}

const LONG_TERM_MEMORY_CATEGORY_LABELS: Record<LongTermMemory["category"], string> = {
  preference: "偏好",
  profile: "用户",
  project: "项目",
  fact: "事实",
  correction: "纠正",
};

async function backfillExplicitMemoriesFromCurrentChat(): Promise<void> {
  const existing = await memoryTools.list({ limit: 100 });
  const existingByKey = new Map(
    existing.map((memory) => [`${memory.key}:${memory.scope}:${memory.scopeId ?? ""}`, memory]),
  );
  const pending = new Map<string, AiMemoryCandidate>();

  const recentHistory = chatHistory.slice(-50);
  for (const [index, message] of recentHistory.entries()) {
    if (message.role !== "user") continue;
    for (const candidate of createLocalExplicitMemoryCandidates(message.content)) {
      pending.set(`${candidate.key}:${candidate.scope}:`, candidate);
    }
    const confirmedProposal = findConfirmedMemoryProposal(recentHistory, index);
    if (confirmedProposal) {
      for (const candidate of createLocalExplicitMemoryCandidates(
        `请记住：${confirmedProposal}`,
      )) {
        pending.set(`${candidate.key}:${candidate.scope}:`, candidate);
      }
    }
  }

  const candidatesToStore = [...pending.entries()]
    .filter(([identity, candidate]) =>
      existingByKey.get(identity)?.content !== candidate.content,
    )
    .map(([, candidate]) => candidate);
  if (candidatesToStore.length === 0) return;
  await Promise.all(
    candidatesToStore.map((candidate) =>
      memoryTools.upsert({
        ...candidate,
        sourceConversationId: "current-chat-backfill",
      }),
      ),
  );
  const legacyLikesMemories = existing.filter(
    (memory) => memory.key === "profile.personal.likes",
  );
  if (
    legacyLikesMemories.length > 0 &&
    [...pending.values()].some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )
  ) {
    await Promise.all(
      legacyLikesMemories.map((memory) => memoryTools.forget(memory.id)),
    );
  }
  console.info("[PDF Helper 长期记忆] 已补录当前对话中的明确偏好", {
    storedCount: candidatesToStore.length,
    keys: candidatesToStore.map((candidate) => candidate.key),
  });
}

async function refreshLongTermMemoryList(): Promise<void> {
  refreshLongTermMemoriesButton.disabled = true;
  try {
    await backfillExplicitMemoriesFromCurrentChat();
    const memories = await memoryTools.list({ limit: 100 });
    longTermMemoryCount.textContent = `${memories.length} 条`;
    longTermMemoryList.replaceChildren();
    if (memories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-memory-empty";
      empty.textContent = "暂无长期记忆；明确表达的长期偏好会在回答后异步记录。";
      longTermMemoryList.append(empty);
      return;
    }
    for (const memory of memories) {
      const item = document.createElement("div");
      item.className = "settings-memory-item";

      const category = document.createElement("span");
      category.className = "settings-memory-category";
      category.textContent = LONG_TERM_MEMORY_CATEGORY_LABELS[memory.category];

      const content = document.createElement("div");
      content.className = "settings-memory-content";
      content.textContent = memory.content;
      const meta = document.createElement("small");
      meta.textContent = `${memory.key} · ${memory.scope}`;
      content.append(meta);

      const remove = document.createElement("button");
      remove.className = "settings-memory-delete";
      remove.type = "button";
      remove.dataset.memoryId = memory.id;
      remove.setAttribute("aria-label", `删除长期记忆：${memory.content}`);
      remove.title = "删除";
      remove.textContent = "×";
      item.append(category, content, remove);
      longTermMemoryList.append(item);
    }
  } catch (error) {
    longTermMemoryList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "settings-memory-empty";
    empty.textContent = `读取长期记忆失败：${error instanceof Error ? error.message : String(error)}`;
    longTermMemoryList.append(empty);
  } finally {
    refreshLongTermMemoriesButton.disabled = false;
  }
}

function updateVisionAiFieldsVisibility(): void {
  const enabled = visionAiModeSelect.value === "separate";
  visionAiFields.hidden = !enabled;
  testVisionAiButton.disabled = !enabled;
  if (!enabled) {
    visionSettingsStatus.classList.remove("error");
    visionSettingsStatus.textContent = "";
  }
}

function readVisionAiConfigFromForm(): VisionAiConfig {
  return {
    mode: visionAiModeSelect.value as VisionAiMode,
    providerId: "openai-compatible",
    apiKey: visionApiKeyInput.value.trim(),
    baseUrl: visionBaseUrlInput.value.trim().replace(/\/+$/, ""),
    model: visionModelInput.value.trim(),
  };
}

function populateVisionAiConfigForm(config: VisionAiConfig): void {
  visionAiModeSelect.value = config.mode;
  visionApiKeyInput.value = config.apiKey;
  visionModelInput.value = config.model;
  visionBaseUrlInput.value = config.baseUrl;
  updateVisionAiFieldsVisibility();
}

function validateVisionAiConfig(config: VisionAiConfig): boolean {
  if (config.mode === "disabled") return true;
  if (isVisionAiConfigured(config)) return true;
  visionSettingsStatus.classList.add("error");
  visionSettingsStatus.textContent =
    "启用视觉模型后，请填写 API Key、模型和 API 地址。";
  return false;
}

function getInternalNavigationDocumentKey(): string {
  const fingerprint = getPdfFingerprint();
  return fingerprint ? `fingerprint:${fingerprint}` : `source:${sourceName}`;
}

function updateCitationReturnButton() {
  const entry = internalNavigationHistory.at(-1);
  const isAvailable = Boolean(
    entry && entry.documentKey === getInternalNavigationDocumentKey(),
  );

  citationReturnButton.classList.toggle("visible", isAvailable);
  citationReturnButton.setAttribute("aria-hidden", String(!isAvailable));
  citationReturnButton.tabIndex = isAvailable ? 0 : -1;
  citationReturnPosition.textContent =
    isAvailable && entry ? `第 ${entry.pageNumber} 页` : "";
}

function clearInternalNavigationHistory() {
  internalNavigationHistory.length = 0;
  updateCitationReturnButton();
}

function captureInternalNavigationOrigin() {
  if (
    suppressInternalNavigationCapture ||
    isReturningFromInternalNavigation ||
    isOpeningDocument ||
    !pdfDocument
  ) {
    return;
  }

  const position = getCurrentReadingPosition();
  if (!position) return;

  const documentKey = getInternalNavigationDocumentKey();
  const previous = internalNavigationHistory.at(-1);
  if (
    previous?.documentKey === documentKey &&
    previous.pageNumber === position.pageNumber &&
    Math.abs(previous.scrollTop - position.scrollTop) < 4 &&
    Math.abs(previous.scrollLeft - position.scrollLeft) < 4
  ) {
    return;
  }

  internalNavigationHistory.push({ ...position, documentKey });
  if (internalNavigationHistory.length > 20) internalNavigationHistory.shift();
  updateCitationReturnButton();
}

function navigateToDestinationWithoutReturnHistory(destination: unknown) {
  suppressInternalNavigationCapture = true;
  try {
    return linkService.goToDestination(destination as any);
  } finally {
    // The navigation-aware wrapper captures synchronously before PDF.js starts
    // resolving an asynchronous named destination.
    suppressInternalNavigationCapture = false;
  }
}

function returnToPreviousInternalNavigationPosition() {
  if (!pdfDocument || isReturningFromInternalNavigation) return;

  const documentKey = getInternalNavigationDocumentKey();
  let entry = internalNavigationHistory.pop();
  while (entry && entry.documentKey !== documentKey)
    entry = internalNavigationHistory.pop();
  updateCitationReturnButton();
  if (!entry) return;

  isReturningFromInternalNavigation = true;
  isRestoringReadingPosition = true;

  const pageNumber = Math.min(
    pdfDocument.numPages,
    Math.max(1, Math.round(entry.pageNumber)),
  );
  if (Number.isFinite(entry.scale) && entry.scale > 0) {
    pdfViewer.currentScale = Math.max(0.1, Math.min(10, entry.scale));
  }
  pdfViewer.currentPageNumber = pageNumber;

  const exactTop = Math.max(0, entry.scrollTop);
  const exactLeft = Math.max(0, entry.scrollLeft);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      viewerContainer.scrollTo({
        top: exactTop,
        left: exactLeft,
        behavior: "smooth",
      });
      window.setTimeout(() => {
        viewerContainer.scrollTop = exactTop;
        viewerContainer.scrollLeft = exactLeft;
        isReturningFromInternalNavigation = false;
        isRestoringReadingPosition = false;
        updateControls();
        scheduleReadingPositionSave();
      }, 450);
    });
  });
}

const goToPdfDestination = linkService.goToDestination.bind(linkService);
linkService.goToDestination = async (destination: any) => {
  captureInternalNavigationOrigin();
  await goToPdfDestination(destination);
};

function populateDeepSeekConfigForm(config: AiConfig): void {
  aiProviderSelect.value = config.providerId;
  deepSeekApiKeyInput.value = config.apiKey;
  deepSeekModelSelect.value = config.model;
  translationModelSelect.value = config.translationModel || config.model;
  deepSeekMaxOutputTokensInput.value = String(config.maxOutputTokens);
  deepSeekThinkingSelect.value = config.reasoning;
  deepSeekBaseUrlInput.value = config.baseUrl;
}

async function loadDeepSeekConfig(): Promise<void> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
    VISION_AI_CONFIG_STORAGE_KEY,
    CONVERSATION_MEMORY_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as
    | Partial<AiConfig>
    | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as
    | (Partial<AiConfig> & {
        thinking?: AiReasoningMode;
      })
    | undefined;
  const value = current || legacy;
  const providerId = value?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...value,
    providerId,
    apiKey: value?.apiKey?.trim() ?? "",
    baseUrl: normalizeAiBaseUrl(
      value?.baseUrl ?? DEFAULT_AI_CONFIG.baseUrl,
      providerId,
    ),
    reasoning:
      value?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
    translationModel:
      value?.translationModel?.trim()
      || value?.model?.trim()
      || DEFAULT_AI_CONFIG.translationModel,
    maxOutputTokens: normalizeAiMaxOutputTokens(value?.maxOutputTokens),
  };
  if (!current && legacy)
    await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig });
  const storedVision = stored[VISION_AI_CONFIG_STORAGE_KEY] as
    | Partial<VisionAiConfig>
    | undefined;
  visionAiConfig = {
    ...DEFAULT_VISION_AI_CONFIG,
    ...storedVision,
    mode: storedVision?.mode === "separate" ? "separate" : "disabled",
    providerId: "openai-compatible",
    apiKey: storedVision?.apiKey?.trim() ?? "",
    baseUrl: storedVision?.baseUrl?.trim().replace(/\/+$/, "") ?? "",
    model: storedVision?.model?.trim() ?? "",
  };
  conversationMemoryConfig = normalizeConversationMemoryConfig(
    stored[CONVERSATION_MEMORY_CONFIG_STORAGE_KEY] as
      | Partial<ConversationMemoryConfig>
      | undefined,
  );
  aiConfigLoaded = true;
  populateDeepSeekConfigForm(aiConfig);
  populateVisionAiConfigForm(visionAiConfig);
  populateConversationMemoryConfigForm(conversationMemoryConfig);
  updateDeepSeekProviderStatus();
}

async function saveDeepSeekConfig(showSuccess = true): Promise<boolean> {
  const nextConfig = readDeepSeekConfigFromForm();
  const nextVisionConfig = readVisionAiConfigFromForm();
  const nextConversationMemoryConfig = readConversationMemoryConfigFromForm();

  if (!nextConfig.apiKey) {
    deepSeekSettingsStatus.textContent = "请输入 DeepSeek API Key。";
    deepSeekSettingsStatus.classList.add("error");
    return false;
  }
  if (!validateVisionAiConfig(nextVisionConfig)) return false;

  aiConfig = nextConfig;
  visionAiConfig = nextVisionConfig;
  conversationMemoryConfig = nextConversationMemoryConfig;
  aiConfigLoaded = true;
  await browser.storage.local.set({
    [AI_CONFIG_STORAGE_KEY]: nextConfig,
    [VISION_AI_CONFIG_STORAGE_KEY]: nextVisionConfig,
    [CONVERSATION_MEMORY_CONFIG_STORAGE_KEY]: nextConversationMemoryConfig,
  });
  populateDeepSeekConfigForm(nextConfig);
  populateVisionAiConfigForm(nextVisionConfig);
  populateConversationMemoryConfigForm(nextConversationMemoryConfig);
  updateDeepSeekProviderStatus();
  deepSeekSettingsStatus.classList.remove("error");
  deepSeekSettingsStatus.textContent = showSuccess
    ? "设置已保存到当前浏览器。"
    : "";
  visionSettingsStatus.classList.remove("error");
  if (showSuccess) {
    visionSettingsStatus.textContent =
      nextVisionConfig.mode === "separate"
        ? `视觉模型已保存：${nextVisionConfig.model}`
        : "";
  }
  return true;
}

async function testDeepSeekConnection(): Promise<void> {
  if (!(await saveDeepSeekConfig(false))) return;

  testDeepSeekButton.disabled = true;
  deepSeekSettingsStatus.classList.remove("error");
  deepSeekSettingsStatus.textContent = "正在连接 DeepSeek…";

  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-test",
    })) as AiRuntimeResponse;

    if (!response?.ok) throw new Error(response?.error || "连接测试失败。");
    const modelCount = response.models?.length ?? 0;
    deepSeekSettingsStatus.textContent = modelCount
      ? `连接成功，可用模型 ${modelCount} 个。`
      : "连接成功。";
  } catch (error) {
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    testDeepSeekButton.disabled = false;
  }
}

function createVisionTestImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#1f67e8";
  context.fillRect(8, 8, 16, 16);
  return canvas.toDataURL("image/png");
}

async function testVisionAiConnection(): Promise<void> {
  const nextConfig = readVisionAiConfigFromForm();
  if (!validateVisionAiConfig(nextConfig)) return;
  visionAiConfig = nextConfig;
  await browser.storage.local.set({
    [VISION_AI_CONFIG_STORAGE_KEY]: nextConfig,
  });

  testVisionAiButton.disabled = true;
  visionSettingsStatus.classList.remove("error");
  visionSettingsStatus.textContent = "正在测试视觉模型…";
  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-vision-test",
      imageDataUrl: createVisionTestImage(),
    })) as AiRuntimeResponse;
    if (!response?.ok)
      throw new Error(response?.error || "视觉模型连接测试失败。");
    visionSettingsStatus.textContent = `视觉连接成功：${response.model || nextConfig.model}`;
  } catch (error) {
    visionSettingsStatus.classList.add("error");
    visionSettingsStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    testVisionAiButton.disabled = false;
  }
}

function getReadingModeDocumentKey(
  documentProxy: PDFDocumentProxy | null = pdfDocument,
): string {
  const fingerprint = getPdfFingerprint(documentProxy);
  if (fingerprint) return `fingerprint:${fingerprint}`;
  const fileName = sourceName ? getDisplayFileName(sourceName) : "";
  return fileName && documentProxy
    ? `file:${fileName}:${documentProxy.numPages}`
    : "";
}

function updateReadingModeUi(): void {
  readingModeSelect.value = readingModePreference;
  detectReadingModeButton.disabled =
    !pdfDocument || readingModeDetectionPending;
  detectReadingModeButton.textContent = readingModeDetectionPending
    ? "识别中…"
    : "重新识别";
  const prefix = readingModePreference === "auto" ? "AI自动" : "手动";
  readingModeStatus.textContent = readingModeDetectionPending
    ? "正在识别…"
    : readingModeError ||
      `${prefix} · ${getReadingModeLabel(resolvedReadingMode)}`;
  readingModeStatus.title =
    readingModeError ||
    readingModeRationale ||
    (readingModePreference === "auto"
      ? "由 AI 根据文件名、目录与正文样本识别，可手动切换"
      : "当前文档使用手动指定的阅读模式");
  readingModeStatus.classList.toggle("error", Boolean(readingModeError));
}

async function readReadingModeStore(): Promise<
  Record<string, ReadingModeState>
> {
  const stored = await browser.storage.local.get(READING_MODE_STORAGE_KEY);
  const value = stored[READING_MODE_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, ReadingModeState>)
    : {};
}

async function persistReadingMode(state: ReadingModeState): Promise<void> {
  if (!readingModeDocumentKey) return;
  const modes = await readReadingModeStore();
  modes[readingModeDocumentKey] = state;
  await browser.storage.local.set({ [READING_MODE_STORAGE_KEY]: modes });
}

function collectOutlineTitles(
  items: Array<{ title?: string; items?: unknown[] }> | null,
  target: string[] = [],
): string[] {
  for (const item of items ?? []) {
    const title = item.title?.trim();
    if (title) target.push(title);
    if (Array.isArray(item.items)) {
      collectOutlineTitles(
        item.items as Array<{ title?: string; items?: unknown[] }>,
        target,
      );
    }
  }
  return target;
}

async function buildReadingModeSample(
  documentProxy: PDFDocumentProxy,
): Promise<{
  sampleText: string;
  outlineTitles: string[];
}> {
  const pages: string[] = [];
  const pageNumbers = Array.from(
    new Set(
      [1, 2, 3, Math.ceil(documentProxy.numPages / 2)].filter(
        (pageNumber) => pageNumber >= 1 && pageNumber <= documentProxy.numPages,
      ),
    ),
  );
  for (const pageNumber of pageNumbers) {
    if (pdfDocument !== documentProxy)
      throw new Error("PDF 已切换，请重新识别。");
    const text = await extractPageText(documentProxy, pageNumber).catch(
      () => "",
    );
    if (text) pages.push(`[第 ${pageNumber} 页]\n${text.slice(0, 7000)}`);
  }
  const outline = (await documentProxy
    .getOutline()
    .catch(() => null)) as Array<{ title?: string; items?: unknown[] }> | null;
  return {
    sampleText: pages.join("\n\n").slice(0, 24000),
    outlineTitles: collectOutlineTitles(outline).slice(0, 80),
  };
}

async function detectReadingMode(force = false): Promise<void> {
  const documentAtStart = pdfDocument;
  if (!documentAtStart || readingModeDetectionPending) return;
  if (!aiConfigLoaded) await loadDeepSeekConfig();
  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent =
      "“AI 自动识别阅读模式”需要 API Key；也可以先手动选择阅读模式。";
    readingModeError = "自动识别需配置 API Key";
    updateReadingModeUi();
    return;
  }
  if (!force && readingModePreference !== "auto") return;

  readingModeDetectionPending = true;
  readingModeError = "";
  updateReadingModeUi();
  try {
    const { sampleText, outlineTitles } =
      await buildReadingModeSample(documentAtStart);
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-detect-reading-mode",
      documentName: getDisplayFileName(sourceName),
      sampleText,
      outlineTitles,
    })) as AiRuntimeResponse;
    if (pdfDocument !== documentAtStart) return;
    if (!response?.ok || !response.readingMode) {
      throw new Error(response?.error || "没有收到有效的阅读模式识别结果。");
    }
    readingModePreference = "auto";
    resolvedReadingMode = response.readingMode;
    readingModeRationale = response.rationale || "";
    await persistReadingMode({
      preference: "auto",
      resolved: response.readingMode,
      source: "ai",
      rationale: response.rationale,
      updatedAt: Date.now(),
    });
  } catch (error) {
    readingModeError = `识别失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    readingModeDetectionPending = false;
    updateReadingModeUi();
  }
}

async function loadReadingModeForDocument(
  documentProxy: PDFDocumentProxy,
): Promise<void> {
  readingModeDocumentKey = getReadingModeDocumentKey(documentProxy);
  readingModePreference = "auto";
  resolvedReadingMode = "general";
  readingModeRationale = "";
  readingModeError = "";
  const modes = await readReadingModeStore();
  if (pdfDocument !== documentProxy) return;
  const saved = modes[readingModeDocumentKey];
  if (saved && isReadingModePreference(saved.preference)) {
    readingModePreference = saved.preference;
    resolvedReadingMode = saved.resolved || "general";
    readingModeRationale = saved.rationale || "";
    updateReadingModeUi();
    if (saved.preference !== "auto" || saved.source === "ai") return;
  }
  updateReadingModeUi();
  await detectReadingMode(false);
}

async function setReadingModePreference(
  preference: ReadingModePreference,
): Promise<void> {
  readingModePreference = preference;
  readingModeError = "";
  readingModeRationale = "";
  if (preference === "auto") {
    updateReadingModeUi();
    await detectReadingMode(true);
    return;
  }
  resolvedReadingMode = preference;
  await persistReadingMode({
    preference,
    resolved: preference,
    source: "manual",
    updatedAt: Date.now(),
  });
  updateReadingModeUi();
}

async function sendChatMessage(): Promise<void> {
  const content = chatInput.value.trim();
  const requestImages = pendingChatImages.map((image) => ({ ...image }));
  const userPrompt =
    content || (requestImages.length ? "请直接分析这些截图中的内容。" : "");
  if (!userPrompt || chatRequestPending) return;

  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent = "先配置并保存 API Key，之后即可聊天。";
    return;
  }
  if (requestImages.length > 0 && !isVisionAiConfigured(visionAiConfig)) {
    setDeepSeekSettingsOpen(true);
    visionSettingsStatus.classList.add("error");
    visionSettingsStatus.textContent = "发送截图前，请先启用并配置视觉模型。";
    return;
  }

  chatRequestPending = true;
  const documentAtRequestStart = pdfDocument;
  const documentNameAtRequestStart = sourceName;
  chatInput.value = "";
  clearPendingChatImages();
  chatInput.disabled = true;
  chatImageButton.disabled = true;
  chatSendButton.disabled = true;
  clearChatButton.disabled = true;
  chatHistory.push({
    role: "user",
    content: userPrompt,
    images: requestImages,
  });
  appendChatMessage("user", userPrompt, { images: requestImages });
  void queueChatConversationPersistence(documentAtRequestStart);
  const assistantMessage = appendChatMessage("assistant", "", {
    pending: true,
  });
  updateChatActivity(
    assistantMessage,
    "context",
    requestImages.length > 0
      ? "正在准备截图分析"
      : documentAtRequestStart
        ? "正在准备 Agent 文档检索"
        : "正在准备对话上下文",
    "active",
  );
  let streamedContent = "";
  let streamedReasoningContent = "";
  let renderFrame = 0;
  let modelActivityStarted = false;
  let immediateMemoryResult: ImmediateMemoryWriteResult = {
    stored: [],
    contextText: "",
    completedTools: [],
  };

  const flushStreamedContent = (): void => {
    renderFrame = 0;
    updateChatReasoning(assistantMessage, streamedReasoningContent, true);
    updateChatMessage(assistantMessage, streamedContent, { streaming: true });
  };

  try {
    immediateMemoryResult = await persistImmediateExplicitMemories(
      userPrompt,
      documentAtRequestStart,
      assistantMessage,
    );
    const pageNumber = Math.max(
      1,
      selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
    );
    const longTermMemoryPromise = loadLongTermMemoryContext(
      documentAtRequestStart,
    );
    const knowledgeAgentPromise = runKnowledgeAgentTools(
      userPrompt,
      documentAtRequestStart,
      assistantMessage,
    );
    const agentEvidencePromise = documentAtRequestStart
      ? buildAgentEvidence(
        userPrompt,
        documentAtRequestStart,
        pageNumber,
        requestImages.length === 0 ? selectedTextForAi : "",
        requestImages.length > 0,
        assistantMessage,
      )
      : Promise.resolve(null);
    const preparedChatHistoryPromise = prepareChatRequestHistory(
      assistantMessage,
      documentAtRequestStart,
    );

    const visionContext = {
      documentName: documentNameAtRequestStart
        ? getDisplayFileName(documentNameAtRequestStart)
        : undefined,
      pageNumber,
      totalPages: documentAtRequestStart?.numPages,
      readingMode: documentAtRequestStart
        ? ("paper" as const)
        : resolvedReadingMode,
    };
    const visionTasks = requestImages.map(async (attachment, index) => {
      const activityKey = `vision-${attachment.id}`;
      updateChatActivity(
        assistantMessage,
        activityKey,
        `Agent 正在调用工具 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
        "active",
        attachment.name,
      );
      console.info("[PDF Helper 工具调用] analyze_screenshot", {
        index: index + 1,
        name: attachment.name,
        width: attachment.width,
        height: attachment.height,
        execution: "parallel",
      });
      try {
        const analysis = await inspectChatImageWithVision(
          attachment,
          userPrompt,
          visionContext,
        );
        console.info("[PDF Helper 工具结果] analyze_screenshot", {
          index: index + 1,
          name: attachment.name,
          analysis,
        });
        updateChatActivity(
          assistantMessage,
          activityKey,
          `Agent 已完成 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
          "done",
          attachment.name,
        );
        return `[截图 ${index + 1}：${attachment.name}]\n${analysis}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateChatActivity(
          assistantMessage,
          activityKey,
          `Agent 工具失败 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
          "error",
          message,
        );
        console.error("[PDF Helper 工具失败] analyze_screenshot", {
          index: index + 1,
          name: attachment.name,
          error,
        });
        throw error;
      }
    });
    // 文档工具规划、截图分析、会话压缩和长期记忆读取互不依赖，全部并行执行。
    const [visionResults, agentEvidence, preparedChatHistory, longTermMemoryContext, knowledgeAgentResult] = await Promise.all([
      Promise.allSettled(visionTasks),
      agentEvidencePromise,
      preparedChatHistoryPromise,
      longTermMemoryPromise,
      knowledgeAgentPromise,
    ]);
    if (pdfDocument !== documentAtRequestStart) {
      throw new Error("PDF 已切换，请在新文档中重新发送问题。");
    }
    const visionFailures = visionResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (visionFailures.length > 0) {
      const firstReason = visionFailures[0]?.reason;
      throw new Error(
        `${visionFailures.length} 张截图分析失败：${firstReason instanceof Error ? firstReason.message : String(firstReason)}`,
      );
    }
    const imageAnalyses = visionResults.map(
      (result) => (result as PromiseFulfilledResult<string>).value,
    );

    updateChatActivity(
      assistantMessage,
      "context",
      requestImages.length > 0
        ? "截图与 Agent 证据已准备"
        : documentAtRequestStart
          ? "Agent 文档证据已准备"
          : "对话上下文已准备",
      "done",
      agentEvidence?.sourcePages.length
        ? `证据页：${agentEvidence.sourcePages.join("、")}`
        : "",
    );
    const requestHistory = preparedChatHistory.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    if (imageAnalyses.length > 0) {
      const lastUserMessage = requestHistory.at(-1);
      if (lastUserMessage?.role === "user") {
        lastUserMessage.content = [
          userPrompt,
          "本轮附带了用户截图。“这部分/这里/这个/图里”均指截图，不是当前 PDF 页面。",
          "必须先直接分析截图中实际展示的内容，再结合论文全文补充背景、术语或上下文。",
          "禁止跳过截图分析，直接改为总结当前 PDF 页面或整篇论文。",
        ].join("\n\n");
      }
    }

    updateChatActivity(
      assistantMessage,
      "model",
      aiConfig.reasoning === "enabled"
        ? "主模型正在思考"
        : "主模型正在生成回答",
      "active",
      aiConfig.model,
    );
    modelActivityStarted = true;
    const response = await requestAiStream(
      requestHistory,
      {
        documentName: documentNameAtRequestStart
          ? getDisplayFileName(documentNameAtRequestStart)
          : undefined,
        pageNumber,
        totalPages: documentAtRequestStart?.numPages,
        agentEvidence: agentEvidence?.text || undefined,
        sourceScope: agentEvidence ? "document" : undefined,
        sourceLabel: agentEvidence ? "Agent 按需检索证据" : undefined,
        sourcePages: agentEvidence?.sourcePages,
        contextNote: agentEvidence
          ? `文档内容由 Agent 经过 ${agentEvidence.planningRounds} 轮规划、按需调用工具获得；未向本轮模型注入整篇 PDF。`
          : undefined,
        selectedText:
          requestImages.length === 0
            ? selectedTextForAi || undefined
            : undefined,
        imageAnalysis: imageAnalyses.join("\n\n") || undefined,
        conversationSummary: preparedChatHistory.summary,
        longTermMemory: longTermMemoryContext.text || undefined,
        memoryOperationResult: [
          immediateMemoryResult.contextText,
          knowledgeAgentResult.contextText,
        ].filter(Boolean).join("\n\n") || undefined,
        completedTools: [
          ...immediateMemoryResult.completedTools,
          ...knowledgeAgentResult.completedTools,
          ...(agentEvidence?.toolResults.map((tool) => ({
            name: tool.name,
            arguments: { pages: tool.pages, label: tool.label },
          })) ?? []),
        ],
        readingMode: documentAtRequestStart ? "paper" : resolvedReadingMode,
      },
      (delta) => {
        if (delta.content) streamedContent += delta.content;
        if (delta.reasoningContent)
          streamedReasoningContent += delta.reasoningContent;
        if (delta.toolCalls?.length) {
          for (const call of delta.toolCalls) {
            updateChatActivity(
              assistantMessage,
              `native-tool-${call.id}`,
              `Agent 正在调用工具 · ${getAgentToolDefinitionByApiName(call.name)?.label ?? call.name}`,
              "active",
              call.name,
            );
          }
          updateChatActivity(
            assistantMessage,
            "model",
            "Agent 正在等待工具结果",
            "active",
            aiConfig.model,
          );
        }
        if (delta.toolResults?.length) {
          for (const result of delta.toolResults) {
            updateChatActivity(
              assistantMessage,
              `native-tool-${result.toolCallId}`,
              result.ok ? `工具已完成 · ${result.name}` : `工具失败 · ${result.name}`,
              result.ok ? "done" : "error",
              result.ok ? "" : result.content.slice(0, 160),
            );
          }
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型继续生成回答",
            "active",
            aiConfig.model,
          );
        }
        if (delta.content) {
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型正在生成回答",
            "active",
            aiConfig.model,
          );
        } else if (delta.reasoningContent && modelActivityStarted) {
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型正在思考",
            "active",
            aiConfig.model,
          );
        }
        if (!renderFrame)
          renderFrame = window.requestAnimationFrame(flushStreamedContent);
      },
    );

    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    updateChatActivity(
      assistantMessage,
      "model",
      "回答生成完成",
      "done",
      aiConfig.model,
    );
    const rawModelContent = response.content;
    streamedContent = await validatePdfCitations(
      rawModelContent,
      documentAtRequestStart,
    );
    streamedReasoningContent = response.reasoningContent;
    if (!streamedContent.trim()) {
      throw new Error(
        streamedReasoningContent.trim()
          ? `模型只返回了思考过程，没有返回最终回答（已收到思考 ${streamedReasoningContent.length} 字符）。`
          : "模型流已结束，但没有返回正文或思考内容。",
      );
    }
    const completeInteractionLog = {
      requestId: response.requestId,
      requestMessages: response.requestMessages,
      reasoningContent: streamedReasoningContent,
      rawAssistantResponse: rawModelContent,
      finalAssistantResponse: streamedContent,
    };
    console.groupCollapsed(
      `[PDF Helper AI] 本轮最终完整交互 · ${response.requestId}`,
    );
    console.log("实际发送给模型的全部上下文", response.requestMessages);
    console.log(
      "思考过程\n",
      streamedReasoningContent || "本轮没有返回思考过程",
    );
    console.log("模型原始回答\n", rawModelContent);
    console.log("引用校验后的最终回答\n", streamedContent);
    console.log(
      "本轮完整交互 JSON（可直接复制）\n",
      JSON.stringify(completeInteractionLog, null, 2),
    );
    console.groupEnd();

    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(assistantMessage, streamedContent, { streaming: false });
    chatHistory.push({ role: "assistant", content: streamedContent });
    void queueChatConversationPersistence(documentAtRequestStart);
    if (immediateMemoryResult.stored.length === 0) {
      void extractAndStoreLongTermMemories(
        userPrompt,
        streamedContent,
        documentAtRequestStart,
        documentNameAtRequestStart,
        response.requestId,
        assistantMessage,
      );
    }
    attachChatSaveAction(
      assistantMessage,
      userPrompt,
      streamedContent,
      documentNameAtRequestStart
        ? getDisplayFileName(documentNameAtRequestStart)
        : "未关联文档",
      pageNumber,
    );
  } catch (error) {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    const failure = error as Error & {
      requestId?: string;
      details?: unknown;
    };
    console.groupCollapsed(
      `[PDF Helper AI] 本轮交互失败 · ${failure.requestId ?? "未知请求"}`,
    );
    console.error("异常", error);
    console.log("模型配置（不包含 API Key）", {
      provider: aiConfig.providerId,
      model: aiConfig.model,
      baseUrl: aiConfig.baseUrl,
      reasoning: aiConfig.reasoning,
      maxOutputTokens: aiConfig.maxOutputTokens,
    });
    console.log("供应商/流式诊断", failure.details ?? "没有额外诊断信息");
    console.log("失败前接收长度", {
      contentLength: streamedContent.length,
      reasoningLength: streamedReasoningContent.length,
    });
    console.groupEnd();
    const failureMessage =
      error instanceof Error ? error.message : String(error);
    failActiveChatActivities(
      assistantMessage,
      `${failureMessage.slice(0, 180)}${failureMessage.length > 180 ? "…" : ""}`,
    );
    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(
      assistantMessage,
      `请求失败：${failureMessage}`,
      { error: true },
    );
  } finally {
    chatRequestPending = false;
    chatInput.disabled = false;
    chatImageButton.disabled = false;
    chatSendButton.disabled = false;
    clearChatButton.disabled = false;
    chatInput.focus();
  }
}

function setTranslationState(message: string, isError = false): void {
  translationResultElement.textContent = message;
  translationResultElement.classList.toggle("error", isError);
}

function setTranslationLearningTitle(title: string): void {
  translationLearningTitleElement.textContent = "2. " + title;
}

function setMoreExamplesButtonVisible(visible: boolean): void {
  generateMoreExamplesButton.hidden = !visible;
  generateMoreExamplesButton.disabled = false;
  generateMoreExamplesButton.textContent = "生成更多例句";
}

function createLearningElement<T extends keyof HTMLElementTagNameMap>(
  tagName: T,
  className: string,
  text = "",
): HTMLElementTagNameMap[T] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function readLearningString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readLearningArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeLearningInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const ENGLISH_WORD_SELECTION_PATTERN =
  /^[\p{L}]+(?:[’'-][\p{L}]+)*$/u;

function getSelectedEnglishWord(text: string): string {
  const candidate = text
    .trim()
    .replace(/^[“”"'([{<\s]+|[”"'!?,.;:)\]}>，。！？；：\s]+$/g, "");
  return ENGLISH_WORD_SELECTION_PATTERN.test(candidate) ? candidate : "";
}

interface EnglishWordSelection {
  word: string;
  wasExpanded: boolean;
}

function getRangeBoundaryTextNode(
  container: Node,
  offset: number,
  preferStart: boolean,
): { node: Text; offset: number } | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const node = container as Text;
    return { node, offset: Math.max(0, Math.min(offset, node.data.length)) };
  }

  const children = Array.from(container.childNodes);
  const child = preferStart
    ? children[Math.min(offset, Math.max(0, children.length - 1))]
    : children[Math.max(0, Math.min(offset - 1, children.length - 1))];
  if (!child) return null;

  let current: Node = child;
  while (current.childNodes.length) {
    current = preferStart
      ? current.childNodes[0]!
      : current.childNodes[current.childNodes.length - 1]!;
  }
  if (current.nodeType !== Node.TEXT_NODE) return null;

  const node = current as Text;
  return { node, offset: preferStart ? 0 : node.data.length };
}

function getEnglishWordSelection(text: string): EnglishWordSelection | null {
  const selectedWord = getSelectedEnglishWord(text);
  if (!selectedWord) return null;

  let word = selectedWord;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rawSelectedText =
      getSelectionSurroundingText().selected || selection.toString();
    const selectionStartsInsideWord = /^[\p{L}\p{M}’'-]/u.test(
      rawSelectedText,
    );
    const selectionEndsInsideWord = /[\p{L}\p{M}’'-]$/u.test(
      rawSelectedText,
    );

    // Complete a fragment only inside the exact text nodes where the drag
    // started and ended. Never cross into a neighbouring PDF.js span: those
    // spans may be visually separated words even when Range#toString omits the
    // space (the previous `data` -> `dataand` bug). A selected boundary space
    // is also authoritative: if the user included it, the word ended there.
    const startNode = range.startContainer instanceof Text
      ? range.startContainer
      : null;
    const endNode = range.endContainer instanceof Text
      ? range.endContainer
      : null;
    const prefix = startNode && selectionStartsInsideWord
      ? startNode.data
          .slice(0, range.startOffset)
          .match(/[\p{L}\p{M}’'-]+$/u)?.[0] ?? ""
      : "";
    const suffix = endNode && selectionEndsInsideWord
      ? endNode.data
          .slice(range.endOffset)
          .match(/^[\p{L}\p{M}’'-]+/u)?.[0] ?? ""
      : "";
    const completedWord = `${prefix}${selectedWord}${suffix}`;
    if (ENGLISH_WORD_SELECTION_PATTERN.test(completedWord)) {
      word = completedWord;
    }
  }

  return {
    word,
    wasExpanded: normalizeLearningInlineText(text) !== word,
  };
}

function getSelectionSurroundingText(): {
  before: string;
  selected: string;
  after: string;
} {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return { before: "", selected: "", after: "" };

  const range = selection.getRangeAt(0);
  const anchorElement =
    selection.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentElement
      : (selection.anchorNode as Element | null);
  const textLayer = anchorElement?.closest<HTMLElement>(".textLayer");
  if (!textLayer || !textLayer.contains(range.startContainer)) {
    return { before: "", selected: selection.toString(), after: "" };
  }

  const start = getRangeBoundaryTextNode(range.startContainer, range.startOffset, true);
  const end = getRangeBoundaryTextNode(range.endContainer, range.endOffset, false);
  if (!start || !end) {
    return { before: "", selected: selection.toString(), after: "" };
  }

  // Range#toString concatenates adjacent PDF.js spans without their visual
  // spacing. Rebuild the text layer with separators so the source sentence is
  // faithful to what the reader sees on the page.
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  const starts = new Map<Text, number>();
  let combined = "";
  nodes.forEach((node, index) => {
    if (index > 0) {
      const previousElement = nodes[index - 1]?.parentElement;
      const currentElement = node.parentElement;
      const previousRect = previousElement?.getBoundingClientRect();
      const currentRect = currentElement?.getBoundingClientRect();
      const changedLine = Boolean(
        previousRect
        && currentRect
        && Math.abs(currentRect.top - previousRect.top)
          > Math.max(2, Math.min(previousRect.height, currentRect.height) * 0.45),
      );
      const alreadyHasWhitespace = Boolean(
        /\s$/u.test(nodes[index - 1]?.data ?? "")
        || /^\s/u.test(node.data),
      );
      const visualWordGap = Boolean(
        previousRect
        && currentRect
        && currentRect.left - previousRect.right
          > Math.max(
            0.75,
            Math.min(previousRect.height, currentRect.height) * 0.06,
          ),
      );
      combined += changedLine
        ? "\n"
        : alreadyHasWhitespace
          ? ""
          : visualWordGap
            ? " "
            : "";
    }
    starts.set(node, combined.length);
    combined += node.data;
  });
  if (!starts.has(start.node) || !starts.has(end.node)) {
    return { before: "", selected: selection.toString(), after: "" };
  }
  const startIndex = (starts.get(start.node) ?? 0) + start.offset;
  const endIndex = (starts.get(end.node) ?? startIndex) + end.offset;
  return {
    before: combined.slice(0, startIndex),
    selected: combined.slice(startIndex, endIndex),
    after: combined.slice(endIndex),
  };
}

function normalizeSelectionContextFragment(value: string): string {
  if (!value) return "";
  const hadLeadingWhitespace = /^\s/u.test(value);
  const hadTrailingWhitespace = /\s$/u.test(value);
  const normalized = normalizeCopiedText(value).replace(/\s+/g, " ");
  if (!normalized) return hadLeadingWhitespace || hadTrailingWhitespace ? " " : "";
  return `${hadLeadingWhitespace ? " " : ""}${normalized}${hadTrailingWhitespace ? " " : ""}`;
}

function getSelectionSentenceContext(selectedText: string): string {
  const { before, selected: reconstructedSelection, after } =
    getSelectionSurroundingText();
  if (!before && !after) return selectedText;

  const liveSelectionText = reconstructedSelection
    || window.getSelection()?.toString()
    || selectedText;
  const beforeText = normalizeSelectionContextFragment(before);
  const selected = normalizeSelectionContextFragment(liveSelectionText);
  const afterText = normalizeSelectionContextFragment(after);
  const combined = beforeText + selected + afterText;
  const selectionStart = beforeText.length;
  const punctuationStart = Math.max(
    0,
    combined.lastIndexOf(".", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("!", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("?", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("。", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("！", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("？", Math.max(0, selectionStart - 1)) + 1,
  );
  const sentenceStart = Math.max(
    punctuationStart,
    selectionStart - 520,
  );
  const afterSelection = combined.slice(selectionStart + selected.length);
  const sentenceEndMatch = afterSelection.match(/[.!?。！？](?:\s|$)/);
  const sentenceEnd = sentenceEndMatch?.index === undefined
    ? Math.min(combined.length, selectionStart + selected.length + 520)
    : selectionStart + selected.length + sentenceEndMatch.index + 1;
  const sentence = normalizeCopiedText(
    combined.slice(sentenceStart, sentenceEnd),
  ).replace(/\s+/g, " ").trim();
  return sentence.length >= selected.length ? sentence : selectedText;
}

function getTranslationScopeFromSelection(
  selectedText: string,
  sentenceContext: string,
): string {
  const selected = normalizeLearningInlineText(selectedText);
  const context = normalizeLearningInlineText(sentenceContext);
  if (!selected || !context || context.length <= selected.length) return selected;

  const terminalMarks = selected.match(/[.!?。！？]/g)?.length ?? 0;
  const endsAtSentenceBoundary = /[.!?。！？]["'”’）)\]]*$/.test(selected);
  const isLongOrMultiSentenceSelection = selected.length > 360
    || terminalMarks >= 2
    || (terminalMarks >= 1 && endsAtSentenceBoundary);
  if (isLongOrMultiSentenceSelection) return selected;

  // Only repair a genuinely short, cut-off sentence. Large expansions usually
  // mean the PDF text layer crossed a heading, column or paragraph boundary.
  const expansionIsPlausible = context.length <= 700
    && context.length - selected.length <= 420
    && context.length <= selected.length * 3 + 180;
  return expansionIsPlausible ? context : selected;
}

function autoResizeTranslationTextarea(
  textarea: HTMLTextAreaElement,
): void {
  const resize = (): void => {
    textarea.style.height = "auto";
    const borderHeight = Math.max(
      0,
      textarea.offsetHeight - textarea.clientHeight,
    );
    const minimumHeight = textarea === selectedSnippetElement ? 58 : 44;
    textarea.style.height = `${Math.max(
      minimumHeight,
      Math.ceil(textarea.scrollHeight + borderHeight + 10),
    )}px`;
    textarea.scrollTop = 0;
  };

  resize();
  // Fonts and the right-panel width can settle one frame after content is
  // assigned. Re-measure then so the final one or two lines are never clipped.
  requestAnimationFrame(resize);
}

function containsLatexMath(value: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\)|\\(?:frac|sum|prod|int|sqrt|log|alpha|beta|gamma|lambda|sigma|mathbf|mathbb|mathrm)\b|[_^]\{/.test(
    value,
  );
}

function renderTranslationMathPreview(
  container: HTMLElement,
  value: string,
): void {
  const text = value.trim();
  container.hidden = !containsLatexMath(text);
  if (container.hidden) {
    container.replaceChildren();
    return;
  }
  const hasDelimiter = /\$|\\\[|\\\(/.test(text);
  renderChatMarkdown(
    container,
    hasDelimiter ? text : `$$${text}$$`,
    false,
  );
}

function renderLearningRichText(
  element: HTMLElement,
  value: string,
): HTMLElement {
  renderChatMarkdown(element, value, false);
  return element;
}

function setTranslationSelectionEditor(
  text: string,
  sourceSentence = "",
  sourceSentenceTranslation = "",
): void {
  const normalizedText = normalizeCopiedText(text);
  const normalizedSourceSentence = normalizeLearningInlineText(
    sourceSentence || normalizedText,
  );
  selectedSnippetElement.value = normalizedText;
  selectedSnippetElement.removeAttribute("title");
  autoResizeTranslationTextarea(selectedSnippetElement);
  renderTranslationMathPreview(selectedSnippetMathPreview, normalizedText);
  const isWord = Boolean(getSelectedEnglishWord(normalizedText));
  translationSourceSentenceField.hidden = !isWord;
  translationSourceSentenceInput.value = isWord
    ? normalizedSourceSentence
    : "";
  autoResizeTranslationTextarea(translationSourceSentenceInput);
  renderTranslationMathPreview(
    translationSourceSentenceMathPreview,
    translationSourceSentenceInput.value,
  );
  renderLearningRichText(
    translationSourceSentenceTranslation,
    sourceSentenceTranslation || "查询后显示原句的完整翻译",
  );
  currentEnglishLearningSourceSentence = normalizedSourceSentence;
  applyTranslationEditButton.disabled = !normalizedText;
}

function markTranslationEditorChanged(): void {
  const text = normalizeCopiedText(selectedSnippetElement.value);
  autoResizeTranslationTextarea(selectedSnippetElement);
  renderTranslationMathPreview(selectedSnippetMathPreview, text);
  const isWord = Boolean(getSelectedEnglishWord(text));
  translationSourceSentenceField.hidden = !isWord;
  applyTranslationEditButton.disabled = !text;
}

function readVocabularyExamples(value: unknown): VocabularyExample[] {
  return readLearningArray(value)
    .map((example): VocabularyExample | null => {
      if (!example || typeof example !== "object") return null;
      const record = example as Record<string, unknown>;
      const sentence = readLearningString(record.sentence)
        || readLearningString(record.en);
      const translation = readLearningString(record.translation)
        || readLearningString(record.zh);
      if (!sentence || !translation) return null;
      return {
        sentence,
        translation,
        usage: readLearningString(record.usage)
          || readLearningString(record.note)
          || "常见用法",
        source: record.source === "document" ? "document" : "generated",
      };
    })
    .filter((example): example is VocabularyExample => Boolean(example));
}

function parseVocabularyLearningResult(
  content: string,
  word: string,
  sentence: string,
): VocabularyLearningResult {
  const value = parseAiJson(content);
  const senses = readLearningArray(value.senses ?? value.partsOfSpeech)
    .map((item): VocabularySense | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = readLearningString(record.label)
        || readLearningString(record.partOfSpeech)
        || readLearningString(record.pos);
      const meaning = readLearningString(record.meaning)
        || readLearningString(record.definition)
        || readLearningString(record.translation);
      if (!label || !meaning) return null;
      return {
        label,
        meaning,
        definitionEn: readLearningString(record.definitionEn)
          || readLearningString(record.englishDefinition)
          || readLearningString(record.enDefinition),
      };
    })
    .filter((item): item is VocabularySense => Boolean(item));
  const forms = readLearningArray(value.forms)
    .map((item): VocabularyWordForm | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = readLearningString(record.label) || readLearningString(record.name);
      const form = readLearningString(record.value) || readLearningString(record.form);
      return label && form ? { label, value: form } : null;
    })
    .filter((item): item is VocabularyWordForm => Boolean(item));
  const sourceSentence = readLearningString(value.sourceSentenceLatex)
    || readLearningString(value.sourceSentence)
    || sentence;
  const sentenceTranslation = readLearningString(value.sentenceTranslation)
    || readLearningString(value.contextTranslation);
  const meaningInSentence = readLearningString(value.meaningInSentence)
    || readLearningString(value.contextMeaning);

  if (!meaningInSentence || !sentenceTranslation) {
    throw new Error("模型没有返回完整的单词学习结果。");
  }

  const generatedExamples = readVocabularyExamples(value.examples)
    .filter((example) =>
      normalizeLearningInlineText(example.sentence).toLocaleLowerCase()
        !== normalizeLearningInlineText(sourceSentence).toLocaleLowerCase(),
    )
    .slice(0, 3);

  return {
    kind: "word",
    // The viewer has already expanded the user's selection to a complete
    // lexical token. The model may classify its form, but must not reject it.
    selectionComplete: true,
    selectedWord: word,
    word: readLearningString(value.headword)
      || readLearningString(value.lemma)
      || readLearningString(value.word)
      || word,
    wordForm: readLearningString(value.wordForm)
      || readLearningString(value.inflection)
      || readLearningString(value.selectedFormType),
    namedEntityType: readLearningString(value.namedEntityType)
      || readLearningString(value.entityType),
    pronunciation: readLearningString(value.pronunciation)
      || readLearningString(value.phonetic),
    partsOfSpeech: senses.map(({ label, meaning }) => ({ label, meaning })),
    senses,
    forms,
    meaningInSentence,
    sentence: sourceSentence,
    sentenceTranslation,
    examples: generatedExamples,
  };
}

function parseSentenceLearningResult(
  content: string,
  sourceText: string,
): SentenceLearningResult {
  const value = parseAiJson(content);
  const translation = readLearningString(value.translation);
  if (!translation) throw new Error("模型没有返回句子翻译。");
  const keywords = readLearningArray(value.keywords)
    .map((item): SentenceKeyword | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const word = readLearningString(record.word);
      const partOfSpeech = readLearningString(record.partOfSpeech)
        || readLearningString(record.pos);
      const meaningInSentence = readLearningString(record.meaningInSentence)
        || readLearningString(record.meaning);
      if (!word || !partOfSpeech || !meaningInSentence) return null;
      return {
        word,
        partOfSpeech,
        meaningInSentence,
        reason: readLearningString(record.reason),
      };
    })
    .filter((item): item is SentenceKeyword => Boolean(item))
    .slice(0, 8);
  return {
    kind: "sentence",
    sourceText: readLearningString(value.sourceTextLatex)
      || readLearningString(value.sourceText)
      || sourceText,
    translation,
    keywords,
  };
}

function renderVocabularyLearningResult(result: VocabularyLearningResult): void {
  setTranslationLearningTitle("单词学习");
  translationLearningHintElement.textContent =
    "原句与完整翻译显示在上方；下方例句只用于扩展不同用法。";
  translationSourceSentenceField.hidden = false;
  translationSourceSentenceInput.value = result.sentence;
  autoResizeTranslationTextarea(translationSourceSentenceInput);
  renderTranslationMathPreview(
    translationSourceSentenceMathPreview,
    result.sentence,
  );
  renderLearningRichText(
    translationSourceSentenceTranslation,
    result.sentenceTranslation,
  );
  const card = createLearningElement("article", "english-learning-card word-card");
  const header = createLearningElement("div", "english-learning-header");
  const displayWord = result.selectedWord || result.word;
  const word = createLearningElement("strong", "english-learning-word", displayWord);
  header.append(word);
  if (result.pronunciation) {
    header.append(
      createLearningElement("span", "english-learning-pronunciation", result.pronunciation),
    );
  }
  card.append(header);

  const meta = createLearningElement("div", "english-learning-meta");
  if (result.word && result.word.toLocaleLowerCase() !== displayWord.toLocaleLowerCase()) {
    meta.append(createLearningElement("span", "english-learning-chip", `原形：${result.word}`));
  }
  if (result.wordForm) {
    meta.append(createLearningElement("span", "english-learning-chip", `当前词形：${result.wordForm}`));
  }
  if (result.namedEntityType) {
    meta.append(createLearningElement("span", "english-learning-chip", result.namedEntityType));
  }
  if (meta.childElementCount) card.append(meta);

  const meaning = createLearningElement("section", "english-learning-block");
  meaning.append(createLearningElement("h4", "english-learning-label", "文中含义"));
  meaning.append(
    renderLearningRichText(
      createLearningElement("div", "english-learning-context-meaning"),
      result.meaningInSentence,
    ),
  );
  if (result.partsOfSpeech.length) {
    const list = createLearningElement("dl", "english-pos-list");
    result.partsOfSpeech.forEach((part) => {
      const row = createLearningElement("div", "english-pos-row");
      row.append(
        createLearningElement("dt", "english-pos-tag", part.label),
        createLearningElement("dd", "english-pos-meaning", part.meaning),
      );
      list.append(row);
    });
    meaning.append(list);
  }
  card.append(meaning);

  const senses = createLearningElement("section", "english-learning-block");
  senses.append(createLearningElement("h4", "english-learning-label", "全部义项与英英释义"));
  const allSenses = result.senses.length
    ? result.senses
    : result.partsOfSpeech.map((part) => ({ ...part, definitionEn: "" }));
  if (!allSenses.length) {
    senses.append(createLearningElement("p", "english-learning-empty", "未返回可用义项。"));
  } else {
    const list = createLearningElement("div", "english-sense-list");
    allSenses.forEach((sense) => {
      const item = createLearningElement("article", "english-sense-card");
      const title = createLearningElement("div", "english-sense-title");
      title.append(
        createLearningElement("span", "english-pos-tag", sense.label),
        createLearningElement("strong", "english-sense-meaning", sense.meaning),
      );
      item.append(title);
      if (sense.definitionEn) {
        item.append(createLearningElement("p", "english-sense-definition", sense.definitionEn));
      }
      list.append(item);
    });
    senses.append(list);
  }
  card.append(senses);

  if (result.forms.length) {
    const forms = createLearningElement("section", "english-learning-block");
    forms.append(createLearningElement("h4", "english-learning-label", "词形变化"));
    const list = createLearningElement("div", "english-form-list");
    result.forms.forEach((form) => {
      const item = createLearningElement("span", "english-form-chip");
      item.append(
        createLearningElement("strong", "english-form-label", form.label),
        document.createTextNode(` ${form.value}`),
      );
      list.append(item);
    });
    forms.append(list);
    card.append(forms);
  }

  const examples = createLearningElement("section", "english-learning-block");
  examples.append(createLearningElement("h4", "english-learning-label", "例句"));
  result.examples.forEach((example, index) => {
    const item = createLearningElement("article", "english-example-card");
    const label = "例句 " + String(index + 1) + " · " + example.usage;
    item.append(createLearningElement("span", "english-example-label", label));
    item.append(
      renderLearningRichText(
        createLearningElement("div", "english-example-en"),
        example.sentence,
      ),
    );
    item.append(
      renderLearningRichText(
        createLearningElement("div", "english-example-zh"),
        example.translation,
      ),
    );
    examples.append(item);
  });
  card.append(examples);

  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(true);
}

function renderSentenceLearningResult(result: SentenceLearningResult): void {
  setTranslationLearningTitle("句子翻译");
  translationLearningHintElement.textContent =
    "已给出整句译文，并仅挑选值得学习的术语、学术表达或较难词汇。";
  if (result.sourceText) {
    renderTranslationMathPreview(
      selectedSnippetMathPreview,
      result.sourceText,
    );
  }
  const card = createLearningElement("article", "english-learning-card sentence-card");
  const translation = createLearningElement("section", "english-learning-block");
  translation.append(createLearningElement("h4", "english-learning-label", "中文翻译"));
  translation.append(
    renderLearningRichText(
      createLearningElement("div", "english-sentence-translation"),
      result.translation,
    ),
  );
  card.append(translation);

  const keywords = createLearningElement("section", "english-learning-block");
  keywords.append(
    createLearningElement(
      "h4",
      "english-learning-label",
      "重点单词",
    ),
  );
  if (!result.keywords.length) {
    keywords.append(
      createLearningElement("p", "english-learning-empty", "这句话以常用词为主，暂时没有需要额外记忆的难词。"),
    );
  } else {
    const list = createLearningElement("div", "english-keyword-list");
    result.keywords.forEach((keyword) => {
      const item = createLearningElement("article", "english-keyword-card");
      const title = createLearningElement("div", "english-keyword-title");
      title.append(
        createLearningElement("strong", "english-keyword-word", keyword.word),
        createLearningElement("span", "english-pos-tag", keyword.partOfSpeech),
      );
      item.append(title);
      item.append(
        renderLearningRichText(
          createLearningElement("div", "english-keyword-meaning"),
          keyword.meaningInSentence,
        ),
      );
      list.append(item);
    });
    keywords.append(list);
  }
  card.append(keywords);
  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(false);
}

function getEnglishLearningPlainText(): string {
  const result = currentEnglishLearningResult;
  if (!result) return "";

  if (result.kind === "sentence") {
    const keywordText = result.keywords.length
      ? result.keywords
          .map(
            (keyword) =>
              `- ${keyword.word}（${keyword.partOfSpeech}）：${keyword.meaningInSentence}`,
          )
          .join("\n")
      : "- 暂无需要额外记忆的难词";
    return ["中文翻译", result.translation, "", "重点词汇", keywordText].join("\n");
  }

  const partsOfSpeech = result.partsOfSpeech.length
    ? result.partsOfSpeech
        .map((part) => `- ${part.label}：${part.meaning}`)
        .join("\n")
    : "- 未返回词性释义";
  const examples = result.examples
    .map(
      (example, index) =>
        `例句 ${index + 1}（${example.usage}）\n${example.sentence}\n${example.translation}`,
    )
    .join("\n\n");
  return [
    `${result.word}${result.pronunciation ? ` ${result.pronunciation}` : ""}`,
    "",
    "文中原句",
    result.sentence,
    result.sentenceTranslation,
    "",
    "文中含义",
    result.meaningInSentence,
    "",
    "词性与释义",
    partsOfSpeech,
    "",
    "例句",
    examples,
  ].join("\n");
}

function getTranslationHistoryDocumentKey(): string {
  if (pdfDocument) return getDocumentChatId(pdfDocument);
  return `source:${sourceName || "untitled"}`;
}

function isStoredEnglishLearningResult(value: unknown): value is EnglishLearningResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "sentence") return typeof record.translation === "string";
  return record.kind === "word"
    && typeof record.word === "string"
    && typeof record.meaningInSentence === "string"
    && typeof record.sentence === "string";
}

function readTranslationHistoryEntries(value: unknown): TranslationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry): TranslationHistoryEntry | null => {
      if (
        typeof entry.id !== "string"
        || typeof entry.sourceText !== "string"
        || !isStoredEnglishLearningResult(entry.result)
      ) return null;
      const storedResult = entry.result;
      const result: EnglishLearningResult = storedResult.kind === "word"
        ? {
            ...storedResult,
            selectedWord:
              typeof storedResult.selectedWord === "string"
                ? storedResult.selectedWord
                : storedResult.word,
            wordForm:
              typeof storedResult.wordForm === "string"
                ? storedResult.wordForm
                : "",
            namedEntityType:
              typeof storedResult.namedEntityType === "string"
                ? storedResult.namedEntityType
                : "",
            partsOfSpeech: Array.isArray(storedResult.partsOfSpeech)
              ? storedResult.partsOfSpeech
              : [],
            senses: Array.isArray(storedResult.senses)
              ? storedResult.senses
              : [],
            forms: Array.isArray(storedResult.forms)
              ? storedResult.forms
              : [],
            examples: Array.isArray(storedResult.examples)
              ? storedResult.examples.filter(
                  (example) => example?.source !== "document",
                )
              : [],
          }
        : {
            ...storedResult,
            sourceText:
              typeof storedResult.sourceText === "string"
                ? storedResult.sourceText
                : entry.sourceText,
            keywords: Array.isArray(storedResult.keywords)
              ? storedResult.keywords
              : [],
          };
      return {
        id: entry.id,
        sourceText: entry.sourceText,
        pageNumber:
          typeof entry.pageNumber === "number" && Number.isFinite(entry.pageNumber)
            ? Math.max(1, entry.pageNumber)
            : 1,
        result,
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : 0,
      };
    })
    .filter((entry): entry is TranslationHistoryEntry => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_TRANSLATION_HISTORY_PER_DOCUMENT);
}

function getTranslationHistoryLabel(entry: TranslationHistoryEntry): string {
  if (entry.result.kind === "word") {
    return entry.result.selectedWord || entry.result.word || entry.sourceText;
  }
  return entry.sourceText.replace(/\s+/g, " ").trim().slice(0, 42);
}

function restoreTranslationHistoryEntry(entry: TranslationHistoryEntry): void {
  const restoredText = entry.result.kind === "word"
    ? entry.result.selectedWord || entry.result.word || entry.sourceText
    : entry.sourceText;
  selectedTextForAi = restoredText;
  selectedTextPageNumber = entry.pageNumber;
  lastTranslatedText = restoredText;
  currentEnglishLearningResult = entry.result;
  currentEnglishLearningSourceText = restoredText;
  setTranslationSelectionEditor(
    restoredText,
    entry.result.kind === "word" ? entry.result.sentence : "",
    entry.result.kind === "word" ? entry.result.sentenceTranslation : "",
  );
  if (entry.result.kind === "word") {
    renderVocabularyLearningResult(entry.result);
  } else {
    renderSentenceLearningResult(entry.result);
  }
}

function createTranslationHistoryRow(
  entry: TranslationHistoryEntry,
): HTMLElement {
  const row = createLearningElement("div", "translation-history-row");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "translation-history-item";
  const title = getTranslationHistoryLabel(entry);
  button.append(
    createLearningElement(
      "strong",
      "translation-history-item-title",
      entry.result.kind === "word" ? title : `句子 · ${title}`,
    ),
    createLearningElement(
      "span",
      "translation-history-item-meta",
      `第 ${entry.pageNumber} 页 · 点击恢复`,
    ),
  );
  button.addEventListener("click", () => {
    restoreTranslationHistoryEntry(entry);
    translationHistoryDialog.hidden = true;
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "translation-history-delete";
  deleteButton.textContent = "×";
  deleteButton.title = `删除“${title}”`;
  deleteButton.setAttribute("aria-label", `删除“${title}”`);
  deleteButton.addEventListener("click", () => {
    void deleteTranslationHistoryEntry(entry.id);
  });
  row.append(button, deleteButton);
  return row;
}

function getFilteredTranslationHistoryEntries(): TranslationHistoryEntry[] {
  const query = translationHistorySearchInput.value
    .toLocaleLowerCase("zh-CN")
    .trim();
  if (!query) return translationHistoryEntries;
  return translationHistoryEntries.filter((entry) =>
    `${entry.sourceText}\n${JSON.stringify(entry.result)}`
      .toLocaleLowerCase("zh-CN")
      .includes(query),
  );
}

function renderTranslationHistoryDialog(): void {
  const entries = getFilteredTranslationHistoryEntries();
  translationHistoryDialogCount.textContent = translationHistorySearchInput.value.trim()
    ? `${entries.length} / ${translationHistoryEntries.length} 条记录`
    : `${translationHistoryEntries.length} 条记录`;
  if (!entries.length) {
    translationHistoryDialogList.replaceChildren(
      createLearningElement(
        "p",
        "translation-history-empty",
        translationHistoryEntries.length
          ? "没有找到匹配的历史记录。"
          : "当前 PDF 还没有英语学习历史。",
      ),
    );
    return;
  }
  translationHistoryDialogList.replaceChildren(
    ...entries.map(createTranslationHistoryRow),
  );
}

function renderTranslationHistory(): void {
  translationHistoryCountElement.textContent = String(translationHistoryEntries.length);
  clearTranslationHistoryButton.hidden = translationHistoryEntries.length === 0;
  openTranslationHistoryButton.classList.toggle(
    "has-records",
    translationHistoryEntries.length > 0,
  );
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}

async function persistTranslationHistoryEntries(): Promise<void> {
  const stored = await browser.storage.local.get(TRANSLATION_HISTORY_STORAGE_KEY);
  const store = { ...(stored[TRANSLATION_HISTORY_STORAGE_KEY] ?? {}) } as TranslationHistoryStore;
  if (translationHistoryEntries.length) {
    store[translationHistoryDocumentKey] = translationHistoryEntries;
  } else {
    delete store[translationHistoryDocumentKey];
  }
  await browser.storage.local.set({ [TRANSLATION_HISTORY_STORAGE_KEY]: store });
}

async function deleteTranslationHistoryEntry(id: string): Promise<void> {
  translationHistoryEntries = translationHistoryEntries.filter(
    (entry) => entry.id !== id,
  );
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
  if (!translationHistoryDialog.hidden) renderTranslationHistoryDialog();
}

async function ensureTranslationHistoryLoaded(): Promise<void> {
  const documentKey = getTranslationHistoryDocumentKey();
  if (documentKey === translationHistoryDocumentKey) return;
  const stored = await browser.storage.local.get(TRANSLATION_HISTORY_STORAGE_KEY);
  const store = stored[TRANSLATION_HISTORY_STORAGE_KEY] as TranslationHistoryStore | undefined;
  translationHistoryDocumentKey = documentKey;
  translationHistoryEntries = readTranslationHistoryEntries(store?.[documentKey]);
  renderTranslationHistory();
}

async function storeTranslationHistoryResult(
  sourceText: string,
  result: EnglishLearningResult,
): Promise<void> {
  await ensureTranslationHistoryLoaded();
  const normalizedSource = sourceText.replace(/\s+/g, " ").trim();
  if (!normalizedSource) return;
  const id = `${result.kind}:${normalizedSource.toLocaleLowerCase()}`;
  const entry: TranslationHistoryEntry = {
    id,
    sourceText: normalizedSource,
    pageNumber: Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1),
    result,
    updatedAt: Date.now(),
  };
  translationHistoryEntries = [
    entry,
    ...translationHistoryEntries.filter((item) => item.id !== id),
  ].slice(0, MAX_TRANSLATION_HISTORY_PER_DOCUMENT);
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
}

async function clearCurrentTranslationHistory(): Promise<void> {
  await ensureTranslationHistoryLoaded();
  translationHistoryEntries = [];
  await persistTranslationHistoryEntries();
  renderTranslationHistory();
  setStatus("已清空当前 PDF 的英语学习历史。");
}

function setSummaryState(
  message: string,
  isError = false,
  clearPoints = true,
): void {
  if (clearPoints) lastSummaryPoints = [];
  summaryResultElement.textContent = message;
  summaryResultElement.classList.toggle("error", isError);
}

function renderSummaryPoints(points: string[]): void {
  const list = document.createElement("ul");

  for (const point of points) {
    const item = document.createElement("li");
    item.textContent = point;
    list.append(item);
  }

  lastSummaryPoints = points;
  summaryResultElement.replaceChildren(list);
  summaryResultElement.classList.remove("error");
}

function getOutlinePageItems(): Array<{ pageNumber: number; title: string }> {
  if (!outlineList) return [];

  return Array.from(
    outlineList.querySelectorAll<HTMLButtonElement>(
      "button[data-outline-page]",
    ),
  )
    .map((button) => ({
      pageNumber: Number(button.dataset.outlinePage),
      title: button.textContent?.trim() || "未命名章节",
    }))
    .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

function getCurrentChapterContext(pageNumber: number): {
  title: string;
  startPage: number;
  endPage: number;
} {
  const items = getOutlinePageItems();
  let currentItem: { pageNumber: number; title: string } | null = null;

  for (const item of items) {
    if (item.pageNumber > pageNumber) break;
    currentItem = item;
  }

  if (!currentItem) {
    return {
      title: `第 ${pageNumber} 页`,
      startPage: pageNumber,
      endPage: pageNumber,
    };
  }

  const nextItem = items.find(
    (item) => item.pageNumber > currentItem.pageNumber,
  );
  return {
    title: currentItem.title,
    startPage: currentItem.pageNumber,
    endPage: Math.max(
      currentItem.pageNumber,
      Math.min(
        pdfDocument?.numPages ?? pageNumber,
        (nextItem?.pageNumber ?? (pdfDocument?.numPages ?? pageNumber) + 1) - 1,
      ),
    ),
  };
}

function getSummaryLabels(scope: SummaryScope): Omit<SummaryContext, "text"> {
  const pageNumber = pdfDocument
    ? Math.max(1, pdfViewer.currentPageNumber || 1)
    : 0;
  const chapter =
    pageNumber > 0
      ? getCurrentChapterContext(pageNumber)
      : { title: "未定位", startPage: 0, endPage: 0 };

  if (scope === "chapter") {
    return {
      scope,
      rangeLabel: "当前章节",
      sourceLabel:
        chapter.startPage === chapter.endPage
          ? `第 ${chapter.startPage} 页`
          : `第 ${chapter.startPage}–${chapter.endPage} 页`,
      positionLabel: chapter.title,
    };
  }

  return {
    scope,
    rangeLabel: scope === "page" ? "当前页" : "当前选中文本",
    sourceLabel: pageNumber > 0 ? `第 ${pageNumber} 页` : "未打开 PDF",
    positionLabel: chapter.title,
  };
}

function updateSummaryMetadata(context?: Omit<SummaryContext, "text">): void {
  const metadata = context ?? getSummaryLabels(activeSummaryScope);
  summaryRangeElement.textContent = metadata.rangeLabel;
  summarySourceElement.textContent = metadata.sourceLabel;
  summaryPositionElement.textContent = metadata.positionLabel;
}

async function extractPageText(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const rawText = textContent.items
    .map((item) => {
      if (!("str" in item) || typeof item.str !== "string") return "";
      return `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`;
    })
    .join("");

  return normalizeCopiedText(rawText);
}

function normalizeCitationMatchText(value: string): string {
  return value
    .replace(
      /\\(?:mathbb|mathbf|mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\times\b/g, "×")
    .replace(/\\in\b/g, "∈")
    .replace(/\\lambda\b/g, "λ")
    .replace(/\\sigma\b/g, "σ")
    .replace(/[$\\{}_^]/g, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\u00ad/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "");
}

interface NormalizedCitationMatch {
  start: number;
  end: number;
  exact: boolean;
  confidence: number;
}

function findNormalizedCitationMatch(
  normalizedSource: string,
  normalizedQuote: string,
): NormalizedCitationMatch | null {
  if (!normalizedSource || normalizedQuote.length < 8) return null;
  const exactStart = normalizedSource.indexOf(normalizedQuote);
  if (exactStart >= 0) {
    return {
      start: exactStart,
      end: exactStart + normalizedQuote.length,
      exact: true,
      confidence: 1,
    };
  }

  // Long PDF passages commonly differ only around formulas, ligatures or
  // extraction order. Confirm several sizeable anchors in source order before
  // accepting the location; this avoids turning an unrelated page number into
  // a clickable citation while still locating the surrounding paragraph.
  if (normalizedQuote.length < 96) return null;
  const anchorLength = Math.min(
    72,
    Math.max(28, Math.floor(normalizedQuote.length / 9)),
  );
  const anchors: Array<{
    quoteStart: number;
    sourceStart: number;
    length: number;
  }> = [];
  let sourceCursor = 0;
  for (
    let quoteStart = 0;
    quoteStart + anchorLength <= normalizedQuote.length;
    quoteStart += anchorLength
  ) {
    const anchor = normalizedQuote.slice(quoteStart, quoteStart + anchorLength);
    const sourceStart = normalizedSource.indexOf(anchor, sourceCursor);
    if (sourceStart < 0) continue;
    anchors.push({ quoteStart, sourceStart, length: anchor.length });
    sourceCursor = sourceStart + anchor.length;
  }

  const matchedCharacters = anchors.reduce(
    (total, anchor) => total + anchor.length,
    0,
  );
  const confidence = matchedCharacters / normalizedQuote.length;
  if (anchors.length < 2 || confidence < 0.32) return null;
  const first = anchors[0];
  const last = anchors.at(-1);
  if (!first || !last) return null;
  const locatedSpan = last.sourceStart + last.length - first.sourceStart;
  if (locatedSpan > normalizedQuote.length * 1.65) return null;

  return {
    start: Math.max(0, first.sourceStart - first.quoteStart),
    end: Math.min(
      normalizedSource.length,
      last.sourceStart +
        last.length +
        normalizedQuote.length -
        last.quoteStart -
        last.length,
    ),
    exact: false,
    confidence,
  };
}

async function validatePdfCitations(
  content: string,
  documentProxy: PDFDocumentProxy | null,
): Promise<string> {
  const pattern = createPdfCitationPattern();
  const matches = Array.from(content.matchAll(pattern));
  const removeUnverifiableShorthand = (value: string): string =>
    value.replace(/\[?\[PDF:(?:P)?\d{1,5}\]?\]/gi, "");
  if (matches.length === 0) return removeUnverifiableShorthand(content);
  if (!documentProxy)
    return removeUnverifiableShorthand(content.replace(pattern, ""));

  const pageTextCache = new Map<number, string>();
  const parts: string[] = [];
  let cursor = 0;
  let previousValidCitation: {
    pageNumber: number;
    sourceStart: number;
    sourceEnd: number;
    contentEnd: number;
  } | null = null;
  for (const match of matches) {
    const start = match.index ?? 0;
    parts.push(content.slice(cursor, start));
    const pageNumber = Number(match[1]);
    const quote = match[2]?.replace(/\s+/g, " ").trim() ?? "";
    let valid =
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= documentProxy.numPages &&
      normalizeCitationMatchText(quote).length >= 8;

    let locatedMatch: NormalizedCitationMatch | null = null;
    if (valid) {
      if (!pageTextCache.has(pageNumber)) {
        const pageText = await extractPageText(documentProxy, pageNumber).catch(
          () => "",
        );
        pageTextCache.set(pageNumber, normalizeCitationMatchText(pageText));
      }
      locatedMatch = findNormalizedCitationMatch(
        pageTextCache.get(pageNumber) ?? "",
        normalizeCitationMatchText(quote),
      );
      valid = Boolean(locatedMatch);
    }

    const gapAfterPreviousCitation = previousValidCitation
      ? content.slice(previousValidCitation.contentEnd, start)
      : "";
    const citationsAreAdjacent = Boolean(previousValidCitation)
      && !/[\p{L}\p{N}]/u.test(gapAfterPreviousCitation);
    const overlappingSourceCharacters =
      previousValidCitation && locatedMatch
        ? Math.max(
          0,
          Math.min(previousValidCitation.sourceEnd, locatedMatch.end) -
            Math.max(previousValidCitation.sourceStart, locatedMatch.start),
        )
        : 0;
    const shorterSourceLength =
      previousValidCitation && locatedMatch
        ? Math.max(
          1,
          Math.min(
            previousValidCitation.sourceEnd - previousValidCitation.sourceStart,
            locatedMatch.end - locatedMatch.start,
          ),
        )
        : 1;
    const isDuplicateAdjacentCitation = Boolean(
      valid &&
      locatedMatch &&
      previousValidCitation &&
      citationsAreAdjacent &&
      previousValidCitation.pageNumber === pageNumber &&
      overlappingSourceCharacters / shorterSourceLength >= 0.6,
    );

    if (valid && !isDuplicateAdjacentCitation) {
      parts.push(match[0]);
      previousValidCitation = {
        pageNumber,
        sourceStart: locatedMatch?.start ?? 0,
        sourceEnd: locatedMatch?.end ?? 0,
        contentEnd: start + match[0].length,
      };
    } else if (isDuplicateAdjacentCitation) {
      console.info("[PDF Helper 引用校验] 已合并相邻的重复原文引用", {
        pageNumber,
        quote,
        overlapRatio: overlappingSourceCharacters / shorterSourceLength,
      });
    } else {
      console.warn("[PDF Helper 引用校验] 已移除无法匹配原文的引用", {
        pageNumber,
        quote,
      });
    }
    cursor = start + match[0].length;
  }
  parts.push(content.slice(cursor));
  return removeUnverifiableShorthand(parts.join(""));
}

interface CitationTextPoint {
  node: Text;
  offset: number;
}

let activeChatCitationHighlight: HTMLElement | null = null;
let activeChatCitationHighlightTimer: number | undefined;

function clearChatCitationHighlight(): void {
  activeChatCitationHighlight?.remove();
  activeChatCitationHighlight = null;
  if (activeChatCitationHighlightTimer !== undefined) {
    window.clearTimeout(activeChatCitationHighlightTimer);
    activeChatCitationHighlightTimer = undefined;
  }
}

async function waitForCitationTextLayer(
  pageNumber: number,
): Promise<HTMLElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 4000) {
    const layer = viewerElement.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .textLayer`,
    );
    if (layer?.textContent?.trim()) return layer;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }
  return null;
}

function findCitationRange(
  textLayer: HTMLElement,
  quote: string,
): {
  range: Range;
  match: NormalizedCitationMatch;
} | null {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const points: CitationTextPoint[] = [];
  let normalizedText = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      const normalized = normalizeCitationMatchText(value[offset] ?? "");
      for (const character of normalized) {
        normalizedText += character;
        points.push({ node, offset });
      }
    }
  }

  const match = findNormalizedCitationMatch(
    normalizedText,
    normalizeCitationMatchText(quote),
  );
  if (!match || match.end <= match.start) return null;
  const startPoint = points[match.start];
  const endPoint = points[match.end - 1];
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(
    endPoint.node,
    Math.min(endPoint.offset + 1, endPoint.node.length),
  );
  return { range, match };
}

function highlightCitationRanges(textLayer: HTMLElement, ranges: Range[]): void {
  const page = textLayer.closest<HTMLElement>(".pdfViewer .page");
  if (!page) return;
  const pageRect = page.getBoundingClientRect();
  const rects = mergeSelectionRects(
    ranges.flatMap((range) =>
      Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })),
    ),
  );
  if (rects.length === 0) return;

  clearChatCitationHighlight();
  const layer = document.createElement("div");
  layer.className = "pdf-ai-citation-highlight-layer";
  for (const rect of rects) {
    const highlight = document.createElement("div");
    highlight.className = "pdf-ai-citation-highlight";
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${rect.right - rect.left}px`;
    highlight.style.height = `${rect.bottom - rect.top}px`;
    layer.append(highlight);
  }
  page.append(layer);
  activeChatCitationHighlight = layer;
  activeChatCitationHighlightTimer = window.setTimeout(
    clearChatCitationHighlight,
    10000,
  );
}

async function jumpToPdfCitations(
  pageNumber: number,
  quotes: string[],
): Promise<void> {
  const normalizedQuotes = quotes.map((quote) => quote.trim()).filter(Boolean);
  if (
    !pdfDocument ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pdfDocument.numPages ||
    normalizedQuotes.length === 0
  ) {
    return;
  }

  console.info("[PDF Helper 引用定位] 开始查找原文", {
    pageNumber,
    citedQuotes: normalizedQuotes,
  });
  citationReturnButton.classList.remove("visible");
  citationReturnButton.setAttribute("aria-hidden", "true");
  citationReturnButton.tabIndex = -1;
  citationReturnPosition.textContent = "";
  pdfViewer.currentPageNumber = pageNumber;
  pdfViewer.scrollPageIntoView({ pageNumber });
  const textLayer = await waitForCitationTextLayer(pageNumber);
  if (!textLayer) {
    console.warn("[PDF Helper 引用定位] 文字层未加载，无法核对原文", {
      pageNumber,
      citedQuotes: normalizedQuotes,
    });
    return;
  }
  const locatedCitations = normalizedQuotes.flatMap((quote) => {
    const locatedCitation = findCitationRange(textLayer, quote);
    if (!locatedCitation) {
      console.warn(
        "[PDF Helper 引用定位] 页面已打开，但文字层中未找到对应原句",
        { pageNumber, citedQuote: quote },
      );
      return [];
    }
    const { range, match } = locatedCitation;
    console.info("[PDF Helper 引用定位] 已匹配到 PDF 原文", {
      pageNumber,
      citedQuote: quote,
      matchedOriginalText: range.toString(),
      matchMode: match.exact ? "exact" : "multi-anchor",
      matchConfidence: match.confidence,
    });
    return [locatedCitation];
  });
  const firstLocatedCitation = locatedCitations[0];
  if (!firstLocatedCitation) return;

  const target = firstLocatedCitation.range.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", inline: "nearest" });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  highlightCitationRanges(
    textLayer,
    locatedCitations.map(({ range }) => range),
  );
}

function getDocumentAgentOutline(): DocumentOutlineItem[] {
  return getOutlinePageItems().map((item) => ({ ...item, depth: 0 }));
}

async function ensureDocumentKnowledge(
  documentProxy: PDFDocumentProxy,
  assistantMessage: HTMLElement,
): Promise<{ record: DocumentAgentRecord; chunks: DocumentChunk[] }> {
  const fingerprint = getPdfFingerprint(documentProxy) || sourceName || "local-pdf";
  const documentId = createDocumentAgentId(
    fingerprint,
    sourceName || "未命名 PDF",
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
      name: sourceName || "未命名 PDF",
      pageCount: documentProxy.numPages,
      readingMode: "paper",
      providerId: aiConfig.providerId,
      model: aiConfig.model,
      // 首次只建立本地索引；不在打开文档时额外消耗模型 Token 生成全文摘要。
      hasApiKey: false,
      extractPageText: (pageNumber) => extractPageText(documentProxy, pageNumber),
      getOutline: getDocumentAgentOutline,
      requestAi: requestAiContent,
      isCurrent: () => pdfDocument === documentProxy,
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

async function inspectPdfPageWithVision(
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
    documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
    pageNumber,
    totalPages: documentProxy.numPages,
    readingMode: "paper",
  });
  return { content, model: visionAiConfig.model, cached: false };
}

async function buildAgentEvidence(
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
    documentName: sourceName || "未命名 PDF",
    pageCount: documentProxy.numPages,
    record: knowledge.record,
    chunks: knowledge.chunks,
    outline: getDocumentAgentOutline(),
    extractPageText: (targetPage) => extractPageText(documentProxy, targetPage),
    requestAi: requestAiContent,
    hasVisionModel: isVisionAiConfigured(visionAiConfig),
    userImageAttached,
    inspectPageImage: (targetPage, targetQuestion) => inspectPdfPageWithVision(
      documentProxy,
      targetPage,
      targetQuestion,
    ),
  });
  console.groupCollapsed(`[PDF Helper Agent] 证据检索完成 · ${result.planningRounds} 轮`);
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

async function buildSummaryContext(
  scope: SummaryScope,
): Promise<SummaryContext> {
  if (!pdfDocument) throw new Error("请先打开 PDF。");

  const documentAtStart = pdfDocument;
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const labels = getSummaryLabels(scope);
  let text = "";

  if (scope === "selection") {
    text = selectedTextForAi || getViewerSelectionText();
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
      if (pdfDocument !== documentAtStart)
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

function cancelPendingSummaryGeneration(): void {
  if (summaryGenerationTimer !== null) {
    clearTimeout(summaryGenerationTimer);
    summaryGenerationTimer = null;
  }
}

function scheduleSummaryGeneration(delay = 350): void {
  cancelPendingSummaryGeneration();
  summaryGenerationTimer = setTimeout(() => {
    summaryGenerationTimer = null;
    if (activeAssistantView === "summary" && !summaryPanelElement.hidden)
      void generateSummary();
  }, delay);
}

function setActiveSummaryScope(scope: SummaryScope): void {
  activeSummaryScope = scope;
  lastSummaryRequestKey = "";
  lastSummaryPoints = [];
  currentSummaryContext = null;
  summaryAbortController?.abort();

  for (const button of summaryScopeButtons) {
    button.classList.toggle("active", button.dataset.summaryScope === scope);
  }

  updateSummaryMetadata();
  scheduleSummaryGeneration(0);
}

async function generateSummary(force = false): Promise<void> {
  if (!pdfDocument) {
    setSummaryState("请先打开 PDF。", true);
    return;
  }

  summaryAbortController?.abort();
  const controller = new AbortController();
  summaryAbortController = controller;
  const scopeAtStart = activeSummaryScope;
  updateSummaryMetadata();
  setSummaryState("正在读取总结对象，请稍候…", false, false);

  try {
    const context = await buildSummaryContext(scopeAtStart);
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope)
      return;

    currentSummaryContext = context;
    updateSummaryMetadata(context);
    const requestKey = [
      context.scope,
      context.sourceLabel,
      context.positionLabel,
      context.text,
    ].join("\u0000");

    if (
      !force &&
      requestKey === lastSummaryRequestKey &&
      lastSummaryPoints.length > 0
    ) {
      renderSummaryPoints(lastSummaryPoints);
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
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: Math.max(1, pdfViewer.currentPageNumber || 1),
      },
    );
    const points = parseAiList(summaryContent).slice(0, 8);

    if (!points.length) throw new Error("模型没有返回总结内容。");
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope)
      return;

    lastSummaryRequestKey = requestKey;
    renderSummaryPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope)
      return;

    const message = error instanceof Error ? error.message : String(error);
    setSummaryState(`总结失败：${message}`, true);
  } finally {
    if (summaryAbortController === controller) summaryAbortController = null;
  }
}

function readSavedSummaryNotes(): SavedSummaryNote[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(SUMMARY_NOTES_STORAGE_KEY) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCurrentSummaryAsNote(): void {
  if (!currentSummaryContext || lastSummaryPoints.length === 0) {
    setStatus("当前没有可保存的总结要点。", true);
    return;
  }

  const note: SavedSummaryNote = {
    id: crypto.randomUUID(),
    documentName: getDisplayFileName(sourceName),
    scope: currentSummaryContext.scope,
    rangeLabel: currentSummaryContext.rangeLabel,
    sourceLabel: currentSummaryContext.sourceLabel,
    positionLabel: currentSummaryContext.positionLabel,
    points: [...lastSummaryPoints],
    createdAt: new Date().toISOString(),
  };
  const notes = [note, ...readSavedSummaryNotes()].slice(0, 100);
  localStorage.setItem(SUMMARY_NOTES_STORAGE_KEY, JSON.stringify(notes));
  refreshKnowledgeBaseIfOpen();
  setStatus(`已将 ${lastSummaryPoints.length} 条总结要点保存为笔记。`);
}

function resetSummaryState(): void {
  cancelPendingSummaryGeneration();
  summaryAbortController?.abort();
  summaryAbortController = null;
  activeSummaryScope = "selection";
  currentSummaryContext = null;
  lastSummaryRequestKey = "";
  lastSummaryPoints = [];

  for (const button of summaryScopeButtons) {
    button.classList.toggle(
      "active",
      button.dataset.summaryScope === "selection",
    );
  }

  updateSummaryMetadata();
  setSummaryState("选择总结范围后，将自动生成核心要点。");
}

function getCardTypeLabel(cardType: CardType): string {
  return {
    concept: "概念",
    method: "方法",
    experiment: "实验",
    viewpoint: "观点",
  }[cardType];
}

function setCardState(
  message: string,
  isError = false,
  clearCard = true,
): void {
  if (clearCard) {
    currentGeneratedCard = null;
    cardGeneratedContentElement.hidden = true;
  }
  cardGenerationStatusElement.textContent = message;
  cardGenerationStatusElement.classList.toggle("error", isError);
  cardGenerationStatusElement.hidden = false;
}

function renderGeneratedCard(
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

  currentGeneratedCard = content;
  currentCardContext = context;
  cardGenerationStatusElement.hidden = true;
  cardGenerationStatusElement.classList.remove("error");
  cardGeneratedContentElement.hidden = false;
}

function updateCardSourceSnippet(): void {
  const text = selectedTextForAi || getViewerSelectionText();
  if (!text) {
    cardSourceSnippetElement.textContent =
      "请在左侧 PDF 中选择需要制作卡片的论文原文。";
    cardSourceSnippetElement.title = "";
    return;
  }

  cardSourceSnippetElement.textContent = text;
  cardSourceSnippetElement.title = text;
}

function buildCardContext(): CardContext {
  if (!pdfDocument) throw new Error("请先打开 PDF。");

  const text = (selectedTextForAi || getViewerSelectionText())
    .trim()
    .slice(0, MAX_CARD_SOURCE_LENGTH);
  if (!text) throw new Error("请先在 PDF 中选中需要制作卡片的原文。");

  const pageNumber = Math.max(
    1,
    selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
  );
  const chapter = getCurrentChapterContext(pageNumber);
  const documentName = getDisplayFileName(sourceName);
  const positionLabel = chapter.title;

  return {
    cardType: activeCardType,
    text,
    documentName,
    pageNumber,
    positionLabel,
    sourceLocation: `${positionLabel} · 第 ${pageNumber} 页`,
  };
}

function cancelPendingCardGeneration(): void {
  if (cardGenerationTimer !== null) {
    clearTimeout(cardGenerationTimer);
    cardGenerationTimer = null;
  }
}

function scheduleCardGeneration(delay = 350): void {
  cancelPendingCardGeneration();
  cardGenerationTimer = setTimeout(() => {
    cardGenerationTimer = null;
    if (activeAssistantView === "cards" && !cardsPanelElement.hidden)
      void generatePaperCard();
  }, delay);
}

function setActiveCardType(cardType: CardType): void {
  activeCardType = cardType;
  lastCardRequestKey = "";
  currentCardContext = null;
  currentGeneratedCard = null;
  cardAbortController?.abort();

  for (const button of cardTypeButtons) {
    button.classList.toggle("active", button.dataset.cardType === cardType);
  }

  updateCardSourceSnippet();
  scheduleCardGeneration(0);
}

async function generatePaperCard(force = false): Promise<void> {
  updateCardSourceSnippet();

  if (!pdfDocument) {
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
    requestKey === lastCardRequestKey &&
    currentGeneratedCard &&
    currentCardContext
  ) {
    renderGeneratedCard(currentGeneratedCard, currentCardContext);
    return;
  }

  cardAbortController?.abort();
  const controller = new AbortController();
  cardAbortController = controller;
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

    lastCardRequestKey = requestKey;
    renderGeneratedCard(content, context);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setCardState(`卡片生成失败：${message}`, true);
  } finally {
    if (cardAbortController === controller) cardAbortController = null;
  }
}

function formatGeneratedCardText(
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

function readSavedPaperCards(): SavedPaperCard[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(SAVED_CARDS_STORAGE_KEY) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCurrentPaperCard(): void {
  if (!currentCardContext || !currentGeneratedCard) {
    setStatus("当前没有可保存的论文卡片。", true);
    return;
  }

  const card: SavedPaperCard = {
    id: crypto.randomUUID(),
    ...currentCardContext,
    ...currentGeneratedCard,
    createdAt: new Date().toISOString(),
  };
  const cards = [card, ...readSavedPaperCards()].slice(0, 100);
  localStorage.setItem(SAVED_CARDS_STORAGE_KEY, JSON.stringify(cards));
  refreshKnowledgeBaseIfOpen();
  setStatus(`已保存“${card.title}”论文卡片。`);
}

function resetCardState(): void {
  cancelPendingCardGeneration();
  cardAbortController?.abort();
  cardAbortController = null;
  activeCardType = "method";
  lastCardRequestKey = "";
  currentCardContext = null;
  currentGeneratedCard = null;

  for (const button of cardTypeButtons) {
    button.classList.toggle("active", button.dataset.cardType === "method");
  }

  updateCardSourceSnippet();
  setCardState("选择原文后，将自动生成论文卡片。");
}

let paperCardPageStatusTimer: number | undefined;

function setPaperCardPageStatus(message = "", isError = false): void {
  window.clearTimeout(paperCardPageStatusTimer);
  paperCardPageStatusElement.textContent = message;
  paperCardPageStatusElement.classList.toggle("error", isError);
  paperCardPageStatusElement.hidden = !message;

  if (message) {
    paperCardPageStatusTimer = window.setTimeout(() => {
      if (paperCardPageStatusElement.textContent === message) {
        paperCardPageStatusElement.textContent = "";
        paperCardPageStatusElement.classList.remove("error");
        paperCardPageStatusElement.hidden = true;
      }
    }, 5000);
  }
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    select.value = "";
    return;
  }

  const hasOption = Array.from(select.options).some(
    (option) => option.value === normalizedValue,
  );
  if (!hasOption) {
    const option = document.createElement("option");
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    select.append(option);
  }
  select.value = normalizedValue;
}

let paperCardEditMode = false;

function getPaperCardInlineControls(): HTMLTextAreaElement[] {
  return [
    paperTitleInput,
    paperAuthorsInput,
    paperVenueYearInput,
    paperResearchAreaInput,
    paperCardDocumentNameElement,
    paperOneSentenceSummaryInput,
    paperResearchProblemInput,
    paperCoreInnovationInput,
    paperMainFindingsInput,
    paperResearchConnectionInput,
    paperWorthReadingInput,
  ];
}

type PaperCardInlineDraft = {
  values: Record<string, string>;
  updatedAt: string;
};

type PaperCardInlineDraftStore = Record<string, PaperCardInlineDraft>;

function getPaperCardInlineDraftKey(): string {
  if (editingPaperOverviewId) return `saved:${editingPaperOverviewId}`;
  const documentIdentity = sourceName
    ? getDisplayFileName(sourceName)
    : paperCardReviewDocumentName || "untitled";
  return `document:${documentIdentity}`;
}

function getPaperCardInlineFieldKey(control: HTMLTextAreaElement): string {
  return control.name || control.id;
}

function readPaperCardInlineDraftStore(): PaperCardInlineDraftStore {
  try {
    const value = JSON.parse(
      localStorage.getItem(PAPER_CARD_INLINE_DRAFT_STORAGE_KEY) || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PaperCardInlineDraftStore)
      : {};
  }
  catch {
    return {};
  }
}

function savePaperCardInlineDraft(control: HTMLTextAreaElement): void {
  const store = readPaperCardInlineDraftStore();
  const key = getPaperCardInlineDraftKey();
  const current = store[key] ?? {
    values: {},
    updatedAt: new Date().toISOString(),
  };

  current.values[getPaperCardInlineFieldKey(control)] = control.value.trim();
  current.updatedAt = new Date().toISOString();
  store[key] = current;
  localStorage.setItem(
    PAPER_CARD_INLINE_DRAFT_STORAGE_KEY,
    JSON.stringify(store),
  );
}

function saveAllPaperCardInlineDrafts(): void {
  for (const control of getPaperCardInlineControls()) {
    savePaperCardInlineDraft(control);
  }
}

function restorePaperCardInlineDrafts(): void {
  const draft = readPaperCardInlineDraftStore()[getPaperCardInlineDraftKey()];
  if (!draft?.values) return;

  for (const control of getPaperCardInlineControls()) {
    const savedValue = draft.values[getPaperCardInlineFieldKey(control)];
    if (typeof savedValue === "string") control.value = savedValue;
  }
}

function clearPaperCardInlineDrafts(): void {
  const store = readPaperCardInlineDraftStore();
  const key = getPaperCardInlineDraftKey();
  if (!(key in store)) return;
  delete store[key];
  localStorage.setItem(
    PAPER_CARD_INLINE_DRAFT_STORAGE_KEY,
    JSON.stringify(store),
  );
}

function installPaperCardInlineEditing(): void {
  for (const control of getPaperCardInlineControls()) {
    control.classList.add("paper-card-inline-editable");
    control.closest("label")?.classList.add(
      "paper-card-inline-editable-field",
    );
    control
      .closest(".paper-card-insight, .paper-card-decision-reason")
      ?.classList.add("paper-card-inline-editable-card");

    control.addEventListener("input", () => {
      autoResizePaperCardTextarea(control);
    });

    control.addEventListener("blur", () => {
      if (!paperCardEditMode) return;
      savePaperCardInlineDraft(control);
    });
  }
}

function setPaperCardEditMode(editing: boolean): void {
  const wasEditing = paperCardEditMode;
  paperCardEditMode = editing;

  paperCardFormElement.classList.toggle("editing", editing);
  paperCardFormElement.classList.toggle("reading-view", !editing);

  const controls = paperCardFormElement.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  for (const control of controls) {
    if (control instanceof HTMLSelectElement) {
      control.disabled = !editing;
    }
    else {
      control.readOnly = !editing;
    }
  }

  if (wasEditing && !editing) {
    saveAllPaperCardInlineDrafts();
    if (editingPaperOverviewId) savePaperOverviewCard();
  }

  editPaperCardButton.textContent = editing ? "✓ 完成编辑" : "✎ 编辑卡片";
  editPaperCardButton.classList.toggle("active", editing);
  editPaperCardButton.setAttribute("aria-pressed", String(editing));
  schedulePaperCardTextareaRefresh();
}

function collectPaperCardFormData(): PaperCardFormData {
  return {
    title: paperTitleInput.value.trim(),
    authors: paperAuthorsInput.value.trim(),
    venueYear: paperVenueYearInput.value.trim(),
    researchArea: paperResearchAreaInput.value.trim(),
    keywords: paperKeywordsInput.value.trim(),
    oneSentenceSummary: paperOneSentenceSummaryInput.value.trim(),
    researchProblem: paperResearchProblemInput.value.trim(),
    coreInnovation: paperCoreInnovationInput.value.trim(),
    worthReading: paperWorthReadingInput.value.trim(),
    problemSetup: paperProblemSetupInput.value.trim(),
    researchGap: paperResearchGapInput.value.trim(),
    whyImportant: paperWhyImportantInput.value.trim(),
    topicTags: paperTopicTagsInput.value.trim(),
    methodOverview: paperMethodOverviewInput.value.trim(),
    methodIntuition: paperMethodIntuitionInput.value.trim(),
    methodSteps: paperMethodStepsInput.value.trim(),
    keyAssumptions: paperKeyAssumptionsInput.value.trim(),
    notationGuide: paperNotationGuideInput.value.trim(),
    datasets: paperDatasetsInput.value.trim(),
    experimentSetup: paperExperimentSetupInput.value.trim(),
    metrics: paperMetricsInput.value.trim(),
    mainFindings: paperMainFindingsInput.value.trim(),
    strongestEvidence: paperStrongestEvidenceInput.value.trim(),
    comparisonWithPriorWork: paperComparisonPriorWorkInput.value.trim(),
    limitations: paperLimitationsInput.value.trim(),
    readingStatus: paperReadingStatusInput.value.trim(),
    recommendDeepReading: paperRecommendDeepReadingInput.value.trim(),
    readingDifficulty: paperReadingDifficultyInput.value.trim(),
    readingValueScore: paperReadingValueScoreInput.value.trim(),
    readingAdvice: paperReadingAdviceInput.value.trim(),
    suitableStages: paperSuitableStagesInput.value.trim(),
    prerequisites: paperPrerequisitesInput.value.trim(),
    citationPoints: paperCitationPointsInput.value.trim(),
    researchConnection: paperResearchConnectionInput.value.trim(),
    followupQuestions: paperFollowupQuestionsInput.value.trim(),
    weeklyPlan: paperWeeklyPlanInput.value.trim(),
    personalNotes: paperPersonalNotesInput.value.trim(),
  };
}

const PAPER_CARD_TEXTAREA_MIN_HEIGHT = 44;

function updatePaperCardOverviewFieldDensity(
  textarea: HTMLTextAreaElement,
): void {
  const overviewFieldIds = new Set([
    "paper-title",
    "paper-authors",
    "paper-venue-year",
    "paper-research-area",
    "paper-card-document-name",
  ]);
  if (!overviewFieldIds.has(textarea.id)) return;

  const length = textarea.value.trim().length;
  textarea.classList.remove(
    "content-short",
    "content-medium",
    "content-long",
  );

  const shortLimit = textarea.id === "paper-title" ? 72 : 54;
  const mediumLimit = textarea.id === "paper-title" ? 140 : 110;
  textarea.classList.add(
    length <= shortLimit
      ? "content-short"
      : length <= mediumLimit
        ? "content-medium"
        : "content-long",
  );
}

function autoResizePaperCardTextarea(textarea: HTMLTextAreaElement): void {
  updatePaperCardOverviewFieldDensity(textarea);
  // Reset first so the field can shrink when content becomes shorter.
  textarea.style.height = `${PAPER_CARD_TEXTAREA_MIN_HEIGHT}px`;
  textarea.style.height = "0px";

  const computedStyle = window.getComputedStyle(textarea);
  const borderHeight =
    Number.parseFloat(computedStyle.borderTopWidth || "0") +
    Number.parseFloat(computedStyle.borderBottomWidth || "0");
  const contentHeight = Math.ceil(textarea.scrollHeight + borderHeight);

  textarea.style.height = `${Math.max(PAPER_CARD_TEXTAREA_MIN_HEIGHT, contentHeight)}px`;
}

function refreshPaperCardTextareaHeights(): void {
  const textareas =
    paperCardFormElement.querySelectorAll<HTMLTextAreaElement>("textarea");
  for (const textarea of textareas) autoResizePaperCardTextarea(textarea);
}

function schedulePaperCardTextareaRefresh(): void {
  // The paper-card page is initially hidden. Two animation frames ensure
  // layout is measurable after it becomes visible and after AI content renders.
  requestAnimationFrame(() => {
    refreshPaperCardTextareaHeights();
    requestAnimationFrame(refreshPaperCardTextareaHeights);
  });
}

function bindPaperCardTextareaAutoResize(): void {
  const textareas =
    paperCardFormElement.querySelectorAll<HTMLTextAreaElement>("textarea");
  for (const textarea of textareas) {
    textarea.addEventListener("input", () =>
      autoResizePaperCardTextarea(textarea),
    );
  }
  window.addEventListener("resize", schedulePaperCardTextareaRefresh);
  schedulePaperCardTextareaRefresh();
}

function renderPaperCardForm(
  data: Omit<PaperCardFormData, "personalNotes">,
): void {
  paperTitleInput.value = data.title;
  paperAuthorsInput.value = data.authors;
  paperVenueYearInput.value = data.venueYear;
  paperResearchAreaInput.value = data.researchArea;
  paperKeywordsInput.value = data.keywords;
  paperOneSentenceSummaryInput.value = data.oneSentenceSummary;
  paperResearchProblemInput.value = data.researchProblem;
  paperCoreInnovationInput.value = data.coreInnovation;
  paperWorthReadingInput.value = data.worthReading;
  paperProblemSetupInput.value = data.problemSetup;
  paperResearchGapInput.value = data.researchGap;
  paperWhyImportantInput.value = data.whyImportant;
  paperTopicTagsInput.value = data.topicTags;
  paperMethodOverviewInput.value = data.methodOverview;
  paperMethodIntuitionInput.value = data.methodIntuition;
  paperMethodStepsInput.value = data.methodSteps;
  paperKeyAssumptionsInput.value = data.keyAssumptions;
  paperNotationGuideInput.value = data.notationGuide;
  paperDatasetsInput.value = data.datasets;
  paperExperimentSetupInput.value = data.experimentSetup;
  paperMetricsInput.value = data.metrics;
  paperMainFindingsInput.value = data.mainFindings;
  paperStrongestEvidenceInput.value = data.strongestEvidence;
  paperComparisonPriorWorkInput.value = data.comparisonWithPriorWork;
  paperLimitationsInput.value = data.limitations;
  setSelectValue(paperReadingStatusInput, data.readingStatus);
  setSelectValue(paperRecommendDeepReadingInput, data.recommendDeepReading);
  setSelectValue(paperReadingDifficultyInput, data.readingDifficulty);
  paperReadingValueScoreInput.value = data.readingValueScore;
  paperReadingAdviceInput.value = data.readingAdvice;
  paperSuitableStagesInput.value = data.suitableStages;
  paperPrerequisitesInput.value = data.prerequisites;
  paperCitationPointsInput.value = data.citationPoints;
  paperResearchConnectionInput.value = data.researchConnection;
  paperFollowupQuestionsInput.value = data.followupQuestions;
  paperWeeklyPlanInput.value = data.weeklyPlan;
  restorePaperCardInlineDrafts();
  setPaperCardEditMode(false);
  schedulePaperCardTextareaRefresh();
}

function updatePaperCardDocumentName(): void {
  const currentName = sourceName ? getDisplayFileName(sourceName) : "";
  const name = paperCardReviewDocumentName || currentName || "尚未打开 PDF";
  paperCardDocumentNameElement.value = name;
  paperCardDocumentNameElement.title =
    paperCardReviewDocumentName || sourceName || name;
  autoResizePaperCardTextarea(paperCardDocumentNameElement);
}

function setPaperCardPageMode(mode: "generate" | "review"): void {
  const isReview = mode === "review";
  paperCardPageElement.classList.toggle("review-mode", isReview);
  paperCardPageTitleElement.textContent = isReview
    ? "论文阅读卡片"
    : "论文阅读卡片";
  paperCardPageSubtitleElement.textContent = "";
  paperCardPageSubtitleElement.hidden = true;
  regeneratePaperCardButton.hidden = isReview;
  savePaperCardPageButton.textContent = isReview
    ? "▣ 保存修改"
    : "▣ 加入知识库";
  paperCardBackButton.setAttribute(
    "aria-label",
    isReview && paperCardReturnTarget === "knowledge"
      ? "返回知识库"
      : "返回 PDF",
  );
  setPaperCardEditMode(false);
}

function clearPaperCardReviewState(): void {
  editingPaperOverviewId = null;
  paperCardReviewDocumentName = "";
  paperCardReturnTarget = "pdf";
  setPaperCardPageMode("generate");
}

function resetPaperCardPageState(): void {
  paperCardPageAbortController?.abort();
  paperCardPageAbortController = null;
  paperCardPageDocumentKey = "";
  paperCardPageSourceCache = null;
  paperCardFormElement.reset();
  paperCardFormElement.classList.remove("generating");
  setPaperCardEditMode(false);
  regeneratePaperCardButton.disabled = false;
  setPaperCardPageStatus();
  if (!editingPaperOverviewId) updatePaperCardDocumentName();
  schedulePaperCardTextareaRefresh();
}

function getPaperOverviewPageNumbers(totalPages: number): number[] {
  if (totalPages <= 18) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pageNumbers = new Set<number>();
  for (let page = 1; page <= Math.min(6, totalPages); page += 1)
    pageNumbers.add(page);
  for (let page = Math.max(1, totalPages - 4); page <= totalPages; page += 1)
    pageNumbers.add(page);

  const middleStart = 7;
  const middleEnd = Math.max(middleStart, totalPages - 5);
  const middleSamples = 7;
  for (let index = 0; index < middleSamples; index += 1) {
    const ratio = index / (middleSamples - 1);
    pageNumbers.add(
      Math.round(middleStart + (middleEnd - middleStart) * ratio),
    );
  }

  return Array.from(pageNumbers)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((left, right) => left - right);
}

async function extractPaperOverviewText(
  documentProxy: PDFDocumentProxy,
): Promise<string> {
  if (paperCardPageSourceCache?.document === documentProxy) {
    return paperCardPageSourceCache.text;
  }

  const pageNumbers = getPaperOverviewPageNumbers(documentProxy.numPages);
  const chunks: string[] = [];
  let currentLength = 0;

  for (const pageNumber of pageNumbers) {
    if (pdfDocument !== documentProxy)
      throw new Error("PDF 已切换，请重新生成论文卡片。");
    const pageText = await extractPageText(documentProxy, pageNumber);
    if (!pageText) continue;

    const pageHeader = `\n\n[第 ${pageNumber} 页]\n`;
    const remainingLength =
      MAX_PAPER_CARD_SOURCE_LENGTH - currentLength - pageHeader.length;
    if (remainingLength <= 0) break;

    const clippedText = pageText.slice(0, remainingLength);
    chunks.push(`${pageHeader}${clippedText}`);
    currentLength += pageHeader.length + clippedText.length;
  }

  const text = chunks.join("").trim();
  if (!text) throw new Error("当前 PDF 没有可读取的文字内容。");
  paperCardPageSourceCache = { document: documentProxy, text };
  return text;
}

function normalizePaperOverviewField(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "原文未明确出现";
}

function parsePaperScore(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 10
    ? numeric
    : null;
}

function hasUsefulPaperField(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return Boolean(
    normalized &&
    normalized !== "原文未明确出现" &&
    normalized !== "未明确" &&
    normalized !== "无",
  );
}

function computePaperReadingValueScore(
  payload: PaperOverviewApiResponse,
): string {
  const components = [
    {
      value: parsePaperScore(payload.relevance_score),
      weight: 0.35,
    },
    {
      value: parsePaperScore(payload.novelty_score),
      weight: 0.25,
    },
    {
      value: parsePaperScore(payload.evidence_score),
      weight: 0.25,
    },
    {
      value: parsePaperScore(payload.method_clarity_score),
      weight: 0.15,
    },
  ].filter(
    (component): component is { value: number; weight: number } =>
      component.value !== null,
  );

  if (components.length >= 3) {
    const totalWeight = components.reduce(
      (sum, component) => sum + component.weight,
      0,
    );
    const weightedScore = components.reduce(
      (sum, component) =>
        sum + component.value * component.weight,
      0,
    ) / totalWeight;

    return Math.min(9.8, Math.max(1, weightedScore)).toFixed(1);
  }

  const modelScore = parsePaperScore(payload.reading_value_score);
  const neutralModelScore = modelScore !== null && Math.abs(modelScore - 8.5) < 0.001;
  let score = neutralModelScore ? 5.8 : (modelScore ?? 5.8);

  const relevance = normalizePaperOverviewField(payload.suitable_stages);
  if (relevance === "高") score += 1.0;
  else if (relevance === "中") score += 0.25;
  else if (relevance === "低") score -= 1.0;

  const recommendation = normalizePaperOverviewField(
    payload.recommend_deep_reading,
  );
  if (recommendation === "建议精读") score += 0.9;
  else if (recommendation === "建议按需精读") score += 0.2;
  else if (recommendation === "暂不建议精读") score -= 1.1;

  const difficulty = normalizePaperOverviewField(payload.reading_difficulty);
  if (difficulty === "较难") score -= 0.15;

  if (hasUsefulPaperField(payload.core_innovation)) score += 0.45;
  else score -= 0.6;

  if (hasUsefulPaperField(payload.main_findings)) score += 0.35;
  else score -= 0.35;

  if (hasUsefulPaperField(payload.strongest_evidence)) score += 0.3;
  else score -= 0.3;

  if (hasUsefulPaperField(payload.research_connection)) score += 0.25;
  if (hasUsefulPaperField(payload.citation_points)) score += 0.15;

  return Math.min(9.8, Math.max(1, score)).toFixed(1);
}

function normalizeKnowledgeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\w\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKnowledgeSearchText(value: string): string[] {
  const matches: string[] =
    normalizeKnowledgeSearchText(value).match(
      /[a-z0-9\u4e00-\u9fff]{2,}/g,
    ) ?? [];

  return Array.from(
    new Set(matches.filter((token: string) => token.length >= 2)),
  );
}

function collectRelevantKnowledgeContextForPaper(): string {
  const title = paperTitleInput.value.trim();
  const researchArea = paperResearchAreaInput.value.trim();
  const keywords = paperKeywordsInput.value.trim();
  const currentDocumentName = (
    sourceName ? getDisplayFileName(sourceName) : ""
  ).trim();

  const queryTokens = new Set(
    tokenizeKnowledgeSearchText(
      [title, researchArea, keywords].filter(Boolean).join(" "),
    ),
  );

  if (queryTokens.size === 0) return "";

  const normalizedTitle = normalizeKnowledgeSearchText(title);
  const normalizedDocumentName = normalizeKnowledgeSearchText(
    currentDocumentName,
  );

  const matches = collectKnowledgeItems()
    .filter((item) => {
      const haystack = [
        item.title,
        item.content,
        item.category,
        item.documentName,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(" ");
      const normalizedHaystack = normalizeKnowledgeSearchText(haystack);
      if (!normalizedHaystack) return false;

      const isSameDocument =
        (normalizedTitle &&
          normalizeKnowledgeSearchText(item.title) === normalizedTitle) ||
        (normalizedDocumentName &&
          normalizeKnowledgeSearchText(item.documentName) ===
            normalizedDocumentName);
      if (isSameDocument) return false;

      let score = 0;
      for (const token of queryTokens) {
        if (normalizedHaystack.includes(token)) {
          score += token.length >= 5 ? 2 : 1;
        }
      }
      return score > 0;
    })
    .map((item) => {
      const haystack = [
        item.title,
        item.content,
        item.category,
        ...(item.tags || []),
      ].join(" ");
      const normalizedHaystack = normalizeKnowledgeSearchText(haystack);
      let score = 0;
      for (const token of queryTokens) {
        if (normalizedHaystack.includes(token)) {
          score += token.length >= 5 ? 2 : 1;
        }
      }
      if (item.kind === "paper-card") score += 2;
      if (item.kind === "reading-card") score += 1;
      return { item, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (matches.length === 0) return "";

  return matches
    .map(({ item }, index) => {
      const excerpt = item.content.replace(/\s+/g, " ").trim().slice(0, 260);
      const tags = item.tags.slice(0, 5).join("、") || "无";
      return [
        `[知识库参考 ${index + 1}]`,
        `标题：${item.title}`,
        `类型：${getKnowledgeKindLabel(item.kind)}`,
        `来源：${item.documentName} · ${item.positionLabel}`,
        `标签：${tags}`,
        `内容摘录：${excerpt}${item.content.length > 260 ? "…" : ""}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function generatePaperOverviewCard(force = false): Promise<void> {
  updatePaperCardDocumentName();
  if (!pdfDocument) {
    setPaperCardPageStatus("请先打开 PDF，再生成论文卡片。", true);
    return;
  }

  const documentAtStart = pdfDocument;
  const documentKey = `${sourceName}\u0000${documentAtStart.numPages}`;
  if (
    !force &&
    paperCardPageDocumentKey === documentKey &&
    paperTitleInput.value.trim()
  ) {
    return;
  }

  paperCardPageAbortController?.abort();
  const controller = new AbortController();
  paperCardPageAbortController = controller;
  regeneratePaperCardButton.disabled = true;
  paperCardFormElement.classList.add("generating");
  setPaperCardPageStatus(
    "正在读取论文并直接调用 AI API 生成结构化卡片，请稍候…",
  );

  try {
    if (force) clearPaperCardInlineDrafts();
    if (!aiConfigLoaded) await loadDeepSeekConfig();
    if (!aiConfig.apiKey) {
      setDeepSeekSettingsOpen(true);
      deepSeekSettingsStatus.classList.add("error");
      deepSeekSettingsStatus.textContent =
        "生成论文卡片需要先配置并保存 API Key。";
      throw new Error("请先在右上角“设置”中配置 API Key。");
    }

    const text = await extractPaperOverviewText(documentAtStart);
    if (controller.signal.aborted) return;

    const knowledgeContext = collectRelevantKnowledgeContextForPaper();

    const paperCardPrompt = [
      "你是严谨的科研论文阅读助手。请基于提供的论文全文片段，生成一张“一屏可读”的研究生论文阅读卡片。",
      "只输出一个合法 JSON 对象，不要输出 Markdown、代码块或额外说明。",
      "",
      "总原则：",
      "1. 内容必须简洁、具体、可验证；不要写空泛套话。",
      "2. 不得编造作者、会议、数据、实验结果或参考文献；原文无法确认时填写“原文未明确出现”。",
      "3. 一句话总结、核心问题、研究价值分别控制在 80 个中文字符以内。",
      "4. 核心创新最多 3 点，关键实验结果最多 2 点；使用换行和“• ”组织。",
      "5. 对我的研究价值必须有深度：优先结合原文证据，再参考用户知识库中的相关笔记，写出可迁移之处、适用边界以及需要复核的风险，避免空泛赞美。",
      "6. comparison_with_prior_work 填写空字符串；延伸阅读由联网检索模块单独生成，禁止在此编造论文。",
      "7. suitable_stages 在本页面表示“领域相关度”，只能填写“高”“中”“低”。",
      "8. 不要把 8.5 当作默认分。先分别评估 relevance_score、novelty_score、evidence_score、method_clarity_score，再给出 reading_value_score。",
      "9. 四个分项和总分都必须基于原文证据拉开差异：普通增量工作通常不应高于 8.0；证据不足或相关性低应低于 7.0；只有相关性、创新性和证据都很强时才可高于 9.0。",
      "",
      "JSON 字段必须完整，且所有值都必须是字符串：",
      JSON.stringify({
        title: "论文标题",
        authors: "作者，逗号分隔",
        venue_year: "会议/期刊与年份",
        research_area: "研究领域",
        keywords: "3~6 个关键词，逗号分隔",
        one_sentence_summary: "一句话说清做了什么与核心结果",
        research_problem: "论文解决的核心问题",
        core_innovation: "最多 3 条核心思想与创新，用换行和“• ”组织",
        worth_reading: "一句话说明是否值得投入时间及原因",
        problem_setup: "一句话任务设定",
        research_gap: "一句话研究空白",
        why_important: "一句话说明重要性",
        topic_tags: "主题标签，逗号分隔",
        method_overview: "一句话方法概述",
        method_intuition: "一句话方法直觉",
        method_steps: "最多 4 步的方法流程",
        key_assumptions: "关键假设",
        notation_guide: "关键术语或符号",
        datasets: "数据集或实验对象",
        experiment_setup: "实验设置摘要",
        metrics: "关键指标",
        main_findings: "最多 2 条关键实验结果，用换行和“• ”组织",
        strongest_evidence: "最强证据",
        comparison_with_prior_work: "填写空字符串",
        limitations: "最重要的局限",
        reading_status: "待读",
        recommend_deep_reading: "建议精读/建议按需精读/暂不建议精读 三选一",
        reading_difficulty: "较易/中等/较难 三选一",
        reading_value_score: "0~10 的总分数字字符串，不得固定使用 8.5",
        novelty_score: "0~10，创新性分项数字字符串",
        evidence_score: "0~10，实验或理论证据强度分项数字字符串",
        relevance_score: "0~10，与当前研究方向相关度分项数字字符串",
        method_clarity_score: "0~10，方法清晰度与可理解性分项数字字符串",
        reading_advice: "先读哪些章节、图表或证明",
        suitable_stages: "高/中/低 三选一",
        prerequisites: "必要先修知识",
        citation_points: "可用于相关工作、方法或实验分析的具体产出",
        research_connection: "对研究设计可迁移的价值",
        followup_questions: "最值得复现的实验与最小验证路径",
        weekly_plan: "建议整理成什么笔记或比较表",
      }),
      "",
      "知识库参考使用规则：如果下面提供了用户知识库中的相关笔记或卡片，请只把它们当作辅助背景。它们可能有误，必须与原文相互印证；若与原文冲突，以原文为准，并在“对我的研究价值”“可产出”“判断理由”里体现辩证判断，而不是直接照抄用户笔记。",
      knowledgeContext
        ? `用户知识库相关记录：
${knowledgeContext}`
        : "用户知识库相关记录：暂无可直接参考的历史笔记。",
      "论文文件名：" + getDisplayFileName(sourceName),
      "论文页数：" + String(documentAtStart.numPages),
    ].join("\\n");

    const aiContent = await requestAiContent(
      [{ role: "user", content: paperCardPrompt }],
      {
        documentName: getDisplayFileName(sourceName),
        totalPages: documentAtStart.numPages,
        documentText: text,
        readingMode: "paper",
      },
    );

    const payload = parseAiJson(aiContent) as PaperOverviewApiResponse;
    if (pdfDocument !== documentAtStart || controller.signal.aborted) return;

    renderPaperCardForm({
      title: normalizePaperOverviewField(payload.title),
      authors: normalizePaperOverviewField(payload.authors),
      venueYear: normalizePaperOverviewField(payload.venue_year),
      researchArea: normalizePaperOverviewField(payload.research_area),
      keywords: normalizePaperOverviewField(payload.keywords),
      oneSentenceSummary: normalizePaperOverviewField(
        payload.one_sentence_summary,
      ),
      researchProblem: normalizePaperOverviewField(payload.research_problem),
      coreInnovation: normalizePaperOverviewField(payload.core_innovation),
      worthReading: normalizePaperOverviewField(payload.worth_reading),
      problemSetup: normalizePaperOverviewField(payload.problem_setup),
      researchGap: normalizePaperOverviewField(payload.research_gap),
      whyImportant: normalizePaperOverviewField(payload.why_important),
      topicTags: normalizePaperOverviewField(payload.topic_tags),
      methodOverview: normalizePaperOverviewField(payload.method_overview),
      methodIntuition: normalizePaperOverviewField(payload.method_intuition),
      methodSteps: normalizePaperOverviewField(payload.method_steps),
      keyAssumptions: normalizePaperOverviewField(payload.key_assumptions),
      notationGuide: normalizePaperOverviewField(payload.notation_guide),
      datasets: normalizePaperOverviewField(payload.datasets),
      experimentSetup: normalizePaperOverviewField(payload.experiment_setup),
      metrics: normalizePaperOverviewField(payload.metrics),
      mainFindings: normalizePaperOverviewField(payload.main_findings),
      strongestEvidence: normalizePaperOverviewField(
        payload.strongest_evidence,
      ),
      comparisonWithPriorWork: normalizePaperOverviewField(
        payload.comparison_with_prior_work,
      ),
      limitations: normalizePaperOverviewField(payload.limitations),
      readingStatus: normalizePaperOverviewField(payload.reading_status),
      recommendDeepReading: normalizePaperOverviewField(
        payload.recommend_deep_reading,
      ),
      readingDifficulty: normalizePaperOverviewField(
        payload.reading_difficulty,
      ),
      readingValueScore: computePaperReadingValueScore(payload),
      readingAdvice: normalizePaperOverviewField(payload.reading_advice),
      suitableStages: normalizePaperOverviewField(payload.suitable_stages),
      prerequisites: normalizePaperOverviewField(payload.prerequisites),
      citationPoints: normalizePaperOverviewField(payload.citation_points),
      researchConnection: normalizePaperOverviewField(
        payload.research_connection,
      ),
      followupQuestions: normalizePaperOverviewField(
        payload.followup_questions,
      ),
      weeklyPlan: normalizePaperOverviewField(payload.weekly_plan),
    });

    paperCardPageDocumentKey = documentKey;
    setPaperCardPageStatus(
      "论文阅读卡片已生成。点击“编辑卡片”后可直接修改内容。",
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setPaperCardPageStatus(`论文卡片生成失败：${message}`, true);
  } finally {
    if (paperCardPageAbortController === controller)
      paperCardPageAbortController = null;
    regeneratePaperCardButton.disabled = false;
    paperCardFormElement.classList.remove("generating");
  }
}

function openPaperCardPage(): void {
  clearPaperCardReviewState();
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  paperCardPageElement.hidden = false;
  appFrame?.classList.add("paper-card-page-open");
  paperCardEntryButton?.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");
  updatePaperCardDocumentName();
  setPaperCardEditMode(false);
  paperCardPageElement.scrollTop = 0;
  schedulePaperCardTextareaRefresh();
  void generatePaperOverviewCard();
}

function openSavedPaperOverviewReview(item: KnowledgeItem): void {
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

  paperCardPageAbortController?.abort();
  paperCardPageAbortController = null;
  editingPaperOverviewId = card.id;
  paperCardReviewDocumentName = card.documentName || item.documentName;
  paperCardReturnTarget = "knowledge";
  paperCardPageDocumentKey = `saved:${card.id}`;
  paperCardPageSourceCache = null;

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.add("active");
  paperCardPageElement.hidden = false;
  appFrame?.classList.add("paper-card-page-open");
  paperCardEntryButton?.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");

  setPaperCardPageMode("review");
  updatePaperCardDocumentName();
  renderPaperCardForm(card);
  paperPersonalNotesInput.value = card.personalNotes || "";
  setPaperCardEditMode(false);
  setPaperCardPageStatus();
  paperCardPageElement.scrollTop = 0;
  schedulePaperCardTextareaRefresh();
  persistCurrentAppViewState();
}

function closePaperCardPage(destination: "pdf" | "knowledge" = "pdf"): void {
  paperCardPageAbortController?.abort();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove("paper-card-page-open");
  paperCardEntryButton?.classList.remove("active");

  const returnToKnowledge = destination === "knowledge";
  clearPaperCardReviewState();

  if (returnToKnowledge) {
    knowledgeBasePageElement.hidden = false;
    appFrame?.classList.add("knowledge-base-page-open");
    knowledgeBaseEntryButton.classList.add("active");
    aiPanelToggleButton?.classList.remove("active");
    renderKnowledgeBase();
    return;
  }

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  aiPanelToggleButton?.classList.add("active");
  persistCurrentAppViewState();
}

function readSavedPaperOverviews(): SavedPaperOverview[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(SAVED_PAPER_OVERVIEWS_STORAGE_KEY) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePaperOverviewCard(): void {
  const data = collectPaperCardFormData();
  if (!data.title && !data.oneSentenceSummary) {
    setPaperCardPageStatus("当前没有可保存的论文卡片内容。", true);
    return;
  }

  const now = new Date().toISOString();
  const cards = readSavedPaperOverviews();

  if (editingPaperOverviewId) {
    const existing = cards.find((card) => card.id === editingPaperOverviewId);
    if (!existing) {
      setPaperCardPageStatus("原论文卡片已经不存在，无法保存修改。", true);
      return;
    }

    const updatedCards = cards.map((card) =>
      card.id === editingPaperOverviewId
        ? {
            ...card,
            ...data,
            documentName:
              paperCardDocumentNameElement.value.trim() ||
              paperCardReviewDocumentName ||
              card.documentName,
            updatedAt: now,
          }
        : card,
    );
    localStorage.setItem(
      SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
      JSON.stringify(updatedCards),
    );
    selectedKnowledgeRecordKey = getKnowledgeRecordKey(
      "paper-overview",
      editingPaperOverviewId,
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
      (sourceName ? getDisplayFileName(sourceName) : "未命名论文"),
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem(
    SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
    JSON.stringify([card, ...cards].slice(0, 100)),
  );
  refreshKnowledgeBaseIfOpen();
  setPaperCardPageStatus(
    `已保存“${data.title || card.documentName}”论文卡片。`,
  );
}

function formatPaperOverviewMarkdown(data: PaperCardFormData): string {
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

function exportPaperOverviewCard(): void {
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
  const baseName = (data.title || getDisplayFileName(sourceName) || "论文卡片")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 80);
  anchor.href = url;
  anchor.download = `${baseName}-论文卡片.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  setPaperCardPageStatus("论文卡片已导出为 Markdown 文件。");
}

function readSavedKnowledgeNotes(): SavedKnowledgeNote[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(KNOWLEDGE_NOTES_STORAGE_KEY) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeSavedKnowledgeNotes(notes: SavedKnowledgeNote[]): void {
  localStorage.setItem(
    KNOWLEDGE_NOTES_STORAGE_KEY,
    JSON.stringify(notes.slice(0, 500)),
  );
}

function readKnowledgeItemMetaStore(): KnowledgeItemMetaStore {
  try {
    const value = JSON.parse(
      localStorage.getItem(KNOWLEDGE_ITEM_META_STORAGE_KEY) || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as KnowledgeItemMetaStore)
      : {};
  } catch {
    return {};
  }
}

function writeKnowledgeItemMetaStore(store: KnowledgeItemMetaStore): void {
  localStorage.setItem(KNOWLEDGE_ITEM_META_STORAGE_KEY, JSON.stringify(store));
}

function normalizeKnowledgeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function getKnowledgeRecordKey(source: KnowledgeSource, id: string): string {
  return `${source}:${id}`;
}

function parseKnowledgePageNumber(value: string): number | undefined {
  const match = value.match(/第\s*(\d+)\s*页/);
  const pageNumber = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
}

function applyKnowledgeMeta(
  item: KnowledgeItem,
  store: KnowledgeItemMetaStore,
): KnowledgeItem {
  const meta = store[item.recordKey];
  if (!meta) return item;
  return {
    ...item,
    title: meta.title?.trim() || item.title,
    content: meta.content?.trim() || item.content,
    category: meta.category?.trim() || item.category,
    tags: normalizeKnowledgeTags(meta.tags).length
      ? normalizeKnowledgeTags(meta.tags)
      : item.tags,
    updatedAt: meta.updatedAt || item.updatedAt,
  };
}

function collectKnowledgeItems(): KnowledgeItem[] {
  const metaStore = readKnowledgeItemMetaStore();
  const items: KnowledgeItem[] = [];

  for (const note of readSavedKnowledgeNotes()) {
    if (!note || typeof note.id !== "string") continue;
    const createdAt =
      typeof note.createdAt === "string"
        ? note.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof note.updatedAt === "string" ? note.updatedAt : createdAt;
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("knowledge-note", note.id),
          id: note.id,
          source: "knowledge-note",
          kind: "note",
          title:
            typeof note.title === "string" && note.title.trim()
              ? note.title.trim()
              : "未命名笔记",
          content: typeof note.content === "string" ? note.content.trim() : "",
          documentName:
            typeof note.documentName === "string" && note.documentName.trim()
              ? note.documentName.trim()
              : "未关联文档",
          pageNumber: Number.isFinite(note.pageNumber)
            ? note.pageNumber
            : undefined,
          positionLabel:
            typeof note.positionLabel === "string" && note.positionLabel.trim()
              ? note.positionLabel.trim()
              : Number.isFinite(note.pageNumber)
                ? `第 ${note.pageNumber} 页`
                : "未定位",
          category:
            typeof note.category === "string" && note.category.trim()
              ? note.category.trim()
              : "AI 笔记",
          tags: normalizeKnowledgeTags(note.tags),
          createdAt,
          updatedAt,
        },
        metaStore,
      ),
    );
  }

  for (const note of readSavedSummaryNotes()) {
    if (!note || typeof note.id !== "string") continue;
    const points = Array.isArray(note.points)
      ? note.points.filter(
          (point): point is string =>
            typeof point === "string" && Boolean(point.trim()),
        )
      : [];
    const createdAt =
      typeof note.createdAt === "string"
        ? note.createdAt
        : new Date().toISOString();
    const rangeLabel =
      typeof note.rangeLabel === "string" && note.rangeLabel.trim()
        ? note.rangeLabel.trim()
        : "内容";
    const sourceLabel =
      typeof note.sourceLabel === "string" ? note.sourceLabel : "";
    const positionLabel =
      typeof note.positionLabel === "string" && note.positionLabel.trim()
        ? note.positionLabel.trim()
        : sourceLabel || "未定位";
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("summary-note", note.id),
          id: note.id,
          source: "summary-note",
          kind: "note",
          title: `${rangeLabel}总结`,
          content: points.map((point) => `• ${point.trim()}`).join("\n"),
          documentName:
            typeof note.documentName === "string" && note.documentName.trim()
              ? note.documentName.trim()
              : "未关联文档",
          pageNumber: parseKnowledgePageNumber(sourceLabel),
          positionLabel,
          category: "AI 总结",
          tags: Array.from(new Set(["总结", rangeLabel])).filter(Boolean),
          createdAt,
          updatedAt: createdAt,
        },
        metaStore,
      ),
    );
  }

  for (const card of readSavedPaperCards()) {
    if (!card || typeof card.id !== "string") continue;
    const createdAt =
      typeof card.createdAt === "string"
        ? card.createdAt
        : new Date().toISOString();
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("reading-card", card.id),
          id: card.id,
          source: "reading-card",
          kind: "reading-card",
          title:
            typeof card.title === "string" && card.title.trim()
              ? card.title.trim()
              : "未命名阅读卡片",
          content: formatGeneratedCardText(card, card),
          documentName:
            typeof card.documentName === "string" && card.documentName.trim()
              ? card.documentName.trim()
              : "未关联文档",
          pageNumber: Number.isFinite(card.pageNumber)
            ? card.pageNumber
            : undefined,
          positionLabel:
            typeof card.sourceLocation === "string" &&
            card.sourceLocation.trim()
              ? card.sourceLocation.trim()
              : typeof card.positionLabel === "string"
                ? card.positionLabel
                : "未定位",
          category: "阅读卡片",
          tags: ["AI 卡片", getCardTypeLabel(card.cardType)],
          createdAt,
          updatedAt: createdAt,
        },
        metaStore,
      ),
    );
  }

  for (const card of readSavedPaperOverviews()) {
    if (!card || typeof card.id !== "string") continue;
    const createdAt =
      typeof card.createdAt === "string"
        ? card.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof card.updatedAt === "string" ? card.updatedAt : createdAt;
    const tags = normalizeKnowledgeTags([
      card.researchArea,
      card.readingStatus,
      card.recommendDeepReading,
      card.keywords,
      card.topicTags,
    ]);
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("paper-overview", card.id),
          id: card.id,
          source: "paper-overview",
          kind: "paper-card",
          title: card.title?.trim() || card.documentName || "未命名论文卡片",
          content: formatPaperOverviewMarkdown(card),
          documentName: card.documentName || "未关联文档",
          positionLabel: "整篇论文",
          category: card.researchArea?.trim() || "论文卡片",
          tags: tags.length ? tags : ["论文卡片"],
          createdAt,
          updatedAt,
        },
        metaStore,
      ),
    );
  }

  return items;
}

function getKnowledgeKindLabel(kind: KnowledgeKind): string {
  return {
    note: "笔记",
    "reading-card": "阅读卡片",
    "paper-card": "论文卡片",
  }[kind];
}

function getKnowledgeKindIcon(kind: KnowledgeKind): string {
  return {
    note: "▧",
    "reading-card": "◇",
    "paper-card": "▱",
  }[kind];
}

function formatKnowledgeDate(value: string, includeTime = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: includeTime ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  }).format(date);
}

function formatKnowledgeRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000)
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getKnowledgeExcerpt(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[•*-]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function setKnowledgePageStatus(message = "", isError = false): void {
  knowledgePageStatusElement.textContent = message;
  knowledgePageStatusElement.classList.toggle("error", isError);
  knowledgePageStatusElement.hidden = !message;
}

function setKnowledgeFilter(filter: KnowledgeFilter): void {
  activeKnowledgeFilter = filter;
  if (activeKnowledgePageMode !== "library") setKnowledgePageMode("library");
  for (const button of knowledgeFilterButtons) {
    button.classList.toggle(
      "active",
      button.dataset.knowledgeFilter === filter,
    );
  }
  const labels: Record<KnowledgeFilter, string> = {
    all: "全部内容",
    note: "保存的笔记",
    "reading-card": "阅读卡片",
    "paper-card": "论文卡片",
  };
  knowledgePageTitleElement.textContent = labels[filter];
  renderKnowledgeBase();
}

function getKnowledgeBaseDocumentName(label: string): string {
  return label.replace(/\.pdf$/i, "").trim();
}

function extractKnowledgeYear(item: KnowledgeItem): string {
  const match = [item.title, item.documentName, item.content]
    .join(" ")
    .match(/20\d{2}/);
  return match ? match[0] : "未标注";
}

function extractKnowledgeVenue(item: KnowledgeItem): string {
  const text = [item.title, item.documentName, item.content].join(" ");
  const venuePatterns = [
    "USENIX",
    "CCS",
    "NDSS",
    "S&P",
    "EUROCRYPT",
    "CRYPTO",
    "IEEE",
    "ACM",
    "AAAI",
    "NeurIPS",
    "ICML",
    "ICLR",
    "TDSC",
  ];
  for (const venue of venuePatterns) {
    if (text.toUpperCase().includes(venue.toUpperCase())) return venue;
  }
  return item.category || "未分类";
}

function deriveKnowledgeReadingStatus(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  if (/精读中|建议精读|精读/.test(joined)) return "精读中";
  if (/已读完|略读完成|读完|已完成/.test(joined)) return "已读完";
  if (/略读/.test(joined)) return "略读完成";
  if (/待读|待读/.test(joined)) return "待读";
  if (item.kind === "paper-card") return "精读中";
  if (item.kind === "reading-card") return "略读完成";
  return "待读";
}

function deriveKnowledgePriority(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  if (/高优先级|建议精读|核心|必读/.test(joined)) return "高优先级";
  if (/中优先级|推荐/.test(joined)) return "中优先级";
  return "常规";
}

function isKnowledgeCitable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return (
    /可引用|适合引用|引用价值|引用点|研究贡献/.test(joined) ||
    item.kind === "paper-card"
  );
}

function isKnowledgeReplicable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return /复现|实验|代码|benchmark|性能评估/i.test(joined);
}

function isKnowledgeRelatedWork(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return /相关工作|综述|survey|背景/.test(joined);
}

function isKnowledgeMethodInspiration(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return (
    /方法|思路|灵感|idea|启发|框架|设计/.test(joined) ||
    item.kind === "reading-card"
  );
}

function matchesKnowledgeFocus(
  item: KnowledgeItem,
  focus: KnowledgeFocus,
): boolean {
  if (focus === "all") return true;
  const status = deriveKnowledgeReadingStatus(item);
  if (focus === "todo") return status === "待读";
  if (focus === "deep") return status === "精读中";
  if (focus === "finished") return status === "已读完" || status === "略读完成";
  if (focus === "citable") return isKnowledgeCitable(item);
  if (focus === "replicate") return isKnowledgeReplicable(item);
  if (focus === "related") return isKnowledgeRelatedWork(item);
  if (focus === "methods") return isKnowledgeMethodInspiration(item);
  return true;
}

function getKnowledgeCitationScore(item: KnowledgeItem): number {
  const base =
    item.kind === "paper-card" ? 4.2 : item.kind === "reading-card" ? 3.9 : 3.6;
  const bonus = Math.min(
    0.7,
    item.tags.length * 0.08 + (isKnowledgeCitable(item) ? 0.25 : 0),
  );
  return Math.min(5, Math.round((base + bonus) * 10) / 10);
}

function getKnowledgeRelevancePercent(item: KnowledgeItem): number {
  const base =
    item.kind === "paper-card" ? 78 : item.kind === "reading-card" ? 72 : 65;
  const bonus = Math.min(
    20,
    item.tags.length * 3 + Math.min(12, Math.floor(item.content.length / 120)),
  );
  return Math.min(98, base + bonus);
}

function getKnowledgeExcerptForDashboard(item: KnowledgeItem): string {
  const excerpt = getKnowledgeExcerpt(item.content).replace(/\s+/g, " ").trim();
  return excerpt || "暂无摘要内容";
}

function createRatingStars(value: number): string {
  const full = Math.round(value);
  return (
    "★".repeat(Math.max(0, Math.min(5, full))) +
    "☆".repeat(Math.max(0, 5 - full))
  );
}

function updateKnowledgeItemTags(
  item: KnowledgeItem,
  updater: (tags: string[]) => string[],
): void {
  const now = new Date().toISOString();
  const nextTags = normalizeKnowledgeTags(updater([...item.tags]));
  if (item.source === "knowledge-note") {
    const notes = readSavedKnowledgeNotes().map((note) =>
      note.id === item.id ? { ...note, tags: nextTags, updatedAt: now } : note,
    );
    writeSavedKnowledgeNotes(notes);
  } else {
    const metaStore = readKnowledgeItemMetaStore();
    metaStore[item.recordKey] = {
      ...(metaStore[item.recordKey] || {}),
      tags: nextTags,
      updatedAt: now,
    };
    writeKnowledgeItemMetaStore(metaStore);
  }
}

function toggleKnowledgeSemanticTag(item: KnowledgeItem, tag: string): void {
  const exists = item.tags.includes(tag);
  updateKnowledgeItemTags(item, (tags) =>
    exists ? tags.filter((candidate) => candidate !== tag) : [...tags, tag],
  );
  setKnowledgePageStatus(exists ? `已取消“${tag}”。` : `已标记为“${tag}”。`);
  renderKnowledgeBase();
}

function renderKnowledgeMetricCards(
  items: KnowledgeItem[],
  filtered: KnowledgeItem[],
): void {
  if (!knowledgeDashboardMetricsElement) return;
  const now = Date.now();
  const withinWeek = filtered.filter(
    (item) =>
      now - new Date(item.updatedAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );
  const metrics = [
    {
      icon: "📘",
      title: "本周精读",
      value: String(
        withinWeek.filter(
          (item) => deriveKnowledgeReadingStatus(item) === "精读中",
        ).length,
      ),
      unit: "篇",
      hint: `本周更新 ${withinWeek.length}`,
    },
    {
      icon: "❝",
      title: "可引用论文",
      value: String(filtered.filter(isKnowledgeCitable).length),
      unit: "篇",
      hint: "适合写相关工作/论文引用",
    },
    {
      icon: "⚗",
      title: "待复现实验",
      value: String(filtered.filter(isKnowledgeReplicable).length),
      unit: "篇",
      hint: "建议整理代码与实验清单",
    },
    {
      icon: "💡",
      title: "研究灵感",
      value: String(filtered.filter(isKnowledgeMethodInspiration).length),
      unit: "条",
      hint: "方法、设计与启发",
    },
    {
      icon: "🗂",
      title: "知识库总量",
      value: String(items.length),
      unit: "条",
      hint: `覆盖 ${new Set(items.map((item) => item.documentName)).size} 篇文档`,
    },
  ];
  const cards = metrics.map((metric) => {
    const article = document.createElement("article");
    article.className = "knowledge-metric-card";
    article.innerHTML = `
      <div class="knowledge-metric-icon" aria-hidden="true">${metric.icon}</div>
      <div class="knowledge-metric-body">
        <span>${metric.title}</span>
        <strong>${metric.value}<em>${metric.unit}</em></strong>
        <small>${metric.hint}</small>
      </div>
    `;
    return article;
  });
  knowledgeDashboardMetricsElement.replaceChildren(...cards);
}

function renderKnowledgeStudentPanels(filtered: KnowledgeItem[]): void {
  if (knowledgeStudentWorkbenchElement) {
    const cards = [
      {
        title: "必读清单",
        desc: "把高价值、与研究方向高度相关的论文先排出来。",
        count: filtered.filter(
          (item) => deriveKnowledgePriority(item) === "高优先级",
        ).length,
        label: "待完成",
      },
      {
        title: "可引用观点",
        desc: "优先收集可直接写进相关工作和论文背景的观点。",
        count: filtered.filter(isKnowledgeCitable).length,
        label: "可引用",
      },
      {
        title: "方法对比",
        desc: "比较方法假设、性能、适用场景与局限。",
        count: Math.max(
          1,
          Math.min(
            filtered.length,
            new Set(filtered.map((item) => item.category)).size,
          ),
        ),
        label: "待对比",
      },
      {
        title: "复现实验计划",
        desc: "把需要复现的论文转成实验任务清单。",
        count: filtered.filter(isKnowledgeReplicable).length,
        label: "进行中",
      },
    ];
    const workbench = cards.map((card) => {
      const article = document.createElement("article");
      article.className = "knowledge-workbench-card";
      article.innerHTML = `
        <strong>${card.title}</strong>
        <p>${card.desc}</p>
        <footer><span>${card.label} ${card.count}</span><button type="button">→</button></footer>
      `;
      return article;
    });
    knowledgeStudentWorkbenchElement.replaceChildren(...workbench);
  }

  if (knowledgeWeeklyTasksElement) {
    const tasks = [
      {
        title: "精读 3 篇论文并完成笔记",
        current: Math.min(
          3,
          filtered.filter(
            (item) => deriveKnowledgeReadingStatus(item) === "精读中",
          ).length,
        ),
        total: 3,
      },
      {
        title: "整理可引用观点",
        current: Math.min(10, filtered.filter(isKnowledgeCitable).length),
        total: 10,
      },
      {
        title: "复现实验：补齐实验计划",
        current: Math.min(2, filtered.filter(isKnowledgeReplicable).length),
        total: 2,
      },
      {
        title: "更新相关工作综述",
        current: Math.min(1, filtered.filter(isKnowledgeRelatedWork).length),
        total: 1,
      },
    ];
    const nodes = tasks.map((task) => {
      const row = document.createElement("div");
      row.className = "knowledge-task-row";
      const percent = task.total
        ? Math.max(
            0,
            Math.min(100, Math.round((task.current / task.total) * 100)),
          )
        : 0;
      row.innerHTML = `
        <div class="knowledge-task-copy">
          <label><input type="checkbox" ${task.current >= task.total ? "checked" : ""} /> <span>${task.title}</span></label>
          <small>${task.current}/${task.total}</small>
        </div>
        <div class="knowledge-task-progress"><span style="width:${percent}%"></span></div>
      `;
      return row;
    });
    knowledgeWeeklyTasksElement.replaceChildren(...nodes);
  }
}

function syncKnowledgeFocusCounts(items: KnowledgeItem[]): void {
  if (knowledgeFocusCountTodoElement)
    knowledgeFocusCountTodoElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "todo")).length,
    );
  if (knowledgeFocusCountDeepElement)
    knowledgeFocusCountDeepElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "deep")).length,
    );
  if (knowledgeFocusCountFinishedElement)
    knowledgeFocusCountFinishedElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "finished")).length,
    );
  if (knowledgeFocusCountCitableElement)
    knowledgeFocusCountCitableElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "citable")).length,
    );
  if (knowledgeFocusCountReplicateElement)
    knowledgeFocusCountReplicateElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "replicate")).length,
    );
  if (knowledgeFocusCountRelatedElement)
    knowledgeFocusCountRelatedElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "related")).length,
    );
  if (knowledgeFocusCountMethodsElement)
    knowledgeFocusCountMethodsElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "methods")).length,
    );
  for (const button of knowledgeFocusButtons) {
    const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
    button.classList.toggle("active", focus === activeKnowledgeFocus);
  }
}

function populateKnowledgeDashboardFilters(items: KnowledgeItem[]): void {
  const syncSelect = (
    select: HTMLSelectElement | null,
    current: string,
    fallbackLabel: string,
    values: string[],
  ): void => {
    if (!select) return;
    const previous = current;
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = fallbackLabel;
    select.append(allOption);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (values.includes(previous)) select.value = previous;
    else select.value = "all";
  };

  const years = Array.from(
    new Set(
      items
        .map(extractKnowledgeYear)
        .filter((value) => value && value !== "未标注"),
    ),
  ).sort((a, b) => Number(b) - Number(a));
  const venues = Array.from(
    new Set(items.map(extractKnowledgeVenue).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const statuses = ["待读", "精读中", "已读完", "略读完成"];
  const priorities = ["高优先级", "中优先级", "常规"];

  syncSelect(knowledgeYearFilterSelect, activeKnowledgeYear, "年份", years);
  syncSelect(
    knowledgeVenueFilterSelect,
    activeKnowledgeVenue,
    "会议/期刊",
    venues,
  );
  syncSelect(
    knowledgeReadingStatusFilterSelect,
    activeKnowledgeReadingStatus,
    "阅读状态",
    statuses,
  );
  syncSelect(
    knowledgePriorityFilterSelect,
    activeKnowledgePriority,
    "优先级",
    priorities,
  );

  activeKnowledgeYear = knowledgeYearFilterSelect?.value || "all";
  activeKnowledgeVenue = knowledgeVenueFilterSelect?.value || "all";
  activeKnowledgeReadingStatus =
    knowledgeReadingStatusFilterSelect?.value || "all";
  activeKnowledgePriority = knowledgePriorityFilterSelect?.value || "all";
}

function getFilteredKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const query = knowledgeSearchInput.value.trim().toLocaleLowerCase("zh-CN");
  const filtered = items.filter((item) => {
    if (activeKnowledgeFilter !== "all" && item.kind !== activeKnowledgeFilter)
      return false;
    if (
      activeKnowledgeCategory !== "all" &&
      item.category !== activeKnowledgeCategory
    )
      return false;
    if (activeKnowledgeTag && !item.tags.includes(activeKnowledgeTag))
      return false;
    if (!matchesKnowledgeFocus(item, activeKnowledgeFocus)) return false;
    if (
      activeKnowledgeYear !== "all" &&
      extractKnowledgeYear(item) !== activeKnowledgeYear
    )
      return false;
    if (
      activeKnowledgeVenue !== "all" &&
      extractKnowledgeVenue(item) !== activeKnowledgeVenue
    )
      return false;
    if (
      activeKnowledgeReadingStatus !== "all" &&
      deriveKnowledgeReadingStatus(item) !== activeKnowledgeReadingStatus
    )
      return false;
    if (
      activeKnowledgePriority !== "all" &&
      deriveKnowledgePriority(item) !== activeKnowledgePriority
    )
      return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.content,
      item.documentName,
      item.positionLabel,
      item.category,
      extractKnowledgeVenue(item),
      extractKnowledgeYear(item),
      ...item.tags,
    ]
      .join("\n")
      .toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });

  const sort = knowledgeSortSelect.value;
  filtered.sort((left, right) => {
    if (sort === "oldest")
      return (
        new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime()
      );
    if (sort === "title") return left.title.localeCompare(right.title, "zh-CN");
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
  return filtered;
}

function renderKnowledgeSidebar(items: KnowledgeItem[]): void {
  const countByKind = (kind: KnowledgeKind) =>
    items.filter((item) => item.kind === kind).length;
  knowledgeCountAllElement.textContent = String(items.length);
  knowledgeCountNoteElement.textContent = String(countByKind("note"));
  knowledgeCountReadingCardElement.textContent = String(
    countByKind("reading-card"),
  );
  knowledgeCountPaperCardElement.textContent = String(
    countByKind("paper-card"),
  );

  const categoryCounts = new Map<string, number>();
  for (const item of items) {
    categoryCounts.set(
      item.category,
      (categoryCounts.get(item.category) || 0) + 1,
    );
  }
  const categoryButtons: HTMLButtonElement[] = [];
  const allCategoryButton = document.createElement("button");
  allCategoryButton.type = "button";
  allCategoryButton.classList.toggle(
    "active",
    activeKnowledgeCategory === "all",
  );
  allCategoryButton.innerHTML = "<span>▤ 全部分类</span>";
  const allCount = document.createElement("strong");
  allCount.textContent = String(items.length);
  allCategoryButton.append(allCount);
  allCategoryButton.addEventListener("click", () => {
    activeKnowledgeCategory = "all";
    activeKnowledgeTag = "";
    renderKnowledgeBase();
  });
  categoryButtons.push(allCategoryButton);

  for (const [category, count] of Array.from(categoryCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("active", activeKnowledgeCategory === category);
    const label = document.createElement("span");
    label.textContent = `□ ${category}`;
    const countElement = document.createElement("strong");
    countElement.textContent = String(count);
    button.append(label, countElement);
    button.addEventListener("click", () => {
      activeKnowledgeCategory = category;
      activeKnowledgeTag = "";
      renderKnowledgeBase();
    });
    categoryButtons.push(button);
  }
  knowledgeCategoryListElement.replaceChildren(...categoryButtons);

  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags)
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tagButtons = Array.from(tagCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([tag, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.toggle("active", activeKnowledgeTag === tag);
      button.textContent = `# ${tag} ${count}`;
      button.addEventListener("click", () => {
        activeKnowledgeTag = activeKnowledgeTag === tag ? "" : tag;
        activeKnowledgeCategory = "all";
        renderKnowledgeBase();
      });
      return button;
    });
  knowledgeTagListElement.replaceChildren(...tagButtons);

  const latest = [...items].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];
  knowledgeRecentSummaryElement.textContent = latest
    ? `${formatKnowledgeRelativeDate(latest.updatedAt)} · ${latest.title}`
    : "还没有保存内容";
}

function createKnowledgeItemCard(item: KnowledgeItem): HTMLElement {
  const card = document.createElement("article");
  card.className = `knowledge-item-card knowledge-dashboard-card kind-${item.kind}`;
  card.classList.toggle(
    "selected-for-research",
    selectedKnowledgeResearchKeys.has(item.recordKey),
  );
  card.dataset.recordKey = item.recordKey;
  card.tabIndex = 0;

  const status = deriveKnowledgeReadingStatus(item);
  const priority = deriveKnowledgePriority(item);
  const citationScore = getKnowledgeCitationScore(item);
  const relevance = getKnowledgeRelevancePercent(item);
  const venue = extractKnowledgeVenue(item);
  const year = extractKnowledgeYear(item);
  const excerpt = getKnowledgeExcerptForDashboard(item);

  const top = document.createElement("div");
  top.className = "knowledge-item-card-top";

  const badges = document.createElement("div");
  badges.className = "knowledge-card-badges";
  const statusBadge = document.createElement("span");
  statusBadge.className = `knowledge-badge status-${status === "精读中" ? "deep" : status === "已读完" || status === "略读完成" ? "done" : "todo"}`;
  statusBadge.textContent = status;
  const priorityBadge = document.createElement("span");
  priorityBadge.className = `knowledge-badge priority-${priority === "高优先级" ? "high" : priority === "中优先级" ? "medium" : "normal"}`;
  priorityBadge.textContent = priority;
  badges.append(statusBadge, priorityBadge);

  const meta = document.createElement("div");
  meta.className = "knowledge-card-meta";
  const time = document.createElement("time");
  time.dateTime = item.updatedAt;
  time.textContent = formatKnowledgeRelativeDate(item.updatedAt);
  const selectionLabel = document.createElement("label");
  selectionLabel.className = "knowledge-card-select";
  selectionLabel.title = "加入跨文献分析";
  const selectionInput = document.createElement("input");
  selectionInput.type = "checkbox";
  selectionInput.checked = selectedKnowledgeResearchKeys.has(item.recordKey);
  selectionInput.setAttribute(
    "aria-label",
    `选择“${item.title}”用于跨文献分析`,
  );
  const selectionMark = document.createElement("span");
  selectionMark.textContent = "✓";
  selectionLabel.append(selectionInput, selectionMark);
  selectionLabel.addEventListener("click", (event) => event.stopPropagation());
  selectionInput.addEventListener("keydown", (event) =>
    event.stopPropagation(),
  );
  selectionInput.addEventListener("change", () => {
    if (selectionInput.checked)
      selectedKnowledgeResearchKeys.add(item.recordKey);
    else selectedKnowledgeResearchKeys.delete(item.recordKey);
    card.classList.toggle("selected-for-research", selectionInput.checked);
    updateKnowledgeResearchScopeSummary();
  });
  meta.append(time, selectionLabel);
  top.append(badges, meta);

  const title = document.createElement("strong");
  title.className = "knowledge-card-title";
  title.textContent = item.title;

  const subtitle = document.createElement("div");
  subtitle.className = "knowledge-card-subtitle";
  subtitle.textContent =
    `${venue} ${year !== "未标注" ? year : ""} · ${getKnowledgeBaseDocumentName(item.documentName)}`.trim();

  const excerptElement = document.createElement("p");
  excerptElement.className = "knowledge-card-excerpt";
  excerptElement.textContent = excerpt;

  const tags = document.createElement("div");
  tags.className = "knowledge-card-tags";
  for (const tag of item.tags.slice(0, 4)) {
    const tagElement = document.createElement("span");
    tagElement.textContent = `# ${tag}`;
    tags.append(tagElement);
  }

  const metrics = document.createElement("div");
  metrics.className = "knowledge-card-metrics";
  metrics.innerHTML = `
    <div><span>引用价值</span><strong>${createRatingStars(citationScore)} <em>${citationScore.toFixed(1)}</em></strong></div>
    <div><span>研究关联度</span><strong>${relevance}%</strong></div>
    <div><span>最近复习</span><strong>${formatKnowledgeRelativeDate(item.updatedAt)}</strong></div>
  `;

  const actions = document.createElement("div");
  actions.className = "knowledge-card-actions";

  const primaryButton = document.createElement("button");
  primaryButton.type = "button";
  primaryButton.className = "knowledge-card-primary-button";
  primaryButton.textContent =
    item.source === "paper-overview" ? "打开复习页" : "查看详情";
  primaryButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (item.source === "paper-overview") openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });

  const secondButton = document.createElement("button");
  secondButton.type = "button";
  secondButton.textContent = "查看卡片";
  secondButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (item.source === "paper-overview") openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });

  const replicateButton = document.createElement("button");
  replicateButton.type = "button";
  replicateButton.textContent = isKnowledgeReplicable(item)
    ? "已加入复现"
    : "加入复现";
  replicateButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleKnowledgeSemanticTag(item, "待复现");
  });

  const citeButton = document.createElement("button");
  citeButton.type = "button";
  citeButton.textContent = isKnowledgeCitable(item)
    ? "已标记可引用"
    : "标记可引用";
  citeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleKnowledgeSemanticTag(item, "可引用");
  });

  actions.append(primaryButton, secondButton, replicateButton, citeButton);
  card.append(top, title, subtitle, excerptElement, tags, metrics, actions);

  card.addEventListener("dblclick", () => {
    if (item.source === "paper-overview") openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (item.source === "paper-overview") openSavedPaperOverviewReview(item);
      else openKnowledgeEditor(item);
    }
  });
  return card;
}

function createKnowledgeGroup(
  items: KnowledgeItem[],
  title: string,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "knowledge-group";
  const heading = document.createElement("h2");
  heading.textContent = `${title} (${items.length})`;
  const grid = document.createElement("div");
  grid.className = "knowledge-group-grid";
  grid.append(...items.map(createKnowledgeItemCard));
  section.append(heading, grid);
  return section;
}

function renderKnowledgeList(items: KnowledgeItem[]): void {
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-list-empty";
    empty.innerHTML =
      "<span>⌕</span><strong>没有找到匹配内容</strong><p>可以调整筛选条件，或从 AI 助手保存一条新笔记。</p>";
    knowledgeListElement.replaceChildren(empty);
    selectedKnowledgeRecordKey = "";
    renderKnowledgeDetail([], undefined);
    return;
  }

  if (!items.some((item) => item.recordKey === selectedKnowledgeRecordKey)) {
    selectedKnowledgeRecordKey = items[0]?.recordKey || "";
  }

  const groupBy = knowledgeGroupSelect.value;
  if (groupBy === "none") {
    knowledgeListElement.replaceChildren(...items.map(createKnowledgeItemCard));
  } else {
    const groups = new Map<string, KnowledgeItem[]>();
    for (const item of items) {
      const key = groupBy === "source" ? item.documentName : item.category;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    const sections = Array.from(groups.entries()).map(([title, group]) =>
      createKnowledgeGroup(group, title),
    );
    knowledgeListElement.replaceChildren(...sections);
  }

  renderKnowledgeDetail(
    items,
    items.find((item) => item.recordKey === selectedKnowledgeRecordKey),
  );
}

function renderKnowledgeBody(content: string): void {
  const nodes: HTMLElement[] = [];
  const lines = content.split(/\r?\n/);
  let list: HTMLUListElement | null = null;

  const flushList = (): void => {
    if (!list) return;
    nodes.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch?.[1]) {
      flushList();
      const heading = document.createElement("h4");
      heading.textContent = headingMatch[1];
      nodes.push(heading);
      continue;
    }
    const bulletMatch = line.match(/^[•*-]\s*(.+)$/);
    if (bulletMatch?.[1]) {
      list ||= document.createElement("ul");
      const item = document.createElement("li");
      item.textContent = bulletMatch[1];
      list.append(item);
      continue;
    }
    flushList();
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    nodes.push(paragraph);
  }
  flushList();
  knowledgeDetailBodyElement.replaceChildren(...nodes);
}

function renderKnowledgeDetail(
  items: KnowledgeItem[],
  item: KnowledgeItem | undefined,
): void {
  knowledgeDetailEmptyElement.hidden = Boolean(item);
  knowledgeDetailContentElement.hidden = !item;
  if (!item) return;

  knowledgeDetailTypeElement.textContent = `${getKnowledgeKindIcon(item.kind)} ${getKnowledgeKindLabel(item.kind)}`;
  knowledgeDetailTypeElement.dataset.kind = item.kind;
  knowledgeDetailTimeElement.textContent = formatKnowledgeRelativeDate(
    item.updatedAt,
  );
  knowledgeDetailTitleElement.textContent = item.title;
  knowledgeDetailDocumentElement.textContent = item.documentName;
  knowledgeDetailPositionElement.textContent =
    item.positionLabel ||
    (item.pageNumber ? `第 ${item.pageNumber} 页` : "未定位");
  knowledgeDetailCreatedElement.textContent = formatKnowledgeDate(
    item.createdAt,
  );
  knowledgeDetailUpdatedElement.textContent = formatKnowledgeDate(
    item.updatedAt,
  );

  const tags = item.tags.map((tag) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = `#${tag}`;
    element.addEventListener("click", () => {
      activeKnowledgeTag = tag;
      activeKnowledgeCategory = "all";
      renderKnowledgeBase();
    });
    return element;
  });
  knowledgeDetailTagsElement.replaceChildren(...tags);
  renderKnowledgeBody(item.content);
  knowledgeEditItemButton.textContent =
    item.source === "paper-overview" ? "打开复习页" : "编辑内容";
  knowledgeEditItemButton.title =
    item.source === "paper-overview"
      ? "打开完整论文卡片页面进行复习和修改"
      : "编辑当前知识内容";

  const related = items.filter(
    (candidate) =>
      candidate.recordKey !== item.recordKey &&
      candidate.documentName === item.documentName,
  );
  const relatedNotes = related.filter(
    (candidate) => candidate.kind === "note",
  ).length;
  const relatedCards = related.filter(
    (candidate) => candidate.kind !== "note",
  ).length;
  knowledgeRelatedSummaryElement.textContent = related.length
    ? `同一文档中还有 ${relatedNotes} 条笔记、${relatedCards} 张卡片。`
    : "当前文档暂无其他关联内容。";
  knowledgeOpenSourceButton.disabled = !item.pageNumber;
}

function getKnowledgeFilterLabel(filter: KnowledgeFilter): string {
  return {
    all: "全部内容",
    note: "保存的笔记",
    "reading-card": "阅读卡片",
    "paper-card": "论文卡片",
  }[filter];
}

function setKnowledgePageMode(mode: KnowledgePageMode): void {
  activeKnowledgePageMode = mode;
  for (const button of knowledgeModeButtons) {
    const isActive = button.dataset.knowledgeMode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
  const isLibrary = mode === "library";
  knowledgeLibraryView.hidden = !isLibrary;
  knowledgeResearchView.hidden = isLibrary;
  knowledgeQaControls.hidden = mode !== "qa";
  knowledgeInsightControls.hidden = mode !== "insights";
  knowledgeBasePageElement.classList.toggle("research-mode", !isLibrary);

  if (mode === "qa") {
    knowledgePageTitleElement.textContent = "跨文献问答";
    knowledgeResearchHeading.textContent = "跨文献问答";
    knowledgeResearchDescription.textContent =
      "让 AI 综合你保存的论文卡片、阅读卡片和笔记，并用 [K1]、[K2] 标注依据。";
    knowledgeRunResearchButton.textContent = "✦ 开始回答";
    window.setTimeout(() => knowledgeResearchQuestionInput.focus(), 0);
  } else if (mode === "insights") {
    knowledgePageTitleElement.textContent = "研究洞察";
    knowledgeResearchHeading.textContent = "研究洞察";
    knowledgeResearchDescription.textContent =
      "寻找文献共识、冲突、研究空白与可验证的新假设，并明确区分证据和 AI 推测。";
    knowledgeRunResearchButton.textContent = "◇ 生成研究洞察";
  } else {
    knowledgePageTitleElement.textContent = getKnowledgeFilterLabel(
      activeKnowledgeFilter,
    );
  }
  updateKnowledgeResearchScopeSummary();
  persistCurrentAppViewState();
}

function getKnowledgeResearchScopeItems(): KnowledgeItem[] {
  const allItems = collectKnowledgeItems();
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  if (scope === "selected") {
    return allItems.filter((item) =>
      selectedKnowledgeResearchKeys.has(item.recordKey),
    );
  }
  if (scope === "filtered") return getFilteredKnowledgeItems(allItems);
  return allItems;
}

function updateKnowledgeResearchScopeSummary(): void {
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  const items = getKnowledgeResearchScopeItems();
  const documents = new Set(items.map((item) => item.documentName)).size;
  if (scope === "selected" && !items.length) {
    knowledgeResearchScopeSummary.textContent = "尚未勾选材料";
    knowledgeResearchScopeSummary.classList.add("empty");
  } else {
    knowledgeResearchScopeSummary.textContent = `${items.length} 条内容 · ${documents} 篇文档`;
    knowledgeResearchScopeSummary.classList.remove("empty");
  }
}

function getKnowledgeResearchTokens(query: string): string[] {
  return Array.from(
    new Set(
      (query.toLocaleLowerCase("zh-CN").match(/[\p{L}\p{N}]{2,}/gu) || [])
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ).slice(0, 24);
}

function rankKnowledgeItemsForResearch(
  items: KnowledgeItem[],
  query: string,
): KnowledgeItem[] {
  const tokens = getKnowledgeResearchTokens(query);
  const scored = items.map((item, index) => {
    const title = item.title.toLocaleLowerCase("zh-CN");
    const tags = `${item.category} ${item.tags.join(" ")}`.toLocaleLowerCase(
      "zh-CN",
    );
    const documentName = item.documentName.toLocaleLowerCase("zh-CN");
    const content = item.content.toLocaleLowerCase("zh-CN");
    let score = 0;
    for (const token of tokens) {
      if (title.includes(token)) score += 8;
      if (tags.includes(token)) score += 5;
      if (documentName.includes(token)) score += 3;
      if (content.includes(token)) score += 1;
    }
    if (selectedKnowledgeResearchKeys.has(item.recordKey)) score += 2;
    return { item, index, score };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      new Date(right.item.updatedAt).getTime() -
        new Date(left.item.updatedAt).getTime() ||
      left.index - right.index,
  );

  const result: KnowledgeItem[] = [];
  const perDocument = new Map<string, number>();
  for (const entry of scored) {
    const count = perDocument.get(entry.item.documentName) || 0;
    if (count >= 3 && result.length < Math.min(8, scored.length)) continue;
    result.push(entry.item);
    perDocument.set(entry.item.documentName, count + 1);
    if (result.length >= 12) break;
  }
  return result;
}

function buildKnowledgeResearchMaterial(items: KnowledgeItem[]): string {
  const blocks: string[] = [];
  let remaining = 12_500;
  for (const [index, item] of items.entries()) {
    const cleanContent = item.content.replace(/\s+/g, " ").trim();
    const prefix = [
      `[K${index + 1}]`,
      `标题：${item.title}`,
      `类型：${getKnowledgeKindLabel(item.kind)}`,
      `来源文档：${item.documentName}`,
      `位置：${item.positionLabel}`,
      `分类与标签：${[item.category, ...item.tags].filter(Boolean).join("、") || "无"}`,
      "内容：",
    ].join("\n");
    const allowance = Math.max(280, Math.min(1_050, remaining - prefix.length));
    const excerpt = cleanContent.slice(0, allowance);
    const block = `${prefix}${excerpt}${cleanContent.length > excerpt.length ? "…" : ""}`;
    if (block.length > remaining && blocks.length >= 4) break;
    blocks.push(block);
    remaining -= block.length + 2;
    if (remaining < 500) break;
  }
  return blocks.join("\n\n");
}

function renderKnowledgeResearchSources(items: KnowledgeItem[]): void {
  const nodes = items.map((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>[K${index + 1}]</strong><span></span><small></small>`;
    const title = button.querySelector("span");
    const source = button.querySelector("small");
    if (title) title.textContent = item.title;
    if (source)
      source.textContent = `${item.documentName} · ${item.positionLabel}`;
    button.addEventListener("click", () => {
      selectedKnowledgeRecordKey = item.recordKey;
      setKnowledgePageMode("library");
      renderKnowledgeBase();
    });
    return button;
  });
  knowledgeResearchSourceList.replaceChildren(...nodes);
}

function clearKnowledgeResearchResult(): void {
  lastKnowledgeResearchAnswer = "";
  lastKnowledgeResearchQuestion = "";
  lastKnowledgeResearchItems = [];
  knowledgeResearchResult.hidden = true;
  knowledgeResearchResultBody.replaceChildren();
  knowledgeResearchSourceList.replaceChildren();
  knowledgeResearchStatus.textContent = "";
  knowledgeResearchStatus.classList.remove("error");
}

async function runKnowledgeResearch(): Promise<void> {
  if (knowledgeResearchPending) return;
  const scopeItems = getKnowledgeResearchScopeItems();
  if (!scopeItems.length) {
    knowledgeResearchStatus.textContent =
      knowledgeResearchScopeSelect.value === "selected"
        ? "请先在“内容库”中勾选材料，或改用“当前筛选结果/全部知识库”。"
        : "当前范围没有可分析的知识条目。";
    knowledgeResearchStatus.classList.add("error");
    return;
  }

  const supplementary = knowledgeInsightQuestionInput.value.trim();
  const question =
    activeKnowledgePageMode === "insights"
      ? `${activeKnowledgeInsightPrompt}${supplementary ? `\n\n用户补充要求：${supplementary}` : ""}`
      : knowledgeResearchQuestionInput.value.trim();
  if (!question) {
    knowledgeResearchStatus.textContent = "请先输入一个研究问题。";
    knowledgeResearchStatus.classList.add("error");
    knowledgeResearchQuestionInput.focus();
    return;
  }

  const rankedItems = rankKnowledgeItemsForResearch(scopeItems, question);
  const material = buildKnowledgeResearchMaterial(rankedItems);
  if (!material) {
    knowledgeResearchStatus.textContent =
      "这些条目没有足够的正文内容可供分析。";
    knowledgeResearchStatus.classList.add("error");
    return;
  }

  knowledgeResearchPending = true;
  knowledgeRunResearchButton.disabled = true;
  knowledgeResearchStatus.classList.remove("error");
  knowledgeResearchStatus.textContent = `正在综合 ${rankedItems.length} 条内容，请稍候…`;
  knowledgeResearchResult.hidden = false;
  knowledgeResearchResultKind.textContent =
    activeKnowledgePageMode === "insights" ? "研究洞察" : "跨文献问答";
  knowledgeResearchResultTitle.textContent =
    activeKnowledgePageMode === "insights"
      ? "正在生成研究洞察…"
      : question.slice(0, 56);
  knowledgeResearchResultBody.textContent = "AI 正在比较材料、寻找证据和差异…";
  renderKnowledgeResearchSources(rankedItems);

  try {
    if (!aiConfigLoaded) await loadDeepSeekConfig();
    const prompt = [
      "你是严谨的跨文献研究助手。只能依据下方“知识库材料”回答，不要假装看过未提供的论文全文。",
      "回答规则：",
      "1. 所有来自材料的关键结论都要在句末引用 [K1]、[K2]；可以同时引用多个。",
      "2. 明确区分“材料中的事实”“跨材料综合判断”和“AI 推测”。",
      "3. 新想法必须标记为【AI 推测】或【待验证假设】，并说明依据、反例和最小验证方式。",
      "4. 材料不足或互相矛盾时直接说明，不要编造作者、数据、实验结果或引用。",
      "5. 优先给出有研究价值、可验证、能形成下一步行动的回答。",
      "",
      `用户任务：${question}`,
      "",
      "知识库材料：",
      material,
    ].join("\n");
    const answer = await requestAiContent(
      [{ role: "user", content: prompt }],
      {},
    );
    lastKnowledgeResearchAnswer = answer;
    lastKnowledgeResearchQuestion = question;
    lastKnowledgeResearchItems = rankedItems;
    knowledgeResearchResultTitle.textContent =
      activeKnowledgePageMode === "insights"
        ? "研究洞察报告"
        : question.slice(0, 80);
    renderChatMarkdown(knowledgeResearchResultBody, answer);
    knowledgeResearchStatus.textContent = `完成：综合了 ${rankedItems.length} 条内容，来自 ${new Set(rankedItems.map((item) => item.documentName)).size} 篇文档。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    knowledgeResearchStatus.textContent = `分析失败：${message}`;
    knowledgeResearchStatus.classList.add("error");
    knowledgeResearchResultBody.textContent = message;
  } finally {
    knowledgeResearchPending = false;
    knowledgeRunResearchButton.disabled = false;
  }
}

function saveKnowledgeResearchResult(): void {
  if (!lastKnowledgeResearchAnswer) return;
  const isInsight = activeKnowledgePageMode === "insights";
  const title = isInsight
    ? `研究洞察：${lastKnowledgeResearchItems[0]?.category || "知识库综合"}`
    : `跨文献问答：${getKnowledgeExcerpt(lastKnowledgeResearchQuestion).slice(0, 34)}`;
  const sourceIndex = lastKnowledgeResearchItems
    .map(
      (item, index) =>
        `[K${index + 1}] ${item.title}｜${item.documentName}｜${item.positionLabel}`,
    )
    .join("\n");
  const note = addKnowledgeNote({
    title,
    content: [
      "## 研究任务",
      lastKnowledgeResearchQuestion,
      "",
      "## AI 综合结果",
      lastKnowledgeResearchAnswer,
      "",
      "## 使用的知识条目",
      sourceIndex,
    ].join("\n"),
    documentName: "知识库综合分析",
    positionLabel: `${lastKnowledgeResearchItems.length} 条知识内容`,
    category: isInsight ? "研究洞察" : "跨文献问答",
    tags: isInsight
      ? ["研究洞察", "AI 推测", "跨文献"]
      : ["跨文献问答", "知识库"],
  });
  knowledgeResearchStatus.classList.remove("error");
  knowledgeResearchStatus.textContent = `已保存“${note.title}”。`;
}

function renderKnowledgeBase(): void {
  const items = collectKnowledgeItems();
  const validKeys = new Set(items.map((item) => item.recordKey));
  selectedKnowledgeResearchKeys = new Set(
    Array.from(selectedKnowledgeResearchKeys).filter((key) =>
      validKeys.has(key),
    ),
  );
  renderKnowledgeSidebar(items);
  populateKnowledgeDashboardFilters(items);
  syncKnowledgeFocusCounts(items);
  const filtered = getFilteredKnowledgeItems(items);
  if (knowledgePageSubtitleElement) {
    knowledgePageSubtitleElement.textContent =
      activeKnowledgeFocus === "all"
        ? "管理你的文献笔记、论文卡片与综述准备，一站式助力高效科研。"
        : "聚焦当前阅读目标，优先处理最值得研究生投入时间的文献内容。";
  }
  knowledgePageTitleElement.textContent = "研究知识库";
  knowledgeTotalCountElement.textContent = String(filtered.length);
  knowledgeDocumentCountElement.textContent = String(
    new Set(filtered.map((item) => item.documentName)).size,
  );
  renderKnowledgeMetricCards(items, filtered);
  renderKnowledgeList(filtered);
  renderKnowledgeStudentPanels(filtered);
  setKnowledgePageMode(activeKnowledgePageMode);
  updateKnowledgeResearchScopeSummary();
  persistCurrentAppViewState();
}

function refreshKnowledgeBaseIfOpen(): void {
  if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
}

function openKnowledgeBasePage(): void {
  paperCardPageAbortController?.abort();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove("paper-card-page-open");
  paperCardEntryButton?.classList.remove("active");
  knowledgeBasePageElement.hidden = false;
  appFrame?.classList.add("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");
  knowledgeBasePageElement.scrollTop = 0;
  renderKnowledgeBase();
}

function closeKnowledgeBasePage(): void {
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  aiPanelToggleButton?.classList.add("active");
  persistCurrentAppViewState();
}

function getSelectedKnowledgeItem(): KnowledgeItem | undefined {
  return collectKnowledgeItems().find(
    (item) => item.recordKey === selectedKnowledgeRecordKey,
  );
}

function addKnowledgeNote(
  note: Omit<SavedKnowledgeNote, "id" | "createdAt" | "updatedAt">,
): SavedKnowledgeNote {
  const now = new Date().toISOString();
  const saved: SavedKnowledgeNote = {
    ...note,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  writeSavedKnowledgeNotes([saved, ...readSavedKnowledgeNotes()]);
  selectedKnowledgeRecordKey = getKnowledgeRecordKey(
    "knowledge-note",
    saved.id,
  );
  refreshKnowledgeBaseIfOpen();
  return saved;
}

function openKnowledgeEditor(item?: KnowledgeItem): void {
  knowledgeEditorTargetKey = item?.recordKey || null;
  knowledgeEditorHeading.textContent = item ? "编辑知识内容" : "新建笔记";
  knowledgeEditorSource.textContent = item
    ? `${item.documentName} · ${item.positionLabel}`
    : sourceName
      ? `${getDisplayFileName(sourceName)} · 第 ${Math.max(1, pdfViewer.currentPageNumber || 1)} 页`
      : "保存到本地知识库";
  knowledgeEditorTitleInput.value = item?.title || "";
  knowledgeEditorCategoryInput.value = item?.category || "AI 笔记";
  knowledgeEditorTagsInput.value = item?.tags.join(", ") || "";
  knowledgeEditorBodyInput.value = item?.content || "";
  knowledgeEditorDialog.hidden = false;
  requestAnimationFrame(() => knowledgeEditorTitleInput.focus());
}

function closeKnowledgeEditor(): void {
  knowledgeEditorDialog.hidden = true;
  knowledgeEditorTargetKey = null;
  knowledgeEditorForm.reset();
}

function saveKnowledgeEditor(): void {
  const title = knowledgeEditorTitleInput.value.trim();
  const content = knowledgeEditorBodyInput.value.trim();
  const category = knowledgeEditorCategoryInput.value.trim() || "未分类";
  const tags = normalizeKnowledgeTags(
    knowledgeEditorTagsInput.value.split(/[,，]/).map((tag) => tag.trim()),
  );
  if (!title && !content) {
    setKnowledgePageStatus("请至少填写标题或正文。", true);
    return;
  }

  if (!knowledgeEditorTargetKey) {
    const pageNumber = pdfDocument
      ? Math.max(1, pdfViewer.currentPageNumber || 1)
      : undefined;
    const chapter = pageNumber
      ? getCurrentChapterContext(pageNumber).title
      : "";
    const saved = addKnowledgeNote({
      title: title || getKnowledgeExcerpt(content).slice(0, 40) || "未命名笔记",
      content,
      documentName: sourceName ? getDisplayFileName(sourceName) : "未关联文档",
      pageNumber,
      positionLabel: pageNumber ? `${chapter} · 第 ${pageNumber} 页` : "未定位",
      category,
      tags,
    });
    selectedKnowledgeRecordKey = getKnowledgeRecordKey(
      "knowledge-note",
      saved.id,
    );
  } else {
    const item = collectKnowledgeItems().find(
      (candidate) => candidate.recordKey === knowledgeEditorTargetKey,
    );
    if (!item) {
      setKnowledgePageStatus("这条内容已不存在，请刷新后重试。", true);
      return;
    }
    const now = new Date().toISOString();
    if (item.source === "knowledge-note") {
      const notes = readSavedKnowledgeNotes().map((note) =>
        note.id === item.id
          ? {
              ...note,
              title: title || item.title,
              content,
              category,
              tags,
              updatedAt: now,
            }
          : note,
      );
      writeSavedKnowledgeNotes(notes);
    } else {
      const metaStore = readKnowledgeItemMetaStore();
      metaStore[item.recordKey] = {
        title: title || item.title,
        content,
        category,
        tags,
        updatedAt: now,
      };
      writeKnowledgeItemMetaStore(metaStore);
    }
    selectedKnowledgeRecordKey = item.recordKey;
  }

  closeKnowledgeEditor();
  setKnowledgePageStatus("内容已保存。");
  renderKnowledgeBase();
}

function deleteSelectedKnowledgeItem(): void {
  const item = getSelectedKnowledgeItem();
  if (!item) return;
  if (!window.confirm(`确定删除“${item.title}”吗？此操作不可撤销。`)) return;

  if (item.source === "knowledge-note") {
    writeSavedKnowledgeNotes(
      readSavedKnowledgeNotes().filter((note) => note.id !== item.id),
    );
  } else if (item.source === "summary-note") {
    localStorage.setItem(
      SUMMARY_NOTES_STORAGE_KEY,
      JSON.stringify(
        readSavedSummaryNotes().filter((note) => note.id !== item.id),
      ),
    );
  } else if (item.source === "reading-card") {
    localStorage.setItem(
      SAVED_CARDS_STORAGE_KEY,
      JSON.stringify(
        readSavedPaperCards().filter((card) => card.id !== item.id),
      ),
    );
  } else {
    localStorage.setItem(
      SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
      JSON.stringify(
        readSavedPaperOverviews().filter((card) => card.id !== item.id),
      ),
    );
  }

  const metaStore = readKnowledgeItemMetaStore();
  delete metaStore[item.recordKey];
  writeKnowledgeItemMetaStore(metaStore);
  selectedKnowledgeResearchKeys.delete(item.recordKey);
  selectedKnowledgeRecordKey = "";
  setKnowledgePageStatus("内容已删除。");
  renderKnowledgeBase();
}

function openSelectedKnowledgeSource(): void {
  const item = getSelectedKnowledgeItem();
  if (!item?.pageNumber) {
    setKnowledgePageStatus("这条内容没有可定位的页码。", true);
    return;
  }
  const currentDocumentName = sourceName ? getDisplayFileName(sourceName) : "";
  if (!pdfDocument || currentDocumentName !== item.documentName) {
    setKnowledgePageStatus(`请先打开来源文件“${item.documentName}”。`, true);
    return;
  }
  const pageNumber = Math.min(
    pdfDocument.numPages,
    Math.max(1, item.pageNumber),
  );
  closeKnowledgeBasePage();
  pdfViewer.currentPageNumber = pageNumber;
  requestAnimationFrame(() => {
    pdfViewer.scrollPageIntoView({ pageNumber });
    setStatus(`已定位到“${item.title}”的来源：第 ${pageNumber} 页。`);
  });
}

async function importKnowledgeNotes(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { notes?: unknown }).notes)
        ? (parsed as { notes: unknown[] }).notes
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : [];
    const imported: SavedKnowledgeNote[] = [];
    const now = new Date().toISOString();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Record<string, unknown>;
      const title = typeof value.title === "string" ? value.title.trim() : "";
      const content =
        typeof value.content === "string" ? value.content.trim() : "";
      if (!title && !content) continue;
      imported.push({
        id: crypto.randomUUID(),
        title: title || getKnowledgeExcerpt(content).slice(0, 40) || "导入笔记",
        content,
        documentName:
          typeof value.documentName === "string" && value.documentName.trim()
            ? value.documentName.trim()
            : "导入内容",
        pageNumber:
          typeof value.pageNumber === "number" &&
          Number.isFinite(value.pageNumber)
            ? Math.max(1, Math.round(value.pageNumber))
            : undefined,
        positionLabel:
          typeof value.positionLabel === "string" && value.positionLabel.trim()
            ? value.positionLabel.trim()
            : "导入内容",
        category:
          typeof value.category === "string" && value.category.trim()
            ? value.category.trim()
            : "导入笔记",
        tags: normalizeKnowledgeTags(value.tags),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!imported.length) throw new Error("文件中没有可识别的笔记。");
    writeSavedKnowledgeNotes([...imported, ...readSavedKnowledgeNotes()]);
    selectedKnowledgeRecordKey = getKnowledgeRecordKey(
      "knowledge-note",
      imported[0]!.id,
    );
    setKnowledgePageStatus(`已导入 ${imported.length} 条笔记。`);
    renderKnowledgeBase();
  } catch (error) {
    setKnowledgePageStatus(
      `导入失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    knowledgeImportInput.value = "";
  }
}

function saveTranslationAndExplanationAsNote(): void {
  const sourceText = selectedTextForAi.trim();
  const learningResult = currentEnglishLearningResult;
  const learningText = getEnglishLearningPlainText();
  if (!sourceText || !learningResult || !learningText) {
    setStatus("当前没有可保存的英语学习结果。", true);
    return;
  }

  const pageNumber = Math.max(
    1,
    selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
  );
  const chapter = getCurrentChapterContext(pageNumber).title;
  const isWord = learningResult.kind === "word";
  const note = addKnowledgeNote({
    title: `${isWord ? "单词学习" : "句子翻译"}：${getKnowledgeExcerpt(sourceText).slice(0, 34)}`,
    content: [
      "原文",
      sourceText,
      "",
      isWord ? "单词学习" : "句子学习",
      learningText,
    ].join("\n"),
    documentName: sourceName ? getDisplayFileName(sourceName) : "未关联文档",
    pageNumber,
    positionLabel: `${chapter} · 第 ${pageNumber} 页`,
    category: "英语学习",
    tags: isWord ? ["英语学习", "单词"] : ["英语学习", "句子翻译"],
  });
  setStatus(`已保存“${note.title}”到知识库。`);
}

function attachChatSaveAction(
  message: HTMLElement,
  question: string,
  answer: string,
  documentName: string,
  pageNumber: number,
): void {
  const actions = document.createElement("div");
  actions.className = "chat-message-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "保存为笔记";
  button.addEventListener("click", () => {
    const chapter = getCurrentChapterContext(pageNumber).title;
    const note = addKnowledgeNote({
      title: question
        ? `AI 问答：${getKnowledgeExcerpt(question).slice(0, 34)}`
        : "AI 问答笔记",
      content: [`问题`, question, "", "AI 回答", answer].join("\n"),
      documentName,
      pageNumber,
      positionLabel: `${chapter} · 第 ${pageNumber} 页`,
      category: "AI 对话",
      tags: ["AI 问答"],
    });
    button.disabled = true;
    button.textContent = "已保存";
    setStatus(`已保存“${note.title}”到知识库。`);
  });
  actions.append(button);
  message.append(actions);
}

function cancelPendingAutomaticTranslation(): void {
  if (autoTranslateTimer !== null) {
    clearTimeout(autoTranslateTimer);
    autoTranslateTimer = null;
  }
}

function scheduleAutomaticTranslation(text: string): void {
  cancelPendingAutomaticTranslation();

  // 用户还在拖动选区时 selectionchange 会频繁触发。
  // 等选区稳定 700ms 后再请求，避免每个字符都调用一次接口。
  autoTranslateTimer = setTimeout(() => {
    autoTranslateTimer = null;

    if (text !== selectedTextForAi || text === lastTranslatedText) {
      return;
    }

    void translateSelectedText(text);
  }, AUTO_TRANSLATE_DELAY_MS);
}

function updateAiSelectedSnippet(): void {
  const rawSelectedText = getViewerSelectionText();
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  if (!rawSelectedText) {
    lastViewerSelectionText = "";
    return;
  }
  if (
    rawSelectedText === lastViewerSelectionText
    && pageNumber === selectedTextPageNumber
  ) return;

  const automaticWordSelection = getEnglishWordSelection(rawSelectedText);
  const sourceSentence = getSelectionSentenceContext(rawSelectedText);
  const text = automaticWordSelection?.word
    || getTranslationScopeFromSelection(rawSelectedText, sourceSentence)
    || rawSelectedText;

  lastViewerSelectionText = rawSelectedText;
  selectedTextForAi = text;
  selectedTextPageNumber = pageNumber;
  setTranslationSelectionEditor(
    text,
    automaticWordSelection ? sourceSentence : text,
  );
  translationAbortController?.abort();
  moreExamplesAbortController?.abort();
  cancelPendingAutomaticTranslation();
  lastTranslatedText = "";
  currentEnglishLearningResult = null;
  setMoreExamplesButtonVisible(false);
  if (activeAssistantView === "translate") {
    scheduleAutomaticTranslation(text);
  } else {
    setTranslationLearningTitle("学习结果");
    translationLearningHintElement.textContent =
      "切换到“英语学习”后将自动处理当前选区。";
    setTranslationState("切换到“英语学习”后将自动生成学习卡片。");
  }

  if (activeSummaryScope === "selection") {
    lastSummaryRequestKey = "";
    lastSummaryPoints = [];
    currentSummaryContext = null;
    updateSummaryMetadata();
    if (activeAssistantView === "summary") scheduleSummaryGeneration();
  }

  lastCardRequestKey = "";
  currentCardContext = null;
  currentGeneratedCard = null;
  cardAbortController?.abort();
  updateCardSourceSnippet();
  if (activeAssistantView === "cards") scheduleCardGeneration();
}

function scheduleAiSelectedSnippetUpdate(): void {
  cancelAnimationFrame(aiSelectionUpdateFrame);
  aiSelectionUpdateFrame = requestAnimationFrame(updateAiSelectedSnippet);
}

async function translateSelectedText(text: string): Promise<void> {
  if (!text || text !== selectedTextForAi) return;

  void ensureTranslationHistoryLoaded();

  const selectedWord = getSelectedEnglishWord(text);
  const isWord = Boolean(selectedWord);
  const sourceSentence = normalizeLearningInlineText(
    currentEnglishLearningSourceSentence || text,
  );
  translationAbortController?.abort();
  const controller = new AbortController();
  translationAbortController = controller;
  currentEnglishLearningSourceText = text;
  currentEnglishLearningResult = null;
  setMoreExamplesButtonVisible(false);
  setTranslationLearningTitle(isWord ? "单词学习" : "句子翻译");
  translationLearningHintElement.textContent = isWord
    ? "正在结合该单词所在的原句查询语境词义、词性和例句。"
    : "正在翻译句子，并筛选其中值得学习的重点词汇。";
  if (
    isWord
    && lastViewerSelectionText
    && normalizeLearningInlineText(lastViewerSelectionText) !== selectedWord
  ) {
    translationLearningHintElement.textContent = `已自动识别为完整单词 “${selectedWord}”，正在查询其语境词义、词性和例句。`;
  }
  setTranslationState(
    isWord ? "正在生成单词学习卡片，请稍候…" : "正在翻译句子并整理重点词汇，请稍候…",
  );

  try {
    const prompt = isWord
      ? [
          "你是严谨的英汉词典与英语教师。请为一个英文单词制作学习卡。",
          `当前选中单词：${selectedWord}`,
          `该单词所在的 PDF 原句：${sourceSentence}`,
          "原句或释义中出现数学公式时，使用标准 LaTeX，并用 $...$（行内）或 $$...$$（独立公式）包裹；不要把公式改写成乱码或纯文字。",
          "先核验当前选中内容是否完整单词；若不是，selectionComplete 必须为 false。",
          "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
          "JSON 格式：",
          '{"selectionComplete":true,"headword":"单词原形或当前词形","sourceSentenceLatex":"保留英文原句并把公式重建为 $...$ 或 $$...$$","pronunciation":"音标或空字符串","partsOfSpeech":[{"label":"词性缩写","meaning":"常见中文义"}],"meaningInSentence":"该词在原句中的准确中文含义","sentenceTranslation":"原句完整中文翻译","examples":[{"sentence":"例句","translation":"中文翻译","usage":"该例句展示的不同用法"},{"sentence":"例句","translation":"中文翻译","usage":"该例句展示的不同用法"}]}',
          "规则：examples 必须正好给出 2 个原创例句，且尽量覆盖不同常见用法；不要把 PDF 原句放进 examples。",
        ].join("\n")
      : [
          "你是面向英语学习者的论文句子翻译助手。",
          `需要翻译的完整 PDF 句子或短段：${sourceSentence}`,
          "即使用户最初只框选了句子的一部分，也必须翻译这里提供的完整句子，译文不得在句中截断。",
          "保留原文中的数学关系；所有公式使用标准 LaTeX，并用 $...$（行内）或 $$...$$（独立公式）包裹，以便客户端渲染。",
          "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
          "JSON 格式：",
          '{"sourceTextLatex":"保留完整英文原句并把公式重建为 $...$ 或 $$...$$","translation":"忠实、自然的简体中文翻译并保留 LaTeX 公式","keywords":[{"word":"原文词或短语","partOfSpeech":"词性","meaningInSentence":"在本句中的准确含义","reason":"内部筛选依据，不向用户展示"}]}',
          "keywords 最多保留 6 个真正值得学习的重点单词或固定短语；没有合格项时返回空数组，不要为了数量凑词。",
          "通用筛选标准：候选项至少满足一项——大学英语六级（CET-6）及以上或 CEFR B2+ 难度；在当前学科中具有区别于日常含义的专业义；属于理解本句所必需的规范术语；属于低频、不可按字面直接理解的学术固定搭配。",
          "通用排除标准：高频基础词、常见功能词、仅因复数或时态变化而显得复杂的普通词、可由组成词直接推断含义的常用组合，以及一般研究生读者无需查词即可理解的表达。",
          "对每个候选项先在 reason 中给出内部判定依据，并据此复核是否符合上述标准；不符合就不要放入 keywords。reason 仅供内部筛选，客户端不会展示。",
        ].join("\n");
    const content = await requestAiContent(
      isWord
        ? [
            { role: "user", content: prompt },
            {
              role: "user",
              content: [
                "补充且优先执行以下要求：当前选区已由客户端识别为完整英文词形，绝不能因为过去式、过去分词、现在分词、复数、连字符词或专有名词而拒绝解释。",
                "请识别原形 headword、选中的实际词形 selectedWord、wordForm（如过去分词、过去式、现在分词、复数、专有名词等）和 namedEntityType（人名、地名、机构、作品名；没有则为空字符串）。",
                "必须返回 sourceSentenceLatex：保留英文原句的全部普通文字和标点，只把 PDF 中的数学公式重建为标准 LaTeX，并用 $...$ 或 $$...$$ 包裹；不得翻译、概括或删减英文原句。",
                "请返回该词的全部常用义项，每个义项都要有词性 label、中文 meaning 和简洁英文释义 definitionEn；文中义项放在最前。",
                "请给出 forms 词形变化列表，例如原形、第三人称单数、现在分词、过去式、过去分词、复数。",
                "examples 必须包含 3 个新的不同用法例句；PDF 原句由客户端另行展示，不要放进 examples。",
                "严格只输出 JSON，对象必须符合：{\"selectionComplete\":true,\"headword\":\"...\",\"selectedWord\":\"...\",\"sourceSentenceLatex\":\"英文原句与 $LaTeX$ 公式\",\"wordForm\":\"...\",\"namedEntityType\":\"\",\"pronunciation\":\"\",\"senses\":[{\"label\":\"v.\",\"meaning\":\"\",\"definitionEn\":\"\"}],\"forms\":[{\"label\":\"过去式\",\"value\":\"\"}],\"meaningInSentence\":\"\",\"sentenceTranslation\":\"\",\"examples\":[{\"sentence\":\"\",\"translation\":\"\",\"usage\":\"\"}]}",
              ].join("\\n"),
            },
          ]
        : [
            {
              role: "user",
              content: prompt,
            },
          ],
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
        selectedText: isWord ? text : sourceSentence,
        task: isWord ? "英语学习：单词语境释义" : "英语学习：句子翻译",
      },
      {
        model: aiConfig.translationModel || aiConfig.model,
        reasoning: "disabled",
        maxOutputTokens: Math.min(4096, aiConfig.maxOutputTokens),
      },
    );

    // Only show the result for the current selection so a slow request cannot
    // overwrite a newer word or sentence.
    if (controller.signal.aborted || text !== selectedTextForAi) return;

    lastTranslatedText = text;
    if (isWord) {
      const result = parseVocabularyLearningResult(
        content,
        selectedWord,
        sourceSentence,
      );
      if (false && !result.selectionComplete) {
        currentEnglishLearningResult = null;
        translationLearningHintElement.textContent =
          "模型判断当前内容不是完整英文单词，请重新完整选中后再查询。";
        setTranslationState("当前选区不是完整单词，请重新完整选中后再查询。");
        return;
      }
      currentEnglishLearningResult = result;
      renderVocabularyLearningResult(result);
      void storeTranslationHistoryResult(text, result);
    } else {
      const result = parseSentenceLearningResult(content, sourceSentence);
      currentEnglishLearningResult = result;
      renderSentenceLearningResult(result);
      void storeTranslationHistoryResult(text, result);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted || text !== selectedTextForAi) return;

    const message = error instanceof Error ? error.message : String(error);
    setTranslationState(`英语学习结果生成失败：${message}`, true);
  } finally {
    if (translationAbortController === controller) {
      translationAbortController = null;
    }
  }
}

async function generateMoreVocabularyExamples(): Promise<void> {
  const result = currentEnglishLearningResult;
  if (!result || result.kind !== "word") return;

  moreExamplesAbortController?.abort();
  const controller = new AbortController();
  moreExamplesAbortController = controller;
  generateMoreExamplesButton.disabled = true;
  generateMoreExamplesButton.textContent = "正在生成…";

  try {
    const existingExamples = result.examples
      .map((example) => example.sentence)
      .join("\n");
    const content = await requestAiContent(
      [
        {
          role: "user",
          content: [
            "你是英语教师，请为下面单词补充 2 个新的英语例句。",
            `单词：${result.word}`,
            `该词在论文中的语境含义：${result.meaningInSentence}`,
            "以下例句已经展示过，禁止重复或只改写：",
            existingExamples,
            "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
            'JSON 格式：{"examples":[{"sentence":"例句","translation":"中文翻译","usage":"不同含义或用法说明"},{"sentence":"例句","translation":"中文翻译","usage":"不同含义或用法说明"}]}',
          ].join("\n"),
        },
      ],
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
        selectedText: result.word,
        task: "英语学习：扩展单词例句",
      },
      {
        model: aiConfig.translationModel || aiConfig.model,
        reasoning: "disabled",
        maxOutputTokens: Math.min(4096, aiConfig.maxOutputTokens),
      },
    );
    if (controller.signal.aborted || currentEnglishLearningResult !== result) return;

    const parsed = parseAiJson(content);
    const newExamples = readVocabularyExamples(parsed.examples).filter(
      (candidate) =>
        !result.examples.some(
          (existing) =>
            normalizeLearningInlineText(existing.sentence).toLocaleLowerCase()
            === normalizeLearningInlineText(candidate.sentence).toLocaleLowerCase(),
        ),
    );
    if (!newExamples.length) {
      setStatus("没有生成新的非重复例句，请再试一次。", true);
      return;
    }
    result.examples.push(...newExamples.slice(0, 3));
    renderVocabularyLearningResult(result);
    void storeTranslationHistoryResult(
      currentEnglishLearningSourceText || result.selectedWord || result.word,
      result,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`生成更多例句失败：${message}`, true);
  } finally {
    if (moreExamplesAbortController === controller) {
      moreExamplesAbortController = null;
      generateMoreExamplesButton.disabled = false;
      generateMoreExamplesButton.textContent = "生成更多例句";
    }
  }
}

interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function clearCustomSelection() {
  document
    .querySelectorAll(".pdf-helper-selection-overlay")
    .forEach((element) => element.remove());
}

function getSelectionHeightRatio(): number {
  const ratioValue = getComputedStyle(document.documentElement)
    .getPropertyValue("--pdf-selection-height-ratio")
    .trim();
  return Math.min(1, Math.max(0.35, Number.parseFloat(ratioValue) || 0.68));
}

function mergeSelectionRects(rects: SelectionRect[]): SelectionRect[] {
  const validRects = rects.filter(
    (rect) =>
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      rect.width > 0.5 &&
      rect.height > 1,
  );
  if (validRects.length === 0) return [];

  const median = (values: number[]): number => {
    const sortedValues = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2
      ? (sortedValues[middle] ?? 0)
      : ((sortedValues[middle - 1] ?? 0) + (sortedValues[middle] ?? 0)) / 2;
  };
  const typicalHeight = Math.max(
    4,
    median(validRects.map((rect) => rect.height)),
  );
  const lineClusters: SelectionRect[][] = [];
  const byCenter = [...validRects].sort(
    (left, right) =>
      left.top + left.height / 2 - (right.top + right.height / 2) ||
      left.left - right.left,
  );

  for (const rect of byCenter) {
    const center = rect.top + rect.height / 2;
    let bestCluster: SelectionRect[] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of lineClusters) {
      const clusterCenter = median(
        cluster.map((item) => item.top + item.height / 2),
      );
      const distance = Math.abs(center - clusterCenter);
      // Formula superscripts/subscripts may have different boxes, but their
      // visual centers still remain closer than the next body-text baseline.
      if (distance <= typicalHeight * 0.82 && distance < bestDistance) {
        bestCluster = cluster;
        bestDistance = distance;
      }
    }
    if (bestCluster) bestCluster.push(rect);
    else lineClusters.push([rect]);
  }

  const merged: SelectionRect[] = [];
  for (const cluster of lineClusters) {
    const centers = cluster.map((rect) => rect.top + rect.height / 2);
    const center = median(centers);
    const lineHeight = Math.min(
      typicalHeight * 1.3,
      Math.max(
        typicalHeight * 0.78,
        median(cluster.map((rect) => rect.height)),
      ),
    );
    const horizontal = [...cluster].sort(
      (left, right) => left.left - right.left,
    );
    let segmentLeft = horizontal[0]?.left ?? 0;
    let segmentRight = horizontal[0]?.right ?? segmentLeft;

    const pushSegment = () => {
      const top = center - lineHeight / 2;
      merged.push({
        left: segmentLeft,
        top,
        right: segmentRight,
        bottom: top + lineHeight,
        width: segmentRight - segmentLeft,
        height: lineHeight,
      });
    };

    for (const rect of horizontal.slice(1)) {
      if (rect.left <= segmentRight + typicalHeight * 1.25) {
        segmentRight = Math.max(segmentRight, rect.right);
      } else {
        pushSegment();
        segmentLeft = rect.left;
        segmentRight = rect.right;
      }
    }
    pushSegment();
  }

  return merged.sort(
    (left, right) => left.top - right.top || left.left - right.left,
  );
}

function getTextNodeSelectionOffsets(
  range: Range,
  textNode: Text,
): { start: number; end: number } | null {
  const textLength = textNode.data.length;
  if (textLength === 0 || !range.intersectsNode(textNode)) return null;

  let start = 0;
  let end = textLength;

  if (range.startContainer === textNode) {
    start = Math.min(textLength, Math.max(0, range.startOffset));
  }
  if (range.endContainer === textNode) {
    end = Math.min(textLength, Math.max(0, range.endOffset));
  }

  if (start >= end) return null;
  return { start, end };
}

function collectSelectionRectsFromTextLayer(
  range: Range,
  textLayer: HTMLElement,
) {
  const page = textLayer.closest<HTMLElement>(".pdfViewer .page");
  if (!page) return [];

  const pageRect = page.getBoundingClientRect();
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const rects: SelectionRect[] = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const offsets = getTextNodeSelectionOffsets(range, textNode);
    if (!offsets) continue;

    const textRange = document.createRange();
    textRange.setStart(textNode, offsets.start);
    textRange.setEnd(textNode, offsets.end);

    for (const rect of Array.from(textRange.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;

      rects.push({
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top,
        width: rect.width,
        height: rect.height,
      });
    }

    textRange.detach();
  }

  return rects;
}

function renderCustomSelection() {
  clearCustomSelection();

  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  )
    return;

  const ratio = getSelectionHeightRatio();
  const rectsByPage = new Map<HTMLElement, SelectionRect[]>();

  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (range.collapsed) continue;

    for (const textLayer of Array.from(
      viewerElement.querySelectorAll<HTMLElement>(".textLayer"),
    )) {
      if (!range.intersectsNode(textLayer)) continue;
      const page = textLayer.closest<HTMLElement>(".pdfViewer .page");
      if (!page) continue;

      const selectedRects = collectSelectionRectsFromTextLayer(
        range,
        textLayer,
      );
      if (selectedRects.length === 0) continue;
      const pageRects = rectsByPage.get(page) ?? [];
      pageRects.push(...selectedRects);
      rectsByPage.set(page, pageRects);
    }
  }

  for (const [page, pageRects] of rectsByPage) {
    const overlay = document.createElement("div");
    overlay.className = "pdf-helper-selection-overlay";

    for (const rect of mergeSelectionRects(pageRects)) {
      const height = rect.height * ratio;
      const marker = document.createElement("span");
      marker.style.left = `${rect.left}px`;
      marker.style.top = `${rect.top + (rect.height - height) / 2}px`;
      marker.style.width = `${rect.width}px`;
      marker.style.height = `${height}px`;
      overlay.append(marker);
    }

    page.append(overlay);
  }
}

function scheduleCustomSelectionRender() {
  cancelAnimationFrame(selectionRenderFrame);
  selectionRenderFrame = requestAnimationFrame(renderCustomSelection);
}

function mergeHighlightBoxes<
  T extends { x: number; y: number; width: number; height: number },
>(boxes: T[]): T[] {
  const sorted = [...boxes]
    .filter((box) => box.width > 0 && box.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const merged: T[] = [];

  for (const box of sorted) {
    const previous = merged.at(-1);

    if (!previous) {
      merged.push({ ...box });
      continue;
    }

    const previousCenterY = previous.y + previous.height / 2;
    const boxCenterY = box.y + box.height / 2;

    const sameLine =
      Math.abs(previousCenterY - boxCenterY) <=
      Math.max(previous.height, box.height) * 0.65;

    const gap = box.x - (previous.x + previous.width);

    const closeEnough = gap <= Math.max(previous.height, box.height) * 0.9;

    if (sameLine && closeEnough) {
      const left = Math.min(previous.x, box.x);
      const top = Math.min(previous.y, box.y);
      const right = Math.max(previous.x + previous.width, box.x + box.width);
      const bottom = Math.max(previous.y + previous.height, box.y + box.height);

      previous.x = left;
      previous.y = top;
      previous.width = right - left;
      previous.height = bottom - top;
    } else {
      merged.push({ ...box });
    }
  }

  return merged.map((box) => {
    const padding = box.height * 0.08;

    return {
      ...box,
      x: Math.max(0, box.x - padding),
      width: box.width + padding * 2,
    };
  });
}

function installHighlightGeometry(uiManager: AnnotationEditorUIManager) {
  const getOriginalBoxes = uiManager.getSelectionBoxes.bind(uiManager);

  uiManager.getSelectionBoxes = (textLayer: HTMLElement | null) => {
    const boxes = getOriginalBoxes(textLayer);
    if (!boxes) return null;

    const ratio = getSelectionHeightRatio();
    const rotation = textLayer?.getAttribute("data-main-rotation") ?? "0";
    const usesHorizontalHeight = rotation === "90" || rotation === "270";

    const adjustedBoxes = boxes.map((box) => {
      if (usesHorizontalHeight) {
        const width = box.width * ratio;
        return { ...box, x: box.x + (box.width - width) / 2, width };
      }

      const height = box.height * ratio;
      return { ...box, y: box.y + (box.height - height) / 2, height };
    });

    if (usesHorizontalHeight) {
      return adjustedBoxes;
    }

    return mergeHighlightBoxes(adjustedBoxes);
  };
}

function setHighlightColor(color: string) {
  highlightColorInput.value = color;
  annotationEditor?.updateParams(
    AnnotationEditorParamsType.HIGHLIGHT_COLOR,
    color,
  );
}

function getFreeTextSize(): number {
  const value = Number.parseInt(freeTextSizeInput.value, 10);
  return Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(
      FREE_TEXT_MIN_SIZE,
      Number.isFinite(value) ? value : FREE_TEXT_DEFAULT_SIZE,
    ),
  );
}

function setFreeTextSize(size: number) {
  const normalizedSize = Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(FREE_TEXT_MIN_SIZE, Math.round(size)),
  );
  freeTextSizeInput.value = String(normalizedSize);
  annotationEditor?.updateParams(
    AnnotationEditorParamsType.FREETEXT_SIZE,
    normalizedSize,
  );
  if (isFreeTextEditor(selectedAnnotationEditor)) markUnsavedChanges();
}

function setFreeTextColor(color: string) {
  freeTextColorInput.value = color;
  annotationEditor?.updateParams(
    AnnotationEditorParamsType.FREETEXT_COLOR,
    color,
  );
  if (isFreeTextEditor(selectedAnnotationEditor)) markUnsavedChanges();
}

function getEditorParamValue(editor: any, type: number): unknown {
  const properties = editor?.propertiesToUpdate;
  if (!Array.isArray(properties)) return null;
  const pair = properties.find(
    (entry) => Array.isArray(entry) && entry[0] === type,
  );
  return pair?.[1] ?? null;
}

function syncFreeTextControls(editor: any) {
  if (!isFreeTextEditor(editor)) return;

  const size = Number(
    getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_SIZE),
  );
  if (Number.isFinite(size)) {
    freeTextSizeInput.value = String(
      Math.min(
        FREE_TEXT_MAX_SIZE,
        Math.max(FREE_TEXT_MIN_SIZE, Math.round(size)),
      ),
    );
  }

  const color = rgbColorToHex(
    getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_COLOR) ??
      editor?.color,
  );
  if (color) freeTextColorInput.value = color;
}

async function warmUpAnnotationEditorManager(
  uiManager: AnnotationEditorUIManager,
) {
  if (!pdfDocument) return;
  const documentAtStart = pdfDocument;

  try {
    await uiManager.updateMode(AnnotationEditorType.HIGHLIGHT, null, false);
    await uiManager.updateMode(AnnotationEditorType.NONE, null, false);
  } catch (error) {
    console.warn("PDF Helper annotation editor warm-up failed.", error);
  } finally {
    if (pdfDocument !== documentAtStart) return;
    activeEditorMode = AnnotationEditorType.NONE;
    viewerElement.classList.toggle("pdf-helper-ink-mode", false);
    scheduleHighlightNoteIndicatorRefresh();
    if (isOpeningDocument) markSavedChanges();
    updateControls();
  }
}

function hasAnyAnnotationEditor(): boolean {
  if (!annotationEditor || !pdfDocument) return false;

  for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
    for (const _editor of annotationEditor.getEditors(pageIndex)) return true;
  }

  return false;
}

function scheduleRestoredAnnotationEditorWarmUp() {
  if (
    !restoredAnnotationWarmUpPending ||
    !annotationEditor ||
    annotationEditorWarmUpInFlight
  ) {
    return;
  }

  annotationEditorWarmUpInFlight = true;
  window.setTimeout(() => {
    void (async () => {
      try {
        if (!annotationEditor) return;
        await warmUpAnnotationEditorManager(annotationEditor);
        if (hasAnyAnnotationEditor()) {
          restoredAnnotationWarmUpPending = false;
        }
      } finally {
        annotationEditorWarmUpInFlight = false;
      }
    })();
  }, 50);
}

function findAnnotationEditor(
  target: EventTarget | null,
  options: { includeHighlight?: boolean } = {},
): any | null {
  if (!(target instanceof Element) || !annotationEditor) return null;
  const includeHighlight = options.includeHighlight ?? true;
  const editorElement = target.closest<HTMLDivElement>(
    ".highlightEditor, .freeTextEditor, .inkEditor, .stampEditor, .signatureEditor",
  );
  const pageElement = target.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!editorElement || !Number.isInteger(pageNumber) || pageNumber < 1)
    return null;

  for (const editor of annotationEditor.getEditors(pageNumber - 1)) {
    if (!includeHighlight && isHighlightEditor(editor)) continue;
    if (editor.div === editorElement || editor.div?.contains(target))
      return editor;
  }
  return null;
}

function isPointInRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  padding = 0,
): boolean {
  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function isPointInsideHighlightShape(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  if (isPointInsideHighlightClipPath(editorElement, clientX, clientY))
    return true;

  const internal = editorElement.querySelector<HTMLElement>(".internal");
  if (!internal) return false;

  const editorPointerEvents = {
    value: editorElement.style.getPropertyValue("pointer-events"),
    priority: editorElement.style.getPropertyPriority("pointer-events"),
  };
  const internalPointerEvents = {
    value: internal.style.getPropertyValue("pointer-events"),
    priority: internal.style.getPropertyPriority("pointer-events"),
  };

  try {
    editorElement.style.setProperty("pointer-events", "auto", "important");
    internal.style.setProperty("pointer-events", "auto", "important");
    const hit = document.elementFromPoint(clientX, clientY);
    return hit === internal || internal.contains(hit);
  } finally {
    editorElement.style.setProperty(
      "pointer-events",
      editorPointerEvents.value,
      editorPointerEvents.priority,
    );
    internal.style.setProperty(
      "pointer-events",
      internalPointerEvents.value,
      internalPointerEvents.priority,
    );
  }
}

function isPointInsideHighlightClipPath(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = editorElement.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    !isPointInRect(clientX, clientY, rect)
  )
    return false;

  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute("d");
  if (!d || typeof Path2D === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return false;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return context.isPointInPath(new Path2D(d), x, y);
  } catch {
    return false;
  }
}

function isPointInsideHighlightNoteIndicator(
  editorElement: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const indicator = editorElement.querySelector<HTMLElement>(
    ".pdf-helper-note-indicator",
  );
  if (!indicator) return false;

  const rect = indicator.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    isPointInRect(clientX, clientY, rect, 2)
  );
}

function extractUrlFragmentId(value: string): string {
  const urlMatch = value.match(/url\((["']?)(.*?)\1\)/);
  const rawUrl = urlMatch?.[2] ?? value;
  const hashIndex = rawUrl.lastIndexOf("#");
  return hashIndex >= 0
    ? rawUrl.slice(hashIndex + 1)
    : rawUrl.replace(/^#/, "");
}

function getHighlightClipPath(
  editorElement: HTMLElement,
): SVGPathElement | null {
  const internal = editorElement.querySelector<HTMLElement>(".internal");
  if (!internal) return null;

  const clipPathValue =
    internal.style.clipPath || getComputedStyle(internal).clipPath;
  const clipPathId = extractUrlFragmentId(clipPathValue);
  if (!clipPathId) return null;

  const clipPath = document.getElementById(clipPathId);
  const href = clipPath
    ?.querySelector<SVGUseElement>("use")
    ?.getAttribute("href");
  if (!href) return null;

  return document.getElementById(
    extractUrlFragmentId(href),
  ) as SVGPathElement | null;
}

function getHighlightPathPoints(
  editorElement: HTMLElement,
): Array<{ x: number; y: number }> {
  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute("d");
  if (!d) return [];

  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let command = "";
  let index = 0;
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  const isCommandToken = (token: string) => /^[a-zA-Z]$/.test(token);
  const readNumber = () => {
    const value = Number(tokens[index]);
    index += 1;
    return value;
  };
  const hasNumber = () => {
    const token = tokens[index];
    return token !== undefined && !isCommandToken(token);
  };
  const addPoint = (nextX: number, nextY: number) => {
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    x = nextX;
    y = nextY;
    points.push({ x, y });
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (isCommandToken(token)) {
      command = token;
      index += 1;
    }

    const relative = command === command.toLowerCase();
    const normalizedCommand = command.toUpperCase();
    const absoluteX = (value: number) => (relative ? x + value : value);
    const absoluteY = (value: number) => (relative ? y + value : value);

    if (normalizedCommand === "M") {
      if (!hasNumber()) continue;
      const nextX = absoluteX(readNumber());
      const nextY = absoluteY(readNumber());
      addPoint(nextX, nextY);
      subpathStartX = x;
      subpathStartY = y;
      command = relative ? "l" : "L";
      continue;
    }

    if (normalizedCommand === "L") {
      while (hasNumber())
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "H") {
      while (hasNumber()) addPoint(absoluteX(readNumber()), y);
      continue;
    }

    if (normalizedCommand === "V") {
      while (hasNumber()) addPoint(x, absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "C") {
      while (hasNumber()) {
        // Control points are useful for bounding/anchoring too, so keep them.
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === "S" || normalizedCommand === "Q") {
      while (hasNumber()) {
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === "T") {
      while (hasNumber())
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === "Z") {
      addPoint(subpathStartX, subpathStartY);
      continue;
    }

    // Unknown command. Skip following numbers to avoid an infinite loop.
    while (hasNumber()) index += 1;
  }

  return points;
}

function findHighlightNoteAnchor(
  editorElement: HTMLElement,
): { x: number; y: number } | null {
  const rect = editorElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const points = getHighlightPathPoints(editorElement);
  if (points.length > 0) {
    const minY = Math.min(...points.map((point) => point.y));
    const lineTolerance = Math.max(
      0.01,
      Math.min(0.08, 18 / Math.max(rect.height, 1)),
    );
    const topLinePoints = points.filter(
      (point) => point.y <= minY + lineTolerance,
    );
    let topRightPoint = topLinePoints[0] ?? points[0];
    for (const point of topLinePoints) {
      if (!topRightPoint || point.x > topRightPoint.x) topRightPoint = point;
    }

    if (topRightPoint) {
      return {
        x: Math.max(0, Math.min(rect.width, topRightPoint.x * rect.width)),
        y: Math.max(0, Math.min(rect.height, topRightPoint.y * rect.height)),
      };
    }
  }

  return { x: rect.width, y: 0 };
}

function isPointInsideEditor(
  editor: any,
  clientX: number,
  clientY: number,
): boolean {
  const editorElement = editor?.div as HTMLElement | null;
  if (!editorElement) return false;

  if (isHighlightEditor(editor)) {
    return (
      isPointInsideHighlightNoteIndicator(editorElement, clientX, clientY) ||
      isPointInsideHighlightShape(editorElement, clientX, clientY)
    );
  }

  if (isInkEditor(editor)) {
    return false;
  }

  if (isFreeTextEditor(editor)) {
    const contentElements = Array.from(
      editorElement.querySelectorAll<HTMLElement>(
        '[contenteditable="true"], .internal',
      ),
    );
    const candidates =
      contentElements.length > 0 ? contentElements : [editorElement];
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        isPointInRect(clientX, clientY, rect, 1)
      );
    });
  }

  const rect = editorElement.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    isPointInRect(clientX, clientY, rect, 1)
  );
}

function findAnnotationEditorAtPoint(
  clientX: number,
  clientY: number,
  options: { highlightOnly?: boolean; includeHighlight?: boolean } = {},
): any | null {
  if (!annotationEditor) return null;
  const includeHighlight = options.includeHighlight ?? true;

  const hit = document.elementFromPoint(clientX, clientY);
  const pageElement = hit?.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const editors = [...annotationEditor.getEditors(pageNumber - 1)].reverse();
  for (const editor of editors) {
    if (!includeHighlight && isHighlightEditor(editor)) continue;
    if (options.highlightOnly && !isHighlightEditor(editor)) continue;
    if (isPointInsideEditor(editor, clientX, clientY)) return editor;
  }
  return null;
}

function isPointInsideSavedSelection(
  clientX: number,
  clientY: number,
): boolean {
  for (const range of contextSelectionRanges) {
    for (const rect of range.getClientRects()) {
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        isPointInRect(clientX, clientY, rect, 2)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isEditableOrControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      Boolean(
        target.closest(
          'button, input, textarea, select, [contenteditable="true"]',
        ),
      ))
  );
}

function isTextSelectionMode(): boolean {
  return (
    activeEditorMode === AnnotationEditorType.NONE ||
    activeEditorMode === AnnotationEditorType.HIGHLIGHT
  );
}

function isInkMode(): boolean {
  return activeEditorMode === AnnotationEditorType.INK;
}

function findTextLayerAtPoint(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const elements = document.elementsFromPoint(clientX, clientY);
  return (
    (elements.find(
      (element) =>
        element instanceof HTMLElement &&
        element.classList.contains("textLayer"),
    ) as HTMLElement | undefined) ?? null
  );
}

function isPointInsideTextGlyph(clientX: number, clientY: number): boolean {
  const textLayer = findTextLayerAtPoint(clientX, clientY);
  if (!textLayer) return false;

  const textItems = Array.from(
    textLayer.querySelectorAll<HTMLElement>('span[role="presentation"], span'),
  );
  for (const item of textItems) {
    if (!item.textContent?.trim()) continue;
    for (const rect of Array.from(item.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const paddingX = Math.min(18, Math.max(8, rect.height * 0.35));
      const paddingY = Math.min(5, Math.max(2, rect.height * 0.12));
      const forgivingRect = new DOMRect(
        rect.left - paddingX,
        rect.top - paddingY,
        rect.width + paddingX * 2,
        rect.height + paddingY * 2,
      );
      if (isPointInRect(clientX, clientY, forgivingRect)) return true;
    }
  }

  return false;
}

function clearDomSelection() {
  window.getSelection()?.removeAllRanges();
  clearCustomSelection();
}

function clearSelectedAnnotationState() {
  annotationEditor?.unselectAll();
  selectedAnnotationEditor = null;
  selectedHighlightEditor = null;
  contextHighlightEditor = null;
  hideSelectionContextMenu();
  hideHighlightNote();
  hideAnnotationActionBar();
}

function findHighlightEditor(target: EventTarget | null): any | null {
  const editor = findAnnotationEditor(target, { includeHighlight: true });
  return isHighlightEditor(editor) ? editor : null;
}

function getHighlightText(editor: any): string {
  return editor?.div?.getAttribute("aria-label")?.trim() || "";
}

function getEditorAnnotationId(editor: any): string {
  return (
    (typeof editor?.id === "string" && editor.id) ||
    (typeof editor?.uid === "string" && editor.uid) ||
    (typeof editor?.annotationElementId === "string" &&
      editor.annotationElementId) ||
    (typeof editor?._initialData?.annotationElementId === "string" &&
      editor._initialData.annotationElementId) ||
    (typeof editor?._initialData?.id === "string" && editor._initialData.id) ||
    ""
  );
}

function extractCommentText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.contents === "string") return value.contents.trim();
  if (typeof value.str === "string") return value.str.trim();
  if (typeof value.richText?.str === "string") return value.richText.str.trim();
  if (typeof value.contentsObj?.str === "string")
    return value.contentsObj.str.trim();
  return "";
}

function getAnnotationNoteFromValue(value: unknown): string {
  if (!isRecord(value)) return "";
  return (
    extractCommentText(value.pdfHelperNote) ||
    extractCommentText(value.comment) ||
    extractCommentText(value.popup) ||
    extractCommentText(value.contentsObj) ||
    extractCommentText(value.richText) ||
    ""
  );
}

function findLiveEditorForSerializedEntry(
  key: string,
  value: Record<string, unknown>,
): any | null {
  if (!annotationEditor || !Number.isInteger(value.pageIndex)) return null;

  const normalizedKey = normalizeStorageKey(key);
  const signature = getAnnotationGeometrySignature(value);
  const pageIndex = value.pageIndex as number;

  for (const editor of annotationEditor.getEditors(pageIndex)) {
    if (isStoredHighlightValue(value) && !isHighlightEditor(editor)) continue;

    if (getEditorStorageKeys(editor).includes(normalizedKey)) return editor;

    const editorSignature = getAnnotationGeometrySignature(
      getEditorSerializedValue(editor),
    );
    if (signature && editorSignature === signature) return editor;
  }

  return null;
}

function getStoredOrLiveAnnotationNote(
  key: string,
  value: Record<string, unknown>,
): string {
  const storedNote = getAnnotationNoteFromValue(value);
  if (storedNote) return storedNote;

  const liveEditor = findLiveEditorForSerializedEntry(key, value);
  if (!liveEditor) return "";

  return getHighlightNote(liveEditor);
}

function getHighlightNote(editor: any): string {
  const annotationId = getEditorAnnotationId(editor);
  const geometrySignature = getAnnotationGeometrySignature(
    getEditorSerializedValue(editor),
  );
  const storageKeys = getEditorStorageKeys(editor);
  const note =
    extractCommentText(editor?.pdfHelperNote) ||
    extractCommentText(editor?._pdfHelperNote) ||
    extractCommentText(editor?.comment) ||
    extractCommentText(editor?._initialData?.pdfHelperNote) ||
    extractCommentText(editor?._initialData?.comment) ||
    extractCommentText(editor?._initialData?.contentsObj) ||
    extractCommentText(editor?._initialData?.richText) ||
    extractCommentText(editor?.data?.pdfHelperNote) ||
    extractCommentText(editor?.data?.contentsObj) ||
    getRememberedHelperNote(storageKeys, geometrySignature) ||
    (geometrySignature
      ? restoredHelperNotesBySignature.get(geometrySignature)?.trim()
      : "") ||
    (annotationId ? nativeAnnotationNotes.get(annotationId)?.trim() : "") ||
    "";

  if (note) {
    editor.pdfHelperNote = note;
    editor._pdfHelperNote = note;
    for (const key of storageKeys)
      rememberHelperNote(key, geometrySignature, note);
  }

  return note;
}

function collectNativeAnnotationNotes(pageNumber?: number) {
  const pageSelector =
    typeof pageNumber === "number"
      ? `.page[data-page-number="${pageNumber}"]`
      : ".page";

  for (const page of Array.from(
    viewerElement.querySelectorAll<HTMLElement>(pageSelector),
  )) {
    const highlightAnnotations = page.querySelectorAll<HTMLElement>(
      ".annotationLayer .highlightAnnotation[data-annotation-id]",
    );

    for (const highlightAnnotation of Array.from(highlightAnnotations)) {
      const annotationId = highlightAnnotation.dataset.annotationId;
      if (!annotationId) continue;

      const ownPopupText = highlightAnnotation
        .querySelector<HTMLElement>(".popupContent")
        ?.textContent?.trim();
      const nextPopup = highlightAnnotation.nextElementSibling;
      const siblingPopupText = nextPopup?.classList.contains("popupAnnotation")
        ? nextPopup
            .querySelector<HTMLElement>(".popupContent")
            ?.textContent?.trim()
        : "";
      const note = ownPopupText || siblingPopupText || "";

      if (note) {
        nativeAnnotationNotes.set(annotationId, note);
      }
    }
  }
}

function updateHighlightNoteIndicator(editor: any) {
  const container = editor?.div as HTMLDivElement | null;
  if (!container) return;

  let indicator = container.querySelector<HTMLElement>(
    ".pdf-helper-note-indicator",
  );
  if (!getHighlightNote(editor)) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "pdf-helper-note-indicator";
    indicator.textContent = "●";
    indicator.setAttribute("aria-label", "此高亮有笔记");
    container.append(indicator);
  }

  const anchor = findHighlightNoteAnchor(container);
  if (anchor) {
    indicator.style.left = `${anchor.x}px`;
    indicator.style.top = `${anchor.y}px`;
  } else {
    indicator.style.left = "";
    indicator.style.top = "";
  }
}

function refreshHighlightNoteIndicators(pageNumber?: number) {
  if (!annotationEditor) return;
  collectNativeAnnotationNotes(pageNumber);

  const pageIndexes =
    typeof pageNumber === "number"
      ? [pageNumber - 1]
      : Array.from({ length: pdfDocument?.numPages ?? 0 }, (_, index) => index);

  for (const pageIndex of pageIndexes) {
    if (pageIndex < 0) continue;
    for (const editor of annotationEditor.getEditors(pageIndex)) {
      if (isHighlightEditor(editor)) updateHighlightNoteIndicator(editor);
    }
  }
}

function scheduleHighlightNoteIndicatorRefresh(pageNumber?: number) {
  requestAnimationFrame(() => {
    refreshHighlightNoteIndicators(pageNumber);
    window.setTimeout(() => refreshHighlightNoteIndicators(pageNumber), 0);
  });
}

function getAnnotationTypeName(editor: any): string {
  if (isHighlightEditor(editor)) return "高亮";
  if (isFreeTextEditor(editor)) return "文本";
  if (isInkEditor(editor)) return "画笔";
  return "批注";
}

function hideAnnotationActionBar() {
  annotationActionBar.hidden = true;
  freeTextSizeControl.hidden = true;
}

function showAnnotationActionBar(editor: any) {
  if (!editor?.div) return;
  const isTextEditor = isFreeTextEditor(editor);
  annotationTypeLabel.hidden = true;
  freeTextSizeControl.hidden = !isTextEditor;
  if (isTextEditor) syncFreeTextControls(editor);
  annotationTypeLabel.textContent = `${getAnnotationTypeName(editor)}批注`;
  annotationActionBar.hidden = false;
  const anchor = editor.div.getBoundingClientRect();
  const rect = annotationActionBar.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, anchor.right - rect.width),
    window.innerWidth - rect.width - 8,
  );
  const preferredTop = anchor.top - rect.height - 8;
  const top =
    preferredTop >= 8
      ? preferredTop
      : Math.min(anchor.bottom + 8, window.innerHeight - rect.height - 8);
  annotationActionBar.style.left = `${left}px`;
  annotationActionBar.style.top = `${top}px`;
}

function selectAnnotation(editor: any, showActions = true) {
  if (!annotationEditor || !editor) return;
  annotationEditor.setSelected(editor);
  selectedAnnotationEditor = editor;
  selectedHighlightEditor = isHighlightEditor(editor) ? editor : null;
  if (selectedHighlightEditor) updateHighlightNoteIndicator(editor);
  if (showActions) showAnnotationActionBar(editor);
}

function selectHighlight(editor: any) {
  selectAnnotation(editor);
}

function positionFloatingElement(element: HTMLElement, anchor: DOMRect) {
  element.hidden = false;
  const rect = element.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, anchor.right + 10),
    window.innerWidth - rect.width - 8,
  );
  const top = Math.min(
    Math.max(8, anchor.top),
    window.innerHeight - rect.height - 8,
  );
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function showHighlightNote(editor: any, focusEditor = false) {
  if (!editor?.div) return;
  selectHighlight(editor);
  const note = getHighlightNote(editor);
  openHighlightNoteEditor = editor;
  highlightNoteTitle.textContent = note ? "高亮笔记" : "添加笔记";
  highlightNoteQuote.textContent = getHighlightText(editor);
  highlightNoteText.value = note;
  deleteHighlightNoteButton.hidden = !note;
  positionFloatingElement(
    highlightNotePopover,
    editor.div.getBoundingClientRect(),
  );
  if (focusEditor) highlightNoteText.focus();
}

function hideHighlightNote() {
  highlightNotePopover.hidden = true;
  openHighlightNoteEditor = null;
}

function toggleHighlightNote(editor: any) {
  if (openHighlightNoteEditor === editor && !highlightNotePopover.hidden) {
    hideHighlightNote();
    return;
  }
  showHighlightNote(editor);
}

function saveHighlightNote() {
  if (!selectedHighlightEditor) return;
  const text = highlightNoteText.value.trim();
  selectedHighlightEditor.comment = text || null;
  selectedHighlightEditor.pdfHelperNote = text || "";
  selectedHighlightEditor._pdfHelperNote = text || "";
  const annotationId = getEditorAnnotationId(selectedHighlightEditor);
  const signature = getAnnotationGeometrySignature(
    getEditorSerializedValue(selectedHighlightEditor),
  );
  const storageKeys = getEditorStorageKeys(selectedHighlightEditor);
  if (annotationId) {
    if (text) {
      nativeAnnotationNotes.set(annotationId, text);
    } else {
      nativeAnnotationNotes.delete(annotationId);
    }
  }
  for (const key of storageKeys) {
    if (text) {
      rememberHelperNote(key, signature, text);
    } else {
      forgetHelperNote(key, signature);
    }
  }
  if (storageKeys.length === 0 && signature) {
    if (text) rememberHelperNote(undefined, signature, text);
    else forgetHelperNote(undefined, signature);
  }
  selectedHighlightEditor.addToAnnotationStorage?.();
  updateHighlightNoteIndicator(selectedHighlightEditor);
  markUnsavedChanges();
  setStatus(text ? "高亮笔记已保存。" : "高亮笔记已删除。");
  hideHighlightNote();
}

function deleteSelectedAnnotation() {
  if (!annotationEditor || !selectedAnnotationEditor) return;
  const typeName = getAnnotationTypeName(selectedAnnotationEditor);
  annotationEditor.setSelected(selectedAnnotationEditor);
  annotationEditor.delete();
  selectedAnnotationEditor = null;
  selectedHighlightEditor = null;
  contextHighlightEditor = null;
  hideHighlightNote();
  hideSelectionContextMenu();
  hideAnnotationActionBar();
  markUnsavedChanges();
  setStatus(`${typeName}批注已删除，可使用撤销恢复。`);
}

function deleteSelectedHighlight() {
  deleteSelectedAnnotation();
}

function saveContextSelection() {
  const selection = window.getSelection();
  contextSelectionRanges = [];
  contextSelectionText = "";
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  )
    return;

  contextSelectionText = selection.toString();
  for (let index = 0; index < selection.rangeCount; index += 1) {
    contextSelectionRanges.push(selection.getRangeAt(index).cloneRange());
  }
}

function restoreContextSelection() {
  const selection = window.getSelection();
  if (!selection || contextSelectionRanges.length === 0) return false;
  selection.removeAllRanges();
  for (const range of contextSelectionRanges) selection.addRange(range);
  return true;
}

function hideSelectionContextMenu() {
  selectionContextMenu.hidden = true;
}

function showSelectionContextMenuAt(
  clientX: number,
  clientY: number,
  editor: any | null,
) {
  contextHighlightEditor = editor;
  const isHighlightMenu = Boolean(editor);
  contextCopyButton.hidden = isHighlightMenu;
  contextCleanCopyButton.hidden = isHighlightMenu;
  contextColors.hidden = isHighlightMenu;
  highlightContextActions.hidden = false;
  contextDeleteHighlightButton.hidden = !isHighlightMenu;
  contextNoteButton.textContent =
    editor && getHighlightNote(editor) ? "编辑笔记" : "添加笔记";

  if (editor) {
    contextSelectionText = getHighlightText(editor);
  }

  selectionContextMenu.hidden = false;
  const menuRect = selectionContextMenu.getBoundingClientRect();
  selectionContextMenu.style.left = `${Math.min(clientX, window.innerWidth - menuRect.width - 8)}px`;
  selectionContextMenu.style.top = `${Math.min(clientY, window.innerHeight - menuRect.height - 8)}px`;
}

async function createQuickHighlight(color: string): Promise<any | null> {
  if (!annotationEditor || !restoreContextSelection()) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const anchorNode = selection.anchorNode;
  const anchorElement =
    anchorNode?.nodeType === Node.TEXT_NODE
      ? anchorNode.parentElement
      : (anchorNode as Element | null);
  const textLayer = anchorElement?.closest<HTMLElement>(".textLayer");
  const pageElement = textLayer?.closest<HTMLElement>(".pdfViewer .page");
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!textLayer || !Number.isInteger(pageNumber) || pageNumber < 1)
    return null;

  const pageIndex = pageNumber - 1;
  const editorsBefore = new Set(annotationEditor.getEditors(pageIndex));
  annotationEditor.unselectAll();
  selectedAnnotationEditor = null;
  selectedHighlightEditor = null;
  hideAnnotationActionBar();
  hideSelectionContextMenu();

  try {
    await annotationEditor.updateMode(
      AnnotationEditorType.HIGHLIGHT,
      null,
      true,
    );
    if (!restoreContextSelection())
      throw new Error("文字选区已经失效，请重新选择。");
    setHighlightColor(color);
    annotationEditor.highlightSelection("context_menu");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    await annotationEditor.updateMode(AnnotationEditorType.NONE, null, true);
    setEditorMode(AnnotationEditorType.NONE);
    clearDomSelection();
  }

  const createdEditor = [...annotationEditor.getEditors(pageIndex)].find(
    (editor) => !editorsBefore.has(editor) && isHighlightEditor(editor),
  );

  if (!createdEditor) {
    setStatus("快速高亮创建失败，请重新选择文字后再试。", true);
    return null;
  }

  setStatus("高亮已创建，当前仍为移动/选择模式。");
  markUnsavedChanges();
  return createdEditor;
}

async function highlightCurrentSelectionFromToolbar() {
  saveContextSelection();

  if (!contextSelectionText.trim()) {
    setEditorMode(AnnotationEditorType.NONE);
    setStatus("请先用鼠标选中文字，再点击“高亮”。", true);
    return;
  }

  await createQuickHighlight(highlightColorInput.value);
}

function setEditorMode(mode: number) {
  if (!pdfDocument) return;
  pdfViewer.annotationEditorMode = { mode };
  activeEditorMode = mode;
  viewerElement.classList.toggle(
    "pdf-helper-ink-mode",
    mode === AnnotationEditorType.INK,
  );

  const modeNames: Record<string, number> = {
    select: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    ink: AnnotationEditorType.INK,
    text: AnnotationEditorType.FREETEXT,
  };

  for (const button of editorModeButtons) {
    button.classList.toggle(
      "active",
      modeNames[button.dataset.editorMode || ""] === mode,
    );
  }

  if (mode === AnnotationEditorType.NONE) {
    textStatus.textContent =
      "选择模式：拖选可复制；单击批注后拖动，双击文本可修改";
  } else if (mode === AnnotationEditorType.HIGHLIGHT) {
    textStatus.textContent =
      "高亮模式：拖选文字生成高亮；完成后切回“移动/选择”";
  } else if (mode === AnnotationEditorType.INK) {
    textStatus.textContent =
      "画笔模式：按住鼠标绘制；完成后切回“移动/选择”再移动";
  } else if (mode === AnnotationEditorType.FREETEXT) {
    textStatus.textContent =
      "文本模式：点击页面输入；点击空白结束，切回“移动/选择”可拖动";
  }
}

async function openPdf(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null = null,
  shouldConfirmUnsavedChanges = true,
) {
  if (
    shouldConfirmUnsavedChanges &&
    pdfDocument &&
    !confirmDiscardUnsavedChanges()
  )
    return;
  isOpeningDocument = true;
  cancelPendingAutomaticTranslation();
  cancelPendingSummaryGeneration();
  cancelPendingCardGeneration();
  translationAbortController?.abort();
  moreExamplesAbortController?.abort();
  summaryAbortController?.abort();
  cardAbortController?.abort();
  cancelReadingPositionSave();
  currentRecentEntryId = null;
  pendingReadingPosition = null;
  isRestoringReadingPosition = false;
  clearInternalNavigationHistory();

  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = "正在建立文字层…";

  try {
    if (pdfDocument) {
      await pdfDocument.destroy();
      pdfDocument = null;
    }

    const rawPdfBytes =
      data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
    sourcePdfBytes = rawPdfBytes;
    const loadingTask = getDocument({ data: new Uint8Array(rawPdfBytes) });
    const documentProxy = await loadingTask.promise;
    pdfDocument = documentProxy;
    sourceName = name;
    currentFileHandle = fileHandle;
    const displayName = getDisplayFileName(name);
    documentNameElement.textContent = displayName;
    documentNameElement.title = name;
    annotationEditor = null;
    activeEditorMode = AnnotationEditorType.NONE;
    canUndoAnnotation = false;
    canRedoAnnotation = false;
    nativeAnnotationNotes.clear();
    restoredHelperNotesBySignature.clear();
    restoredHelperNotesByStorageKey.clear();
    restoredAnnotationWarmUpPending = false;
    annotationEditorWarmUpInFlight = false;
    const restoredAnnotations = await restoreHelperAnnotations(documentProxy);
    restoredAnnotationWarmUpPending = restoredAnnotations > 0;
    const recentEntry = await rememberRecentPdf(
      name,
      fileHandle,
      fileHandle
        ? undefined
        : name.startsWith("http://") || name.startsWith("https://")
          ? name
          : undefined,
    );
    currentRecentEntryId = recentEntry?.id ?? null;
    pendingReadingPosition = recentEntry?.readingPosition ?? null;

    pdfViewer.setDocument(documentProxy);
    linkService.setDocument(documentProxy);
    findController.setDocument(documentProxy);
    selectedTextForAi = "";
    selectedTextPageNumber = 0;
    lastViewerSelectionText = "";
    lastTranslatedText = "";
    currentEnglishLearningResult = null;
    currentEnglishLearningSourceSentence = "";
    setTranslationSelectionEditor("", "");
    translationHistoryDocumentKey = "";
    translationHistoryEntries = [];
    renderTranslationHistory();
    void ensureTranslationHistoryLoaded();
    setTranslationLearningTitle("学习结果");
    translationLearningHintElement.textContent =
      "选一个单词可查看语境词义、词性和例句；选一句话可获得翻译与重点词讲解。";
    setTranslationState("选中英文后将自动生成学习卡片。");
    setMoreExamplesButtonVisible(false);
    clearPendingChatImages();
    await restoreChatConversation(documentProxy);
    resetSummaryState();
    resetCardState();
    resetPaperCardPageState();
    void renderDocumentOutline(documentProxy);
    void loadReadingModeForDocument(documentProxy);
    if (!paperCardPageElement.hidden) void generatePaperOverviewCard();
    markSavedChanges();
    window.setTimeout(() => {
      if (pdfDocument !== documentProxy) return;
      markSavedChanges();
      isOpeningDocument = false;
      updateControls();
    }, 500);
    if (restoredAnnotations > 0) {
      setStatus(`已载入 PDF 内嵌 PDF Helper 批注：${restoredAnnotations} 条。`);
    }
    updateControls();
  } catch (error) {
    isOpeningDocument = false;
    pdfDocument = null;
    currentFileHandle = null;
    currentRecentEntryId = null;
    pendingReadingPosition = null;
    isRestoringReadingPosition = false;
    sourcePdfBytes = null;
    restoredAnnotationWarmUpPending = false;
    annotationEditorWarmUpInFlight = false;
    clearOutlineList("打开 PDF 后显示目录");
    readingModeDocumentKey = "";
    readingModePreference = "auto";
    resolvedReadingMode = "general";
    readingModeRationale = "";
    readingModeError = "";
    updateReadingModeUi();
    resetSummaryState();
    resetCardState();
    sourceName = "";
    resetPaperCardPageState();
    documentNameElement.textContent = "打开失败";
    documentNameElement.title = "";
    updateControls();
    setStatus(error instanceof Error ? error.message : String(error), true);
    textStatus.textContent = "PDF解析失败";
  }
}

function getDisplayFileName(source: string): string {
  try {
    const pathname =
      source.startsWith("http://") || source.startsWith("https://")
        ? new URL(source).pathname
        : source;
    return (
      decodeURIComponent(pathname.split(/[\\/]/).pop() || source) ||
      "未命名.pdf"
    );
  } catch {
    return source.split(/[\\/]/).pop() || source;
  }
}

async function openRemotePdf(url: string) {
  setStatus(`正在下载 ${url}…`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    await openPdf(await response.arrayBuffer(), url);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function runSearch(findPrevious: boolean, again: boolean) {
  const query = findInput.value.trim();
  if (!query || !pdfDocument) return;

  eventBus.dispatch("find", {
    source: window,
    type: again ? "again" : "",
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: true,
  });
}

function openFindBar() {
  if (!pdfDocument) return;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}

function closeFindBar() {
  findBar.hidden = true;
  findCount.textContent = "0/0";
  eventBus.dispatch("findbarclose", { source: window });
  viewerContainer.focus();
}

eventBus.on("pagesinit", () => {
  restoreReadingPositionAfterPagesInit();
  setStatus(
    `${getDisplayFileName(sourceName)} · ${pdfDocument?.numPages ?? 0} 页`,
  );
  setEditorMode(AnnotationEditorType.NONE);
  scheduleHighlightNoteIndicatorRefresh();
  updateControls();
});

eventBus.on("pagechanging", () => {
  updateControls();
  updateSummaryMetadata();
  scheduleReadingPositionSave();

  if (!summaryPanelElement.hidden && activeSummaryScope !== "selection") {
    lastSummaryRequestKey = "";
    lastSummaryPoints = [];
    currentSummaryContext = null;
    scheduleSummaryGeneration();
  }

  if (!selectedTextForAi) updateCardSourceSnippet();
});
eventBus.on("scalechanging", () => {
  updateControls();
  scheduleReadingPositionSave();
});
eventBus.on(
  "updatefindmatchescount",
  ({
    matchesCount,
  }: {
    matchesCount?: { current?: number; total?: number };
  }) => {
    findCount.textContent = `${matchesCount?.current ?? 0}/${matchesCount?.total ?? 0}`;
  },
);
eventBus.on(
  "annotationeditoruimanager",
  ({ uiManager }: { uiManager: AnnotationEditorUIManager }) => {
    annotationEditor = uiManager;
    installHighlightGeometry(uiManager);
    setHighlightColor(highlightColorInput.value);
    setFreeTextSize(getFreeTextSize());
    setFreeTextColor(freeTextColorInput.value);
    scheduleRestoredAnnotationEditorWarmUp();
    updateControls();
  },
);
eventBus.on("annotationeditormodechanged", ({ mode }: { mode: number }) => {
  activeEditorMode = mode;
  viewerElement.classList.toggle(
    "pdf-helper-ink-mode",
    mode === AnnotationEditorType.INK,
  );
  scheduleHighlightNoteIndicatorRefresh();
  updateControls();
});
eventBus.on("editorsrendered", ({ pageNumber }: { pageNumber: number }) => {
  scheduleHighlightNoteIndicatorRefresh(pageNumber);
  scheduleRestoredAnnotationEditorWarmUp();
});
eventBus.on(
  "annotationeditorlayerrendered",
  ({ pageNumber }: { pageNumber: number }) => {
    scheduleHighlightNoteIndicatorRefresh(pageNumber);
    scheduleRestoredAnnotationEditorWarmUp();
  },
);
eventBus.on(
  "annotationlayerrendered",
  ({ pageNumber }: { pageNumber: number }) => {
    scheduleHighlightNoteIndicatorRefresh(pageNumber);
    scheduleRestoredAnnotationEditorWarmUp();
  },
);
eventBus.on(
  "editingstateschanged",
  ({
    details,
  }: {
    details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean };
  }) => {
    canUndoAnnotation = Boolean(details.hasSomethingToUndo);
    canRedoAnnotation = Boolean(details.hasSomethingToRedo);
    scheduleUnsavedChangesCheck();
    updateControls();
  },
);

const toolbarMenus = Array.from(
  document.querySelectorAll<HTMLElement>("[data-toolbar-menu]"),
);

function setToolbarMenuOpen(menu: HTMLElement, open: boolean): void {
  const trigger = menu.querySelector<HTMLButtonElement>(
    ".toolbar-menu-trigger",
  );
  const panel = menu.querySelector<HTMLElement>(".toolbar-menu-panel");
  if (!trigger || !panel) return;

  menu.classList.toggle("open", open);
  trigger.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
}

function closeToolbarMenus(except?: HTMLElement): void {
  for (const menu of toolbarMenus) {
    if (menu !== except) setToolbarMenuOpen(menu, false);
  }
}

for (const menu of toolbarMenus) {
  const trigger = menu.querySelector<HTMLButtonElement>(
    ".toolbar-menu-trigger",
  );
  const panel = menu.querySelector<HTMLElement>(".toolbar-menu-panel");
  if (!trigger || !panel) continue;

  trigger.addEventListener("click", () => {
    const willOpen = panel.hidden;
    closeToolbarMenus(menu);
    setToolbarMenuOpen(menu, willOpen);
  });

  panel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest('button, label[role="menuitem"]');
    const isColorPicker = Boolean(target.closest(".highlight-color-control"));
    if (action && !isColorPicker) {
      window.setTimeout(() => setToolbarMenuOpen(menu, false), 0);
    }
  });
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!toolbarMenus.some((menu) => menu.contains(target))) closeToolbarMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeToolbarMenus();
  if (!assistantSettingsPanel.hidden) setDeepSeekSettingsOpen(false);
});

outlineToggleButton?.addEventListener("click", () => {
  setLeftPanelCollapsed(!appFrame?.classList.contains("left-panel-collapsed"));
});

aiPanelToggleButton?.addEventListener("click", () => {
  if (!paperCardPageElement.hidden) {
    closePaperCardPage();
    appFrame?.classList.remove("right-panel-collapsed");
    setAssistantView("chat");
    return;
  }
  const willOpen =
    appFrame?.classList.contains("right-panel-collapsed") ?? false;
  appFrame?.classList.toggle("right-panel-collapsed");
  if (willOpen) setAssistantView("chat");
});

focusModeButton.addEventListener("click", () => {
  setFocusMode(!appFrame?.classList.contains("focus-mode"));
});

for (const button of assistantViewButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.assistantView as AssistantView | undefined;
    if (view) setAssistantView(view);
  });
}

aiSettingsButton.addEventListener("click", () => {
  setDeepSeekSettingsOpen(assistantSettingsPanel.hidden);
});

readingModeSelect.addEventListener("change", () => {
  const preference = readingModeSelect.value;
  if (isReadingModePreference(preference))
    void setReadingModePreference(preference);
});

detectReadingModeButton.addEventListener("click", () => {
  readingModePreference = "auto";
  void detectReadingMode(true);
});

aiProviderSelect.addEventListener("change", () => {
  const providerId = aiProviderSelect.value as AiProviderId;
  const provider = AI_PROVIDERS.find((item) => item.id === providerId);
  if (!provider?.available) {
    aiProviderSelect.value = aiConfig.providerId;
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent = "该模型供应商尚未接入。";
    return;
  }
  deepSeekBaseUrlInput.value = provider.defaultBaseUrl;
});

visionAiModeSelect.addEventListener("change", updateVisionAiFieldsVisibility);

closeDeepSeekSettingsButton.addEventListener("click", () => {
  setDeepSeekSettingsOpen(false);
});

settingsModalBackdrop.addEventListener("pointerdown", (event) => {
  if (event.target !== settingsModalBackdrop) return;
  setDeepSeekSettingsOpen(false);
});

saveDeepSeekSettingsButton.addEventListener("click", () => {
  void saveDeepSeekConfig().then((saved) => {
    if (!saved) return;

    setDeepSeekSettingsOpen(false);
    showSettingsSavedFeedback();

    if (pdfDocument && readingModePreference === "auto") {
      void detectReadingMode(true);
    }
  });
});

testDeepSeekButton.addEventListener("click", () => {
  void testDeepSeekConnection();
});

testVisionAiButton.addEventListener("click", () => {
  void testVisionAiConnection();
});

refreshLongTermMemoriesButton.addEventListener("click", () => {
  void refreshLongTermMemoryList();
});

longTermMemoryList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-memory-id]",
  );
  const memoryId = button?.dataset.memoryId;
  if (!memoryId) return;
  button.disabled = true;
  void memoryTools
    .forget(memoryId)
    .then(() => refreshLongTermMemoryList())
    .catch((error) => {
      button.disabled = false;
      console.warn("[PDF Helper 长期记忆] 删除失败", error);
    });
});

chatCompressionMaxRecentMessagesInput.addEventListener("input", () => {
  const maxRecent = Math.max(
    4,
    Math.trunc(Number(chatCompressionMaxRecentMessagesInput.value) || 16),
  );
  chatCompressionKeepRecentMessagesInput.max = String(maxRecent - 1);
});

deepSeekThinkingSelect.addEventListener("change", () => {
  aiConfig = {
    ...aiConfig,
    reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
  };
  if (aiConfigLoaded)
    void browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendChatMessage();
});

chatImageButton.addEventListener("click", () => {
  if (!chatRequestPending) chatImageInput.click();
});

chatImageInput.addEventListener("change", () => {
  const files = chatImageInput.files;
  if (files?.length) void addChatImageFiles(files);
  chatImageInput.value = "";
});

chatInput.addEventListener("paste", (event) => {
  const imageFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (imageFiles.length === 0) return;
  event.preventDefault();
  void addChatImageFiles(imageFiles);
});

clearChatButton.addEventListener("click", () => {
  if (chatRequestPending) return;
  if (
    chatHistory.length > 0 &&
    !window.confirm("确定清空当前 PDF 的全部聊天记录吗？")
  )
    return;
  const documentAtClear = pdfDocument;
  resetChatConversation();
  void queueChatConversationPersistence(documentAtClear).then(() => {
    console.info("[PDF Helper 对话存储] 已清空当前 PDF 对话", {
      documentId: documentAtClear
        ? getDocumentChatId(documentAtClear)
        : undefined,
    });
  });
});

chatMessagesElement.addEventListener("click", (event) => {
  const previewImage = (
    event.target as Element | null
  )?.closest<HTMLImageElement>(".chat-message-image");
  if (previewImage) {
    openChatImagePreview(previewImage.src, previewImage.alt);
    return;
  }
  const citation = (event.target as Element | null)?.closest<HTMLButtonElement>(
    ".pdf-source-citation",
  );
  if (!citation) return;
  const pageNumber = Number(citation.dataset.pdfPage);
  const fallbackQuote = citation.dataset.pdfQuote?.trim() ?? "";
  let quotes = fallbackQuote ? [fallbackQuote] : [];
  try {
    const parsedQuotes = JSON.parse(citation.dataset.pdfQuotes ?? "null");
    if (Array.isArray(parsedQuotes)) {
      quotes = parsedQuotes.filter(
        (quote): quote is string => typeof quote === "string" && Boolean(quote.trim()),
      );
    }
  } catch {
    // Compatibility with citations stored before multi-range citation support.
  }
  void jumpToPdfCitations(pageNumber, quotes);
});

chatMessagesElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const previewImage = (
    event.target as Element | null
  )?.closest<HTMLImageElement>(".chat-message-image");
  if (!previewImage) return;
  event.preventDefault();
  openChatImagePreview(previewImage.src, previewImage.alt);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chatImagePreviewOverlay) {
    event.preventDefault();
    closeChatImagePreview();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void sendChatMessage();
});

function activateAiTab(tabName: string): void {
  for (const tab of aiTabButtons) {
    tab.classList.toggle("active", tab.dataset.aiTab === tabName);
  }
  for (const panel of aiTabPanels) {
    panel.hidden = panel.dataset.aiPanel !== tabName;
  }

  if (tabName === "translate") {
    const text = selectedTextForAi || getViewerSelectionText();
    if (text) {
      selectedTextForAi = text;
      setTranslationSelectionEditor(
        text,
        currentEnglishLearningSourceSentence || text,
        currentEnglishLearningResult?.kind === "word"
          ? currentEnglishLearningResult.sentenceTranslation
          : "",
      );
      scheduleAutomaticTranslation(text);
    } else {
      currentEnglishLearningResult = null;
      setMoreExamplesButtonVisible(false);
      setTranslationLearningTitle("学习结果");
      translationLearningHintElement.textContent =
        "选一个单词可查看语境词义、词性和例句；选一句话可获得翻译与重点词讲解。";
      setTranslationState("请先在 PDF 中选中一个英文单词、句子或短段。");
    }
  } else if (tabName === "summary") {
    updateSummaryMetadata();
    scheduleSummaryGeneration(0);
  } else if (tabName === "cards") {
    updateCardSourceSnippet();
    scheduleCardGeneration(0);
  }
}

for (const button of aiTabButtons) {
  button.addEventListener("click", () => {
    const tabName = button.dataset.aiTab;
    if (tabName) activateAiTab(tabName);
  });
}

bindPaperCardTextareaAutoResize();

paperCardEntryButton?.addEventListener("click", openPaperCardPage);
knowledgeBaseEntryButton.addEventListener("click", openKnowledgeBasePage);
knowledgeBaseBackButton.addEventListener("click", closeKnowledgeBasePage);
for (const button of knowledgeModeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.knowledgeMode as KnowledgePageMode | undefined;
    if (mode) setKnowledgePageMode(mode);
  });
}
knowledgeResearchScopeSelect.addEventListener(
  "change",
  updateKnowledgeResearchScopeSummary,
);
knowledgeSelectVisibleButton.addEventListener("click", () => {
  for (const item of getFilteredKnowledgeItems(collectKnowledgeItems())) {
    selectedKnowledgeResearchKeys.add(item.recordKey);
  }
  knowledgeResearchScopeSelect.value = "selected";
  renderKnowledgeBase();
  setKnowledgePageMode(
    activeKnowledgePageMode === "library" ? "qa" : activeKnowledgePageMode,
  );
});
knowledgeClearSelectionButton.addEventListener("click", () => {
  selectedKnowledgeResearchKeys.clear();
  renderKnowledgeBase();
});
for (const button of knowledgeQuestionPresetButtons) {
  button.addEventListener("click", () => {
    knowledgeResearchQuestionInput.value =
      button.dataset.knowledgeQuestion || "";
    knowledgeResearchQuestionInput.focus();
  });
}
for (const button of knowledgeInsightPresetButtons) {
  button.addEventListener("click", () => {
    activeKnowledgeInsightPrompt =
      button.dataset.knowledgeInsight || activeKnowledgeInsightPrompt;
    for (const candidate of knowledgeInsightPresetButtons)
      candidate.classList.toggle("active", candidate === button);
  });
}
knowledgeRunResearchButton.addEventListener(
  "click",
  () => void runKnowledgeResearch(),
);
knowledgeClearResearchButton.addEventListener(
  "click",
  clearKnowledgeResearchResult,
);
knowledgeSaveResearchResultButton.addEventListener(
  "click",
  saveKnowledgeResearchResult,
);
knowledgeResearchQuestionInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
    void runKnowledgeResearch();
});
knowledgeInsightQuestionInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
    void runKnowledgeResearch();
});
knowledgeRefreshButton.addEventListener("click", () => {
  setKnowledgePageStatus();
  renderKnowledgeBase();
});
knowledgeNewNoteButton.addEventListener("click", () => openKnowledgeEditor());
knowledgeImportButton.addEventListener("click", () =>
  knowledgeImportInput.click(),
);
knowledgeImportInput.addEventListener("change", () => {
  const file = knowledgeImportInput.files?.[0];
  if (file) void importKnowledgeNotes(file);
});
knowledgeSearchInput.addEventListener("input", renderKnowledgeBase);
knowledgeSortSelect.addEventListener("change", renderKnowledgeBase);

let appViewStateSaveTimer: number | undefined;
function scheduleAppViewStateSave(): void {
  if (appViewStateSaveTimer !== undefined)
    window.clearTimeout(appViewStateSaveTimer);
  appViewStateSaveTimer = window.setTimeout(() => {
    persistCurrentAppViewState();
    appViewStateSaveTimer = undefined;
  }, 160);
}

knowledgeMainElement.addEventListener("scroll", scheduleAppViewStateSave, {
  passive: true,
});
paperCardPageElement.addEventListener("scroll", scheduleAppViewStateSave, {
  passive: true,
});
knowledgeResearchQuestionInput.addEventListener(
  "input",
  scheduleAppViewStateSave,
);
knowledgeInsightQuestionInput.addEventListener(
  "input",
  scheduleAppViewStateSave,
);
knowledgeResearchScopeSelect.addEventListener(
  "change",
  persistCurrentAppViewState,
);
knowledgeGroupSelect.addEventListener("change", renderKnowledgeBase);
knowledgeYearFilterSelect?.addEventListener("change", () => {
  activeKnowledgeYear = knowledgeYearFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeVenueFilterSelect?.addEventListener("change", () => {
  activeKnowledgeVenue = knowledgeVenueFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeReadingStatusFilterSelect?.addEventListener("change", () => {
  activeKnowledgeReadingStatus = knowledgeReadingStatusFilterSelect.value;
  renderKnowledgeBase();
});
knowledgePriorityFilterSelect?.addEventListener("change", () => {
  activeKnowledgePriority = knowledgePriorityFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeClearFiltersButton?.addEventListener("click", () => {
  activeKnowledgeYear = "all";
  activeKnowledgeVenue = "all";
  activeKnowledgeReadingStatus = "all";
  activeKnowledgePriority = "all";
  activeKnowledgeCategory = "all";
  activeKnowledgeTag = "";
  activeKnowledgeFocus = "all";
  knowledgeSearchInput.value = "";
  if (knowledgeYearFilterSelect) knowledgeYearFilterSelect.value = "all";
  if (knowledgeVenueFilterSelect) knowledgeVenueFilterSelect.value = "all";
  if (knowledgeReadingStatusFilterSelect)
    knowledgeReadingStatusFilterSelect.value = "all";
  if (knowledgePriorityFilterSelect)
    knowledgePriorityFilterSelect.value = "all";
  renderKnowledgeBase();
});
for (const button of knowledgeFocusButtons) {
  button.addEventListener("click", () => {
    const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
    if (!focus) return;
    activeKnowledgeFocus = focus;
    renderKnowledgeBase();
  });
}
knowledgeBatchOrganizeButton?.addEventListener("click", () => {
  setKnowledgePageStatus(
    "已切换到研究型知识库视图。后续可以继续扩展批量整理逻辑。",
  );
});
for (const button of knowledgeFilterButtons) {
  button.addEventListener("click", () => {
    const filter = button.dataset.knowledgeFilter as
      | KnowledgeFilter
      | undefined;
    if (filter) setKnowledgeFilter(filter);
  });
}
knowledgeDetailCloseButton.addEventListener("click", () => {
  selectedKnowledgeRecordKey = "";
  renderKnowledgeDetail([], undefined);
});
knowledgeOpenSourceButton.addEventListener(
  "click",
  openSelectedKnowledgeSource,
);
knowledgeEditItemButton.addEventListener("click", () => {
  const item = getSelectedKnowledgeItem();
  if (!item) return;
  if (item.source === "paper-overview") {
    openSavedPaperOverviewReview(item);
    return;
  }
  openKnowledgeEditor(item);
});
knowledgeDeleteItemButton.addEventListener(
  "click",
  deleteSelectedKnowledgeItem,
);
knowledgeEditorCloseButton.addEventListener("click", closeKnowledgeEditor);
knowledgeEditorCancelButton.addEventListener("click", closeKnowledgeEditor);
knowledgeEditorDialog.addEventListener("pointerdown", (event) => {
  if (event.target === knowledgeEditorDialog) closeKnowledgeEditor();
});
knowledgeEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveKnowledgeEditor();
});
paperCardBackButton.addEventListener("click", () =>
  closePaperCardPage(paperCardReturnTarget),
);
returnToPdfButton.addEventListener("click", () => closePaperCardPage("pdf"));
editPaperCardButton.addEventListener("click", () => {
  const enteringEditMode = !paperCardEditMode;
  setPaperCardEditMode(enteringEditMode);
  if (enteringEditMode) {
    setPaperCardPageStatus("已进入编辑模式，可直接点击字段修改内容。");
  }
  else if (!editingPaperOverviewId) {
    setPaperCardPageStatus("编辑完成，修改已保存到本地草稿。");
  }
});
regeneratePaperCardButton.addEventListener("click", () => {
  paperCardPageDocumentKey = "";
  void generatePaperOverviewCard(true);
});
savePaperCardPageButton.addEventListener("click", savePaperOverviewCard);
exportPaperCardButton.addEventListener("click", exportPaperOverviewCard);

for (const button of summaryScopeButtons) {
  button.addEventListener("click", () => {
    const scope = button.dataset.summaryScope as SummaryScope | undefined;
    if (scope) setActiveSummaryScope(scope);
  });
}

for (const button of cardTypeButtons) {
  button.addEventListener("click", () => {
    const cardType = button.dataset.cardType as CardType | undefined;
    if (cardType) setActiveCardType(cardType);
  });
}

recentFilesButton.addEventListener("click", () => {
  showRecentFilesDialog();
});

closeRecentFilesButton.addEventListener("click", () => {
  hideRecentFilesDialog();
});

recentFilesDialog.addEventListener("pointerdown", (event) => {
  if (event.target === recentFilesDialog) hideRecentFilesDialog();
});

clearRecentFilesButton.addEventListener("click", async () => {
  await writeRecentFiles([]);
  await renderRecentFiles();
});

openFileButton.addEventListener("click", async (event) => {
  event.preventDefault();
  if (pdfDocument && !confirmDiscardUnsavedChanges()) return;

  const pickerWindow = window as FilePickerWindow;
  if (typeof pickerWindow.showOpenFilePicker === "function") {
    try {
      const [fileHandle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "PDF 文件",
            accept: {
              "application/pdf": [".pdf"],
            },
          },
        ],
      });

      if (!fileHandle) return;
      const file = await fileHandle.getFile();
      await openPdf(await file.arrayBuffer(), file.name, fileHandle, false);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn(
        "File System Access API 打开失败，降级到普通文件选择。",
        error,
      );
    }
  }

  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await openPdf(await file.arrayBuffer(), file.name, null, false);
  fileInput.value = "";
});

previousButton.addEventListener("click", () => {
  if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1;
});

nextButton.addEventListener("click", () => {
  if (pdfDocument && pdfViewer.currentPageNumber < pdfDocument.numPages) {
    pdfViewer.currentPageNumber += 1;
  }
});

pageNumberInput.addEventListener("change", () => {
  const page = Number(pageNumberInput.value);
  if (
    pdfDocument &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= pdfDocument.numPages
  ) {
    pdfViewer.currentPageNumber = page;
  } else {
    updateControls();
  }
});

zoomOutButton.addEventListener("click", () => {
  pdfViewer.currentScale = Math.max(0.25, pdfViewer.currentScale / 1.1);
});

zoomInButton.addEventListener("click", () => {
  pdfViewer.currentScale = Math.min(5, pdfViewer.currentScale * 1.1);
});

findBar.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(false, true);
});

findInput.addEventListener("input", () => runSearch(false, false));
findPreviousButton.addEventListener("click", () => runSearch(true, true));
findNextButton.addEventListener("click", () => runSearch(false, true));
findCloseButton.addEventListener("click", closeFindBar);

for (const button of editorModeButtons) {
  button.addEventListener("pointerdown", () => {
    if (button.dataset.editorMode === "highlight") saveContextSelection();
  });

  button.addEventListener("click", () => {
    const mode = button.dataset.editorMode;
    if (mode === "select") setEditorMode(AnnotationEditorType.NONE);
    if (mode === "highlight") {
      void highlightCurrentSelectionFromToolbar();
      return;
    }
    if (mode === "ink") setEditorMode(AnnotationEditorType.INK);
    if (mode === "text") setEditorMode(AnnotationEditorType.FREETEXT);
  });
}

highlightColorInput.addEventListener("input", () => {
  setHighlightColor(highlightColorInput.value);
});

freeTextColorInput.addEventListener("input", () => {
  setFreeTextColor(freeTextColorInput.value);
});

freeTextSizeInput.addEventListener("change", () => {
  setFreeTextSize(getFreeTextSize());
});

freeTextSizeDownButton.addEventListener("click", () => {
  setFreeTextSize(getFreeTextSize() - 2);
});

freeTextSizeUpButton.addEventListener("click", () => {
  setFreeTextSize(getFreeTextSize() + 2);
});

selectionContextMenu.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

for (const button of quickHighlightButtons) {
  button.addEventListener("click", () => {
    const color = button.dataset.quickHighlightColor;
    if (!color) return;

    if (contextHighlightEditor && annotationEditor) {
      selectHighlight(contextHighlightEditor);
      setHighlightColor(color);
      hideSelectionContextMenu();
    } else {
      void createQuickHighlight(color);
    }
  });
}

contextCopyButton.addEventListener("click", async () => {
  if (!contextSelectionText) return;
  await navigator.clipboard.writeText(contextSelectionText);
  setStatus(
    `已复制 ${contextSelectionText.length.toLocaleString("zh-CN")} 个字符。`,
  );
  hideSelectionContextMenu();
});

contextCleanCopyButton.addEventListener("click", async () => {
  if (!contextSelectionText) return;
  const text = normalizeCopiedText(contextSelectionText);
  await navigator.clipboard.writeText(text);
  setStatus(`已整理并复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
  hideSelectionContextMenu();
});

contextNoteButton.addEventListener("click", () => {
  hideSelectionContextMenu();

  if (contextHighlightEditor) {
    showHighlightNote(contextHighlightEditor, true);
    return;
  }

  void (async () => {
    const createdEditor = await createQuickHighlight(highlightColorInput.value);
    if (createdEditor) showHighlightNote(createdEditor, true);
  })();
});

contextDeleteHighlightButton.addEventListener("click", () => {
  if (!contextHighlightEditor) return;
  selectHighlight(contextHighlightEditor);
  deleteSelectedHighlight();
});

viewerElement.addEventListener(
  "pointerdown",
  (event) => {
    if (
      event.button !== 0 ||
      !pdfDocument ||
      !isTextSelectionMode() ||
      isEditableOrControl(event.target)
    ) {
      return;
    }

    const directAnnotation = findAnnotationEditor(event.target, {
      includeHighlight: false,
    });
    if (directAnnotation && !isHighlightEditor(directAnnotation)) return;

    const pointHighlight = findAnnotationEditorAtPoint(
      event.clientX,
      event.clientY,
      {
        highlightOnly: true,
      },
    );
    if (pointHighlight) return;

    if (isPointInsideTextGlyph(event.clientX, event.clientY)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearDomSelection();
    clearSelectedAnnotationState();
  },
  { capture: true },
);

viewerElement.addEventListener("contextmenu", (event) => {
  if (isInkMode()) return;

  saveContextSelection();
  if (
    contextSelectionText &&
    annotationEditor &&
    isPointInsideSavedSelection(event.clientX, event.clientY)
  ) {
    event.preventDefault();
    showSelectionContextMenuAt(event.clientX, event.clientY, null);
    return;
  }

  const highlightEditor = findAnnotationEditorAtPoint(
    event.clientX,
    event.clientY,
    {
      highlightOnly: true,
    },
  );
  if (highlightEditor) {
    event.preventDefault();
    selectHighlight(highlightEditor);
    showSelectionContextMenuAt(event.clientX, event.clientY, highlightEditor);
    return;
  }

  const annotation =
    findAnnotationEditor(event.target, { includeHighlight: false }) ??
    findAnnotationEditorAtPoint(event.clientX, event.clientY, {
      includeHighlight: false,
    });

  if (annotation) {
    event.preventDefault();
    selectAnnotation(annotation);
    showAnnotationActionBar(annotation);
    return;
  }

  if (!contextSelectionText || !annotationEditor) return;

  event.preventDefault();
  showSelectionContextMenuAt(event.clientX, event.clientY, null);
});

viewerElement.addEventListener("pointerdown", (event) => {
  if (isInkMode()) return;

  lastPointerDown = {
    x: event.clientX,
    y: event.clientY,
    button: event.button,
  };

  const editor = findAnnotationEditor(event.target, {
    includeHighlight: false,
  });
  if (editor) {
    selectAnnotation(editor, false);
    hideAnnotationActionBar();
    return;
  }

  const pointHighlight =
    event.button === 0
      ? findAnnotationEditorAtPoint(event.clientX, event.clientY, {
          highlightOnly: true,
        })
      : null;
  if (pointHighlight) return;

  clearSelectedAnnotationState();
});

viewerElement.addEventListener("click", (event) => {
  if (isInkMode()) return;

  if (lastPointerDown?.button !== 0) return;
  const moved =
    !lastPointerDown ||
    Math.hypot(
      event.clientX - lastPointerDown.x,
      event.clientY - lastPointerDown.y,
    ) > 4;
  if (moved) return;

  const editor =
    findAnnotationEditorAtPoint(event.clientX, event.clientY, {
      highlightOnly: true,
    }) ??
    findAnnotationEditor(event.target, { includeHighlight: false }) ??
    findAnnotationEditorAtPoint(event.clientX, event.clientY, {
      includeHighlight: false,
    });
  if (!editor) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    return;
  }

  clearDomSelection();
  selectAnnotation(editor);
  if (isHighlightEditor(editor) && getHighlightNote(editor))
    toggleHighlightNote(editor);
});

document.addEventListener("pointerdown", (event) => {
  if (isInkMode()) return;

  const annotationAtPoint =
    event instanceof PointerEvent
      ? findAnnotationEditorAtPoint(event.clientX, event.clientY, {
          highlightOnly: true,
        })
      : null;
  if (!selectionContextMenu.contains(event.target as Node))
    hideSelectionContextMenu();
  if (
    !highlightNotePopover.contains(event.target as Node) &&
    !isHighlightEditor(annotationAtPoint)
  ) {
    hideHighlightNote();
  }
  if (
    !annotationActionBar.contains(event.target as Node) &&
    !annotationAtPoint &&
    !findAnnotationEditor(event.target, { includeHighlight: false })
  ) {
    hideAnnotationActionBar();
  }
});

annotationActionBar.addEventListener("pointerdown", (event) =>
  event.stopPropagation(),
);
deleteAnnotationButton.addEventListener("click", deleteSelectedAnnotation);

highlightNotePopover.addEventListener("pointerdown", (event) =>
  event.stopPropagation(),
);
closeHighlightNoteButton.addEventListener("click", hideHighlightNote);
saveHighlightNoteButton.addEventListener("click", saveHighlightNote);
deleteHighlightNoteButton.addEventListener("click", () => {
  highlightNoteText.value = "";
  saveHighlightNote();
});

document.addEventListener(
  "keydown",
  (event) => {
    const target = event.target as HTMLElement | null;
    const isEditingText =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      Boolean(target?.isContentEditable);
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s" &&
      pdfDocument
    ) {
      event.preventDefault();
      event.stopPropagation();
      void saveAnnotatedPdf();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "f" &&
      pdfDocument
    ) {
      event.preventDefault();
      event.stopPropagation();
      openFindBar();
      return;
    }
    if (event.key === "Escape" && !recentFilesDialog.hidden) {
      event.preventDefault();
      hideRecentFilesDialog();
      return;
    }
    if (event.key === "Escape" && !translationHistoryDialog.hidden) {
      event.preventDefault();
      translationHistoryDialog.hidden = true;
      return;
    }
    if (event.key === "Escape" && !findBar.hidden) {
      event.preventDefault();
      closeFindBar();
      return;
    }
    if (event.key === "Delete" && selectedAnnotationEditor && !isEditingText) {
      event.preventDefault();
      event.stopPropagation();
      deleteSelectedAnnotation();
    }
  },
  true,
);

undoAnnotationButton.addEventListener("click", () => annotationEditor?.undo());
redoAnnotationButton.addEventListener("click", () => annotationEditor?.redo());

smartCopyButton.addEventListener("click", async () => {
  const text = getViewerSelectionText();
  if (!text) {
    setStatus("请先在PDF中选择要复制的文字。", true);
    return;
  }

  await navigator.clipboard.writeText(text);
  setStatus(`已整理并复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
});

smartCopyButton.addEventListener("mousedown", (event) => {
  // Keep the PDF selection active while the toolbar button is pressed.
  event.preventDefault();
});

document.addEventListener(
  "copy",
  (event) => {
    const text = getViewerSelectionRawText();
    if (!text || !event.clipboardData) return;

    // PDF.js annotation editing captures every copy event. Text selections
    // must be handled first so normal Ctrl+C still behaves like a reader.
    event.stopImmediatePropagation();
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    setStatus(`已复制 ${text.length.toLocaleString("zh-CN")} 个字符。`);
  },
  { capture: true },
);

saveTranslationNoteButton.addEventListener(
  "click",
  saveTranslationAndExplanationAsNote,
);

generateMoreExamplesButton.addEventListener("click", () => {
  void generateMoreVocabularyExamples();
});

selectedSnippetElement.addEventListener("input", markTranslationEditorChanged);
translationSourceSentenceInput.addEventListener("input", () => {
  autoResizeTranslationTextarea(translationSourceSentenceInput);
  renderTranslationMathPreview(
    translationSourceSentenceMathPreview,
    translationSourceSentenceInput.value,
  );
  currentEnglishLearningSourceSentence = normalizeLearningInlineText(
    translationSourceSentenceInput.value,
  );
  renderLearningRichText(
    translationSourceSentenceTranslation,
    "原句已修改，重新查询后更新翻译",
  );
  applyTranslationEditButton.disabled = !normalizeCopiedText(
    selectedSnippetElement.value,
  );
});
applyTranslationEditButton.addEventListener("click", () => {
  const text = normalizeCopiedText(selectedSnippetElement.value);
  if (!text) {
    setTranslationState("请先填写需要翻译或解释的英文。", true);
    selectedSnippetElement.focus();
    return;
  }

  translationAbortController?.abort();
  moreExamplesAbortController?.abort();
  cancelPendingAutomaticTranslation();
  selectedTextForAi = text;
  selectedTextPageNumber = Math.max(
    1,
    selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
  );
  currentEnglishLearningSourceSentence = getSelectedEnglishWord(text)
    ? normalizeLearningInlineText(translationSourceSentenceInput.value || text)
    : text;
  setTranslationSelectionEditor(text, currentEnglishLearningSourceSentence);
  lastTranslatedText = "";
  currentEnglishLearningResult = null;
  void translateSelectedText(text);
});

openTranslationHistoryButton.addEventListener("click", async () => {
  await ensureTranslationHistoryLoaded();
  translationHistorySearchInput.value = "";
  renderTranslationHistoryDialog();
  translationHistoryDialog.hidden = false;
  requestAnimationFrame(() => translationHistorySearchInput.focus());
});
closeTranslationHistoryButton.addEventListener("click", () => {
  translationHistoryDialog.hidden = true;
});
translationHistoryDialog.addEventListener("pointerdown", (event) => {
  if (event.target === translationHistoryDialog) {
    translationHistoryDialog.hidden = true;
  }
});
translationHistorySearchInput.addEventListener(
  "input",
  renderTranslationHistoryDialog,
);

clearTranslationHistoryButton.addEventListener("click", () => {
  void clearCurrentTranslationHistory();
});

copyTranslationButton.addEventListener("click", async () => {
  const learningText = getEnglishLearningPlainText();
  if (!currentEnglishLearningResult || !learningText) {
    setTranslationState("当前没有可复制的英语学习结果。", true);
    return;
  }

  await navigator.clipboard.writeText(learningText);
  setStatus(
    `已复制 ${learningText.length.toLocaleString("zh-CN")} 个学习字符。`,
  );
});

copySummaryButton.addEventListener("click", async () => {
  if (lastSummaryPoints.length === 0) {
    setStatus("当前没有可复制的总结要点。", true);
    return;
  }

  const text = lastSummaryPoints.map((point) => `• ${point}`).join("\n");
  await navigator.clipboard.writeText(text);
  setStatus(`已复制 ${lastSummaryPoints.length} 条总结要点。`);
});

saveSummaryNoteButton.addEventListener("click", saveCurrentSummaryAsNote);

copyCardButton.addEventListener("click", async () => {
  if (!currentCardContext || !currentGeneratedCard) {
    setStatus("当前没有可复制的论文卡片。", true);
    return;
  }

  await navigator.clipboard.writeText(
    formatGeneratedCardText(currentCardContext, currentGeneratedCard),
  );
  setStatus(`已复制“${currentGeneratedCard.title}”论文卡片。`);
});

saveCardButton.addEventListener("click", saveCurrentPaperCard);

document.addEventListener("selectionchange", () => {
  scheduleCustomSelectionRender();
  scheduleAiSelectedSnippetUpdate();
});

viewerElement.addEventListener("pointerdown", () => {
  // 开始新一轮拖选时，停止旧选区尚未发出的 AI 请求。
  cancelPendingAutomaticTranslation();
  translationAbortController?.abort();
  moreExamplesAbortController?.abort();
  if (activeSummaryScope === "selection") {
    cancelPendingSummaryGeneration();
    summaryAbortController?.abort();
  }
  cancelPendingCardGeneration();
  cardAbortController?.abort();
});

viewerElement.addEventListener("pointerup", () =>
  scheduleAiSelectedSnippetUpdate(),
);
viewerElement.addEventListener("keyup", () =>
  scheduleAiSelectedSnippetUpdate(),
);
citationReturnButton.addEventListener(
  "click",
  returnToPreviousInternalNavigationPosition,
);
viewerContainer.addEventListener("scroll", scheduleCustomSelectionRender, {
  passive: true,
});
viewerContainer.addEventListener(
  "scroll",
  () => {
    scheduleReadingPositionSave();
    hideSelectionContextMenu();
    hideHighlightNote();
    hideAnnotationActionBar();
  },
  { passive: true },
);
window.addEventListener("resize", scheduleCustomSelectionRender);
window.addEventListener("resize", () => {
  autoResizeTranslationTextarea(selectedSnippetElement);
  if (!translationSourceSentenceField.hidden) {
    autoResizeTranslationTextarea(translationSourceSentenceInput);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelReadingPositionSave();
    void persistCurrentReadingPosition();
    persistCurrentAppViewState();
  }
});
window.addEventListener("beforeunload", (event) => {
  cancelReadingPositionSave();
  void persistCurrentReadingPosition();
  persistCurrentAppViewState();
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

async function saveAnnotatedPdf(): Promise<boolean> {
  if (!pdfDocument || isSavingAnnotatedPdf) return false;
  isSavingAnnotatedPdf = true;

  try {
    setStatus("正在把 PDF Helper 批注嵌入 PDF…");
    const { bytes, count } = await embedHelperAnnotationsIntoPdf();
    const result = await writeEmbeddedPdfBytes(bytes);
    sourcePdfBytes = new Uint8Array(bytes);
    markSavedChanges();
    if (result === "overwritten") {
      setStatus(`批注已嵌入当前 PDF（${count} 条）。`);
    } else if (result === "permission-denied-downloaded") {
      setStatus(
        `未获得覆盖原文件的写入权限，已下载带 PDF Helper 数据的新 PDF（${count} 条）。`,
      );
    } else {
      setStatus(
        `当前打开方式不能覆盖原文件，已下载带 PDF Helper 数据的新 PDF（${count} 条）。`,
      );
    }
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    isSavingAnnotatedPdf = false;
  }
}

saveAnnotatedPdfButton.addEventListener("click", () => {
  void saveAnnotatedPdf();
});

toggleNotesButton.addEventListener("click", () => {
  areNoteIndicatorsHidden = !areNoteIndicatorsHidden;
  updateNoteIndicatorsVisibility();
});

updateNoteIndicatorsVisibility();
clearOutlineList("打开 PDF 后显示目录");
setLeftPanelCollapsed(false);
updateControls();
updateReadingModeUi();
void loadDeepSeekConfig();
textStatus.textContent = "交互已就绪";
restoreAppViewAfterRefresh();

const source = new URLSearchParams(window.location.search).get("src");
if (source?.startsWith("http://") || source?.startsWith("https://")) {
  void openRemotePdf(source);
}

installOnlineRelatedPapers();
installCurrentPaperCcfRank();
installPaperCardInlineEditing();
