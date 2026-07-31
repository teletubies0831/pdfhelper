import {
  AnnotationMode,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  GlobalWorkerOptions,
  getDocument,
  type AnnotationEditorUIManager,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import { browser } from 'wxt/browser';
import 'pdfjs-dist/web/pdf_viewer.css';
import 'katex/dist/katex.min.css';

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
  type AiConfig,
  type AiConversationMessage,
  type AiProviderId,
  type AiReasoningMode,
  type AiRuntimeResponse,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type VisionAiConfig,
  type VisionAiMode,
} from '../../shared/ai';
import {
  READING_MODE_STORAGE_KEY,
  getReadingModeLabel,
  isReadingModePreference,
  type ReadingModePreference,
  type ReadingModeState,
  type ResolvedReadingMode,
} from '../../shared/reading-mode';

import './style.css';

type WritableFileStreamLike = {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
};

type FileHandlePermissionDescriptor = {
  mode?: 'read' | 'readwrite';
};

type FileHandlePermissionState = 'granted' | 'denied' | 'prompt';

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

const openFileButton = requiredElement<HTMLElement>('open-file');
const fileInput = requiredElement<HTMLInputElement>('file-input');
const recentFilesButton = requiredElement<HTMLButtonElement>('recent-files-button');
const recentFilesDialog = requiredElement<HTMLElement>('recent-files-dialog');
const recentFilesList = requiredElement<HTMLElement>('recent-files-list');
const closeRecentFilesButton = requiredElement<HTMLButtonElement>('close-recent-files');
const clearRecentFilesButton = requiredElement<HTMLButtonElement>('clear-recent-files');
const documentNameElement = requiredElement<HTMLElement>('document-name');
const previousButton = requiredElement<HTMLButtonElement>('previous-page');
const nextButton = requiredElement<HTMLButtonElement>('next-page');
const pageNumberInput = requiredElement<HTMLInputElement>('page-number');
const pageCountElement = requiredElement<HTMLElement>('page-count');
const zoomOutButton = requiredElement<HTMLButtonElement>('zoom-out');
const zoomInButton = requiredElement<HTMLButtonElement>('zoom-in');
const zoomValueElement = requiredElement<HTMLElement>('zoom-value');
const findBar = requiredElement<HTMLFormElement>('find-bar');
const findInput = requiredElement<HTMLInputElement>('find-input');
const findCount = requiredElement<HTMLElement>('find-count');
const findPreviousButton = requiredElement<HTMLButtonElement>('find-previous');
const findNextButton = requiredElement<HTMLButtonElement>('find-next');
const findCloseButton = requiredElement<HTMLButtonElement>('find-close');
const statusText = requiredElement<HTMLElement>('status-text');
const textStatus = requiredElement<HTMLElement>('text-status');
const viewerContainer = requiredElement<HTMLDivElement>('viewer-container');
const viewerElement = requiredElement<HTMLDivElement>('viewer');
const citationReturnButton = requiredElement<HTMLButtonElement>('citation-return-button');
const citationReturnPosition = requiredElement<HTMLElement>('citation-return-position');
const undoAnnotationButton = requiredElement<HTMLButtonElement>('undo-annotation');
const redoAnnotationButton = requiredElement<HTMLButtonElement>('redo-annotation');
const smartCopyButton = requiredElement<HTMLButtonElement>('smart-copy');
const saveAnnotatedPdfButton = requiredElement<HTMLButtonElement>('save-annotated-pdf');
const toggleNotesButton = requiredElement<HTMLButtonElement>('toggle-notes');
const highlightColorInput = requiredElement<HTMLInputElement>('highlight-color');
const freeTextSizeInput = requiredElement<HTMLInputElement>('free-text-size');
const freeTextColorInput = requiredElement<HTMLInputElement>('free-text-color');
const freeTextSizeDownButton = requiredElement<HTMLButtonElement>('free-text-size-down');
const freeTextSizeUpButton = requiredElement<HTMLButtonElement>('free-text-size-up');
const selectionContextMenu = requiredElement<HTMLElement>('selection-context-menu');
const contextCopyButton = requiredElement<HTMLButtonElement>('context-copy');
const contextCleanCopyButton = requiredElement<HTMLButtonElement>('context-clean-copy');
const contextColors = requiredElement<HTMLElement>('context-colors');
const highlightContextActions = requiredElement<HTMLElement>('highlight-context-actions');
const contextNoteButton = requiredElement<HTMLButtonElement>('context-note');
const contextDeleteHighlightButton = requiredElement<HTMLButtonElement>('context-delete-highlight');
const highlightNotePopover = requiredElement<HTMLElement>('highlight-note-popover');
const highlightNoteTitle = requiredElement<HTMLElement>('highlight-note-title');
const highlightNoteQuote = requiredElement<HTMLElement>('highlight-note-quote');
const highlightNoteText = requiredElement<HTMLTextAreaElement>('highlight-note-text');
const closeHighlightNoteButton = requiredElement<HTMLButtonElement>('close-highlight-note');
const deleteHighlightNoteButton = requiredElement<HTMLButtonElement>('delete-highlight-note');
const saveHighlightNoteButton = requiredElement<HTMLButtonElement>('save-highlight-note');
const annotationActionBar = requiredElement<HTMLElement>('annotation-action-bar');
const annotationTypeLabel = requiredElement<HTMLElement>('annotation-type-label');
const deleteAnnotationButton = requiredElement<HTMLButtonElement>('delete-annotation');
const freeTextSizeControl = requiredElement<HTMLElement>('free-text-size-control');
const quickHighlightButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-quick-highlight-color]'),
);
const editorModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-editor-mode]'),
);
const appFrame = document.querySelector<HTMLElement>('.app-frame');
const outlineToggleButton = document.getElementById('outline-toggle');
const aiPanelToggleButton = document.getElementById('ai-panel-toggle');
const focusModeButton = requiredElement<HTMLButtonElement>('focus-mode-toggle');
const focusModeLabel = requiredElement<HTMLElement>('focus-mode-label');
const readingModeSelect = requiredElement<HTMLSelectElement>('reading-mode-select');
const detectReadingModeButton = requiredElement<HTMLButtonElement>('detect-reading-mode');
const readingModeStatus = requiredElement<HTMLElement>('reading-mode-status');
const aiSettingsButton = requiredElement<HTMLButtonElement>('ai-settings-button');
const paperCardEntryButton = document.getElementById('paper-card-entry');
const paperCardPageElement = requiredElement<HTMLElement>('paper-card-page');
const paperCardPageTitleElement = requiredElement<HTMLElement>('paper-card-page-title');
const paperCardPageSubtitleElement = requiredElement<HTMLElement>('paper-card-page-subtitle');
const paperCardBackButton = requiredElement<HTMLButtonElement>('paper-card-back');
const returnToPdfButton = requiredElement<HTMLButtonElement>('return-to-pdf');
const regeneratePaperCardButton = requiredElement<HTMLButtonElement>('regenerate-paper-card');
const savePaperCardPageButton = requiredElement<HTMLButtonElement>('save-paper-card-page');
const exportPaperCardButton = requiredElement<HTMLButtonElement>('export-paper-card');
const paperCardDocumentNameElement = requiredElement<HTMLElement>('paper-card-document-name');
const paperCardPageStatusElement = requiredElement<HTMLElement>('paper-card-page-status');
const paperCardFormElement = requiredElement<HTMLFormElement>('paper-card-form');
const paperTitleInput = requiredElement<HTMLInputElement>('paper-title');
const paperAuthorsInput = requiredElement<HTMLInputElement>('paper-authors');
const paperVenueYearInput = requiredElement<HTMLInputElement>('paper-venue-year');
const paperResearchAreaInput = requiredElement<HTMLInputElement>('paper-research-area');
const paperKeywordsInput = requiredElement<HTMLInputElement>('paper-keywords');
const paperOneSentenceSummaryInput = requiredElement<HTMLTextAreaElement>('paper-one-sentence-summary');
const paperResearchProblemInput = requiredElement<HTMLTextAreaElement>('paper-research-problem');
const paperCoreInnovationInput = requiredElement<HTMLTextAreaElement>('paper-core-innovation');
const paperWorthReadingInput = requiredElement<HTMLTextAreaElement>('paper-worth-reading');
const paperProblemSetupInput = requiredElement<HTMLTextAreaElement>('paper-problem-setup');
const paperResearchGapInput = requiredElement<HTMLTextAreaElement>('paper-research-gap');
const paperWhyImportantInput = requiredElement<HTMLTextAreaElement>('paper-why-important');
const paperTopicTagsInput = requiredElement<HTMLTextAreaElement>('paper-topic-tags');
const paperMethodOverviewInput = requiredElement<HTMLTextAreaElement>('paper-method-overview');
const paperMethodIntuitionInput = requiredElement<HTMLTextAreaElement>('paper-method-intuition');
const paperMethodStepsInput = requiredElement<HTMLTextAreaElement>('paper-method-steps');
const paperKeyAssumptionsInput = requiredElement<HTMLTextAreaElement>('paper-key-assumptions');
const paperNotationGuideInput = requiredElement<HTMLTextAreaElement>('paper-notation-guide');
const paperDatasetsInput = requiredElement<HTMLTextAreaElement>('paper-datasets');
const paperExperimentSetupInput = requiredElement<HTMLTextAreaElement>('paper-experiment-setup');
const paperMetricsInput = requiredElement<HTMLTextAreaElement>('paper-metrics');
const paperMainFindingsInput = requiredElement<HTMLTextAreaElement>('paper-main-findings');
const paperStrongestEvidenceInput = requiredElement<HTMLTextAreaElement>('paper-strongest-evidence');
const paperComparisonPriorWorkInput = requiredElement<HTMLTextAreaElement>('paper-comparison-prior-work');
const paperLimitationsInput = requiredElement<HTMLTextAreaElement>('paper-limitations');
const paperReadingStatusInput = requiredElement<HTMLSelectElement>('paper-reading-status');
const paperRecommendDeepReadingInput = requiredElement<HTMLSelectElement>('paper-recommend-deep-reading');
const paperReadingDifficultyInput = requiredElement<HTMLSelectElement>('paper-reading-difficulty');
const paperReadingValueScoreInput = requiredElement<HTMLInputElement>('paper-reading-value-score');
const paperReadingAdviceInput = requiredElement<HTMLTextAreaElement>('paper-reading-advice');
const paperSuitableStagesInput = requiredElement<HTMLTextAreaElement>('paper-suitable-stages');
const paperPrerequisitesInput = requiredElement<HTMLTextAreaElement>('paper-prerequisites');
const paperCitationPointsInput = requiredElement<HTMLTextAreaElement>('paper-citation-points');
const paperResearchConnectionInput = requiredElement<HTMLTextAreaElement>('paper-research-connection');
const paperFollowupQuestionsInput = requiredElement<HTMLTextAreaElement>('paper-followup-questions');
const paperWeeklyPlanInput = requiredElement<HTMLTextAreaElement>('paper-weekly-plan');
const paperPersonalNotesInput = requiredElement<HTMLTextAreaElement>('paper-personal-notes');
const knowledgeBaseEntryButton = requiredElement<HTMLButtonElement>('knowledge-base-entry');
const knowledgeBasePageElement = requiredElement<HTMLElement>('knowledge-base-page');
const knowledgeMainElement = requiredElement<HTMLElement>('knowledge-library-view').closest<HTMLElement>('.knowledge-main');
if (!knowledgeMainElement) throw new Error('缺少知识库主内容区域');
const knowledgeBaseBackButton = requiredElement<HTMLButtonElement>('knowledge-base-back');
const knowledgeFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-knowledge-filter]'),
);
const knowledgeCountAllElement = requiredElement<HTMLElement>('knowledge-count-all');
const knowledgeCountNoteElement = requiredElement<HTMLElement>('knowledge-count-note');
const knowledgeCountReadingCardElement = requiredElement<HTMLElement>('knowledge-count-reading-card');
const knowledgeCountPaperCardElement = requiredElement<HTMLElement>('knowledge-count-paper-card');
const knowledgeCategoryListElement = requiredElement<HTMLElement>('knowledge-category-list');
const knowledgeTagListElement = requiredElement<HTMLElement>('knowledge-tag-list');
const knowledgeRecentSummaryElement = requiredElement<HTMLElement>('knowledge-recent-summary');
const knowledgePageTitleElement = requiredElement<HTMLElement>('knowledge-page-title');
const knowledgeTotalCountElement = requiredElement<HTMLElement>('knowledge-total-count');
const knowledgeDocumentCountElement = requiredElement<HTMLElement>('knowledge-document-count');
const knowledgeRefreshButton = requiredElement<HTMLButtonElement>('knowledge-refresh');
const knowledgeImportButton = requiredElement<HTMLButtonElement>('knowledge-import');
const knowledgeImportInput = requiredElement<HTMLInputElement>('knowledge-import-input');
const knowledgeNewNoteButton = requiredElement<HTMLButtonElement>('knowledge-new-note');
const knowledgeSearchInput = requiredElement<HTMLInputElement>('knowledge-search-input');
const knowledgeSortSelect = requiredElement<HTMLSelectElement>('knowledge-sort-select');
const knowledgeGroupSelect = requiredElement<HTMLSelectElement>('knowledge-group-select');
const knowledgePageStatusElement = requiredElement<HTMLElement>('knowledge-page-status');
const knowledgeListElement = requiredElement<HTMLElement>('knowledge-list');
const knowledgePageSubtitleElement = document.getElementById('knowledge-page-subtitle') as HTMLElement | null;
const knowledgeDashboardMetricsElement = document.getElementById('knowledge-dashboard-metrics') as HTMLElement | null;
const knowledgeStudentWorkbenchElement = document.getElementById('knowledge-student-workbench') as HTMLElement | null;
const knowledgeWeeklyTasksElement = document.getElementById('knowledge-weekly-tasks') as HTMLElement | null;
const knowledgeFocusButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-knowledge-focus]'),
);
const knowledgeFocusCountTodoElement = document.getElementById('knowledge-focus-count-todo') as HTMLElement | null;
const knowledgeFocusCountDeepElement = document.getElementById('knowledge-focus-count-deep') as HTMLElement | null;
const knowledgeFocusCountFinishedElement = document.getElementById('knowledge-focus-count-finished') as HTMLElement | null;
const knowledgeFocusCountCitableElement = document.getElementById('knowledge-focus-count-citable') as HTMLElement | null;
const knowledgeFocusCountReplicateElement = document.getElementById('knowledge-focus-count-replicate') as HTMLElement | null;
const knowledgeFocusCountRelatedElement = document.getElementById('knowledge-focus-count-related') as HTMLElement | null;
const knowledgeFocusCountMethodsElement = document.getElementById('knowledge-focus-count-methods') as HTMLElement | null;
const knowledgeYearFilterSelect = document.getElementById('knowledge-year-filter') as HTMLSelectElement | null;
const knowledgeVenueFilterSelect = document.getElementById('knowledge-venue-filter') as HTMLSelectElement | null;
const knowledgeReadingStatusFilterSelect = document.getElementById('knowledge-reading-status-filter') as HTMLSelectElement | null;
const knowledgePriorityFilterSelect = document.getElementById('knowledge-priority-filter') as HTMLSelectElement | null;
const knowledgeClearFiltersButton = document.getElementById('knowledge-clear-filters') as HTMLButtonElement | null;
const knowledgeBatchOrganizeButton = document.getElementById('knowledge-batch-organize') as HTMLButtonElement | null;
const knowledgeModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-knowledge-mode]'),
);
const knowledgeLibraryView = requiredElement<HTMLElement>('knowledge-library-view');
const knowledgeResearchView = requiredElement<HTMLElement>('knowledge-research-view');
const knowledgeResearchHeading = requiredElement<HTMLElement>('knowledge-research-heading');
const knowledgeResearchDescription = requiredElement<HTMLElement>('knowledge-research-description');
const knowledgeResearchScopeSelect = requiredElement<HTMLSelectElement>('knowledge-research-scope');
const knowledgeResearchScopeSummary = requiredElement<HTMLElement>('knowledge-research-scope-summary');
const knowledgeSelectVisibleButton = requiredElement<HTMLButtonElement>('knowledge-select-visible');
const knowledgeClearSelectionButton = requiredElement<HTMLButtonElement>('knowledge-clear-selection');
const knowledgeQaControls = requiredElement<HTMLElement>('knowledge-qa-controls');
const knowledgeInsightControls = requiredElement<HTMLElement>('knowledge-insight-controls');
const knowledgeResearchQuestionInput = requiredElement<HTMLTextAreaElement>('knowledge-research-question');
const knowledgeInsightQuestionInput = requiredElement<HTMLTextAreaElement>('knowledge-insight-question');
const knowledgeQuestionPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-knowledge-question]'),
);
const knowledgeInsightPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-knowledge-insight]'),
);
const knowledgeRunResearchButton = requiredElement<HTMLButtonElement>('knowledge-run-research');
const knowledgeClearResearchButton = requiredElement<HTMLButtonElement>('knowledge-clear-research');
const knowledgeResearchStatus = requiredElement<HTMLElement>('knowledge-research-status');
const knowledgeResearchResult = requiredElement<HTMLElement>('knowledge-research-result');
const knowledgeResearchResultKind = requiredElement<HTMLElement>('knowledge-research-result-kind');
const knowledgeResearchResultTitle = requiredElement<HTMLElement>('knowledge-research-result-title');
const knowledgeResearchResultBody = requiredElement<HTMLElement>('knowledge-research-result-body');
const knowledgeResearchSourceList = requiredElement<HTMLElement>('knowledge-research-source-list');
const knowledgeSaveResearchResultButton = requiredElement<HTMLButtonElement>('knowledge-save-research-result');
const knowledgeDetailCloseButton = requiredElement<HTMLButtonElement>('knowledge-detail-close');
const knowledgeDetailEmptyElement = requiredElement<HTMLElement>('knowledge-detail-empty');
const knowledgeDetailContentElement = requiredElement<HTMLElement>('knowledge-detail-content');
const knowledgeDetailTypeElement = requiredElement<HTMLElement>('knowledge-detail-type');
const knowledgeDetailTimeElement = requiredElement<HTMLElement>('knowledge-detail-time');
const knowledgeDetailTitleElement = requiredElement<HTMLElement>('knowledge-detail-title');
const knowledgeDetailTagsElement = requiredElement<HTMLElement>('knowledge-detail-tags');
const knowledgeDetailDocumentElement = requiredElement<HTMLElement>('knowledge-detail-document');
const knowledgeDetailPositionElement = requiredElement<HTMLElement>('knowledge-detail-position');
const knowledgeDetailCreatedElement = requiredElement<HTMLElement>('knowledge-detail-created');
const knowledgeDetailUpdatedElement = requiredElement<HTMLElement>('knowledge-detail-updated');
const knowledgeDetailBodyElement = requiredElement<HTMLElement>('knowledge-detail-body');
const knowledgeRelatedSummaryElement = requiredElement<HTMLElement>('knowledge-related-summary');
const knowledgeOpenSourceButton = requiredElement<HTMLButtonElement>('knowledge-open-source');
const knowledgeEditItemButton = requiredElement<HTMLButtonElement>('knowledge-edit-item');
const knowledgeDeleteItemButton = requiredElement<HTMLButtonElement>('knowledge-delete-item');
const knowledgeEditorDialog = requiredElement<HTMLElement>('knowledge-editor-dialog');
const knowledgeEditorForm = requiredElement<HTMLFormElement>('knowledge-editor-form');
const knowledgeEditorHeading = requiredElement<HTMLElement>('knowledge-editor-heading');
const knowledgeEditorSource = requiredElement<HTMLElement>('knowledge-editor-source');
const knowledgeEditorCloseButton = requiredElement<HTMLButtonElement>('knowledge-editor-close');
const knowledgeEditorCancelButton = requiredElement<HTMLButtonElement>('knowledge-editor-cancel');
const knowledgeEditorTitleInput = requiredElement<HTMLInputElement>('knowledge-editor-title');
const knowledgeEditorCategoryInput = requiredElement<HTMLInputElement>('knowledge-editor-category');
const knowledgeEditorTagsInput = requiredElement<HTMLInputElement>('knowledge-editor-tags');
const knowledgeEditorBodyInput = requiredElement<HTMLTextAreaElement>('knowledge-editor-body');
const assistantViewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-assistant-view]'),
);
const assistantChatPanel = requiredElement<HTMLElement>('assistant-chat-panel');
const assistantSettingsPanel = requiredElement<HTMLElement>('assistant-settings-panel');
const settingsModalBackdrop = requiredElement<HTMLElement>('settings-modal-backdrop');
const assistantToolsRuntime = requiredElement<HTMLElement>('assistant-tools-runtime');
const closeDeepSeekSettingsButton = requiredElement<HTMLButtonElement>('close-deepseek-settings');
const chatMessagesElement = requiredElement<HTMLElement>('chat-messages');
const chatForm = requiredElement<HTMLFormElement>('chat-form');
const chatInput = requiredElement<HTMLTextAreaElement>('chat-input');
const chatSendButton = requiredElement<HTMLButtonElement>('chat-send');
const chatProviderStatus = requiredElement<HTMLElement>('chat-provider-status');
const aiProviderSelect = requiredElement<HTMLSelectElement>('ai-provider');
const deepSeekApiKeyInput = requiredElement<HTMLInputElement>('deepseek-api-key');
const deepSeekModelSelect = requiredElement<HTMLSelectElement>('deepseek-model');
const deepSeekThinkingSelect = requiredElement<HTMLSelectElement>('deepseek-thinking');
const deepSeekBaseUrlInput = requiredElement<HTMLInputElement>('deepseek-base-url');
const deepSeekSettingsStatus = requiredElement<HTMLElement>('deepseek-settings-status');
const saveDeepSeekSettingsButton = requiredElement<HTMLButtonElement>('save-deepseek-settings');
const testDeepSeekButton = requiredElement<HTMLButtonElement>('test-deepseek');
const visionAiModeSelect = requiredElement<HTMLSelectElement>('vision-ai-mode');
const visionAiFields = requiredElement<HTMLElement>('vision-ai-fields');
const visionApiKeyInput = requiredElement<HTMLInputElement>('vision-api-key');
const visionModelInput = requiredElement<HTMLInputElement>('vision-model');
const visionBaseUrlInput = requiredElement<HTMLInputElement>('vision-base-url');
const visionSettingsStatus = requiredElement<HTMLElement>('vision-settings-status');
const testVisionAiButton = requiredElement<HTMLButtonElement>('test-vision-ai');
const aiTabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ai-tabs button'));
const aiTabPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-ai-panel]'));
const selectedSnippetElement = requiredElement<HTMLElement>('selected-snippet');
const translationResultElement = requiredElement<HTMLElement>('translation-result');
const explanationResultElement = requiredElement<HTMLElement>('explanation-result');
const saveTranslationNoteButton = requiredElement<HTMLButtonElement>('save-translation-note');
const copyTranslationButton = requiredElement<HTMLButtonElement>('copy-translation');
const summaryPanelElement = requiredElement<HTMLElement>('summary-panel');
const summaryRangeElement = requiredElement<HTMLElement>('summary-range');
const summarySourceElement = requiredElement<HTMLElement>('summary-source');
const summaryPositionElement = requiredElement<HTMLElement>('summary-position');
const summaryResultElement = requiredElement<HTMLElement>('summary-result');
const summaryScopeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-summary-scope]'),
);
const copySummaryButton = requiredElement<HTMLButtonElement>('copy-summary');
const saveSummaryNoteButton = requiredElement<HTMLButtonElement>('save-summary-note');
const cardsPanelElement = requiredElement<HTMLElement>('cards-panel');
const cardSourceSnippetElement = requiredElement<HTMLElement>('card-source-snippet');
const cardGenerationStatusElement = requiredElement<HTMLElement>('card-generation-status');
const cardGeneratedContentElement = requiredElement<HTMLElement>('card-generated-content');
const cardTitleElement = requiredElement<HTMLElement>('card-title');
const cardExplanationElement = requiredElement<HTMLElement>('card-explanation');
const cardKeyPointsElement = requiredElement<HTMLUListElement>('card-key-points');
const cardPurposeElement = requiredElement<HTMLElement>('card-purpose');
const cardUnderstandingElement = requiredElement<HTMLElement>('card-understanding');
const cardSourceLocationElement = requiredElement<HTMLElement>('card-source-location');
const cardTypeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-card-type]'),
);
const copyCardButton = requiredElement<HTMLButtonElement>('copy-card');
const saveCardButton = requiredElement<HTMLButtonElement>('save-card');
const outlineList = document.querySelector<HTMLElement>('.outline-list');

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
    'yellow=#FFF066,green=#9BE7A5,blue=#8EC5FF,pink=#FF9FC9,orange=#FFC078',
  removePageBorders: false,
  enableAutoLinking: true,
});

linkService.setViewer(pdfViewer);

let pdfDocument: PDFDocumentProxy | null = null;
let sourceName = '';
let annotationEditor: AnnotationEditorUIManager | null = null;
let activeEditorMode = AnnotationEditorType.NONE;
let canUndoAnnotation = false;
let canRedoAnnotation = false;
let hasUnsavedChanges = false;
let savedAnnotationSnapshot = '';
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
let contextSelectionText = '';
let selectedAnnotationEditor: any | null = null;
let selectedHighlightEditor: any | null = null;
let contextHighlightEditor: any | null = null;
let openHighlightNoteEditor: any | null = null;
const nativeAnnotationNotes = new Map<string, string>();
const restoredHelperNotesBySignature = new Map<string, string>();
const restoredHelperNotesByStorageKey = new Map<string, string>();
let lastPointerDown:
  | {
      x: number;
      y: number;
      button: number;
    }
  | null = null;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as T;
}

function setStatus(message: string, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openRecentFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECENT_FILES_DB_NAME, RECENT_FILES_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECENT_FILES_STORE_NAME)) {
        db.createObjectStore(RECENT_FILES_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开最近文件数据库。'));
  });
}

async function readRecentFiles(): Promise<RecentPdfEntry[]> {
  if (!('indexedDB' in window)) return [];
  const db = await openRecentFilesDb();

  try {
    const transaction = db.transaction(RECENT_FILES_STORE_NAME, 'readonly');
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
  if (!('indexedDB' in window)) return;
  const db = await openRecentFilesDb();

  try {
    const transaction = db.transaction(RECENT_FILES_STORE_NAME, 'readwrite');
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

function createRecentEntryId(kind: RecentPdfEntry['kind'], name: string): string {
  const suffix = typeof crypto.randomUUID === 'function'
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
    if (entry.kind !== 'local' || !entry.fileHandle) continue;
    try {
      if (fileHandle.isSameEntry && (await fileHandle.isSameEntry(entry.fileHandle))) {
        return entry;
      }
    } catch {
      // Some browsers can throw if an old handle is no longer available.
    }
  }

  return entries.find((entry) => entry.kind === 'local' && entry.name === name) ?? null;
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
      const existingEntry = await findSameRecentLocalEntry(fileHandle, entries, name);
      entry = {
        ...existingEntry,
        id: existingEntry?.id ?? createRecentEntryId('local', name),
        name,
        kind: 'local',
        lastOpenedAt: Date.now(),
        fileHandle,
      };
    } else if (url) {
      const existingEntry = entries.find((item) => item.id === `remote:${url}`);
      entry = {
        ...existingEntry,
        id: `remote:${url}`,
        name,
        kind: 'remote',
        lastOpenedAt: Date.now(),
        url,
      };
    }

    if (!entry) return null;

    const nextEntries = [entry, ...entries.filter((item) => item.id !== entry.id)].slice(
      0,
      RECENT_FILES_LIMIT,
    );
    await writeRecentFiles(nextEntries);
    if (!recentFilesDialog.hidden) void renderRecentFiles();
    return entry;
  } catch (error) {
    console.warn('PDF Helper failed to remember recent PDF.', error);
    return null;
  }
}

async function removeRecentFile(id: string) {
  const entries = await readRecentFiles();
  await writeRecentFiles(entries.filter((entry) => entry.id !== id));
}

function formatRecentTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
  if (!pdfDocument || !currentRecentEntryId || isOpeningDocument || isRestoringReadingPosition) return;

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
    console.warn('PDF Helper failed to persist reading position.', error);
  }
}

function scheduleReadingPositionSave() {
  if (!pdfDocument || !currentRecentEntryId || isOpeningDocument || isRestoringReadingPosition) return;
  cancelReadingPositionSave();
  readingPositionSaveHandle = window.setTimeout(() => {
    void persistCurrentReadingPosition();
  }, 600);
}

function restoreReadingPositionAfterPagesInit() {
  const position = pendingReadingPosition;
  pendingReadingPosition = null;

  if (!pdfDocument || !position) {
    pdfViewer.currentScaleValue = 'page-width';
    return;
  }

  isRestoringReadingPosition = true;
  const pageNumber = Math.min(pdfDocument.numPages, Math.max(1, Math.round(position.pageNumber || 1)));
  const scale = Number(position.scale);

  if (Number.isFinite(scale) && scale > 0) {
    pdfViewer.currentScale = Math.max(0.1, Math.min(10, scale));
  } else {
    pdfViewer.currentScaleValue = 'page-width';
  }

  pdfViewer.currentPageNumber = pageNumber;

  const applyPosition = () => {
    viewerContainer.scrollTop = Math.max(
      0,
      Number.isFinite(position.scrollTop) ? position.scrollTop : viewerContainer.scrollTop,
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

async function requestFileReadPermission(fileHandle: FileHandleLike): Promise<boolean> {
  const descriptor = { mode: 'read' as const };
  const currentPermission = await fileHandle.queryPermission?.(descriptor);
  if (!currentPermission || currentPermission === 'granted') return true;
  if (!fileHandle.requestPermission) return false;
  return (await fileHandle.requestPermission(descriptor)) === 'granted';
}

async function openRecentFile(entry: RecentPdfEntry) {
  if (pdfDocument && !confirmDiscardUnsavedChanges()) return;
  hideRecentFilesDialog();

  try {
    if (entry.kind === 'local') {
      if (!entry.fileHandle) throw new Error('这条最近记录没有可用的文件句柄，请重新打开一次 PDF。');
      const hasPermission = await requestFileReadPermission(entry.fileHandle);
      if (!hasPermission) throw new Error('没有获得读取该 PDF 的权限。');
      const file = await entry.fileHandle.getFile();
      await openPdf(await file.arrayBuffer(), file.name, entry.fileHandle, false);
      return;
    }

    if (entry.kind === 'remote' && entry.url) {
      await openRemotePdf(entry.url);
      return;
    }

    throw new Error('最近记录无效。');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function renderRecentFiles() {
  recentFilesList.textContent = '';

  try {
    const entries = await readRecentFiles();

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-files-empty';
      empty.textContent = '暂无最近打开记录。用“打开PDF”打开一次文件后，这里会自动记录。';
      recentFilesList.append(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'recent-file-item';

      const openButton = document.createElement('button');
      openButton.className = 'recent-file-open';
      openButton.type = 'button';
      openButton.title = entry.name;

      const name = document.createElement('span');
      name.className = 'recent-file-name';
      name.textContent = getDisplayFileName(entry.name);

      const meta = document.createElement('span');
      meta.className = 'recent-file-meta';
      const positionText = entry.readingPosition?.pageNumber
        ? ` · 上次读到第 ${entry.readingPosition.pageNumber} 页`
        : '';
      meta.textContent = `${entry.kind === 'local' ? '本地文件' : '远程 PDF'} · ${formatRecentTime(
        entry.lastOpenedAt,
      )}${positionText}`;

      openButton.append(name, meta);
      openButton.addEventListener('click', () => {
        void openRecentFile(entry);
      });

      const removeButton = document.createElement('button');
      removeButton.className = 'recent-file-remove';
      removeButton.type = 'button';
      removeButton.title = '移除记录';
      removeButton.textContent = '×';
      removeButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await removeRecentFile(entry.id);
        await renderRecentFiles();
      });

      item.append(openButton, removeButton);
      recentFilesList.append(item);
    }
  } catch (error) {
    const empty = document.createElement('div');
    empty.className = 'recent-files-empty';
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
  if (!pdfDocument) return '';

  try {
    const entries = getSerializableAnnotationEntries().sort(([leftKey], [rightKey]) =>
      String(leftKey).localeCompare(String(rightKey)),
    );
    return JSON.stringify(entries);
  } catch (error) {
    console.warn('PDF Helper annotation snapshot failed.', error);
    return '';
  }
}

function updateUnsavedChangesFromSnapshot() {
  if (!pdfDocument || isSavingAnnotatedPdf || isOpeningDocument) return;
  hasUnsavedChanges = getCurrentAnnotationSnapshot() !== savedAnnotationSnapshot;
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
  format: 'pdf-helper.annotations';
  version: 1;
  app: 'PDF Helper';
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

const PDF_HELPER_ATTACHMENT_NAME = 'pdfhelper.json';
const PDF_HELPER_ATTACHMENT_DESCRIPTION =
  'PDF Helper internal annotation data. Open with PDF Helper to restore enhanced reading notes.';
const DEFAULT_HIGHLIGHT_RGB = [255, 240, 102] as const;
const FREE_TEXT_MIN_SIZE = 4;
const FREE_TEXT_MAX_SIZE = 72;
const FREE_TEXT_DEFAULT_SIZE = 16;
const RECENT_FILES_DB_NAME = 'pdf-helper-recent-files';
const RECENT_FILES_DB_VERSION = 1;
const RECENT_FILES_STORE_NAME = 'recent-files';
const RECENT_FILES_LIMIT = 12;

type RecentPdfEntry = {
  id: string;
  name: string;
  kind: 'local' | 'remote';
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPdfFingerprint(documentProxy: PDFDocumentProxy | null = pdfDocument): string {
  return (
    documentProxy?.fingerprints?.find((fingerprint): fingerprint is string => Boolean(fingerprint)) ||
    ''
  );
}

function normalizeStorageKey(key: string): string {
  return key.replace(/^(pdf-helper-)+/, '');
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
  return Boolean((editor?.div as HTMLElement | null)?.classList?.contains(className));
}

function isHighlightEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === 'highlight' ||
    type === AnnotationEditorType.HIGHLIGHT ||
    editor?.constructor?._type === 'highlight' ||
    editor?.constructor?._editorType === AnnotationEditorType.HIGHLIGHT ||
    hasEditorClass(editor, 'highlightEditor')
  );
}

function isFreeTextEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === 'freeText' ||
    type === AnnotationEditorType.FREETEXT ||
    editor?.constructor?._type === 'freeText' ||
    editor?.constructor?._editorType === AnnotationEditorType.FREETEXT ||
    hasEditorClass(editor, 'freeTextEditor')
  );
}

function isInkEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === 'ink' ||
    type === AnnotationEditorType.INK ||
    editor?.constructor?._type === 'ink' ||
    editor?.constructor?._editorType === AnnotationEditorType.INK ||
    hasEditorClass(editor, 'inkEditor')
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
  const normalized = color.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function normalizeRgbColor(value: unknown): number[] | null {
  if (typeof value === 'string') return hexColorToRgb(value);

  const numbers = flattenFiniteNumbers(value);
  if (numbers.length < 3) return null;

  return numbers.slice(0, 3).map((channel) => Math.min(255, Math.max(0, Math.round(channel))));
}

function rgbColorToHex(value: unknown): string | null {
  const rgb = normalizeRgbColor(value);
  if (!rgb) return null;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function sanitizeAnnotationStorageValue(value: Record<string, unknown>): Record<string, unknown> {
  const output = { ...value };

  // Runtime/UI fields must not be serialized back into pdf.js. They are valid
  // while an editor is alive, but stale copies can break deserialization after
  // reopening a PDF.
  for (const key of [
    '_uiManager',
    'uiManager',
    'parent',
    'div',
    'editor',
    'colorManager',
    'colorName',
    'hcmColor',
    'hcmColorName',
    'nonHCMColorName',
  ]) {
    delete output[key];
  }

  if (isStoredHighlightValue(output)) {
    const color = normalizeRgbColor(output.color) ?? DEFAULT_HIGHLIGHT_RGB.slice();
    output.color = color;
    if (output.highlightColor !== undefined) delete output.highlightColor;
  }

  return output;
}

function flattenFiniteNumbers(value: unknown, output: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output.push(value);
  } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    for (const item of Array.from(value as unknown as ArrayLike<number>)) {
      if (typeof item === 'number' && Number.isFinite(item)) output.push(item);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) flattenFiniteNumbers(item, output);
  }
  return output;
}

function getNumberArraySignature(value: unknown): string {
  return flattenFiniteNumbers(value)
    .map((number) => number.toFixed(3))
    .join(',');
}

function getAnnotationGeometrySignature(value: unknown): string {
  if (!isRecord(value) || !Number.isInteger(value.pageIndex)) return '';

  const annotationType = value.annotationType ?? value.annotationEditorType ?? '';
  const rect = getNumberArraySignature(value.rect);
  const quadPoints = getNumberArraySignature(value.quadPoints);
  const outlines = isRecord(value.outlines) ? getNumberArraySignature(value.outlines.points) : '';

  return [value.pageIndex, annotationType, rect, quadPoints, outlines].join('|');
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
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
        .map(normalizeStorageKey),
    ),
  );
}

function rememberHelperNote(key: string | undefined, signature: string | undefined, note: string) {
  const normalizedNote = note.trim();
  if (!normalizedNote) return;

  if (key) restoredHelperNotesByStorageKey.set(normalizeStorageKey(key), normalizedNote);
  if (signature) restoredHelperNotesBySignature.set(signature, normalizedNote);
}

function forgetHelperNote(key: string | undefined, signature: string | undefined) {
  if (key) restoredHelperNotesByStorageKey.delete(normalizeStorageKey(key));
  if (signature) restoredHelperNotesBySignature.delete(signature);
}

function getRememberedHelperNote(keys: string[], signature: string): string {
  for (const key of keys) {
    const note = restoredHelperNotesByStorageKey.get(normalizeStorageKey(key))?.trim();
    if (note) return note;
  }

  return (signature ? restoredHelperNotesBySignature.get(signature)?.trim() : '') || '';
}

function toJsonSafeAnnotationValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typedArray = value as unknown as ArrayLike<number> & { constructor: { name: string } };
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
    if (typeof value.__pdfHelperTypedArray === 'string' && Array.isArray(value.values)) {
      const values = value.values as number[];
      switch (value.__pdfHelperTypedArray) {
        case 'Float32Array':
          return new Float32Array(values);
        case 'Float64Array':
          return new Float64Array(values);
        case 'Uint8Array':
          return new Uint8Array(values);
        case 'Uint8ClampedArray':
          return new Uint8ClampedArray(values);
        case 'Uint16Array':
          return new Uint16Array(values);
        case 'Uint32Array':
          return new Uint32Array(values);
        case 'Int8Array':
          return new Int8Array(values);
        case 'Int16Array':
          return new Int16Array(values);
        case 'Int32Array':
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
        (value.annotationType !== undefined || value.annotationEditorType !== undefined)
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

      return [normalizedKey, toJsonSafeAnnotationValue(sanitizeAnnotationStorageValue(output))];
    });
}

function getSerializableHelperNotes(): EmbeddedHelperNote[] {
  if (!pdfDocument) return [];

  const notes = new Map<string, EmbeddedHelperNote>();
  const addNote = (key: string | undefined, signature: string | undefined, note: string) => {
    const normalizedNote = note.trim();
    if (!normalizedNote) return;
    const normalizedKey = key ? normalizeStorageKey(key) : undefined;
    const id = `${normalizedKey || ''}|${signature || ''}|${normalizedNote}`;
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
    for (let pageIndex = 0; pageIndex < (pdfDocument?.numPages ?? 0); pageIndex += 1) {
      for (const editor of annotationEditor.getEditors(pageIndex)) {
        if (!isHighlightEditor(editor)) continue;
        const note = getHighlightNote(editor);
        if (!note) continue;
        const signature = getAnnotationGeometrySignature(getEditorSerializedValue(editor));
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
  if (!pdfDocument) throw new Error('PDF 尚未打开。');
  const entries = getSerializableAnnotationEntries();
  return {
    format: 'pdf-helper.annotations',
    version: 1,
    app: 'PDF Helper',
    sourceName,
    fingerprint: getPdfFingerprint(pdfDocument),
    savedAt: new Date().toISOString(),
    entries,
    notes: getSerializableHelperNotes(),
  };
}

function parseEmbeddedHelperPayload(rawJson: string): EmbeddedHelperAnnotations | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  if (payload.format !== 'pdf-helper.annotations') return null;
  if (payload.version !== 1) return null;
  if (!Array.isArray(payload.entries)) return null;

  return payload as EmbeddedHelperAnnotations;
}

function decodeAttachmentContent(content: unknown): string | null {
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(content));
  if (Array.isArray(content)) return new TextDecoder().decode(new Uint8Array(content));
  if (typeof content === 'string') return content;
  return null;
}

async function readEmbeddedHelperPayload(
  documentProxy: PDFDocumentProxy,
): Promise<EmbeddedHelperAnnotations | null> {
  const attachments = (await documentProxy.getAttachments()) as
    | Record<string, { content?: unknown; filename?: string }>
    | null;
  if (!attachments) return null;

  const candidates: EmbeddedHelperAnnotations[] = [];
  for (const [name, attachment] of Object.entries(attachments)) {
    const filename = attachment.filename || name;
    if (filename !== PDF_HELPER_ATTACHMENT_NAME && name !== PDF_HELPER_ATTACHMENT_NAME) continue;
    const rawJson = decodeAttachmentContent(attachment.content);
    if (!rawJson) continue;
    const payload = parseEmbeddedHelperPayload(rawJson);
    if (payload) candidates.push(payload);
  }

  return candidates.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
}

async function embedHelperAnnotationsIntoPdf(): Promise<{ bytes: Uint8Array; count: number }> {
  if (!pdfDocument || !sourcePdfBytes) throw new Error('PDF 尚未打开，无法保存批注。');
  const payload = createEmbeddedHelperPayload();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const { PDFDocument: PdfLibDocument } = await import('pdf-lib');
  const pdfDoc = await PdfLibDocument.load(sourcePdfBytes, { ignoreEncryption: true });
  const now = new Date();

  await pdfDoc.attach(jsonBytes, PDF_HELPER_ATTACHMENT_NAME, {
    mimeType: 'application/json',
    description: PDF_HELPER_ATTACHMENT_DESCRIPTION,
    creationDate: now,
    modificationDate: now,
  });

  const bytes = await pdfDoc.save();
  (pdfDocument as any).annotationStorage?.resetModified?.();
  return { bytes, count: payload.entries.length };
}

async function requestFileWritePermission(fileHandle: FileHandleLike): Promise<boolean> {
  const descriptor: FileHandlePermissionDescriptor = { mode: 'readwrite' };

  try {
    const currentPermission = await fileHandle.queryPermission?.(descriptor);
    if (currentPermission === 'granted') return true;

    if (fileHandle.requestPermission) {
      const requestedPermission = await fileHandle.requestPermission(descriptor);
      return requestedPermission === 'granted';
    }

    return currentPermission !== 'denied';
  } catch {
    // Some browser/extension combinations do not expose permission helpers but
    // still prompt from createWritable(). Let that path decide.
    return true;
  }
}

function downloadEmbeddedPdfBytes(blob: Blob) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const baseName = sourceName.split('/').pop()?.replace(/\.pdf$/i, '') || 'document';
  link.href = blobUrl;
  link.download = `${safeDecodeURIComponent(baseName)}-pdfhelper.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

async function writeEmbeddedPdfBytes(
  bytes: Uint8Array,
): Promise<'overwritten' | 'downloaded' | 'permission-denied-downloaded'> {
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  const blob = new Blob([blobBuffer], { type: 'application/pdf' });

  if (currentFileHandle) {
    const hasWritePermission = await requestFileWritePermission(currentFileHandle);
    if (!hasWritePermission) {
      downloadEmbeddedPdfBytes(blob);
      return 'permission-denied-downloaded';
    }

    try {
      const writable = await currentFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'overwritten';
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
      downloadEmbeddedPdfBytes(blob);
      return 'permission-denied-downloaded';
    }
  }

  downloadEmbeddedPdfBytes(blob);
  return 'downloaded';
}

function restoreHelperNoteIndexes(notes: unknown) {
  if (!Array.isArray(notes)) return;

  for (const item of notes) {
    if (!isRecord(item)) continue;
    const note = extractCommentText(item.note);
    if (!note) continue;
    const key = typeof item.key === 'string' ? item.key : undefined;
    const signature = typeof item.signature === 'string' ? item.signature : undefined;
    rememberHelperNote(key, signature, note);
  }
}

function restoreEmbeddedHelperPayload(payload: EmbeddedHelperAnnotations | null): number {
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
      (value.annotationType === undefined && value.annotationEditorType === undefined)
    ) {
      continue;
    }

    const normalizedKey = normalizeStorageKey(String(key));
    const signature = getAnnotationGeometrySignature(value);
    const note =
      getAnnotationNoteFromValue(value) ||
      getRememberedHelperNote([normalizedKey, `pdf-helper-${normalizedKey}`], signature);
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

async function restoreHelperAnnotations(documentProxy: PDFDocumentProxy): Promise<number> {
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
  viewerElement.classList.toggle('pdf-helper-notes-hidden', areNoteIndicatorsHidden);
  toggleNotesButton.textContent = areNoteIndicatorsHidden ? '显示笔记' : '隐藏笔记';
  if (areNoteIndicatorsHidden) hideHighlightNote();
}

function confirmDiscardUnsavedChanges(): boolean {
  if (!hasUnsavedChanges) return true;
  return window.confirm('当前 PDF 有未保存的批注或笔记。是否放弃这些更改并继续？');
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
  appFrame?.classList.toggle('left-panel-collapsed', collapsed);
  outlineToggleButton?.classList.toggle('active', !collapsed);
}

function setFocusMode(enabled: boolean): void {
  if (!appFrame) return;

  appFrame.classList.toggle('focus-mode', enabled);
  const isEnabled = appFrame.classList.contains('focus-mode');
  focusModeButton.classList.toggle('active', isEnabled);
  focusModeButton.setAttribute('aria-pressed', String(isEnabled));
  focusModeButton.title = isEnabled ? '恢复顶部工具栏' : '隐藏顶部工具栏，专注阅读 PDF';
  focusModeLabel.textContent = isEnabled ? '退出专注' : '专注模式';
}

function updateOutlineActivePage() {
  if (!outlineList) return;
  const currentPage = String(pdfViewer.currentPageNumber || '');
  for (const button of Array.from(outlineList.querySelectorAll<HTMLButtonElement>('button'))) {
    button.classList.toggle('active', button.dataset.outlinePage === currentPage);
  }
}

function clearOutlineList(message: string) {
  if (!outlineList) return;
  outlineList.textContent = '';
  const placeholder = document.createElement('div');
  placeholder.className = 'outline-empty';
  placeholder.textContent = message;
  outlineList.appendChild(placeholder);
}

async function getDestinationPageNumber(
  documentProxy: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    const explicitDest = typeof dest === 'string' ? await documentProxy.getDestination(dest) : await dest;
    if (!Array.isArray(explicitDest)) return null;

    const [destRef] = explicitDest;
    if (destRef && typeof destRef === 'object') {
      const cachedPageNumber = (documentProxy as any).cachedPageNumber?.(destRef);
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
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.paddingLeft = `${12 + depth * 18}px`;
  if (pageNumber) button.dataset.outlinePage = String(pageNumber);
  button.addEventListener('click', onClick);
  outlineList.appendChild(button);
}

async function renderOutlineItems(
  documentProxy: PDFDocumentProxy,
  items: Array<{ title?: string; dest?: unknown; items?: unknown[] }>,
  depth = 0,
) {
  for (const item of items) {
    const title = item.title?.trim() || '未命名目录项';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = title;
    button.style.paddingLeft = `${12 + depth * 18}px`;
    button.addEventListener('click', () => {
      if (item.dest) void navigateToDestinationWithoutReturnHistory(item.dest);
    });
    outlineList?.appendChild(button);

    if (item.dest) {
      void getDestinationPageNumber(documentProxy, item.dest).then((pageNumber) => {
        if (!pageNumber || pdfDocument !== documentProxy) return;
        button.dataset.outlinePage = String(pageNumber);
        updateOutlineActivePage();
        updateSummaryMetadata();
      });
    }

    if (Array.isArray(item.items) && item.items.length > 0) {
      await renderOutlineItems(documentProxy, item.items as any, depth + 1);
    }
  }
}

async function renderDocumentOutline(documentProxy: PDFDocumentProxy) {
  if (!outlineList) return;
  outlineList.textContent = '';

  try {
    const outline = (await documentProxy.getOutline()) as
      | Array<{ title?: string; dest?: unknown; items?: unknown[] }>
      | null;
    if (pdfDocument !== documentProxy) return;

    if (outline && outline.length > 0) {
      await renderOutlineItems(documentProxy, outline);
      updateOutlineActivePage();
      updateSummaryMetadata();
      return;
    }
  } catch (error) {
    console.warn('PDF Helper outline load failed.', error);
  }

  if (pdfDocument !== documentProxy) return;
  outlineList.textContent = '';
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
    .replace(/\u00ad/g, '')
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, '$1$2')
    .replace(/[\t ]+\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/\s*\n\s*/g, ' ')
        .replace(/[\t ]{2,}/g, ' ')
        .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

function getViewerSelectionRawText(): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !viewerElement.contains(selection.anchorNode)) {
    return '';
  }
  return selection.toString();
}

function getViewerSelectionText(): string {
  return normalizeCopiedText(getViewerSelectionRawText());
}

const AUTO_TRANSLATE_DELAY_MS = 700;
const MAX_SUMMARY_SOURCE_LENGTH = 18_000;
const MAX_CARD_SOURCE_LENGTH = 18_000;
const MAX_PAPER_CARD_SOURCE_LENGTH = 55_000;
const SUMMARY_NOTES_STORAGE_KEY = 'pdf-helper-summary-notes-v1';
const SAVED_CARDS_STORAGE_KEY = 'pdf-helper-saved-cards-v1';
const SAVED_PAPER_OVERVIEWS_STORAGE_KEY = 'pdf-helper-paper-overviews-v1';
const KNOWLEDGE_NOTES_STORAGE_KEY = 'pdf-helper-knowledge-notes-v1';
const KNOWLEDGE_ITEM_META_STORAGE_KEY = 'pdf-helper-knowledge-item-meta-v1';

type SummaryScope = 'selection' | 'page' | 'chapter';
type CardType = 'concept' | 'method' | 'experiment' | 'viewpoint';
type KnowledgeKind = 'note' | 'reading-card' | 'paper-card';
type KnowledgeFilter = 'all' | KnowledgeKind;
type KnowledgeSource = 'knowledge-note' | 'summary-note' | 'reading-card' | 'paper-overview';
type KnowledgePageMode = 'library' | 'qa' | 'insights';
type KnowledgeFocus = 'all' | 'todo' | 'deep' | 'finished' | 'citable' | 'replicate' | 'related' | 'methods';
type KnowledgeResearchScope = 'selected' | 'filtered' | 'all';

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
let selectedTextForAi = '';
let selectedTextPageNumber = 0;
let lastTranslatedText = '';
let lastExplainedText = '';
let autoTranslateTimer: ReturnType<typeof setTimeout> | null = null;
let translationAbortController: AbortController | null = null;
let explanationAbortController: AbortController | null = null;
let summaryAbortController: AbortController | null = null;
let activeSummaryScope: SummaryScope = 'selection';
let lastSummaryRequestKey = '';
let lastSummaryPoints: string[] = [];
let currentSummaryContext: SummaryContext | null = null;
let summaryGenerationTimer: ReturnType<typeof setTimeout> | null = null;
let cardAbortController: AbortController | null = null;
let activeCardType: CardType = 'method';
let lastCardRequestKey = '';
let currentCardContext: CardContext | null = null;
let currentGeneratedCard: GeneratedCardContent | null = null;
let cardGenerationTimer: ReturnType<typeof setTimeout> | null = null;
let paperCardPageAbortController: AbortController | null = null;
let paperCardPageDocumentKey = '';
let paperCardPageSourceCache: { document: PDFDocumentProxy; text: string } | null = null;
let editingPaperOverviewId: string | null = null;
let paperCardReviewDocumentName = '';
let paperCardReturnTarget: 'pdf' | 'knowledge' = 'pdf';
let activeKnowledgeFilter: KnowledgeFilter = 'all';
let activeKnowledgeCategory = 'all';
let activeKnowledgeTag = '';
let activeKnowledgeFocus: KnowledgeFocus = 'all';
let activeKnowledgeYear = 'all';
let activeKnowledgeVenue = 'all';
let activeKnowledgeReadingStatus = 'all';
let activeKnowledgePriority = 'all';

const APP_VIEW_SESSION_STORAGE_KEY = 'pdf-helper-app-view-state-v1';

type PersistedAppView = 'viewer' | 'knowledge' | 'paper-review';

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
    if (value.view !== 'viewer' && value.view !== 'knowledge' && value.view !== 'paper-review') {
      return null;
    }
    return {
      view: value.view,
      knowledgeMode: value.knowledgeMode === 'qa' || value.knowledgeMode === 'insights'
        ? value.knowledgeMode
        : 'library',
      knowledgeFilter: value.knowledgeFilter === 'note'
        || value.knowledgeFilter === 'reading-card'
        || value.knowledgeFilter === 'paper-card'
        ? value.knowledgeFilter
        : 'all',
      knowledgeCategory: typeof value.knowledgeCategory === 'string' ? value.knowledgeCategory : 'all',
      knowledgeTag: typeof value.knowledgeTag === 'string' ? value.knowledgeTag : '',
      knowledgeFocus: value.knowledgeFocus === 'todo'
        || value.knowledgeFocus === 'deep'
        || value.knowledgeFocus === 'finished'
        || value.knowledgeFocus === 'citable'
        || value.knowledgeFocus === 'replicate'
        || value.knowledgeFocus === 'related'
        || value.knowledgeFocus === 'methods'
        ? value.knowledgeFocus
        : 'all',
      knowledgeYear: typeof value.knowledgeYear === 'string' ? value.knowledgeYear : 'all',
      knowledgeVenue: typeof value.knowledgeVenue === 'string' ? value.knowledgeVenue : 'all',
      knowledgeReadingStatus: typeof value.knowledgeReadingStatus === 'string'
        ? value.knowledgeReadingStatus
        : 'all',
      knowledgePriority: typeof value.knowledgePriority === 'string' ? value.knowledgePriority : 'all',
      knowledgeSearch: typeof value.knowledgeSearch === 'string' ? value.knowledgeSearch : '',
      knowledgeSort: typeof value.knowledgeSort === 'string' ? value.knowledgeSort : 'newest',
      knowledgeGroup: typeof value.knowledgeGroup === 'string' ? value.knowledgeGroup : 'none',
      knowledgeResearchScope: typeof value.knowledgeResearchScope === 'string'
        ? value.knowledgeResearchScope
        : 'selected',
      knowledgeResearchQuestion: typeof value.knowledgeResearchQuestion === 'string'
        ? value.knowledgeResearchQuestion
        : '',
      knowledgeInsightQuestion: typeof value.knowledgeInsightQuestion === 'string'
        ? value.knowledgeInsightQuestion
        : '',
      selectedKnowledgeRecordKey: typeof value.selectedKnowledgeRecordKey === 'string'
        ? value.selectedKnowledgeRecordKey
        : '',
      selectedKnowledgeResearchKeys: Array.isArray(value.selectedKnowledgeResearchKeys)
        ? value.selectedKnowledgeResearchKeys.filter((key): key is string => typeof key === 'string')
        : [],
      knowledgeScrollTop: Number.isFinite(value.knowledgeScrollTop) ? Number(value.knowledgeScrollTop) : 0,
      reviewPaperOverviewId: typeof value.reviewPaperOverviewId === 'string'
        ? value.reviewPaperOverviewId
        : '',
      paperCardScrollTop: Number.isFinite(value.paperCardScrollTop) ? Number(value.paperCardScrollTop) : 0,
    };
  } catch {
    return null;
  }
}

function getCurrentPersistedAppView(): PersistedAppView {
  if (!paperCardPageElement.hidden && editingPaperOverviewId) return 'paper-review';
  if (!knowledgeBasePageElement.hidden) return 'knowledge';
  return 'viewer';
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
    knowledgeScrollTop: knowledgeMainElement.scrollTop,
    reviewPaperOverviewId: editingPaperOverviewId || '',
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
  if (!state || state.view === 'viewer') return;

  applyPersistedKnowledgeState(state);

  if (state.view === 'paper-review' && state.reviewPaperOverviewId) {
    const item = collectKnowledgeItems().find(
      (candidate) => candidate.source === 'paper-overview'
        && candidate.id === state.reviewPaperOverviewId,
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
    knowledgeMainElement.scrollTop = Math.max(0, state.knowledgeScrollTop);
  });
}

let selectedKnowledgeRecordKey = '';
let knowledgeEditorTargetKey: string | null = null;
let activeKnowledgePageMode: KnowledgePageMode = 'library';
let selectedKnowledgeResearchKeys = new Set<string>();
let activeKnowledgeInsightPrompt = '请综合材料生成一份研究洞察报告，包含：文献共识、关键分歧、方法演进、尚未解决的问题、3 个有依据的新想法、每个想法的可检验假设与最小验证方案。';
let lastKnowledgeResearchAnswer = '';
let lastKnowledgeResearchQuestion = '';
let lastKnowledgeResearchItems: KnowledgeItem[] = [];
let knowledgeResearchPending = false;
let aiConfig: AiConfig = { ...DEFAULT_AI_CONFIG };
let aiConfigLoaded = false;
let visionAiConfig: VisionAiConfig = { ...DEFAULT_VISION_AI_CONFIG };
let chatHistory: AiConversationMessage[] = [];
let chatRequestPending = false;
let readingModePreference: ReadingModePreference = 'auto';
let resolvedReadingMode: ResolvedReadingMode = 'general';
let readingModeDetectionPending = false;
let readingModeDocumentKey = '';
let readingModeRationale = '';
let readingModeError = '';
type AssistantView = 'chat' | 'translate' | 'summary' | 'cards';
let activeAssistantView: AssistantView = 'chat';

function setAssistantView(view: AssistantView): void {
  activeAssistantView = view;
  const showChat = view === 'chat';
  for (const button of assistantViewButtons) {
    const isActive = button.dataset.assistantView === view;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  }

  assistantChatPanel.hidden = !showChat;
  assistantToolsRuntime.classList.toggle('active', !showChat);
  assistantToolsRuntime.setAttribute('aria-hidden', String(showChat));

  if (view !== 'translate') cancelPendingAutomaticTranslation();
  if (view !== 'summary') cancelPendingSummaryGeneration();
  if (view !== 'cards') cancelPendingCardGeneration();

  if (showChat) {
    window.setTimeout(() => chatInput.focus(), 0);
  } else {
    activateAiTab(view);
  }
}


let settingsSavedFeedbackTimer: number | undefined;

function showSettingsSavedFeedback(): void {
  if (settingsSavedFeedbackTimer !== undefined) {
    window.clearTimeout(settingsSavedFeedbackTimer);
  }

  aiSettingsButton.classList.add('saved');
  aiSettingsButton.textContent = '✓ 已保存';
  aiSettingsButton.setAttribute('aria-label', 'AI 设置已保存');

  settingsSavedFeedbackTimer = window.setTimeout(() => {
    aiSettingsButton.classList.remove('saved');
    aiSettingsButton.textContent = '⚙ 设置';
    aiSettingsButton.setAttribute('aria-label', '打开 AI 设置');
    settingsSavedFeedbackTimer = undefined;
  }, 1400);
}

function setDeepSeekSettingsOpen(open: boolean): void {
  if (assistantSettingsPanel.parentElement !== document.body) {
    document.body.append(assistantSettingsPanel);
  }
  assistantSettingsPanel.hidden = !open;
  settingsModalBackdrop.hidden = !open;
  settingsModalBackdrop.setAttribute('aria-hidden', String(!open));
  if (appFrame) appFrame.inert = open;
  document.body.classList.toggle('settings-modal-open', open);
  aiSettingsButton.classList.toggle('active', open);
  aiSettingsButton.setAttribute('aria-expanded', String(open));
  if (open) {
    window.setTimeout(() => deepSeekApiKeyInput.focus(), 0);
  } else {
    aiSettingsButton.focus();
  }
}

async function requestAiContent(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage['context'] = {},
): Promise<string> {
  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = '请先配置并保存模型供应商的 API Key。';
    throw new Error('请先在右上角“设置”中配置 API Key。');
  }

  const response = await browser.runtime.sendMessage({
    type: 'pdf-helper:ai-chat',
    messages,
    context: {
      ...context,
      readingMode: context.readingMode ?? resolvedReadingMode,
    },
  }) as AiRuntimeResponse;

  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || 'AI 模型没有返回有效内容。');
  }
  return response.content.trim();
}

function parseAiList(content: string): string[] {
  const points = content
    .replace(/^```(?:markdown|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
    .filter(Boolean);
  return points.length > 1 ? points : [content.trim()].filter(Boolean);
}

function parseAiJson(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效 JSON。');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

interface MarkdownMathToken {
  expression: string;
  displayMode: boolean;
}

interface MarkdownCitationToken {
  pageNumber: number;
  quote: string;
}

function protectMarkdownCitations(content: string): {
  markdown: string;
  tokens: MarkdownCitationToken[];
} {
  const tokens: MarkdownCitationToken[] = [];
  const markdown = content.replace(
    /\[\[PDF:P(\d{1,5})\|([^\]\r\n]{1,500})\]\]/g,
    (_match, pageValue: string, quoteValue: string) => {
      const pageNumber = Number(pageValue);
      const quote = quoteValue.replace(/\s+/g, ' ').trim();
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || quote.length < 2) return '';
      const index = tokens.push({ pageNumber, quote }) - 1;
      return `PDFHELPERCITATIONTOKEN${index}END`;
    },
  );
  return { markdown, tokens };
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
    const value = textNode.nodeValue ?? '';
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
        const citation = document.createElement('button');
        citation.type = 'button';
        citation.className = 'pdf-source-citation';
        citation.dataset.pdfPage = String(token.pageNumber);
        citation.dataset.pdfQuote = token.quote;
        citation.dataset.citationTooltip = `点击跳转到第 ${token.pageNumber} 页：${token.quote.slice(0, 88)}${token.quote.length > 88 ? '…' : ''}`;
        citation.setAttribute('aria-label', citation.dataset.citationTooltip);
        citation.textContent = `第 ${token.pageNumber} 页 · 查看原文`;
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

function protectMarkdownMath(content: string): {
  markdown: string;
  tokens: MarkdownMathToken[];
} {
  const tokens: MarkdownMathToken[] = [];
  const addToken = (expression: string, displayMode: boolean): string => {
    const index = tokens.push({ expression: expression.trim(), displayMode }) - 1;
    return `PDFHELPERMATHTOKEN${index}END`;
  };

  let markdown = normalizeBareLatexMath(content)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression: string) => addToken(expression, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) => addToken(expression, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) => addToken(expression, false));

  markdown = markdown.replace(
    /(^|[^\\$])\$([^$\n]+?)\$/gm,
    (_match, prefix: string, expression: string) => `${prefix}${addToken(expression, false)}`,
  );
  return { markdown, tokens };
}

function restoreMarkdownMath(container: HTMLElement, tokens: MarkdownMathToken[]): void {
  if (tokens.length === 0) return;

  const tokenPattern = /PDFHELPERMATHTOKEN(\d+)END/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? '';
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
        const math = document.createElement('span');
        math.className = token.displayMode ? 'pdf-helper-math display' : 'pdf-helper-math inline';
        math.setAttribute('aria-label', token.expression);
        math.innerHTML = katex.renderToString(token.expression, {
          displayMode: token.displayMode,
          output: 'htmlAndMathml',
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
): void {
  const citationResult = renderCitations
    ? protectMarkdownCitations(content)
    : {
      markdown: content.replace(/\[\[PDF:P\d{1,5}\|[^\]\r\n]{1,500}\]\]/g, ''),
      tokens: [] as MarkdownCitationToken[],
    };
  const mathResult = protectMarkdownMath(citationResult.markdown);
  const html = marked.parse(mathResult.markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
  container.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['img'],
    USE_PROFILES: { html: true },
  });
  for (const link of container.querySelectorAll<HTMLAnchorElement>('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  restoreMarkdownMath(container, mathResult.tokens);
  restoreMarkdownCitations(container, citationResult.tokens);
}

function updateChatReasoning(
  message: HTMLElement,
  content: string,
  streaming: boolean,
): void {
  let details = message.querySelector<HTMLDetailsElement>('.chat-message-reasoning');
  if (!content.trim()) {
    if (!streaming) details?.remove();
    return;
  }

  if (!details) {
    details = document.createElement('details');
    details.className = 'chat-message-reasoning';
    details.open = true;

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'chat-reasoning-label';
    const state = document.createElement('span');
    state.className = 'chat-reasoning-state';
    summary.append(label, state);

    const body = document.createElement('div');
    body.className = 'chat-reasoning-content';
    details.append(summary, body);
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      details?.classList.toggle('expanded');
      if (details) details.open = true;
      const nextState = details?.querySelector<HTMLElement>('.chat-reasoning-state');
      if (nextState) {
        nextState.textContent = details?.classList.contains('expanded') ? '点击收起' : '点击展开';
      }
    });

    const answerBody = message.querySelector('.chat-message-content');
    if (answerBody) message.insertBefore(details, answerBody);
    else message.append(details);
  }

  const label = details.querySelector<HTMLElement>('.chat-reasoning-label');
  const state = details.querySelector<HTMLElement>('.chat-reasoning-state');
  const body = details.querySelector<HTMLElement>('.chat-reasoning-content');
  if (label) label.textContent = streaming ? '正在思考…' : '思考过程';
  if (state) {
    state.textContent = streaming
      ? '生成中'
      : details.classList.contains('expanded')
        ? '点击收起'
        : '点击展开';
  }
  if (body) renderChatMarkdown(body, content);
}

function updateChatMessage(
  message: HTMLElement,
  content: string,
  options: { pending?: boolean; streaming?: boolean; error?: boolean } = {},
): void {
  message.classList.toggle('pending', Boolean(options.pending));
  message.classList.toggle('streaming', Boolean(options.streaming));
  message.classList.toggle('error', Boolean(options.error));
  const body = message.querySelector<HTMLElement>('.chat-message-content');
  if (!body) return;

  if (message.classList.contains('assistant') && !options.error) {
    renderChatMarkdown(body, content, !options.streaming);
  } else {
    body.textContent = content;
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

function appendChatMessage(
  role: 'user' | 'assistant',
  content: string,
  options: { pending?: boolean; error?: boolean } = {},
): HTMLElement {
  const message = document.createElement('article');
  message.className = `chat-message ${role}`;
  message.classList.toggle('pending', Boolean(options.pending));
  message.classList.toggle('error', Boolean(options.error));

  const roleLabel = document.createElement('div');
  roleLabel.className = 'chat-message-role';
  roleLabel.textContent = role === 'user' ? '你' : 'PDF Helper';

  const body = document.createElement('div');
  body.className = 'chat-message-content';

  message.append(roleLabel, body);
  chatMessagesElement.append(message);
  updateChatMessage(message, content, options);
  return message;
}

function requestAiStream(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage['context'],
  onDelta: (delta: { content?: string; reasoningContent?: string }) => void,
): Promise<{ content: string; reasoningContent: string }> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_STREAM_PORT_NAME });

  return new Promise((resolve, reject) => {
    let settled = false;
    let content = '';
    let reasoningContent = '';
    let debugConversation: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [];

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

      if (message.type === 'started') {
        const debug = message.debug;
        console.groupCollapsed(`[PDF Helper AI] 聊天请求 · ${message.model}`);
        if (debug) {
          debugConversation = debug.messages.map((item) => ({ ...item }));
          console.log('模型配置', {
            provider: debug.providerId,
            model: debug.model,
            baseUrl: debug.baseUrl,
            reasoning: debug.reasoning,
            maxOutputTokens: debug.maxOutputTokens,
          });
          const [systemMessage, ...conversationMessages] = debug.messages;
          if (systemMessage) console.log('System Prompt\n', systemMessage.content);
          conversationMessages.forEach((item, index) => {
            console.log(
              `${item.role === 'user' ? 'User' : 'Assistant'} Prompt #${index + 1}\n`,
              item.content,
            );
          });
          console.log(
            '工具调用',
            debug.tools.length ? debug.tools : '本轮请求未调用工具',
          );
          console.log('完整模型对话（实际发送内容）', debugConversation);
        }
        console.groupEnd();
        return;
      }
      if (message.type === 'delta') {
        content += message.content;
        onDelta({ content: message.content });
        return;
      }
      if (message.type === 'reasoning-delta') {
        reasoningContent += message.content;
        onDelta({ reasoningContent: message.content });
        return;
      }
      if (message.type === 'done') {
        if (debugConversation.length === 0 && message.debug) {
          debugConversation = message.debug.messages.map((item) => ({ ...item }));
        }
        const completedConversation = [
          ...debugConversation,
          { role: 'assistant' as const, content },
        ];
        console.groupCollapsed(`[PDF Helper AI] 聊天响应完成 · ${message.model}`);
        const systemMessage = completedConversation.find((item) => item.role === 'system');
        if (systemMessage) console.log('System Prompt / 角色设定\n', systemMessage.content);
        console.log('发送给模型的全部历史对话', debugConversation);
        console.log('思考过程\n', reasoningContent || '本轮没有返回思考过程');
        console.log('最终回答\n', content);
        console.log('完整模型对话（包含最终回答）', completedConversation);
        console.log(
          '完整模型对话 JSON（可直接复制）\n',
          JSON.stringify(completedConversation, null, 2),
        );
        console.groupEnd();
        finish(() => resolve({ content, reasoningContent }));
        return;
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.error)));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      reject(new Error('AI 流式连接已中断，请重新加载扩展后再试。'));
    });

    const startMessage: AiStreamStartMessage = {
      type: 'start',
      requestId,
      messages,
      context: {
        ...context,
        readingMode: context.readingMode ?? resolvedReadingMode,
      },
    };
    port.postMessage(startMessage);
  });
}

function resetChatConversation(): void {
  chatHistory = [];
  chatMessagesElement.replaceChildren();
  appendChatMessage(
    'assistant',
    '你好，我可以结合当前 PDF 和你选中的文字回答问题。选中一段原文后，可以直接让我翻译、解释或总结。',
  );
}

function updateDeepSeekProviderStatus(): void {
  const modelLabel = deepSeekModelSelect.selectedOptions[0]?.textContent?.trim()
    || aiConfig.model;
  chatProviderStatus.textContent = aiConfig.apiKey
    ? `${modelLabel} · 已配置`
    : 'AI 尚未配置';
  chatProviderStatus.classList.toggle('configured', Boolean(aiConfig.apiKey));
}

function readDeepSeekConfigFromForm(): AiConfig {
  const providerId = aiProviderSelect.value as AiProviderId;
  return {
    providerId,
    apiKey: deepSeekApiKeyInput.value.trim(),
    baseUrl: normalizeAiBaseUrl(deepSeekBaseUrlInput.value, providerId),
    model: deepSeekModelSelect.value,
    reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
  };
}

function updateVisionAiFieldsVisibility(): void {
  const enabled = visionAiModeSelect.value === 'separate';
  visionAiFields.hidden = !enabled;
  testVisionAiButton.disabled = !enabled;
  if (!enabled) {
    visionSettingsStatus.classList.remove('error');
    visionSettingsStatus.textContent = '';
  }
}

function readVisionAiConfigFromForm(): VisionAiConfig {
  return {
    mode: visionAiModeSelect.value as VisionAiMode,
    providerId: 'openai-compatible',
    apiKey: visionApiKeyInput.value.trim(),
    baseUrl: visionBaseUrlInput.value.trim().replace(/\/+$/, ''),
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
  if (config.mode === 'disabled') return true;
  if (isVisionAiConfigured(config)) return true;
  visionSettingsStatus.classList.add('error');
  visionSettingsStatus.textContent = '启用视觉模型后，请填写 API Key、模型和 API 地址。';
  return false;
}

function getInternalNavigationDocumentKey(): string {
  const fingerprint = getPdfFingerprint();
  return fingerprint ? `fingerprint:${fingerprint}` : `source:${sourceName}`;
}

function updateCitationReturnButton() {
  const entry = internalNavigationHistory.at(-1);
  const isAvailable = Boolean(entry && entry.documentKey === getInternalNavigationDocumentKey());

  citationReturnButton.classList.toggle('visible', isAvailable);
  citationReturnButton.setAttribute('aria-hidden', String(!isAvailable));
  citationReturnButton.tabIndex = isAvailable ? 0 : -1;
  citationReturnPosition.textContent = isAvailable && entry ? `第 ${entry.pageNumber} 页` : '';
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
  while (entry && entry.documentKey !== documentKey) entry = internalNavigationHistory.pop();
  updateCitationReturnButton();
  if (!entry) return;

  isReturningFromInternalNavigation = true;
  isRestoringReadingPosition = true;

  const pageNumber = Math.min(pdfDocument.numPages, Math.max(1, Math.round(entry.pageNumber)));
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
        behavior: 'smooth',
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
  deepSeekThinkingSelect.value = config.reasoning;
  deepSeekBaseUrlInput.value = config.baseUrl;
}

async function loadDeepSeekConfig(): Promise<void> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
    VISION_AI_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as Partial<AiConfig> | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as (Partial<AiConfig> & {
    thinking?: AiReasoningMode;
  }) | undefined;
  const value = current || legacy;
  const providerId = value?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...value,
    providerId,
    apiKey: value?.apiKey?.trim() ?? '',
    baseUrl: normalizeAiBaseUrl(value?.baseUrl ?? DEFAULT_AI_CONFIG.baseUrl, providerId),
    reasoning: value?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
  };
  if (!current && legacy) await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig });
  const storedVision = stored[VISION_AI_CONFIG_STORAGE_KEY] as Partial<VisionAiConfig> | undefined;
  visionAiConfig = {
    ...DEFAULT_VISION_AI_CONFIG,
    ...storedVision,
    mode: storedVision?.mode === 'separate' ? 'separate' : 'disabled',
    providerId: 'openai-compatible',
    apiKey: storedVision?.apiKey?.trim() ?? '',
    baseUrl: storedVision?.baseUrl?.trim().replace(/\/+$/, '') ?? '',
    model: storedVision?.model?.trim() ?? '',
  };
  aiConfigLoaded = true;
  populateDeepSeekConfigForm(aiConfig);
  populateVisionAiConfigForm(visionAiConfig);
  updateDeepSeekProviderStatus();
}

async function saveDeepSeekConfig(showSuccess = true): Promise<boolean> {
  const nextConfig = readDeepSeekConfigFromForm();
  const nextVisionConfig = readVisionAiConfigFromForm();

  if (!nextConfig.apiKey) {
    deepSeekSettingsStatus.textContent = '请输入 DeepSeek API Key。';
    deepSeekSettingsStatus.classList.add('error');
    return false;
  }
  if (!validateVisionAiConfig(nextVisionConfig)) return false;

  aiConfig = nextConfig;
  visionAiConfig = nextVisionConfig;
  aiConfigLoaded = true;
  await browser.storage.local.set({
    [AI_CONFIG_STORAGE_KEY]: nextConfig,
    [VISION_AI_CONFIG_STORAGE_KEY]: nextVisionConfig,
  });
  populateDeepSeekConfigForm(nextConfig);
  populateVisionAiConfigForm(nextVisionConfig);
  updateDeepSeekProviderStatus();
  deepSeekSettingsStatus.classList.remove('error');
  deepSeekSettingsStatus.textContent = showSuccess ? '设置已保存到当前浏览器。' : '';
  visionSettingsStatus.classList.remove('error');
  if (showSuccess) {
    visionSettingsStatus.textContent = nextVisionConfig.mode === 'separate'
      ? `视觉模型已保存：${nextVisionConfig.model}`
      : '';
  }
  return true;
}

async function testDeepSeekConnection(): Promise<void> {
  if (!(await saveDeepSeekConfig(false))) return;

  testDeepSeekButton.disabled = true;
  deepSeekSettingsStatus.classList.remove('error');
  deepSeekSettingsStatus.textContent = '正在连接 DeepSeek…';

  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-test',
    }) as AiRuntimeResponse;

    if (!response?.ok) throw new Error(response?.error || '连接测试失败。');
    const modelCount = response.models?.length ?? 0;
    deepSeekSettingsStatus.textContent = modelCount
      ? `连接成功，可用模型 ${modelCount} 个。`
      : '连接成功。';
  } catch (error) {
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    testDeepSeekButton.disabled = false;
  }
}

function createVisionTestImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#1f67e8';
  context.fillRect(8, 8, 16, 16);
  return canvas.toDataURL('image/png');
}

async function testVisionAiConnection(): Promise<void> {
  const nextConfig = readVisionAiConfigFromForm();
  if (!validateVisionAiConfig(nextConfig)) return;
  visionAiConfig = nextConfig;
  await browser.storage.local.set({ [VISION_AI_CONFIG_STORAGE_KEY]: nextConfig });

  testVisionAiButton.disabled = true;
  visionSettingsStatus.classList.remove('error');
  visionSettingsStatus.textContent = '正在测试视觉模型…';
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-vision-test',
      imageDataUrl: createVisionTestImage(),
    }) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || '视觉模型连接测试失败。');
    visionSettingsStatus.textContent = `视觉连接成功：${response.model || nextConfig.model}`;
  } catch (error) {
    visionSettingsStatus.classList.add('error');
    visionSettingsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    testVisionAiButton.disabled = false;
  }
}

function getReadingModeDocumentKey(documentProxy: PDFDocumentProxy | null = pdfDocument): string {
  const fingerprint = getPdfFingerprint(documentProxy);
  if (fingerprint) return `fingerprint:${fingerprint}`;
  const fileName = sourceName ? getDisplayFileName(sourceName) : '';
  return fileName && documentProxy ? `file:${fileName}:${documentProxy.numPages}` : '';
}

function updateReadingModeUi(): void {
  readingModeSelect.value = readingModePreference;
  detectReadingModeButton.disabled = !pdfDocument || readingModeDetectionPending;
  detectReadingModeButton.textContent = readingModeDetectionPending ? '识别中…' : '重新识别';
  const prefix = readingModePreference === 'auto' ? 'AI自动' : '手动';
  readingModeStatus.textContent = readingModeDetectionPending
    ? '正在识别…'
    : readingModeError || `${prefix} · ${getReadingModeLabel(resolvedReadingMode)}`;
  readingModeStatus.title = readingModeError || readingModeRationale || (readingModePreference === 'auto'
    ? '由 AI 根据文件名、目录与正文样本识别，可手动切换'
    : '当前文档使用手动指定的阅读模式');
  readingModeStatus.classList.toggle('error', Boolean(readingModeError));
}

async function readReadingModeStore(): Promise<Record<string, ReadingModeState>> {
  const stored = await browser.storage.local.get(READING_MODE_STORAGE_KEY);
  const value = stored[READING_MODE_STORAGE_KEY];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, ReadingModeState>
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
      collectOutlineTitles(item.items as Array<{ title?: string; items?: unknown[] }>, target);
    }
  }
  return target;
}

async function buildReadingModeSample(documentProxy: PDFDocumentProxy): Promise<{
  sampleText: string;
  outlineTitles: string[];
}> {
  const pages: string[] = [];
  const pageNumbers = Array.from(
    new Set([1, 2, 3, Math.ceil(documentProxy.numPages / 2)].filter(
      (pageNumber) => pageNumber >= 1 && pageNumber <= documentProxy.numPages,
    )),
  );
  for (const pageNumber of pageNumbers) {
    if (pdfDocument !== documentProxy) throw new Error('PDF 已切换，请重新识别。');
    const text = await extractPageText(documentProxy, pageNumber).catch(() => '');
    if (text) pages.push(`[第 ${pageNumber} 页]\n${text.slice(0, 7000)}`);
  }
  const outline = await documentProxy.getOutline().catch(() => null) as
    | Array<{ title?: string; items?: unknown[] }>
    | null;
  return {
    sampleText: pages.join('\n\n').slice(0, 24000),
    outlineTitles: collectOutlineTitles(outline).slice(0, 80),
  };
}

async function detectReadingMode(force = false): Promise<void> {
  const documentAtStart = pdfDocument;
  if (!documentAtStart || readingModeDetectionPending) return;
  if (!aiConfigLoaded) await loadDeepSeekConfig();
  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = '“AI 自动识别阅读模式”需要 API Key；也可以先手动选择阅读模式。';
    readingModeError = '自动识别需配置 API Key';
    updateReadingModeUi();
    return;
  }
  if (!force && readingModePreference !== 'auto') return;

  readingModeDetectionPending = true;
  readingModeError = '';
  updateReadingModeUi();
  try {
    const { sampleText, outlineTitles } = await buildReadingModeSample(documentAtStart);
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-detect-reading-mode',
      documentName: getDisplayFileName(sourceName),
      sampleText,
      outlineTitles,
    }) as AiRuntimeResponse;
    if (pdfDocument !== documentAtStart) return;
    if (!response?.ok || !response.readingMode) {
      throw new Error(response?.error || '没有收到有效的阅读模式识别结果。');
    }
    readingModePreference = 'auto';
    resolvedReadingMode = response.readingMode;
    readingModeRationale = response.rationale || '';
    await persistReadingMode({
      preference: 'auto',
      resolved: response.readingMode,
      source: 'ai',
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

async function loadReadingModeForDocument(documentProxy: PDFDocumentProxy): Promise<void> {
  readingModeDocumentKey = getReadingModeDocumentKey(documentProxy);
  readingModePreference = 'auto';
  resolvedReadingMode = 'general';
  readingModeRationale = '';
  readingModeError = '';
  const modes = await readReadingModeStore();
  if (pdfDocument !== documentProxy) return;
  const saved = modes[readingModeDocumentKey];
  if (saved && isReadingModePreference(saved.preference)) {
    readingModePreference = saved.preference;
    resolvedReadingMode = saved.resolved || 'general';
    readingModeRationale = saved.rationale || '';
    updateReadingModeUi();
    if (saved.preference !== 'auto' || saved.source === 'ai') return;
  }
  updateReadingModeUi();
  await detectReadingMode(false);
}

async function setReadingModePreference(preference: ReadingModePreference): Promise<void> {
  readingModePreference = preference;
  readingModeError = '';
  readingModeRationale = '';
  if (preference === 'auto') {
    updateReadingModeUi();
    await detectReadingMode(true);
    return;
  }
  resolvedReadingMode = preference;
  await persistReadingMode({
    preference,
    resolved: preference,
    source: 'manual',
    updatedAt: Date.now(),
  });
  updateReadingModeUi();
}

async function sendChatMessage(): Promise<void> {
  const content = chatInput.value.trim();
  if (!content || chatRequestPending) return;

  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = '先配置并保存 API Key，之后即可聊天。';
    return;
  }

  chatRequestPending = true;
  chatInput.value = '';
  chatInput.disabled = true;
  chatSendButton.disabled = true;
  chatHistory.push({ role: 'user', content });
  appendChatMessage('user', content);
  const assistantMessage = appendChatMessage('assistant', '', { pending: true });
  let streamedContent = '';
  let streamedReasoningContent = '';
  let renderFrame = 0;

  const flushStreamedContent = (): void => {
    renderFrame = 0;
    updateChatReasoning(assistantMessage, streamedReasoningContent, true);
    updateChatMessage(assistantMessage, streamedContent, { streaming: true });
  };

  try {
    const documentAtRequestStart = pdfDocument;
    const pageNumber = Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1);
    const documentText = documentAtRequestStart
      ? await extractFullDocumentText(documentAtRequestStart)
      : '';
    if (pdfDocument !== documentAtRequestStart) {
      throw new Error('PDF 已切换，请在新文档中重新发送问题。');
    }
    const response = await requestAiStream(
      chatHistory,
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber,
        totalPages: documentAtRequestStart?.numPages,
        documentText: documentText || undefined,
        selectedText: selectedTextForAi || undefined,
        readingMode: documentAtRequestStart ? 'paper' : resolvedReadingMode,
      },
      (delta) => {
        if (delta.content) streamedContent += delta.content;
        if (delta.reasoningContent) streamedReasoningContent += delta.reasoningContent;
        if (!renderFrame) renderFrame = window.requestAnimationFrame(flushStreamedContent);
      },
    );

    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    streamedContent = await validatePdfCitations(response.content, documentAtRequestStart);
    streamedReasoningContent = response.reasoningContent;
    if (!streamedContent.trim()) throw new Error('AI 模型没有返回有效回答。');
    console.log('[PDF Helper AI] 引用校验后的最终回答\n', streamedContent);

    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(assistantMessage, streamedContent, { streaming: false });
    chatHistory.push({ role: 'assistant', content: streamedContent });
    attachChatSaveAction(
      assistantMessage,
      content,
      streamedContent,
      sourceName ? getDisplayFileName(sourceName) : '未关联文档',
      pageNumber,
    );
  } catch (error) {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(
      assistantMessage,
      `请求失败：${error instanceof Error ? error.message : String(error)}`,
      { error: true },
    );
  } finally {
    chatRequestPending = false;
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    chatInput.focus();
  }
}

function setTranslationState(message: string, isError = false): void {
  translationResultElement.textContent = message;
  translationResultElement.classList.toggle('error', isError);
}

function setExplanationState(message: string, isError = false): void {
  explanationResultElement.textContent = message;
  explanationResultElement.classList.toggle('error', isError);
}

function renderExplanationPoints(points: string[]): void {
  const list = document.createElement('ul');

  for (const point of points) {
    const item = document.createElement('li');
    item.textContent = point;
    list.append(item);
  }

  explanationResultElement.replaceChildren(list);
  explanationResultElement.classList.remove('error');
}

function setSummaryState(message: string, isError = false, clearPoints = true): void {
  if (clearPoints) lastSummaryPoints = [];
  summaryResultElement.textContent = message;
  summaryResultElement.classList.toggle('error', isError);
}

function renderSummaryPoints(points: string[]): void {
  const list = document.createElement('ul');

  for (const point of points) {
    const item = document.createElement('li');
    item.textContent = point;
    list.append(item);
  }

  lastSummaryPoints = points;
  summaryResultElement.replaceChildren(list);
  summaryResultElement.classList.remove('error');
}

function getOutlinePageItems(): Array<{ pageNumber: number; title: string }> {
  if (!outlineList) return [];

  return Array.from(outlineList.querySelectorAll<HTMLButtonElement>('button[data-outline-page]'))
    .map((button) => ({
      pageNumber: Number(button.dataset.outlinePage),
      title: button.textContent?.trim() || '未命名章节',
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

  const nextItem = items.find((item) => item.pageNumber > currentItem.pageNumber);
  return {
    title: currentItem.title,
    startPage: currentItem.pageNumber,
    endPage: Math.max(
      currentItem.pageNumber,
      Math.min(pdfDocument?.numPages ?? pageNumber, (nextItem?.pageNumber ?? (pdfDocument?.numPages ?? pageNumber) + 1) - 1),
    ),
  };
}

function getSummaryLabels(scope: SummaryScope): Omit<SummaryContext, 'text'> {
  const pageNumber = pdfDocument ? Math.max(1, pdfViewer.currentPageNumber || 1) : 0;
  const chapter = pageNumber > 0
    ? getCurrentChapterContext(pageNumber)
    : { title: '未定位', startPage: 0, endPage: 0 };

  if (scope === 'chapter') {
    return {
      scope,
      rangeLabel: '当前章节',
      sourceLabel: chapter.startPage === chapter.endPage
        ? `第 ${chapter.startPage} 页`
        : `第 ${chapter.startPage}–${chapter.endPage} 页`,
      positionLabel: chapter.title,
    };
  }

  return {
    scope,
    rangeLabel: scope === 'page' ? '当前页' : '当前选中文本',
    sourceLabel: pageNumber > 0 ? `第 ${pageNumber} 页` : '未打开 PDF',
    positionLabel: chapter.title,
  };
}

function updateSummaryMetadata(context?: Omit<SummaryContext, 'text'>): void {
  const metadata = context ?? getSummaryLabels(activeSummaryScope);
  summaryRangeElement.textContent = metadata.rangeLabel;
  summarySourceElement.textContent = metadata.sourceLabel;
  summaryPositionElement.textContent = metadata.positionLabel;
}

async function extractPageText(documentProxy: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const rawText = textContent.items
    .map((item) => {
      if (!('str' in item) || typeof item.str !== 'string') return '';
      return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
    })
    .join('');

  return normalizeCopiedText(rawText);
}

function normalizeCitationMatchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\u00ad/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, '');
}

async function validatePdfCitations(
  content: string,
  documentProxy: PDFDocumentProxy | null,
): Promise<string> {
  const pattern = /\[\[PDF:P(\d{1,5})\|([^\]\r\n]{1,500})\]\]/g;
  const matches = Array.from(content.matchAll(pattern));
  const removeUnverifiableShorthand = (value: string): string => value.replace(
    /\[?\[PDF:(?:P)?\d{1,5}\]?\]/gi,
    '',
  );
  if (matches.length === 0) return removeUnverifiableShorthand(content);
  if (!documentProxy) return removeUnverifiableShorthand(content.replace(pattern, ''));

  const pageTextCache = new Map<number, string>();
  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    parts.push(content.slice(cursor, start));
    const pageNumber = Number(match[1]);
    const quote = match[2]?.replace(/\s+/g, ' ').trim() ?? '';
    let valid = Number.isInteger(pageNumber)
      && pageNumber >= 1
      && pageNumber <= documentProxy.numPages
      && normalizeCitationMatchText(quote).length >= 8;

    if (valid) {
      if (!pageTextCache.has(pageNumber)) {
        const pageText = await extractPageText(documentProxy, pageNumber).catch(() => '');
        pageTextCache.set(pageNumber, normalizeCitationMatchText(pageText));
      }
      valid = pageTextCache.get(pageNumber)?.includes(normalizeCitationMatchText(quote)) ?? false;
    }

    if (valid) {
      parts.push(match[0]);
    } else {
      console.warn('[PDF Helper 引用校验] 已移除无法匹配原文的引用', {
        pageNumber,
        quote,
      });
    }
    cursor = start + match[0].length;
  }
  parts.push(content.slice(cursor));
  return removeUnverifiableShorthand(parts.join(''));
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

async function waitForCitationTextLayer(pageNumber: number): Promise<HTMLElement | null> {
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

function findCitationRange(textLayer: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const points: CitationTextPoint[] = [];
  let normalizedText = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? '';
    for (let offset = 0; offset < value.length; offset += 1) {
      const normalized = normalizeCitationMatchText(value[offset] ?? '');
      for (const character of normalized) {
        normalizedText += character;
        points.push({ node, offset });
      }
    }
  }

  const normalizedQuote = normalizeCitationMatchText(quote);
  const start = normalizedText.indexOf(normalizedQuote);
  if (start < 0 || normalizedQuote.length === 0) return null;
  const startPoint = points[start];
  const endPoint = points[start + normalizedQuote.length - 1];
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, Math.min(endPoint.offset + 1, endPoint.node.length));
  return range;
}

function highlightCitationRange(textLayer: HTMLElement, range: Range): void {
  const page = textLayer.closest<HTMLElement>('.pdfViewer .page');
  if (!page) return;
  const pageRect = page.getBoundingClientRect();
  const sourceRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  for (const rect of sourceRects) {
    const previous = rects.at(-1);
    const sameLine = previous
      && Math.abs(previous.top - rect.top) <= Math.max(3, rect.height * 0.35)
      && rect.left - previous.right <= 24;
    if (previous && sameLine) {
      previous.right = Math.max(previous.right, rect.right);
      previous.bottom = Math.max(previous.bottom, rect.bottom);
    } else {
      rects.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    }
  }
  if (rects.length === 0) return;

  clearChatCitationHighlight();
  const layer = document.createElement('div');
  layer.className = 'pdf-ai-citation-highlight-layer';
  for (const rect of rects) {
    const highlight = document.createElement('div');
    highlight.className = 'pdf-ai-citation-highlight';
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${rect.right - rect.left}px`;
    highlight.style.height = `${rect.bottom - rect.top}px`;
    layer.append(highlight);
  }
  page.append(layer);
  activeChatCitationHighlight = layer;
  activeChatCitationHighlightTimer = window.setTimeout(clearChatCitationHighlight, 10000);
}

async function jumpToPdfCitation(pageNumber: number, quote: string): Promise<void> {
  if (
    !pdfDocument
    || !Number.isInteger(pageNumber)
    || pageNumber < 1
    || pageNumber > pdfDocument.numPages
    || !quote.trim()
  ) {
    return;
  }

  console.info('[PDF Helper 引用定位] 开始查找原文', {
    pageNumber,
    citedQuote: quote,
  });
  citationReturnButton.classList.remove('visible');
  citationReturnButton.setAttribute('aria-hidden', 'true');
  citationReturnButton.tabIndex = -1;
  citationReturnPosition.textContent = '';
  pdfViewer.currentPageNumber = pageNumber;
  pdfViewer.scrollPageIntoView({ pageNumber });
  const textLayer = await waitForCitationTextLayer(pageNumber);
  if (!textLayer) {
    console.warn('[PDF Helper 引用定位] 文字层未加载，无法核对原文', {
      pageNumber,
      citedQuote: quote,
    });
    return;
  }
  const range = findCitationRange(textLayer, quote);
  if (!range) {
    console.warn('[PDF Helper 引用定位] 页面已打开，但文字层中未找到对应原句', {
      pageNumber,
      citedQuote: quote,
    });
    return;
  }
  const matchedOriginalText = range.toString();
  console.info('[PDF Helper 引用定位] 已匹配到 PDF 原文', {
    pageNumber,
    citedQuote: quote,
    matchedOriginalText,
    normalizedMatch:
      normalizeCitationMatchText(quote) === normalizeCitationMatchText(matchedOriginalText),
  });
  const target = range.startContainer.parentElement;
  target?.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  highlightCitationRange(textLayer, range);
}

const fullDocumentTextCache = new WeakMap<PDFDocumentProxy, Promise<string>>();

function extractFullDocumentText(documentProxy: PDFDocumentProxy): Promise<string> {
  const cached = fullDocumentTextCache.get(documentProxy);
  if (cached) return cached;

  const extraction = (async () => {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const pageText = await extractPageText(documentProxy, pageNumber).catch(() => '');
      pages.push(`[PDF 第 ${pageNumber} 页]\n${pageText || '（本页没有可提取文字）'}`);
    }
    return pages.join('\n\n').trim();
  })();

  fullDocumentTextCache.set(documentProxy, extraction);
  void extraction.catch(() => fullDocumentTextCache.delete(documentProxy));
  return extraction;
}

async function buildSummaryContext(scope: SummaryScope): Promise<SummaryContext> {
  if (!pdfDocument) throw new Error('请先打开 PDF。');

  const documentAtStart = pdfDocument;
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const labels = getSummaryLabels(scope);
  let text = '';

  if (scope === 'selection') {
    text = selectedTextForAi || getViewerSelectionText();
    if (!text) throw new Error('请先在 PDF 中选中需要总结的文字。');
  } else if (scope === 'page') {
    text = await extractPageText(documentAtStart, pageNumber);
  } else {
    const chapter = getCurrentChapterContext(pageNumber);
    const pages: string[] = [];
    let currentLength = 0;

    for (let currentPage = chapter.startPage; currentPage <= chapter.endPage; currentPage += 1) {
      if (pdfDocument !== documentAtStart) throw new Error('PDF 已切换，请重新总结。');
      const pageText = await extractPageText(documentAtStart, currentPage);
      if (!pageText) continue;

      const remainingLength = MAX_SUMMARY_SOURCE_LENGTH - currentLength;
      if (remainingLength <= 0) break;
      pages.push(pageText.slice(0, remainingLength));
      currentLength += pageText.length;
    }

    text = pages.join('\n\n');
  }

  text = text.trim().slice(0, MAX_SUMMARY_SOURCE_LENGTH);
  if (!text) throw new Error('当前范围没有可总结的文字内容。');

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
    if (activeAssistantView === 'summary' && !summaryPanelElement.hidden) void generateSummary();
  }, delay);
}

function setActiveSummaryScope(scope: SummaryScope): void {
  activeSummaryScope = scope;
  lastSummaryRequestKey = '';
  lastSummaryPoints = [];
  currentSummaryContext = null;
  summaryAbortController?.abort();

  for (const button of summaryScopeButtons) {
    button.classList.toggle('active', button.dataset.summaryScope === scope);
  }

  updateSummaryMetadata();
  scheduleSummaryGeneration(0);
}

async function generateSummary(force = false): Promise<void> {
  if (!pdfDocument) {
    setSummaryState('请先打开 PDF。', true);
    return;
  }

  summaryAbortController?.abort();
  const controller = new AbortController();
  summaryAbortController = controller;
  const scopeAtStart = activeSummaryScope;
  updateSummaryMetadata();
  setSummaryState('正在读取总结对象，请稍候…', false, false);

  try {
    const context = await buildSummaryContext(scopeAtStart);
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope) return;

    currentSummaryContext = context;
    updateSummaryMetadata(context);
    const requestKey = [
      context.scope,
      context.sourceLabel,
      context.positionLabel,
      context.text,
    ].join('\u0000');

    if (!force && requestKey === lastSummaryRequestKey && lastSummaryPoints.length > 0) {
      renderSummaryPoints(lastSummaryPoints);
      return;
    }

    setSummaryState('正在生成核心要点，请稍候…');
    const summaryContent = await requestAiContent(
      [{
        role: 'user',
        content: [
          `请总结下面的 PDF 内容。范围：${context.rangeLabel}；来源：${context.sourceLabel}；位置：${context.positionLabel}。`,
          '请输出 4—6 条简体中文核心要点，每行一条，不要添加标题、前言或结尾。',
          '',
          context.text,
        ].join('\n'),
      }],
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: Math.max(1, pdfViewer.currentPageNumber || 1),
      },
    );
    const points = parseAiList(summaryContent).slice(0, 8);

    if (!points.length) throw new Error('模型没有返回总结内容。');
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope) return;

    lastSummaryRequestKey = requestKey;
    renderSummaryPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope) return;

    const message = error instanceof Error ? error.message : String(error);
    setSummaryState(`总结失败：${message}`, true);
  } finally {
    if (summaryAbortController === controller) summaryAbortController = null;
  }
}

function readSavedSummaryNotes(): SavedSummaryNote[] {
  try {
    const value = JSON.parse(localStorage.getItem(SUMMARY_NOTES_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCurrentSummaryAsNote(): void {
  if (!currentSummaryContext || lastSummaryPoints.length === 0) {
    setStatus('当前没有可保存的总结要点。', true);
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
  activeSummaryScope = 'selection';
  currentSummaryContext = null;
  lastSummaryRequestKey = '';
  lastSummaryPoints = [];

  for (const button of summaryScopeButtons) {
    button.classList.toggle('active', button.dataset.summaryScope === 'selection');
  }

  updateSummaryMetadata();
  setSummaryState('选择总结范围后，将自动生成核心要点。');
}

function getCardTypeLabel(cardType: CardType): string {
  return {
    concept: '概念',
    method: '方法',
    experiment: '实验',
    viewpoint: '观点',
  }[cardType];
}

function setCardState(message: string, isError = false, clearCard = true): void {
  if (clearCard) {
    currentGeneratedCard = null;
    cardGeneratedContentElement.hidden = true;
  }
  cardGenerationStatusElement.textContent = message;
  cardGenerationStatusElement.classList.toggle('error', isError);
  cardGenerationStatusElement.hidden = false;
}

function renderGeneratedCard(content: GeneratedCardContent, context: CardContext): void {
  cardTitleElement.textContent = content.title;
  cardExplanationElement.textContent = content.explanation;
  cardPurposeElement.textContent = content.purpose;
  cardUnderstandingElement.textContent = content.understanding;
  cardSourceLocationElement.textContent = context.sourceLocation;

  const points = content.keyPoints.map((point) => {
    const item = document.createElement('li');
    item.textContent = point;
    return item;
  });
  cardKeyPointsElement.replaceChildren(...points);

  currentGeneratedCard = content;
  currentCardContext = context;
  cardGenerationStatusElement.hidden = true;
  cardGenerationStatusElement.classList.remove('error');
  cardGeneratedContentElement.hidden = false;
}

function updateCardSourceSnippet(): void {
  const text = selectedTextForAi || getViewerSelectionText();
  if (!text) {
    cardSourceSnippetElement.textContent = '请在左侧 PDF 中选择需要制作卡片的论文原文。';
    cardSourceSnippetElement.title = '';
    return;
  }

  cardSourceSnippetElement.textContent = text;
  cardSourceSnippetElement.title = text;
}

function buildCardContext(): CardContext {
  if (!pdfDocument) throw new Error('请先打开 PDF。');

  const text = (selectedTextForAi || getViewerSelectionText())
    .trim()
    .slice(0, MAX_CARD_SOURCE_LENGTH);
  if (!text) throw new Error('请先在 PDF 中选中需要制作卡片的原文。');

  const pageNumber = Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1);
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
    if (activeAssistantView === 'cards' && !cardsPanelElement.hidden) void generatePaperCard();
  }, delay);
}

function setActiveCardType(cardType: CardType): void {
  activeCardType = cardType;
  lastCardRequestKey = '';
  currentCardContext = null;
  currentGeneratedCard = null;
  cardAbortController?.abort();

  for (const button of cardTypeButtons) {
    button.classList.toggle('active', button.dataset.cardType === cardType);
  }

  updateCardSourceSnippet();
  scheduleCardGeneration(0);
}

async function generatePaperCard(force = false): Promise<void> {
  updateCardSourceSnippet();

  if (!pdfDocument) {
    setCardState('请先打开 PDF。', true);
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

  const requestKey = [context.cardType, context.pageNumber, context.text].join('\u0000');
  if (
    !force
    && requestKey === lastCardRequestKey
    && currentGeneratedCard
    && currentCardContext
  ) {
    renderGeneratedCard(currentGeneratedCard, currentCardContext);
    return;
  }

  cardAbortController?.abort();
  const controller = new AbortController();
  cardAbortController = controller;
  setCardState('正在读取原文并生成卡片，请稍候…');

  try {
    const cardContent = await requestAiContent(
      [{
        role: 'user',
        content: [
          `请根据下面原文生成“${getCardTypeLabel(context.cardType)}”学习卡片。`,
          `文档：${context.documentName}；页码：${context.pageNumber}；位置：${context.positionLabel}。`,
          '必须只输出 JSON，不要使用 Markdown 代码块。JSON 字段固定为：',
          '{"title":"卡片标题","explanation":"核心解释","key_points":["要点1","要点2","要点3"],"purpose":"作用或解决的问题","understanding":"便于学习者理解的通俗表述"}',
          '',
          context.text,
        ].join('\n'),
      }],
      {
        documentName: context.documentName,
        pageNumber: context.pageNumber,
      },
    );
    const payload = parseAiJson(cardContent);

    if (
      typeof payload.title !== 'string'
      || typeof payload.explanation !== 'string'
      || !Array.isArray(payload.key_points)
      || payload.key_points.some((item) => typeof item !== 'string')
      || typeof payload.purpose !== 'string'
      || typeof payload.understanding !== 'string'
    ) {
      throw new Error('卡片接口没有返回完整的结构化内容。');
    }

    const content: GeneratedCardContent = {
      title: payload.title.trim(),
      explanation: payload.explanation.trim(),
      keyPoints: payload.key_points.map((item) => item.trim()).filter(Boolean),
      purpose: payload.purpose.trim(),
      understanding: payload.understanding.trim(),
    };

    if (
      !content.title
      || !content.explanation
      || content.keyPoints.length === 0
      || !content.purpose
      || !content.understanding
    ) {
      throw new Error('模型返回的卡片内容不完整。');
    }
    if (controller.signal.aborted) return;

    lastCardRequestKey = requestKey;
    renderGeneratedCard(content, context);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setCardState(`卡片生成失败：${message}`, true);
  } finally {
    if (cardAbortController === controller) cardAbortController = null;
  }
}

function formatGeneratedCardText(context: CardContext, content: GeneratedCardContent): string {
  return [
    `卡片类型：${getCardTypeLabel(context.cardType)}`,
    `卡片标题：${content.title}`,
    `核心解释：${content.explanation}`,
    `关键要点：\n${content.keyPoints.map((point) => `• ${point}`).join('\n')}`,
    `作用 / 解决的问题：${content.purpose}`,
    `我的理解：${content.understanding}`,
    `来源位置：${context.documentName} · ${context.sourceLocation}`,
  ].join('\n\n');
}

function readSavedPaperCards(): SavedPaperCard[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_CARDS_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCurrentPaperCard(): void {
  if (!currentCardContext || !currentGeneratedCard) {
    setStatus('当前没有可保存的论文卡片。', true);
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
  activeCardType = 'method';
  lastCardRequestKey = '';
  currentCardContext = null;
  currentGeneratedCard = null;

  for (const button of cardTypeButtons) {
    button.classList.toggle('active', button.dataset.cardType === 'method');
  }

  updateCardSourceSnippet();
  setCardState('选择原文后，将自动生成论文卡片。');
}

function setPaperCardPageStatus(message = '', isError = false): void {
  paperCardPageStatusElement.textContent = message;
  paperCardPageStatusElement.classList.toggle('error', isError);
  paperCardPageStatusElement.hidden = !message;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    select.value = '';
    return;
  }

  const hasOption = Array.from(select.options).some((option) => option.value === normalizedValue);
  if (!hasOption) {
    const option = document.createElement('option');
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    select.append(option);
  }
  select.value = normalizedValue;
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

function autoResizePaperCardTextarea(textarea: HTMLTextAreaElement): void {
  // Reset first so the field can shrink when content becomes shorter.
  textarea.style.height = `${PAPER_CARD_TEXTAREA_MIN_HEIGHT}px`;
  textarea.style.height = '0px';

  const computedStyle = window.getComputedStyle(textarea);
  const borderHeight = (
    Number.parseFloat(computedStyle.borderTopWidth || '0')
    + Number.parseFloat(computedStyle.borderBottomWidth || '0')
  );
  const contentHeight = Math.ceil(textarea.scrollHeight + borderHeight);

  textarea.style.height = `${Math.max(PAPER_CARD_TEXTAREA_MIN_HEIGHT, contentHeight)}px`;
}

function refreshPaperCardTextareaHeights(): void {
  const textareas = paperCardFormElement.querySelectorAll<HTMLTextAreaElement>('textarea');
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
  const textareas = paperCardFormElement.querySelectorAll<HTMLTextAreaElement>('textarea');
  for (const textarea of textareas) {
    textarea.addEventListener('input', () => autoResizePaperCardTextarea(textarea));
  }
  window.addEventListener('resize', schedulePaperCardTextareaRefresh);
  schedulePaperCardTextareaRefresh();
}

function renderPaperCardForm(data: Omit<PaperCardFormData, 'personalNotes'>): void {

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
  schedulePaperCardTextareaRefresh();
}

function updatePaperCardDocumentName(): void {
  const currentName = sourceName ? getDisplayFileName(sourceName) : '';
  const name = paperCardReviewDocumentName || currentName || '尚未打开 PDF';
  paperCardDocumentNameElement.textContent = name;
  paperCardDocumentNameElement.title = paperCardReviewDocumentName || sourceName || name;
}

function setPaperCardPageMode(mode: 'generate' | 'review'): void {
  const isReview = mode === 'review';
  paperCardPageElement.classList.toggle('review-mode', isReview);
  paperCardPageTitleElement.textContent = isReview ? '复习论文卡片' : '生成论文卡片页面';
  paperCardPageSubtitleElement.textContent = isReview
    ? '从知识库打开已保存的论文卡片，可完整复习、修改并再次保存'
    : '面向研究生论文阅读：先判断值不值得读，再理解方法、证据与和自己课题的关系';
  regeneratePaperCardButton.hidden = isReview;
  savePaperCardPageButton.textContent = isReview ? '▣ 保存修改' : '▣ 保存卡片';
  paperCardBackButton.setAttribute(
    'aria-label',
    isReview && paperCardReturnTarget === 'knowledge' ? '返回知识库' : '返回 PDF',
  );
}

function clearPaperCardReviewState(): void {
  editingPaperOverviewId = null;
  paperCardReviewDocumentName = '';
  paperCardReturnTarget = 'pdf';
  setPaperCardPageMode('generate');
}

function resetPaperCardPageState(): void {
  paperCardPageAbortController?.abort();
  paperCardPageAbortController = null;
  paperCardPageDocumentKey = '';
  paperCardPageSourceCache = null;
  paperCardFormElement.reset();
  paperCardFormElement.classList.remove('generating');
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
  for (let page = 1; page <= Math.min(6, totalPages); page += 1) pageNumbers.add(page);
  for (let page = Math.max(1, totalPages - 4); page <= totalPages; page += 1) pageNumbers.add(page);

  const middleStart = 7;
  const middleEnd = Math.max(middleStart, totalPages - 5);
  const middleSamples = 7;
  for (let index = 0; index < middleSamples; index += 1) {
    const ratio = index / (middleSamples - 1);
    pageNumbers.add(Math.round(middleStart + (middleEnd - middleStart) * ratio));
  }

  return Array.from(pageNumbers)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((left, right) => left - right);
}

async function extractPaperOverviewText(documentProxy: PDFDocumentProxy): Promise<string> {
  if (paperCardPageSourceCache?.document === documentProxy) {
    return paperCardPageSourceCache.text;
  }

  const pageNumbers = getPaperOverviewPageNumbers(documentProxy.numPages);
  const chunks: string[] = [];
  let currentLength = 0;

  for (const pageNumber of pageNumbers) {
    if (pdfDocument !== documentProxy) throw new Error('PDF 已切换，请重新生成论文卡片。');
    const pageText = await extractPageText(documentProxy, pageNumber);
    if (!pageText) continue;

    const pageHeader = `\n\n[第 ${pageNumber} 页]\n`;
    const remainingLength = MAX_PAPER_CARD_SOURCE_LENGTH - currentLength - pageHeader.length;
    if (remainingLength <= 0) break;

    const clippedText = pageText.slice(0, remainingLength);
    chunks.push(`${pageHeader}${clippedText}`);
    currentLength += pageHeader.length + clippedText.length;
  }

  const text = chunks.join('').trim();
  if (!text) throw new Error('当前 PDF 没有可读取的文字内容。');
  paperCardPageSourceCache = { document: documentProxy, text };
  return text;
}

function normalizePaperOverviewField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '原文未明确出现';
}

async function generatePaperOverviewCard(force = false): Promise<void> {
  updatePaperCardDocumentName();
  if (!pdfDocument) {
    setPaperCardPageStatus('请先打开 PDF，再生成论文卡片。', true);
    return;
  }

  const documentAtStart = pdfDocument;
  const documentKey = `${sourceName}\u0000${documentAtStart.numPages}`;
  if (!force && paperCardPageDocumentKey === documentKey && paperTitleInput.value.trim()) {
    return;
  }

  paperCardPageAbortController?.abort();
  const controller = new AbortController();
  paperCardPageAbortController = controller;
  regeneratePaperCardButton.disabled = true;
  paperCardFormElement.classList.add('generating');
  setPaperCardPageStatus('正在读取论文并直接调用 AI API 生成结构化卡片，请稍候…');

  try {
    if (!aiConfigLoaded) await loadDeepSeekConfig();
    if (!aiConfig.apiKey) {
      setDeepSeekSettingsOpen(true);
      deepSeekSettingsStatus.classList.add('error');
      deepSeekSettingsStatus.textContent = '生成论文卡片需要先配置并保存 API Key。';
      throw new Error('请先在右上角“设置”中配置 API Key。');
    }

    const text = await extractPaperOverviewText(documentAtStart);
    if (controller.signal.aborted) return;

    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-generate-paper-overview',
      documentName: getDisplayFileName(sourceName),
      pageCount: documentAtStart.numPages,
      text,
    }) as AiRuntimeResponse;

    if (!response?.ok || !response.content?.trim()) {
      throw new Error(response?.error || 'AI 模型没有返回有效的论文卡片内容。');
    }

    const payload = parseAiJson(response.content) as PaperOverviewApiResponse;
    if (pdfDocument !== documentAtStart || controller.signal.aborted) return;

    renderPaperCardForm({
      title: normalizePaperOverviewField(payload.title),
      authors: normalizePaperOverviewField(payload.authors),
      venueYear: normalizePaperOverviewField(payload.venue_year),
      researchArea: normalizePaperOverviewField(payload.research_area),
      keywords: normalizePaperOverviewField(payload.keywords),
      oneSentenceSummary: normalizePaperOverviewField(payload.one_sentence_summary),
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
      strongestEvidence: normalizePaperOverviewField(payload.strongest_evidence),
      comparisonWithPriorWork: normalizePaperOverviewField(payload.comparison_with_prior_work),
      limitations: normalizePaperOverviewField(payload.limitations),
      readingStatus: normalizePaperOverviewField(payload.reading_status),
      recommendDeepReading: normalizePaperOverviewField(payload.recommend_deep_reading),
      readingDifficulty: normalizePaperOverviewField(payload.reading_difficulty),
      readingValueScore: normalizePaperOverviewField(payload.reading_value_score),
      readingAdvice: normalizePaperOverviewField(payload.reading_advice),
      suitableStages: normalizePaperOverviewField(payload.suitable_stages),
      prerequisites: normalizePaperOverviewField(payload.prerequisites),
      citationPoints: normalizePaperOverviewField(payload.citation_points),
      researchConnection: normalizePaperOverviewField(payload.research_connection),
      followupQuestions: normalizePaperOverviewField(payload.followup_questions),
      weeklyPlan: normalizePaperOverviewField(payload.weekly_plan),
    });

    paperCardPageDocumentKey = documentKey;
    const successMessage = '论文卡片已生成，可继续手动修改。';
    setPaperCardPageStatus(successMessage);
    window.setTimeout(() => {
      if (paperCardPageStatusElement.textContent === successMessage) setPaperCardPageStatus();
    }, 1800);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setPaperCardPageStatus(`论文卡片生成失败：${message}`, true);
  } finally {
    if (paperCardPageAbortController === controller) paperCardPageAbortController = null;
    regeneratePaperCardButton.disabled = false;
    paperCardFormElement.classList.remove('generating');
  }
}

function openPaperCardPage(): void {
  clearPaperCardReviewState();
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove('knowledge-base-page-open');
  knowledgeBaseEntryButton.classList.remove('active');
  paperCardPageElement.hidden = false;
  appFrame?.classList.add('paper-card-page-open');
  paperCardEntryButton?.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');
  updatePaperCardDocumentName();
  paperCardPageElement.scrollTop = 0;
  schedulePaperCardTextareaRefresh();
  void generatePaperOverviewCard();
}

function openSavedPaperOverviewReview(item: KnowledgeItem): void {
  if (item.source !== 'paper-overview') {
    openKnowledgeEditor(item);
    return;
  }

  const card = readSavedPaperOverviews().find((candidate) => candidate.id === item.id);
  if (!card) {
    setKnowledgePageStatus('这张论文卡片已经不存在，请刷新知识库后重试。', true);
    renderKnowledgeBase();
    return;
  }

  paperCardPageAbortController?.abort();
  paperCardPageAbortController = null;
  editingPaperOverviewId = card.id;
  paperCardReviewDocumentName = card.documentName || item.documentName;
  paperCardReturnTarget = 'knowledge';
  paperCardPageDocumentKey = `saved:${card.id}`;
  paperCardPageSourceCache = null;

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove('knowledge-base-page-open');
  knowledgeBaseEntryButton.classList.add('active');
  paperCardPageElement.hidden = false;
  appFrame?.classList.add('paper-card-page-open');
  paperCardEntryButton?.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');

  setPaperCardPageMode('review');
  updatePaperCardDocumentName();
  renderPaperCardForm(card);
  paperPersonalNotesInput.value = card.personalNotes || '';
  setPaperCardPageStatus();
  paperCardPageElement.scrollTop = 0;
  schedulePaperCardTextareaRefresh();
  persistCurrentAppViewState();
}

function closePaperCardPage(destination: 'pdf' | 'knowledge' = 'pdf'): void {
  paperCardPageAbortController?.abort();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove('paper-card-page-open');
  paperCardEntryButton?.classList.remove('active');

  const returnToKnowledge = destination === 'knowledge';
  clearPaperCardReviewState();

  if (returnToKnowledge) {
    knowledgeBasePageElement.hidden = false;
    appFrame?.classList.add('knowledge-base-page-open');
    knowledgeBaseEntryButton.classList.add('active');
    aiPanelToggleButton?.classList.remove('active');
    renderKnowledgeBase();
    return;
  }

  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove('knowledge-base-page-open');
  knowledgeBaseEntryButton.classList.remove('active');
  aiPanelToggleButton?.classList.add('active');
  persistCurrentAppViewState();
}

function readSavedPaperOverviews(): SavedPaperOverview[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_PAPER_OVERVIEWS_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePaperOverviewCard(): void {
  const data = collectPaperCardFormData();
  if (!data.title && !data.oneSentenceSummary) {
    setPaperCardPageStatus('当前没有可保存的论文卡片内容。', true);
    return;
  }

  const now = new Date().toISOString();
  const cards = readSavedPaperOverviews();

  if (editingPaperOverviewId) {
    const existing = cards.find((card) => card.id === editingPaperOverviewId);
    if (!existing) {
      setPaperCardPageStatus('原论文卡片已经不存在，无法保存修改。', true);
      return;
    }

    const updatedCards = cards.map((card) => card.id === editingPaperOverviewId
      ? {
          ...card,
          ...data,
          documentName: paperCardReviewDocumentName || card.documentName,
          updatedAt: now,
        }
      : card);
    localStorage.setItem(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, JSON.stringify(updatedCards));
    selectedKnowledgeRecordKey = getKnowledgeRecordKey('paper-overview', editingPaperOverviewId);
    setPaperCardPageStatus(`已保存“${data.title || existing.documentName}”的复习修改。`);
    return;
  }

  const card: SavedPaperOverview = {
    id: crypto.randomUUID(),
    documentName: sourceName ? getDisplayFileName(sourceName) : '未命名论文',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem(
    SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
    JSON.stringify([card, ...cards].slice(0, 100)),
  );
  refreshKnowledgeBaseIfOpen();
  setPaperCardPageStatus(`已保存“${data.title || card.documentName}”论文卡片。`);
}

function formatPaperOverviewMarkdown(data: PaperCardFormData): string {
  return [
    `# ${data.title || '论文卡片'}`,
    '',
    `- 作者：${data.authors || '原文未明确出现'}`,
    `- 年份 / 会议 / 期刊：${data.venueYear || '原文未明确出现'}`,
    `- 研究领域：${data.researchArea || '原文未明确出现'}`,
    `- 关键词：${data.keywords || '原文未明确出现'}`,
    '',
    '## 一、速读判断',
    '',
    `**研究问题：** ${data.researchProblem}`,
    '',
    `**一句话总结：** ${data.oneSentenceSummary}`,
    '',
    `**核心贡献：** ${data.coreInnovation}`,
    '',
    `**为什么值得读：** ${data.worthReading}`,
    '',
    '## 二、论文定位',
    '',
    `**问题设定：** ${data.problemSetup}`,
    '',
    `**研究空白 / 未解决的问题：** ${data.researchGap}`,
    '',
    `**为什么重要：** ${data.whyImportant}`,
    '',
    `**相关主题标签：** ${data.topicTags}`,
    '',
    '## 三、方法理解',
    '',
    `**方法概述：** ${data.methodOverview}`,
    '',
    `**方法直觉：** ${data.methodIntuition}`,
    '',
    `**方法流程：** ${data.methodSteps}`,
    '',
    `**关键假设：** ${data.keyAssumptions}`,
    '',
    `**符号 / 术语速览：** ${data.notationGuide}`,
    '',
    '## 四、实验与证据',
    '',
    `**数据集：** ${data.datasets}`,
    '',
    `**实验设置：** ${data.experimentSetup}`,
    '',
    `**评估指标：** ${data.metrics}`,
    '',
    `**主要实验结论：** ${data.mainFindings}`,
    '',
    `**最强证据：** ${data.strongestEvidence}`,
    '',
    `**与已有工作对比：** ${data.comparisonWithPriorWork}`,
    '',
    `**局限性：** ${data.limitations}`,
    '',
    '## 五、阅读决策',
    '',
    `- 阅读状态：${data.readingStatus}`,
    `- 是否建议精读：${data.recommendDeepReading}`,
    `- 阅读难度：${data.readingDifficulty}`,
    `- 阅读价值评分：${data.readingValueScore}`,
    '',
    `**阅读建议：** ${data.readingAdvice}`,
    '',
    `**适合什么阶段阅读：** ${data.suitableStages}`,
    '',
    `**先修知识：** ${data.prerequisites}`,
    '',
    '## 六、和我的研究的关系',
    '',
    `**适合引用的点：** ${data.citationPoints}`,
    '',
    `**与我的课题关联：** ${data.researchConnection}`,
    '',
    `**后续追问 / 复现计划：** ${data.followupQuestions}`,
    '',
    `**本周阅读计划：** ${data.weeklyPlan}`,
    '',
    `**我的备注：** ${data.personalNotes}`,
  ].join('\n');
}

function exportPaperOverviewCard(): void {
  const data = collectPaperCardFormData();
  if (!data.title && !data.oneSentenceSummary) {
    setPaperCardPageStatus('当前没有可导出的论文卡片内容。', true);
    return;
  }

  const blob = new Blob([formatPaperOverviewMarkdown(data)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const baseName = (data.title || getDisplayFileName(sourceName) || '论文卡片')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 80);
  anchor.href = url;
  anchor.download = `${baseName}-论文卡片.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  setPaperCardPageStatus('论文卡片已导出为 Markdown 文件。');
}



function readSavedKnowledgeNotes(): SavedKnowledgeNote[] {
  try {
    const value = JSON.parse(localStorage.getItem(KNOWLEDGE_NOTES_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeSavedKnowledgeNotes(notes: SavedKnowledgeNote[]): void {
  localStorage.setItem(KNOWLEDGE_NOTES_STORAGE_KEY, JSON.stringify(notes.slice(0, 500)));
}

function readKnowledgeItemMetaStore(): KnowledgeItemMetaStore {
  try {
    const value = JSON.parse(localStorage.getItem(KNOWLEDGE_ITEM_META_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as KnowledgeItemMetaStore
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
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, 12);
}

function getKnowledgeRecordKey(source: KnowledgeSource, id: string): string {
  return `${source}:${id}`;
}

function parseKnowledgePageNumber(value: string): number | undefined {
  const match = value.match(/第\s*(\d+)\s*页/);
  const pageNumber = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
}

function applyKnowledgeMeta(item: KnowledgeItem, store: KnowledgeItemMetaStore): KnowledgeItem {
  const meta = store[item.recordKey];
  if (!meta) return item;
  return {
    ...item,
    title: meta.title?.trim() || item.title,
    content: meta.content?.trim() || item.content,
    category: meta.category?.trim() || item.category,
    tags: normalizeKnowledgeTags(meta.tags).length ? normalizeKnowledgeTags(meta.tags) : item.tags,
    updatedAt: meta.updatedAt || item.updatedAt,
  };
}

function collectKnowledgeItems(): KnowledgeItem[] {
  const metaStore = readKnowledgeItemMetaStore();
  const items: KnowledgeItem[] = [];

  for (const note of readSavedKnowledgeNotes()) {
    if (!note || typeof note.id !== 'string') continue;
    const createdAt = typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString();
    const updatedAt = typeof note.updatedAt === 'string' ? note.updatedAt : createdAt;
    items.push(applyKnowledgeMeta({
      recordKey: getKnowledgeRecordKey('knowledge-note', note.id),
      id: note.id,
      source: 'knowledge-note',
      kind: 'note',
      title: typeof note.title === 'string' && note.title.trim() ? note.title.trim() : '未命名笔记',
      content: typeof note.content === 'string' ? note.content.trim() : '',
      documentName: typeof note.documentName === 'string' && note.documentName.trim()
        ? note.documentName.trim()
        : '未关联文档',
      pageNumber: Number.isFinite(note.pageNumber) ? note.pageNumber : undefined,
      positionLabel: typeof note.positionLabel === 'string' && note.positionLabel.trim()
        ? note.positionLabel.trim()
        : (Number.isFinite(note.pageNumber) ? `第 ${note.pageNumber} 页` : '未定位'),
      category: typeof note.category === 'string' && note.category.trim() ? note.category.trim() : 'AI 笔记',
      tags: normalizeKnowledgeTags(note.tags),
      createdAt,
      updatedAt,
    }, metaStore));
  }

  for (const note of readSavedSummaryNotes()) {
    if (!note || typeof note.id !== 'string') continue;
    const points = Array.isArray(note.points)
      ? note.points.filter((point): point is string => typeof point === 'string' && Boolean(point.trim()))
      : [];
    const createdAt = typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString();
    const rangeLabel = typeof note.rangeLabel === 'string' && note.rangeLabel.trim()
      ? note.rangeLabel.trim()
      : '内容';
    const sourceLabel = typeof note.sourceLabel === 'string' ? note.sourceLabel : '';
    const positionLabel = typeof note.positionLabel === 'string' && note.positionLabel.trim()
      ? note.positionLabel.trim()
      : sourceLabel || '未定位';
    items.push(applyKnowledgeMeta({
      recordKey: getKnowledgeRecordKey('summary-note', note.id),
      id: note.id,
      source: 'summary-note',
      kind: 'note',
      title: `${rangeLabel}总结`,
      content: points.map((point) => `• ${point.trim()}`).join('\n'),
      documentName: typeof note.documentName === 'string' && note.documentName.trim()
        ? note.documentName.trim()
        : '未关联文档',
      pageNumber: parseKnowledgePageNumber(sourceLabel),
      positionLabel,
      category: 'AI 总结',
      tags: Array.from(new Set(['总结', rangeLabel])).filter(Boolean),
      createdAt,
      updatedAt: createdAt,
    }, metaStore));
  }

  for (const card of readSavedPaperCards()) {
    if (!card || typeof card.id !== 'string') continue;
    const createdAt = typeof card.createdAt === 'string' ? card.createdAt : new Date().toISOString();
    items.push(applyKnowledgeMeta({
      recordKey: getKnowledgeRecordKey('reading-card', card.id),
      id: card.id,
      source: 'reading-card',
      kind: 'reading-card',
      title: typeof card.title === 'string' && card.title.trim() ? card.title.trim() : '未命名阅读卡片',
      content: formatGeneratedCardText(card, card),
      documentName: typeof card.documentName === 'string' && card.documentName.trim()
        ? card.documentName.trim()
        : '未关联文档',
      pageNumber: Number.isFinite(card.pageNumber) ? card.pageNumber : undefined,
      positionLabel: typeof card.sourceLocation === 'string' && card.sourceLocation.trim()
        ? card.sourceLocation.trim()
        : (typeof card.positionLabel === 'string' ? card.positionLabel : '未定位'),
      category: '阅读卡片',
      tags: ['AI 卡片', getCardTypeLabel(card.cardType)],
      createdAt,
      updatedAt: createdAt,
    }, metaStore));
  }

  for (const card of readSavedPaperOverviews()) {
    if (!card || typeof card.id !== 'string') continue;
    const createdAt = typeof card.createdAt === 'string' ? card.createdAt : new Date().toISOString();
    const updatedAt = typeof card.updatedAt === 'string' ? card.updatedAt : createdAt;
    const tags = normalizeKnowledgeTags([
      card.researchArea,
      card.readingStatus,
      card.recommendDeepReading,
      card.keywords,
      card.topicTags,
    ]);
    items.push(applyKnowledgeMeta({
      recordKey: getKnowledgeRecordKey('paper-overview', card.id),
      id: card.id,
      source: 'paper-overview',
      kind: 'paper-card',
      title: card.title?.trim() || card.documentName || '未命名论文卡片',
      content: formatPaperOverviewMarkdown(card),
      documentName: card.documentName || '未关联文档',
      positionLabel: '整篇论文',
      category: card.researchArea?.trim() || '论文卡片',
      tags: tags.length ? tags : ['论文卡片'],
      createdAt,
      updatedAt,
    }, metaStore));
  }

  return items;
}

function getKnowledgeKindLabel(kind: KnowledgeKind): string {
  return {
    note: '笔记',
    'reading-card': '阅读卡片',
    'paper-card': '论文卡片',
  }[kind];
}

function getKnowledgeKindIcon(kind: KnowledgeKind): string {
  return {
    note: '▧',
    'reading-card': '◇',
    'paper-card': '▱',
  }[kind];
}

function formatKnowledgeDate(value: string, includeTime = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    year: includeTime ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    hour: includeTime ? '2-digit' : undefined,
    minute: includeTime ? '2-digit' : undefined,
  }).format(date);
}

function formatKnowledgeRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function getKnowledgeExcerpt(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[•*-]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function setKnowledgePageStatus(message = '', isError = false): void {
  knowledgePageStatusElement.textContent = message;
  knowledgePageStatusElement.classList.toggle('error', isError);
  knowledgePageStatusElement.hidden = !message;
}

function setKnowledgeFilter(filter: KnowledgeFilter): void {
  activeKnowledgeFilter = filter;
  if (activeKnowledgePageMode !== 'library') setKnowledgePageMode('library');
  for (const button of knowledgeFilterButtons) {
    button.classList.toggle('active', button.dataset.knowledgeFilter === filter);
  }
  const labels: Record<KnowledgeFilter, string> = {
    all: '全部内容',
    note: '保存的笔记',
    'reading-card': '阅读卡片',
    'paper-card': '论文卡片',
  };
  knowledgePageTitleElement.textContent = labels[filter];
  renderKnowledgeBase();
}


function getKnowledgeBaseDocumentName(label: string): string {
  return label.replace(/\.pdf$/i, '').trim();
}

function extractKnowledgeYear(item: KnowledgeItem): string {
  const match = [item.title, item.documentName, item.content].join(' ').match(/20\d{2}/);
  return match ? match[0] : '未标注';
}

function extractKnowledgeVenue(item: KnowledgeItem): string {
  const text = [item.title, item.documentName, item.content].join(' ');
  const venuePatterns = ['USENIX', 'CCS', 'NDSS', 'S&P', 'EUROCRYPT', 'CRYPTO', 'IEEE', 'ACM', 'AAAI', 'NeurIPS', 'ICML', 'ICLR', 'TDSC'];
  for (const venue of venuePatterns) {
    if (text.toUpperCase().includes(venue.toUpperCase())) return venue;
  }
  return item.category || '未分类';
}

function deriveKnowledgeReadingStatus(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  if (/精读中|建议精读|精读/.test(joined)) return '精读中';
  if (/已读完|略读完成|读完|已完成/.test(joined)) return '已读完';
  if (/略读/.test(joined)) return '略读完成';
  if (/待读|待读/.test(joined)) return '待读';
  if (item.kind === 'paper-card') return '精读中';
  if (item.kind === 'reading-card') return '略读完成';
  return '待读';
}

function deriveKnowledgePriority(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  if (/高优先级|建议精读|核心|必读/.test(joined)) return '高优先级';
  if (/中优先级|推荐/.test(joined)) return '中优先级';
  return '常规';
}

function isKnowledgeCitable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  return /可引用|适合引用|引用价值|引用点|研究贡献/.test(joined) || item.kind === 'paper-card';
}

function isKnowledgeReplicable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  return /复现|实验|代码|benchmark|性能评估/i.test(joined);
}

function isKnowledgeRelatedWork(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  return /相关工作|综述|survey|背景/.test(joined);
}

function isKnowledgeMethodInspiration(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(' ');
  return /方法|思路|灵感|idea|启发|框架|设计/.test(joined) || item.kind === 'reading-card';
}

function matchesKnowledgeFocus(item: KnowledgeItem, focus: KnowledgeFocus): boolean {
  if (focus === 'all') return true;
  const status = deriveKnowledgeReadingStatus(item);
  if (focus === 'todo') return status === '待读';
  if (focus === 'deep') return status === '精读中';
  if (focus === 'finished') return status === '已读完' || status === '略读完成';
  if (focus === 'citable') return isKnowledgeCitable(item);
  if (focus === 'replicate') return isKnowledgeReplicable(item);
  if (focus === 'related') return isKnowledgeRelatedWork(item);
  if (focus === 'methods') return isKnowledgeMethodInspiration(item);
  return true;
}

function getKnowledgeCitationScore(item: KnowledgeItem): number {
  const base = item.kind === 'paper-card' ? 4.2 : item.kind === 'reading-card' ? 3.9 : 3.6;
  const bonus = Math.min(0.7, item.tags.length * 0.08 + (isKnowledgeCitable(item) ? 0.25 : 0));
  return Math.min(5, Math.round((base + bonus) * 10) / 10);
}

function getKnowledgeRelevancePercent(item: KnowledgeItem): number {
  const base = item.kind === 'paper-card' ? 78 : item.kind === 'reading-card' ? 72 : 65;
  const bonus = Math.min(20, item.tags.length * 3 + Math.min(12, Math.floor(item.content.length / 120)));
  return Math.min(98, base + bonus);
}

function getKnowledgeExcerptForDashboard(item: KnowledgeItem): string {
  const excerpt = getKnowledgeExcerpt(item.content).replace(/\s+/g, ' ').trim();
  return excerpt || '暂无摘要内容';
}

function createRatingStars(value: number): string {
  const full = Math.round(value);
  return '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(Math.max(0, 5 - full));
}

function updateKnowledgeItemTags(item: KnowledgeItem, updater: (tags: string[]) => string[]): void {
  const now = new Date().toISOString();
  const nextTags = normalizeKnowledgeTags(updater([...item.tags]));
  if (item.source === 'knowledge-note') {
    const notes = readSavedKnowledgeNotes().map((note) => note.id === item.id
      ? { ...note, tags: nextTags, updatedAt: now }
      : note);
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
  updateKnowledgeItemTags(item, (tags) => exists ? tags.filter((candidate) => candidate !== tag) : [...tags, tag]);
  setKnowledgePageStatus(exists ? `已取消“${tag}”。` : `已标记为“${tag}”。`);
  renderKnowledgeBase();
}

function renderKnowledgeMetricCards(items: KnowledgeItem[], filtered: KnowledgeItem[]): void {
  if (!knowledgeDashboardMetricsElement) return;
  const now = Date.now();
  const withinWeek = filtered.filter((item) => now - new Date(item.updatedAt).getTime() <= 7 * 24 * 60 * 60 * 1000);
  const metrics = [
    { icon: '📘', title: '本周精读', value: String(withinWeek.filter((item) => deriveKnowledgeReadingStatus(item) === '精读中').length), unit: '篇', hint: `本周更新 ${withinWeek.length}` },
    { icon: '❝', title: '可引用论文', value: String(filtered.filter(isKnowledgeCitable).length), unit: '篇', hint: '适合写相关工作/论文引用' },
    { icon: '⚗', title: '待复现实验', value: String(filtered.filter(isKnowledgeReplicable).length), unit: '篇', hint: '建议整理代码与实验清单' },
    { icon: '💡', title: '研究灵感', value: String(filtered.filter(isKnowledgeMethodInspiration).length), unit: '条', hint: '方法、设计与启发' },
    { icon: '🗂', title: '知识库总量', value: String(items.length), unit: '条', hint: `覆盖 ${new Set(items.map((item) => item.documentName)).size} 篇文档` },
  ];
  const cards = metrics.map((metric) => {
    const article = document.createElement('article');
    article.className = 'knowledge-metric-card';
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
      { title: '必读清单', desc: '把高价值、与研究方向高度相关的论文先排出来。', count: filtered.filter((item) => deriveKnowledgePriority(item) === '高优先级').length, label: '待完成' },
      { title: '可引用观点', desc: '优先收集可直接写进相关工作和论文背景的观点。', count: filtered.filter(isKnowledgeCitable).length, label: '可引用' },
      { title: '方法对比', desc: '比较方法假设、性能、适用场景与局限。', count: Math.max(1, Math.min(filtered.length, new Set(filtered.map((item) => item.category)).size)), label: '待对比' },
      { title: '复现实验计划', desc: '把需要复现的论文转成实验任务清单。', count: filtered.filter(isKnowledgeReplicable).length, label: '进行中' },
    ];
    const workbench = cards.map((card) => {
      const article = document.createElement('article');
      article.className = 'knowledge-workbench-card';
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
      { title: '精读 3 篇论文并完成笔记', current: Math.min(3, filtered.filter((item) => deriveKnowledgeReadingStatus(item) === '精读中').length), total: 3 },
      { title: '整理可引用观点', current: Math.min(10, filtered.filter(isKnowledgeCitable).length), total: 10 },
      { title: '复现实验：补齐实验计划', current: Math.min(2, filtered.filter(isKnowledgeReplicable).length), total: 2 },
      { title: '更新相关工作综述', current: Math.min(1, filtered.filter(isKnowledgeRelatedWork).length), total: 1 },
    ];
    const nodes = tasks.map((task) => {
      const row = document.createElement('div');
      row.className = 'knowledge-task-row';
      const percent = task.total ? Math.max(0, Math.min(100, Math.round(task.current / task.total * 100))) : 0;
      row.innerHTML = `
        <div class="knowledge-task-copy">
          <label><input type="checkbox" ${task.current >= task.total ? 'checked' : ''} /> <span>${task.title}</span></label>
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
  if (knowledgeFocusCountTodoElement) knowledgeFocusCountTodoElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'todo')).length);
  if (knowledgeFocusCountDeepElement) knowledgeFocusCountDeepElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'deep')).length);
  if (knowledgeFocusCountFinishedElement) knowledgeFocusCountFinishedElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'finished')).length);
  if (knowledgeFocusCountCitableElement) knowledgeFocusCountCitableElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'citable')).length);
  if (knowledgeFocusCountReplicateElement) knowledgeFocusCountReplicateElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'replicate')).length);
  if (knowledgeFocusCountRelatedElement) knowledgeFocusCountRelatedElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'related')).length);
  if (knowledgeFocusCountMethodsElement) knowledgeFocusCountMethodsElement.textContent = String(items.filter((item) => matchesKnowledgeFocus(item, 'methods')).length);
  for (const button of knowledgeFocusButtons) {
    const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
    button.classList.toggle('active', focus === activeKnowledgeFocus);
  }
}

function populateKnowledgeDashboardFilters(items: KnowledgeItem[]): void {
  const syncSelect = (select: HTMLSelectElement | null, current: string, fallbackLabel: string, values: string[]): void => {
    if (!select) return;
    const previous = current;
    select.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = fallbackLabel;
    select.append(allOption);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (values.includes(previous)) select.value = previous;
    else select.value = 'all';
  };

  const years = Array.from(new Set(items.map(extractKnowledgeYear).filter((value) => value && value !== '未标注'))).sort((a, b) => Number(b) - Number(a));
  const venues = Array.from(new Set(items.map(extractKnowledgeVenue).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const statuses = ['待读', '精读中', '已读完', '略读完成'];
  const priorities = ['高优先级', '中优先级', '常规'];

  syncSelect(knowledgeYearFilterSelect, activeKnowledgeYear, '年份', years);
  syncSelect(knowledgeVenueFilterSelect, activeKnowledgeVenue, '会议/期刊', venues);
  syncSelect(knowledgeReadingStatusFilterSelect, activeKnowledgeReadingStatus, '阅读状态', statuses);
  syncSelect(knowledgePriorityFilterSelect, activeKnowledgePriority, '优先级', priorities);

  activeKnowledgeYear = knowledgeYearFilterSelect?.value || 'all';
  activeKnowledgeVenue = knowledgeVenueFilterSelect?.value || 'all';
  activeKnowledgeReadingStatus = knowledgeReadingStatusFilterSelect?.value || 'all';
  activeKnowledgePriority = knowledgePriorityFilterSelect?.value || 'all';
}

function getFilteredKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const query = knowledgeSearchInput.value.trim().toLocaleLowerCase('zh-CN');
  const filtered = items.filter((item) => {
    if (activeKnowledgeFilter !== 'all' && item.kind !== activeKnowledgeFilter) return false;
    if (activeKnowledgeCategory !== 'all' && item.category !== activeKnowledgeCategory) return false;
    if (activeKnowledgeTag && !item.tags.includes(activeKnowledgeTag)) return false;
    if (!matchesKnowledgeFocus(item, activeKnowledgeFocus)) return false;
    if (activeKnowledgeYear !== 'all' && extractKnowledgeYear(item) !== activeKnowledgeYear) return false;
    if (activeKnowledgeVenue !== 'all' && extractKnowledgeVenue(item) !== activeKnowledgeVenue) return false;
    if (activeKnowledgeReadingStatus !== 'all' && deriveKnowledgeReadingStatus(item) !== activeKnowledgeReadingStatus) return false;
    if (activeKnowledgePriority !== 'all' && deriveKnowledgePriority(item) !== activeKnowledgePriority) return false;
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
    ].join('\n').toLocaleLowerCase('zh-CN');
    return haystack.includes(query);
  });

  const sort = knowledgeSortSelect.value;
  filtered.sort((left, right) => {
    if (sort === 'oldest') return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
    if (sort === 'title') return left.title.localeCompare(right.title, 'zh-CN');
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  return filtered;
}

function renderKnowledgeSidebar(items: KnowledgeItem[]): void {
  const countByKind = (kind: KnowledgeKind) => items.filter((item) => item.kind === kind).length;
  knowledgeCountAllElement.textContent = String(items.length);
  knowledgeCountNoteElement.textContent = String(countByKind('note'));
  knowledgeCountReadingCardElement.textContent = String(countByKind('reading-card'));
  knowledgeCountPaperCardElement.textContent = String(countByKind('paper-card'));

  const categoryCounts = new Map<string, number>();
  for (const item of items) {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
  }
  const categoryButtons: HTMLButtonElement[] = [];
  const allCategoryButton = document.createElement('button');
  allCategoryButton.type = 'button';
  allCategoryButton.classList.toggle('active', activeKnowledgeCategory === 'all');
  allCategoryButton.innerHTML = '<span>▤ 全部分类</span>';
  const allCount = document.createElement('strong');
  allCount.textContent = String(items.length);
  allCategoryButton.append(allCount);
  allCategoryButton.addEventListener('click', () => {
    activeKnowledgeCategory = 'all';
    activeKnowledgeTag = '';
    renderKnowledgeBase();
  });
  categoryButtons.push(allCategoryButton);

  for (const [category, count] of Array.from(categoryCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('active', activeKnowledgeCategory === category);
    const label = document.createElement('span');
    label.textContent = `□ ${category}`;
    const countElement = document.createElement('strong');
    countElement.textContent = String(count);
    button.append(label, countElement);
    button.addEventListener('click', () => {
      activeKnowledgeCategory = category;
      activeKnowledgeTag = '';
      renderKnowledgeBase();
    });
    categoryButtons.push(button);
  }
  knowledgeCategoryListElement.replaceChildren(...categoryButtons);

  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tagButtons = Array.from(tagCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([tag, count]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.toggle('active', activeKnowledgeTag === tag);
      button.textContent = `# ${tag} ${count}`;
      button.addEventListener('click', () => {
        activeKnowledgeTag = activeKnowledgeTag === tag ? '' : tag;
        activeKnowledgeCategory = 'all';
        renderKnowledgeBase();
      });
      return button;
    });
  knowledgeTagListElement.replaceChildren(...tagButtons);

  const latest = [...items].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];
  knowledgeRecentSummaryElement.textContent = latest
    ? `${formatKnowledgeRelativeDate(latest.updatedAt)} · ${latest.title}`
    : '还没有保存内容';
}

function createKnowledgeItemCard(item: KnowledgeItem): HTMLElement {
  const card = document.createElement('article');
  card.className = `knowledge-item-card knowledge-dashboard-card kind-${item.kind}`;
  card.classList.toggle('selected-for-research', selectedKnowledgeResearchKeys.has(item.recordKey));
  card.dataset.recordKey = item.recordKey;
  card.tabIndex = 0;

  const status = deriveKnowledgeReadingStatus(item);
  const priority = deriveKnowledgePriority(item);
  const citationScore = getKnowledgeCitationScore(item);
  const relevance = getKnowledgeRelevancePercent(item);
  const venue = extractKnowledgeVenue(item);
  const year = extractKnowledgeYear(item);
  const excerpt = getKnowledgeExcerptForDashboard(item);

  const top = document.createElement('div');
  top.className = 'knowledge-item-card-top';

  const badges = document.createElement('div');
  badges.className = 'knowledge-card-badges';
  const statusBadge = document.createElement('span');
  statusBadge.className = `knowledge-badge status-${status === '精读中' ? 'deep' : status === '已读完' || status === '略读完成' ? 'done' : 'todo'}`;
  statusBadge.textContent = status;
  const priorityBadge = document.createElement('span');
  priorityBadge.className = `knowledge-badge priority-${priority === '高优先级' ? 'high' : priority === '中优先级' ? 'medium' : 'normal'}`;
  priorityBadge.textContent = priority;
  badges.append(statusBadge, priorityBadge);

  const meta = document.createElement('div');
  meta.className = 'knowledge-card-meta';
  const time = document.createElement('time');
  time.dateTime = item.updatedAt;
  time.textContent = formatKnowledgeRelativeDate(item.updatedAt);
  const selectionLabel = document.createElement('label');
  selectionLabel.className = 'knowledge-card-select';
  selectionLabel.title = '加入跨文献分析';
  const selectionInput = document.createElement('input');
  selectionInput.type = 'checkbox';
  selectionInput.checked = selectedKnowledgeResearchKeys.has(item.recordKey);
  selectionInput.setAttribute('aria-label', `选择“${item.title}”用于跨文献分析`);
  const selectionMark = document.createElement('span');
  selectionMark.textContent = '✓';
  selectionLabel.append(selectionInput, selectionMark);
  selectionLabel.addEventListener('click', (event) => event.stopPropagation());
  selectionInput.addEventListener('keydown', (event) => event.stopPropagation());
  selectionInput.addEventListener('change', () => {
    if (selectionInput.checked) selectedKnowledgeResearchKeys.add(item.recordKey);
    else selectedKnowledgeResearchKeys.delete(item.recordKey);
    card.classList.toggle('selected-for-research', selectionInput.checked);
    updateKnowledgeResearchScopeSummary();
  });
  meta.append(time, selectionLabel);
  top.append(badges, meta);

  const title = document.createElement('strong');
  title.className = 'knowledge-card-title';
  title.textContent = item.title;

  const subtitle = document.createElement('div');
  subtitle.className = 'knowledge-card-subtitle';
  subtitle.textContent = `${venue} ${year !== '未标注' ? year : ''} · ${getKnowledgeBaseDocumentName(item.documentName)}`.trim();

  const excerptElement = document.createElement('p');
  excerptElement.className = 'knowledge-card-excerpt';
  excerptElement.textContent = excerpt;

  const tags = document.createElement('div');
  tags.className = 'knowledge-card-tags';
  for (const tag of item.tags.slice(0, 4)) {
    const tagElement = document.createElement('span');
    tagElement.textContent = `# ${tag}`;
    tags.append(tagElement);
  }

  const metrics = document.createElement('div');
  metrics.className = 'knowledge-card-metrics';
  metrics.innerHTML = `
    <div><span>引用价值</span><strong>${createRatingStars(citationScore)} <em>${citationScore.toFixed(1)}</em></strong></div>
    <div><span>研究关联度</span><strong>${relevance}%</strong></div>
    <div><span>最近复习</span><strong>${formatKnowledgeRelativeDate(item.updatedAt)}</strong></div>
  `;

  const actions = document.createElement('div');
  actions.className = 'knowledge-card-actions';

  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'knowledge-card-primary-button';
  primaryButton.textContent = item.source === 'paper-overview' ? '打开复习页' : '查看详情';
  primaryButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (item.source === 'paper-overview') openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });

  const secondButton = document.createElement('button');
  secondButton.type = 'button';
  secondButton.textContent = '查看卡片';
  secondButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (item.source === 'paper-overview') openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });

  const replicateButton = document.createElement('button');
  replicateButton.type = 'button';
  replicateButton.textContent = isKnowledgeReplicable(item) ? '已加入复现' : '加入复现';
  replicateButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleKnowledgeSemanticTag(item, '待复现');
  });

  const citeButton = document.createElement('button');
  citeButton.type = 'button';
  citeButton.textContent = isKnowledgeCitable(item) ? '已标记可引用' : '标记可引用';
  citeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleKnowledgeSemanticTag(item, '可引用');
  });

  actions.append(primaryButton, secondButton, replicateButton, citeButton);
  card.append(top, title, subtitle, excerptElement, tags, metrics, actions);

  card.addEventListener('dblclick', () => {
    if (item.source === 'paper-overview') openSavedPaperOverviewReview(item);
    else openKnowledgeEditor(item);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (item.source === 'paper-overview') openSavedPaperOverviewReview(item);
      else openKnowledgeEditor(item);
    }
  });
  return card;
}

function createKnowledgeGroup(items: KnowledgeItem[], title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'knowledge-group';
  const heading = document.createElement('h2');
  heading.textContent = `${title} (${items.length})`;
  const grid = document.createElement('div');
  grid.className = 'knowledge-group-grid';
  grid.append(...items.map(createKnowledgeItemCard));
  section.append(heading, grid);
  return section;
}

function renderKnowledgeList(items: KnowledgeItem[]): void {
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'knowledge-list-empty';
    empty.innerHTML = '<span>⌕</span><strong>没有找到匹配内容</strong><p>可以调整筛选条件，或从 AI 助手保存一条新笔记。</p>';
    knowledgeListElement.replaceChildren(empty);
    selectedKnowledgeRecordKey = '';
    renderKnowledgeDetail([], undefined);
    return;
  }

  if (!items.some((item) => item.recordKey === selectedKnowledgeRecordKey)) {
    selectedKnowledgeRecordKey = items[0]?.recordKey || '';
  }

  const groupBy = knowledgeGroupSelect.value;
  if (groupBy === 'none') {
    knowledgeListElement.replaceChildren(...items.map(createKnowledgeItemCard));
  } else {
    const groups = new Map<string, KnowledgeItem[]>();
    for (const item of items) {
      const key = groupBy === 'source' ? item.documentName : item.category;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    const sections = Array.from(groups.entries()).map(([title, group]) => createKnowledgeGroup(group, title));
    knowledgeListElement.replaceChildren(...sections);
  }

  renderKnowledgeDetail(items, items.find((item) => item.recordKey === selectedKnowledgeRecordKey));
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
      const heading = document.createElement('h4');
      heading.textContent = headingMatch[1];
      nodes.push(heading);
      continue;
    }
    const bulletMatch = line.match(/^[•*-]\s*(.+)$/);
    if (bulletMatch?.[1]) {
      list ||= document.createElement('ul');
      const item = document.createElement('li');
      item.textContent = bulletMatch[1];
      list.append(item);
      continue;
    }
    flushList();
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    nodes.push(paragraph);
  }
  flushList();
  knowledgeDetailBodyElement.replaceChildren(...nodes);
}

function renderKnowledgeDetail(items: KnowledgeItem[], item: KnowledgeItem | undefined): void {
  knowledgeDetailEmptyElement.hidden = Boolean(item);
  knowledgeDetailContentElement.hidden = !item;
  if (!item) return;

  knowledgeDetailTypeElement.textContent = `${getKnowledgeKindIcon(item.kind)} ${getKnowledgeKindLabel(item.kind)}`;
  knowledgeDetailTypeElement.dataset.kind = item.kind;
  knowledgeDetailTimeElement.textContent = formatKnowledgeRelativeDate(item.updatedAt);
  knowledgeDetailTitleElement.textContent = item.title;
  knowledgeDetailDocumentElement.textContent = item.documentName;
  knowledgeDetailPositionElement.textContent = item.positionLabel || (item.pageNumber ? `第 ${item.pageNumber} 页` : '未定位');
  knowledgeDetailCreatedElement.textContent = formatKnowledgeDate(item.createdAt);
  knowledgeDetailUpdatedElement.textContent = formatKnowledgeDate(item.updatedAt);

  const tags = item.tags.map((tag) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = `#${tag}`;
    element.addEventListener('click', () => {
      activeKnowledgeTag = tag;
      activeKnowledgeCategory = 'all';
      renderKnowledgeBase();
    });
    return element;
  });
  knowledgeDetailTagsElement.replaceChildren(...tags);
  renderKnowledgeBody(item.content);
  knowledgeEditItemButton.textContent = item.source === 'paper-overview' ? '打开复习页' : '编辑内容';
  knowledgeEditItemButton.title = item.source === 'paper-overview'
    ? '打开完整论文卡片页面进行复习和修改'
    : '编辑当前知识内容';

  const related = items.filter(
    (candidate) => candidate.recordKey !== item.recordKey && candidate.documentName === item.documentName,
  );
  const relatedNotes = related.filter((candidate) => candidate.kind === 'note').length;
  const relatedCards = related.filter((candidate) => candidate.kind !== 'note').length;
  knowledgeRelatedSummaryElement.textContent = related.length
    ? `同一文档中还有 ${relatedNotes} 条笔记、${relatedCards} 张卡片。`
    : '当前文档暂无其他关联内容。';
  knowledgeOpenSourceButton.disabled = !item.pageNumber;
}


function getKnowledgeFilterLabel(filter: KnowledgeFilter): string {
  return {
    all: '全部内容',
    note: '保存的笔记',
    'reading-card': '阅读卡片',
    'paper-card': '论文卡片',
  }[filter];
}

function setKnowledgePageMode(mode: KnowledgePageMode): void {
  activeKnowledgePageMode = mode;
  for (const button of knowledgeModeButtons) {
    const isActive = button.dataset.knowledgeMode === mode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  }
  const isLibrary = mode === 'library';
  knowledgeLibraryView.hidden = !isLibrary;
  knowledgeResearchView.hidden = isLibrary;
  knowledgeQaControls.hidden = mode !== 'qa';
  knowledgeInsightControls.hidden = mode !== 'insights';
  knowledgeBasePageElement.classList.toggle('research-mode', !isLibrary);

  if (mode === 'qa') {
    knowledgePageTitleElement.textContent = '跨文献问答';
    knowledgeResearchHeading.textContent = '跨文献问答';
    knowledgeResearchDescription.textContent = '让 AI 综合你保存的论文卡片、阅读卡片和笔记，并用 [K1]、[K2] 标注依据。';
    knowledgeRunResearchButton.textContent = '✦ 开始回答';
    window.setTimeout(() => knowledgeResearchQuestionInput.focus(), 0);
  } else if (mode === 'insights') {
    knowledgePageTitleElement.textContent = '研究洞察';
    knowledgeResearchHeading.textContent = '研究洞察';
    knowledgeResearchDescription.textContent = '寻找文献共识、冲突、研究空白与可验证的新假设，并明确区分证据和 AI 推测。';
    knowledgeRunResearchButton.textContent = '◇ 生成研究洞察';
  } else {
    knowledgePageTitleElement.textContent = getKnowledgeFilterLabel(activeKnowledgeFilter);
  }
  updateKnowledgeResearchScopeSummary();
  persistCurrentAppViewState();
}

function getKnowledgeResearchScopeItems(): KnowledgeItem[] {
  const allItems = collectKnowledgeItems();
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  if (scope === 'selected') {
    return allItems.filter((item) => selectedKnowledgeResearchKeys.has(item.recordKey));
  }
  if (scope === 'filtered') return getFilteredKnowledgeItems(allItems);
  return allItems;
}

function updateKnowledgeResearchScopeSummary(): void {
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  const items = getKnowledgeResearchScopeItems();
  const documents = new Set(items.map((item) => item.documentName)).size;
  if (scope === 'selected' && !items.length) {
    knowledgeResearchScopeSummary.textContent = '尚未勾选材料';
    knowledgeResearchScopeSummary.classList.add('empty');
  } else {
    knowledgeResearchScopeSummary.textContent = `${items.length} 条内容 · ${documents} 篇文档`;
    knowledgeResearchScopeSummary.classList.remove('empty');
  }
}

function getKnowledgeResearchTokens(query: string): string[] {
  return Array.from(new Set(
    (query.toLocaleLowerCase('zh-CN').match(/[\p{L}\p{N}]{2,}/gu) || [])
      .map((token) => token.trim())
      .filter(Boolean),
  )).slice(0, 24);
}

function rankKnowledgeItemsForResearch(items: KnowledgeItem[], query: string): KnowledgeItem[] {
  const tokens = getKnowledgeResearchTokens(query);
  const scored = items.map((item, index) => {
    const title = item.title.toLocaleLowerCase('zh-CN');
    const tags = `${item.category} ${item.tags.join(' ')}`.toLocaleLowerCase('zh-CN');
    const documentName = item.documentName.toLocaleLowerCase('zh-CN');
    const content = item.content.toLocaleLowerCase('zh-CN');
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
  scored.sort((left, right) => right.score - left.score
    || new Date(right.item.updatedAt).getTime() - new Date(left.item.updatedAt).getTime()
    || left.index - right.index);

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
    const cleanContent = item.content.replace(/\s+/g, ' ').trim();
    const prefix = [
      `[K${index + 1}]`,
      `标题：${item.title}`,
      `类型：${getKnowledgeKindLabel(item.kind)}`,
      `来源文档：${item.documentName}`,
      `位置：${item.positionLabel}`,
      `分类与标签：${[item.category, ...item.tags].filter(Boolean).join('、') || '无'}`,
      '内容：',
    ].join('\n');
    const allowance = Math.max(280, Math.min(1_050, remaining - prefix.length));
    const excerpt = cleanContent.slice(0, allowance);
    const block = `${prefix}${excerpt}${cleanContent.length > excerpt.length ? '…' : ''}`;
    if (block.length > remaining && blocks.length >= 4) break;
    blocks.push(block);
    remaining -= block.length + 2;
    if (remaining < 500) break;
  }
  return blocks.join('\n\n');
}

function renderKnowledgeResearchSources(items: KnowledgeItem[]): void {
  const nodes = items.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<strong>[K${index + 1}]</strong><span></span><small></small>`;
    const title = button.querySelector('span');
    const source = button.querySelector('small');
    if (title) title.textContent = item.title;
    if (source) source.textContent = `${item.documentName} · ${item.positionLabel}`;
    button.addEventListener('click', () => {
      selectedKnowledgeRecordKey = item.recordKey;
      setKnowledgePageMode('library');
      renderKnowledgeBase();
    });
    return button;
  });
  knowledgeResearchSourceList.replaceChildren(...nodes);
}

function clearKnowledgeResearchResult(): void {
  lastKnowledgeResearchAnswer = '';
  lastKnowledgeResearchQuestion = '';
  lastKnowledgeResearchItems = [];
  knowledgeResearchResult.hidden = true;
  knowledgeResearchResultBody.replaceChildren();
  knowledgeResearchSourceList.replaceChildren();
  knowledgeResearchStatus.textContent = '';
  knowledgeResearchStatus.classList.remove('error');
}

async function runKnowledgeResearch(): Promise<void> {
  if (knowledgeResearchPending) return;
  const scopeItems = getKnowledgeResearchScopeItems();
  if (!scopeItems.length) {
    knowledgeResearchStatus.textContent = knowledgeResearchScopeSelect.value === 'selected'
      ? '请先在“内容库”中勾选材料，或改用“当前筛选结果/全部知识库”。'
      : '当前范围没有可分析的知识条目。';
    knowledgeResearchStatus.classList.add('error');
    return;
  }

  const supplementary = knowledgeInsightQuestionInput.value.trim();
  const question = activeKnowledgePageMode === 'insights'
    ? `${activeKnowledgeInsightPrompt}${supplementary ? `\n\n用户补充要求：${supplementary}` : ''}`
    : knowledgeResearchQuestionInput.value.trim();
  if (!question) {
    knowledgeResearchStatus.textContent = '请先输入一个研究问题。';
    knowledgeResearchStatus.classList.add('error');
    knowledgeResearchQuestionInput.focus();
    return;
  }

  const rankedItems = rankKnowledgeItemsForResearch(scopeItems, question);
  const material = buildKnowledgeResearchMaterial(rankedItems);
  if (!material) {
    knowledgeResearchStatus.textContent = '这些条目没有足够的正文内容可供分析。';
    knowledgeResearchStatus.classList.add('error');
    return;
  }

  knowledgeResearchPending = true;
  knowledgeRunResearchButton.disabled = true;
  knowledgeResearchStatus.classList.remove('error');
  knowledgeResearchStatus.textContent = `正在综合 ${rankedItems.length} 条内容，请稍候…`;
  knowledgeResearchResult.hidden = false;
  knowledgeResearchResultKind.textContent = activeKnowledgePageMode === 'insights' ? '研究洞察' : '跨文献问答';
  knowledgeResearchResultTitle.textContent = activeKnowledgePageMode === 'insights'
    ? '正在生成研究洞察…'
    : question.slice(0, 56);
  knowledgeResearchResultBody.textContent = 'AI 正在比较材料、寻找证据和差异…';
  renderKnowledgeResearchSources(rankedItems);

  try {
    if (!aiConfigLoaded) await loadDeepSeekConfig();
    const prompt = [
      '你是严谨的跨文献研究助手。只能依据下方“知识库材料”回答，不要假装看过未提供的论文全文。',
      '回答规则：',
      '1. 所有来自材料的关键结论都要在句末引用 [K1]、[K2]；可以同时引用多个。',
      '2. 明确区分“材料中的事实”“跨材料综合判断”和“AI 推测”。',
      '3. 新想法必须标记为【AI 推测】或【待验证假设】，并说明依据、反例和最小验证方式。',
      '4. 材料不足或互相矛盾时直接说明，不要编造作者、数据、实验结果或引用。',
      '5. 优先给出有研究价值、可验证、能形成下一步行动的回答。',
      '',
      `用户任务：${question}`,
      '',
      '知识库材料：',
      material,
    ].join('\n');
    const answer = await requestAiContent([{ role: 'user', content: prompt }], {});
    lastKnowledgeResearchAnswer = answer;
    lastKnowledgeResearchQuestion = question;
    lastKnowledgeResearchItems = rankedItems;
    knowledgeResearchResultTitle.textContent = activeKnowledgePageMode === 'insights'
      ? '研究洞察报告'
      : question.slice(0, 80);
    renderChatMarkdown(knowledgeResearchResultBody, answer);
    knowledgeResearchStatus.textContent = `完成：综合了 ${rankedItems.length} 条内容，来自 ${new Set(rankedItems.map((item) => item.documentName)).size} 篇文档。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    knowledgeResearchStatus.textContent = `分析失败：${message}`;
    knowledgeResearchStatus.classList.add('error');
    knowledgeResearchResultBody.textContent = message;
  } finally {
    knowledgeResearchPending = false;
    knowledgeRunResearchButton.disabled = false;
  }
}

function saveKnowledgeResearchResult(): void {
  if (!lastKnowledgeResearchAnswer) return;
  const isInsight = activeKnowledgePageMode === 'insights';
  const title = isInsight
    ? `研究洞察：${lastKnowledgeResearchItems[0]?.category || '知识库综合'}`
    : `跨文献问答：${getKnowledgeExcerpt(lastKnowledgeResearchQuestion).slice(0, 34)}`;
  const sourceIndex = lastKnowledgeResearchItems
    .map((item, index) => `[K${index + 1}] ${item.title}｜${item.documentName}｜${item.positionLabel}`)
    .join('\n');
  const note = addKnowledgeNote({
    title,
    content: [
      '## 研究任务',
      lastKnowledgeResearchQuestion,
      '',
      '## AI 综合结果',
      lastKnowledgeResearchAnswer,
      '',
      '## 使用的知识条目',
      sourceIndex,
    ].join('\n'),
    documentName: '知识库综合分析',
    positionLabel: `${lastKnowledgeResearchItems.length} 条知识内容`,
    category: isInsight ? '研究洞察' : '跨文献问答',
    tags: isInsight ? ['研究洞察', 'AI 推测', '跨文献'] : ['跨文献问答', '知识库'],
  });
  knowledgeResearchStatus.classList.remove('error');
  knowledgeResearchStatus.textContent = `已保存“${note.title}”。`;
}

function renderKnowledgeBase(): void {
  const items = collectKnowledgeItems();
  const validKeys = new Set(items.map((item) => item.recordKey));
  selectedKnowledgeResearchKeys = new Set(
    Array.from(selectedKnowledgeResearchKeys).filter((key) => validKeys.has(key)),
  );
  renderKnowledgeSidebar(items);
  populateKnowledgeDashboardFilters(items);
  syncKnowledgeFocusCounts(items);
  const filtered = getFilteredKnowledgeItems(items);
  if (knowledgePageSubtitleElement) {
    knowledgePageSubtitleElement.textContent = activeKnowledgeFocus === 'all'
      ? '管理你的文献笔记、论文卡片与综述准备，一站式助力高效科研。'
      : '聚焦当前阅读目标，优先处理最值得研究生投入时间的文献内容。';
  }
  knowledgePageTitleElement.textContent = '研究知识库';
  knowledgeTotalCountElement.textContent = String(filtered.length);
  knowledgeDocumentCountElement.textContent = String(new Set(filtered.map((item) => item.documentName)).size);
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
  appFrame?.classList.remove('paper-card-page-open');
  paperCardEntryButton?.classList.remove('active');
  knowledgeBasePageElement.hidden = false;
  appFrame?.classList.add('knowledge-base-page-open');
  knowledgeBaseEntryButton.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');
  knowledgeBasePageElement.scrollTop = 0;
  renderKnowledgeBase();
}

function closeKnowledgeBasePage(): void {
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove('knowledge-base-page-open');
  knowledgeBaseEntryButton.classList.remove('active');
  aiPanelToggleButton?.classList.add('active');
  persistCurrentAppViewState();
}

function getSelectedKnowledgeItem(): KnowledgeItem | undefined {
  return collectKnowledgeItems().find((item) => item.recordKey === selectedKnowledgeRecordKey);
}

function addKnowledgeNote(note: Omit<SavedKnowledgeNote, 'id' | 'createdAt' | 'updatedAt'>): SavedKnowledgeNote {
  const now = new Date().toISOString();
  const saved: SavedKnowledgeNote = {
    ...note,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  writeSavedKnowledgeNotes([saved, ...readSavedKnowledgeNotes()]);
  selectedKnowledgeRecordKey = getKnowledgeRecordKey('knowledge-note', saved.id);
  refreshKnowledgeBaseIfOpen();
  return saved;
}

function openKnowledgeEditor(item?: KnowledgeItem): void {
  knowledgeEditorTargetKey = item?.recordKey || null;
  knowledgeEditorHeading.textContent = item ? '编辑知识内容' : '新建笔记';
  knowledgeEditorSource.textContent = item
    ? `${item.documentName} · ${item.positionLabel}`
    : sourceName
      ? `${getDisplayFileName(sourceName)} · 第 ${Math.max(1, pdfViewer.currentPageNumber || 1)} 页`
      : '保存到本地知识库';
  knowledgeEditorTitleInput.value = item?.title || '';
  knowledgeEditorCategoryInput.value = item?.category || 'AI 笔记';
  knowledgeEditorTagsInput.value = item?.tags.join(', ') || '';
  knowledgeEditorBodyInput.value = item?.content || '';
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
  const category = knowledgeEditorCategoryInput.value.trim() || '未分类';
  const tags = normalizeKnowledgeTags(
    knowledgeEditorTagsInput.value.split(/[,，]/).map((tag) => tag.trim()),
  );
  if (!title && !content) {
    setKnowledgePageStatus('请至少填写标题或正文。', true);
    return;
  }

  if (!knowledgeEditorTargetKey) {
    const pageNumber = pdfDocument ? Math.max(1, pdfViewer.currentPageNumber || 1) : undefined;
    const chapter = pageNumber ? getCurrentChapterContext(pageNumber).title : '';
    const saved = addKnowledgeNote({
      title: title || getKnowledgeExcerpt(content).slice(0, 40) || '未命名笔记',
      content,
      documentName: sourceName ? getDisplayFileName(sourceName) : '未关联文档',
      pageNumber,
      positionLabel: pageNumber ? `${chapter} · 第 ${pageNumber} 页` : '未定位',
      category,
      tags,
    });
    selectedKnowledgeRecordKey = getKnowledgeRecordKey('knowledge-note', saved.id);
  } else {
    const item = collectKnowledgeItems().find((candidate) => candidate.recordKey === knowledgeEditorTargetKey);
    if (!item) {
      setKnowledgePageStatus('这条内容已不存在，请刷新后重试。', true);
      return;
    }
    const now = new Date().toISOString();
    if (item.source === 'knowledge-note') {
      const notes = readSavedKnowledgeNotes().map((note) => note.id === item.id
        ? {
            ...note,
            title: title || item.title,
            content,
            category,
            tags,
            updatedAt: now,
          }
        : note);
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
  setKnowledgePageStatus('内容已保存。');
  renderKnowledgeBase();
}

function deleteSelectedKnowledgeItem(): void {
  const item = getSelectedKnowledgeItem();
  if (!item) return;
  if (!window.confirm(`确定删除“${item.title}”吗？此操作不可撤销。`)) return;

  if (item.source === 'knowledge-note') {
    writeSavedKnowledgeNotes(readSavedKnowledgeNotes().filter((note) => note.id !== item.id));
  } else if (item.source === 'summary-note') {
    localStorage.setItem(
      SUMMARY_NOTES_STORAGE_KEY,
      JSON.stringify(readSavedSummaryNotes().filter((note) => note.id !== item.id)),
    );
  } else if (item.source === 'reading-card') {
    localStorage.setItem(
      SAVED_CARDS_STORAGE_KEY,
      JSON.stringify(readSavedPaperCards().filter((card) => card.id !== item.id)),
    );
  } else {
    localStorage.setItem(
      SAVED_PAPER_OVERVIEWS_STORAGE_KEY,
      JSON.stringify(readSavedPaperOverviews().filter((card) => card.id !== item.id)),
    );
  }

  const metaStore = readKnowledgeItemMetaStore();
  delete metaStore[item.recordKey];
  writeKnowledgeItemMetaStore(metaStore);
  selectedKnowledgeResearchKeys.delete(item.recordKey);
  selectedKnowledgeRecordKey = '';
  setKnowledgePageStatus('内容已删除。');
  renderKnowledgeBase();
}

function openSelectedKnowledgeSource(): void {
  const item = getSelectedKnowledgeItem();
  if (!item?.pageNumber) {
    setKnowledgePageStatus('这条内容没有可定位的页码。', true);
    return;
  }
  const currentDocumentName = sourceName ? getDisplayFileName(sourceName) : '';
  if (!pdfDocument || currentDocumentName !== item.documentName) {
    setKnowledgePageStatus(`请先打开来源文件“${item.documentName}”。`, true);
    return;
  }
  const pageNumber = Math.min(pdfDocument.numPages, Math.max(1, item.pageNumber));
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
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { notes?: unknown }).notes)
        ? (parsed as { notes: unknown[] }).notes
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : [];
    const imported: SavedKnowledgeNote[] = [];
    const now = new Date().toISOString();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const value = candidate as Record<string, unknown>;
      const title = typeof value.title === 'string' ? value.title.trim() : '';
      const content = typeof value.content === 'string' ? value.content.trim() : '';
      if (!title && !content) continue;
      imported.push({
        id: crypto.randomUUID(),
        title: title || getKnowledgeExcerpt(content).slice(0, 40) || '导入笔记',
        content,
        documentName: typeof value.documentName === 'string' && value.documentName.trim()
          ? value.documentName.trim()
          : '导入内容',
        pageNumber: typeof value.pageNumber === 'number' && Number.isFinite(value.pageNumber)
          ? Math.max(1, Math.round(value.pageNumber))
          : undefined,
        positionLabel: typeof value.positionLabel === 'string' && value.positionLabel.trim()
          ? value.positionLabel.trim()
          : '导入内容',
        category: typeof value.category === 'string' && value.category.trim()
          ? value.category.trim()
          : '导入笔记',
        tags: normalizeKnowledgeTags(value.tags),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!imported.length) throw new Error('文件中没有可识别的笔记。');
    writeSavedKnowledgeNotes([...imported, ...readSavedKnowledgeNotes()]);
    selectedKnowledgeRecordKey = getKnowledgeRecordKey('knowledge-note', imported[0]!.id);
    setKnowledgePageStatus(`已导入 ${imported.length} 条笔记。`);
    renderKnowledgeBase();
  } catch (error) {
    setKnowledgePageStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    knowledgeImportInput.value = '';
  }
}

function saveTranslationAndExplanationAsNote(): void {
  const sourceText = selectedTextForAi.trim();
  const translation = translationResultElement.textContent?.trim() || '';
  const explanationPoints = Array.from(explanationResultElement.querySelectorAll('li'))
    .map((item) => item.textContent?.trim() || '')
    .filter(Boolean);
  const explanation = explanationPoints.length
    ? explanationPoints.map((point) => `• ${point}`).join('\n')
    : explanationResultElement.textContent?.trim() || '';
  const invalidTranslation = !translation
    || translation.includes('自动翻译')
    || translation.startsWith('正在自动翻译')
    || translation.startsWith('翻译失败');
  if (!sourceText || invalidTranslation) {
    setStatus('当前没有可保存的翻译结果。', true);
    return;
  }

  const pageNumber = Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1);
  const chapter = getCurrentChapterContext(pageNumber).title;
  const note = addKnowledgeNote({
    title: `翻译与解释：${getKnowledgeExcerpt(sourceText).slice(0, 34)}`,
    content: [
      '原文',
      sourceText,
      '',
      '中文翻译',
      translation,
      '',
      'AI 解释',
      explanation,
    ].join('\n'),
    documentName: sourceName ? getDisplayFileName(sourceName) : '未关联文档',
    pageNumber,
    positionLabel: `${chapter} · 第 ${pageNumber} 页`,
    category: 'AI 翻译',
    tags: ['翻译', 'AI 解释'],
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
  const actions = document.createElement('div');
  actions.className = 'chat-message-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '保存为笔记';
  button.addEventListener('click', () => {
    const chapter = getCurrentChapterContext(pageNumber).title;
    const note = addKnowledgeNote({
      title: question ? `AI 问答：${getKnowledgeExcerpt(question).slice(0, 34)}` : 'AI 问答笔记',
      content: [`问题`, question, '', 'AI 回答', answer].join('\n'),
      documentName,
      pageNumber,
      positionLabel: `${chapter} · 第 ${pageNumber} 页`,
      category: 'AI 对话',
      tags: ['AI 问答'],
    });
    button.disabled = true;
    button.textContent = '已保存';
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
    void explainSelectedText(text);
  }, AUTO_TRANSLATE_DELAY_MS);
}

function updateAiSelectedSnippet(): void {
  const text = getViewerSelectionText();
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  if (!text || (text === selectedTextForAi && pageNumber === selectedTextPageNumber)) return;

  selectedTextForAi = text;
  selectedTextPageNumber = pageNumber;
  selectedSnippetElement.textContent = text;
  selectedSnippetElement.title = text;
  translationAbortController?.abort();
  explanationAbortController?.abort();
  cancelPendingAutomaticTranslation();
  lastTranslatedText = '';
  lastExplainedText = '';
  if (activeAssistantView === 'translate') {
    scheduleAutomaticTranslation(text);
  } else {
    setTranslationState('切换到“翻译/解释”后将自动处理当前选区。');
    setExplanationState('当前选区也已同步到聊天上下文。');
  }

  if (activeSummaryScope === 'selection') {
    lastSummaryRequestKey = '';
    lastSummaryPoints = [];
    currentSummaryContext = null;
    updateSummaryMetadata();
    if (activeAssistantView === 'summary') scheduleSummaryGeneration();
  }

  lastCardRequestKey = '';
  currentCardContext = null;
  currentGeneratedCard = null;
  cardAbortController?.abort();
  updateCardSourceSnippet();
  if (activeAssistantView === 'cards') scheduleCardGeneration();
}

function scheduleAiSelectedSnippetUpdate(): void {
  cancelAnimationFrame(aiSelectionUpdateFrame);
  aiSelectionUpdateFrame = requestAnimationFrame(updateAiSelectedSnippet);
}

async function translateSelectedText(text: string): Promise<void> {
  if (!text || text !== selectedTextForAi) return;

  translationAbortController?.abort();
  const controller = new AbortController();
  translationAbortController = controller;
  setTranslationState('正在自动翻译，请稍候…');

  try {
    const translation = await requestAiContent(
      [{
        role: 'user',
        content: '请把当前选中的 PDF 原文准确翻译成简体中文。保留原意、术语和逻辑，只输出译文，不要添加说明。',
      }],
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
        selectedText: text,
      },
    );

    // 只展示当前选区对应的结果，防止慢请求覆盖新选区。
    if (controller.signal.aborted || text !== selectedTextForAi) return;

    lastTranslatedText = text;
    setTranslationState(translation);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted || text !== selectedTextForAi) return;

    const message = error instanceof Error ? error.message : String(error);
    setTranslationState(`翻译失败：${message}`, true);
  } finally {
    if (translationAbortController === controller) {
      translationAbortController = null;
    }
  }
}

async function explainSelectedText(text: string): Promise<void> {
  if (!text || text !== selectedTextForAi || text === lastExplainedText) return;

  explanationAbortController?.abort();
  const controller = new AbortController();
  explanationAbortController = controller;
  setExplanationState('正在生成 AI 解释，请稍候…');

  try {
    const explanation = await requestAiContent(
      [{
        role: 'user',
        content: '请用简体中文解释当前选中的 PDF 原文，给出 3—5 条便于学习的核心要点，每行一条，不要添加标题。',
      }],
      {
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: selectedTextPageNumber || pdfViewer.currentPageNumber || 1,
        selectedText: text,
      },
    );
    const points = parseAiList(explanation).slice(0, 6);

    if (!points.length) {
      throw new Error('模型没有返回解释内容。');
    }

    if (controller.signal.aborted || text !== selectedTextForAi) return;

    lastExplainedText = text;
    renderExplanationPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted || text !== selectedTextForAi) return;

    const message = error instanceof Error ? error.message : String(error);
    setExplanationState(`解释失败：${message}`, true);
  } finally {
    if (explanationAbortController === controller) {
      explanationAbortController = null;
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
  document.querySelectorAll('.pdf-helper-selection-overlay').forEach((element) => element.remove());
}

function getSelectionHeightRatio(): number {
  const ratioValue = getComputedStyle(document.documentElement)
    .getPropertyValue('--pdf-selection-height-ratio')
    .trim();
  return Math.min(1, Math.max(0.35, Number.parseFloat(ratioValue) || 0.68));
}

function mergeSelectionRects(rects: SelectionRect[]): SelectionRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: SelectionRect[] = [];

  for (const rect of sorted) {
    const previous = merged.at(-1);
    const sameLine =
      previous &&
      Math.abs(previous.top + previous.height / 2 - (rect.top + rect.height / 2)) <=
        Math.max(previous.height, rect.height) * 0.45;
    const closeEnough =
      previous && rect.left <= previous.right + Math.max(previous.height, rect.height) * 0.9;

    if (previous && sameLine && closeEnough) {
      const right = Math.max(previous.right, rect.right);
      const bottom = Math.max(previous.bottom, rect.bottom);
      previous.top = Math.min(previous.top, rect.top);
      previous.right = right;
      previous.bottom = bottom;
      previous.width = right - previous.left;
      previous.height = bottom - previous.top;
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
}

function getTextNodeSelectionOffsets(range: Range, textNode: Text): { start: number; end: number } | null {
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

function collectSelectionRectsFromTextLayer(range: Range, textLayer: HTMLElement) {
  const page = textLayer.closest<HTMLElement>('.pdfViewer .page');
  if (!page) return [];

  const pageRect = page.getBoundingClientRect();
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
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
  if (!selection || selection.isCollapsed || !viewerElement.contains(selection.anchorNode)) return;

  const ratio = getSelectionHeightRatio();
  const rectsByPage = new Map<HTMLElement, SelectionRect[]>();

  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (range.collapsed) continue;

    for (const textLayer of Array.from(viewerElement.querySelectorAll<HTMLElement>('.textLayer'))) {
      if (!range.intersectsNode(textLayer)) continue;
      const page = textLayer.closest<HTMLElement>('.pdfViewer .page');
      if (!page) continue;

      const selectedRects = collectSelectionRectsFromTextLayer(range, textLayer);
      if (selectedRects.length === 0) continue;
      const pageRects = rectsByPage.get(page) ?? [];
      pageRects.push(...selectedRects);
      rectsByPage.set(page, pageRects);
    }
  }

  for (const [page, pageRects] of rectsByPage) {
    const overlay = document.createElement('div');
    overlay.className = 'pdf-helper-selection-overlay';

    for (const rect of mergeSelectionRects(pageRects)) {
      const height = rect.height * ratio;
      const marker = document.createElement('span');
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

function mergeHighlightBoxes<T extends { x: number; y: number; width: number; height: number }>(
  boxes: T[],
): T[] {
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

    const closeEnough =
      gap <= Math.max(previous.height, box.height) * 0.9;

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
    const rotation = textLayer?.getAttribute('data-main-rotation') ?? '0';
    const usesHorizontalHeight = rotation === '90' || rotation === '270';

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
  annotationEditor?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color);
}

function getFreeTextSize(): number {
  const value = Number.parseInt(freeTextSizeInput.value, 10);
  return Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(FREE_TEXT_MIN_SIZE, Number.isFinite(value) ? value : FREE_TEXT_DEFAULT_SIZE),
  );
}

function setFreeTextSize(size: number) {
  const normalizedSize = Math.min(
    FREE_TEXT_MAX_SIZE,
    Math.max(FREE_TEXT_MIN_SIZE, Math.round(size)),
  );
  freeTextSizeInput.value = String(normalizedSize);
  annotationEditor?.updateParams(AnnotationEditorParamsType.FREETEXT_SIZE, normalizedSize);
  if (isFreeTextEditor(selectedAnnotationEditor)) markUnsavedChanges();
}

function setFreeTextColor(color: string) {
  freeTextColorInput.value = color;
  annotationEditor?.updateParams(AnnotationEditorParamsType.FREETEXT_COLOR, color);
  if (isFreeTextEditor(selectedAnnotationEditor)) markUnsavedChanges();
}

function getEditorParamValue(editor: any, type: number): unknown {
  const properties = editor?.propertiesToUpdate;
  if (!Array.isArray(properties)) return null;
  const pair = properties.find((entry) => Array.isArray(entry) && entry[0] === type);
  return pair?.[1] ?? null;
}

function syncFreeTextControls(editor: any) {
  if (!isFreeTextEditor(editor)) return;

  const size = Number(getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_SIZE));
  if (Number.isFinite(size)) {
    freeTextSizeInput.value = String(
      Math.min(FREE_TEXT_MAX_SIZE, Math.max(FREE_TEXT_MIN_SIZE, Math.round(size))),
    );
  }

  const color = rgbColorToHex(
    getEditorParamValue(editor, AnnotationEditorParamsType.FREETEXT_COLOR) ?? editor?.color,
  );
  if (color) freeTextColorInput.value = color;
}

async function warmUpAnnotationEditorManager(uiManager: AnnotationEditorUIManager) {
  if (!pdfDocument) return;
  const documentAtStart = pdfDocument;

  try {
    await uiManager.updateMode(AnnotationEditorType.HIGHLIGHT, null, false);
    await uiManager.updateMode(AnnotationEditorType.NONE, null, false);
  } catch (error) {
    console.warn('PDF Helper annotation editor warm-up failed.', error);
  } finally {
    if (pdfDocument !== documentAtStart) return;
    activeEditorMode = AnnotationEditorType.NONE;
    viewerElement.classList.toggle('pdf-helper-ink-mode', false);
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
  if (!restoredAnnotationWarmUpPending || !annotationEditor || annotationEditorWarmUpInFlight) {
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
    '.highlightEditor, .freeTextEditor, .inkEditor, .stampEditor, .signatureEditor',
  );
  const pageElement = target.closest<HTMLElement>('.pdfViewer .page');
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!editorElement || !Number.isInteger(pageNumber) || pageNumber < 1) return null;

  for (const editor of annotationEditor.getEditors(pageNumber - 1)) {
    if (!includeHighlight && isHighlightEditor(editor)) continue;
    if (editor.div === editorElement || editor.div?.contains(target)) return editor;
  }
  return null;
}

function isPointInRect(clientX: number, clientY: number, rect: DOMRect, padding = 0): boolean {
  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function isPointInsideHighlightShape(editorElement: HTMLElement, clientX: number, clientY: number): boolean {
  if (isPointInsideHighlightClipPath(editorElement, clientX, clientY)) return true;

  const internal = editorElement.querySelector<HTMLElement>('.internal');
  if (!internal) return false;

  const editorPointerEvents = {
    value: editorElement.style.getPropertyValue('pointer-events'),
    priority: editorElement.style.getPropertyPriority('pointer-events'),
  };
  const internalPointerEvents = {
    value: internal.style.getPropertyValue('pointer-events'),
    priority: internal.style.getPropertyPriority('pointer-events'),
  };

  try {
    editorElement.style.setProperty('pointer-events', 'auto', 'important');
    internal.style.setProperty('pointer-events', 'auto', 'important');
    const hit = document.elementFromPoint(clientX, clientY);
    return hit === internal || internal.contains(hit);
  } finally {
    editorElement.style.setProperty(
      'pointer-events',
      editorPointerEvents.value,
      editorPointerEvents.priority,
    );
    internal.style.setProperty(
      'pointer-events',
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
  if (rect.width <= 0 || rect.height <= 0 || !isPointInRect(clientX, clientY, rect)) return false;

  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute('d');
  if (!d || typeof Path2D === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
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
  const indicator = editorElement.querySelector<HTMLElement>('.pdf-helper-note-indicator');
  if (!indicator) return false;

  const rect = indicator.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && isPointInRect(clientX, clientY, rect, 2);
}

function extractUrlFragmentId(value: string): string {
  const urlMatch = value.match(/url\((["']?)(.*?)\1\)/);
  const rawUrl = urlMatch?.[2] ?? value;
  const hashIndex = rawUrl.lastIndexOf('#');
  return hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : rawUrl.replace(/^#/, '');
}

function getHighlightClipPath(editorElement: HTMLElement): SVGPathElement | null {
  const internal = editorElement.querySelector<HTMLElement>('.internal');
  if (!internal) return null;

  const clipPathValue = internal.style.clipPath || getComputedStyle(internal).clipPath;
  const clipPathId = extractUrlFragmentId(clipPathValue);
  if (!clipPathId) return null;

  const clipPath = document.getElementById(clipPathId);
  const href = clipPath?.querySelector<SVGUseElement>('use')?.getAttribute('href');
  if (!href) return null;

  return document.getElementById(extractUrlFragmentId(href)) as SVGPathElement | null;
}

function getHighlightPathPoints(editorElement: HTMLElement): Array<{ x: number; y: number }> {
  const path = getHighlightClipPath(editorElement);
  const d = path?.getAttribute('d');
  if (!d) return [];

  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let command = '';
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

    if (normalizedCommand === 'M') {
      if (!hasNumber()) continue;
      const nextX = absoluteX(readNumber());
      const nextY = absoluteY(readNumber());
      addPoint(nextX, nextY);
      subpathStartX = x;
      subpathStartY = y;
      command = relative ? 'l' : 'L';
      continue;
    }

    if (normalizedCommand === 'L') {
      while (hasNumber()) addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === 'H') {
      while (hasNumber()) addPoint(absoluteX(readNumber()), y);
      continue;
    }

    if (normalizedCommand === 'V') {
      while (hasNumber()) addPoint(x, absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === 'C') {
      while (hasNumber()) {
        // Control points are useful for bounding/anchoring too, so keep them.
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === 'S' || normalizedCommand === 'Q') {
      while (hasNumber()) {
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
        addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      }
      continue;
    }

    if (normalizedCommand === 'T') {
      while (hasNumber()) addPoint(absoluteX(readNumber()), absoluteY(readNumber()));
      continue;
    }

    if (normalizedCommand === 'Z') {
      addPoint(subpathStartX, subpathStartY);
      continue;
    }

    // Unknown command. Skip following numbers to avoid an infinite loop.
    while (hasNumber()) index += 1;
  }

  return points;
}

function findHighlightNoteAnchor(editorElement: HTMLElement): { x: number; y: number } | null {
  const rect = editorElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const points = getHighlightPathPoints(editorElement);
  if (points.length > 0) {
    const minY = Math.min(...points.map((point) => point.y));
    const lineTolerance = Math.max(0.01, Math.min(0.08, 18 / Math.max(rect.height, 1)));
    const topLinePoints = points.filter((point) => point.y <= minY + lineTolerance);
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

function isPointInsideEditor(editor: any, clientX: number, clientY: number): boolean {
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
      editorElement.querySelectorAll<HTMLElement>('[contenteditable="true"], .internal'),
    );
    const candidates = contentElements.length > 0 ? contentElements : [editorElement];
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && isPointInRect(clientX, clientY, rect, 1);
    });
  }

  const rect = editorElement.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && isPointInRect(clientX, clientY, rect, 1);
}

function findAnnotationEditorAtPoint(
  clientX: number,
  clientY: number,
  options: { highlightOnly?: boolean; includeHighlight?: boolean } = {},
): any | null {
  if (!annotationEditor) return null;
  const includeHighlight = options.includeHighlight ?? true;

  const hit = document.elementFromPoint(clientX, clientY);
  const pageElement = hit?.closest<HTMLElement>('.pdfViewer .page');
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

function isPointInsideSavedSelection(clientX: number, clientY: number): boolean {
  for (const range of contextSelectionRanges) {
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && rect.height > 0 && isPointInRect(clientX, clientY, rect, 2)) {
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
    (target instanceof HTMLElement && Boolean(target.closest('button, input, textarea, select, [contenteditable="true"]')))
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

function findTextLayerAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const elements = document.elementsFromPoint(clientX, clientY);
  return (
    elements.find((element) => element instanceof HTMLElement && element.classList.contains('textLayer')) as
      | HTMLElement
      | undefined
  ) ?? null;
}

function isPointInsideTextGlyph(clientX: number, clientY: number): boolean {
  const textLayer = findTextLayerAtPoint(clientX, clientY);
  if (!textLayer) return false;

  const textItems = Array.from(textLayer.querySelectorAll<HTMLElement>('span[role="presentation"], span'));
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
  return editor?.div?.getAttribute('aria-label')?.trim() || '';
}

function getEditorAnnotationId(editor: any): string {
  return (
    (typeof editor?.id === 'string' && editor.id) ||
    (typeof editor?.uid === 'string' && editor.uid) ||
    (typeof editor?.annotationElementId === 'string' && editor.annotationElementId) ||
    (typeof editor?._initialData?.annotationElementId === 'string' && editor._initialData.annotationElementId) ||
    (typeof editor?._initialData?.id === 'string' && editor._initialData.id) ||
    ''
  );
}

function extractCommentText(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value.text === 'string') return value.text.trim();
  if (typeof value.contents === 'string') return value.contents.trim();
  if (typeof value.str === 'string') return value.str.trim();
  if (typeof value.richText?.str === 'string') return value.richText.str.trim();
  if (typeof value.contentsObj?.str === 'string') return value.contentsObj.str.trim();
  return '';
}

function getAnnotationNoteFromValue(value: unknown): string {
  if (!isRecord(value)) return '';
  return (
    extractCommentText(value.pdfHelperNote) ||
    extractCommentText(value.comment) ||
    extractCommentText(value.popup) ||
    extractCommentText(value.contentsObj) ||
    extractCommentText(value.richText) ||
    ''
  );
}

function findLiveEditorForSerializedEntry(key: string, value: Record<string, unknown>): any | null {
  if (!annotationEditor || !Number.isInteger(value.pageIndex)) return null;

  const normalizedKey = normalizeStorageKey(key);
  const signature = getAnnotationGeometrySignature(value);
  const pageIndex = value.pageIndex as number;

  for (const editor of annotationEditor.getEditors(pageIndex)) {
    if (isStoredHighlightValue(value) && !isHighlightEditor(editor)) continue;

    if (getEditorStorageKeys(editor).includes(normalizedKey)) return editor;

    const editorSignature = getAnnotationGeometrySignature(getEditorSerializedValue(editor));
    if (signature && editorSignature === signature) return editor;
  }

  return null;
}

function getStoredOrLiveAnnotationNote(key: string, value: Record<string, unknown>): string {
  const storedNote = getAnnotationNoteFromValue(value);
  if (storedNote) return storedNote;

  const liveEditor = findLiveEditorForSerializedEntry(key, value);
  if (!liveEditor) return '';

  return getHighlightNote(liveEditor);
}

function getHighlightNote(editor: any): string {
  const annotationId = getEditorAnnotationId(editor);
  const geometrySignature = getAnnotationGeometrySignature(getEditorSerializedValue(editor));
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
    (geometrySignature ? restoredHelperNotesBySignature.get(geometrySignature)?.trim() : '') ||
    (annotationId ? nativeAnnotationNotes.get(annotationId)?.trim() : '') ||
    '';

  if (note) {
    editor.pdfHelperNote = note;
    editor._pdfHelperNote = note;
    for (const key of storageKeys) rememberHelperNote(key, geometrySignature, note);
  }

  return note;
}

function collectNativeAnnotationNotes(pageNumber?: number) {
  const pageSelector =
    typeof pageNumber === 'number'
      ? `.page[data-page-number="${pageNumber}"]`
      : '.page';

  for (const page of Array.from(viewerElement.querySelectorAll<HTMLElement>(pageSelector))) {
    const highlightAnnotations = page.querySelectorAll<HTMLElement>(
      '.annotationLayer .highlightAnnotation[data-annotation-id]',
    );

    for (const highlightAnnotation of Array.from(highlightAnnotations)) {
      const annotationId = highlightAnnotation.dataset.annotationId;
      if (!annotationId) continue;

      const ownPopupText = highlightAnnotation
        .querySelector<HTMLElement>('.popupContent')
        ?.textContent
        ?.trim();
      const nextPopup = highlightAnnotation.nextElementSibling;
      const siblingPopupText = nextPopup?.classList.contains('popupAnnotation')
        ? nextPopup.querySelector<HTMLElement>('.popupContent')?.textContent?.trim()
        : '';
      const note = ownPopupText || siblingPopupText || '';

      if (note) {
        nativeAnnotationNotes.set(annotationId, note);
      }
    }
  }
}

function updateHighlightNoteIndicator(editor: any) {
  const container = editor?.div as HTMLDivElement | null;
  if (!container) return;

  let indicator = container.querySelector<HTMLElement>('.pdf-helper-note-indicator');
  if (!getHighlightNote(editor)) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'pdf-helper-note-indicator';
    indicator.textContent = '●';
    indicator.setAttribute('aria-label', '此高亮有笔记');
    container.append(indicator);
  }

  const anchor = findHighlightNoteAnchor(container);
  if (anchor) {
    indicator.style.left = `${anchor.x}px`;
    indicator.style.top = `${anchor.y}px`;
  } else {
    indicator.style.left = '';
    indicator.style.top = '';
  }
}

function refreshHighlightNoteIndicators(pageNumber?: number) {
  if (!annotationEditor) return;
  collectNativeAnnotationNotes(pageNumber);

  const pageIndexes =
    typeof pageNumber === 'number'
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
  if (isHighlightEditor(editor)) return '高亮';
  if (isFreeTextEditor(editor)) return '文本';
  if (isInkEditor(editor)) return '画笔';
  return '批注';
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
  const left = Math.min(Math.max(8, anchor.right - rect.width), window.innerWidth - rect.width - 8);
  const preferredTop = anchor.top - rect.height - 8;
  const top = preferredTop >= 8 ? preferredTop : Math.min(anchor.bottom + 8, window.innerHeight - rect.height - 8);
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
  const left = Math.min(Math.max(8, anchor.right + 10), window.innerWidth - rect.width - 8);
  const top = Math.min(Math.max(8, anchor.top), window.innerHeight - rect.height - 8);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function showHighlightNote(editor: any, focusEditor = false) {
  if (!editor?.div) return;
  selectHighlight(editor);
  const note = getHighlightNote(editor);
  openHighlightNoteEditor = editor;
  highlightNoteTitle.textContent = note ? '高亮笔记' : '添加笔记';
  highlightNoteQuote.textContent = getHighlightText(editor);
  highlightNoteText.value = note;
  deleteHighlightNoteButton.hidden = !note;
  positionFloatingElement(highlightNotePopover, editor.div.getBoundingClientRect());
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
  selectedHighlightEditor.pdfHelperNote = text || '';
  selectedHighlightEditor._pdfHelperNote = text || '';
  const annotationId = getEditorAnnotationId(selectedHighlightEditor);
  const signature = getAnnotationGeometrySignature(getEditorSerializedValue(selectedHighlightEditor));
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
  setStatus(text ? '高亮笔记已保存。' : '高亮笔记已删除。');
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
  contextSelectionText = '';
  if (!selection || selection.isCollapsed || !viewerElement.contains(selection.anchorNode)) return;

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

function showSelectionContextMenuAt(clientX: number, clientY: number, editor: any | null) {
  contextHighlightEditor = editor;
  const isHighlightMenu = Boolean(editor);
  contextCopyButton.hidden = isHighlightMenu;
  contextCleanCopyButton.hidden = isHighlightMenu;
  contextColors.hidden = isHighlightMenu;
  highlightContextActions.hidden = false;
  contextDeleteHighlightButton.hidden = !isHighlightMenu;
  contextNoteButton.textContent = editor && getHighlightNote(editor) ? '编辑笔记' : '添加笔记';

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
    anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as Element | null);
  const textLayer = anchorElement?.closest<HTMLElement>('.textLayer');
  const pageElement = textLayer?.closest<HTMLElement>('.pdfViewer .page');
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!textLayer || !Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const pageIndex = pageNumber - 1;
  const editorsBefore = new Set(annotationEditor.getEditors(pageIndex));
  annotationEditor.unselectAll();
  selectedAnnotationEditor = null;
  selectedHighlightEditor = null;
  hideAnnotationActionBar();
  hideSelectionContextMenu();

  try {
    await annotationEditor.updateMode(AnnotationEditorType.HIGHLIGHT, null, true);
    if (!restoreContextSelection()) throw new Error('文字选区已经失效，请重新选择。');
    setHighlightColor(color);
    annotationEditor.highlightSelection('context_menu');
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
    setStatus('快速高亮创建失败，请重新选择文字后再试。', true);
    return null;
  }

  setStatus('高亮已创建，当前仍为移动/选择模式。');
  markUnsavedChanges();
  return createdEditor;
}

async function highlightCurrentSelectionFromToolbar() {
  saveContextSelection();

  if (!contextSelectionText.trim()) {
    setEditorMode(AnnotationEditorType.NONE);
    setStatus('请先用鼠标选中文字，再点击“高亮”。', true);
    return;
  }

  await createQuickHighlight(highlightColorInput.value);
}

function setEditorMode(mode: number) {
  if (!pdfDocument) return;
  pdfViewer.annotationEditorMode = { mode };
  activeEditorMode = mode;
  viewerElement.classList.toggle('pdf-helper-ink-mode', mode === AnnotationEditorType.INK);

  const modeNames: Record<string, number> = {
    select: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    ink: AnnotationEditorType.INK,
    text: AnnotationEditorType.FREETEXT,
  };

  for (const button of editorModeButtons) {
    button.classList.toggle('active', modeNames[button.dataset.editorMode || ''] === mode);
  }

  if (mode === AnnotationEditorType.NONE) {
    textStatus.textContent = '选择模式：拖选可复制；单击批注后拖动，双击文本可修改';
  } else if (mode === AnnotationEditorType.HIGHLIGHT) {
    textStatus.textContent = '高亮模式：拖选文字生成高亮；完成后切回“移动/选择”';
  } else if (mode === AnnotationEditorType.INK) {
    textStatus.textContent = '画笔模式：按住鼠标绘制；完成后切回“移动/选择”再移动';
  } else if (mode === AnnotationEditorType.FREETEXT) {
    textStatus.textContent = '文本模式：点击页面输入；点击空白结束，切回“移动/选择”可拖动';
  }
}

async function openPdf(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null = null,
  shouldConfirmUnsavedChanges = true,
) {
  if (shouldConfirmUnsavedChanges && pdfDocument && !confirmDiscardUnsavedChanges()) return;
  isOpeningDocument = true;
  cancelPendingAutomaticTranslation();
  cancelPendingSummaryGeneration();
  cancelPendingCardGeneration();
  translationAbortController?.abort();
  explanationAbortController?.abort();
  summaryAbortController?.abort();
  cardAbortController?.abort();
  cancelReadingPositionSave();
  currentRecentEntryId = null;
  pendingReadingPosition = null;
  isRestoringReadingPosition = false;
  clearInternalNavigationHistory();

  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = '正在建立文字层…';

  try {
    if (pdfDocument) {
      await pdfDocument.destroy();
      pdfDocument = null;
    }

    const rawPdfBytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
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
      fileHandle ? undefined : name.startsWith('http://') || name.startsWith('https://') ? name : undefined,
    );
    currentRecentEntryId = recentEntry?.id ?? null;
    pendingReadingPosition = recentEntry?.readingPosition ?? null;

    pdfViewer.setDocument(documentProxy);
    linkService.setDocument(documentProxy);
    findController.setDocument(documentProxy);
    selectedTextForAi = '';
    selectedTextPageNumber = 0;
    lastTranslatedText = '';
    lastExplainedText = '';
    selectedSnippetElement.textContent = '请在左侧 PDF 中选择文字';
    selectedSnippetElement.title = '';
    setTranslationState('选中英文后将自动翻译。');
    setExplanationState('选中英文后将自动生成解释。');
    resetChatConversation();
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
    clearOutlineList('打开 PDF 后显示目录');
    readingModeDocumentKey = '';
    readingModePreference = 'auto';
    resolvedReadingMode = 'general';
    readingModeRationale = '';
    readingModeError = '';
    updateReadingModeUi();
    resetSummaryState();
    resetCardState();
    sourceName = '';
    resetPaperCardPageState();
    documentNameElement.textContent = '打开失败';
    documentNameElement.title = '';
    updateControls();
    setStatus(error instanceof Error ? error.message : String(error), true);
    textStatus.textContent = 'PDF解析失败';
  }
}

function getDisplayFileName(source: string): string {
  try {
    const pathname = source.startsWith('http://') || source.startsWith('https://')
      ? new URL(source).pathname
      : source;
    return decodeURIComponent(pathname.split(/[\\/]/).pop() || source) || '未命名.pdf';
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

  eventBus.dispatch('find', {
    source: window,
    type: again ? 'again' : '',
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
  findCount.textContent = '0/0';
  eventBus.dispatch('findbarclose', { source: window });
  viewerContainer.focus();
}

eventBus.on('pagesinit', () => {
  restoreReadingPositionAfterPagesInit();
  setStatus(`${getDisplayFileName(sourceName)} · ${pdfDocument?.numPages ?? 0} 页`);
  setEditorMode(AnnotationEditorType.NONE);
  scheduleHighlightNoteIndicatorRefresh();
  updateControls();
});

eventBus.on('pagechanging', () => {
  updateControls();
  updateSummaryMetadata();
  scheduleReadingPositionSave();

  if (!summaryPanelElement.hidden && activeSummaryScope !== 'selection') {
    lastSummaryRequestKey = '';
    lastSummaryPoints = [];
    currentSummaryContext = null;
    scheduleSummaryGeneration();
  }

  if (!selectedTextForAi) updateCardSourceSnippet();
});
eventBus.on('scalechanging', () => {
  updateControls();
  scheduleReadingPositionSave();
});
eventBus.on(
  'updatefindmatchescount',
  ({ matchesCount }: { matchesCount?: { current?: number; total?: number } }) => {
    findCount.textContent = `${matchesCount?.current ?? 0}/${matchesCount?.total ?? 0}`;
  },
);
eventBus.on('annotationeditoruimanager', ({ uiManager }: { uiManager: AnnotationEditorUIManager }) => {
  annotationEditor = uiManager;
  installHighlightGeometry(uiManager);
  setHighlightColor(highlightColorInput.value);
  setFreeTextSize(getFreeTextSize());
  setFreeTextColor(freeTextColorInput.value);
  scheduleRestoredAnnotationEditorWarmUp();
  updateControls();
});
eventBus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => {
  activeEditorMode = mode;
  viewerElement.classList.toggle('pdf-helper-ink-mode', mode === AnnotationEditorType.INK);
  scheduleHighlightNoteIndicatorRefresh();
  updateControls();
});
eventBus.on('editorsrendered', ({ pageNumber }: { pageNumber: number }) => {
  scheduleHighlightNoteIndicatorRefresh(pageNumber);
  scheduleRestoredAnnotationEditorWarmUp();
});
eventBus.on('annotationeditorlayerrendered', ({ pageNumber }: { pageNumber: number }) => {
  scheduleHighlightNoteIndicatorRefresh(pageNumber);
  scheduleRestoredAnnotationEditorWarmUp();
});
eventBus.on('annotationlayerrendered', ({ pageNumber }: { pageNumber: number }) => {
  scheduleHighlightNoteIndicatorRefresh(pageNumber);
  scheduleRestoredAnnotationEditorWarmUp();
});
eventBus.on(
  'editingstateschanged',
  ({ details }: { details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean } }) => {
    canUndoAnnotation = Boolean(details.hasSomethingToUndo);
    canRedoAnnotation = Boolean(details.hasSomethingToRedo);
    scheduleUnsavedChangesCheck();
    updateControls();
  },
);


const toolbarMenus = Array.from(document.querySelectorAll<HTMLElement>('[data-toolbar-menu]'));

function setToolbarMenuOpen(menu: HTMLElement, open: boolean): void {
  const trigger = menu.querySelector<HTMLButtonElement>('.toolbar-menu-trigger');
  const panel = menu.querySelector<HTMLElement>('.toolbar-menu-panel');
  if (!trigger || !panel) return;

  menu.classList.toggle('open', open);
  trigger.setAttribute('aria-expanded', String(open));
  panel.hidden = !open;
}

function closeToolbarMenus(except?: HTMLElement): void {
  for (const menu of toolbarMenus) {
    if (menu !== except) setToolbarMenuOpen(menu, false);
  }
}

for (const menu of toolbarMenus) {
  const trigger = menu.querySelector<HTMLButtonElement>('.toolbar-menu-trigger');
  const panel = menu.querySelector<HTMLElement>('.toolbar-menu-panel');
  if (!trigger || !panel) continue;

  trigger.addEventListener('click', () => {
    const willOpen = panel.hidden;
    closeToolbarMenus(menu);
    setToolbarMenuOpen(menu, willOpen);
  });

  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest('button, label[role="menuitem"]');
    const isColorPicker = Boolean(target.closest('.highlight-color-control'));
    if (action && !isColorPicker) {
      window.setTimeout(() => setToolbarMenuOpen(menu, false), 0);
    }
  });
}

document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  if (!toolbarMenus.some((menu) => menu.contains(target))) closeToolbarMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeToolbarMenus();
  if (!assistantSettingsPanel.hidden) setDeepSeekSettingsOpen(false);
});

outlineToggleButton?.addEventListener('click', () => {
  setLeftPanelCollapsed(!appFrame?.classList.contains('left-panel-collapsed'));
});

aiPanelToggleButton?.addEventListener('click', () => {
  if (!paperCardPageElement.hidden) {
    closePaperCardPage();
    appFrame?.classList.remove('right-panel-collapsed');
    setAssistantView('chat');
    return;
  }
  const willOpen = appFrame?.classList.contains('right-panel-collapsed') ?? false;
  appFrame?.classList.toggle('right-panel-collapsed');
  if (willOpen) setAssistantView('chat');
});

focusModeButton.addEventListener('click', () => {
  setFocusMode(!appFrame?.classList.contains('focus-mode'));
});

for (const button of assistantViewButtons) {
  button.addEventListener('click', () => {
    const view = button.dataset.assistantView as AssistantView | undefined;
    if (view) setAssistantView(view);
  });
}

aiSettingsButton.addEventListener('click', () => {
  setDeepSeekSettingsOpen(assistantSettingsPanel.hidden);
});

readingModeSelect.addEventListener('change', () => {
  const preference = readingModeSelect.value;
  if (isReadingModePreference(preference)) void setReadingModePreference(preference);
});

detectReadingModeButton.addEventListener('click', () => {
  readingModePreference = 'auto';
  void detectReadingMode(true);
});

aiProviderSelect.addEventListener('change', () => {
  const providerId = aiProviderSelect.value as AiProviderId;
  const provider = AI_PROVIDERS.find((item) => item.id === providerId);
  if (!provider?.available) {
    aiProviderSelect.value = aiConfig.providerId;
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = '该模型供应商尚未接入。';
    return;
  }
  deepSeekBaseUrlInput.value = provider.defaultBaseUrl;
});

visionAiModeSelect.addEventListener('change', updateVisionAiFieldsVisibility);

closeDeepSeekSettingsButton.addEventListener('click', () => {
  setDeepSeekSettingsOpen(false);
});

saveDeepSeekSettingsButton.addEventListener('click', () => {
  void saveDeepSeekConfig().then((saved) => {
    if (!saved) return;

    setDeepSeekSettingsOpen(false);
    showSettingsSavedFeedback();

    if (pdfDocument && readingModePreference === 'auto') {
      void detectReadingMode(true);
    }
  });
});

testDeepSeekButton.addEventListener('click', () => {
  void testDeepSeekConnection();
});

testVisionAiButton.addEventListener('click', () => {
  void testVisionAiConnection();
});

deepSeekThinkingSelect.addEventListener('change', () => {
  aiConfig = {
    ...aiConfig,
    reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
  };
  if (aiConfigLoaded) void browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendChatMessage();
});

chatMessagesElement.addEventListener('click', (event) => {
  const citation = (event.target as Element | null)?.closest<HTMLButtonElement>(
    '.pdf-source-citation',
  );
  if (!citation) return;
  const pageNumber = Number(citation.dataset.pdfPage);
  const quote = citation.dataset.pdfQuote?.trim() ?? '';
  void jumpToPdfCitation(pageNumber, quote);
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void sendChatMessage();
});

function activateAiTab(tabName: string): void {
  for (const tab of aiTabButtons) {
    tab.classList.toggle('active', tab.dataset.aiTab === tabName);
  }
  for (const panel of aiTabPanels) {
    panel.hidden = panel.dataset.aiPanel !== tabName;
  }

  if (tabName === 'translate') {
    const text = selectedTextForAi || getViewerSelectionText();
    if (text) {
      selectedTextForAi = text;
      selectedSnippetElement.textContent = text;
      selectedSnippetElement.title = text;
      scheduleAutomaticTranslation(text);
    } else {
      setTranslationState('请先在 PDF 中选中需要翻译的原文。');
      setExplanationState('选中原文后将自动生成解释。');
    }
  } else if (tabName === 'summary') {
    updateSummaryMetadata();
    scheduleSummaryGeneration(0);
  } else if (tabName === 'cards') {
    updateCardSourceSnippet();
    scheduleCardGeneration(0);
  }
}

for (const button of aiTabButtons) {
  button.addEventListener('click', () => {
    const tabName = button.dataset.aiTab;
    if (tabName) activateAiTab(tabName);
  });
}

bindPaperCardTextareaAutoResize();

paperCardEntryButton?.addEventListener('click', openPaperCardPage);
knowledgeBaseEntryButton.addEventListener('click', openKnowledgeBasePage);
knowledgeBaseBackButton.addEventListener('click', closeKnowledgeBasePage);
for (const button of knowledgeModeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.knowledgeMode as KnowledgePageMode | undefined;
    if (mode) setKnowledgePageMode(mode);
  });
}
knowledgeResearchScopeSelect.addEventListener('change', updateKnowledgeResearchScopeSummary);
knowledgeSelectVisibleButton.addEventListener('click', () => {
  for (const item of getFilteredKnowledgeItems(collectKnowledgeItems())) {
    selectedKnowledgeResearchKeys.add(item.recordKey);
  }
  knowledgeResearchScopeSelect.value = 'selected';
  renderKnowledgeBase();
  setKnowledgePageMode(activeKnowledgePageMode === 'library' ? 'qa' : activeKnowledgePageMode);
});
knowledgeClearSelectionButton.addEventListener('click', () => {
  selectedKnowledgeResearchKeys.clear();
  renderKnowledgeBase();
});
for (const button of knowledgeQuestionPresetButtons) {
  button.addEventListener('click', () => {
    knowledgeResearchQuestionInput.value = button.dataset.knowledgeQuestion || '';
    knowledgeResearchQuestionInput.focus();
  });
}
for (const button of knowledgeInsightPresetButtons) {
  button.addEventListener('click', () => {
    activeKnowledgeInsightPrompt = button.dataset.knowledgeInsight || activeKnowledgeInsightPrompt;
    for (const candidate of knowledgeInsightPresetButtons) candidate.classList.toggle('active', candidate === button);
  });
}
knowledgeRunResearchButton.addEventListener('click', () => void runKnowledgeResearch());
knowledgeClearResearchButton.addEventListener('click', clearKnowledgeResearchResult);
knowledgeSaveResearchResultButton.addEventListener('click', saveKnowledgeResearchResult);
knowledgeResearchQuestionInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void runKnowledgeResearch();
});
knowledgeInsightQuestionInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void runKnowledgeResearch();
});
knowledgeRefreshButton.addEventListener('click', () => {
  setKnowledgePageStatus();
  renderKnowledgeBase();
});
knowledgeNewNoteButton.addEventListener('click', () => openKnowledgeEditor());
knowledgeImportButton.addEventListener('click', () => knowledgeImportInput.click());
knowledgeImportInput.addEventListener('change', () => {
  const file = knowledgeImportInput.files?.[0];
  if (file) void importKnowledgeNotes(file);
});
knowledgeSearchInput.addEventListener('input', renderKnowledgeBase);
knowledgeSortSelect.addEventListener('change', renderKnowledgeBase);

let appViewStateSaveTimer: number | undefined;
function scheduleAppViewStateSave(): void {
  if (appViewStateSaveTimer !== undefined) window.clearTimeout(appViewStateSaveTimer);
  appViewStateSaveTimer = window.setTimeout(() => {
    persistCurrentAppViewState();
    appViewStateSaveTimer = undefined;
  }, 160);
}

knowledgeMainElement.addEventListener('scroll', scheduleAppViewStateSave, { passive: true });
paperCardPageElement.addEventListener('scroll', scheduleAppViewStateSave, { passive: true });
knowledgeResearchQuestionInput.addEventListener('input', scheduleAppViewStateSave);
knowledgeInsightQuestionInput.addEventListener('input', scheduleAppViewStateSave);
knowledgeResearchScopeSelect.addEventListener('change', persistCurrentAppViewState);
knowledgeGroupSelect.addEventListener('change', renderKnowledgeBase);
knowledgeYearFilterSelect?.addEventListener('change', () => {
  activeKnowledgeYear = knowledgeYearFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeVenueFilterSelect?.addEventListener('change', () => {
  activeKnowledgeVenue = knowledgeVenueFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeReadingStatusFilterSelect?.addEventListener('change', () => {
  activeKnowledgeReadingStatus = knowledgeReadingStatusFilterSelect.value;
  renderKnowledgeBase();
});
knowledgePriorityFilterSelect?.addEventListener('change', () => {
  activeKnowledgePriority = knowledgePriorityFilterSelect.value;
  renderKnowledgeBase();
});
knowledgeClearFiltersButton?.addEventListener('click', () => {
  activeKnowledgeYear = 'all';
  activeKnowledgeVenue = 'all';
  activeKnowledgeReadingStatus = 'all';
  activeKnowledgePriority = 'all';
  activeKnowledgeCategory = 'all';
  activeKnowledgeTag = '';
  activeKnowledgeFocus = 'all';
  knowledgeSearchInput.value = '';
  if (knowledgeYearFilterSelect) knowledgeYearFilterSelect.value = 'all';
  if (knowledgeVenueFilterSelect) knowledgeVenueFilterSelect.value = 'all';
  if (knowledgeReadingStatusFilterSelect) knowledgeReadingStatusFilterSelect.value = 'all';
  if (knowledgePriorityFilterSelect) knowledgePriorityFilterSelect.value = 'all';
  renderKnowledgeBase();
});
for (const button of knowledgeFocusButtons) {
  button.addEventListener('click', () => {
    const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
    if (!focus) return;
    activeKnowledgeFocus = focus;
    renderKnowledgeBase();
  });
}
knowledgeBatchOrganizeButton?.addEventListener('click', () => {
  setKnowledgePageStatus('已切换到研究型知识库视图。后续可以继续扩展批量整理逻辑。');
});
for (const button of knowledgeFilterButtons) {
  button.addEventListener('click', () => {
    const filter = button.dataset.knowledgeFilter as KnowledgeFilter | undefined;
    if (filter) setKnowledgeFilter(filter);
  });
}
knowledgeDetailCloseButton.addEventListener('click', () => {
  selectedKnowledgeRecordKey = '';
  renderKnowledgeDetail([], undefined);
});
knowledgeOpenSourceButton.addEventListener('click', openSelectedKnowledgeSource);
knowledgeEditItemButton.addEventListener('click', () => {
  const item = getSelectedKnowledgeItem();
  if (!item) return;
  if (item.source === 'paper-overview') {
    openSavedPaperOverviewReview(item);
    return;
  }
  openKnowledgeEditor(item);
});
knowledgeDeleteItemButton.addEventListener('click', deleteSelectedKnowledgeItem);
knowledgeEditorCloseButton.addEventListener('click', closeKnowledgeEditor);
knowledgeEditorCancelButton.addEventListener('click', closeKnowledgeEditor);
knowledgeEditorDialog.addEventListener('pointerdown', (event) => {
  if (event.target === knowledgeEditorDialog) closeKnowledgeEditor();
});
knowledgeEditorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveKnowledgeEditor();
});
paperCardBackButton.addEventListener('click', () => closePaperCardPage(paperCardReturnTarget));
returnToPdfButton.addEventListener('click', () => closePaperCardPage('pdf'));
regeneratePaperCardButton.addEventListener('click', () => {
  paperCardPageDocumentKey = '';
  void generatePaperOverviewCard(true);
});
savePaperCardPageButton.addEventListener('click', savePaperOverviewCard);
exportPaperCardButton.addEventListener('click', exportPaperOverviewCard);

for (const button of summaryScopeButtons) {
  button.addEventListener('click', () => {
    const scope = button.dataset.summaryScope as SummaryScope | undefined;
    if (scope) setActiveSummaryScope(scope);
  });
}

for (const button of cardTypeButtons) {
  button.addEventListener('click', () => {
    const cardType = button.dataset.cardType as CardType | undefined;
    if (cardType) setActiveCardType(cardType);
  });
}

recentFilesButton.addEventListener('click', () => {
  showRecentFilesDialog();
});

closeRecentFilesButton.addEventListener('click', () => {
  hideRecentFilesDialog();
});

recentFilesDialog.addEventListener('pointerdown', (event) => {
  if (event.target === recentFilesDialog) hideRecentFilesDialog();
});

clearRecentFilesButton.addEventListener('click', async () => {
  await writeRecentFiles([]);
  await renderRecentFiles();
});

openFileButton.addEventListener('click', async (event) => {
  event.preventDefault();
  if (pdfDocument && !confirmDiscardUnsavedChanges()) return;

  const pickerWindow = window as FilePickerWindow;
  if (typeof pickerWindow.showOpenFilePicker === 'function') {
    try {
      const [fileHandle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'PDF 文件',
            accept: {
              'application/pdf': ['.pdf'],
            },
          },
        ],
      });

      if (!fileHandle) return;
      const file = await fileHandle.getFile();
      await openPdf(await file.arrayBuffer(), file.name, fileHandle, false);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('File System Access API 打开失败，降级到普通文件选择。', error);
    }
  }

  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await openPdf(await file.arrayBuffer(), file.name, null, false);
  fileInput.value = '';
});

previousButton.addEventListener('click', () => {
  if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1;
});

nextButton.addEventListener('click', () => {
  if (pdfDocument && pdfViewer.currentPageNumber < pdfDocument.numPages) {
    pdfViewer.currentPageNumber += 1;
  }
});

pageNumberInput.addEventListener('change', () => {
  const page = Number(pageNumberInput.value);
  if (pdfDocument && Number.isInteger(page) && page >= 1 && page <= pdfDocument.numPages) {
    pdfViewer.currentPageNumber = page;
  } else {
    updateControls();
  }
});

zoomOutButton.addEventListener('click', () => {
  pdfViewer.currentScale = Math.max(0.25, pdfViewer.currentScale / 1.1);
});

zoomInButton.addEventListener('click', () => {
  pdfViewer.currentScale = Math.min(5, pdfViewer.currentScale * 1.1);
});

findBar.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(false, true);
});

findInput.addEventListener('input', () => runSearch(false, false));
findPreviousButton.addEventListener('click', () => runSearch(true, true));
findNextButton.addEventListener('click', () => runSearch(false, true));
findCloseButton.addEventListener('click', closeFindBar);

for (const button of editorModeButtons) {
  button.addEventListener('pointerdown', () => {
    if (button.dataset.editorMode === 'highlight') saveContextSelection();
  });

  button.addEventListener('click', () => {
    const mode = button.dataset.editorMode;
    if (mode === 'select') setEditorMode(AnnotationEditorType.NONE);
    if (mode === 'highlight') {
      void highlightCurrentSelectionFromToolbar();
      return;
    }
    if (mode === 'ink') setEditorMode(AnnotationEditorType.INK);
    if (mode === 'text') setEditorMode(AnnotationEditorType.FREETEXT);
  });
}

highlightColorInput.addEventListener('input', () => {
  setHighlightColor(highlightColorInput.value);
});

freeTextColorInput.addEventListener('input', () => {
  setFreeTextColor(freeTextColorInput.value);
});

freeTextSizeInput.addEventListener('change', () => {
  setFreeTextSize(getFreeTextSize());
});

freeTextSizeDownButton.addEventListener('click', () => {
  setFreeTextSize(getFreeTextSize() - 2);
});

freeTextSizeUpButton.addEventListener('click', () => {
  setFreeTextSize(getFreeTextSize() + 2);
});

selectionContextMenu.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

for (const button of quickHighlightButtons) {
  button.addEventListener('click', () => {
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

contextCopyButton.addEventListener('click', async () => {
  if (!contextSelectionText) return;
  await navigator.clipboard.writeText(contextSelectionText);
  setStatus(`已复制 ${contextSelectionText.length.toLocaleString('zh-CN')} 个字符。`);
  hideSelectionContextMenu();
});

contextCleanCopyButton.addEventListener('click', async () => {
  if (!contextSelectionText) return;
  const text = normalizeCopiedText(contextSelectionText);
  await navigator.clipboard.writeText(text);
  setStatus(`已整理并复制 ${text.length.toLocaleString('zh-CN')} 个字符。`);
  hideSelectionContextMenu();
});

contextNoteButton.addEventListener('click', () => {
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

contextDeleteHighlightButton.addEventListener('click', () => {
  if (!contextHighlightEditor) return;
  selectHighlight(contextHighlightEditor);
  deleteSelectedHighlight();
});

viewerElement.addEventListener(
  'pointerdown',
  (event) => {
    if (
      event.button !== 0 ||
      !pdfDocument ||
      !isTextSelectionMode() ||
      isEditableOrControl(event.target)
    ) {
      return;
    }

    const directAnnotation = findAnnotationEditor(event.target, { includeHighlight: false });
    if (directAnnotation && !isHighlightEditor(directAnnotation)) return;

    const pointHighlight = findAnnotationEditorAtPoint(event.clientX, event.clientY, {
      highlightOnly: true,
    });
    if (pointHighlight) return;

    if (isPointInsideTextGlyph(event.clientX, event.clientY)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearDomSelection();
    clearSelectedAnnotationState();
  },
  { capture: true },
);

viewerElement.addEventListener('contextmenu', (event) => {
  if (isInkMode()) return;

  saveContextSelection();
  if (contextSelectionText && annotationEditor && isPointInsideSavedSelection(event.clientX, event.clientY)) {
    event.preventDefault();
    showSelectionContextMenuAt(event.clientX, event.clientY, null);
    return;
  }

  const highlightEditor = findAnnotationEditorAtPoint(event.clientX, event.clientY, {
    highlightOnly: true,
  });
  if (highlightEditor) {
    event.preventDefault();
    selectHighlight(highlightEditor);
    showSelectionContextMenuAt(event.clientX, event.clientY, highlightEditor);
    return;
  }

  const annotation =
    findAnnotationEditor(event.target, { includeHighlight: false }) ??
    findAnnotationEditorAtPoint(event.clientX, event.clientY, { includeHighlight: false });

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

viewerElement.addEventListener('pointerdown', (event) => {
  if (isInkMode()) return;

  lastPointerDown = {
    x: event.clientX,
    y: event.clientY,
    button: event.button,
  };

  const editor = findAnnotationEditor(event.target, { includeHighlight: false });
  if (editor) {
    selectAnnotation(editor, false);
    hideAnnotationActionBar();
    return;
  }

  const pointHighlight =
    event.button === 0
      ? findAnnotationEditorAtPoint(event.clientX, event.clientY, { highlightOnly: true })
      : null;
  if (pointHighlight) return;

  clearSelectedAnnotationState();
});

viewerElement.addEventListener('click', (event) => {
  if (isInkMode()) return;

  if (lastPointerDown?.button !== 0) return;
  const moved =
    !lastPointerDown ||
    Math.hypot(event.clientX - lastPointerDown.x, event.clientY - lastPointerDown.y) > 4;
  if (moved) return;

  const editor =
    findAnnotationEditorAtPoint(event.clientX, event.clientY, { highlightOnly: true }) ??
    findAnnotationEditor(event.target, { includeHighlight: false }) ??
    findAnnotationEditorAtPoint(event.clientX, event.clientY, { includeHighlight: false });
  if (!editor) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    return;
  }

  clearDomSelection();
  selectAnnotation(editor);
  if (isHighlightEditor(editor) && getHighlightNote(editor)) toggleHighlightNote(editor);
});

document.addEventListener('pointerdown', (event) => {
  if (isInkMode()) return;

  const annotationAtPoint =
    event instanceof PointerEvent
      ? findAnnotationEditorAtPoint(event.clientX, event.clientY, { highlightOnly: true })
      : null;
  if (!selectionContextMenu.contains(event.target as Node)) hideSelectionContextMenu();
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

annotationActionBar.addEventListener('pointerdown', (event) => event.stopPropagation());
deleteAnnotationButton.addEventListener('click', deleteSelectedAnnotation);

highlightNotePopover.addEventListener('pointerdown', (event) => event.stopPropagation());
closeHighlightNoteButton.addEventListener('click', hideHighlightNote);
saveHighlightNoteButton.addEventListener('click', saveHighlightNote);
deleteHighlightNoteButton.addEventListener('click', () => {
  highlightNoteText.value = '';
  saveHighlightNote();
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const isEditingText =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    Boolean(target?.isContentEditable);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && pdfDocument) {
    event.preventDefault();
    event.stopPropagation();
    void saveAnnotatedPdf();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && pdfDocument) {
    event.preventDefault();
    event.stopPropagation();
    openFindBar();
    return;
  }
  if (event.key === 'Escape' && !recentFilesDialog.hidden) {
    event.preventDefault();
    hideRecentFilesDialog();
    return;
  }
  if (event.key === 'Escape' && !findBar.hidden) {
    event.preventDefault();
    closeFindBar();
    return;
  }
  if (event.key === 'Delete' && selectedAnnotationEditor && !isEditingText) {
    event.preventDefault();
    event.stopPropagation();
    deleteSelectedAnnotation();
  }
}, true);

undoAnnotationButton.addEventListener('click', () => annotationEditor?.undo());
redoAnnotationButton.addEventListener('click', () => annotationEditor?.redo());

smartCopyButton.addEventListener('click', async () => {
  const text = getViewerSelectionText();
  if (!text) {
    setStatus('请先在PDF中选择要复制的文字。', true);
    return;
  }

  await navigator.clipboard.writeText(text);
  setStatus(`已整理并复制 ${text.length.toLocaleString('zh-CN')} 个字符。`);
});

smartCopyButton.addEventListener('mousedown', (event) => {
  // Keep the PDF selection active while the toolbar button is pressed.
  event.preventDefault();
});

document.addEventListener(
  'copy',
  (event) => {
    const text = getViewerSelectionRawText();
    if (!text || !event.clipboardData) return;

    // PDF.js annotation editing captures every copy event. Text selections
    // must be handled first so normal Ctrl+C still behaves like a reader.
    event.stopImmediatePropagation();
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    setStatus(`已复制 ${text.length.toLocaleString('zh-CN')} 个字符。`);
  },
  { capture: true },
);

saveTranslationNoteButton.addEventListener('click', saveTranslationAndExplanationAsNote);

copyTranslationButton.addEventListener('click', async () => {
  const translation = translationResultElement.textContent?.trim() ?? '';
  if (!translation || translation.includes('自动翻译') || translation.startsWith('正在自动翻译')) {
    setTranslationState('当前没有可复制的翻译结果。', true);
    return;
  }

  await navigator.clipboard.writeText(translation);
  setStatus(`已复制 ${translation.length.toLocaleString('zh-CN')} 个中文字符。`);
});

copySummaryButton.addEventListener('click', async () => {
  if (lastSummaryPoints.length === 0) {
    setStatus('当前没有可复制的总结要点。', true);
    return;
  }

  const text = lastSummaryPoints.map((point) => `• ${point}`).join('\n');
  await navigator.clipboard.writeText(text);
  setStatus(`已复制 ${lastSummaryPoints.length} 条总结要点。`);
});

saveSummaryNoteButton.addEventListener('click', saveCurrentSummaryAsNote);

copyCardButton.addEventListener('click', async () => {
  if (!currentCardContext || !currentGeneratedCard) {
    setStatus('当前没有可复制的论文卡片。', true);
    return;
  }

  await navigator.clipboard.writeText(
    formatGeneratedCardText(currentCardContext, currentGeneratedCard),
  );
  setStatus(`已复制“${currentGeneratedCard.title}”论文卡片。`);
});

saveCardButton.addEventListener('click', saveCurrentPaperCard);

document.addEventListener('selectionchange', () => {
  scheduleCustomSelectionRender();
  scheduleAiSelectedSnippetUpdate();
});

viewerElement.addEventListener('pointerdown', () => {
  // 开始新一轮拖选时，停止旧选区尚未发出的 AI 请求。
  cancelPendingAutomaticTranslation();
  translationAbortController?.abort();
  explanationAbortController?.abort();
  if (activeSummaryScope === 'selection') {
    cancelPendingSummaryGeneration();
    summaryAbortController?.abort();
  }
  cancelPendingCardGeneration();
  cardAbortController?.abort();
});

viewerElement.addEventListener('pointerup', () => scheduleAiSelectedSnippetUpdate());
viewerElement.addEventListener('keyup', () => scheduleAiSelectedSnippetUpdate());
citationReturnButton.addEventListener('click', returnToPreviousInternalNavigationPosition);
viewerContainer.addEventListener('scroll', scheduleCustomSelectionRender, { passive: true });
viewerContainer.addEventListener(
  'scroll',
  () => {
    scheduleReadingPositionSave();
    hideSelectionContextMenu();
    hideHighlightNote();
    hideAnnotationActionBar();
  },
  { passive: true },
);
window.addEventListener('resize', scheduleCustomSelectionRender);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    cancelReadingPositionSave();
    void persistCurrentReadingPosition();
    persistCurrentAppViewState();
  }
});
window.addEventListener('beforeunload', (event) => {
  cancelReadingPositionSave();
  void persistCurrentReadingPosition();
  persistCurrentAppViewState();
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = '';
});

async function saveAnnotatedPdf(): Promise<boolean> {
  if (!pdfDocument || isSavingAnnotatedPdf) return false;
  isSavingAnnotatedPdf = true;

  try {
    setStatus('正在把 PDF Helper 批注嵌入 PDF…');
    const { bytes, count } = await embedHelperAnnotationsIntoPdf();
    const result = await writeEmbeddedPdfBytes(bytes);
    sourcePdfBytes = new Uint8Array(bytes);
    markSavedChanges();
    if (result === 'overwritten') {
      setStatus(`批注已嵌入当前 PDF（${count} 条）。`);
    } else if (result === 'permission-denied-downloaded') {
      setStatus(`未获得覆盖原文件的写入权限，已下载带 PDF Helper 数据的新 PDF（${count} 条）。`);
    } else {
      setStatus(`当前打开方式不能覆盖原文件，已下载带 PDF Helper 数据的新 PDF（${count} 条）。`);
    }
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    isSavingAnnotatedPdf = false;
  }
}

saveAnnotatedPdfButton.addEventListener('click', () => {
  void saveAnnotatedPdf();
});

toggleNotesButton.addEventListener('click', () => {
  areNoteIndicatorsHidden = !areNoteIndicatorsHidden;
  updateNoteIndicatorsVisibility();
});

updateNoteIndicatorsVisibility();
clearOutlineList('打开 PDF 后显示目录');
setLeftPanelCollapsed(false);
updateControls();
updateReadingModeUi();
void loadDeepSeekConfig();
textStatus.textContent = '交互已就绪';
restoreAppViewAfterRefresh();

const source = new URLSearchParams(window.location.search).get('src');
if (source?.startsWith('http://') || source?.startsWith('https://')) {
  void openRemotePdf(source);
}
