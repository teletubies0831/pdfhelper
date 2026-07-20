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
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';

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
const collapseLeftPanelButton = document.getElementById('collapse-left-panel');
const aiPanelToggleButton = document.getElementById('ai-panel-toggle');
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

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: viewerContainer,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
  annotationMode: AnnotationMode.DISABLE,
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
  const blob = new Blob([bytes], { type: 'application/pdf' });

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
      if (item.dest) void linkService.goToDestination(item.dest as any);
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

const TRANSLATION_API_URL = 'http://127.0.0.1:8000/api/translate';
const EXPLANATION_API_URL = 'http://127.0.0.1:8000/api/explain';
const SUMMARY_API_URL = 'http://127.0.0.1:8000/api/summarize';
const CARD_API_URL = 'http://127.0.0.1:8000/api/generate-card';
const PAPER_CARD_API_URL = 'http://127.0.0.1:8000/api/generate-paper-card';
const AUTO_TRANSLATE_DELAY_MS = 700;
const MAX_SUMMARY_SOURCE_LENGTH = 18_000;
const MAX_CARD_SOURCE_LENGTH = 18_000;
const MAX_PAPER_CARD_SOURCE_LENGTH = 55_000;
const SUMMARY_NOTES_STORAGE_KEY = 'pdf-helper-summary-notes-v1';
const SAVED_CARDS_STORAGE_KEY = 'pdf-helper-saved-cards-v1';
const SAVED_PAPER_OVERVIEWS_STORAGE_KEY = 'pdf-helper-paper-overviews-v1';

type SummaryScope = 'selection' | 'page' | 'chapter';
type CardType = 'concept' | 'method' | 'experiment' | 'viewpoint';

interface TranslationApiResponse {
  translation?: unknown;
  detail?: unknown;
}

interface ExplanationApiResponse {
  explanation?: unknown;
  detail?: unknown;
}

interface SummaryApiResponse {
  summary?: unknown;
  detail?: unknown;
}

interface CardApiResponse {
  title?: unknown;
  explanation?: unknown;
  key_points?: unknown;
  purpose?: unknown;
  understanding?: unknown;
  detail?: unknown;
}

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
    if (!summaryPanelElement.hidden) void generateSummary();
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
    const response = await fetch(SUMMARY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: context.text,
        scope: context.rangeLabel,
        source: context.sourceLabel,
        position: context.positionLabel,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: SummaryApiResponse = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText) as SummaryApiResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`总结后端返回了非 JSON 内容：${responseText.slice(0, 160)}`);
        }
      }
    }

    if (!response.ok) {
      const detail = typeof payload.detail === 'string'
        ? payload.detail
        : `HTTP ${response.status}`;
      throw new Error(detail);
    }

    if (
      !Array.isArray(payload.summary)
      || payload.summary.some((item) => typeof item !== 'string')
    ) {
      throw new Error('总结接口没有返回有效的要点列表。');
    }

    const points = payload.summary
      .map((item) => item.trim())
      .filter(Boolean);

    if (!points.length) throw new Error('模型没有返回总结内容。');
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope) return;

    lastSummaryRequestKey = requestKey;
    renderSummaryPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (controller.signal.aborted || scopeAtStart !== activeSummaryScope) return;

    if (error instanceof TypeError) {
      setSummaryState(
        '无法连接本地总结后端。请确认 http://127.0.0.1:8000/health 可以打开。',
        true,
      );
      return;
    }

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
    if (!cardsPanelElement.hidden) void generatePaperCard();
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
    const response = await fetch(CARD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: context.text,
        card_type: getCardTypeLabel(context.cardType),
        document_title: context.documentName,
        page_number: context.pageNumber,
        position: context.positionLabel,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: CardApiResponse = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText) as CardApiResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`卡片后端返回了非 JSON 内容：${responseText.slice(0, 160)}`);
        }
      }
    }

    if (!response.ok) {
      const detail = typeof payload.detail === 'string'
        ? payload.detail
        : `HTTP ${response.status}`;
      throw new Error(detail);
    }

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

    if (error instanceof TypeError) {
      setCardState(
        '无法连接本地卡片后端。请确认 http://127.0.0.1:8000/health 可以打开。',
        true,
      );
      return;
    }

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
  paperCardPageElement.hidden = false;
  appFrame?.classList.add('paper-card-page-open');
  paperCardEntryButton?.classList.add('active');
  aiPanelToggleButton?.classList.remove('active');
  updatePaperCardDocumentName();
  paperCardPageElement.scrollTop = 0;
  void generatePaperOverviewCard();
}

function closePaperCardPage(): void {
  paperCardPageAbortController?.abort();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove('paper-card-page-open');
  paperCardEntryButton?.classList.remove('active');
  aiPanelToggleButton?.classList.add('active');
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
  if (!text || text === selectedTextForAi) return;

  selectedTextForAi = text;
  selectedTextPageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  selectedSnippetElement.textContent = text;
  selectedSnippetElement.title = text;

  // 新选区产生后，取消旧请求并等待新选区稳定。
  translationAbortController?.abort();
  explanationAbortController?.abort();
  setTranslationState('选区已更新，正在准备自动翻译…');
  setExplanationState('选区已更新，正在准备 AI 解释…');
  scheduleAutomaticTranslation(text);

  if (activeSummaryScope === 'selection') {
    lastSummaryRequestKey = '';
    lastSummaryPoints = [];
    currentSummaryContext = null;
    updateSummaryMetadata();
    if (!summaryPanelElement.hidden) scheduleSummaryGeneration();
  }

  lastCardRequestKey = '';
  currentCardContext = null;
  currentGeneratedCard = null;
  cardAbortController?.abort();
  updateCardSourceSnippet();
  if (!cardsPanelElement.hidden) scheduleCardGeneration();
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
    const response = await fetch(TRANSLATION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        target_language: '简体中文',
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: TranslationApiResponse = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText) as TranslationApiResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`翻译后端返回了非 JSON 内容：${responseText.slice(0, 160)}`);
        }
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload.detail === 'string'
          ? payload.detail
          : `HTTP ${response.status}`;

      throw new Error(detail);
    }

    if (typeof payload.translation !== 'string' || !payload.translation.trim()) {
      throw new Error('翻译接口没有返回有效内容。');
    }

    // 只展示当前选区对应的结果，防止慢请求覆盖新选区。
    if (text !== selectedTextForAi) return;

    lastTranslatedText = text;
    setTranslationState(payload.translation.trim());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (text !== selectedTextForAi) return;

    if (error instanceof TypeError) {
      setTranslationState(
        '无法连接本地翻译后端。请先启动 http://127.0.0.1:8000，'
          + '并确认浏览器可以打开 /health。',
        true,
      );
      return;
    }

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
    const response = await fetch(EXPLANATION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: ExplanationApiResponse = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText) as ExplanationApiResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`解释后端返回了非 JSON 内容：${responseText.slice(0, 160)}`);
        }
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload.detail === 'string'
          ? payload.detail
          : `HTTP ${response.status}`;

      throw new Error(detail);
    }

    if (
      !Array.isArray(payload.explanation)
      || payload.explanation.some((item) => typeof item !== 'string')
    ) {
      throw new Error('解释接口没有返回有效的要点列表。');
    }

    const points = payload.explanation
      .map((item) => item.trim())
      .filter(Boolean);

    if (!points.length) {
      throw new Error('模型没有返回解释内容。');
    }

    if (text !== selectedTextForAi) return;

    lastExplainedText = text;
    renderExplanationPoints(points);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (text !== selectedTextForAi) return;

    if (error instanceof TypeError) {
      setExplanationState(
        '无法连接本地解释后端。请确认 http://127.0.0.1:8000/health 可以打开。',
        true,
      );
      return;
    }

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
  const hasNumber = () => index < tokens.length && !isCommandToken(tokens[index]);
  const addPoint = (nextX: number, nextY: number) => {
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    x = nextX;
    y = nextY;
    points.push({ x, y });
  };

  while (index < tokens.length) {
    if (isCommandToken(tokens[index])) {
      command = tokens[index];
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
    const topRightPoint = topLinePoints.reduce(
      (best, point) => (point.x > best.x ? point : best),
      topLinePoints[0] ?? points[0],
    );

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
    resetSummaryState();
    resetCardState();
    resetPaperCardPageState();
    void renderDocumentOutline(documentProxy);
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

outlineToggleButton?.addEventListener('click', () => {
  setLeftPanelCollapsed(!appFrame?.classList.contains('left-panel-collapsed'));
});

collapseLeftPanelButton?.addEventListener('click', () => {
  setLeftPanelCollapsed(true);
});

aiPanelToggleButton?.addEventListener('click', () => {
  if (!paperCardPageElement.hidden) {
    closePaperCardPage();
    return;
  }
  appFrame?.classList.toggle('right-panel-collapsed');
});

function activateAiTab(tabName: string): void {
  for (const tab of aiTabButtons) {
    tab.classList.toggle('active', tab.dataset.aiTab === tabName);
  }
  for (const panel of aiTabPanels) {
    panel.hidden = panel.dataset.aiPanel !== tabName;
  }

  if (tabName === 'summary') {
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
    cancelPendingSummaryGeneration();
    summaryAbortController?.abort();
  }
  cancelPendingCardGeneration();
  cardAbortController?.abort();
});

viewerElement.addEventListener('pointerup', () => scheduleAiSelectedSnippetUpdate());
viewerElement.addEventListener('keyup', () => scheduleAiSelectedSnippetUpdate());
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
textStatus.textContent = '交互已就绪';

const source = new URLSearchParams(window.location.search).get('src');
if (source?.startsWith('http://') || source?.startsWith('https://')) {
  void openRemotePdf(source);
}
