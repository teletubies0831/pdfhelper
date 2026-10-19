import {
  countReadingStatuses,
  doiUrl,
  getDocumentOverviewMarkdown,
  hasDocumentMetadata,
  readDocumentMetadata,
  readReadingStatus,
  READING_STATUS_LABELS,
  READING_STATUS_ORDER,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';
import {
  knowledgeDetailPanelElement,
  knowledgeDocAddedElement,
  knowledgeDocAuthorsElement,
  knowledgeDocChunksElement,
  knowledgeDocDateElement,
  knowledgeDocDoiElement,
  knowledgeDocFolderSelect,
  knowledgeDocGraphButton,
  knowledgeDocIndexStateElement,
  knowledgeDocIssueElement,
  knowledgeDocLanguageElement,
  knowledgeDocMetadataButton,
  knowledgeDocMetadataNoteElement,
  knowledgeDocOpenButton,
  knowledgeDocOverviewButton,
  knowledgeDocOverviewStateElement,
  knowledgeDocPagesElement,
  knowledgeDocReadingSelect,
  knowledgeDocRelatedNoteElement,
  knowledgeDocRelatedStateElement,
  knowledgeDocRemoveButton,
  knowledgeDocSearchRelatedButton,
  knowledgeDocTitleElement,
  knowledgeDocUpdatedElement,
  knowledgeDocUrlElement,
  knowledgeReadingCountElements,
} from '../../app/viewer-elements';
import { relatedPapersAvailability, isRelatedPapersSearchRunning } from './knowledge-related-papers';
import { isMetadataExtractionRunning, metadataExtractionAvailability } from './document-metadata-extraction';

/**
 * The right-hand document inspector.
 *
 * Only **control and status** live here. The overview and the related-paper section are long documents, so they stay in
 * the existing dialog that 「查看概览」 opens: a panel that the reader has to scroll for a minute is not a panel. What the
 * panel is for is the handful of facts you need before acting — what state the document is in, and the four things you
 * can do with it.
 */

export interface DocumentPanelHandlers {
  openOverview(documentId: string): void;
  openSource(documentId: string): void;
  openGraph(documentId: string): void;
  remove(documentId: string): void;
  searchRelated(documentId: string): void;
  extractMetadata(documentId: string): void;
  changeReading(documentId: string, status: KnowledgeLibraryDocument['readingStatus']): void;
  moveToFolder(documentId: string, folderId: string | null): void;
}

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function setState(
  element: HTMLElement,
  tone: 'done' | 'running' | 'failed' | 'missing',
  text: string,
): void {
  element.textContent = text;
  element.className = `knowledge-doc-state is-${tone}`;
}

/** What the panel is currently showing. The listeners are attached once and read this, so a re-render never stacks them. */
let shown: { item: KnowledgeLibraryDocument; handlers: DocumentPanelHandlers } | null = null;
let actionsBound = false;

const LANGUAGE_LABELS: Record<string, string> = {
  en: '英语',
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  de: '德语',
  fr: '法语',
  es: '西班牙语',
  ru: '俄语',
  it: '意大利语',
  pt: '葡萄牙语',
};

/** Four names plus a count: a 12-author line turns the panel into a wall of text and hides everything under it. */
const AUTHORS_SHOWN = 4;

function languageLabel(code: string): string {
  if (!code) return '—';
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code;
}

/** Sets a metadata cell to plain text, or to a link when there is a URL to open. */
function setBiblioValue(
  element: HTMLElement,
  value: string,
  link?: { href: string; text: string; title: string },
): void {
  element.replaceChildren();
  element.classList.toggle('is-empty', !value);
  if (!value) {
    element.textContent = '—';
    return;
  }
  if (!link) {
    element.textContent = value;
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = link.href;
  anchor.textContent = link.text;
  anchor.title = link.title;
  // `noopener` because a DOI/publisher page is a third-party origin: the viewer must not be navigable by it.
  anchor.target = '_blank';
  anchor.rel = 'noreferrer noopener';
  element.append(anchor);
}

/**
 * 文献信息：what the model read off the first page, or a dash.
 *
 * A dash rather than a hidden row on purpose: "no DOI" and "metadata never extracted" are different facts, and the
 * note below the list is what tells them apart.
 */
function renderBiblio(item: KnowledgeLibraryDocument): void {
  const metadata = readDocumentMetadata(item);
  const authors = metadata.authors;
  setBiblioValue(
    knowledgeDocAuthorsElement,
    authors.length
      ? authors.length > AUTHORS_SHOWN
        ? `${authors.slice(0, AUTHORS_SHOWN).join('、')} 等 ${authors.length} 人`
        : authors.join('、')
      : '',
  );
  if (authors.length > AUTHORS_SHOWN) knowledgeDocAuthorsElement.title = authors.join('、');
  else knowledgeDocAuthorsElement.removeAttribute('title');

  setBiblioValue(knowledgeDocDateElement, metadata.publishDate);
  setBiblioValue(knowledgeDocLanguageElement, metadata.language ? languageLabel(metadata.language) : '');

  const doiUrlValue = doiUrl(metadata.doi);
  setBiblioValue(
    knowledgeDocDoiElement,
    metadata.doi,
    doiUrlValue ? { href: doiUrlValue, text: metadata.doi, title: `打开 ${doiUrlValue}` } : undefined,
  );
  setBiblioValue(
    knowledgeDocUrlElement,
    metadata.documentUrl,
    metadata.documentUrl
      ? { href: metadata.documentUrl, text: metadata.documentUrl, title: metadata.documentUrl }
      : undefined,
  );

  const availability = metadataExtractionAvailability();
  const running = isMetadataExtractionRunning(item.documentId) || item.metadataStatus === 'extracting';
  const note = ((): string => {
    if (running) return '正在读取首页信息…';
    if (item.metadataStatus === 'error') return item.metadataError || '上次提取没有成功，可以重试。';
    if (item.metadataStatus === 'extracting') return '正在读取首页信息…';
    if (item.metadataStatus === 'ready') {
      return hasDocumentMetadata(metadata)
        ? ''
        : '首页没有找到作者或 DOI。打开原文后再提取一次，通常能读到更多。';
    }
    return availability.available
      ? '添加文献时会自动读取一次首页信息；也可以现在提取。'
      : availability.reason;
  })();
  knowledgeDocMetadataNoteElement.textContent = note;
  knowledgeDocMetadataNoteElement.hidden = !note;

  knowledgeDocMetadataButton.textContent = item.metadataStatus === 'ready' || item.metadataStatus === 'error'
    ? '重新提取元数据'
    : '提取元数据';
  knowledgeDocMetadataButton.disabled = running || !availability.available;
  knowledgeDocMetadataButton.title = availability.reason;
}

/**
 * Attaches the panel's listeners exactly once.
 *
 * The earlier version rebound by cloning the element on every render, which also silently detached the two `<select>`s
 * from the module's cached handles — the second render then filled a node that was no longer in the document.
 */
function bindPanelActionsOnce(): void {
  if (actionsBound) return;
  actionsBound = true;

  // `shown?` because an empty panel must not act on the document it last displayed.
  knowledgeDocOverviewButton.addEventListener('click', () => {
    shown?.handlers.openOverview(shown.item.documentId);
  });
  knowledgeDocOpenButton.addEventListener('click', () => {
    shown?.handlers.openSource(shown.item.documentId);
  });
  knowledgeDocGraphButton.addEventListener('click', () => {
    shown?.handlers.openGraph(shown.item.documentId);
  });
  knowledgeDocRemoveButton.addEventListener('click', () => {
    shown?.handlers.remove(shown.item.documentId);
  });
  knowledgeDocSearchRelatedButton.addEventListener('click', () => {
    shown?.handlers.searchRelated(shown.item.documentId);
  });
  knowledgeDocMetadataButton.addEventListener('click', () => {
    shown?.handlers.extractMetadata(shown.item.documentId);
  });
  knowledgeDocReadingSelect.addEventListener('change', () => {
    const value = knowledgeDocReadingSelect.value;
    if (value === 'todo' || value === 'reading' || value === 'done') {
      shown?.handlers.changeReading(shown.item.documentId, value);
    }
  });
  knowledgeDocFolderSelect.addEventListener('change', () => {
    shown?.handlers.moveToFolder(shown.item.documentId, knowledgeDocFolderSelect.value || null);
  });
}

/** Fills the inspector for one document, or empties it when nothing is selected. */
export function renderDocumentPanel(
  item: KnowledgeLibraryDocument | null,
  folders: ReadonlyArray<{ id: string; name: string }>,
  handlers: DocumentPanelHandlers,
): void {
  knowledgeDetailPanelElement.hidden = !item;
  if (!item) {
    shown = null;
    return;
  }
  shown = { item, handlers };
  bindPanelActionsOnce();

  knowledgeDocTitleElement.textContent = item.documentName.replace(/\.pdf$/i, '');
  knowledgeDocTitleElement.setAttribute('title', item.documentName);

  knowledgeDocFolderSelect.replaceChildren(
    new Option('未分类', ''),
    ...folders.map((folder) => new Option(folder.name, folder.id)),
  );
  knowledgeDocFolderSelect.value = item.folderId ?? '';

  // Rebuilt rather than assigned: every <select> here is wrapped by `installReusableSelects`, whose visible label is
  // synced from DOM mutations only. `select.value = x` is invisible to its observer, so assigning would leave the
  // *previous* document's status on screen while the row it belongs to already shows the new one.
  knowledgeDocReadingSelect.replaceChildren(
    ...READING_STATUS_ORDER.map((status) => new Option(READING_STATUS_LABELS[status], status)),
  );
  knowledgeDocReadingSelect.value = readReadingStatus(item);

  knowledgeDocPagesElement.textContent = `${item.pageCount} 页`;
  knowledgeDocAddedElement.textContent = formatDate(item.addedAt);
  knowledgeDocUpdatedElement.textContent = formatDate(item.updatedAt);
  knowledgeDocChunksElement.textContent = String(item.chunkCount || 0);

  renderBiblio(item);

  if (item.indexStatus === 'ready') {
    setState(knowledgeDocIndexStateElement, 'done', `✓ 已索引（${item.chunkCount} 个片段）`);
  } else if (item.indexStatus === 'indexing') {
    setState(knowledgeDocIndexStateElement, 'running', '… 正在索引');
  } else if (item.indexStatus === 'error') {
    setState(knowledgeDocIndexStateElement, 'failed', '! 索引失败');
  } else {
    setState(knowledgeDocIndexStateElement, 'missing', '· 等待建立索引');
  }

  const overview = getDocumentOverviewMarkdown(item).trim();
  if (overview) {
    setState(
      knowledgeDocOverviewStateElement,
      'done',
      `✓ 已生成${item.overviewGeneratedAt ? `（${formatDate(item.overviewGeneratedAt)}）` : ''}`,
    );
  } else if (item.overviewStatus === 'generating') {
    setState(knowledgeDocOverviewStateElement, 'running', '… 正在生成');
  } else if (item.overviewStatus === 'error') {
    setState(knowledgeDocOverviewStateElement, 'failed', '! 生成失败');
  } else {
    setState(knowledgeDocOverviewStateElement, 'missing', '· 尚未生成');
  }

  const related = item.relatedLiteratureMarkdown?.trim() ?? '';
  if (related) {
    const usage = item.relatedLiteratureUsage;
    const calls = usage ? usage.searchCalls + usage.fetchCalls : 0;
    setState(
      knowledgeDocRelatedStateElement,
      'done',
      `✓ 已检索${calls ? `（联网 ${calls} 次）` : ''}${item.relatedLiteratureAt ? ` · ${formatDate(item.relatedLiteratureAt)}` : ''}`,
    );
  } else if (item.relatedLiteratureError) {
    setState(knowledgeDocRelatedStateElement, 'failed', '! 上次检索未完成');
  } else {
    setState(knowledgeDocRelatedStateElement, 'missing', '· 尚未检索');
  }

  // One line that says what to do next, instead of leaving the reader to work it out from three columns.
  const issue = item.overviewError || item.indexError || item.relatedLiteratureError || '';
  knowledgeDocIssueElement.hidden = !issue;
  knowledgeDocIssueElement.textContent = issue;

  const availability = relatedPapersAvailability(item);
  const running = isRelatedPapersSearchRunning(item.documentId);
  knowledgeDocSearchRelatedButton.textContent = running
    ? '检索中…'
    : related
      ? '重新检索相关论文'
      : '检索相关论文';
  knowledgeDocSearchRelatedButton.disabled = !availability.available || running;
  knowledgeDocSearchRelatedButton.title = availability.reason;
  knowledgeDocRelatedNoteElement.textContent = availability.available
    ? '检索结果会写进这份 PDF 的概览末尾，可以在「查看概览」里读到。'
    : availability.reason;

  knowledgeDocOverviewButton.textContent = overview ? '查看概览' : '生成概览';
}

/** Sidebar counters for the three reading states. */
export function renderReadingStatusCounts(documents: readonly KnowledgeLibraryDocument[]): void {
  const counts = countReadingStatuses(documents);
  for (const status of ['todo', 'reading', 'done'] as const) {
    knowledgeReadingCountElements[status].textContent = String(counts[status]);
    knowledgeReadingCountElements[status].setAttribute(
      'title',
      `${READING_STATUS_LABELS[status]}：${counts[status]} 篇`,
    );
  }
}
