import {
  countReadingStatuses,
  doiUrl,
  extractOfflineDocumentMetadata,
  getDocumentOverviewMarkdown,
  hasDocumentMetadata,
  isMetadataMissing,
  METADATA_FIELDS,
  readDocumentMetadata,
  readMetadataSources,
  readReadingStatus,
  READING_STATUS_LABELS,
  READING_STATUS_ORDER,
  type KnowledgeDocumentMetadata,
  type KnowledgeLibraryDocument,
  type KnowledgeMetadataSource,
  type MetadataCandidate,
} from '../../../modules/knowledge/public';
import {
  knowledgeDetailPanelElement,
  knowledgeDocAddedElement,
  knowledgeDocAuthorsElement,
  knowledgeDocAuthorsInput,
  knowledgeDocBiblioEditElement,
  knowledgeDocBiblioViewElement,
  knowledgeDocChunksElement,
  knowledgeDocDateElement,
  knowledgeDocDateInput,
  knowledgeDocDoiElement,
  knowledgeDocDoiInput,
  knowledgeDocFolderSelect,
  knowledgeDocGraphButton,
  knowledgeDocIdentifierInput,
  knowledgeDocIndexStateElement,
  knowledgeDocIssueElement,
  knowledgeDocLanguageElement,
  knowledgeDocLanguageInput,
  knowledgeDocMetadataButton,
  knowledgeDocMetadataCancelButton,
  knowledgeDocMetadataEditButton,
  knowledgeDocMetadataActionsElement,
  knowledgeDocMetadataOnlineButton,
  knowledgeDocMetadataNoteElement,
  knowledgeDocMetadataSaveButton,
  knowledgeDocMetadataSkipButton,
  knowledgeDocMetadataSuggestionListElement,
  knowledgeDocMetadataSuggestionsElement,
  knowledgeDocMetadataSuggestionsNoteElement,
  knowledgeDocOpenButton,
  knowledgeDocOverviewButton,
  knowledgeDocOverviewStateElement,
  knowledgeDocPagesElement,
  knowledgeDocReadingSelect,
  knowledgeDocRelatedNoteElement,
  knowledgeDocRelatedContentElement,
  knowledgeDocRelatedStateElement,
  knowledgeDocRemoveButton,
  knowledgeDocSearchRelatedButton,
  knowledgeDocTitleElement,
  knowledgeDocUpdatedElement,
  knowledgeDocUrlElement,
  knowledgeDocUrlInput,
  knowledgeMissingCountElement,
  knowledgeReadingCountElements,
} from '../../app/viewer-elements';
import { relatedPapersAvailability, isRelatedPapersSearchRunning } from './knowledge-related-papers';
import { isMetadataExtractionRunning, metadataExtractionAvailability } from './document-metadata-extraction';
import { getDocumentChunks } from '../../../modules/document-agent/public';
import { readMetadataLookupState } from './metadata-lookup';
import { renderChatMarkdown } from '../../shared-ui/markdown/markdown-renderer';

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
  /** Manual edits and the 「无需补全」 decision; both are the user's own statements about the record. */
  saveMetadata(documentId: string, metadata: KnowledgeDocumentMetadata): void;
  toggleMetadataSkip(documentId: string, skipped: boolean): void;
  /** 联网查找：opt-in, free, and the result is only ever a suggestion. */
  lookupMetadata(documentId: string): void;
  applyMetadataSuggestion(documentId: string, candidate: MetadataCandidate): void;
  dismissMetadataSuggestions(documentId: string): void;
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

/** Sets a metadata cell to plain text, or to a link when there is a URL to open, with an optional source badge. */
function setBiblioValue(
  element: HTMLElement,
  value: string,
  link?: { href: string; text: string; title: string },
  source?: { text: string; title: string },
): void {
  element.replaceChildren();
  element.classList.toggle('is-empty', !value);
  if (value) {
    if (!link) {
      element.textContent = value;
    } else {
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.textContent = link.text;
      anchor.title = link.title;
      // `noopener` because a DOI/publisher page is a third-party origin: the viewer must not be navigable by it.
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
      element.append(anchor);
    }
  } else {
    element.textContent = '—';
  }
  if (source?.text) {
    const badge = document.createElement('span');
    badge.className = 'knowledge-doc-source';
    badge.textContent = source.text;
    badge.title = source.title;
    element.append(badge);
  }
}

/**
 * 文献信息：what the file states, what the model read, and what the user typed — or a dash.
 *
 * A dash rather than a hidden row on purpose: "no DOI" and "metadata never extracted" are different facts, and the
 * note below the list is what tells them apart.
 */

/** Which fields are still blank, in the inspector's order, with the label the note uses. */
const METADATA_MISSING_LABELS: Array<[string, (metadata: KnowledgeDocumentMetadata) => boolean]> = [
  ['作者', (metadata) => metadata.authors.length > 0],
  ['出版日期', (metadata) => Boolean(metadata.publishDate)],
  ['DOI', (metadata) => Boolean(metadata.doi)],
];

/** The source badge shown after a value: only where it tells the user something (manual, or read from the file). */
const SOURCE_LABELS: Record<KnowledgeMetadataSource, string> = {
  manual: '手动',
  pdf: 'PDF 属性',
  text: '文件内',
  ai: '模型读首页',
  online: '在线确认',
};

/**
 * Fills the read-only list, with a small source hint per field.
 *
 * The hint is the point of the whole provenance scheme: "DOI · 手动" is a promise that the next automatic pass will not
 * touch it, and "发表日期 · 文件内" tells the user where a surprising date came from.
 */
function renderBiblio(item: KnowledgeLibraryDocument): void {
  const metadata = readDocumentMetadata(item);
  const sources = readMetadataSources(item);
  const authors = metadata.authors;
  const hint = (field: keyof KnowledgeDocumentMetadata): KnowledgeMetadataSource | undefined => sources[field];
  setBiblioValue(
    knowledgeDocAuthorsElement,
    authors.length
      ? authors.length > AUTHORS_SHOWN
        ? `${authors.slice(0, AUTHORS_SHOWN).join('、')} 等 ${authors.length} 人`
        : authors.join('、')
      : '',
    undefined,
    { text: hint('authors') ? SOURCE_LABELS[hint('authors')!] : '', title: '这一项的来源' },
  );
  if (authors.length > AUTHORS_SHOWN) knowledgeDocAuthorsElement.title = authors.join('、');
  else knowledgeDocAuthorsElement.removeAttribute('title');

  setBiblioValue(knowledgeDocDateElement, metadata.publishDate, undefined, {
    text: hint('publishDate') ? SOURCE_LABELS[hint('publishDate')!] : '', title: '这一项的来源',
  });
  setBiblioValue(
    knowledgeDocLanguageElement,
    metadata.language ? languageLabel(metadata.language) : '',
    undefined,
    { text: hint('language') ? SOURCE_LABELS[hint('language')!] : '', title: '这一项的来源' },
  );

  const doiUrlValue = doiUrl(metadata.doi);
  setBiblioValue(
    knowledgeDocDoiElement,
    metadata.doi,
    doiUrlValue ? { href: doiUrlValue, text: metadata.doi, title: `打开 ${doiUrlValue}` } : undefined,
    { text: hint('doi') ? SOURCE_LABELS[hint('doi')!] : '', title: '这一项的来源' },
  );
  setBiblioValue(
    knowledgeDocUrlElement,
    metadata.documentUrl,
    metadata.documentUrl
      ? { href: metadata.documentUrl, text: metadata.documentUrl, title: metadata.documentUrl }
      : undefined,
    { text: hint('documentUrl') ? SOURCE_LABELS[hint('documentUrl')!] : '', title: '这一项的来源' },
  );

  const availability = metadataExtractionAvailability();
  const running = isMetadataExtractionRunning(item.documentId) || item.metadataStatus === 'extracting';
  const missingFields = METADATA_MISSING_LABELS.filter(([, has]) => !has(metadata));
  const note = ((): string => {
    if (item.metadataStatus === 'skipped') return '已标记为无需补全，不再自动读取，也不会出现在「缺元数据」里。';
    if (running) return '正在读取文件信息…';
    if (item.metadataStatus === 'error') return item.metadataError || '上次提取没有成功，可以重试。';
    if (item.metadataStatus === 'ready') {
      // Three different blanks, three different sentences: "we looked and it is not there" must not read like "nobody
      // has looked yet", and neither may sound like an error the user has to fix.
      if (!hasDocumentMetadata(metadata)) {
        return '查过：这份文件里没有写作者、发表日期或 DOI。可以手动填写（粘贴 DOI / arXiv 编号最快），或标记为无需补全。';
      }
      return missingFields.length
        ? `文件里没有${missingFields.map(([label]) => label).join('、')}，可手动补充。`
        : '';
    }
    return availability.available
      ? '还没查过。保存文献时会自动读一次首页与 PDF 属性；也可以现在提取。'
      : availability.reason;
  })();
  knowledgeDocMetadataNoteElement.textContent = note;
  knowledgeDocMetadataNoteElement.hidden = !note;

  knowledgeDocMetadataButton.textContent = item.metadataStatus === 'ready' || item.metadataStatus === 'error'
    ? '重新提取'
    : '提取元数据';
  knowledgeDocMetadataButton.disabled = running || !availability.available;
  knowledgeDocMetadataButton.title = availability.reason;
  knowledgeDocMetadataSkipButton.textContent = item.metadataStatus === 'skipped'
    ? '取消「无需补全」'
    : '标记为无需补全';
  knowledgeDocMetadataSkipButton.dataset.skipped = item.metadataStatus === 'skipped' ? 'true' : 'false';
  renderMetadataSuggestions(item);
  // Any document switch closes the editor: it holds one document's values, and carrying them to the next would invite a
  // save that writes the wrong paper's data.
  closeBiblioEditor();
}

/**
 * 联网查找的候选.
 *
 * Accepted suggestions get a 填入 button; refused ones are listed with the reason they were refused. Both are shown
 * because "we looked and this is what came back, but it is not your paper" is the answer that stops the user from
 * wondering — while the write only ever happens on an accepted one, and only after a click.
 */
function renderMetadataSuggestions(item: KnowledgeLibraryDocument): void {
  const state = readMetadataLookupState(item.documentId);
  const accepting = state.suggestions.filter((suggestion) => suggestion.accepted).slice(0, MAX_SUGGESTIONS_SHOWN);
  const refused = state.suggestions.filter((suggestion) => !suggestion.accepted).slice(0, 1);
  const visible = [...accepting, ...refused];

  knowledgeDocMetadataOnlineButton.textContent = state.running ? '查找中…' : '联网查找';
  knowledgeDocMetadataOnlineButton.disabled = state.running;
  knowledgeDocMetadataOnlineButton.title = state.running
    ? '正在向 Crossref / OpenAlex 发送标题'
    : '只在点击时联网：把标题发给 Crossref 与 OpenAlex（免费、不需要 Key）';

  knowledgeDocMetadataSuggestionsElement.hidden = !state.running && !state.lookedUp && !visible.length;
  if (knowledgeDocMetadataSuggestionsElement.hidden) {
    knowledgeDocMetadataSuggestionListElement.replaceChildren();
    return;
  }
  knowledgeDocMetadataSuggestionsNoteElement.textContent = state.running
    ? '正在查找 Crossref / OpenAlex…'
    : state.message;

  knowledgeDocMetadataSuggestionListElement.replaceChildren(...visible.map((suggestion) => {
    const row = document.createElement('li');
    row.className = 'knowledge-doc-suggestion';
    row.dataset.accepted = suggestion.accepted ? 'true' : 'false';

    const title = document.createElement('span');
    title.className = 'knowledge-doc-suggestion-title';
    title.textContent = suggestion.candidate.title;
    row.append(title);

    const meta = document.createElement('span');
    meta.className = 'knowledge-doc-suggestion-meta';
    meta.textContent = [
      suggestion.candidate.publishDate,
      suggestion.candidate.authors.slice(0, 2).join('、'),
      suggestion.candidate.source === 'crossref' ? 'Crossref' : 'OpenAlex',
      suggestion.candidate.doi,
    ].filter(Boolean).join(' · ');
    row.append(meta);

    if (!suggestion.accepted) {
      const reason = document.createElement('span');
      reason.className = 'knowledge-doc-suggestion-reason';
      reason.textContent = suggestion.reason || '无法确认是同一篇';
      row.append(reason);
      return row;
    }

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'knowledge-doc-suggestion-apply';
    apply.textContent = '填入';
    apply.title = '把这条记录的 DOI、日期、作者填进文献信息（会保留你手填的字段）';
    apply.addEventListener('click', () => {
      shown?.handlers.applyMetadataSuggestion(shown.item.documentId, suggestion.candidate);
    });
    row.append(apply);
    return row;
  }));

  if (state.suggestions.length) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'knowledge-doc-suggestion-dismiss';
    dismiss.textContent = '都不对';
    dismiss.addEventListener('click', () => shown?.handlers.dismissMetadataSuggestions(shown.item.documentId));
    knowledgeDocMetadataSuggestionListElement.append(dismiss);
  }
}

/** How many rows the panel shows. More than three and it stops being a panel. */
const MAX_SUGGESTIONS_SHOWN = 3;

/**
 * Checks the cached 片段数量 against the chunks that actually exist.
 *
 * One IndexedDB read, only for documents that claim to be indexed. When they disagree, the panel says so and says what
 * fixes it — the alternative is a green ✓ that the graph page contradicts a screen later.
 */
async function verifyStoredChunkCount(item: KnowledgeLibraryDocument): Promise<void> {
  let actual = 0;
  let failure = '';
  try {
    const chunks = await getDocumentChunks(item.documentId);
    actual = chunks.filter((chunk) => chunk.text.trim().length > 0).length;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  // A later render may have replaced the panel; never write into another document's row.
  if (shown?.item.documentId !== item.documentId) return;
  if (failure) {
    setState(
      knowledgeDocIndexStateElement,
      'failed',
      `! 读取本地索引失败：${failure}`,
    );
    return;
  }
  if (actual === item.chunkCount) return;
  setState(
    knowledgeDocIndexStateElement,
    actual > 0 ? 'done' : 'failed',
    actual > 0
      ? `✓ 已索引（实际 ${actual} 个片段，记录里是 ${item.chunkCount}）`
      : `! 索引数据缺失（记录里有 ${item.chunkCount} 个片段，实际 0）：打开原文会重建索引`,
  );
}

/** Swaps the read-only list for the form, pre-filled from what is stored. */
function openBiblioEditor(): void {
  if (!shown) return;
  const metadata = readDocumentMetadata(shown.item);
  knowledgeDocAuthorsInput.value = metadata.authors.join('、');
  knowledgeDocDateInput.value = metadata.publishDate;
  knowledgeDocLanguageInput.value = metadata.language;
  knowledgeDocDoiInput.value = metadata.doi;
  knowledgeDocUrlInput.value = metadata.documentUrl;
  knowledgeDocIdentifierInput.value = '';
  knowledgeDocIdentifierInput.removeAttribute('title');
  knowledgeDocBiblioViewElement.hidden = true;
  knowledgeDocBiblioEditElement.hidden = false;
  // The form has its own 保存 / 取消 pair; leaving 重新提取 and 手动填写 next to them would be four buttons for two actions.
  knowledgeDocMetadataActionsElement.hidden = true;
  window.setTimeout(() => knowledgeDocAuthorsInput.focus(), 0);
}

function closeBiblioEditor(): void {
  if (knowledgeDocBiblioEditElement.hidden) return;
  knowledgeDocBiblioEditElement.hidden = true;
  knowledgeDocBiblioViewElement.hidden = false;
  knowledgeDocMetadataActionsElement.hidden = false;
}

/** Reads the form into a metadata record. The module normalises it, so a sloppy paste is still accepted. */
function readBiblioEditor(): KnowledgeDocumentMetadata {
  return {
    authors: knowledgeDocAuthorsInput.value.split(/\s*(?:、|;|；|\band\b|&)\s*|\s*,\s*(?=[A-Z])/u).filter(Boolean),
    publishDate: knowledgeDocDateInput.value,
    language: knowledgeDocLanguageInput.value,
    documentUrl: knowledgeDocUrlInput.value,
    doi: knowledgeDocDoiInput.value,
  };
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
  knowledgeDocMetadataEditButton.addEventListener('click', () => {
    if (knowledgeDocBiblioEditElement.hidden) openBiblioEditor();
    else closeBiblioEditor();
  });
  knowledgeDocMetadataCancelButton.addEventListener('click', () => closeBiblioEditor());
  knowledgeDocMetadataSaveButton.addEventListener('click', () => {
    if (!shown) return;
    shown.handlers.saveMetadata(shown.item.documentId, readBiblioEditor());
  });
  knowledgeDocMetadataSkipButton.addEventListener('click', () => {
    if (!shown) return;
    shown.handlers.toggleMetadataSkip(
      shown.item.documentId,
      shown.item.metadataStatus !== 'skipped',
    );
  });
  knowledgeDocMetadataOnlineButton.addEventListener('click', () => {
    shown?.handlers.lookupMetadata(shown.item.documentId);
  });
  // Pasting an identifier is the fastest correct path when the file states nothing: parse it with the same offline rules
  // the add-time pass uses, then let the user review the fields before pressing 保存.
  knowledgeDocIdentifierInput.addEventListener('change', () => {
    const pasted = knowledgeDocIdentifierInput.value.trim();
    if (!pasted) return;
    const { fromText } = extractOfflineDocumentMetadata({
      documentName: '',
      headText: pasted,
      pdfInfo: null,
    });
    if (fromText.doi) knowledgeDocDoiInput.value = fromText.doi;
    if (fromText.documentUrl) knowledgeDocUrlInput.value = fromText.documentUrl;
    if (fromText.publishDate) knowledgeDocDateInput.value = fromText.publishDate;
    if (!fromText.doi && !fromText.documentUrl) {
      // Nothing recognisable: keep the text where it is rather than silently doing nothing.
      knowledgeDocIdentifierInput.title = '没认出 DOI 或 arXiv 编号，可以直接填上面几项';
      return;
    }
    const target = fromText.doi ? knowledgeDocDoiInput : knowledgeDocUrlInput;
    target.focus();
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
    // 记录里的片段数是入库时写下的缓存值，之后没人核对过。真正的正文分块在 IndexedDB 里，图谱抽取读的是那一份，
    // 两者可能不一致——这时面板必须说实话，否则「已索引」会把人引到「为什么抽取说没有索引」的死胡同。
    void verifyStoredChunkCount(item);
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
  renderRelatedLiterature(item);
  knowledgeDocRelatedNoteElement.textContent = related
    // The 处理状态 section already says which sources ran and when; repeating it here would be noise.
    ? ''
    : running
      ? '正在检索相关论文…'
      : availability.available
        ? '检索一次会联网检索并整理成一份清单（费用见上方的检索按钮说明）。'
        : availability.reason;

  knowledgeDocOverviewButton.textContent = overview ? '查看概览' : '生成概览';
}

/**
 * 相关论文正文，直接渲染在右栏.
 *
 * It used to live only at the end of the 概览 dialog, which meant reading it required opening another window and
 * scrolling past the whole overview first — the section sat right next to a button that produced content the user
 * could not see. The panel is the place for it: same markdown renderer as the dialog, minus the stored section's own
 * 「相关论文」 heading (the section is already titled that).
 */
function renderRelatedLiterature(item: KnowledgeLibraryDocument): void {
  const markdown = (item.relatedLiteratureMarkdown ?? '').trim();
  if (!markdown) {
    knowledgeDocRelatedContentElement.hidden = true;
    knowledgeDocRelatedContentElement.replaceChildren();
    return;
  }
  knowledgeDocRelatedContentElement.hidden = false;
  renderChatMarkdown(knowledgeDocRelatedContentElement, stripRelatedHeading(markdown), false);
}

/** Drops a leading `## 相关论文` line, which the section's own `<h3>` already says. */
function stripRelatedHeading(markdown: string): string {
  return markdown.replace(/^#{1,3}\s*相关论文\s*(?:\r?\n)+/, '');
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

/** The 缺元数据 counter: documents still waiting for a DOI/date/author, excluding the ones the user waved through. */
export function renderMetadataMissingCount(documents: readonly KnowledgeLibraryDocument[]): void {
  const missing = documents.filter(isMetadataMissing).length;
  knowledgeMissingCountElement.textContent = String(missing);
  knowledgeMissingCountElement.setAttribute('title', `缺元数据：${missing} 篇`);
}
