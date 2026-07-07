import {
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

GlobalWorkerOptions.workerSrc = workerUrl;

const fileInput = requiredElement<HTMLInputElement>('file-input');
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
const highlightColorInput = requiredElement<HTMLInputElement>('highlight-color');
const selectionContextMenu = requiredElement<HTMLElement>('selection-context-menu');
const contextCopyButton = requiredElement<HTMLButtonElement>('context-copy');
const contextCleanCopyButton = requiredElement<HTMLButtonElement>('context-clean-copy');
const contextQuickHighlightButton = requiredElement<HTMLButtonElement>('context-quick-highlight');
const contextCreateNoteButton = requiredElement<HTMLButtonElement>('context-create-note');
const contextCurrentColor = requiredElement<HTMLElement>('context-current-color');
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
const quickHighlightButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-quick-highlight-color]'),
);
const editorModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-editor-mode]'),
);

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: viewerContainer,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
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
let selectionRenderFrame = 0;
let contextSelectionRanges: Range[] = [];
let contextSelectionText = '';
let selectedAnnotationEditor: any | null = null;
let selectedHighlightEditor: any | null = null;
let contextHighlightEditor: any | null = null;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as T;
}

function setStatus(message: string, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
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
    ...editorModeButtons,
  ]) {
    control.disabled = !hasDocument;
  }

  previousButton.disabled = !hasDocument || page <= 1;
  nextButton.disabled = !hasDocument || page >= pages;
  undoAnnotationButton.disabled = !hasDocument || !canUndoAnnotation;
  redoAnnotationButton.disabled = !hasDocument || !canRedoAnnotation;
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
      previous && rect.left <= previous.right + Math.max(previous.height, rect.height) * 0.4;

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

function renderCustomSelection() {
  clearCustomSelection();

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !viewerElement.contains(selection.anchorNode)) return;

  const ratio = getSelectionHeightRatio();
  const rectsByPage = new Map<HTMLElement, SelectionRect[]>();

  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (range.collapsed) continue;

    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const hit = document.elementFromPoint(
        Math.min(rect.right - 1, rect.left + Math.max(1, rect.width / 2)),
        rect.top + rect.height / 2,
      );
      const page = hit?.closest<HTMLElement>('.pdfViewer .page');
      if (!page) continue;

      const pageRect = page.getBoundingClientRect();
      const localRect: SelectionRect = {
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top,
        width: rect.width,
        height: rect.height,
      };
      const pageRects = rectsByPage.get(page) ?? [];
      pageRects.push(localRect);
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

function installHighlightGeometry(uiManager: AnnotationEditorUIManager) {
  const getOriginalBoxes = uiManager.getSelectionBoxes.bind(uiManager);

  uiManager.getSelectionBoxes = (textLayer: HTMLElement | null) => {
    const boxes = getOriginalBoxes(textLayer);
    if (!boxes) return null;

    const ratio = getSelectionHeightRatio();
    const rotation = textLayer?.getAttribute('data-main-rotation') ?? '0';
    const usesHorizontalHeight = rotation === '90' || rotation === '270';

    return boxes.map((box) => {
      if (usesHorizontalHeight) {
        const width = box.width * ratio;
        return { ...box, x: box.x + (box.width - width) / 2, width };
      }

      const height = box.height * ratio;
      return { ...box, y: box.y + (box.height - height) / 2, height };
    });
  };
}

function setHighlightColor(color: string) {
  highlightColorInput.value = color;
  contextCurrentColor.style.backgroundColor = color;
  annotationEditor?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color);
}

function findAnnotationEditor(target: EventTarget | null): any | null {
  if (!(target instanceof Element) || !annotationEditor) return null;
  const editorElement = target.closest<HTMLDivElement>(
    '.highlightEditor, .freeTextEditor, .inkEditor, .stampEditor, .signatureEditor',
  );
  const pageElement = target.closest<HTMLElement>('.pdfViewer .page');
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!editorElement || !Number.isInteger(pageNumber) || pageNumber < 1) return null;

  for (const editor of annotationEditor.getEditors(pageNumber - 1)) {
    if (editor.div === editorElement || editor.div?.contains(target)) return editor;
  }
  return null;
}

function findHighlightEditor(target: EventTarget | null): any | null {
  const editor = findAnnotationEditor(target);
  return editor?.editorType === 'highlight' ? editor : null;
}

function getHighlightText(editor: any): string {
  return editor?.div?.getAttribute('aria-label')?.trim() || '';
}

function getHighlightNote(editor: any): string {
  return editor?.comment?.text?.trim() || '';
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
}

function getAnnotationTypeName(editor: any): string {
  if (editor?.editorType === 'highlight') return '高亮';
  if (editor?.editorType === 'freeText') return '文本';
  if (editor?.editorType === 'ink') return '画笔';
  return '批注';
}

function hideAnnotationActionBar() {
  annotationActionBar.hidden = true;
}

function showAnnotationActionBar(editor: any) {
  if (!editor?.div) return;
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
  selectedHighlightEditor = editor.editorType === 'highlight' ? editor : null;
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
  highlightNoteTitle.textContent = note ? '高亮笔记' : '添加笔记';
  highlightNoteQuote.textContent = getHighlightText(editor);
  highlightNoteText.value = note;
  deleteHighlightNoteButton.hidden = !note;
  positionFloatingElement(highlightNotePopover, editor.div.getBoundingClientRect());
  if (focusEditor) highlightNoteText.focus();
}

function hideHighlightNote() {
  highlightNotePopover.hidden = true;
}

function saveHighlightNote() {
  if (!selectedHighlightEditor) return;
  const text = highlightNoteText.value.trim();
  selectedHighlightEditor.comment = text
    ? { text, richText: null, date: new Date(), deleted: false }
    : null;
  selectedHighlightEditor.addToAnnotationStorage?.();
  updateHighlightNoteIndicator(selectedHighlightEditor);
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
  highlightContextActions.hidden = !editor;
  contextQuickHighlightButton.hidden = Boolean(editor);
  contextCreateNoteButton.hidden = Boolean(editor);
  contextNoteButton.textContent = editor && getHighlightNote(editor) ? '编辑笔记' : '添加笔记';

  if (editor) {
    contextSelectionText = getHighlightText(editor);
    const color = typeof editor.color === 'string' ? editor.color : highlightColorInput.value;
    contextCurrentColor.style.backgroundColor = color;
  } else {
    contextCurrentColor.style.backgroundColor = highlightColorInput.value;
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
    clearCustomSelection();
  }

  const createdEditor = [...annotationEditor.getEditors(pageIndex)].find(
    (editor) => !editorsBefore.has(editor) && editor.editorType === 'highlight',
  );

  if (!createdEditor) {
    setStatus('快速高亮创建失败，请重新选择文字后再试。', true);
    return null;
  }

  setStatus('高亮已创建，当前仍为移动/选择模式。');
  return createdEditor;
}

function setEditorMode(mode: number) {
  if (!pdfDocument) return;
  pdfViewer.annotationEditorMode = { mode };
  activeEditorMode = mode;

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

async function openPdf(data: ArrayBuffer | Uint8Array, name: string) {
  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = '正在建立文字层…';

  try {
    if (pdfDocument) {
      await pdfDocument.destroy();
      pdfDocument = null;
    }

    const loadingTask = getDocument({ data });
    const documentProxy = await loadingTask.promise;
    pdfDocument = documentProxy;
    sourceName = name;
    const displayName = getDisplayFileName(name);
    documentNameElement.textContent = displayName;
    documentNameElement.title = name;
    annotationEditor = null;
    activeEditorMode = AnnotationEditorType.NONE;
    canUndoAnnotation = false;
    canRedoAnnotation = false;

    pdfViewer.setDocument(documentProxy);
    linkService.setDocument(documentProxy);
    findController.setDocument(documentProxy);
    updateControls();
  } catch (error) {
    pdfDocument = null;
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
  pdfViewer.currentScaleValue = 'page-width';
  setStatus(`${getDisplayFileName(sourceName)} · ${pdfDocument?.numPages ?? 0} 页`);
  setEditorMode(AnnotationEditorType.NONE);
  updateControls();
});

eventBus.on('pagechanging', updateControls);
eventBus.on('scalechanging', updateControls);
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
  updateControls();
});
eventBus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => {
  activeEditorMode = mode;
  updateControls();
});
eventBus.on('editorsrendered', ({ pageNumber }: { pageNumber: number }) => {
  if (!annotationEditor) return;
  for (const editor of annotationEditor.getEditors(pageNumber - 1)) {
    if (editor.editorType === 'highlight') updateHighlightNoteIndicator(editor);
  }
});
eventBus.on(
  'editingstateschanged',
  ({ details }: { details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean } }) => {
    canUndoAnnotation = Boolean(details.hasSomethingToUndo);
    canRedoAnnotation = Boolean(details.hasSomethingToRedo);
    updateControls();
  },
);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await openPdf(await file.arrayBuffer(), file.name);
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
  button.addEventListener('click', () => {
    const mode = button.dataset.editorMode;
    if (mode === 'select') setEditorMode(AnnotationEditorType.NONE);
    if (mode === 'highlight') setEditorMode(AnnotationEditorType.HIGHLIGHT);
    if (mode === 'ink') setEditorMode(AnnotationEditorType.INK);
    if (mode === 'text') setEditorMode(AnnotationEditorType.FREETEXT);
  });
}

highlightColorInput.addEventListener('input', () => {
  setHighlightColor(highlightColorInput.value);
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

contextQuickHighlightButton.addEventListener('click', () => {
  void createQuickHighlight(highlightColorInput.value);
});

contextCreateNoteButton.addEventListener('click', async () => {
  const editor = await createQuickHighlight(highlightColorInput.value);
  if (editor) showHighlightNote(editor, true);
});

contextNoteButton.addEventListener('click', () => {
  if (!contextHighlightEditor) return;
  showHighlightNote(contextHighlightEditor, true);
  hideSelectionContextMenu();
});

contextDeleteHighlightButton.addEventListener('click', () => {
  if (!contextHighlightEditor) return;
  selectHighlight(contextHighlightEditor);
  deleteSelectedHighlight();
});

viewerElement.addEventListener('contextmenu', (event) => {
  const annotation = findAnnotationEditor(event.target);
  const highlightEditor = annotation?.editorType === 'highlight' ? annotation : null;
  if (highlightEditor) {
    event.preventDefault();
    selectHighlight(highlightEditor);
    showSelectionContextMenuAt(event.clientX, event.clientY, highlightEditor);
    return;
  }

  if (annotation) {
    event.preventDefault();
    selectAnnotation(annotation);
    showAnnotationActionBar(annotation);
    return;
  }

  saveContextSelection();
  if (!contextSelectionText || !annotationEditor) return;

  event.preventDefault();
  showSelectionContextMenuAt(event.clientX, event.clientY, null);
});

viewerElement.addEventListener('pointerdown', (event) => {
  const editor = findAnnotationEditor(event.target);
  if (editor) {
    selectAnnotation(editor, false);
    hideAnnotationActionBar();
    return;
  }
  annotationEditor?.unselectAll();
  selectedAnnotationEditor = null;
  selectedHighlightEditor = null;
  contextHighlightEditor = null;
  hideSelectionContextMenu();
  hideHighlightNote();
  hideAnnotationActionBar();
});

viewerElement.addEventListener('click', (event) => {
  const editor = findAnnotationEditor(event.target);
  if (!editor) return;
  selectAnnotation(editor);
  if (editor.editorType === 'highlight' && getHighlightNote(editor)) showHighlightNote(editor);
});

document.addEventListener('pointerdown', (event) => {
  if (!selectionContextMenu.contains(event.target as Node)) hideSelectionContextMenu();
  if (
    !highlightNotePopover.contains(event.target as Node) &&
    !(event.target as Element | null)?.closest?.('.highlightEditor')
  ) {
    hideHighlightNote();
  }
  if (
    !annotationActionBar.contains(event.target as Node) &&
    !(event.target as Element | null)?.closest?.(
      '.highlightEditor, .freeTextEditor, .inkEditor, .stampEditor, .signatureEditor',
    )
  ) {
    hideAnnotationActionBar();
  }
});

annotationActionBar.addEventListener('pointerdown', (event) => event.stopPropagation());
deleteAnnotationButton.addEventListener('click', deleteSelectedAnnotation);

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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && pdfDocument) {
    event.preventDefault();
    event.stopPropagation();
    openFindBar();
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

document.addEventListener('selectionchange', scheduleCustomSelectionRender);
viewerContainer.addEventListener('scroll', scheduleCustomSelectionRender, { passive: true });
viewerContainer.addEventListener(
  'scroll',
  () => {
    hideSelectionContextMenu();
    hideHighlightNote();
    hideAnnotationActionBar();
  },
  { passive: true },
);
window.addEventListener('resize', scheduleCustomSelectionRender);

saveAnnotatedPdfButton.addEventListener('click', async () => {
  if (!pdfDocument) return;

  try {
    setStatus('正在写入批注并生成PDF…');
    const data = await pdfDocument.saveDocument();
    const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    const baseName = sourceName.split('/').pop()?.replace(/\.pdf$/i, '') || 'document';
    link.href = blobUrl;
    link.download = `${decodeURIComponent(baseName)}-批注版.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    setStatus('批注PDF已生成。');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

updateControls();

const source = new URLSearchParams(window.location.search).get('src');
if (source?.startsWith('http://') || source?.startsWith('https://')) {
  void openRemotePdf(source);
}
