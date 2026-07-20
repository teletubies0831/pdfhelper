import { browser } from 'wxt/browser';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import {
  ACTION_LABELS,
  SELECTION_STORAGE_KEY,
  isSelectionAction,
  type SelectionAction,
  type SelectionRequest,
} from '../../shared/selection';
import { extractPdfSource } from '../../shared/pdf-source';

import './style.css';

GlobalWorkerOptions.workerSrc = workerUrl;

const pageTitle = requiredElement<HTMLElement>('page-title');
const pageUrl = requiredElement<HTMLElement>('page-url');
const actionLabel = requiredElement<HTMLElement>('action-label');
const emptySelection = requiredElement<HTMLElement>('empty-selection');
const selectionText = requiredElement<HTMLElement>('selection-text');
const resultCard = requiredElement<HTMLElement>('result-card');
const resultText = requiredElement<HTMLElement>('result-text');
const openEnhancedViewer = requiredElement<HTMLButtonElement>('open-enhanced-viewer');
const readerBadge = requiredElement<HTMLElement>('reader-badge');
const readerStatus = requiredElement<HTMLElement>('reader-status');
const readerMetrics = requiredElement<HTMLElement>('reader-metrics');
const metricPages = requiredElement<HTMLElement>('metric-pages');
const metricTextPages = requiredElement<HTMLElement>('metric-text-pages');
const metricCharacters = requiredElement<HTMLElement>('metric-characters');
const readerPreviewWrap = requiredElement<HTMLDetailsElement>('reader-preview-wrap');
const readerPreview = requiredElement<HTMLElement>('reader-preview');
const analyzeCurrentPdf = requiredElement<HTMLButtonElement>('analyze-current-pdf');
const analyzeFileInput = requiredElement<HTMLInputElement>('analyze-file-input');

let currentSelection: SelectionRequest | null = null;
let currentTabUrl = '';

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as T;
}

function renderSelection(request: SelectionRequest | null) {
  currentSelection = request;
  const hasSelection = Boolean(request?.text);

  emptySelection.hidden = hasSelection;
  selectionText.hidden = !hasSelection;
  actionLabel.hidden = !hasSelection;

  if (!request) return;

  selectionText.textContent = request.text;
  actionLabel.textContent = ACTION_LABELS[request.action];
  resultCard.hidden = false;
  resultText.textContent = createPlaceholderResult(request.action);
}

function createPlaceholderResult(action: SelectionAction): string {
  if (action === 'card') {
    return '已接收到卡片内容。下一阶段接入本地记忆库后，将在这里保存和编辑知识卡片。';
  }

  return `已接收到“${ACTION_LABELS[action]}”请求。下一阶段接入模型 API 后，回答会显示在这里。`;
}

async function loadStoredSelection() {
  const result = await browser.storage.local.get(SELECTION_STORAGE_KEY);
  const request = result[SELECTION_STORAGE_KEY] as SelectionRequest | undefined;
  renderSelection(request ?? null);
}

async function updateCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabUrl = tab?.url || '';
  pageTitle.textContent = tab?.title || '未识别页面标题';
  pageUrl.textContent = currentTabUrl || '未获取页面地址';
  pageUrl.title = currentTabUrl;

  const source = extractPdfSource(currentTabUrl);
  analyzeCurrentPdf.disabled = !source;
  if (!source) {
    readerBadge.textContent = '需选择文件';
    readerStatus.textContent = '没有从当前标签识别到原始PDF地址，可使用“手动选择PDF”验证。';
  }
}

function setReaderState(state: 'idle' | 'loading' | 'success' | 'error', message: string) {
  readerBadge.dataset.state = state;
  readerBadge.textContent =
    state === 'loading' ? '读取中' : state === 'success' ? '读取成功' : state === 'error' ? '失败' : '未验证';
  readerStatus.textContent = message;
  analyzeCurrentPdf.disabled = state === 'loading' || !extractPdfSource(currentTabUrl);
}

async function analyzePdf(data: ArrayBuffer, sourceName: string) {
  setReaderState('loading', `正在解析 ${sourceName}…`);
  readerMetrics.hidden = true;
  readerPreviewWrap.hidden = true;

  try {
    const loadingTask = getDocument({ data });
    const pdf = await loadingTask.promise;
    let textPageCount = 0;
    let characterCount = 0;
    const previewParts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setReaderState('loading', `正在提取第 ${pageNumber} / ${pdf.numPages} 页文字…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) textPageCount += 1;
      characterCount += pageText.length;
      if (previewParts.join(' ').length < 1200 && pageText) previewParts.push(pageText);
    }

    metricPages.textContent = String(pdf.numPages);
    metricTextPages.textContent = String(textPageCount);
    metricCharacters.textContent = characterCount.toLocaleString('zh-CN');
    readerPreview.textContent = previewParts.join('\n\n').slice(0, 1200);
    readerMetrics.hidden = false;
    readerPreviewWrap.hidden = false;

    const coverage = pdf.numPages ? Math.round((textPageCount / pdf.numPages) * 100) : 0;
    setReaderState(
      'success',
      `已读取全部 ${pdf.numPages} 页，其中 ${textPageCount} 页包含可提取文字，文字页覆盖率 ${coverage}%。`,
    );
    await pdf.destroy();
  } catch (error) {
    setReaderState('error', error instanceof Error ? error.message : String(error));
  }
}

async function fetchAndAnalyzeCurrentPdf() {
  const source = extractPdfSource(currentTabUrl);
  if (!source) return;

  setReaderState('loading', '正在从当前标签取得原始PDF文件…');
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`PDF下载失败：HTTP ${response.status}`);
    await analyzePdf(await response.arrayBuffer(), source);
  } catch (error) {
    setReaderState(
      'error',
      `${error instanceof Error ? error.message : String(error)}。本地文件请确认已开启“允许访问文件 URL”，或手动选择PDF。`,
    );
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (!currentSelection || !isSelectionAction(action)) return;

    const updated: SelectionRequest = {
      ...currentSelection,
      action,
      createdAt: Date.now(),
    };

    await browser.storage.local.set({ [SELECTION_STORAGE_KEY]: updated });
    renderSelection(updated);
  });
});

openEnhancedViewer.addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('/viewer.html') });
});

analyzeCurrentPdf.addEventListener('click', () => {
  void fetchAndAnalyzeCurrentPdf();
});

analyzeFileInput.addEventListener('change', async () => {
  const file = analyzeFileInput.files?.[0];
  if (!file) return;
  await analyzePdf(await file.arrayBuffer(), file.name);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const change = changes[SELECTION_STORAGE_KEY];
  if (!change) return;
  renderSelection((change.newValue as SelectionRequest | undefined) ?? null);
});

browser.tabs.onActivated.addListener(() => {
  void updateCurrentTab();
});

browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.title) {
    void updateCurrentTab();
  }
});

void Promise.all([loadStoredSelection(), updateCurrentTab()]);
