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
  buildAiSystemContent,
  isMainAiVisionCapable,
  isVisionAiConfigured,
  normalizeAiBaseUrl,
  type AiConfig,
  type AiConversationMessage,
  type AiImageAttachment,
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
import {
  createDocumentAgentId,
  type DocumentAgentRecord,
  type DocumentAgentSession,
  type DocumentChunk,
} from '../../shared/document-agent';
import {
  getDocumentVisionCacheEntry,
  getLatestDocumentSession,
  putDocumentVisionCacheEntry,
  putDocumentSession,
} from './document-agent-store';
import {
  buildDocumentRetrievalContext,
  initializeDocumentKnowledge,
} from './document-agent-runtime';

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
const recentFilesPanelElement = recentFilesDialog.querySelector<HTMLElement>('.recent-files-panel');
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
const focusReadingToggleButton = requiredElement<HTMLButtonElement>('focus-reading-toggle');
const focusReadingLabel = requiredElement<HTMLElement>('focus-reading-label');
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
const readingModeSelect = requiredElement<HTMLSelectElement>('reading-mode-select');
const detectReadingModeButton = requiredElement<HTMLButtonElement>('detect-reading-mode');
const readingModeStatus = requiredElement<HTMLElement>('reading-mode-status');
const aiSettingsButton = requiredElement<HTMLButtonElement>('ai-settings-button');
const paperCardEntryButton = document.getElementById('paper-card-entry');
const paperCardPageElement = requiredElement<HTMLElement>('paper-card-page');
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
const paperOneSentenceSummaryInput = requiredElement<HTMLTextAreaElement>('paper-one-sentence-summary');
const paperResearchProblemInput = requiredElement<HTMLTextAreaElement>('paper-research-problem');
const paperCoreInnovationInput = requiredElement<HTMLTextAreaElement>('paper-core-innovation');
const paperMethodOverviewInput = requiredElement<HTMLTextAreaElement>('paper-method-overview');
const paperDatasetsInput = requiredElement<HTMLTextAreaElement>('paper-datasets');
const paperMetricsInput = requiredElement<HTMLTextAreaElement>('paper-metrics');
const paperMainFindingsInput = requiredElement<HTMLTextAreaElement>('paper-main-findings');
const paperLimitationsInput = requiredElement<HTMLTextAreaElement>('paper-limitations');
const paperReadingStatusInput = requiredElement<HTMLSelectElement>('paper-reading-status');
const paperRecommendDeepReadingInput = requiredElement<HTMLSelectElement>('paper-recommend-deep-reading');
const paperCitationPointsInput = requiredElement<HTMLTextAreaElement>('paper-citation-points');
const paperPersonalNotesInput = requiredElement<HTMLTextAreaElement>('paper-personal-notes');
const assistantViewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-assistant-view]'),
);
const assistantTabsElement = document.querySelector<HTMLElement>('.assistant-tabs');
const assistantChatPanel = requiredElement<HTMLElement>('assistant-chat-panel');
const assistantSettingsPanel = requiredElement<HTMLElement>('assistant-settings-panel');
const assistantToolsRuntime = requiredElement<HTMLElement>('assistant-tools-runtime');
const closeDeepSeekSettingsButton = requiredElement<HTMLButtonElement>('close-deepseek-settings');
const chatContextPreview = requiredElement<HTMLElement>('chat-context-preview');
const chatMessagesElement = requiredElement<HTMLElement>('chat-messages');
const chatForm = requiredElement<HTMLFormElement>('chat-form');
const chatInput = requiredElement<HTMLTextAreaElement>('chat-input');
const chatAttachmentsElement = requiredElement<HTMLElement>('chat-attachments');
const chatImageInput = requiredElement<HTMLInputElement>('chat-image-input');
const chatImageButton = requiredElement<HTMLButtonElement>('chat-image-button');
const chatSendButton = requiredElement<HTMLButtonElement>('chat-send');
const clearChatButton = requiredElement<HTMLButtonElement>('clear-chat');
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
const readerCardElement = document.querySelector<HTMLElement>('.reader-card');

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
let isInternalNavigationInProgress = false;
let internalNavigationReturnCheckAvailableAt = 0;
let internalNavigationReturnCheckTimer: number | null = null;
const internalNavigationHistory: InternalNavigationEntry[] = [];
const bibliographyBacklinkCache = new Map<
  string,
  Promise<PdfBodyCitationTarget | null>
>();
let focusReadingModeRequested = false;
let focusReadingAnimation: Animation | null = null;
let workspaceLayoutAnimation: Animation | null = null;
let recentFilesTransitionToken = 0;
let paperCardPageTransitionToken = 0;
const activeUiAnimations = new WeakMap<HTMLElement, Animation>();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const UI_MOTION_DURATION = 340;
const UI_MOTION_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const outlineButtonsByPage = new Map<number, HTMLButtonElement[]>();
let activeOutlineButtons: HTMLButtonElement[] = [];
let activeOutlinePageNumber = 0;
interface OutlinePageItem {
  pageNumber: number;
  title: string;
  depth: number;
  order: number;
}

let outlinePageItemsCache: OutlinePageItem[] | null = null;
let outlineUsesPageFallback = false;
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

function playUiAnimation(
  element: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions = {},
): Animation | null {
  if (!element || prefersReducedMotion.matches) return null;

  activeUiAnimations.get(element)?.cancel();
  const animation = element.animate(keyframes, {
    duration: UI_MOTION_DURATION,
    easing: UI_MOTION_EASING,
    ...options,
  });
  activeUiAnimations.set(element, animation);
  const clearAnimation = () => {
    if (activeUiAnimations.get(element) === animation) activeUiAnimations.delete(element);
  };
  animation.addEventListener('finish', clearAnimation, { once: true });
  animation.addEventListener('cancel', clearAnimation, { once: true });
  return animation;
}

function waitForUiAnimation(animation: Animation | null): Promise<void> {
  if (!animation) return Promise.resolve();
  return animation.finished.then(() => undefined).catch(() => undefined);
}

function revealUiElement(element: HTMLElement | null, direction = 1): Animation | null {
  return playUiAnimation(
    element,
    [
      {
        opacity: 0.18,
        transform: `translate3d(${direction * 12}px, 5px, 0) scale(0.985)`,
      },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ],
    { fill: 'none' },
  );
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
  const transitionToken = ++recentFilesTransitionToken;
  recentFilesDialog.hidden = false;
  recentFilesDialog.setAttribute('aria-hidden', 'false');
  playUiAnimation(
    recentFilesDialog,
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 220, easing: 'ease-out' },
  );
  revealUiElement(recentFilesPanelElement, 0);

  void renderRecentFiles().then(() => {
    if (transitionToken !== recentFilesTransitionToken || recentFilesDialog.hidden) return;
    const items = Array.from(recentFilesList.querySelectorAll<HTMLElement>('.recent-file-item'));
    for (const [index, item] of items.entries()) {
      playUiAnimation(
        item,
        [
          { opacity: 0, transform: 'translate3d(0, 8px, 0) scale(0.985)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 280, delay: Math.min(index, 7) * 24 },
      );
    }
  });
}

async function hideRecentFilesDialog() {
  if (recentFilesDialog.hidden) return;
  const transitionToken = ++recentFilesTransitionToken;
  recentFilesDialog.setAttribute('aria-hidden', 'true');
  const backdropAnimation = playUiAnimation(
    recentFilesDialog,
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 170, easing: 'ease-in' },
  );
  const panelAnimation = playUiAnimation(
    recentFilesPanelElement,
    [
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      { opacity: 0, transform: 'translate3d(0, -8px, 0) scale(0.98)' },
    ],
    { duration: 180, easing: 'ease-in' },
  );
  await Promise.all([waitForUiAnimation(backdropAnimation), waitForUiAnimation(panelAnimation)]);
  if (transitionToken === recentFilesTransitionToken) recentFilesDialog.hidden = true;
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
  hasDepartedOrigin: boolean;
};

type PdfBodyCitationTarget = {
  pageNumber: number;
  rect: [number, number, number, number];
  destinationName: string;
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

function animateWorkspaceLayoutChange(mutateLayout: () => void): void {
  if (!appFrame || !readerCardElement || prefersReducedMotion.matches) {
    mutateLayout();
    return;
  }

  focusReadingAnimation?.cancel();
  focusReadingAnimation = null;
  workspaceLayoutAnimation?.cancel();
  workspaceLayoutAnimation = null;
  readerCardElement.classList.remove('focus-layout-animating', 'workspace-layout-animating');
  appFrame.classList.remove('focus-layout-changing', 'workspace-layout-changing');

  const firstRect = readerCardElement.getBoundingClientRect();
  appFrame.classList.add('workspace-layout-changing');
  mutateLayout();
  const lastRect = readerCardElement.getBoundingClientRect();

  if (
    firstRect.width <= 0
    || firstRect.height <= 0
    || lastRect.width <= 0
    || lastRect.height <= 0
  ) {
    appFrame.classList.remove('workspace-layout-changing');
    return;
  }

  const deltaX = firstRect.left - lastRect.left;
  const deltaY = firstRect.top - lastRect.top;
  const scaleX = firstRect.width / lastRect.width;
  const scaleY = firstRect.height / lastRect.height;
  if (
    Math.abs(deltaX) < 0.5
    && Math.abs(deltaY) < 0.5
    && Math.abs(scaleX - 1) < 0.002
    && Math.abs(scaleY - 1) < 0.002
  ) {
    appFrame.classList.remove('workspace-layout-changing');
    return;
  }

  readerCardElement.classList.add('workspace-layout-animating');
  const animation = readerCardElement.animate(
    [
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
      },
      { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
    ],
    { duration: UI_MOTION_DURATION, easing: UI_MOTION_EASING },
  );
  workspaceLayoutAnimation = animation;

  const finishLayoutChange = () => {
    if (workspaceLayoutAnimation !== animation) return;
    workspaceLayoutAnimation = null;
    readerCardElement.classList.remove('workspace-layout-animating');
    appFrame.classList.remove('workspace-layout-changing');
    if (contextSelectionRanges.length > 0) scheduleCustomSelectionRender();
  };
  animation.addEventListener('finish', finishLayoutChange, { once: true });
  animation.addEventListener('cancel', finishLayoutChange, { once: true });
}

function setLeftPanelCollapsed(collapsed: boolean) {
  const isCollapsed = appFrame?.classList.contains('left-panel-collapsed') ?? collapsed;
  if (isCollapsed !== collapsed) {
    animateWorkspaceLayoutChange(() => appFrame?.classList.toggle('left-panel-collapsed', collapsed));
  }
  outlineToggleButton?.classList.toggle('active', !collapsed);
}

function setRightPanelCollapsed(collapsed: boolean) {
  const isCollapsed = appFrame?.classList.contains('right-panel-collapsed') ?? collapsed;
  if (isCollapsed !== collapsed) {
    animateWorkspaceLayoutChange(() => appFrame?.classList.toggle('right-panel-collapsed', collapsed));
  }
  aiPanelToggleButton?.classList.toggle('active', !collapsed);
}

function setFocusReadingMode(enabled: boolean) {
  if (!appFrame) return;

  focusReadingModeRequested = enabled;
  focusReadingToggleButton.setAttribute('aria-pressed', String(enabled));
  focusReadingToggleButton.title = enabled
    ? '退出专注阅读（Esc）'
    : '收起顶部工具栏和左侧目录';
  focusReadingLabel.textContent = enabled ? '退出专注' : '专注阅读';

  // Finish an interrupted transition first, then use FLIP for the next one. The
  // grid changes only once; the expensive PDF/text layers are animated by the
  // compositor instead of being resized on every animation frame.
  focusReadingAnimation?.cancel();
  focusReadingAnimation = null;
  workspaceLayoutAnimation?.cancel();
  workspaceLayoutAnimation = null;
  readerCardElement?.classList.remove('focus-layout-animating', 'workspace-layout-animating');
  appFrame.classList.remove('focus-layout-changing', 'workspace-layout-changing');

  const firstRect = readerCardElement?.getBoundingClientRect();
  appFrame.classList.add('focus-layout-changing');
  appFrame.classList.toggle('focus-reading-mode', enabled);

  if (!readerCardElement || !firstRect || firstRect.width <= 0 || firstRect.height <= 0) {
    appFrame.classList.remove('focus-layout-changing');
    return;
  }

  const lastRect = readerCardElement.getBoundingClientRect();
  if (lastRect.width <= 0 || lastRect.height <= 0) {
    appFrame.classList.remove('focus-layout-changing');
    return;
  }

  const deltaX = firstRect.left - lastRect.left;
  const deltaY = firstRect.top - lastRect.top;
  const scaleX = firstRect.width / lastRect.width;
  const scaleY = firstRect.height / lastRect.height;

  if (
    Math.abs(deltaX) < 0.5
    && Math.abs(deltaY) < 0.5
    && Math.abs(scaleX - 1) < 0.002
    && Math.abs(scaleY - 1) < 0.002
  ) {
    appFrame.classList.remove('focus-layout-changing');
    return;
  }

  readerCardElement.classList.add('focus-layout-animating');
  const animation = readerCardElement.animate(
    [
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
      },
      { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
    ],
    {
      duration: UI_MOTION_DURATION,
      easing: UI_MOTION_EASING,
    },
  );
  focusReadingAnimation = animation;

  const finishLayoutChange = () => {
    if (focusReadingAnimation !== animation) return;
    focusReadingAnimation = null;
    readerCardElement.classList.remove('focus-layout-animating');
    appFrame.classList.remove('focus-layout-changing');
    if (contextSelectionRanges.length > 0) scheduleCustomSelectionRender();
  };

  animation.addEventListener('finish', finishLayoutChange, { once: true });
  animation.addEventListener('cancel', finishLayoutChange, { once: true });
}

function resetOutlineIndex() {
  for (const button of activeOutlineButtons) button.classList.remove('active');
  outlineButtonsByPage.clear();
  activeOutlineButtons = [];
  activeOutlinePageNumber = 0;
  outlinePageItemsCache = null;
}

function registerOutlineButton(button: HTMLButtonElement, pageNumber: number) {
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) return;
  button.dataset.outlinePage = String(pageNumber);
  const pageButtons = outlineButtonsByPage.get(pageNumber) ?? [];
  pageButtons.push(button);
  outlineButtonsByPage.set(pageNumber, pageButtons);
  outlinePageItemsCache = null;

  if (pageNumber === (pdfViewer.currentPageNumber || 0)) {
    button.classList.add('active');
    activeOutlineButtons.push(button);
    activeOutlinePageNumber = pageNumber;
  }
}

function updateOutlineActivePage() {
  if (!outlineList) return;
  const currentPage = pdfViewer.currentPageNumber || 0;
  if (currentPage === activeOutlinePageNumber) return;

  for (const button of activeOutlineButtons) button.classList.remove('active');
  activeOutlineButtons = outlineButtonsByPage.get(currentPage) ?? [];
  for (const button of activeOutlineButtons) button.classList.add('active');
  activeOutlinePageNumber = currentPage;
}

function clearOutlineList(message: string) {
  if (!outlineList) return;
  resetOutlineIndex();
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
  button.dataset.outlineDepth = String(depth);
  if (pageNumber) registerOutlineButton(button, pageNumber);
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
    button.dataset.outlineDepth = String(depth);
    button.addEventListener('click', () => {
      if (item.dest) void navigateToDestinationWithoutReturnHistory(item.dest);
    });
    outlineList?.appendChild(button);

    if (item.dest) {
      void getDestinationPageNumber(documentProxy, item.dest).then((pageNumber) => {
        if (!pageNumber || pdfDocument !== documentProxy) return;
        registerOutlineButton(button, pageNumber);
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
  resetOutlineIndex();
  outlineUsesPageFallback = false;
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
  resetOutlineIndex();
  outlineUsesPageFallback = true;
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

const PAPER_CARD_API_URL = 'http://127.0.0.1:8000/api/generate-paper-card';
const AUTO_TRANSLATE_DELAY_MS = 700;
// Provider messages are capped at 16,000 characters in the background adapter.
// Keep the source below that limit so the page markers shown in the audit log
// match the text that the model actually receives.
const MAX_SUMMARY_SOURCE_LENGTH = 14_000;
const MAX_CARD_SOURCE_LENGTH = 12_000;
const MAX_PROVIDER_MESSAGE_LENGTH = 16_000;
const MAX_PROVIDER_CONVERSATION_MESSAGES = 16;
const MAX_PAPER_CARD_SOURCE_LENGTH = 55_000;
const SUMMARY_NOTES_STORAGE_KEY = 'pdf-helper-summary-notes-v1';
const SAVED_CARDS_STORAGE_KEY = 'pdf-helper-saved-cards-v1';
const SAVED_PAPER_OVERVIEWS_STORAGE_KEY = 'pdf-helper-paper-overviews-v1';

type SummaryScope = 'selection' | 'page' | 'chapter';
type SelectionSummaryKind = 'fragment' | 'sentence' | 'paragraph';
type CardType = 'concept' | 'method' | 'experiment' | 'viewpoint';

interface SummaryContext {
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  text: string;
  targetText?: string;
  contextText?: string;
  selectionKind?: SelectionSummaryKind;
  sourcePages: number[];
  sourceTruncated?: boolean;
  chapterBoundaryMatched?: boolean;
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
  one_sentence_summary?: unknown;
  research_problem?: unknown;
  core_innovation?: unknown;
  method_overview?: unknown;
  datasets?: unknown;
  metrics?: unknown;
  main_findings?: unknown;
  limitations?: unknown;
  reading_status?: unknown;
  recommend_deep_reading?: unknown;
  citation_points?: unknown;
  detail?: unknown;
}

interface PaperCardFormData {
  title: string;
  authors: string;
  venueYear: string;
  researchArea: string;
  oneSentenceSummary: string;
  researchProblem: string;
  coreInnovation: string;
  methodOverview: string;
  datasets: string;
  metrics: string;
  mainFindings: string;
  limitations: string;
  readingStatus: string;
  recommendDeepReading: string;
  citationPoints: string;
  personalNotes: string;
}

interface SavedPaperOverview extends PaperCardFormData {
  id: string;
  documentName: string;
  createdAt: string;
}

let aiSelectionUpdateFrame = 0;
let selectedTextForAi = '';
let selectedTextPageNumber = 0;
let summarySelectionText = '';
let summarySelectionPageNumber = 0;
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
let aiConfig: AiConfig = { ...DEFAULT_AI_CONFIG };
let aiConfigLoaded = false;
let visionAiConfig: VisionAiConfig = { ...DEFAULT_VISION_AI_CONFIG };
let chatHistory: AiConversationMessage[] = [];
let chatRequestPending = false;
let pendingChatImages: AiImageAttachment[] = [];
let activePdfCitationLayer: HTMLElement | null = null;
let activePdfCitationTimer: number | null = null;
let currentDocumentAgentId = '';
let currentDocumentAgentRecord: DocumentAgentRecord | null = null;
let currentDocumentChunks: DocumentChunk[] = [];
let currentDocumentSessionCreatedAt = 0;
let documentAgentStatusText = '';
let documentAgentOperationToken = 0;
let readingModePreference: ReadingModePreference = 'auto';
let resolvedReadingMode: ResolvedReadingMode = 'general';
let readingModeDetectionPending = false;
let readingModeDocumentKey = '';
let readingModeRationale = '';
let readingModeError = '';
type AssistantView = 'chat' | 'translate' | 'summary' | 'cards';
const ASSISTANT_VIEW_ORDER: AssistantView[] = ['chat', 'translate', 'summary', 'cards'];
let activeAssistantView: AssistantView = 'chat';
let assistantSettingsOpen = false;
let assistantSettingsTransitionToken = 0;

function setAssistantView(view: AssistantView): void {
  const previousView = activeAssistantView;
  const previousIndex = ASSISTANT_VIEW_ORDER.indexOf(previousView);
  const nextIndex = ASSISTANT_VIEW_ORDER.indexOf(view);
  const direction = nextIndex >= previousIndex ? 1 : -1;
  const viewChanged = previousView !== view;
  activeAssistantView = view;
  const indicatorIndex = Math.max(0, nextIndex);
  assistantTabsElement?.style.setProperty(
    '--assistant-indicator-x',
    `calc(${indicatorIndex * 100}% + ${indicatorIndex * 4}px)`,
  );
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
    if (viewChanged) revealUiElement(assistantChatPanel, direction);
    window.setTimeout(() => chatInput.focus(), 0);
  } else {
    const switchingWithinTools = previousView !== 'chat';
    activateAiTab(view, viewChanged && switchingWithinTools);
    if (viewChanged && !switchingWithinTools) revealUiElement(assistantToolsRuntime, direction);
  }
}

function setDeepSeekSettingsOpen(open: boolean): void {
  assistantSettingsOpen = open;
  const transitionToken = ++assistantSettingsTransitionToken;
  if (assistantSettingsPanel.parentElement !== document.body) {
    document.body.append(assistantSettingsPanel);
  }
  aiSettingsButton.classList.toggle('active', open);
  aiSettingsButton.setAttribute('aria-expanded', String(open));
  if (open) {
    assistantSettingsPanel.hidden = false;
    assistantSettingsPanel.setAttribute('aria-hidden', 'false');
    revealUiElement(assistantSettingsPanel, -1);
    window.setTimeout(() => deepSeekApiKeyInput.focus(), 0);
    return;
  }

  assistantSettingsPanel.setAttribute('aria-hidden', 'true');
  const animation = playUiAnimation(
    assistantSettingsPanel,
    [
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      { opacity: 0, transform: 'translate3d(8px, -5px, 0) scale(0.98)' },
    ],
    { duration: 170, easing: 'ease-in' },
  );
  void waitForUiAnimation(animation).then(() => {
    if (transitionToken === assistantSettingsTransitionToken && !assistantSettingsOpen) {
      assistantSettingsPanel.hidden = true;
    }
  });
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

  const resolvedContext = { ...context, readingMode: resolvedReadingMode };
  logAiRequestDebug(messages, resolvedContext);
  const response = await browser.runtime.sendMessage({
    type: 'pdf-helper:ai-chat',
    messages,
    context: resolvedContext,
  }) as AiRuntimeResponse;

  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || 'AI 模型没有返回有效内容。');
  }
  return response.content.trim();
}

function logAiRequestDebug(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage['context'] = {},
): void {
  const systemPrompt = buildAiSystemContent(context);
  const task = context.task || '未命名 AI 请求';
  const providerConversation = messages
    .filter((message) => message.content.trim())
    .slice(-MAX_PROVIDER_CONVERSATION_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_PROVIDER_MESSAGE_LENGTH),
    }));
  const finalMessages = [
    { role: 'system', content: systemPrompt },
    ...providerConversation,
  ];

  console.groupCollapsed(`[PDF Helper AI] ${task} · 提示词与引用`);
  console.log('引用审计', {
    documentName: context.documentName,
    scope: context.sourceScope,
    sourceLabel: context.sourceLabel,
    sourcePages: context.sourcePages,
    contextNote: context.contextNote,
    selectedTextLength: context.selectedText?.length ?? 0,
    contextLength: context.pageText?.length ?? 0,
    readingMode: context.readingMode,
  });
  console.log('System Prompt\n', systemPrompt);
  providerConversation.forEach((message, index) => {
    console.log(`${message.role === 'user' ? 'User' : 'Assistant'} Prompt #${index + 1}\n`, message.content);
  });
  console.log('最终发送消息（已应用供应商适配层的条数与字符上限）', finalMessages);
  console.groupEnd();
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

function updateChatContextPreview(): void {
  const documentLabel = sourceName ? getDisplayFileName(sourceName) : '尚未打开 PDF';
  const pageNumber = Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1);
  const selectedText = selectedTextForAi.trim();
  const agentLine = documentAgentStatusText ? `\n${documentAgentStatusText}` : '';

  if (selectedText) {
    chatContextPreview.textContent = `${documentLabel} · 第 ${pageNumber} 页${agentLine}\n${selectedText.slice(0, 420)}${selectedText.length > 420 ? '…' : ''}`;
    chatContextPreview.classList.add('has-selection');
  } else {
    chatContextPreview.textContent = sourceName
      ? `${documentLabel} · 第 ${pageNumber} 页 · ${getReadingModeLabel(resolvedReadingMode)}（自动携带当前页正文）${agentLine}`
      : '打开 PDF 后，助手会自动携带当前页正文；选中文字时优先使用选区。';
    chatContextPreview.classList.remove('has-selection');
  }
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
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || quote.length < 2) return _match;
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
  // Models occasionally ignore the delimiter instruction and emit a compact
  // exponent such as 2^{-\gamma}. Wrap only this narrow, unambiguous pattern;
  // broader guessing would risk treating normal prose as mathematics.
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

function renderChatMarkdown(container: HTMLElement, content: string): void {
  const citationResult = protectMarkdownCitations(content);
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

function renderChatMessageImages(
  message: HTMLElement,
  images: AiImageAttachment[] | undefined,
): void {
  message.querySelector('.chat-message-images')?.remove();
  if (!images?.length) return;

  const gallery = document.createElement('div');
  gallery.className = 'chat-message-images';
  for (const attachment of images) {
    const image = document.createElement('img');
    image.className = 'chat-message-image';
    image.src = attachment.dataUrl;
    image.alt = attachment.name || '聊天截图';
    image.title = attachment.name || '聊天截图';
    gallery.append(image);
  }
  const body = message.querySelector('.chat-message-content');
  if (body) message.insertBefore(gallery, body);
  else message.append(gallery);
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
    renderChatMarkdown(body, content);
  } else {
    body.textContent = content;
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

function appendChatMessage(
  role: 'user' | 'assistant',
  content: string,
  options: { pending?: boolean; error?: boolean; images?: AiImageAttachment[] } = {},
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
  renderChatMessageImages(message, options.images);
  updateChatMessage(message, content, options);
  return message;
}

function requestAiStream(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage['context'],
  onDelta: (content: string) => void,
): Promise<string> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_STREAM_PORT_NAME });
  const resolvedContext = { ...context, readingMode: resolvedReadingMode };
  logAiRequestDebug(messages, resolvedContext);

  return new Promise((resolve, reject) => {
    let settled = false;
    let content = '';

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

      if (message.type === 'delta') {
        content += message.content;
        onDelta(message.content);
        return;
      }
      if (message.type === 'done') {
        finish(() => resolve(content));
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
      context: resolvedContext,
    };
    port.postMessage(startMessage);
  });
}

function renderChatConversation(messages: AiConversationMessage[]): void {
  chatMessagesElement.replaceChildren();
  if (messages.length === 0) {
    appendChatMessage(
      'assistant',
      '你好，我可以结合当前 PDF 和你选中的文字回答问题。论文完成全文建档后，我还可以检索全文、论文档案和目录。',
    );
    return;
  }
  for (const message of messages) {
    appendChatMessage(message.role, message.content, { images: message.images });
  }
}

async function persistChatConversation(): Promise<void> {
  const documentId = currentDocumentAgentId;
  if (!documentId) return;
  const now = Date.now();
  if (!currentDocumentSessionCreatedAt) currentDocumentSessionCreatedAt = now;
  const session: DocumentAgentSession = {
    id: `${documentId}:session:default`,
    documentId,
    title: getDisplayFileName(sourceName) || 'PDF 会话',
    messages: chatHistory.map((message) => ({ ...message })),
    createdAt: currentDocumentSessionCreatedAt,
    updatedAt: now,
  };
  await putDocumentSession(session);
}

async function restoreChatConversation(documentId: string): Promise<void> {
  try {
    const session = await getLatestDocumentSession(documentId);
    if (currentDocumentAgentId !== documentId) return;
    chatHistory = session?.messages?.map((message) => ({ ...message })) ?? [];
    currentDocumentSessionCreatedAt = session?.createdAt ?? Date.now();
    renderChatConversation(chatHistory);
  } catch (error) {
    console.warn('[PDF Helper Agent] 无法恢复历史会话', error);
    if (currentDocumentAgentId !== documentId) return;
    chatHistory = [];
    currentDocumentSessionCreatedAt = Date.now();
    renderChatConversation(chatHistory);
  }
}

function resetChatConversation(options: { persist?: boolean } = {}): void {
  chatHistory = [];
  currentDocumentSessionCreatedAt = Date.now();
  clearPendingChatImages();
  renderChatConversation(chatHistory);
  if (options.persist !== false) void persistChatConversation();
}

const MAX_CHAT_IMAGE_COUNT = 3;
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_CHAT_IMAGE_EDGE = 1600;

async function createChatImageAttachment(
  blob: Blob,
  fallbackName = 'screenshot.png',
): Promise<AiImageAttachment> {
  if (!blob.type.startsWith('image/')) throw new Error('只能添加图片文件。');
  if (blob.size > MAX_CHAT_IMAGE_BYTES) throw new Error('单张图片不能超过 15 MB。');

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_CHAT_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('浏览器无法处理这张图片。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      id: crypto.randomUUID(),
      name: blob instanceof File && blob.name ? blob.name : fallbackName,
      mediaType: 'image/jpeg',
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
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
    const item = document.createElement('div');
    item.className = 'chat-attachment';
    const image = document.createElement('img');
    image.src = attachment.dataUrl;
    image.alt = attachment.name;
    const label = document.createElement('span');
    label.textContent = attachment.name;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = '×';
    removeButton.setAttribute('aria-label', `移除 ${attachment.name}`);
    removeButton.addEventListener('click', () => {
      pendingChatImages = pendingChatImages.filter((item) => item.id !== attachment.id);
      renderPendingChatImages();
    });
    item.append(image, label, removeButton);
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
      pendingChatImages.push(await createChatImageAttachment(file, `screenshot-${index + 1}.png`));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  renderPendingChatImages();
  chatInput.focus();
}

function clearPendingChatImages(): void {
  pendingChatImages = [];
  chatImageInput.value = '';
  renderPendingChatImages();
}

async function inspectChatImageWithVision(
  attachment: AiImageAttachment,
  question: string,
  config: VisionAiConfig,
  context: AiStreamStartMessage['context'],
): Promise<string> {
  if (!isVisionAiConfigured(config)) {
    throw new Error('当前主模型不能看图。请先在“设置 → 视觉模型”中配置视觉模型。');
  }
  const response = await browser.runtime.sendMessage({
    type: 'pdf-helper:ai-vision',
    prompt: [
      '这是用户随聊天消息附加的截图。',
      question ? `用户问题：${question.slice(0, 2000)}` : '用户希望你分析这张截图。',
      '请准确描述截图中的文字、公式、图表、界面状态和重要空间关系。',
      '输出一份可直接交给主语言模型使用的中文事实说明；不确定的地方明确标注，不要猜测。',
    ].join('\n'),
    imageDataUrl: attachment.dataUrl,
    context: {
      ...context,
      task: '聊天截图视觉分析',
      sourceLabel: attachment.name,
      contextNote: '这是用户本轮聊天消息附加的截图，不是 PDF 页面渲染图。',
    },
  }) as AiRuntimeResponse;
  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || `视觉模型未能分析 ${attachment.name}。`);
  }
  return response.content.trim();
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
    visionSettingsStatus.textContent = '视觉模型已关闭；主模型仍可使用 PDF 文字上下文。';
  } else if (!visionSettingsStatus.textContent || visionSettingsStatus.textContent.includes('已关闭')) {
    visionSettingsStatus.textContent = '仅在需要查看图、表、公式截图或页面布局时调用。';
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
  if (config.apiKey && config.baseUrl && config.model) return true;
  visionSettingsStatus.classList.add('error');
  visionSettingsStatus.textContent = '启用视觉模型后，需要填写 API Key、模型标识和 OpenAI 兼容 API 地址。';
  return false;
}

async function saveVisionAiConfig(showSuccess = true): Promise<boolean> {
  const nextConfig = readVisionAiConfigFromForm();
  if (!validateVisionAiConfig(nextConfig)) return false;
  visionAiConfig = nextConfig;
  await browser.storage.local.set({ [VISION_AI_CONFIG_STORAGE_KEY]: nextConfig });
  populateVisionAiConfigForm(nextConfig);
  visionSettingsStatus.classList.remove('error');
  if (showSuccess) {
    visionSettingsStatus.textContent = nextConfig.mode === 'separate'
      ? `视觉模型已保存：${nextConfig.model}`
      : '视觉模型已关闭；主模型仍可使用 PDF 文字上下文。';
  }
  return true;
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
  clearPdfCitationHighlight();
  if (internalNavigationReturnCheckTimer !== null) {
    window.clearTimeout(internalNavigationReturnCheckTimer);
    internalNavigationReturnCheckTimer = null;
  }
  internalNavigationHistory.length = 0;
  internalNavigationReturnCheckAvailableAt = 0;
  updateCitationReturnButton();
}

function scheduleInternalNavigationReturnCheck(delay = 80) {
  if (internalNavigationHistory.length === 0) return;
  if (internalNavigationReturnCheckTimer !== null) {
    window.clearTimeout(internalNavigationReturnCheckTimer);
  }

  const guardDelay = Math.max(0, internalNavigationReturnCheckAvailableAt - Date.now());
  internalNavigationReturnCheckTimer = window.setTimeout(() => {
    internalNavigationReturnCheckTimer = null;
    updateInternalNavigationReturnState();
  }, Math.max(delay, guardDelay + 16));
}

function updateInternalNavigationReturnState() {
  if (
    isInternalNavigationInProgress ||
    isReturningFromInternalNavigation ||
    isRestoringReadingPosition ||
    Date.now() < internalNavigationReturnCheckAvailableAt ||
    !pdfDocument
  ) {
    return;
  }

  const entry = internalNavigationHistory.at(-1);
  if (!entry || entry.documentKey !== getInternalNavigationDocumentKey()) return;

  const position = getCurrentReadingPosition();
  if (!position) return;

  const verticalDistance = Math.abs(position.scrollTop - entry.scrollTop);
  const horizontalDistance = Math.abs(position.scrollLeft - entry.scrollLeft);
  // Only dismiss the return affordance after the reader has genuinely come
  // back to the captured viewport. Treating any position on the same page as
  // the origin made the state disappear (or reveal an older stack entry) while
  // the user was still far away from the original paragraph.
  const returnTolerance = 36;
  const horizontalTolerance = 36;
  const isNearOrigin =
    position.pageNumber === entry.pageNumber &&
    verticalDistance <= returnTolerance &&
    horizontalDistance <= horizontalTolerance;

  if (!entry.hasDepartedOrigin) {
    const departureDistance = Math.max(180, viewerContainer.clientHeight * 0.7);
    if (verticalDistance > departureDistance || position.pageNumber !== entry.pageNumber) {
      entry.hasDepartedOrigin = true;
    }
    return;
  }

  if (isNearOrigin) {
    internalNavigationHistory.length = 0;
    updateCitationReturnButton();
  }
}

function captureInternalNavigationOrigin(): InternalNavigationEntry | null {
  if (
    suppressInternalNavigationCapture ||
    isInternalNavigationInProgress ||
    isReturningFromInternalNavigation ||
    isOpeningDocument ||
    !pdfDocument
  ) {
    return null;
  }

  const documentKey = getInternalNavigationDocumentKey();
  const existingEntry = internalNavigationHistory.at(-1);
  if (existingEntry?.documentKey === documentKey) {
    // A second citation click before returning still belongs to the same
    // navigation session. Preserve the original reading position instead of
    // turning the latest destination into a new (and misleading) return point.
    return existingEntry;
  }

  const position = getCurrentReadingPosition();
  if (!position) return null;

  const entry: InternalNavigationEntry = {
    ...position,
    documentKey,
    hasDepartedOrigin: false,
  };
  // A citation jump has exactly one origin. Keeping a browser-like stack here
  // allowed late scroll/page events to expose stale entries and caused the
  // "return to text" action to bounce through unrelated pages.
  internalNavigationHistory.length = 0;
  internalNavigationHistory.push(entry);
  updateCitationReturnButton();
  return entry;
}

async function navigateToDestinationWithoutReturnHistory(destination: unknown) {
  suppressInternalNavigationCapture = true;
  try {
    return await linkService.goToDestination(destination as any);
  } finally {
    // Keep capture disabled until named destinations have been fully resolved.
    // PDF.js may recursively call goToDestination while resolving them.
    suppressInternalNavigationCapture = false;
  }
}

function returnToPreviousInternalNavigationPosition() {
  if (!pdfDocument || isReturningFromInternalNavigation) return;

  const documentKey = getInternalNavigationDocumentKey();
  const entry = internalNavigationHistory.at(-1);
  internalNavigationHistory.length = 0;
  if (internalNavigationReturnCheckTimer !== null) {
    window.clearTimeout(internalNavigationReturnCheckTimer);
    internalNavigationReturnCheckTimer = null;
  }
  updateCitationReturnButton();
  if (!entry || entry.documentKey !== documentKey) return;

  isReturningFromInternalNavigation = true;
  isRestoringReadingPosition = true;
  clearPdfCitationHighlight();

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
        behavior: 'auto',
      });
      requestAnimationFrame(() => {
        isReturningFromInternalNavigation = false;
        isRestoringReadingPosition = false;
        updateControls();
        scheduleReadingPositionSave();
      });
    });
  });
}

const goToPdfDestination = linkService.goToDestination.bind(linkService);
linkService.goToDestination = async (destination: any) => {
  // PDF.js resolves a named destination by recursively calling
  // this.goToDestination(explicitDestination). Only the outermost call owns the
  // return origin; otherwise the nested call can overwrite it and later
  // "return to text" actions appear to bounce between unrelated positions.
  const isRootNavigation = !isInternalNavigationInProgress;
  if (!isRootNavigation) {
    return await goToPdfDestination(destination);
  }

  const bibliographyReferenceNumber =
    parseBibliographyReferenceNumber(destination);
  if (
    bibliographyReferenceNumber !== null &&
    (await navigateFromBibliographyToFirstCitation(
      bibliographyReferenceNumber,
      goToPdfDestination,
    ))
  ) {
    return;
  }

  const capturedEntry = captureInternalNavigationOrigin();
  isInternalNavigationInProgress = true;
  internalNavigationReturnCheckAvailableAt = Date.now() + 600;
  try {
    const resolvedDestination = await resolvePdfDestination(destination);
    await goToPdfDestination(destination);
    await waitForAnimationFrames(2);
    if (resolvedDestination) {
      await highlightInternalPdfDestination(resolvedDestination);
    }
  } finally {
    if (capturedEntry) capturedEntry.hasDepartedOrigin = true;
    isInternalNavigationInProgress = false;
    scheduleInternalNavigationReturnCheck();
  }
};

interface CitationTextPoint {
  node: Text;
  offset: number;
}

interface CitationTextIndex {
  text: string;
  points: CitationTextPoint[];
}

function normalizeCitationCharacter(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\u00ad/g, '');
}

function normalizeCitationQuote(value: string): string {
  return normalizeCitationCharacter(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCitationTextIndex(
  textLayer: HTMLElement,
  insertSpacesBetweenNodes: boolean,
): CitationTextIndex {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  let text = '';
  const points: CitationTextPoint[] = [];
  let previousNode: Text | null = null;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (
      insertSpacesBetweenNodes &&
      previousNode &&
      text &&
      !/\s/.test(text.at(-1) ?? '') &&
      value &&
      !/^\s/.test(value)
    ) {
      text += ' ';
      points.push({ node: previousNode, offset: previousNode.length });
    }

    for (let offset = 0; offset < value.length; offset += 1) {
      const normalized = normalizeCitationCharacter(value[offset] ?? '');
      if (!normalized) continue;
      for (const character of normalized) {
        if (/\s/.test(character)) {
          if (!text || text.endsWith(' ')) continue;
          text += ' ';
        } else {
          text += character;
        }
        points.push({ node, offset });
      }
    }
    previousNode = node;
  }
  return { text, points };
}

function clearPdfCitationHighlight(): void {
  activePdfCitationLayer?.remove();
  activePdfCitationLayer = null;
  if (activePdfCitationTimer !== null) {
    window.clearTimeout(activePdfCitationTimer);
    activePdfCitationTimer = null;
  }
}

function waitForAnimationFrames(count = 1): Promise<void> {
  return new Promise((resolve) => {
    const nextFrame = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => nextFrame(remaining - 1));
    };
    nextFrame(Math.max(1, count));
  });
}

async function resolvePdfDestination(destination: any): Promise<any[] | null> {
  if (Array.isArray(destination)) return destination;
  if (typeof destination !== 'string' || !pdfDocument) return null;
  try {
    return (await pdfDocument.getDestination(destination)) as any[] | null;
  } catch {
    return null;
  }
}

async function getPdfDestinationPageNumber(destination: any[]): Promise<number | null> {
  if (!pdfDocument || destination.length === 0) return null;
  const pageReference = destination[0];
  if (Number.isInteger(pageReference)) {
    const pageNumber = Number(pageReference) + 1;
    return pageNumber >= 1 && pageNumber <= pdfDocument.numPages ? pageNumber : null;
  }
  if (!pageReference || typeof pageReference !== 'object') return null;
  try {
    return (await pdfDocument.getPageIndex(pageReference)) + 1;
  } catch {
    return null;
  }
}

function getPdfDestinationTop(destination: any[]): number | null {
  const destinationType = destination[1]?.name;
  const candidate = destinationType === 'XYZ'
    ? destination[3]
    : destinationType === 'FitH' || destinationType === 'FitBH'
      ? destination[2]
      : destinationType === 'FitR'
        ? destination[5]
        : null;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function getPdfDestinationLeft(destination: any[]): number | null {
  const destinationType = destination[1]?.name;
  const candidate = destinationType === 'XYZ' || destinationType === 'FitR'
    ? destination[2]
    : null;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

async function waitForPdfTextLayer(pageNumber: number): Promise<HTMLElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 3500) {
    const layer = viewerElement.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .textLayer`,
    );
    if (layer && layer.textContent?.trim()) return layer;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }
  return null;
}

interface CitationTextMatch {
  start: number;
  length: number;
}

interface CitationClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function getCitationWords(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function getCitationCandidateConfidence(quote: string, candidate: string): number {
  const quoteWords = getCitationWords(quote);
  const candidateWords = getCitationWords(candidate);
  if (quoteWords.length < 6 || candidateWords.length < 4) return 0;
  if (candidateWords.length > quoteWords.length * 1.55) return 0;
  if (candidateWords.length < quoteWords.length * 0.6) return 0;

  const previous = new Array<number>(candidateWords.length + 1).fill(0);
  for (const quoteWord of quoteWords) {
    let diagonal = 0;
    for (let candidateIndex = 1; candidateIndex <= candidateWords.length; candidateIndex += 1) {
      const above = previous[candidateIndex] ?? 0;
      const left = previous[candidateIndex - 1] ?? 0;
      previous[candidateIndex] = quoteWord === candidateWords[candidateIndex - 1]
        ? diagonal + 1
        : Math.max(above, left);
      diagonal = above;
    }
  }
  return (previous[candidateWords.length] ?? 0) / quoteWords.length;
}

function findCitationTextMatch(indexText: string, normalizedQuote: string): CitationTextMatch | null {
  const exactStart = indexText.indexOf(normalizedQuote);
  if (exactStart >= 0) return { start: exactStart, length: normalizedQuote.length };

  const words = normalizedQuote.split(' ').filter(Boolean);
  for (let anchorSize = Math.min(8, Math.floor(words.length / 2)); anchorSize >= 4; anchorSize -= 1) {
    const startAnchor = words.slice(0, anchorSize).join(' ');
    const endAnchor = words.slice(-anchorSize).join(' ');
    let start = indexText.indexOf(startAnchor);
    while (start >= 0) {
      const endStart = indexText.indexOf(endAnchor, start + startAnchor.length);
      const maximumSpan = Math.max(normalizedQuote.length * 1.55, normalizedQuote.length + 180);
      if (endStart >= 0 && endStart - start <= maximumSpan) {
        const length = endStart + endAnchor.length - start;
        const candidate = indexText.slice(start, start + length);
        if (getCitationCandidateConfidence(normalizedQuote, candidate) >= 0.82) {
          return { start, length };
        }
      }
      start = indexText.indexOf(startAnchor, start + 1);
    }
  }

  // Do not fall back to a long prefix. Repeated prose, headers and bibliography
  // entries can share such prefixes, and highlighting the wrong passage is
  // substantially worse than reporting that the source could not be matched.
  return null;
}

function createCitationRange(
  index: CitationTextIndex,
  start: number,
  length: number,
): Range | null {
  if (length < 1) return null;
  const startPoint = index.points[start];
  const endPoint = index.points[start + length - 1];
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(
    startPoint.node,
    Math.min(startPoint.offset, startPoint.node.length),
  );
  range.setEnd(
    endPoint.node,
    Math.min(endPoint.offset + 1, endPoint.node.length),
  );
  return range;
}

function findCitationRange(textLayer: HTMLElement, quote: string): Range | null {
  const normalizedQuote = normalizeCitationQuote(quote);
  if (!normalizedQuote) return null;

  for (const insertSpaces of [false, true]) {
    const index = buildCitationTextIndex(textLayer, insertSpaces);
    const match = findCitationTextMatch(index.text, normalizedQuote);
    if (!match || match.length < 2) continue;
    const range = createCitationRange(index, match.start, match.length);
    if (range) return range;
  }
  return null;
}

function getCitationRectColumn(
  rect: Pick<CitationClientRect, 'left' | 'right' | 'width'>,
  pageRect: DOMRect,
): 'left' | 'right' | 'full' {
  if (rect.width >= pageRect.width * 0.58) return 'full';
  return (rect.left + rect.right) / 2 < pageRect.left + pageRect.width / 2 ? 'left' : 'right';
}

function mergeCitationClientRects(rects: DOMRect[], pageRect: DOMRect): CitationClientRect[] {
  const visibleRects = rects
    .filter((rect) => rect.width >= 1 && rect.height >= 1)
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: CitationClientRect[] = [];
  for (const rect of visibleRects) {
    const sameLine = [...merged].reverse().find((candidate) => {
      const verticalOverlap = Math.min(rect.bottom, candidate.bottom) - Math.max(rect.top, candidate.top);
      const minimumHeight = Math.min(rect.height, candidate.height);
      const rectColumn = getCitationRectColumn(rect, pageRect);
      const candidateColumn = getCitationRectColumn(candidate, pageRect);
      const sameColumn =
        rectColumn === candidateColumn ||
        rectColumn === 'full' ||
        candidateColumn === 'full';
      return sameColumn && verticalOverlap >= minimumHeight * 0.68;
    });
    const horizontalGap = sameLine ? Math.max(0, rect.left - sameLine.right) : Number.POSITIVE_INFINITY;
    // PDF.js often emits one client rect per word/span. Merge those rects into
    // the visual line, but never bridge the two columns of a paper.
    const maximumWordGap = sameLine
      ? Math.max(36, Math.min(72, Math.min(rect.height, sameLine.height) * 5))
      : 0;
    if (sameLine && horizontalGap <= maximumWordGap) {
      sameLine.left = Math.min(sameLine.left, rect.left);
      sameLine.top = Math.min(sameLine.top, rect.top);
      sameLine.right = Math.max(sameLine.right, rect.right);
      sameLine.bottom = Math.max(sameLine.bottom, rect.bottom);
      sameLine.width = sameLine.right - sameLine.left;
      sameLine.height = sameLine.bottom - sameLine.top;
      continue;
    }
    merged.push({ ...rect });
  }
  return merged;
}

function showPdfCitationHighlight(page: HTMLElement, rects: DOMRect[]): HTMLElement | null {
  const pageRect = page.getBoundingClientRect();
  const clippedRects = rects
    .map((rect) => {
      const left = Math.max(pageRect.left, rect.left);
      const top = Math.max(pageRect.top, rect.top);
      const right = Math.min(pageRect.right, rect.right);
      const bottom = Math.min(pageRect.bottom, rect.bottom);
      return DOMRect.fromRect({
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      });
    })
    .filter((rect) => rect.width >= 1 && rect.height >= 1);
  const mergedRects = mergeCitationClientRects(clippedRects, pageRect);
  if (mergedRects.length === 0) return null;
  clearPdfCitationHighlight();
  const layer = document.createElement('div');
  layer.className = 'pdf-ai-citation-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (const rect of mergedRects) {
    const highlight = document.createElement('span');
    highlight.className = 'pdf-ai-citation-highlight';
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    layer.append(highlight);
  }
  page.append(layer);
  activePdfCitationLayer = layer;
  // Smooth scrolling remains active after this function returns. If the user
  // immediately presses "return to text", the unfinished animation competes
  // with the restore scroll and pulls the document back toward the citation.
  layer.firstElementChild?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  activePdfCitationTimer = window.setTimeout(clearPdfCitationHighlight, 9000);
  return layer;
}

function parseBibliographyReferenceNumber(destination: unknown): number | null {
  if (typeof destination !== "string") return null;
  const match = /^rid:bibr:ref(\d+)$/i.exec(destination.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function findFirstBodyCitationTarget(
  referenceNumber: number,
): Promise<PdfBodyCitationTarget | null> {
  if (!pdfDocument) return null;

  const cacheKey = `${getInternalNavigationDocumentKey()}:${referenceNumber}`;
  let pending = bibliographyBacklinkCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const destinationName = `Item.${referenceNumber}`;
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const annotations = await page.getAnnotations({ intent: "display" });
        const pageWidth = Math.abs(Number(page.view?.[2] ?? 0) - Number(page.view?.[0] ?? 0));
        const matches = annotations
          .filter(
            (annotation: any) =>
              annotation?.dest === destinationName &&
              Array.isArray(annotation?.rect) &&
              annotation.rect.length === 4,
          )
          .map((annotation: any) => ({
            pageNumber,
            rect: annotation.rect.map(Number) as [number, number, number, number],
            destinationName,
          }))
          .sort((left, right) => {
            const leftX = Math.min(left.rect[0], left.rect[2]);
            const rightX = Math.min(right.rect[0], right.rect[2]);
            const leftColumn = pageWidth > 0 && leftX >= pageWidth / 2 ? 1 : 0;
            const rightColumn = pageWidth > 0 && rightX >= pageWidth / 2 ? 1 : 0;
            if (leftColumn !== rightColumn) return leftColumn - rightColumn;
            const leftTop = Math.max(left.rect[1], left.rect[3]);
            const rightTop = Math.max(right.rect[1], right.rect[3]);
            return rightTop - leftTop || leftX - rightX;
          });
        if (matches[0]) return matches[0];
      }
      return null;
    })();
    bibliographyBacklinkCache.set(cacheKey, pending);
  }
  return pending;
}

function getCitationAnnotationClientRect(
  target: PdfBodyCitationTarget,
  pageElement: HTMLElement,
): DOMRect | null {
  const pageView = pdfViewer?.getPageView(target.pageNumber - 1) as any;
  const viewport = pageView?.viewport;
  if (!viewport?.convertToViewportRectangle) return null;
  const converted = viewport.convertToViewportRectangle(target.rect);
  const pageRect = pageElement.getBoundingClientRect();
  const left = pageRect.left + Math.min(converted[0], converted[2]);
  const top = pageRect.top + Math.min(converted[1], converted[3]);
  return new DOMRect(
    left,
    top,
    Math.abs(converted[2] - converted[0]),
    Math.abs(converted[3] - converted[1]),
  );
}

function citationGroupContainsReference(group: string, referenceNumber: number): boolean {
  const escaped = String(referenceNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`).test(group)) return true;
  for (const match of group.matchAll(/(\d+)\s*[-–—]\s*(\d+)/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      referenceNumber >= Math.min(start, end) &&
      referenceNumber <= Math.max(start, end)
    ) {
      return true;
    }
  }
  return false;
}

function findNearestBodyCitationMatch(
  index: CitationTextIndex,
  referenceNumber: number,
  targetRect: DOMRect,
): { start: number; length: number; rects: DOMRect[] } | null {
  const candidates: Array<{
    start: number;
    length: number;
    rects: DOMRect[];
    score: number;
  }> = [];
  for (const match of index.text.matchAll(/[\[(][^\])]{1,96}[\])]/g)) {
    if (
      match.index === undefined ||
      !citationGroupContainsReference(match[0], referenceNumber)
    ) {
      continue;
    }
    const range = createCitationRange(index, match.index, match[0].length);
    if (!range) continue;
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (!rects.length) continue;
    const score = Math.min(
      ...rects.map((rect) => {
        const dx = rect.left + rect.width / 2 - (targetRect.left + targetRect.width / 2);
        const dy = rect.top + rect.height / 2 - (targetRect.top + targetRect.height / 2);
        return dx * dx + dy * dy;
      }),
    );
    candidates.push({ start: match.index, length: match[0].length, rects, score });
  }
  candidates.sort((left, right) => left.score - right.score);
  return candidates[0] ?? null;
}

function expandCitationMatchToSentence(
  text: string,
  start: number,
  length: number,
): { start: number; length: number } {
  const sentenceBoundary = /[.!?。！？]/;
  let sentenceStart = start;
  while (sentenceStart > 0 && !sentenceBoundary.test(text[sentenceStart - 1])) {
    sentenceStart -= 1;
  }
  while (sentenceStart < start && /\s/.test(text[sentenceStart])) sentenceStart += 1;

  let sentenceEnd = start + length;
  while (sentenceEnd < text.length && !sentenceBoundary.test(text[sentenceEnd])) {
    sentenceEnd += 1;
  }
  if (sentenceEnd < text.length) sentenceEnd += 1;
  return { start: sentenceStart, length: Math.max(1, sentenceEnd - sentenceStart) };
}

async function highlightFirstBodyCitation(
  target: PdfBodyCitationTarget,
): Promise<void> {
  const pageElement = viewerElement.querySelector<HTMLElement>(
    `.page[data-page-number="${target.pageNumber}"]`,
  );
  if (!pageElement) return;
  const textLayer = await waitForPdfTextLayer(pageElement);
  const annotationRect = getCitationAnnotationClientRect(target, pageElement);
  if (!textLayer || !annotationRect) return;

  const index = buildCitationTextIndex(textLayer, true);
  const match = findNearestBodyCitationMatch(index, Number(target.destinationName.slice(5)), annotationRect);
  if (!match) {
    showPdfCitationHighlight(pageElement, [annotationRect]);
    return;
  }

  const sentence = expandCitationMatchToSentence(index.text, match.start, match.length);
  const sentenceRange = createCitationRange(index, sentence.start, sentence.length);
  const sentenceRects = sentenceRange
    ? Array.from(sentenceRange.getClientRects()).filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          getCitationRectColumn(rect, pageElement.getBoundingClientRect()) ===
            getCitationRectColumn(annotationRect, pageElement.getBoundingClientRect()),
      )
    : [];
  showPdfCitationHighlight(pageElement, sentenceRects.length ? sentenceRects : match.rects);
}

async function navigateFromBibliographyToFirstCitation(
  referenceNumber: number,
  navigate: (destination: any) => Promise<any>,
): Promise<boolean> {
  const target = await findFirstBodyCitationTarget(referenceNumber);
  if (!target) return false;

  clearInternalNavigationHistory();
  isInternalNavigationInProgress = true;
  try {
    const left = Math.min(target.rect[0], target.rect[2]);
    const top = Math.max(target.rect[1], target.rect[3]);
    await navigate([target.pageNumber - 1, { name: "XYZ" }, left, top, null]);
    await waitForAnimationFrames(2);
    await highlightFirstBodyCitation(target);
  } finally {
    isInternalNavigationInProgress = false;
  }
  return true;
}

async function highlightInternalPdfDestination(destination: any[]): Promise<void> {
  const pageNumber = await getPdfDestinationPageNumber(destination);
  if (!pageNumber) return;
  const textLayer = await waitForPdfTextLayer(pageNumber);
  const page = textLayer?.closest<HTMLElement>('.page');
  if (!textLayer || !page) return;
  const pageRect = page.getBoundingClientRect();

  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span'))
    .map((span) => ({
      rect: span.getBoundingClientRect(),
      text: span.textContent ?? '',
    }))
    .filter(({ rect }) => rect.width >= 1 && rect.height >= 1);
  if (spans.length === 0) return;

  const destinationTop = getPdfDestinationTop(destination);
  const destinationLeft = getPdfDestinationLeft(destination);
  const firstSpan = spans[0];
  if (!firstSpan) return;
  let targetClientY = firstSpan.rect.top;
  let targetClientX: number | null = null;
  const pageView = pdfViewer.getPageView(pageNumber - 1);
  const viewport = pageView?.viewport;
  if (destinationTop !== null && destinationLeft !== null) {
    const viewportPoint = viewport?.convertToViewportPoint(destinationLeft, destinationTop);
    if (viewportPoint) {
      const [viewportX, viewportY] = viewportPoint;
      if (typeof viewportX === 'number' && Number.isFinite(viewportX)) {
        targetClientX = pageRect.left + viewportX;
      }
      if (typeof viewportY === 'number' && Number.isFinite(viewportY)) {
        targetClientY = pageRect.top + viewportY;
      }
    }
  } else if (destinationTop !== null) {
    const viewportY = viewport?.convertToViewportPoint(0, destinationTop)?.[1];
    if (typeof viewportY === 'number' && Number.isFinite(viewportY)) {
      targetClientY = pageRect.top + viewportY;
    }
  } else if (destinationLeft !== null) {
    const viewportX = viewport?.convertToViewportPoint(destinationLeft, 0)?.[0];
    if (typeof viewportX === 'number' && Number.isFinite(viewportX)) {
      targetClientX = pageRect.left + viewportX;
    }
  }
  const visualLines: Array<{
    rects: DOMRect[];
    text: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
    column: 'left' | 'right' | 'full';
  }> = [];
  for (const span of [...spans].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
    const spanColumn = getCitationRectColumn({
      left: span.rect.left,
      right: span.rect.right,
      width: span.rect.width,
    }, pageRect);
    const line = [...visualLines].reverse().find((candidate) => {
      const overlap = Math.min(candidate.bottom, span.rect.bottom) - Math.max(candidate.top, span.rect.top);
      const sameColumn =
        candidate.column === spanColumn ||
        candidate.column === 'full' ||
        spanColumn === 'full';
      return sameColumn && overlap >= Math.min(candidate.bottom - candidate.top, span.rect.height) * 0.62;
    });
    if (line) {
      line.rects.push(span.rect);
      line.text = `${line.text} ${span.text}`.trim();
      line.top = Math.min(line.top, span.rect.top);
      line.bottom = Math.max(line.bottom, span.rect.bottom);
      line.left = Math.min(line.left, span.rect.left);
      line.right = Math.max(line.right, span.rect.right);
    } else {
      visualLines.push({
        rects: [span.rect],
        text: span.text.trim(),
        top: span.rect.top,
        bottom: span.rect.bottom,
        left: span.rect.left,
        right: span.rect.right,
        column: spanColumn,
      });
    }
  }
  visualLines.sort((a, b) => a.top - b.top || a.left - b.left);

  const getLineDistance = (line: (typeof visualLines)[number]) => {
    const verticalDistance = Math.abs(line.top - targetClientY);
    if (targetClientX === null) return verticalDistance;
    const horizontalDistance = targetClientX < line.left
      ? line.left - targetClientX
      : targetClientX > line.right
        ? targetClientX - line.right
        : 0;
    // Y still dominates adjacent lines, while X breaks the ambiguity between
    // two paper columns that happen to share the same vertical coordinate.
    return verticalDistance * 3 + horizontalDistance;
  };
  const nearestLineIndex = visualLines.reduce((bestIndex, line, index) => (
    getLineDistance(line) < getLineDistance(visualLines[bestIndex]!)
      ? index
      : bestIndex
  ), 0);
  const nearestLine = visualLines[nearestLineIndex];
  if (!nearestLine) return;

  const targetLines = [nearestLine];
  const isBibliographyEntry = /^\s*\[\s*\d{1,3}\s*\]/.test(nearestLine.text);
  if (isBibliographyEntry) {
    const originColumn = nearestLine.column;
    let previousLine = nearestLine;
    for (let index = nearestLineIndex + 1; index < visualLines.length && targetLines.length < 6; index += 1) {
      const line = visualLines[index];
      if (!line) continue;
      // Lines from the other column can share the same Y coordinate. Skip
      // them instead of treating them as the end of the wrapped reference.
      if (line.column !== originColumn) continue;
      if (/^\s*\[\s*\d{1,3}\s*\]/.test(line.text)) break;
      const gap = line.top - previousLine.bottom;
      const lineHeight = Math.max(previousLine.bottom - previousLine.top, line.bottom - line.top);
      if (gap < -lineHeight * 0.5) continue;
      if (gap > Math.max(10, lineHeight * 1.25)) break;
      targetLines.push(line);
      previousLine = line;
    }
  }
  showPdfCitationHighlight(page, targetLines.flatMap((line) => line.rects));
}

async function jumpToPdfCitation(pageNumber: number, quote: string): Promise<void> {
  if (!pdfDocument) {
    setStatus('请先打开 PDF。', true);
    return;
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
    setStatus(`引用页码无效：第 ${pageNumber} 页。`, true);
    return;
  }

  // AI “查看原文”只负责原文定位；只有 PDF 内部引用跳转才建立“回到正文”历史。
  clearInternalNavigationHistory();
  isInternalNavigationInProgress = true;
  pdfViewer.currentPageNumber = pageNumber;
  pdfViewer.scrollPageIntoView({ pageNumber });

  const textLayer = await waitForPdfTextLayer(pageNumber);
  if (!textLayer) {
    isInternalNavigationInProgress = false;
    setStatus(`已跳到第 ${pageNumber} 页，但该页文字层尚未加载。`);
    return;
  }

  const range = findCitationRange(textLayer, quote);
  if (!range) {
    isInternalNavigationInProgress = false;
    setStatus(`已跳到第 ${pageNumber} 页，但没有精确匹配到引用原文。`, true);
    return;
  }

  const page = textLayer.closest<HTMLElement>('.page');
  if (!page) {
    isInternalNavigationInProgress = false;
    setStatus(`已跳到第 ${pageNumber} 页，但无法创建引用定位层。`, true);
    return;
  }
  const layer = showPdfCitationHighlight(page, Array.from(range.getClientRects()));
  if (!layer) {
    isInternalNavigationInProgress = false;
    setStatus(`已跳到第 ${pageNumber} 页，但引用区域当前不可见。`, true);
    return;
  }

  isInternalNavigationInProgress = false;
  setStatus(`已定位到第 ${pageNumber} 页引用原文。`);
}

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
      : '视觉模型已关闭；主模型仍可使用 PDF 文字上下文。';
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
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#2563eb';
  context.fillRect(14, 14, 68, 68);
  context.fillStyle = '#ffffff';
  context.font = 'bold 20px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('PDF', 48, 48);
  return canvas.toDataURL('image/png');
}

async function testVisionAiConnection(): Promise<void> {
  if (!(await saveVisionAiConfig(false))) return;
  if (!isVisionAiConfigured(visionAiConfig)) {
    visionSettingsStatus.classList.add('error');
    visionSettingsStatus.textContent = '请先启用并填写视觉模型配置。';
    return;
  }

  testVisionAiButton.disabled = true;
  visionSettingsStatus.classList.remove('error');
  visionSettingsStatus.textContent = '正在测试视觉模型…';
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-vision-test',
      imageDataUrl: createVisionTestImage(),
    }) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || '视觉模型连接测试失败。');
    visionSettingsStatus.textContent = `视觉连接成功：${response.model || visionAiConfig.model}`;
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
  updateChatContextPreview();
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
    if (pdfDocument) {
      await initializeCurrentDocumentKnowledge(pdfDocument, { force: true, restoreSession: false });
    }
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
  if (pdfDocument) {
    await initializeCurrentDocumentKnowledge(pdfDocument, { force: true, restoreSession: false });
  }
}

function setDocumentAgentStatus(text: string): void {
  documentAgentStatusText = text;
  updateChatContextPreview();
}

function getDocumentAgentOutline() {
  return getOutlinePageItems().map(({ title, pageNumber, depth }) => ({
    title,
    pageNumber,
    depth,
  }));
}

async function initializeCurrentDocumentKnowledge(
  documentProxy: PDFDocumentProxy,
  options: { force?: boolean; restoreSession?: boolean } = {},
): Promise<void> {
  const operationToken = ++documentAgentOperationToken;
  const documentId = createDocumentAgentId(
    getPdfFingerprint(documentProxy),
    getDisplayFileName(sourceName),
    documentProxy.numPages,
  );
  currentDocumentAgentId = documentId;
  currentDocumentAgentRecord = null;
  currentDocumentChunks = [];

  if (options.restoreSession !== false) await restoreChatConversation(documentId);
  if (pdfDocument !== documentProxy || operationToken !== documentAgentOperationToken) return;
  if (!aiConfigLoaded) await loadDeepSeekConfig();
  if (pdfDocument !== documentProxy || operationToken !== documentAgentOperationToken) return;

  setDocumentAgentStatus('正在检查历史档案与本地全文索引…');
  try {
    const knowledge = await initializeDocumentKnowledge({
      fingerprint: getPdfFingerprint(documentProxy),
      name: getDisplayFileName(sourceName),
      pageCount: documentProxy.numPages,
      readingMode: resolvedReadingMode,
      providerId: aiConfig.providerId,
      model: aiConfig.model,
      hasApiKey: Boolean(aiConfig.apiKey),
      force: options.force,
      extractPageText: (pageNumber) => extractPageText(documentProxy, pageNumber),
      getOutline: getDocumentAgentOutline,
      requestAi: requestAiContent,
      isCurrent: () => pdfDocument === documentProxy && operationToken === documentAgentOperationToken,
      onStatus: ({ text }) => {
        if (pdfDocument === documentProxy && operationToken === documentAgentOperationToken) {
          setDocumentAgentStatus(text);
        }
      },
    });
    if (pdfDocument !== documentProxy || operationToken !== documentAgentOperationToken) return;
    currentDocumentAgentRecord = knowledge.record;
    currentDocumentChunks = knowledge.chunks;
    console.info('[PDF Helper Agent] 文档知识已就绪', {
      documentId: knowledge.documentId,
      restored: knowledge.restored,
      status: knowledge.record.processingStatus,
      readingMode: knowledge.record.readingMode,
      chunks: knowledge.chunks.length,
    });
  } catch (error) {
    if (pdfDocument !== documentProxy || operationToken !== documentAgentOperationToken) return;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('文档已切换')) {
      console.error('[PDF Helper Agent] 全文建档失败', error);
      setDocumentAgentStatus(`全文建档失败，本地阅读不受影响：${message}`);
    }
  }
}

async function initializeOpenedDocumentFeatures(documentProxy: PDFDocumentProxy): Promise<void> {
  const documentId = createDocumentAgentId(
    getPdfFingerprint(documentProxy),
    getDisplayFileName(sourceName),
    documentProxy.numPages,
  );
  currentDocumentAgentId = documentId;
  await restoreChatConversation(documentId);
  if (pdfDocument !== documentProxy) return;
  await Promise.all([
    renderDocumentOutline(documentProxy),
    loadReadingModeForDocument(documentProxy),
  ]);
  if (pdfDocument !== documentProxy) return;
  await initializeCurrentDocumentKnowledge(documentProxy, { restoreSession: false });
}

async function sendChatMessage(): Promise<void> {
  const content = chatInput.value.trim();
  const requestImages = pendingChatImages.map((image) => ({ ...image }));
  const userPrompt = content || (requestImages.length ? '请分析这些截图，并结合当前 PDF 回答。' : '');
  if (!userPrompt || chatRequestPending) return;

  if (!aiConfig.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add('error');
    deepSeekSettingsStatus.textContent = '先配置并保存 API Key，之后即可聊天。';
    return;
  }

  const requestAiConfig = { ...aiConfig };
  const mainModelSupportsVision = isMainAiVisionCapable(requestAiConfig);
  if (
    requestImages.length > 0 &&
    !mainModelSupportsVision &&
    !isVisionAiConfigured(visionAiConfig)
  ) {
    setDeepSeekSettingsOpen(true);
    visionSettingsStatus.classList.add('error');
    visionSettingsStatus.textContent = '当前主模型不能看图，请配置视觉模型后再发送截图。';
    return;
  }

  // Freeze every document-scoped dependency for this request. PDF extraction and
  // Agent retrieval both await asynchronous work, so the user may open another
  // document before they finish. Using the live globals in that case would mix
  // the old question into the newly opened document session.
  const requestDocument = pdfDocument;
  const requestDocumentId = currentDocumentAgentId;
  const requestDocumentRecord = currentDocumentAgentRecord;
  const requestDocumentChunks = currentDocumentChunks;
  const requestDocumentOutline = getDocumentAgentOutline();
  const requestDocumentName = sourceName;
  const requestReadingMode = resolvedReadingMode;
  const requestSelectedText = selectedTextForAi;
  const requestVisionAiConfig = { ...visionAiConfig };

  chatRequestPending = true;
  chatInput.value = '';
  clearPendingChatImages();
  chatInput.disabled = true;
  chatImageButton.disabled = true;
  chatSendButton.disabled = true;
  chatHistory.push({ role: 'user', content: userPrompt, images: requestImages });
  void persistChatConversation().catch((error) => {
    console.warn('[PDF Helper Agent] 无法保存用户消息', error);
  });
  appendChatMessage('user', userPrompt, { images: requestImages });
  const assistantMessage = appendChatMessage(
    'assistant',
    requestImages.length > 0 && !mainModelSupportsVision ? '正在调用视觉模型读取截图…' : '',
    { pending: true },
  );
  let streamedContent = '';
  let renderFrame = 0;

  const flushStreamedContent = (): void => {
    renderFrame = 0;
    updateChatMessage(assistantMessage, streamedContent, { streaming: true });
  };

  try {
    const pageNumber = Math.max(1, selectedTextPageNumber || pdfViewer.currentPageNumber || 1);
    const pageText = requestDocument
      ? await extractPageText(requestDocument, pageNumber).catch(() => '')
      : '';
    if (pdfDocument !== requestDocument || currentDocumentAgentId !== requestDocumentId) return;

    let imageContext = '';
    if (requestImages.length > 0 && !mainModelSupportsVision) {
      const analyses: string[] = [];
      for (const [index, attachment] of requestImages.entries()) {
        const analysis = await inspectChatImageWithVision(
          attachment,
          userPrompt,
          requestVisionAiConfig,
          {
            documentName: requestDocumentName ? getDisplayFileName(requestDocumentName) : undefined,
            pageNumber,
            totalPages: requestDocument?.numPages,
            readingMode: requestReadingMode,
            sourcePages: [pageNumber],
          },
        );
        analyses.push(`[用户截图 ${index + 1}：${attachment.name}]\n${analysis}`);
      }
      imageContext = analyses.join('\n\n');
      updateChatMessage(assistantMessage, '截图已读取，正在检索 PDF 并组织回答…', { pending: true });
    }

    const retrieval = requestDocument
      ? await buildDocumentRetrievalContext({
        question: userPrompt,
        currentPage: pageNumber,
        currentPageText: pageText,
        selectedText: requestSelectedText,
        readingMode: requestReadingMode,
        documentName: getDisplayFileName(requestDocumentName),
        pageCount: requestDocument.numPages,
        record: requestDocumentRecord,
        chunks: requestDocumentChunks,
        outline: requestDocumentOutline,
        extractPageText: (targetPage) => extractPageText(requestDocument, targetPage),
        requestAi: requestAiContent,
        hasVisionModel: isVisionAiConfigured(requestVisionAiConfig),
        userImageAttached: requestImages.length > 0,
        inspectPageImage: (targetPage, question) => inspectPdfPageWithVision(
          requestDocument,
          requestDocumentId || createDocumentAgentId(
            getPdfFingerprint(requestDocument),
            requestDocumentName,
            requestDocument.numPages,
          ),
          targetPage,
          question,
          requestVisionAiConfig,
          requestDocumentName,
          requestReadingMode,
        ),
      })
      : {
        text: '',
        sourcePages: [pageNumber],
        toolResults: [],
        plannerReason: '当前没有打开 PDF。',
        planningRounds: 0,
      };
    if (pdfDocument !== requestDocument || currentDocumentAgentId !== requestDocumentId) return;

    const toolLabels = retrieval.toolResults.map((result) => result.label).join('、');
    console.debug('[PDF Helper Agent] 本轮证据决策摘要', {
      planningRounds: retrieval.planningRounds,
      reason: retrieval.plannerReason,
      tools: retrieval.toolResults.map((result) => ({
        name: result.name,
        label: result.label,
        pages: result.pages,
      })),
      sourcePages: retrieval.sourcePages,
    });
    const requestHistory: AiConversationMessage[] = chatHistory.map((message) => mainModelSupportsVision
      ? { ...message, images: message.images?.map((image) => ({ ...image })) }
      : { role: message.role, content: message.content });
    const pdfContext = (retrieval.text || pageText).trim()
      ? `[PDF 文字补充上下文]\n${(retrieval.text || pageText).trim()}`
      : '';
    const visualContext = imageContext.trim()
      ? `[用户附图视觉分析（本轮首要对象）]\n${imageContext.trim()}`
      : '';
    const combinedContext = (requestImages.length > 0
      ? [visualContext, pdfContext]
      : [pdfContext, visualContext])
      .filter(Boolean)
      .join('\n\n');
    const visualFocusNote = requestImages.length > 0
      ? ' 本轮用户附带了截图：用户问题中的“这张图”“图里”“这部分”默认指向截图。必须先直接分析截图中的对象、流程、标签、公式与关系；PDF 当前页和检索结果只用于补充背景，不得用页面概述替代图像分析。'
      : '';
    const contextNote = requestImages.length > 0
      ? `本轮首要任务是回答用户对附图的提问。附图视觉分析是主证据；PDF 当前页、文字选区和论文检索结果都只作背景补充。除非用户明确询问 PDF 中的某个图号，否则不要把回答重心切回当前页面。${retrieval.toolResults.length > 0 ? `本地论文工具仅提供了补充材料：${toolLabels}。` : ''}`
      : retrieval.toolResults.length > 0
        ? `Agent 已按问题调用本地论文工具：${toolLabels}。请综合工具结果作答，并用规定的 PDF 原文引用标记支持关键结论。${visualFocusNote}`
        : requestSelectedText
          ? `Agent 判断当前选区和当前页已足够回答：${retrieval.plannerReason || '无需额外检索'}。回答应优先针对选区；当前页正文仅用于消歧和补足上下文。`
          : `Agent 判断当前页证据已足够或没有可用的额外证据：${retrieval.plannerReason || '本轮未调用额外工具'}。只依据提供的正文回答，不要臆测未读取的页面。${visualFocusNote}`;
    const responseContent = await requestAiStream(
      requestHistory,
      {
        task: '聊天问答',
        documentName: requestDocumentName ? getDisplayFileName(requestDocumentName) : undefined,
        pageNumber,
        totalPages: requestDocument?.numPages,
        pageText: combinedContext || undefined,
        selectedText: requestSelectedText || undefined,
        sourceScope: requestImages.length > 0
          ? (retrieval.toolResults.length > 0 ? 'document' : 'page')
          : retrieval.toolResults.length > 0
            ? 'document'
            : requestSelectedText
              ? 'selection'
              : 'page',
        sourceLabel: requestImages.length > 0
          ? '用户附图（PDF 内容仅作背景）'
          : retrieval.toolResults.length > 0
            ? toolLabels
            : requestSelectedText
              ? `第 ${pageNumber} 页选区`
              : `第 ${pageNumber} 页`,
        sourcePages: retrieval.sourcePages,
        contextNote,
        visualFocus: requestImages.length > 0,
      },
      (delta) => {
        streamedContent += delta;
        if (!renderFrame) renderFrame = window.requestAnimationFrame(flushStreamedContent);
      },
    );

    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    streamedContent = responseContent;
    if (pdfDocument !== requestDocument || currentDocumentAgentId !== requestDocumentId) return;
    if (!streamedContent.trim()) throw new Error('AI 模型没有返回有效回答。');

    updateChatMessage(assistantMessage, streamedContent, { streaming: false });
    chatHistory.push({ role: 'assistant', content: streamedContent });
    void persistChatConversation().catch((error) => {
      console.warn('[PDF Helper Agent] 无法保存助手消息', error);
    });
  } catch (error) {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    updateChatMessage(
      assistantMessage,
      `请求失败：${error instanceof Error ? error.message : String(error)}`,
      { error: true },
    );
  } finally {
    chatRequestPending = false;
    chatInput.disabled = false;
    chatImageButton.disabled = false;
    chatSendButton.disabled = false;
    chatInput.focus();
  }
}

function setTranslationState(message: string, isError = false): void {
  if (isError) {
    translationResultElement.textContent = message;
  } else {
    renderChatMarkdown(translationResultElement, message);
  }
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
    renderChatMarkdown(item, point);
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

  for (const [index, point] of points.entries()) {
    const item = document.createElement('li');
    item.classList.toggle('summary-takeaway', index === 0);
    renderChatMarkdown(item, point);
    list.append(item);
  }

  lastSummaryPoints = points;
  summaryResultElement.replaceChildren(list);
  summaryResultElement.classList.remove('error');
}

function getOutlinePageItems(): OutlinePageItem[] {
  if (!outlineList) return [];
  if (outlinePageItemsCache) return outlinePageItemsCache;

  outlinePageItemsCache = Array.from(
    outlineList.querySelectorAll<HTMLButtonElement>('button[data-outline-page]'),
  )
    .map((button, order) => ({
      pageNumber: Number(button.dataset.outlinePage),
      title: button.textContent?.trim() || '未命名章节',
      depth: Math.max(0, Number(button.dataset.outlineDepth) || 0),
      order,
    }))
    .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber || left.order - right.order);
  return outlinePageItemsCache;
}

function getCurrentChapterContext(pageNumber: number): {
  title: string;
  startPage: number;
  endPage: number;
  sourceKind: 'outline' | 'page-fallback';
  nextTitle?: string;
  nextStartPage?: number;
} {
  const items = getOutlinePageItems();
  let currentItem: OutlinePageItem | null = null;

  for (const item of items) {
    if (item.pageNumber > pageNumber) break;
    currentItem = item;
  }

  if (!currentItem) {
    return {
      title: `第 ${pageNumber} 页`,
      startPage: pageNumber,
      endPage: pageNumber,
      sourceKind: 'page-fallback',
    };
  }

  const currentOrder = currentItem.order;
  const nextItem = items.find((item) => (
    item.order > currentOrder
    && item.depth <= currentItem.depth
  ));
  const nextStartPage = nextItem?.pageNumber;
  return {
    title: currentItem.title,
    startPage: currentItem.pageNumber,
    endPage: Math.max(
      currentItem.pageNumber,
      Math.min(
        pdfDocument?.numPages ?? pageNumber,
        nextStartPage === currentItem.pageNumber
          ? currentItem.pageNumber
          : (nextStartPage ?? (pdfDocument?.numPages ?? pageNumber) + 1) - 1,
      ),
    ),
    sourceKind: outlineUsesPageFallback ? 'page-fallback' : 'outline',
    nextTitle: nextItem?.title,
    nextStartPage,
  };
}

function findOutlineHeadingIndex(text: string, title: string, from = 0): number {
  const source = text.toLocaleLowerCase();
  const candidates = [
    title.trim(),
    title.replace(/^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.)]?\s*/i, '').trim(),
  ]
    .filter((candidate, index, all) => candidate.length >= 3 && all.indexOf(candidate) === index)
    .map((candidate) => candidate.toLocaleLowerCase());

  for (const candidate of candidates) {
    const directIndex = source.indexOf(candidate, from);
    if (directIndex >= 0) return directIndex;

    const compactCandidate = candidate.replace(/\s+/g, ' ');
    if (compactCandidate !== candidate) {
      const compactIndex = source.indexOf(compactCandidate, from);
      if (compactIndex >= 0) return compactIndex;
    }
  }
  return -1;
}

function slicePageTextToChapterBoundary(
  pageText: string,
  pageNumber: number,
  chapter: ReturnType<typeof getCurrentChapterContext>,
): { text: string; boundaryMatched: boolean } {
  if (chapter.sourceKind !== 'outline') return { text: pageText, boundaryMatched: false };

  let start = 0;
  let end = pageText.length;
  let boundaryMatched = false;
  if (pageNumber === chapter.startPage) {
    const headingIndex = findOutlineHeadingIndex(pageText, chapter.title);
    if (headingIndex >= 0) {
      start = headingIndex;
      boundaryMatched = true;
    }
  }
  if (chapter.nextTitle && chapter.nextStartPage === pageNumber) {
    const nextHeadingIndex = findOutlineHeadingIndex(pageText, chapter.nextTitle, start + 1);
    if (nextHeadingIndex > start) {
      end = nextHeadingIndex;
      boundaryMatched = true;
    }
  }
  return { text: pageText.slice(start, end).trim(), boundaryMatched };
}

function getSummaryLabels(
  scope: SummaryScope,
  pageNumberOverride?: number,
): Omit<SummaryContext, 'text'> {
  const pageNumber = pdfDocument
    ? Math.max(1, pageNumberOverride || pdfViewer.currentPageNumber || 1)
    : 0;
  const chapter = pageNumber > 0
    ? getCurrentChapterContext(pageNumber)
    : {
      title: '未定位',
      startPage: 0,
      endPage: 0,
      sourceKind: 'page-fallback' as const,
    };

  if (scope === 'chapter') {
    return {
      scope,
      sourcePages: chapter.startPage > 0
        ? Array.from(
          { length: Math.max(0, chapter.endPage - chapter.startPage + 1) },
          (_, index) => chapter.startPage + index,
        )
        : [],
      rangeLabel: '当前章节',
      sourceLabel: chapter.startPage === chapter.endPage
        ? `第 ${chapter.startPage} 页`
        : `第 ${chapter.startPage}–${chapter.endPage} 页`,
      positionLabel: chapter.title,
    };
  }

  return {
    scope,
    sourcePages: pageNumber > 0 ? [pageNumber] : [],
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

async function createStableTextKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function renderPdfPageForVision(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 1600;
  const targetHeight = 2200;
  const scale = Math.max(
    1,
    Math.min(2.4, targetWidth / baseViewport.width, targetHeight / baseViewport.height),
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({
    canvas,
    viewport,
    background: '#ffffff',
    annotationMode: AnnotationMode.ENABLE,
  }).promise;
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function inspectPdfPageWithVision(
  documentProxy: PDFDocumentProxy,
  documentId: string,
  pageNumber: number,
  question: string,
  config: VisionAiConfig,
  documentName: string,
  readingMode: ResolvedReadingMode,
): Promise<{ content: string; model: string; cached: boolean }> {
  if (!isVisionAiConfigured(config)) {
    throw new Error('该问题需要查看 PDF 页面图像。请在右上角“设置 → 视觉模型”中完成配置。');
  }
  const normalizedQuestion = question.replace(/\s+/g, ' ').trim().slice(0, 1200);
  const questionKey = await createStableTextKey(`${config.model}\n${normalizedQuestion}`);
  const cacheId = `${documentId}:vision:${pageNumber}:${questionKey}`;
  const cached = await getDocumentVisionCacheEntry(cacheId);
  if (cached) return { content: cached.content, model: cached.model, cached: true };

  const imageDataUrl = await renderPdfPageForVision(documentProxy, pageNumber);
  const response = await browser.runtime.sendMessage({
    type: 'pdf-helper:ai-vision',
    prompt: [
      `用户问题：${normalizedQuestion}`,
      '请查看这一整页，只提取回答问题所需的视觉信息。',
      '如果涉及图、表、公式或流程图，请先说明其位置/编号，再解释变量、关系和结论。',
      '不要重复大段可直接从文字层读取的正文。',
    ].join('\n'),
    imageDataUrl,
    context: {
      task: 'Agent 视觉工具 · 查看 PDF 页面',
      documentName: getDisplayFileName(documentName),
      pageNumber,
      totalPages: documentProxy.numPages,
      readingMode,
      sourceScope: 'page',
      sourceLabel: `第 ${pageNumber} 页页面图像`,
      sourcePages: [pageNumber],
    },
  }) as AiRuntimeResponse;
  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || '视觉模型没有返回有效结果。');
  }
  const entry = {
    id: cacheId,
    documentId,
    pageNumber,
    questionKey,
    content: response.content.trim(),
    model: response.model || config.model,
    updatedAt: Date.now(),
  };
  await putDocumentVisionCacheEntry(entry);
  return { content: entry.content, model: entry.model, cached: false };
}

function classifySelectionForSummary(text: string): SelectionSummaryKind {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentenceEndCount = normalized.match(/[.!?。！？]/g)?.length ?? 0;
  if (normalized.length >= 320 || sentenceEndCount >= 2) return 'paragraph';
  if (normalized.length >= 48 || sentenceEndCount === 1) return 'sentence';
  return 'fragment';
}

function findPreviousSentenceBoundary(text: string, from: number, maxDistance = 700): number {
  const minimum = Math.max(0, from - maxDistance);
  for (let index = Math.min(from - 1, text.length - 1); index >= minimum; index -= 1) {
    if (/[.!?。！？]/.test(text[index] ?? '')) return index + 1;
  }
  return minimum;
}

function findNextSentenceBoundary(text: string, from: number, maxDistance = 700): number {
  const maximum = Math.min(text.length, from + maxDistance);
  for (let index = Math.max(0, from); index < maximum; index += 1) {
    if (/[.!?。！？]/.test(text[index] ?? '')) return index + 1;
  }
  return maximum;
}

function buildSelectionParagraphContext(
  selectedText: string,
  pageText: string,
  selectionKind: SelectionSummaryKind,
): string {
  const target = selectedText.replace(/\s+/g, ' ').trim();
  const source = pageText
    .replace(/[\t ]+/g, ' ')
    .replace(/[\t ]*\n[\t ]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!source || selectionKind === 'paragraph') return target;

  let targetStart = source.indexOf(target);
  if (targetStart < 0 && target.length > 40) {
    targetStart = source.indexOf(target.slice(0, Math.min(100, target.length)));
  }
  if (targetStart < 0) return target;

  const targetEnd = Math.min(source.length, targetStart + target.length);
  const paragraphStart = source.lastIndexOf('\n\n', targetStart);
  const paragraphEnd = source.indexOf('\n\n', targetEnd);
  const blockStart = paragraphStart >= 0 ? paragraphStart + 2 : 0;
  const blockEnd = paragraphEnd >= 0 ? paragraphEnd : source.length;
  const block = source.slice(blockStart, blockEnd).trim();
  if (block.length >= target.length && block.length <= 1_600) return block;

  const containingStart = findPreviousSentenceBoundary(source, targetStart);
  const containingEnd = findNextSentenceBoundary(source, targetEnd);
  const contextStart = findPreviousSentenceBoundary(source, Math.max(0, containingStart - 1), 500);
  const contextEnd = findNextSentenceBoundary(source, containingEnd, 500);
  const context = source.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim();
  return context.length >= target.length ? context : target;
}

function getSummaryPointLimit(scope: SummaryScope): number {
  if (scope === 'selection') return 2;
  if (scope === 'page') return 3;
  return 4;
}

function getSelectionKindLabel(kind: SelectionSummaryKind | undefined): string {
  if (kind === 'fragment') return '句子片段';
  if (kind === 'sentence') return '完整句子';
  return '段落';
}

function buildSummaryPrompt(context: SummaryContext): string {
  const pointLimit = getSummaryPointLimit(context.scope);
  const sharedRules = [
    `最多输出 ${pointLimit} 条，每行以“- ”开头。`,
    '第一条必须直接说清楚该范围“讲了什么/得出了什么”，后续只保留理解论证所必需的机制、条件或结论。',
    '不要输出标题、前言、结尾、任务复述，也不要出现“根据提供的内容”“核心要点如下”等套话。',
    '每条必须具体，避免把同一件事拆成多个近义要点。',
    '涉及公式时，用 Markdown 数学定界符书写：行内公式用 $...$，独立公式用 $$...$$；并在同一条中说明公式表达的关系或作用。',
  ];

  if (context.scope === 'selection') {
    return [
      `你要解释的是一个${getSelectionKindLabel(context.selectionKind)}，不是总结整页。`,
      ...sharedRules,
      '第一条只解释“目标文本”本身在说什么；“上下文段落”仅用于补全指代、术语和推理关系，不能把上下文中的其他内容混进目标结论。',
      '若目标只是半句话或句子片段，先结合上下文还原它所在完整句子的含义，再给出解释。',
      '',
      '【目标文本】',
      context.targetText ?? context.text,
      '',
      '【上下文段落（仅用于理解目标）】',
      context.contextText ?? context.text,
    ].join('\n');
  }

  if (context.scope === 'page') {
    return [
      '你要总结当前这一页。回答重点是“本页在整篇文档中讲了什么”，不是逐句摘录。',
      ...sharedRules,
      '第一条概括本页主旨；其余条目只保留本页最关键的推导、方法、实验发现或公式含义。',
      '',
      `【页面位置】${context.sourceLabel} · ${context.positionLabel}`,
      '【本页正文】',
      context.text,
    ].join('\n');
  }

  return [
    '你要总结当前章节，先概括章节承担的作用，再提炼少量关键论证或结论。',
    ...sharedRules,
    '',
    `【章节位置】${context.sourceLabel} · ${context.positionLabel}`,
    '【章节正文】',
    context.text,
  ].join('\n');
}

function normalizeSummaryPoints(content: string, scope: SummaryScope): string[] {
  const boilerplate = /^(?:核心要点|总结|要点|根据(?:你|所)?提供|以下(?:是|为)|本页内容(?:主要)?)/;
  return parseAiList(content)
    .map((point) => point.replace(/^#{1,6}\s*/, '').replace(/^\*\*(.+)\*\*:?$/, '$1').trim())
    .filter((point) => point.length > 0 && !boilerplate.test(point))
    .slice(0, getSummaryPointLimit(scope));
}

async function buildSummaryContext(scope: SummaryScope): Promise<SummaryContext> {
  if (!pdfDocument) throw new Error('请先打开 PDF。');

  const documentAtStart = pdfDocument;
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const effectivePageNumber = scope === 'selection'
    ? summarySelectionPageNumber || pageNumber
    : pageNumber;
  const labels = getSummaryLabels(scope, effectivePageNumber);
  let text = '';
  let targetText: string | undefined;
  let contextText: string | undefined;
  let selectionKind: SelectionSummaryKind | undefined;
  let sourcePages = [...labels.sourcePages];
  let sourceTruncated = false;
  let chapterBoundaryMatched = false;

  if (scope === 'selection') {
    targetText = summarySelectionText.trim();
    if (!targetText || summarySelectionPageNumber !== pageNumber) {
      throw new Error('请先在当前页拖选需要总结的文字。高亮批注不等于文字选区。');
    }
    selectionKind = classifySelectionForSummary(targetText);
    const pageText = await extractPageText(documentAtStart, effectivePageNumber);
    contextText = buildSelectionParagraphContext(targetText, pageText, selectionKind);
    text = contextText;
  } else if (scope === 'page') {
    const pageText = await extractPageText(documentAtStart, pageNumber);
    text = `[第 ${pageNumber} 页]\n${pageText}`;
  } else {
    const chapter = getCurrentChapterContext(pageNumber);
    const pages: string[] = [];
    const includedPages: number[] = [];
    let currentLength = 0;

    for (let currentPage = chapter.startPage; currentPage <= chapter.endPage; currentPage += 1) {
      if (pdfDocument !== documentAtStart) throw new Error('PDF 已切换，请重新总结。');
      const pageText = await extractPageText(documentAtStart, currentPage);
      if (!pageText) continue;
      const chapterPage = slicePageTextToChapterBoundary(pageText, currentPage, chapter);
      chapterBoundaryMatched ||= chapterPage.boundaryMatched;
      if (!chapterPage.text) continue;

      const remainingLength = MAX_SUMMARY_SOURCE_LENGTH - currentLength;
      if (remainingLength <= 0) {
        sourceTruncated = true;
        break;
      }
      const pageBlock = `[第 ${currentPage} 页]\n${chapterPage.text}`;
      pages.push(pageBlock.slice(0, remainingLength));
      includedPages.push(currentPage);
      currentLength += pageBlock.length;
      if (pageBlock.length > remainingLength) {
        sourceTruncated = true;
        break;
      }
    }

    text = pages.join('\n\n');
    sourcePages = includedPages;
  }

  const untrimmedLength = text.length;
  text = text.trim().slice(0, MAX_SUMMARY_SOURCE_LENGTH);
  sourceTruncated ||= untrimmedLength > MAX_SUMMARY_SOURCE_LENGTH;
  if (!text) throw new Error('当前范围没有可总结的文字内容。');

  return {
    ...labels,
    text,
    targetText,
    contextText,
    selectionKind,
    sourcePages,
    sourceTruncated,
    chapterBoundaryMatched,
  };
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
      context.targetText ?? '',
      context.text,
    ].join('\u0000');

    if (!force && requestKey === lastSummaryRequestKey && lastSummaryPoints.length > 0) {
      renderSummaryPoints(lastSummaryPoints);
      return;
    }

    setSummaryState('正在生成核心要点，请稍候…');
    const summaryContent = await requestAiContent(
      [{ role: 'user', content: buildSummaryPrompt(context) }],
      {
        task: `总结 · ${context.rangeLabel}`,
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber: Math.max(1, pdfViewer.currentPageNumber || 1),
        totalPages: pdfDocument?.numPages,
        selectedText: context.scope === 'selection' ? context.targetText : undefined,
        sourceScope: context.scope,
        sourceLabel: `${context.sourceLabel} · ${context.positionLabel}`,
        sourcePages: context.sourcePages,
        contextNote: context.scope === 'selection'
          ? '目标是选中文本；提示词中的段落仅用于消歧。'
          : context.scope === 'chapter' && getCurrentChapterContext(
            Math.max(1, pdfViewer.currentPageNumber || 1),
          ).sourceKind === 'page-fallback'
            ? '该 PDF 没有可用的内置目录，本次“当前章节”安全回退为当前页；正文按页标注。'
          : context.sourceTruncated
            ? '章节由 PDF 内置目录的层级与页码确定，正文按页标注；因长度上限发生截断，sourcePages 是实际发送页。同页多个小节无法仅凭目录页码再细分。'
            : context.scope === 'chapter'
              ? `章节由 PDF 内置目录的层级与页码确定，正文按页标注；sourcePages 是实际发送页。边界页目录标题${context.chapterBoundaryMatched ? '已匹配并裁剪' : '未匹配，使用页级范围'}。`
              : '正文来自当前页并带有页码标记；sourcePages 是实际发送页。',
      },
    );
    const points = normalizeSummaryPoints(summaryContent, context.scope);

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
  renderChatMarkdown(cardExplanationElement, content.explanation);
  renderChatMarkdown(cardPurposeElement, content.purpose);
  renderChatMarkdown(cardUnderstandingElement, content.understanding);
  cardSourceLocationElement.textContent = context.sourceLocation;

  const points = content.keyPoints.map((point) => {
    const item = document.createElement('li');
    renderChatMarkdown(item, point);
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
          '所有数学变量和公式都必须保留为 LaTeX，并使用 $...$ 或 $$...$$ 定界符。',
          '',
          context.text,
        ].join('\n'),
      }],
      {
        task: '生成学习卡片',
        documentName: context.documentName,
        pageNumber: context.pageNumber,
        totalPages: pdfDocument?.numPages,
        selectedText: context.text,
        sourceScope: 'selection',
        sourceLabel: context.sourceLocation,
        sourcePages: [context.pageNumber],
        contextNote: '卡片只依据当前选区生成。JSON 字符串中的公式也使用 $...$ 或 $$...$$。',
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
    oneSentenceSummary: paperOneSentenceSummaryInput.value.trim(),
    researchProblem: paperResearchProblemInput.value.trim(),
    coreInnovation: paperCoreInnovationInput.value.trim(),
    methodOverview: paperMethodOverviewInput.value.trim(),
    datasets: paperDatasetsInput.value.trim(),
    metrics: paperMetricsInput.value.trim(),
    mainFindings: paperMainFindingsInput.value.trim(),
    limitations: paperLimitationsInput.value.trim(),
    readingStatus: paperReadingStatusInput.value.trim(),
    recommendDeepReading: paperRecommendDeepReadingInput.value.trim(),
    citationPoints: paperCitationPointsInput.value.trim(),
    personalNotes: paperPersonalNotesInput.value.trim(),
  };
}

function renderPaperCardForm(data: Omit<PaperCardFormData, 'personalNotes'>): void {
  paperTitleInput.value = data.title;
  paperAuthorsInput.value = data.authors;
  paperVenueYearInput.value = data.venueYear;
  paperResearchAreaInput.value = data.researchArea;
  paperOneSentenceSummaryInput.value = data.oneSentenceSummary;
  paperResearchProblemInput.value = data.researchProblem;
  paperCoreInnovationInput.value = data.coreInnovation;
  paperMethodOverviewInput.value = data.methodOverview;
  paperDatasetsInput.value = data.datasets;
  paperMetricsInput.value = data.metrics;
  paperMainFindingsInput.value = data.mainFindings;
  paperLimitationsInput.value = data.limitations;
  setSelectValue(paperReadingStatusInput, data.readingStatus);
  setSelectValue(paperRecommendDeepReadingInput, data.recommendDeepReading);
  paperCitationPointsInput.value = data.citationPoints;
}

function updatePaperCardDocumentName(): void {
  const name = sourceName ? getDisplayFileName(sourceName) : '尚未打开 PDF';
  paperCardDocumentNameElement.textContent = name;
  paperCardDocumentNameElement.title = sourceName || name;
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
  updatePaperCardDocumentName();
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
  setPaperCardPageStatus('正在读取整篇论文并生成结构化卡片，请稍候…');

  try {
    const text = await extractPaperOverviewText(documentAtStart);
    if (controller.signal.aborted) return;

    const response = await fetch(PAPER_CARD_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        document_name: getDisplayFileName(sourceName),
        page_count: documentAtStart.numPages,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: PaperOverviewApiResponse = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText) as PaperOverviewApiResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`论文卡片后端返回了非 JSON 内容：${responseText.slice(0, 160)}`);
        }
      }
    }

    if (!response.ok) {
      const detail = typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    if (pdfDocument !== documentAtStart || controller.signal.aborted) return;

    renderPaperCardForm({
      title: normalizePaperOverviewField(payload.title),
      authors: normalizePaperOverviewField(payload.authors),
      venueYear: normalizePaperOverviewField(payload.venue_year),
      researchArea: normalizePaperOverviewField(payload.research_area),
      oneSentenceSummary: normalizePaperOverviewField(payload.one_sentence_summary),
      researchProblem: normalizePaperOverviewField(payload.research_problem),
      coreInnovation: normalizePaperOverviewField(payload.core_innovation),
      methodOverview: normalizePaperOverviewField(payload.method_overview),
      datasets: normalizePaperOverviewField(payload.datasets),
      metrics: normalizePaperOverviewField(payload.metrics),
      mainFindings: normalizePaperOverviewField(payload.main_findings),
      limitations: normalizePaperOverviewField(payload.limitations),
      readingStatus: normalizePaperOverviewField(payload.reading_status),
      recommendDeepReading: normalizePaperOverviewField(payload.recommend_deep_reading),
      citationPoints: normalizePaperOverviewField(payload.citation_points),
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

    if (error instanceof TypeError) {
      setPaperCardPageStatus(
        '无法连接本地论文卡片后端。请确认 http://127.0.0.1:8000/health 可以打开。',
        true,
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    setPaperCardPageStatus(`论文卡片生成失败：${message}`, true);
  } finally {
    if (paperCardPageAbortController === controller) paperCardPageAbortController = null;
    regeneratePaperCardButton.disabled = false;
    paperCardFormElement.classList.remove('generating');
  }
}

function openPaperCardPage(): void {
  const transitionToken = ++paperCardPageTransitionToken;
  paperCardPageElement.hidden = false;
  paperCardPageElement.setAttribute('aria-hidden', 'false');
  appFrame?.classList.add('paper-card-page-open');
  paperCardEntryButton?.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');
  updatePaperCardDocumentName();
  paperCardPageElement.scrollTop = 0;
  const animation = playUiAnimation(
    paperCardPageElement,
    [
      { opacity: 0.12, transform: 'translate3d(18px, 0, 0) scale(0.992)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ],
  );
  if (animation) {
    void waitForUiAnimation(animation).then(() => {
      if (transitionToken === paperCardPageTransitionToken) paperCardPageElement.style.transform = '';
    });
  }
  void generatePaperOverviewCard();
}

async function closePaperCardPage(): Promise<void> {
  if (paperCardPageElement.hidden) return;
  const transitionToken = ++paperCardPageTransitionToken;
  paperCardPageAbortController?.abort();
  paperCardPageElement.setAttribute('aria-hidden', 'true');
  paperCardEntryButton?.classList.remove('active');
  aiPanelToggleButton?.classList.add('active');
  const animation = playUiAnimation(
    paperCardPageElement,
    [
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      { opacity: 0, transform: 'translate3d(14px, 0, 0) scale(0.992)' },
    ],
    { duration: 190, easing: 'ease-in' },
  );
  await waitForUiAnimation(animation);
  if (transitionToken !== paperCardPageTransitionToken) return;
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove('paper-card-page-open');
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

  const card: SavedPaperOverview = {
    id: crypto.randomUUID(),
    documentName: sourceName ? getDisplayFileName(sourceName) : '未命名论文',
    ...data,
    createdAt: new Date().toISOString(),
  };
  const cards = [card, ...readSavedPaperOverviews()].slice(0, 100);
  localStorage.setItem(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, JSON.stringify(cards));
  setPaperCardPageStatus(`已保存“${data.title || card.documentName}”论文卡片。`);
}

function formatPaperOverviewMarkdown(data: PaperCardFormData): string {
  return [
    `# ${data.title || '论文卡片'}`,
    '',
    `- 作者：${data.authors || '原文未明确出现'}`,
    `- 年份 / 会议 / 期刊：${data.venueYear || '原文未明确出现'}`,
    `- 研究领域：${data.researchArea || '原文未明确出现'}`,
    '',
    '## 核心内容',
    '',
    `**一句话总结：** ${data.oneSentenceSummary}`,
    '',
    `**研究问题：** ${data.researchProblem}`,
    '',
    `**核心创新：** ${data.coreInnovation}`,
    '',
    `**方法概述：** ${data.methodOverview}`,
    '',
    '## 实验与结论',
    '',
    `**数据集：** ${data.datasets}`,
    '',
    `**评估指标：** ${data.metrics}`,
    '',
    `**主要实验结论：** ${data.mainFindings}`,
    '',
    `**局限性：** ${data.limitations}`,
    '',
    '## 我的判断',
    '',
    `- 阅读状态：${data.readingStatus}`,
    `- 是否建议精读：${data.recommendDeepReading}`,
    '',
    `**适合引用的点：** ${data.citationPoints}`,
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
  if (!text) return;

  summarySelectionText = text;
  summarySelectionPageNumber = pageNumber;
  if (text === selectedTextForAi && pageNumber === selectedTextPageNumber) {
    if (activeSummaryScope === 'selection' && activeAssistantView === 'summary') {
      lastSummaryRequestKey = '';
      scheduleSummaryGeneration();
    }
    return;
  }

  selectedTextForAi = text;
  selectedTextPageNumber = pageNumber;
  selectedSnippetElement.textContent = text;
  selectedSnippetElement.title = text;
  updateChatContextPreview();

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
    const pageNumber = selectedTextPageNumber || pdfViewer.currentPageNumber || 1;
    const pageText = pdfDocument
      ? await extractPageText(pdfDocument, pageNumber).catch(() => '')
      : '';
    const selectionKind = classifySelectionForSummary(text);
    const paragraphContext = buildSelectionParagraphContext(text, pageText, selectionKind);
    const translation = await requestAiContent(
      [{
        role: 'user',
        content: [
          '把“目标原文”准确翻译成简体中文，只输出译文，不要加标题、说明或总结。',
          '要求：保留术语、变量、上下标和逻辑关系；上下文只用于消歧，不能把上下文中未选中的内容翻译进结果。',
          '数学表达统一写成 LaTeX：行内公式使用 $...$，独立公式使用 $$...$$。例如把 2^{-\\gamma} 写成 $2^{-\\gamma}$。',
          '',
          '【目标原文】',
          text,
          '',
          '【所在段落（仅用于消歧）】',
          paragraphContext,
        ].join('\n'),
      }],
      {
        task: '翻译选中文本',
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber,
        totalPages: pdfDocument?.numPages,
        selectedText: text,
        pageText: paragraphContext !== text ? paragraphContext : undefined,
        sourceScope: 'selection',
        sourceLabel: `第 ${pageNumber} 页选区`,
        sourcePages: [pageNumber],
        contextNote: '目标原文是唯一翻译对象；所在段落只用于消歧。',
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
    const pageNumber = selectedTextPageNumber || pdfViewer.currentPageNumber || 1;
    const pageText = pdfDocument
      ? await extractPageText(pdfDocument, pageNumber).catch(() => '')
      : '';
    const selectionKind = classifySelectionForSummary(text);
    const paragraphContext = buildSelectionParagraphContext(text, pageText, selectionKind);
    const explanation = await requestAiContent(
      [{
        role: 'user',
        content: [
          '解释“目标原文”，让第一次读到这段内容的人也能快速理解。只输出 2–3 行，每行以“- ”开头：',
          '- **直白理解：** 用一句话说清这段话究竟在表达什么。',
          '- **关键关系：** 只解释理解它必须知道的条件、因果、比较或推导；没有则省略。',
          '- **术语/公式：** 只在确有术语或公式时解释符号含义与公式作用；没有则省略。',
          '不要复述任务，不要写“根据原文”，不要把同一结论拆成多个近义要点。',
          '数学表达必须使用 LaTeX：行内使用 $...$，独立公式使用 $$...$$。',
          '',
          '【目标原文】',
          text,
          '',
          '【所在段落（仅用于消歧）】',
          paragraphContext,
        ].join('\n'),
      }],
      {
        task: '解释选中文本',
        documentName: sourceName ? getDisplayFileName(sourceName) : undefined,
        pageNumber,
        totalPages: pdfDocument?.numPages,
        selectedText: text,
        pageText: paragraphContext !== text ? paragraphContext : undefined,
        sourceScope: 'selection',
        sourceLabel: `第 ${pageNumber} 页选区`,
        sourcePages: [pageNumber],
        contextNote: '目标原文是唯一解释对象；所在段落只用于补全指代与逻辑。',
      },
    );
    const points = parseAiList(explanation)
      .map((point) => point.replace(/^#{1,6}\s*/, '').trim())
      .filter((point) => point && !/^(?:核心要点|解释|总结)[:：]?$/.test(point))
      .slice(0, 3);

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
  bibliographyBacklinkCache.clear();

  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = '正在建立文字层…';

  try {
    if (pdfDocument) {
      await pdfDocument.destroy();
      pdfDocument = null;
    }

    const rawPdfBytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
    sourcePdfBytes = rawPdfBytes;
    const loadingTask = getDocument({
      data: new Uint8Array(rawPdfBytes),
      // Prefer a GPU-backed canvas in Chromium/Edge. This reduces main-thread
      // pressure while quickly scrolling image-heavy or high-zoom documents.
      enableHWA: true,
    });
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
    documentAgentOperationToken += 1;
    currentDocumentAgentId = '';
    currentDocumentAgentRecord = null;
    currentDocumentChunks = [];
    currentDocumentSessionCreatedAt = 0;
    documentAgentStatusText = '正在检查历史会话与全文档案…';
    summarySelectionText = '';
    summarySelectionPageNumber = 0;
    lastTranslatedText = '';
    lastExplainedText = '';
    selectedSnippetElement.textContent = '请在左侧 PDF 中选择文字';
    selectedSnippetElement.title = '';
    setTranslationState('选中英文后将自动翻译。');
    setExplanationState('选中英文后将自动生成解释。');
    updateChatContextPreview();
    resetChatConversation({ persist: false });
    resetSummaryState();
    resetCardState();
    resetPaperCardPageState();
    void initializeOpenedDocumentFeatures(documentProxy);
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
    documentAgentOperationToken += 1;
    currentDocumentAgentId = '';
    currentDocumentAgentRecord = null;
    currentDocumentChunks = [];
    currentDocumentSessionCreatedAt = 0;
    documentAgentStatusText = '';
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

eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  updateControls();
  updateSummaryMetadata();
  updateChatContextPreview();
  scheduleReadingPositionSave();

  const navigationOrigin = internalNavigationHistory.at(-1);
  if (navigationOrigin?.hasDepartedOrigin && navigationOrigin.pageNumber === pageNumber) {
    scheduleInternalNavigationReturnCheck();
  }

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

outlineToggleButton?.addEventListener('click', () => {
  setLeftPanelCollapsed(!appFrame?.classList.contains('left-panel-collapsed'));
});

focusReadingToggleButton.addEventListener('click', () => {
  setFocusReadingMode(!focusReadingModeRequested);
});

aiPanelToggleButton?.addEventListener('click', () => {
  if (!paperCardPageElement.hidden) {
    void closePaperCardPage();
    setRightPanelCollapsed(false);
    setAssistantView('chat');
    return;
  }
  const willOpen = appFrame?.classList.contains('right-panel-collapsed') ?? false;
  setRightPanelCollapsed(!willOpen);
  if (willOpen) setAssistantView('chat');
});

for (const button of assistantViewButtons) {
  button.addEventListener('click', () => {
    const view = button.dataset.assistantView as AssistantView | undefined;
    if (view) setAssistantView(view);
  });
}

aiSettingsButton.addEventListener('click', () => {
  setDeepSeekSettingsOpen(!assistantSettingsOpen);
});

readingModeSelect.addEventListener('change', () => {
  const preference = readingModeSelect.value;
  if (isReadingModePreference(preference)) void setReadingModePreference(preference);
});

detectReadingModeButton.addEventListener('click', () => {
  readingModePreference = 'auto';
  void detectReadingMode(true).then(() => {
    if (pdfDocument) {
      return initializeCurrentDocumentKnowledge(pdfDocument, { force: true, restoreSession: false });
    }
  });
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

visionAiModeSelect.addEventListener('change', () => {
  updateVisionAiFieldsVisibility();
});

closeDeepSeekSettingsButton.addEventListener('click', () => {
  setDeepSeekSettingsOpen(false);
});

saveDeepSeekSettingsButton.addEventListener('click', () => {
  void saveDeepSeekConfig().then((saved) => {
    if (!saved || !pdfDocument) return;
    const documentAtSave = pdfDocument;
    if (readingModePreference === 'auto') {
      void detectReadingMode(true).then(() => {
        if (pdfDocument === documentAtSave) {
          return initializeCurrentDocumentKnowledge(documentAtSave, { restoreSession: false });
        }
      });
      return;
    }
    void initializeCurrentDocumentKnowledge(documentAtSave, { restoreSession: false });
  });
});

testDeepSeekButton.addEventListener('click', () => {
  void testDeepSeekConnection();
});

testVisionAiButton.addEventListener('click', () => {
  void testVisionAiConnection();
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
  event.preventDefault();
  const pageNumber = Number(citation.dataset.pdfPage);
  const quote = citation.dataset.pdfQuote?.trim() ?? '';
  void jumpToPdfCitation(pageNumber, quote);
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void sendChatMessage();
});

chatImageButton.addEventListener('click', () => {
  if (!chatRequestPending) chatImageInput.click();
});

chatImageInput.addEventListener('change', () => {
  const files = chatImageInput.files;
  if (files?.length) void addChatImageFiles(files);
  chatImageInput.value = '';
});

chatInput.addEventListener('paste', (event) => {
  const imageFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (imageFiles.length === 0) return;
  event.preventDefault();
  void addChatImageFiles(imageFiles);
});

clearChatButton.addEventListener('click', () => resetChatConversation());

function activateAiTab(tabName: string, animatePanel = true): void {
  const targetPanel = aiTabPanels.find((panel) => panel.dataset.aiPanel === tabName) ?? null;
  const targetWasHidden = targetPanel?.hidden ?? true;
  for (const tab of aiTabButtons) {
    tab.classList.toggle('active', tab.dataset.aiTab === tabName);
  }
  for (const panel of aiTabPanels) {
    panel.hidden = panel.dataset.aiPanel !== tabName;
  }
  if (animatePanel && targetWasHidden) revealUiElement(targetPanel, 1);

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

paperCardEntryButton?.addEventListener('click', openPaperCardPage);
paperCardBackButton.addEventListener('click', closePaperCardPage);
returnToPdfButton.addEventListener('click', closePaperCardPage);
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
  if (event.key === 'Escape' && focusReadingModeRequested) {
    event.preventDefault();
    setFocusReadingMode(false);
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
    summarySelectionText = '';
    summarySelectionPageNumber = 0;
    lastSummaryRequestKey = '';
    lastSummaryPoints = [];
    currentSummaryContext = null;
    cancelPendingSummaryGeneration();
    summaryAbortController?.abort();
  }
  cancelPendingCardGeneration();
  cardAbortController?.abort();
});

viewerElement.addEventListener('pointerup', () => {
  window.setTimeout(() => {
    const text = getViewerSelectionText();
    if (text) {
      scheduleAiSelectedSnippetUpdate();
      return;
    }
    if (activeSummaryScope === 'selection' && activeAssistantView === 'summary') {
      summarySelectionText = '';
      summarySelectionPageNumber = 0;
      lastSummaryRequestKey = '';
      lastSummaryPoints = [];
      currentSummaryContext = null;
      cancelPendingSummaryGeneration();
      summaryAbortController?.abort();
      setSummaryState('请先在当前页拖选一个句子、片段或段落，再进行总结。', true);
    }
  }, 0);
});
viewerElement.addEventListener('keyup', () => scheduleAiSelectedSnippetUpdate());
citationReturnButton.addEventListener(
  'pointerdown',
  (event) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    returnToPreviousInternalNavigationPosition();
  },
  { capture: true },
);

citationReturnButton.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();

  // Pointer activation is handled on pointerdown because the return operation
  // immediately moves and hides this floating button. Waiting for click would
  // require pointerup to still land on the same element, which is why clicking
  // its left side could previously only flash without navigating. Keyboard
  // activation still emits a click with detail === 0.
  if (event.detail === 0) {
    returnToPreviousInternalNavigationPosition();
  }
});
viewerContainer.addEventListener(
  'scroll',
  () => {
    if (!selectionContextMenu.hidden) hideSelectionContextMenu();
    if (!highlightNotePopover.hidden) hideHighlightNote();
    if (!annotationActionBar.hidden) hideAnnotationActionBar();
    if (!('onscrollend' in viewerContainer)) {
      scheduleReadingPositionSave();
      if (internalNavigationHistory.length > 0) {
        scheduleInternalNavigationReturnCheck(140);
      }
    }
  },
  { passive: true },
);
viewerContainer.addEventListener(
  'scrollend',
  () => {
    scheduleReadingPositionSave();
    scheduleInternalNavigationReturnCheck();
  },
  { passive: true },
);
window.addEventListener('resize', scheduleCustomSelectionRender);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    cancelReadingPositionSave();
    void persistCurrentReadingPosition();
  }
});
window.addEventListener('beforeunload', (event) => {
  cancelReadingPositionSave();
  void persistCurrentReadingPosition();
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
updateChatContextPreview();
updateReadingModeUi();
void loadDeepSeekConfig();
textStatus.textContent = '交互已就绪';

const source = new URLSearchParams(window.location.search).get('src');
if (source?.startsWith('http://') || source?.startsWith('https://')) {
  void openRemotePdf(source);
}
