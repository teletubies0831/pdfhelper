import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';

/**
 * The knowledge library's two new halves: the table view and the document inspector.
 *
 * Both are rendering code, so they are exercised in a real DOM — the knowledge-base template with the *real* stylesheets,
 * which is the only way to catch a layout rule that quietly disagrees with the markup (a hidden view that stays visible
 * because some older rule sets `display: grid !important`, say). Dependencies are mocked; the reading-status module is not:
 * the rule that opening a paper marks it 在读 but never undoes 已读 is the one piece of behaviour here that a rendering
 * test cannot stand in for, so it runs for real against an in-memory corpus.
 */

const root = new URL('../', import.meta.url);

/** Flattens `@import` so the browser sees one stylesheet, exactly as the built extension does. */
async function stylesheet(url) {
  let source = await readFile(url, 'utf8');
  for (const match of [...source.matchAll(/@import url\(["']([^"']+)["']\);/g)]) {
    source = source.replace(match[0], await stylesheet(new URL(match[1], url)));
  }
  return source;
}

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function readSource(path) {
  return transpile(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

let browser;
let page;

before(async () => {
  const sources = {
    readingStatus: await readSource('src/modules/knowledge/application/document-reading-status.ts'),
    metadata: await readSource('src/modules/knowledge/application/document-metadata.ts'),
    tableModel: await readSource('src/viewer/features/knowledge-base/library-table-model.ts'),
    table: await readSource('src/viewer/features/knowledge-base/library-table.ts'),
    panel: await readSource('src/viewer/features/knowledge-base/library-doc-panel.ts'),
    viewMode: await readSource('src/viewer/features/knowledge-base/library-view-mode.ts'),
    selection: await readSource('src/viewer/features/knowledge-base/library-selection.ts'),
    batchActions: await readSource('src/viewer/features/knowledge-base/library-batch-actions.ts'),
    metadataService: await readSource('src/background/ai/document-metadata-service.ts'),
    identityMatch: await readSource('src/modules/knowledge/application/document-identity-match.ts'),
    heuristics: await readSource('src/modules/knowledge/application/document-metadata-heuristics.ts'),
    bibliographicMatch: await readSource('src/modules/knowledge/application/bibliographic-match.ts'),
    citationFormat: await readSource('src/modules/knowledge/application/citation-format.ts'),
    citationDialog: await readSource('src/viewer/features/knowledge-base/citation-dialog.ts'),
    biblioForm: await readSource('src/viewer/features/knowledge-base/library-biblio-form.ts'),
    suggestionsList: await readSource('src/viewer/features/knowledge-base/library-metadata-suggestions.ts'),
    resumeReading: await readSource('src/viewer/features/knowledge-base/resume-reading.ts'),
    lookupService: await readSource('src/background/ai/bibliographic-lookup-service.ts'),
    metadataLookupClient: await readSource('src/viewer/features/knowledge-base/metadata-lookup.ts'),
    dataHealthDialog: await readSource('src/viewer/features/knowledge-base/data-health-dialog.ts'),
    corpusAdapter: await readSource('src/modules/knowledge/adapters/browser-document-corpus.ts'),
    fileHandleStore: await readSource('src/modules/knowledge/adapters/browser-file-handle-store.ts'),
    customSelect: await readSource('src/viewer/shared-ui/select/custom-select.ts'),
  };

  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A real origin, not `about:blank`: the corpus adapter stores into `localStorage`, which a `setContent` page refuses to
  // expose. Serving the template from a routed origin is the smallest way to get a storage-backed document.
  const template = [
    await readFile(new URL('../src/viewer/templates/knowledge-base.html', import.meta.url), 'utf8'),
    // The dialogs live in their own partial; the health dialog is exercised here, so it has to be in the page.
    await readFile(new URL('../src/viewer/templates/knowledge-base-overlays.html', import.meta.url), 'utf8'),
  ].join('\n');
  await page.route('https://pdfpal.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: template,
  }));
  await page.goto('https://pdfpal.test/viewer.html');
  await page.addStyleTag({ content: await stylesheet(new URL('entrypoints/viewer/style.css', root)) });

  await page.evaluate((code) => {
    const byId = (id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing element #${id}`);
      return element;
    };

    const elements = {
      knowledgeTableBodyElement: byId('knowledge-table-body'),
      knowledgeTableEmptyElement: byId('knowledge-table-empty'),
      knowledgeTableWrapElement: byId('knowledge-table-wrap'),
      knowledgeListElement: byId('knowledge-list'),
      knowledgeViewListButton: byId('knowledge-view-list'),
      knowledgeViewGridButton: byId('knowledge-view-grid'),
      knowledgeTableSortButtons: [...document.querySelectorAll('[data-knowledge-sort]')],
      knowledgeDetailPanelElement: byId('knowledge-detail-panel'),
      knowledgeDocTitleElement: byId('knowledge-doc-title'),
      knowledgeDocFolderSelect: byId('knowledge-doc-folder'),
      knowledgeDocReadingSelect: byId('knowledge-doc-reading'),
      knowledgeDocPagesElement: byId('knowledge-doc-pages'),
      knowledgeDocAddedElement: byId('knowledge-doc-added'),
      knowledgeDocUpdatedElement: byId('knowledge-doc-updated'),
      knowledgeDocChunksElement: byId('knowledge-doc-chunks'),
      knowledgeDocIndexStateElement: byId('knowledge-doc-index-state'),
      knowledgeDocOverviewStateElement: byId('knowledge-doc-overview-state'),
      knowledgeDocRelatedStateElement: byId('knowledge-doc-related-state'),
      knowledgeDocIssueElement: byId('knowledge-doc-issue'),
      knowledgeDocRelatedNoteElement: byId('knowledge-doc-related-note'),
      knowledgeDocRelatedContentElement: byId('knowledge-doc-related-content'),
      knowledgeDocSearchRelatedButton: byId('knowledge-doc-search-related'),
      knowledgeDocOverviewButton: byId('knowledge-doc-overview'),
      knowledgeDocOpenButton: byId('knowledge-doc-open'),
      knowledgeDocGraphButton: byId('knowledge-doc-graph'),
      knowledgeDocRemoveButton: byId('knowledge-doc-remove'),
      knowledgeDocCitationButton: byId('knowledge-doc-citation'),
      knowledgeDocBiblioContainerElement: byId('knowledge-doc-container'),
      knowledgeDocBiblioVolumeElement: byId('knowledge-doc-volume'),
      knowledgeDocBiblioPagesElement: byId('knowledge-doc-biblio-pages'),
      knowledgeDocBiblioPublisherElement: byId('knowledge-doc-publisher'),
      knowledgeDocBiblioIdentifiersElement: byId('knowledge-doc-identifiers'),
      knowledgeDocTitleElement: byId('knowledge-doc-biblio-title'),
      knowledgeDocNameElement: byId('knowledge-doc-title'),
      knowledgeDocTitleInput: byId('knowledge-doc-biblio-title-input'),
      knowledgeDocBiblioContainerInput: byId('knowledge-doc-container-input'),
      knowledgeDocBiblioVolumeInput: byId('knowledge-doc-volume-input'),
      knowledgeDocBiblioIssueInput: byId('knowledge-doc-issue-input'),
      knowledgeDocBiblioPagesInput: byId('knowledge-doc-page-input'),
      knowledgeDocBiblioPublisherInput: byId('knowledge-doc-publisher-input'),
      knowledgeDocBiblioPublisherPlaceInput: byId('knowledge-doc-publisher-place-input'),
      knowledgeDocAuthorsElement: byId('knowledge-doc-authors'),
      knowledgeDocDateElement: byId('knowledge-doc-publish-date'),
      knowledgeDocLanguageElement: byId('knowledge-doc-language'),
      knowledgeDocDoiElement: byId('knowledge-doc-doi'),
      knowledgeDocUrlElement: byId('knowledge-doc-url'),
      knowledgeDocMetadataNoteElement: byId('knowledge-doc-metadata-note'),
      knowledgeDocMetadataButton: byId('knowledge-doc-metadata'),
      knowledgeDocBiblioViewElement: byId('knowledge-doc-biblio-view'),
      knowledgeDocBiblioEditElement: byId('knowledge-doc-biblio-edit'),
      knowledgeDocAuthorsInput: byId('knowledge-doc-authors-input'),
      knowledgeDocDateInput: byId('knowledge-doc-publish-date-input'),
      knowledgeDocLanguageInput: byId('knowledge-doc-language-input'),
      knowledgeDocDoiInput: byId('knowledge-doc-doi-input'),
      knowledgeDocUrlInput: byId('knowledge-doc-url-input'),
      knowledgeDocIdentifierInput: byId('knowledge-doc-identifier-input'),
      knowledgeDocMetadataSaveButton: byId('knowledge-doc-metadata-save'),
      knowledgeDocMetadataCancelButton: byId('knowledge-doc-metadata-cancel'),
      knowledgeDocMetadataEditButton: byId('knowledge-doc-metadata-edit'),
      knowledgeDocMetadataSkipButton: byId('knowledge-doc-metadata-skip'),
      knowledgeDocMetadataActionsElement: byId('knowledge-doc-metadata-actions'),
      knowledgeDocMetadataOnlineButton: byId('knowledge-doc-metadata-online'),
      knowledgeDocMetadataSuggestionsElement: byId('knowledge-doc-metadata-suggestions'),
      knowledgeDocMetadataSuggestionsNoteElement: byId('knowledge-doc-metadata-suggestions-note'),
      knowledgeDocMetadataSuggestionListElement: byId('knowledge-doc-metadata-suggestion-list'),
      knowledgeMissingCountElement: byId('knowledge-missing-count'),
      knowledgeDataHealthCountElement: byId('knowledge-data-health-count'),
      knowledgeDataHealthEntryButton: byId('knowledge-data-health-entry'),
      knowledgeMetadataFilterButtons: Array.from(document.querySelectorAll('[data-metadata-filter]')),      knowledgeReadingCountElements: {
        todo: byId('knowledge-reading-count-todo'),
        reading: byId('knowledge-reading-count-reading'),
        done: byId('knowledge-reading-count-done'),
      },
    };

    const related = {
      relatedPapersAvailability: () => ({ available: true, reason: '' }),
      isRelatedPapersSearchRunning: () => false,
    };

    // The markdown renderer is a stub here: this harness is testing where the section is rendered and that the stored
    // heading is not repeated, not marked/DOMPurify (which `test-overview-markdown` covers).
    const markdownCalls = [];
    const markdownRenderer = {
      renderChatMarkdown: (container, markdown) => {
        markdownCalls.push(markdown);
        container.textContent = markdown;
      },
    };

    // An in-memory corpus standing in for the browser adapter: the reading-status module itself is the real one.
    const corpusDocuments = new Map();
    const corpus = {
      getKnowledgeDocument: (documentId) => corpusDocuments.get(documentId),
      updateKnowledgeDocument: (documentId, changes) => {
        const document = corpusDocuments.get(documentId);
        if (document) Object.assign(document, changes);
      },
    };

    const load = (source, requires) => {
      const exports = {};
      new Function('require', 'exports', source)(requires, exports);
      return exports;
    };
    const fail = (name) => {
      throw new Error(`Unmocked dependency: ${name}`);
    };

    const readingStatus = load(code.readingStatus, (name) => (
      name === '../adapters/browser-document-corpus' ? corpus : fail(name)
    ));

    const metadata = load(code.metadata, (name) => (
      name === '../adapters/browser-document-corpus' ? corpus : fail(name)
    ));

    // The knowledge module's public surface, as far as these renderers use it.
    const knowledge = {
      ...readingStatus,
      ...metadata,
      getDocumentOverviewMarkdown: (item) => item.overviewMarkdown ?? '',
    };

    // 免费离线层: pure regexes over the file, so it loads against the metadata module alone.
    const heuristics = load(code.heuristics, (name) => (
      name === './document-metadata' ? metadata : fail(name)
    ));
    knowledge.extractOfflineDocumentMetadata = heuristics.extractOfflineDocumentMetadata;

    // 在线匹配的门槛：纯判定，没有网络。
    const bibliographicMatch = load(code.bibliographicMatch, fail);
    for (const [key, value] of Object.entries(bibliographicMatch)) knowledge[key] = value;

    // 引文格式与它的小对话框：格式是纯函数，对话框只负责展示与复制。
    const citationFormat = load(code.citationFormat, fail);
    for (const [key, value] of Object.entries(citationFormat)) knowledge[key] = value;
    const citationDialog = load(code.citationDialog, (name) => {
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === '../../shared-ui/dialog/dialog-motion') {
        return { showAnimatedDialog: (dialog) => { if (!dialog.open) dialog.showModal(); } };
      }
      return fail(name);
    });

    // The viewer's lookup client: the messenger is stubbed so the test can answer like the worker would.
    const lookupClientCalls = [];
    let lookupResponse = { ok: true, bibliographicCandidates: [] };
    const lookupClient = load(code.metadataLookupClient, (name) => {
      if (name === 'wxt/browser') {
        return {
          browser: {
            runtime: {
              sendMessage: async (message) => {
                lookupClientCalls.push(message);
                return typeof lookupResponse === 'function' ? lookupResponse(message) : lookupResponse;
              },
            },
          },
        };
      }
      if (name === '../../../modules/knowledge/public') return knowledge;
      return fail(name);
    });

    // The lookup service's OpenAlex half is replaced by a stub: these tests are about the mapping and the fallback order,
    // not about OpenAlex itself (which `test-web-retrieval` covers).
    let openAlexImpl = async () => [];
    const lookupService = load(code.lookupService, (name) => {
      if (name === './related-literature-service') {
        return { searchOpenAlex: (title, signal) => openAlexImpl(title, signal) };
      }
      return fail(name);
    });

    // Availability/running are read from the viewer's live state, which this harness has no opinion about.
    const metadataExtraction = {
      isMetadataExtractionRunning: () => false,      metadataExtractionAvailability: () => ({ available: true, reason: '调用一次模型读取首页信息' }),
    };

    // The lookup's session state is set by the tests; the panel only reads it.
    let lookupState = { running: false, suggestions: [], message: '', failed: false, lookedUp: false };
    const lookupModule = {
      readMetadataLookupState: () => lookupState,
      setLookupState(next) {
        lookupState = { ...lookupState, ...next };
      },
      resetLookupState() {
        lookupState = { running: false, suggestions: [], message: '', failed: false, lookedUp: false };
      },
    };

    const resumeReading = load(code.resumeReading, fail);
    const tableModel = load(code.tableModel, (name) => (
      name === '../../../modules/knowledge/public' ? knowledge : fail(name)
    ));
    const table = load(code.table, (name) => {
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === './library-table-model') return tableModel;
      if (name === './resume-reading') return resumeReading;
      return fail(name);
    });
    // The panel verifies the cached 片段数量 against the real chunk store. The mock derives the store from the corpus so
    // every fixture stays consistent by default; a test can override one id to simulate a rotted index.
    const chunkOverrides = new Map();
    const chunksFor = async (documentId) => {
      if (chunkOverrides.has(documentId)) return chunkOverrides.get(documentId);
      const document = corpusDocuments.get(documentId);
      const count = Number(document?.chunkCount) || 0;
      return Array.from({ length: count }, () => ({ text: 'chunk text' }));
    };
    const documentAgent = {
      getDocumentChunks: (documentId) => chunksFor(documentId),
      setChunkCount(documentId, count) {
        chunkOverrides.set(documentId, Array.from({ length: count }, () => ({ text: 'chunk text' })));
      },
    };
    // The biblio editor is its own module: loaded for real, wired through the panel's `registerBiblioFormEvents` call.
    const biblioForm = (() => {
      try {
        return load(code.biblioForm, (name) => {
          if (name === '../../app/elements/knowledge-elements') return elements;
          if (name === '../../../modules/knowledge/public') return knowledge;
          return fail(name);
        });
      } catch {
        return null;
      }
    })();
    const suggestionsList = load(code.suggestionsList, (name) => {
      if (name === '../../app/elements/knowledge-elements') return elements;
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === './metadata-lookup') return lookupModule;
      return fail(name);
    });
    const panel = load(code.panel, (name) => {
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === './knowledge-related-papers') return related;
      if (name === './document-metadata-extraction') return metadataExtraction;
      if (name === './metadata-lookup') return lookupModule;
      if (name === './library-biblio-form') {
        return biblioForm ?? { closeBiblioEditor: () => {}, registerBiblioFormEvents: () => {} };
      }
      // 联网结果列表：它自己的渲染逻辑有断言覆盖（候选、理由、填入按钮），这里给它真实的模块。
      if (name === './library-metadata-suggestions') return suggestionsList;
      // 续读：纯函数，没有依赖。
      if (name === './resume-reading') return resumeReading;
      if (name === '../../shared-ui/markdown/markdown-renderer') return markdownRenderer;
      if (name === '../../../modules/document-agent/public') return documentAgent;
      return fail(name);
    });
    const selection = load(code.selection, fail);
    // The 数据体检 dialog: it renders rows from a report and hands each fix to the injected handler. The motion helper is
    // stubbed to plain `showModal`, which is all the tests need.
    const dataHealthDialog = load(code.dataHealthDialog, (name) => {
      if (name === '../../app/viewer-elements') return { knowledgeDataHealthCountElement: elements.knowledgeDataHealthCountElement };
      if (name === '../../shared-ui/dialog/dialog-motion') {
        return { showAnimatedDialog: (dialog) => { if (!dialog.open) dialog.showModal(); } };
      }
      return fail(name);
    });
    const batchActions = load(code.batchActions, (name) => (
      name === '../../../modules/knowledge/public' ? knowledge : fail(name)
    ));
    // 「同一篇文献吗」: pure name/page-count matching.
    const identityMatch = load(code.identityMatch, fail);
    const corpusAdapter = load(code.corpusAdapter, fail);
    // The durable file link lives in its own IndexedDB; the page is a real origin, so this is the real store.
    const fileHandleStore = load(code.fileHandleStore, fail);
    // The custom-select enhancer: every <select> in the app is wrapped in a `.ui-select` div whose trigger is what the
    // user actually sees, so a layout test that ignores it is testing markup nobody looks at.
    const customSelect = load(code.customSelect, fail);
    // The background service: pure parsing plus the output-budget ladder, exercised through the same transpiled module
    // the worker uses.
    const metadataService = load(code.metadataService, (name) => {
      if (name === '../../modules/ai/public') {
        return {
          getSafeProviderErrorDetails: (error) => (
            error && typeof error === 'object' && 'details' in error
              ? error.details
              : { name: error instanceof Error ? error.name : 'UnknownError' }
          ),
        };
      }
      return fail(name);
    });
    const viewMode = load(code.viewMode, (name) => {
      if (name === '../../app/viewer-elements') {
        return {
          knowledgeTableWrapElement: elements.knowledgeTableWrapElement,
          knowledgeListElement: elements.knowledgeListElement,
          knowledgeViewGridButton: elements.knowledgeViewGridButton,
          knowledgeViewListButton: elements.knowledgeViewListButton,
        };
      }
      if (name === '../../../infrastructure/storage/browser-json-repository') {
        return { readJsonValue: (_key, fallback) => fallback, writeJsonValue: () => {} };
      }
      return fail(name);
    });

    window.lib = {
      readingStatus,
      metadata,
      heuristics,
      bibliographicMatch,
      lookupService,
      lookupClient,
      lookupModule,
      dataHealthDialog,
      citationDialog,
      setLookupResponse(next) {
        lookupResponse = next;
      },
      lookupClientCalls,
      setOpenAlex(implementation) {
        openAlexImpl = implementation;
      },
      metadataService,
      identityMatch,
      corpusAdapter,
      fileHandleStore,
      documentAgent,
      customSelect,
      selection,
      batchActions,
      tableModel,
      table,
      panel,
      viewMode,
      corpus: corpusDocuments,
      elements,
      markdownCalls,
    };
    // One document as the corpus stores it, with only the fields the library reads filled in.
    window.rowFixture = (overrides) => ({
      documentId: 'doc',
      documentName: 'Paper.pdf',
      pageCount: 10,
      folderId: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      indexStatus: 'ready',
      chunkCount: 12,
      overviewStatus: 'ready',
      overviewMarkdown: '概览正文',
      readingStatus: 'todo',
      ...overrides,
    });
  }, sources);
});

after(async () => { await browser?.close(); });

test('reading status: three states, and opening a paper only ever moves forward', async () => {
  const state = await page.evaluate(() => {
    const { readingStatus, corpus } = window.lib;
    corpus.set('doc-todo', { documentId: 'doc-todo', readingStatus: undefined });
    corpus.set('doc-reading', { documentId: 'doc-reading', readingStatus: 'reading' });
    corpus.set('doc-done', { documentId: 'doc-done', readingStatus: 'done' });

    const normalized = [
      readingStatus.normalizeReadingStatus('nonsense'),
      readingStatus.normalizeReadingStatus(undefined),
      readingStatus.normalizeReadingStatus('done'),
    ];
    const cycle = [
      readingStatus.nextReadingStatus('todo'),
      readingStatus.nextReadingStatus('reading'),
      readingStatus.nextReadingStatus('done'),
    ];

    // Opening is the automatic write: 待读 becomes 在读, 已读 is left alone.
    readingStatus.markDocumentOpened('doc-todo');
    readingStatus.markDocumentOpened('doc-done');
    readingStatus.markDocumentOpened('missing-document');
    const afterOpen = {
      todo: corpus.get('doc-todo').readingStatus,
      done: corpus.get('doc-done').readingStatus,
      reading: corpus.get('doc-reading').readingStatus,
    };

    // The user's own choice is not one-way.
    readingStatus.setDocumentReadingStatus('doc-done', 'todo');
    const afterExplicit = corpus.get('doc-done').readingStatus;

    const counts = readingStatus.countReadingStatuses([
      { readingStatus: 'todo' },
      { readingStatus: 'reading' },
      { readingStatus: 'done' },
      { readingStatus: undefined },
    ]);

    return { normalized, cycle, afterOpen, afterExplicit, counts };
  });

  assert.deepEqual(state.normalized, ['todo', 'todo', 'done'], 'a missing or unknown value reads as 待读');
  assert.deepEqual(state.cycle, ['reading', 'done', 'todo'], '待读 → 在读 → 已读 → 待读');
  assert.deepEqual(
    state.afterOpen,
    { todo: 'reading', done: 'done', reading: 'reading' },
    'opening marks 在读 and never downgrades 已读',
  );
  assert.equal(state.afterExplicit, 'todo', 'an explicit choice may move backwards');
  assert.deepEqual(state.counts, { todo: 2, reading: 1, done: 1 });
});

test('the table gives every paper a row with its reading state and the three AI steps', async () => {
  const rendered = await page.evaluate(() => {
    const { table, tableModel, elements } = window.lib;
    const documents = [
      window.rowFixture({
        documentId: 'a',
        documentName: 'Attention.pdf',
        readingStatus: 'reading',
        relatedLiteratureMarkdown: '相关论文',
      }),
      window.rowFixture({
        documentId: 'b',
        documentName: 'Bert.pdf',
        indexStatus: 'indexing',
        overviewMarkdown: '',
        relatedLiteratureMarkdown: '',
      }),
      window.rowFixture({ documentId: 'c', documentName: 'Gpt.pdf', indexStatus: 'error', relatedLiteratureError: '检索失败' }),
    ];
    table.renderLibraryTable(
      tableModel.sortLibraryDocuments(documents, { key: 'title', descending: false }),
      { selectedId: 'b', selection: new Set(['a', 'c']) },
      { select() {}, open() {}, cycleReading() {}, contextMenu() {}, toggleSelect() {} },
    );
    const rows = [...elements.knowledgeTableBodyElement.querySelectorAll('.knowledge-table-row')];
    return {
      rowCount: rows.length,
      titles: rows.map((row) => row.querySelector('.knowledge-table-title').textContent),
      chips: rows.map((row) => [...row.querySelectorAll('.knowledge-state-chip')].map((chip) => chip.textContent)),
      reading: rows.map((row) => row.querySelector('.knowledge-reading-chip').textContent),
      readingClasses: rows.map((row) => row.querySelector('.knowledge-reading-chip').className),
      selected: rows.map((row) => row.classList.contains('is-selected')),
      checked: rows.map((row) => row.querySelector('.knowledge-row-check').checked),
      emptyHidden: elements.knowledgeTableEmptyElement.hidden,
    };
  });

  assert.equal(rendered.rowCount, 3);
  assert.deepEqual(rendered.titles, ['Attention', 'Bert', 'Gpt'], 'the extension is dropped from the title');
  assert.deepEqual(rendered.chips[0], ['✓', '✓', '✓'], 'everything processed');
  assert.deepEqual(rendered.chips[1], ['…', '·', '·'], 'indexing shows as in-progress, nothing else started');
  assert.deepEqual(rendered.chips[2], ['!', '✓', '!'], 'a failed index and a failed retrieval are visible from the list');
  assert.deepEqual(rendered.reading, ['在读', '待读', '待读']);
  assert.ok(
    rendered.readingClasses[0].includes('is-reading'),
    'the chip carries its state as a class, which is what colours it',
  );
  assert.deepEqual(rendered.selected, [false, true, false], 'only the inspected row is marked');
  assert.deepEqual(rendered.checked, [true, false, true], 'the batch checkboxes are independent of the inspector');
  assert.equal(rendered.emptyHidden, true);
});

test('a row answers to the mouse and the keyboard without selecting twice', async () => {
  const calls = await page.evaluate(() => {
    const { table, tableModel, elements } = window.lib;
    const log = [];
    const handlers = {
      select: (id) => log.push(`select:${id}`),
      open: (id) => log.push(`open:${id}`),
      cycleReading: (id) => log.push(`cycle:${id}`),
      contextMenu: (id, x, y) => log.push(`menu:${id}:${x},${y}`),
      toggleSelect: (id) => log.push(`check:${id}`),
    };
    table.renderLibraryTable(
      tableModel.sortLibraryDocuments([window.rowFixture({})], { key: 'title', descending: false }),
      { selectedId: null, selection: new Set() },
      handlers,
    );
    const row = elements.knowledgeTableBodyElement.querySelector('.knowledge-table-row');

    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
    // The chip is a button inside the row: advancing the state must not also change the selection.
    row.querySelector('.knowledge-reading-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // And the batch checkbox is a third, separate thing: it ticks the row without moving the inspector. A dispatched
    // click runs the checkbox's activation behaviour, so it fires `change` on its own — exactly one toggle.
    const check = row.querySelector('.knowledge-row-check');
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return log;
  });

  assert.deepEqual(calls, [
    'select:doc',
    'open:doc',
    'open:doc',
    'cycle:doc',
    'select:doc',
    'menu:doc:40,60',
    'cycle:doc',
    'check:doc',
  ], 'clicking the checkbox reports the toggle and nothing else');
});

test('an empty table says so instead of showing a bare frame', async () => {
  const state = await page.evaluate(() => {
    const { table, elements } = window.lib;
    table.renderLibraryTable(
      [],
      { selectedId: null, selection: new Set() },
      { select() {}, open() {}, cycleReading() {}, contextMenu() {}, toggleSelect() {} },
    );
    return {
      rows: elements.knowledgeTableBodyElement.children.length,
      emptyHidden: elements.knowledgeTableEmptyElement.hidden,
    };
  });
  assert.deepEqual(state, { rows: 0, emptyHidden: false });
});

test('the inspector shows the visible reading status, not just the hidden native value', async () => {
  const rendered = await page.evaluate(async () => {
    const { panel, customSelect } = window.lib;
    // The app replaces every <select> with a wrapper whose trigger text is what the user reads; sync happens from DOM
    // mutations only, so assigning `.value` alone leaves the previous document's status on screen. The observer's
    // callback lands in a later task, hence the yield.
    customSelect.installReusableSelects();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const visibleStatus = () => document
      .getElementById('knowledge-doc-reading')
      ?.closest('.ui-select')
      ?.querySelector('.ui-select-value')
      ?.textContent?.trim();
    const handlers = {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {},
      searchRelated() {}, extractMetadata() {}, changeReading() {}, moveToFolder() {},
    };
    panel.renderDocumentPanel(window.rowFixture({ documentId: 'a', readingStatus: 'done' }), [], handlers);
    await settle();
    const first = visibleStatus();
    panel.renderDocumentPanel(window.rowFixture({ documentId: 'b', readingStatus: 'todo' }), [], handlers);
    await settle();
    const second = visibleStatus();
    return { first, second };
  });

  assert.equal(rendered.first, '已读');
  assert.equal(rendered.second, '待读', 'switching documents must update the label the user can actually see');
});

test('sorting puts the work that still needs doing first', async () => {
  const result = await page.evaluate(() => {
    const { tableModel } = window.lib;
    const documents = [
      window.rowFixture({ documentId: 'done', documentName: 'C.pdf', readingStatus: 'done', indexStatus: 'ready', pageCount: 30, publishDate: '2019-04' }),
      window.rowFixture({ documentId: 'todo', documentName: 'A.pdf', readingStatus: 'todo', indexStatus: 'pending', pageCount: 10, publishDate: '' }),
      window.rowFixture({ documentId: 'reading', documentName: 'B.pdf', readingStatus: 'reading', indexStatus: 'error', pageCount: 20, publishDate: '2024-11-02' }),
    ];
    const ids = (sort) => tableModel.sortLibraryDocuments(documents, sort).map((item) => item.documentId);
    return {
      byReading: ids({ key: 'reading', descending: false }),
      byReadingReversed: ids({ key: 'reading', descending: true }),
      byIndex: ids({ key: 'index', descending: false }),
      byTitle: ids({ key: 'title', descending: false }),
      byPages: ids({ key: 'pages', descending: true }),
      byPublished: ids({ key: 'published', descending: false }),
      summaryAll: tableModel.describeLibrarySummary(3, 3),
      summaryFiltered: tableModel.describeLibrarySummary(2, 3),
      summaryEmpty: tableModel.describeLibrarySummary(0, 0),
    };
  });

  assert.deepEqual(result.byReading, ['todo', 'reading', 'done'], '待读 first, 已读 last');
  assert.deepEqual(result.byReadingReversed, ['done', 'reading', 'todo']);
  assert.deepEqual(result.byIndex, ['todo', 'reading', 'done'], 'not-indexed, then failed, then done');
  assert.deepEqual(result.byTitle, ['todo', 'reading', 'done'], 'A, B, C');
  assert.deepEqual(result.byPages, ['done', 'reading', 'todo']);
  assert.deepEqual(
    result.byPublished,
    ['done', 'reading', 'todo'],
    '发表日期 sorts oldest first, and a paper with no date goes last rather than first',
  );
  assert.equal(result.summaryAll, '共 3 篇文献');
  assert.equal(result.summaryFiltered, '共 3 篇文献 · 当前显示 2 篇');
  assert.equal(result.summaryEmpty, '', 'nothing to say about an empty library');
});

test('续读：右栏按钮写上次读到的页，表格也列出进度', async () => {
  const outcome = await page.evaluate(() => {
    const { panel, table, elements } = window.lib;
    const handlers = {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {}, searchRelated() {},
      extractMetadata() {}, saveMetadata() {}, toggleMetadataSkip() {}, lookupMetadata() {},
      applyMetadataSuggestion() {}, dismissMetadataSuggestions() {}, changeReading() {},
      moveToFolder() {}, openCitation() {},
    };
    const base = {
      documentId: 'resume-1',
      documentName: 'Read Halfway.pdf',
      pageCount: 40,
      folderId: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      indexStatus: 'ready',
      chunkCount: 3,
      metadataStatus: 'ready',
      lastReadPage: 17,
      lastReadAt: '2026-10-18T02:00:00.000Z',
    };
    panel.renderDocumentPanel(base, [], handlers);
    const withProgress = {
      button: elements.knowledgeDocOpenButton.textContent,
      title: elements.knowledgeDocOpenButton.title,
    };

    // 页码超出当前文件：标签说「重读结尾」，提示也解释了夹取。
    panel.renderDocumentPanel({ ...base, lastReadPage: 400 }, [], handlers);
    const clamped = {
      button: elements.knowledgeDocOpenButton.textContent,
      title: elements.knowledgeDocOpenButton.title,
    };

    // 没读过：回到「打开原文」。
    panel.renderDocumentPanel({ ...base, lastReadPage: undefined, lastReadAt: undefined }, [], handlers);
    const fresh = { button: elements.knowledgeDocOpenButton.textContent, title: elements.knowledgeDocOpenButton.title };

    // 表格：读到第 17 页的显示页数，没读过的显示破折号，两者不能混。
    table.renderLibraryTable(
      [base, { ...base, documentId: 'resume-2', documentName: 'Untouched.pdf', lastReadPage: undefined, lastReadAt: undefined }],
      { selectedId: null, selection: new Set() },
      { open() {}, cycleReading() {}, contextMenu() {}, toggleSelect() {} },
    );
    const progress = [...document.querySelectorAll('#knowledge-table-body .knowledge-col-progress')]
      .map((cell) => ({ text: cell.textContent, empty: cell.classList.contains('is-empty') }));
    return { withProgress, clamped, fresh, progress };
  });

  assert.equal(outcome.withProgress.button, '继续阅读（第 17 页）');
  assert.match(outcome.withProgress.title, /上次读到的位置/);
  assert.equal(outcome.clamped.button, '重读结尾（第 40 页）');
  assert.match(outcome.clamped.title, /超出总页数/);
  assert.equal(outcome.fresh.button, '打开原文');
  assert.equal(outcome.fresh.title, '打开原文');
  assert.deepEqual(outcome.progress, [
    { text: '第 17 页', empty: false },
    { text: '—', empty: true },
  ]);
});

test('the inspector describes the selected paper, and its buttons act on that paper', async () => {
  const rendered = await page.evaluate(() => {
    const { panel, elements } = window.lib;
    const log = [];
    const handlers = {
      openOverview: (id) => log.push(`overview:${id}`),
      openSource: (id) => log.push(`open:${id}`),
      openGraph: (id) => log.push(`graph:${id}`),
      remove: (id) => log.push(`remove:${id}`),
      searchRelated: (id) => log.push(`related:${id}`),
      extractMetadata: (id) => log.push(`metadata:${id}`),
      changeReading: (id, status) => log.push(`reading:${id}:${status}`),
      moveToFolder: (id, folderId) => log.push(`folder:${id}:${folderId}`),
    };
    const folders = [{ id: 'folder-1', name: '扩散模型' }];

    panel.renderDocumentPanel(
      {
        documentId: 'doc-a',
        documentName: 'Alpha.pdf',
        pageCount: 24,
        folderId: null,
        addedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-03T00:00:00.000Z',
        indexStatus: 'ready',
        chunkCount: 42,
        overviewStatus: 'ready',
        overviewMarkdown: '概览',
        relatedLiteratureMarkdown: '',
        relatedLiteratureError: '检索超时',
        readingStatus: 'reading',
        authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones'],
        publishDate: '2017-06',
        language: 'en',
        doi: '10.5555/3295222.3295349',
        documentUrl: 'https://arxiv.org/abs/1706.03762',
        metadataStatus: 'ready',
        metadataAt: '2026-02-01T00:00:00.000Z',
      },
      folders,
      handlers,
    );

    const snapshot = () => ({
      hidden: elements.knowledgeDetailPanelElement.hidden,
      title: elements.knowledgeDocNameElement.textContent,
      reading: elements.knowledgeDocReadingSelect.value,
      pages: elements.knowledgeDocPagesElement.textContent,
      chunks: elements.knowledgeDocChunksElement.textContent,
      indexState: elements.knowledgeDocIndexStateElement.textContent,
      relatedState: elements.knowledgeDocRelatedStateElement.textContent,
      issue: elements.knowledgeDocIssueElement.hidden ? '' : elements.knowledgeDocIssueElement.textContent,
      overviewLabel: elements.knowledgeDocOverviewButton.textContent,
      authors: elements.knowledgeDocAuthorsElement.textContent,
      authorsTitle: elements.knowledgeDocAuthorsElement.getAttribute('title') ?? '',
      publishDate: elements.knowledgeDocDateElement.textContent,
      language: elements.knowledgeDocLanguageElement.textContent,
      doi: elements.knowledgeDocDoiElement.textContent,
      doiHref: elements.knowledgeDocDoiElement.querySelector('a')?.getAttribute('href') ?? '',
      url: elements.knowledgeDocUrlElement.querySelector('a')?.getAttribute('href') ?? '',
      metadataNote: elements.knowledgeDocMetadataNoteElement.hidden
        ? ''
        : elements.knowledgeDocMetadataNoteElement.textContent,
      metadataLabel: elements.knowledgeDocMetadataButton.textContent,
    });

    const first = snapshot();
    elements.knowledgeDocOverviewButton.click();
    elements.knowledgeDocOpenButton.click();
    elements.knowledgeDocGraphButton.click();
    elements.knowledgeDocSearchRelatedButton.click();
    elements.knowledgeDocMetadataButton.click();
    elements.knowledgeDocRemoveButton.click();
    elements.knowledgeDocReadingSelect.value = 'done';
    elements.knowledgeDocReadingSelect.dispatchEvent(new Event('change'));
    elements.knowledgeDocFolderSelect.value = 'folder-1';
    elements.knowledgeDocFolderSelect.dispatchEvent(new Event('change'));

    // Re-render with a different paper: the panel is not rebuilt, so this is where a stale handler would show up.
    panel.renderDocumentPanel(
      {
        documentId: 'doc-b',
        documentName: 'Beta.pdf',
        pageCount: 8,
        folderId: 'folder-1',
        addedAt: '2026-03-04T00:00:00.000Z',
        updatedAt: '2026-03-05T00:00:00.000Z',
        indexStatus: 'error',
        chunkCount: 0,
        indexError: '文件已被移动',
        overviewStatus: 'pending',
        overviewMarkdown: '',
        readingStatus: 'todo',
      },
      folders,
      handlers,
    );
    const second = snapshot();
    elements.knowledgeDocOpenButton.click();
    elements.knowledgeDocOverviewButton.click();

    panel.renderDocumentPanel(null, folders, handlers);
    const cleared = elements.knowledgeDetailPanelElement.hidden;
    // A hidden panel must not act on the paper it last showed.
    elements.knowledgeDocRemoveButton.click();

    return { first, second, cleared, log };
  });

  assert.equal(rendered.first.hidden, false);
  assert.equal(rendered.first.title, 'Alpha');
  assert.equal(rendered.first.reading, 'reading');
  assert.equal(rendered.first.pages, '24 页');
  assert.equal(rendered.first.chunks, '42');
  assert.match(rendered.first.indexState, /已索引/, 'a finished index reads as done');
  assert.match(rendered.first.relatedState, /上次检索未完成/, 'a failed retrieval is reported as such');
  assert.equal(rendered.first.issue, '检索超时', 'the failure is repeated where the next action is');
  assert.equal(rendered.first.overviewLabel, '查看概览', 'an existing overview is viewed, not regenerated');

  // 文献信息 — the five fields Zotero users expect, with the links a citation needs.
  assert.equal(
    rendered.first.authors,
    'Ashish Vaswani、Noam Shazeer、Niki Parmar、Jakob Uszkoreit 等 5 人',
    'more than four authors collapse to a count',
  );
  assert.match(rendered.first.authorsTitle, /Llion Jones/, 'but the full list is still one hover away');
  assert.equal(rendered.first.publishDate, '2017-06');
  assert.equal(rendered.first.language, '英语', 'a two-letter tag is shown as a language name');
  assert.equal(rendered.first.doi, '10.5555/3295222.3295349');
  assert.equal(rendered.first.doiHref, 'https://doi.org/10.5555/3295222.3295349', 'the DOI is a resolvable link');
  assert.equal(rendered.first.url, 'https://arxiv.org/abs/1706.03762');
  assert.equal(rendered.first.metadataNote, '', 'a complete record says nothing');
  assert.equal(rendered.first.metadataLabel, '重新提取');

  assert.equal(rendered.second.title, 'Beta');
  assert.equal(rendered.second.reading, 'todo');
  assert.equal(rendered.second.issue, '文件已被移动');
  assert.equal(rendered.second.overviewLabel, '生成概览', 'no overview yet means the button offers to make one');
  assert.equal(rendered.second.authors, '—', 'not extracted yet reads as a dash, not a guess');
  assert.equal(rendered.second.doi, '—');
  assert.equal(rendered.second.metadataLabel, '提取元数据');
  assert.match(rendered.second.metadataNote, /自动读/, 'and the note says when it normally happens');
  assert.equal(rendered.cleared, true);

  assert.deepEqual(rendered.log, [
    'overview:doc-a',
    'open:doc-a',
    'graph:doc-a',
    'related:doc-a',
    'metadata:doc-a',
    'remove:doc-a',
    'reading:doc-a:done',
    'folder:doc-a:folder-1',
    'open:doc-b',
    'overview:doc-b',
  ], 'after the panel moves to another paper, every control follows it');
});

test('the sidebar counters add up to the library', async () => {
  const counts = await page.evaluate(() => {
    const { panel, elements } = window.lib;
    panel.renderReadingStatusCounts([
      { readingStatus: 'todo' },
      { readingStatus: undefined },
      { readingStatus: 'reading' },
      { readingStatus: 'done' },
      { readingStatus: 'done' },
    ]);
    return {
      todo: elements.knowledgeReadingCountElements.todo.textContent,
      reading: elements.knowledgeReadingCountElements.reading.textContent,
      done: elements.knowledgeReadingCountElements.done.textContent,
    };
  });
  assert.deepEqual(counts, { todo: '2', reading: '1', done: '2' });
});

test('the two views swap cleanly and the inspector docks beside the table', async () => {
  const layout = await page.evaluate(() => {
    const { table, tableModel, panel, viewMode, elements, customSelect } = window.lib;
    const pageShell = document.getElementById('knowledge-base-page');
    pageShell.hidden = false;
    pageShell.style.height = '820px';

    // The app wraps every <select> in a `.ui-select` div at startup; do the same here, or the assertions below would be
    // about a native control the user never sees (which is how a stray sort box survived a previous round).
    customSelect.installReusableSelects();
    // The toolbar sort select was removed: the table headers are the only sort control, and the card view follows them.
    const straySortControls = document.querySelectorAll(
      '#knowledge-sort-select, .research-search-row .ui-select',
    ).length;

    const documents = [
      window.rowFixture({ documentId: 'a', documentName: 'Attention Is All You Need.pdf' }),
      window.rowFixture({ documentId: 'b', documentName: 'Bert.pdf', readingStatus: 'reading' }),
    ];
    table.renderLibraryTable(
      tableModel.sortLibraryDocuments(documents, { key: 'title', descending: false }),
      { selectedId: 'a', selection: new Set(['b']) },
      { select() {}, open() {}, cycleReading() {}, contextMenu() {}, toggleSelect() {} },
    );

    const display = (element) => (element ? getComputedStyle(element).display : 'absent');
    viewMode.applyLibraryViewMode('list');
    const listMode = {
      list: display(elements.knowledgeListElement),
      table: display(elements.knowledgeTableWrapElement),
      listPressed: elements.knowledgeViewListButton.getAttribute('aria-pressed'),
      gridPressed: elements.knowledgeViewGridButton.getAttribute('aria-pressed'),
    };
    viewMode.applyLibraryViewMode('grid');
    const gridMode = {
      list: display(elements.knowledgeListElement),
      table: display(elements.knowledgeTableWrapElement),
      listPressed: elements.knowledgeViewListButton.getAttribute('aria-pressed'),
      gridPressed: elements.knowledgeViewGridButton.getAttribute('aria-pressed'),
    };
    viewMode.applyLibraryViewMode('list');

    const shell = document.querySelector('.knowledge-base-shell');
    const main = document.querySelector('.knowledge-main');
    panel.renderDocumentPanel(documents[0], [], {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {},
      searchRelated() {}, extractMetadata() {}, changeReading() {}, moveToFolder() {},
    });
    const panelRect = elements.knowledgeDetailPanelElement.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const row = elements.knowledgeTableBodyElement.querySelector('.knowledge-table-row');

    return {
      listMode,
      gridMode,
      // No sort control in the toolbar at all, in either view: the table headers own sorting, and the card view follows
      // the same state. `0` here is the regression test for the rounded box the user asked to remove.
      straySortControls,
      panel: { hidden: elements.knowledgeDetailPanelElement.hidden, width: Math.round(panelRect.width), left: Math.round(panelRect.left) },
      main: { right: Math.round(mainRect.right), width: Math.round(mainRect.width) },
      overflow: shell.scrollWidth - shell.clientWidth,
      rowHeight: Math.round(row.getBoundingClientRect().height),
      rowCount: elements.knowledgeTableBodyElement.querySelectorAll('.knowledge-table-row').length,
    };
  });

  assert.deepEqual(
    layout.listMode,
    { list: 'none', table: 'block', listPressed: 'true', gridPressed: 'false' },
    'the list view shows the table and hides the card grid',
  );
  assert.deepEqual(
    layout.gridMode,
    { list: 'grid', table: 'none', listPressed: 'false', gridPressed: 'true' },
    'the card view shows the grid and hides the table',
  );
  assert.equal(layout.straySortControls, 0, 'the toolbar carries no sort control in either view');
  assert.equal(layout.panel.hidden, false, 'selecting a paper reveals the inspector');
  assert.ok(
    layout.panel.width >= 240 && layout.panel.width <= 400,
    `the inspector keeps a readable width (${layout.panel.width}px)`,
  );
  assert.ok(
    layout.panel.left >= layout.main.right - 1,
    `the inspector sits to the right of the list, not on top of it (${layout.panel.left} vs ${layout.main.right})`,
  );
  assert.ok(layout.overflow <= 1, 'the shell must not scroll sideways');
  assert.ok(layout.rowHeight >= 32, `rows are tall enough to click (${layout.rowHeight}px)`);
  assert.equal(layout.rowCount, 2);
});

test('多选 keeps only what is on screen and never touches the inspector', async () => {
  const result = await page.evaluate(() => {
    const { selection } = window.lib;
    const toggled = selection.toggleDocumentSelection(new Set(['a']), 'b');
    const untoggled = selection.toggleDocumentSelection(toggled, 'a');
    const all = selection.selectVisibleDocuments(['a', 'b', 'c']);
    // A filter change drops the documents it hides — that is the whole reason this is not a bare Set.
    const pruned = selection.pruneDocumentSelection(new Set(['a', 'c']), ['a', 'b']);
    return {
      toggled: [...toggled].sort(),
      untoggled: [...untoggled],
      all: [...all].sort(),
      pruned: [...pruned],
      isEmpty: selection.sameSelection(pruned, new Set()),
      counts: [selection.describeSelection(all), selection.describeSelection(new Set())],
      original: [...new Set(['a'])],
    };
  });

  assert.deepEqual(result.toggled, ['a', 'b']);
  assert.deepEqual(result.untoggled, ['b'], 'clicking a checked box unchecks it');
  assert.deepEqual(result.all, ['a', 'b', 'c']);
  assert.deepEqual(result.pruned, ['a'], 'a document that is no longer visible leaves the batch');
  assert.equal(result.isEmpty, false);
  assert.deepEqual(result.counts, ['已选 3 篇', '未选择文献']);
  assert.deepEqual(result.original, ['a'], 'the helpers never mutate the set they were given');
});

test('批量检索先算出谁会被跳过、要花多少钱', async () => {
  const plan = await page.evaluate(() => {
    const { batchActions } = window.lib;
    const documents = [
      window.rowFixture({ documentId: 'ready-1', documentName: 'A.pdf' }),
      window.rowFixture({ documentId: 'no-overview', documentName: 'B.pdf', overviewMarkdown: '' }),
      window.rowFixture({ documentId: 'running', documentName: 'C.pdf' }),
      window.rowFixture({ documentId: 'ready-2', documentName: 'D.pdf' }),
    ];
    const view = (result) => ({
      runnable: result.runnable.map((item) => item.documentId),
      skipped: result.skipped.map((skip) => [skip.documentId, skip.reason]),
      cost: result.estimatedCostYuan,
      message: batchActions.describeBatchRelatedPlan(result),
    });
    return {
      mixed: view(batchActions.planBatchRelatedPapers(documents, {
        webRetrievalReady: true,
        isRunning: (id) => id === 'running',
      })),
      noKey: view(batchActions.planBatchRelatedPapers(documents.slice(0, 1), {
        webRetrievalReady: false,
        isRunning: () => false,
      })),
      nothing: batchActions.describeBatchRelatedPlan({
        runnable: [],
        skipped: [],
        estimatedCostYuan: 0,
      }),
    };
  });

  assert.deepEqual(plan.mixed.runnable, ['ready-1', 'ready-2']);
  assert.deepEqual(plan.mixed.skipped, [
    ['no-overview', '还没有概览，没有可用来检索的主题'],
    ['running', '这篇正在检索中'],
  ]);
  assert.equal(plan.mixed.cost, 0.01, 'two papers × ¥0.005');
  assert.match(plan.mixed.message, /将为 2 篇文献各检索一次相关论文，合计约 ¥0\.010/);
  assert.match(plan.mixed.message, /跳过 2 篇/);
  assert.match(plan.mixed.message, /B：还没有概览/, 'the skip list names the papers, not just the count');
  assert.deepEqual(plan.noKey.runnable, []);
  assert.match(plan.noKey.skipped[0][1], /未配置 DeepSeek API Key/);
  assert.match(plan.nothing, /将为 0 篇文献/);
});

test('元数据规范化：空着就是答案，编造不是', async () => {
  const normalized = await page.evaluate(() => {
    const { metadata } = window.lib;
    return {
      authorsFromString: metadata.normalizeAuthors('Ashish Vaswani, Noam Shazeer and Niki Parmar'),
      authorsFromArray: metadata.normalizeAuthors(['A B', 'a b', '', 'N/A', '未知', 'C D']),
      authorsCapped: metadata.normalizeAuthors(Array.from({ length: 20 }, (_, i) => `Author ${i}`)).length,
      doiFromUrl: metadata.normalizeDoi('https://doi.org/10.1000/xyz123'),
      doiFromLabel: metadata.normalizeDoi('doi: 10.1000/xyz123.'),
      doiJunk: metadata.normalizeDoi('not a doi'),
      urlOk: metadata.normalizeDocumentUrl('https://arxiv.org/abs/1706.03762'),
      urlRejected: metadata.normalizeDocumentUrl('javascript:alert(1)'),
      urlRelative: metadata.normalizeDocumentUrl('/local/file.pdf'),
      languageTag: metadata.normalizeLanguage('EN-us'),
      languageWord: metadata.normalizeLanguage('English'),
      dateIso: metadata.normalizePublishDate('2026/3/7'),
      dateYear: metadata.normalizePublishDate('2026'),
      empty: metadata.normalizeDocumentMetadata(null),
      blanks: metadata.normalizeDocumentMetadata({ authors: ['', 'unknown'], doi: '', publishDate: '  ' }),
      hasEmpty: metadata.hasDocumentMetadata(metadata.EMPTY_DOCUMENT_METADATA),
      hasSome: metadata.hasDocumentMetadata({ ...metadata.EMPTY_DOCUMENT_METADATA, doi: '10.1000/x' }),
    };
  });

  assert.deepEqual(normalized.authorsFromString, ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar']);
  assert.deepEqual(normalized.authorsFromArray, ['A B', 'C D'], 'case-duplicates and placeholders are dropped');
  assert.equal(normalized.authorsCapped, 12, 'a contributor dump is capped');
  assert.equal(normalized.doiFromUrl, '10.1000/xyz123');
  assert.equal(normalized.doiFromLabel, '10.1000/xyz123', 'the resolver prefix and trailing period go');
  assert.equal(normalized.doiJunk, '', 'an unparseable DOI is not stored');
  assert.equal(normalized.urlOk, 'https://arxiv.org/abs/1706.03762');
  assert.equal(normalized.urlRejected, '', 'only http(s) links, so nothing renders as a javascript: link');
  assert.equal(normalized.urlRelative, '');
  assert.equal(normalized.languageTag, 'en');
  assert.equal(normalized.languageWord, 'English');
  assert.equal(normalized.dateIso, '2026-03-07', 'a slash date becomes the sortable form');
  assert.equal(normalized.dateYear, '2026');
  assert.deepEqual(normalized.empty, {
    title: '', authors: [], publishDate: '', language: '', documentUrl: '', doi: '',
    containerTitle: '', volume: '', issue: '', page: '', publisher: '', publisherPlace: '',
    issn: '', isbn: '', publicationKind: '',
  });
  assert.deepEqual(normalized.blanks.authors, [], 'placeholders count as empty');
  assert.equal(normalized.hasEmpty, false);
  assert.equal(normalized.hasSome, true);
});

test('联网候选能写进出版信息：卷期、页码、出版者、ISSN 都落到记录上', async () => {
  const result = await page.evaluate(() => {
    const { metadata, corpus } = window.lib;
    corpus.set('online-1', {
      documentId: 'online-1',
      metadataStatus: 'ready',
      // 手填的 DOI 必须保留：在线候选不能覆盖用户自己写的值。
      doi: '10.9999/manual',
      metadataSources: { doi: 'manual' },
    });
    // This is exactly what the panel's 「填入」 click sends: the gated candidate, field by field.
    metadata.applyExtractedMetadata('online-1', {
      title: 'Fast correlation attacks on stream ciphers',
      authors: ['Anne Canteaut'],
      publishDate: '2008',
      language: '',
      documentUrl: '',
      doi: '10.1007/3-540-45539-6_7',
      containerTitle: 'Advances in Cryptology — EUROCRYPT 2008',
      volume: '4965',
      issue: '2',
      page: '31-46',
      publisher: 'Springer',
      publisherPlace: 'Berlin, Heidelberg',
      issn: '0302-9743',
      isbn: '978-3-540-45539-4',
      publicationKind: 'proceedings-article',
    }, 'online');
    const stored = { ...corpus.get('online-1') };
    return {
      stored,
      sources: metadata.readMetadataSources(corpus.get('online-1')),
    };
  });

  assert.equal(result.stored.containerTitle, 'Advances in Cryptology — EUROCRYPT 2008');
  assert.equal(result.stored.volume, '4965');
  assert.equal(result.stored.issue, '2');
  assert.equal(result.stored.page, '31-46');
  assert.equal(result.stored.publisher, 'Springer');
  assert.equal(result.stored.publisherPlace, 'Berlin, Heidelberg');
  assert.equal(result.stored.issn, '0302-9743');
  assert.equal(result.stored.isbn, '978-3-540-45539-4');
  assert.equal(result.stored.publicationKind, 'proceedings-article');
  assert.equal(result.stored.doi, '10.9999/manual', 'a hand-typed DOI is never replaced');
  assert.equal(result.sources.doi, 'manual');
  assert.equal(result.sources.containerTitle, 'online', 'and every field says where it came from');
  assert.equal(result.sources.page, 'online');
});

test('元数据写回只写读到的字段，并把状态记下来', async () => {
  const stored = await page.evaluate(() => {
    const { metadata, corpus } = window.lib;
    corpus.set('meta-1', { documentId: 'meta-1', metadataStatus: 'pending' });
    metadata.setDocumentMetadata('meta-1', {
      authors: ['Ada Lovelace', 'ada lovelace'],
      publishDate: '1843',
      language: 'EN',
      documentUrl: 'https://example.org/paper',
      doi: 'https://doi.org/10.1000/abc',
    });
    const afterReady = { ...corpus.get('meta-1') };

    corpus.set('meta-2', { documentId: 'meta-2', metadataStatus: 'pending' });
    metadata.setDocumentMetadata('meta-2', { authors: [], publishDate: '', language: '', documentUrl: '', doi: '' });
    const afterEmpty = { ...corpus.get('meta-2') };

    corpus.set('meta-3', { documentId: 'meta-3', metadataStatus: 'pending' });
    metadata.markDocumentMetadataExtracting('meta-3');
    const extracting = corpus.get('meta-3').metadataStatus;
    metadata.markDocumentMetadataFailed('meta-3', '模型没有返回可解析的元数据 JSON。');
    const failed = { ...corpus.get('meta-3') };

    return { afterReady, afterEmpty, extracting, failed, readBack: metadata.readDocumentMetadata(afterReady) };
  });

  assert.deepEqual(stored.afterReady.authors, ['Ada Lovelace'], 'normalized on the way in');
  assert.equal(stored.afterReady.doi, '10.1000/abc');
  assert.equal(stored.afterReady.language, 'en');
  assert.equal(stored.afterReady.metadataStatus, 'ready');
  assert.ok(stored.afterReady.metadataAt, 'the record says when it happened');
  assert.equal(stored.afterEmpty.authors, undefined, 'nothing found stores nothing, but still counts as processed');
  assert.equal(stored.afterEmpty.metadataStatus, 'ready');
  assert.equal(stored.extracting, 'extracting');
  assert.equal(stored.failed.metadataStatus, 'error');
  assert.match(stored.failed.metadataError, /JSON/);
  assert.equal(stored.readBack.doi, '10.1000/abc');
});

// ---------------------------------------------------------------------------
// 免费离线层: what the file itself states.
//
// These rules are the reason a PDF with no embedded metadata stops being a dead end — and the reason it cannot mismatch
// a paper: everything found here was printed in this file.
// ---------------------------------------------------------------------------
test('离线元数据：DOI、arXiv 编号、版权行、中文日期行都能读出来', async () => {
  const found = await page.evaluate(() => {
    const { heuristics } = window.lib;
    const run = (headText, pdfInfo = null, documentName = 'paper.pdf') => (
      heuristics.extractOfflineDocumentMetadata({ documentName, headText, pdfInfo })
    );
    const ieee = run([
      'Denoising Diffusion Probabilistic Models',
      'Jonathan Ho, Ajay Jain, Pieter Abbeel',
      '© 2020 IEEE. Personal use is permitted.',
      'https://doi.org/10.1109/CVPR.2020.12345.',
    ].join('\n'));
    const arxiv = run('arXiv:2401.01234v2  [cs.CV]  3 Jan 2024\nSome abstract.');
    const legacy = run('arXiv:cs/0112017v1 [cs.CL] 12 Dec 2001');
    const chinese = run([
      '一种新的注意力机制用于长文本理解',
      '收稿日期：2020-03-05',
      '摘要：本文提出一种面向长文本的注意力机制，通过稀疏化计算降低复杂度，在多个中文数据集上取得了更好的结果，'
        + '并且在推理速度上也有明显提升。实验表明该方法在保持精度的同时显著减少了显存占用。',
    ].join('\n'));
    const filenameOnly = run('An old scanned report with no date at all.', null, '2010-Boyar & Peralta-symposium.pdf');
    const nothing = run('A contract between two parties.');
    return {
      ieee: { doi: ieee.fromText.doi, date: ieee.fromText.publishDate, url: ieee.fromText.documentUrl, rules: ieee.matchedRules },
      arxiv: { date: arxiv.fromText.publishDate, url: arxiv.fromText.documentUrl },
      legacy: { date: legacy.fromText.publishDate, url: legacy.fromText.documentUrl },
      chinese: { date: chinese.fromText.publishDate, language: chinese.fromText.language },
      filenameOnly: { date: filenameOnly.fromText.publishDate, rule: filenameOnly.matchedRules.publishDate },
      nothing: { doi: nothing.fromText.doi, date: nothing.fromText.publishDate, url: nothing.fromText.documentUrl },
    };
  });

  assert.equal(found.ieee.doi, '10.1109/CVPR.2020.12345', 'the trailing period is not part of the DOI');
  assert.equal(found.ieee.date, '2020', 'the copyright year is used when no identifier carries a date');
  assert.equal(found.ieee.url, 'https://doi.org/10.1109/CVPR.2020.12345', 'the resolver link is derived, not asked for');
  assert.equal(found.arxiv.date, '2024-01', 'an arXiv id carries the month — 2401 is January 2024');
  assert.equal(found.arxiv.url, 'https://arxiv.org/abs/2401.01234');
  assert.equal(found.legacy.date, '2001-12', 'the legacy cs/YYMMNNN form reads too');
  assert.equal(found.legacy.url, 'https://arxiv.org/abs/cs/0112017');
  assert.equal(found.chinese.date, '2020-03-05', '收稿日期 is a full date, not just a year');
  assert.equal(found.chinese.language, 'zh');
  assert.equal(found.filenameOnly.date, '2010');
  assert.match(found.filenameOnly.rule, /文件名/, 'a year from the file name is labelled as unreliable');
  assert.equal(found.nothing.doi, '');
  assert.equal(found.nothing.date, '', 'nothing invented when the file states nothing');
  assert.equal(found.nothing.url, '');
});

test('离线元数据：PDF 属性里的作者可用，生成软件的名字不算', async () => {
  const authors = await page.evaluate(() => {
    const { heuristics } = window.lib;
    const run = (pdfInfo, headText = 'A paper.') => (
      heuristics.extractOfflineDocumentMetadata({ documentName: 'x.pdf', headText, pdfInfo }).fromPdf.authors
    );
    return {
      people: run({ Author: 'Ada Lovelace; Alan Turing' }),
      software: run({ Author: 'Microsoft Word' }),
      latex: run({ Author: 'LaTeX with hyperref' }),
      single: run({ Author: 'admin' }),
      chinese: run({ Author: '张三、李四' }),
      none: run({}),
    };
  });
  assert.deepEqual(authors.people, ['Ada Lovelace', 'Alan Turing']);
  assert.deepEqual(authors.software, [], 'the producer is not an author');
  assert.deepEqual(authors.latex, []);
  assert.deepEqual(authors.single, [], 'a bare login name is not an author');
  assert.deepEqual(authors.chinese, ['张三', '李四']);
  assert.deepEqual(authors.none, []);
});

test('离线元数据：PDF 属性里的标题可用，占位标题与文件名不算', async () => {
  const titles = await page.evaluate(() => {
    const { heuristics } = window.lib;
    const run = (Title, documentName = 'paper.pdf') => (
      heuristics.extractOfflineDocumentMetadata({ documentName, headText: 'A paper.', pdfInfo: { Title } }).fromPdf.title
    );
    return {
      real: run('A new combinational logic minimization technique'),
      chinese: run('面向图神经网络的高效推理方法'),
      word: run('Microsoft Word - 文稿1.docx'),
      untitled: run('Untitled'),
      empty: run(''),
      sameAsFile: run('paper', 'paper.pdf'),
      wordCount: run('Slide 3'),
    };
  });
  assert.equal(titles.real, 'A new combinational logic minimization technique');
  assert.equal(titles.chinese, '面向图神经网络的高效推理方法');
  assert.equal(titles.word, '', 'the producer placeholder is not a title');
  assert.equal(titles.untitled, '');
  assert.equal(titles.empty, '');
  assert.equal(titles.sameAsFile, '', 'a Title that is just the file name adds nothing');
  assert.equal(titles.wordCount, '');
});

test('自动流程只填空字段，手填的值不被覆盖', async () => {
  const result = await page.evaluate(() => {
    const { metadata, corpus } = window.lib;
    corpus.set('keep-manual', {
      documentId: 'keep-manual',
      doi: '10.1000/manual',
      publishDate: '1850',
      metadataStatus: 'pending',
    });
    // The user typed the DOI, the date and the authors; the automatic passes that follow must leave those alone.
    metadata.saveManualDocumentMetadata('keep-manual', {
      authors: ['Ada Lovelace'],
      publishDate: '1850',
      language: '',
      documentUrl: 'https://example.org/manual',
      doi: 'https://doi.org/10.1000/manual',
    });
    const afterManual = { ...corpus.get('keep-manual') };

    // An offline pass finds a different DOI and a different date: both are refused, the blank fields are filled.
    metadata.applyExtractedMetadata('keep-manual', {
      authors: [],
      publishDate: '1843',
      language: '',
      documentUrl: 'https://doi.org/10.1000/other',
      doi: '10.1000/other',
    }, 'text', { onlyEmpty: true });
    const afterOffline = { ...corpus.get('keep-manual') };

    // A model pass with `onlyEmpty: false` still cannot touch a manual field, but may fill a non-manual one.
    metadata.applyExtractedMetadata('keep-manual', {
      authors: ['Someone Else'],
      publishDate: '1999',
      language: 'zh',
      documentUrl: '',
      doi: '10.1000/third',
    }, 'ai');
    const afterModel = { ...corpus.get('keep-manual') };

    return {
      afterManual: { doi: afterManual.doi, date: afterManual.publishDate, sources: afterManual.metadataSources },
      afterOffline: {
        doi: afterOffline.doi,
        date: afterOffline.publishDate,
        sourceOfDoi: afterOffline.metadataSources.doi,
        sourceOfDate: afterOffline.metadataSources.publishDate,
      },
      afterModel: {
        doi: afterModel.doi,
        authors: afterModel.authors,
        date: afterModel.publishDate,
        language: afterModel.language,
        sourceOfAuthors: afterModel.metadataSources.authors,
        sourceOfDoi: afterModel.metadataSources.doi,
      },
    };
  });

  assert.equal(result.afterManual.doi, '10.1000/manual');
  assert.equal(result.afterManual.sources.doi, 'manual');
  assert.equal(result.afterManual.sources.publishDate, 'manual');
  assert.equal(result.afterManual.sources.authors, 'manual');
  assert.equal(result.afterOffline.doi, '10.1000/manual', 'a manual DOI survives an automatic pass');
  assert.equal(result.afterOffline.date, '1850', 'and so does a manual date');
  assert.equal(result.afterOffline.sourceOfDoi, 'manual');
  assert.equal(result.afterModel.doi, '10.1000/manual', 'even a forced model pass cannot replace it');
  assert.equal(result.afterModel.date, '1850');
  assert.deepEqual(result.afterModel.authors, ['Ada Lovelace'], 'nor the author list the user typed');
  assert.equal(result.afterModel.language, 'zh', 'but a field nobody filled may still be filled');
  assert.equal(result.afterModel.sourceOfAuthors, 'manual');
  assert.equal(result.afterModel.sourceOfDoi, 'manual');
});

test('「无需补全」是终态，「缺元数据」只列真正还缺的', async () => {
  const state = await page.evaluate(() => {
    const { metadata, corpus } = window.lib;
    const seed = (id, patch = {}) => {
      corpus.set(id, { documentId: id, documentName: `${id}.pdf`, metadataStatus: 'ready', ...patch });
      return corpus.get(id);
    };
    const complete = seed('complete', {
      authors: ['Ada Lovelace'], publishDate: '1843', doi: '10.1000/x',
    });
    const noDoi = seed('no-doi', { authors: ['A B'], publishDate: '2020' });
    const noAuthors = seed('no-authors', { publishDate: '2020', doi: '10.1000/y' });
    const skipped = seed('skipped', {});
    const neverLooked = seed('never', { metadataStatus: 'pending' });

    metadata.skipDocumentMetadata('skipped');
    const afterSkip = corpus.get('skipped').metadataStatus;
    const skippedMissing = metadata.isMetadataMissing(corpus.get('skipped'));
    metadata.resumeDocumentMetadata('skipped');

    return {
      complete: metadata.isMetadataMissing(complete),
      noDoi: metadata.isMetadataMissing(noDoi),
      noAuthors: metadata.isMetadataMissing(noAuthors),
      neverLooked: metadata.isMetadataMissing(neverLooked),
      afterSkip,
      skippedMissing,
      afterResume: corpus.get('skipped').metadataStatus,
    };
  });

  assert.equal(state.complete, false, 'a citable record is not missing anything');
  assert.equal(state.noDoi, true);
  assert.equal(state.noAuthors, true, 'an author list is part of a citable record');
  assert.equal(state.neverLooked, true);
  assert.equal(state.afterSkip, 'skipped');
  assert.equal(state.skippedMissing, false, 'a document the user waved through never shows up again');
  assert.equal(state.afterResume, 'pending', 'and the decision is reversible');
});

test('手动填写：表单打开时带出已有值，保存走手动写入，粘贴标识符自动分配字段', async () => {
  const outcome = await page.evaluate(() => {
    const { panel, metadata, corpus } = window.lib;
    corpus.set('edit-1', {
      documentId: 'edit-1',
      documentName: 'edit-1.pdf',
      pageCount: 4,
      addedAt: '2026-01-01T00:00:00.000Z',
      indexStatus: 'ready',
      overviewStatus: 'pending',
      chunkCount: 2,
      metadataStatus: 'ready',
      authors: ['Ada Lovelace'],
      doi: '10.1000/old',
    });
    const calls = [];
    const handlers = {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {}, searchRelated() {},
      extractMetadata() {},
      saveMetadata: (documentId, value) => calls.push({ documentId, value }),
      toggleMetadataSkip: (documentId, skipped) => calls.push({ documentId, skipped }),
      changeReading() {}, moveToFolder() {},
    };
    panel.renderDocumentPanel(corpus.get('edit-1'), [], handlers);

    const edit = document.getElementById('knowledge-doc-biblio-edit');
    const view = document.getElementById('knowledge-doc-biblio-view');
    const before = { hiddenEdit: edit.hidden, hiddenView: view.hidden };

    document.getElementById('knowledge-doc-metadata-edit').click();
    const opened = {
      hiddenEdit: edit.hidden,
      hiddenView: view.hidden,
      authorsValue: document.getElementById('knowledge-doc-authors-input').value,
      doiValue: document.getElementById('knowledge-doc-doi-input').value,
    };

    // Paste-an-identifier is the fast path when the file states nothing: it fills DOI, link and date, nothing else.
    const identifier = document.getElementById('knowledge-doc-identifier-input');
    identifier.value = 'https://arxiv.org/abs/2401.01234v2';
    identifier.dispatchEvent(new Event('change'));
    const pasted = {
      doi: document.getElementById('knowledge-doc-doi-input').value,
      url: document.getElementById('knowledge-doc-url-input').value,
      date: document.getElementById('knowledge-doc-publish-date-input').value,
    };

    document.getElementById('knowledge-doc-authors-input').value = 'Ada Lovelace、Alan Turing';
    document.getElementById('knowledge-doc-metadata-save').click();
    const saved = calls[0] ?? null;

    document.getElementById('knowledge-doc-metadata-edit').click();
    const closed = { hiddenEdit: edit.hidden, hiddenView: view.hidden };

    document.getElementById('knowledge-doc-metadata-skip').click();
    const skipCall = calls[1] ?? null;

    return { before, opened, pasted, saved, closed, skipCall };
  });

  assert.equal(outcome.before.hiddenEdit, true, 'the form starts hidden');
  assert.equal(outcome.before.hiddenView, false);
  assert.equal(outcome.opened.hiddenEdit, false, '手动填写 swaps the list for the form');
  assert.equal(outcome.opened.hiddenView, true);
  assert.equal(outcome.opened.authorsValue, 'Ada Lovelace', 'the form starts from what is stored');
  assert.equal(outcome.opened.doiValue, '10.1000/old');
  assert.equal(outcome.pasted.doi, '10.1000/old', 'past pasting an arXiv link the stored DOI is left alone');
  assert.equal(outcome.pasted.url, 'https://arxiv.org/abs/2401.01234');
  assert.equal(outcome.pasted.date, '2024-01', 'the arXiv id carries the date too');
  assert.deepEqual(outcome.saved.value.authors, ['Ada Lovelace', 'Alan Turing'], 'multi-author separators are split');
  assert.equal(outcome.saved.documentId, 'edit-1');
  assert.equal(outcome.saved.value.doi, '10.1000/old');
  assert.equal(outcome.saved.value.documentUrl, 'https://arxiv.org/abs/2401.01234');
  assert.equal(outcome.closed.hiddenEdit, true, 'saving is followed by closing the form');
  assert.equal(outcome.closed.hiddenView, false);
  assert.equal(outcome.skipCall.skipped, true, 'the skip button says "mark it", not "unmark it"');
});

// ---------------------------------------------------------------------------
// 联网匹配的门槛: the only place where a wrong DOI could be attached.
// ---------------------------------------------------------------------------
test('标题相似度：差点儿的意思就是另一篇论文', async () => {
  const scores = await page.evaluate(() => {
    const { bibliographicMatch } = window.lib;
    const { titleSimilarity, normalizeMatchTitle, surnameKey, buildLookupTitle } = bibliographicMatch;
    return {
      identical: titleSimilarity('Deep Residual Learning', 'deep residual learning.'),
      subtitle: titleSimilarity(
        'Deep Residual Learning for Image Recognition',
        'Deep Residual Learning for Image Recognition: A Survey',
      ),
      nearMiss: titleSimilarity(
        'Deep Residual Learning for Image Recognition',
        'Deep Residual Learning for Image Restoration',
      ),
      different: titleSimilarity(
        'Deep Residual Learning for Image Recognition',
        'Attention Is All You Need',
      ),
      chinese: titleSimilarity('一种新的注意力机制', '一种新的注意力机制'),
      chineseNear: titleSimilarity('一种新的注意力机制', '一种新的注意力机制研究'),
      normalized: normalizeMatchTitle('  Attention:  Is All You Need?! '),
      surnameLatin: surnameKey('Ashish Vaswani'),
      surnameComma: surnameKey('Vaswani, Ashish'),
      surnameCjk: surnameKey('张三'),
      fromFileName: buildLookupTitle({ documentName: '2010-Boyar & Peralta-symposium.pdf' }),
      fromOverview: buildLookupTitle({
        overviewTitle: 'Detecting Text in Natural Scenes',
        documentName: '2016-xyz.pdf',
      }),
    };
  });
  assert.equal(scores.identical, 1);
  assert.ok(scores.subtitle >= 0.9, 'a subtitle variant is the same paper');
  assert.ok(scores.nearMiss < 0.9, 'one changed word ("Recognition" → "Restoration") must fail the gate');
  assert.ok(scores.different < 0.3);
  assert.equal(scores.chinese, 1);
  assert.ok(scores.chineseNear < 1 && scores.chineseNear >= 0.9, 'adding 研究 keeps a CJK title above the bar');
  assert.equal(scores.normalized, 'attention is all you need');
  assert.equal(scores.surnameLatin, 'vaswani');
  assert.equal(scores.surnameComma, 'ashish', 'a comma form still yields a comparable token');
  assert.equal(scores.surnameCjk, '张三');
  assert.equal(scores.fromFileName, 'Boyar & Peralta-symposium', 'the extension and the leading year are not title');
  assert.equal(scores.fromOverview, 'Detecting Text in Natural Scenes', 'the overview title wins when there is one');
});

test('在线候选要过两道关：标题几乎相同，且年份或作者能对上', async () => {
  const verdicts = await page.evaluate(() => {
    const { bibliographicMatch } = window.lib;
    const { evaluateMetadataCandidates } = bibliographicMatch;
    const candidate = (patch) => ({
      source: 'crossref', title: 'Deep Residual Learning for Image Recognition',
      authors: ['Kaiming He', 'Xiangyu Zhang'], publishDate: '2016-06',
      doi: '10.1109/CVPR.2016.90', documentUrl: 'https://doi.org/10.1109/CVPR.2016.90',
      containerTitle: 'CVPR', kind: 'proceedings-article', ...patch,
    });
    const query = { title: 'Deep Residual Learning for Image Recognition', authors: ['He'], year: 2016 };
    const good = evaluateMetadataCandidates(query, [candidate({})]);
    // No authors in the query: the year is then the *only* cross-check, so a four-year gap must fail on its own.
    const wrongYear = evaluateMetadataCandidates({ title: query.title, year: 2021 }, [candidate({})]);
    const wrongYearButSameAuthor = evaluateMetadataCandidates({ ...query, year: 2021 }, [candidate({})]);
    const wrongTitle = evaluateMetadataCandidates(query, [candidate({ title: 'Deep Residual Learning for Video' })]);
    const noWayToCheck = evaluateMetadataCandidates({ title: query.title }, [candidate({})]);
    const shortQuery = evaluateMetadataCandidates({ title: 'A Survey' }, [candidate({ title: 'A Survey' })]);
    const duplicates = evaluateMetadataCandidates(query, [
      candidate({}),
      candidate({ source: 'openalex' }),
    ]);
    const ordering = evaluateMetadataCandidates(query, [
      candidate({ title: 'Deep Residual Learning for Image Restoration', doi: '10.9999/other' }),
      candidate({}),
    ]);
    return {
      good: good.map((item) => ({ accepted: item.accepted, reason: item.reason })),
      wrongYear: wrongYear[0],
      wrongYearButSameAuthor: wrongYearButSameAuthor[0],
      wrongTitle: wrongTitle[0],
      noWayToCheck: noWayToCheck[0],
      shortQuery: shortQuery[0],
      duplicates: duplicates.length,
      ordering: ordering.map((item) => item.accepted),
    };
  });

  assert.equal(verdicts.good[0].accepted, true);
  assert.equal(verdicts.good[0].reason, '');
  assert.equal(verdicts.wrongYear.accepted, false, 'a year four years off is not this paper');
  assert.match(verdicts.wrongYear.reason, /年份和作者/, 'and the panel can say why');
  assert.equal(
    verdicts.wrongYearButSameAuthor.accepted,
    true,
    'a matching author surname is the second independent signal, so a re-published version still passes',
  );
  assert.equal(verdicts.wrongTitle.accepted, false);
  assert.match(verdicts.wrongTitle.reason, /标题相似度/);
  assert.equal(verdicts.noWayToCheck.accepted, false, 'a title alone is not enough to attach a DOI');
  assert.equal(verdicts.shortQuery.accepted, false, 'a short title matches too many papers');
  assert.match(verdicts.shortQuery.reason, /太短/);
  assert.equal(verdicts.duplicates, 1, 'the same DOI from two sources is one suggestion');
  assert.deepEqual(verdicts.ordering, [true, false], 'accepted candidates are listed first');
});

test('Crossref 先查，查不到或失败才找 OpenAlex，失败原因分开报告', async () => {
  const result = await page.evaluate(async () => {
    const { lookupService, setOpenAlex } = window.lib;
    const crossrefBody = (items) => ({ ok: true, json: async () => ({ message: { items } }) });
    const originalFetch = window.fetch;

    const run = async (fetchImpl, openAlexWorks = []) => {
      window.fetch = fetchImpl;
      setOpenAlex(async () => openAlexWorks);
      return lookupService.lookupBibliographicRecords({ title: 'Deep Residual Learning for Image Recognition' });
    };

    const mapped = await run(async () => crossrefBody([{
      DOI: '10.1109/CVPR.2016.90',
      title: ['Deep Residual Learning for Image Recognition'],
      author: [{ given: 'Kaiming', family: 'He' }, { given: 'Xiangyu', family: 'Zhang' }],
      issued: { 'date-parts': [[2016, 6]] },
      'container-title': ['CVPR'],
      type: 'proceedings-article',
    }]));

    let openAlexCalls = 0;
    const failedCrossref = await run(async () => ({ ok: false, status: 503 }));
    setOpenAlex(async () => {
      openAlexCalls += 1;
      return [{
        title: 'A Paper From OpenAlex', url: 'https://doi.org/10.1000/oa', year: '2019',
        authors: 'Ada Lovelace, Alan Turing', source: 'openalex', summary: '', content: '',
        siteName: '', authority: -1, rerankScore: 0, citedByCount: 3,
      }];
    });
    const openAlexOnly = await lookupService.lookupBibliographicRecords({ title: 'A Paper From OpenAlex' });

    const bothFail = await (async () => {
      window.fetch = async () => ({ ok: false, status: 500 });
      setOpenAlex(async () => { throw new Error('openalex down'); });
      return lookupService.lookupBibliographicRecords({ title: 'Nothing' });
    })();

    const empty = await run(async () => crossrefBody([]), []);
    const blank = await lookupService.lookupBibliographicRecords({ title: '   ' });
    window.fetch = originalFetch;
    return {
      mapped: mapped.candidates[0],
      mappedErrors: mapped.errors,
      failedCrossrefCandidates: failedCrossref.candidates.length,
      failedCrossrefErrors: failedCrossref.errors,
      openAlexCalls,
      openAlexOnly: openAlexOnly.candidates[0],
      openAlexErrors: openAlexOnly.errors,
      bothFail: { candidates: bothFail.candidates.length, errors: bothFail.errors.length },
      empty: { candidates: empty.candidates.length, errors: empty.errors.length },
      blank: blank.errors,
    };
  });

  assert.equal(result.mapped.doi, '10.1109/CVPR.2016.90');
  assert.equal(result.mapped.publishDate, '2016-06', 'the date keeps its month without inventing a day');
  assert.deepEqual(result.mapped.authors, ['Kaiming He', 'Xiangyu Zhang']);
  assert.equal(result.mapped.containerTitle, 'CVPR');
  assert.equal(result.mapped.documentUrl, 'https://doi.org/10.1109/CVPR.2016.90');
  assert.deepEqual(result.mappedErrors, [], 'a successful Crossref answer needs no OpenAlex call');
  assert.equal(result.failedCrossrefCandidates, 0);
  assert.match(result.failedCrossrefErrors[0], /Crossref/);
  assert.equal(result.openAlexOnly.title, 'A Paper From OpenAlex');
  assert.equal(result.openAlexOnly.doi, '10.1000/oa', 'the resolver prefix is stripped for storage');
  assert.deepEqual(result.openAlexOnly.authors, ['Ada Lovelace', 'Alan Turing']);
  assert.match(result.openAlexErrors[0], /Crossref/, 'the Crossref failure is still reported');
  assert.deepEqual(result.bothFail, { candidates: 0, errors: 2 }, 'both failures are kept, not collapsed into one');
  assert.deepEqual(result.empty, { candidates: 0, errors: 0 }, 'empty is not a failure');
  assert.match(result.blank[0], /标题/);
});

test('面板只给可信候选「填入」，其余只说明为什么不能填', async () => {
  const outcome = await page.evaluate(() => {
    const { panel, corpus, lookupModule } = window.lib;
    corpus.set('lookup-1', {
      documentId: 'lookup-1', documentName: 'Deep Residual Learning.pdf', pageCount: 10,
      addedAt: '2026-01-01T00:00:00.000Z', indexStatus: 'ready', overviewStatus: 'ready',
      chunkCount: 3, metadataStatus: 'ready', authors: ['Kaiming He'], publishDate: '2016',
    });
    const calls = [];
    const handlers = {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {}, searchRelated() {},
      extractMetadata() {}, saveMetadata() {}, toggleMetadataSkip() {}, changeReading() {}, moveToFolder() {},
      lookupMetadata: (id) => calls.push({ kind: 'lookup', id }),
      applyMetadataSuggestion: (id, candidate) => calls.push({ kind: 'apply', id, candidate }),
      dismissMetadataSuggestions: (id) => calls.push({ kind: 'dismiss', id }),
    };
    const accepted = {
      candidate: {
        source: 'crossref', title: 'Deep Residual Learning for Image Recognition',
        authors: ['Kaiming He'], publishDate: '2016-06', doi: '10.1109/CVPR.2016.90',
        documentUrl: 'https://doi.org/10.1109/CVPR.2016.90', containerTitle: 'CVPR', kind: 'proceedings-article',
      },
      titleSimilarity: 1, accepted: true, reason: '',
    };
    const refused = {
      candidate: {
        source: 'openalex', title: 'Deep Residual Learning for Video Action Recognition',
        authors: ['Someone'], publishDate: '2020', doi: '', documentUrl: '', containerTitle: '', kind: '',
      },
      titleSimilarity: 0.72, accepted: false, reason: '标题相似度只有 72%，不是同一篇',
    };

    lookupModule.resetLookupState();
    const errors = [];
    window.addEventListener('error', (event) => errors.push(String(event.message)));
    panel.renderDocumentPanel(corpus.get('lookup-1'), [], handlers);
    const idle = {
      hidden: document.getElementById('knowledge-doc-metadata-suggestions').hidden,
    };

    lookupModule.setLookupState({ lookedUp: true, message: '在线找到 1 条可信候选，确认后才会写入。', suggestions: [accepted, refused] });
    panel.renderDocumentPanel(corpus.get('lookup-1'), [], handlers);
    const shown = {
      hidden: document.getElementById('knowledge-doc-metadata-suggestions').hidden,
      note: document.getElementById('knowledge-doc-metadata-suggestions-note').textContent,
      titles: [...document.querySelectorAll('.knowledge-doc-suggestion-title')].map((node) => node.textContent),
      applyButtons: [...document.querySelectorAll('.knowledge-doc-suggestion-apply')].map((node) => node.textContent),
      reasons: [...document.querySelectorAll('.knowledge-doc-suggestion-reason')].map((node) => node.textContent),
    };
    document.querySelector('.knowledge-doc-suggestion-apply').click();
    const afterApply = calls.length;
    document.querySelector('.knowledge-doc-suggestion-dismiss').click();
    const afterDismiss = calls.length;

    lookupModule.setLookupState({ running: true, suggestions: [] });
    panel.renderDocumentPanel(corpus.get('lookup-1'), [], handlers);
    const running = {
      label: document.getElementById('knowledge-doc-metadata-online').textContent,
      disabled: document.getElementById('knowledge-doc-metadata-online').disabled,
    };
    // A disabled button must not start a second lookup (the module also guards this, but the browser should not even try).
    document.getElementById('knowledge-doc-metadata-online').click();
    const afterDisabledClick = calls.length;

    lookupModule.setLookupState({ running: false, lookedUp: true, message: '在线查找没有找到这份文献的记录。' });
    panel.renderDocumentPanel(corpus.get('lookup-1'), [], handlers);
    document.getElementById('knowledge-doc-metadata-online').click();
    return {
      idle, shown, calls, running, errors, afterApply, afterDismiss, afterDisabledClick, afterLookup: calls.length,
    };
  });

  assert.equal(outcome.idle.hidden, true, 'no lookup yet means no suggestion block');
  assert.deepEqual(outcome.errors, [], 'nothing threw while clicking the suggestion controls');
  assert.equal(
    [outcome.afterApply, outcome.afterDismiss].join(','),
    '1,2',
    '填入 and 都不对 each reach their handler',
  );
  assert.equal(outcome.shown.hidden, false);
  assert.match(outcome.shown.note, /确认后才会写入/);
  assert.deepEqual(outcome.shown.titles, [
    'Deep Residual Learning for Image Recognition',
    'Deep Residual Learning for Video Action Recognition',
  ], 'the accepted one comes first, the refused one is still shown');
  assert.deepEqual(outcome.shown.applyButtons, ['填入'], 'only the accepted candidate gets a write button');
  assert.match(outcome.shown.reasons[0], /72%/, 'and the refused one says why it cannot be filled');
  assert.equal(outcome.calls[0].kind, 'apply', '填入 hands the candidate to the action layer');
  assert.equal(outcome.calls[0].candidate.doi, '10.1109/CVPR.2016.90');
  assert.equal(outcome.calls[1].kind, 'dismiss');
  assert.equal(outcome.running.label, '查找中…');
  assert.equal(outcome.running.disabled, true, 'a second click while a lookup is in flight is refused by the browser');
  assert.equal(outcome.afterDisabledClick, 2, 'so nothing is sent while one is running');
  assert.equal(outcome.afterLookup, 3, 'the button is the only thing that starts a lookup');
});

test('联网查找只是建议：不写库、不自动填，过不了门槛的明确不带填入', async () => {
  const outcome = await page.evaluate(async () => {
    const { lookupClient, lookupClientCalls, setLookupResponse, corpus, metadata } = window.lib;
    corpus.set('online-1', {
      documentId: 'online-1',
      documentName: '2016-Deep Residual Learning for Image Recognition.pdf',
      pageCount: 10,
      addedAt: '2026-01-01T00:00:00.000Z',
      indexStatus: 'ready',
      overviewStatus: 'pending',
      chunkCount: 0,
      metadataStatus: 'ready',
      authors: ['Kaiming He'],
      publishDate: '2016',
    });
    const before = JSON.stringify(metadata.readDocumentMetadata(corpus.get('online-1')));

    setLookupResponse({
      ok: true,
      bibliographicCandidates: [
        {
          source: 'crossref', title: 'Deep Residual Learning for Image Recognition',
          authors: ['Kaiming He'], publishDate: '2016-06', doi: '10.1109/CVPR.2016.90',
          documentUrl: 'https://doi.org/10.1109/CVPR.2016.90', containerTitle: 'CVPR', kind: 'proceedings-article',
        },
        {
          source: 'openalex', title: 'Deep Residual Learning for Video Action Recognition',
          authors: ['Someone Else'], publishDate: '2020', doi: '10.1000/wrong',
          documentUrl: 'https://doi.org/10.1000/wrong', containerTitle: '', kind: '',
        },
        // The same work again from the second source: the gate must not offer it twice.
        {
          source: 'openalex', title: 'Deep Residual Learning for Image Recognition',
          authors: ['Kaiming He'], publishDate: '2016', doi: '10.1109/CVPR.2016.90',
          documentUrl: 'https://doi.org/10.1109/CVPR.2016.90', containerTitle: '', kind: '',
        },
      ],
      bibliographicLookupErrors: [],
    });

    const suggestions = await lookupClient.lookupDocumentMetadata(corpus.get('online-1'));
    const state = lookupClient.readMetadataLookupState('online-1');
    const after = JSON.stringify(metadata.readDocumentMetadata(corpus.get('online-1')));

    setLookupResponse({ ok: false, error: '被拒绝' });
    await lookupClient.lookupDocumentMetadata(corpus.get('online-1'));
    const failed = lookupClient.readMetadataLookupState('online-1');

    setLookupResponse({
      ok: true, bibliographicCandidates: [], bibliographicLookupErrors: ['Crossref：Crossref HTTP 503'],
    });
    await lookupClient.lookupDocumentMetadata(corpus.get('online-1'));
    const offlineSource = lookupClient.readMetadataLookupState('online-1');

    return {
      sentTitle: lookupClientCalls[0]?.title,
      sentType: lookupClientCalls[0]?.type,
      callCount: lookupClientCalls.length,
      accepted: suggestions.filter((item) => item.accepted).map((item) => item.candidate.doi),
      refused: suggestions.filter((item) => !item.accepted).map((item) => item.candidate.doi),
      message: state.message,
      lookedUp: state.lookedUp,
      unchanged: before === after,
      failedMsg: failed.message,
      failedFlag: failed.failed,
      offlineSource: { message: offlineSource.message, failed: offlineSource.failed },
    };
  });

  assert.equal(outcome.sentType, 'pdf-helper:lookup-bibliographic-metadata');
  assert.equal(outcome.sentTitle, 'Deep Residual Learning for Image Recognition', 'the file name is cleaned into a title');
  assert.equal(outcome.callCount, 3, 'exactly one message per press, nothing retried behind the user\'s back');
  assert.deepEqual(outcome.accepted, ['10.1109/CVPR.2016.90'], 'one accepted suggestion, deduped across sources');
  assert.deepEqual(outcome.refused, ['10.1000/wrong'], 'the near miss is kept, but without a fill button');
  assert.match(outcome.message, /确认后才会写入/);
  assert.equal(outcome.lookedUp, true);
  assert.equal(outcome.unchanged, true, 'a lookup writes nothing — not even on an accepted candidate');
  assert.match(outcome.failedMsg, /在线查找失败/);
  assert.equal(outcome.failedFlag, true);
  assert.match(outcome.offlineSource.message, /HTTP 503/, 'what the source said is passed on, not swallowed');
  assert.equal(outcome.offlineSource.failed, true);
});

test('底部四个动作按钮排成两行两列', async () => {
  const layout = await page.evaluate(() => {
    const { panel, corpus } = window.lib;
    corpus.set('layout-1', {
      documentId: 'layout-1', documentName: 'Layout.pdf', pageCount: 3,
      addedAt: '2026-01-01T00:00:00.000Z', indexStatus: 'ready', overviewStatus: 'ready',
      chunkCount: 1, metadataStatus: 'ready',
    });
    panel.renderDocumentPanel(corpus.get('layout-1'), [], {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {}, searchRelated() {},
      extractMetadata() {}, saveMetadata() {}, toggleMetadataSkip() {}, changeReading() {}, moveToFolder() {},
      lookupMetadata() {}, applyMetadataSuggestion() {}, dismissMetadataSuggestions() {},
    });
    const footer = document.querySelector('.knowledge-doc-actions');
    const buttons = [...footer.querySelectorAll('button')];
    return {
      tracks: getComputedStyle(footer).gridTemplateColumns.split(' ').filter(Boolean).length,
      rows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
      clipped: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).length,
      labels: buttons.map((button) => button.textContent.trim()),
    };
  });
  assert.equal(layout.tracks, 2, 'the footer is a two-column grid, not a stack');
  assert.equal(layout.rows, 2, 'four buttons end up on two rows');
  assert.equal(layout.clipped, 0, 'no label is truncated at 330px');
  assert.deepEqual(
    layout.labels.slice(1),
    ['打开原文', '在图谱中查看', '移出知识库'],
  );
  assert.ok(
    ['查看概览', '生成概览'].includes(layout.labels[0]),
    'the first button is the overview action, whichever of its two labels applies',
  );
});

test('相关论文直接渲染在右栏，不再只能去概览末尾找', async () => {
  const outcome = await page.evaluate(() => {
    const { panel, corpus, markdownCalls } = window.lib;
    const handlers = {
      openOverview() {}, openSource() {}, openGraph() {}, remove() {}, searchRelated() {},
      extractMetadata() {}, saveMetadata() {}, toggleMetadataSkip() {}, changeReading() {}, moveToFolder() {},
      lookupMetadata() {}, applyMetadataSuggestion() {}, dismissMetadataSuggestions() {},
    };
    const base = {
      pageCount: 10, addedAt: '2026-01-01T00:00:00.000Z', indexStatus: 'ready',
      overviewStatus: 'ready', chunkCount: 5, metadataStatus: 'ready',
    };
    corpus.set('related-1', {
      ...base,
      documentId: 'related-1',
      documentName: 'With Related.pdf',
      relatedLiteratureMarkdown: [
        '## 相关论文',
        '',
        '### Logic Minimization Techniques',
        '',
        'https://doi.org/10.1007/s00145-012-9124-7',
        '',
        '- 2012 · Joan Boyar',
      ].join('\n'),
      relatedLiteratureSources: ['deepseek', 'openalex'],
      relatedLiteratureUsage: { searchCalls: 1, fetchCalls: 0 },
      relatedLiteratureAt: '2026-10-19T04:02:58.000Z',
    });
    corpus.set('related-2', {
      ...base, documentId: 'related-2', documentName: 'Without Related.pdf', overviewStatus: 'pending',
    });

    markdownCalls.length = 0;
    panel.renderDocumentPanel(corpus.get('related-1'), [], handlers);
    const withContent = {
      hidden: document.getElementById('knowledge-doc-related-content').hidden,
      text: document.getElementById('knowledge-doc-related-content').textContent,
      note: document.getElementById('knowledge-doc-related-note').textContent,
      rendered: markdownCalls.length,
    };

    panel.renderDocumentPanel(corpus.get('related-2'), [], handlers);
    const withoutContent = {
      hidden: document.getElementById('knowledge-doc-related-content').hidden,
      text: document.getElementById('knowledge-doc-related-content').textContent,
      note: document.getElementById('knowledge-doc-related-note').textContent,
    };
    return { withContent, withoutContent, lastRendered: markdownCalls[0] ?? '' };
  });

  assert.equal(outcome.withContent.hidden, false, 'the section is rendered in the panel, not left for the dialog');
  assert.ok(outcome.withContent.rendered >= 1, 'it goes through the same markdown renderer as the overview');
  assert.equal(outcome.lastRendered.startsWith('## 相关论文'), false, 'the stored heading is dropped');
  assert.ok(outcome.lastRendered.includes('Logic Minimization Techniques'), 'the body survives');
  assert.match(outcome.withContent.text, /Logic Minimization Techniques/);
  assert.equal(outcome.withContent.note, '', 'no "go and look in 查看概览" line any more');
  assert.equal(outcome.withoutContent.hidden, true, 'a document without a section renders nothing');
  assert.equal(outcome.withoutContent.text, '');
  assert.match(outcome.withoutContent.note, /检索一份清单|检索一次/, 'and the note says what the button will do');

  // CSS contract: one rule between candidates, none above the first. The model is asked for `###` per paper, so the
  // separator has to hang off "a heading that is not the first element".
  const separators = await page.evaluate(() => {
    const holder = document.getElementById('knowledge-doc-related-content');
    holder.hidden = false;
    holder.innerHTML = '<h3>First paper</h3><p>body</p><h3>Second paper</h3><p>body</p><h3>Third paper</h3>';
    return [...holder.querySelectorAll('h3')].map((node) => ({
      border: getComputedStyle(node).borderTopWidth,
      padding: getComputedStyle(node).paddingTop,
    }));
  });
  assert.equal(separators[0].border, '0px', 'no rule above the first entry');
  assert.equal(separators[1].border, '1px', 'a rule separates the second entry from the first');
  assert.equal(separators[2].border, '1px');
  assert.notEqual(separators[1].padding, '0px', 'and the rule has room to breathe');
});

test('文献与本地文件的关联存在独立存储里，不随「最近打开」的 12 项轮换消失', async () => {
  const outcome = await page.evaluate(async () => {
    const { fileHandleStore } = window.lib;
    // A real `FileSystemFileHandle` from the origin-private file system: only platform objects are structured-cloneable,
    // which is exactly why a plain object would pass in a fake and fail in production.
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle('2008-Boyar.pdf', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array([1, 2, 3]));
    await writable.close();

    await fileHandleStore.putDocumentFileHandle('doc-link-1', handle);
    const found = await fileHandleStore.getDocumentFileHandle('doc-link-1');
    const file = found ? await found.getFile() : null;
    const missing = await fileHandleStore.getDocumentFileHandle('never-linked');
    // A remote document has no handle; asking to store nothing must be a no-op rather than an error or an empty record.
    await fileHandleStore.putDocumentFileHandle('doc-remote', null);
    const remote = await fileHandleStore.getDocumentFileHandle('doc-remote');
    await fileHandleStore.deleteDocumentFileHandle('doc-link-1');
    const afterDelete = await fileHandleStore.getDocumentFileHandle('doc-link-1');
    return {
      name: found?.name ?? '',
      restoredBytes: file ? file.size : 0,
      missing,
      remote,
      afterDelete,
    };
  });

  assert.equal(outcome.name, '2008-Boyar.pdf', 'the handle survives the round trip');
  assert.equal(outcome.restoredBytes, 3, 'and it can still produce the file');
  assert.equal(outcome.missing, null, 'an unknown document has no link');
  assert.equal(outcome.remote, null, 'storing nothing is a no-op, not a record');
  assert.equal(outcome.afterDelete, null, 'deleting the link really removes it');
});

test('复制引用：四种格式可切换，缺项写在下面，复制走剪贴板', async () => {
  const outcome = await page.evaluate(async () => {
    const { citationDialog } = window.lib;
    const copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { copied.push(text); } },
    });
    citationDialog.registerCitationDialogEvents();
    citationDialog.openCitationDialog({
      documentId: 'pdf:one',
      documentName: '2010-Boyar-…-technique.pdf',
      pageCount: 12,
      title: 'A new combinational logic minimization technique',
      authors: ['Joan Boyar', 'René Peralta'],
      publishDate: '2010',
      doi: '10.1007/978-3-642-16342-5_6',
      documentUrl: '',
      language: 'en',
    });
    const styles = [...document.querySelectorAll('[data-citation-style]')].map((button) => ({
      id: button.dataset.citationStyle,
      label: button.textContent,
      active: button.classList.contains('active'),
    }));
    const initial = document.getElementById('knowledge-citation-text').textContent;
    // Switch to each format and record what it shows.
    const shown = {};
    for (const style of ['ris', 'gbt7714', 'markdown', 'bibtex']) {
      document.querySelector(`[data-citation-style="${style}"]`).click();
      shown[style] = document.getElementById('knowledge-citation-text').textContent;
    }
    document.getElementById('knowledge-citation-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const status = document.getElementById('knowledge-citation-status').textContent;
    const warnings = [...document.querySelectorAll('#knowledge-citation-warnings p')].map((line) => line.textContent);

    // A record with nothing but a file name: the dialog must say what is missing instead of quietly emitting it.
    citationDialog.openCitationDialog({
      documentId: 'pdf:two',
      documentName: 'Some Scan.pdf',
      pageCount: 3,
    });
    const sparseWarnings = [...document.querySelectorAll('#knowledge-citation-warnings p')].map((line) => line.textContent);
    const sparseText = document.getElementById('knowledge-citation-text').textContent;
    document.getElementById('knowledge-citation-done').click();
    const closed = !document.getElementById('knowledge-citation-dialog').open;
    return { styles, initial, shown, copied, status, warnings, sparseWarnings, sparseText, closed };
  });

  assert.deepEqual(outcome.styles.map((style) => style.id), ['bibtex', 'ris', 'gbt7714', 'markdown']);
  assert.deepEqual(outcome.styles.filter((style) => style.active).map((style) => style.id), ['bibtex'],
    'BibTeX is the default: most of this library ends up in LaTeX or a reference manager');
  assert.match(outcome.initial, /^@misc\{Boyar2010,/);
  assert.match(outcome.shown.ris, /^TY  - GEN/);
  assert.match(outcome.shown.gbt7714, /\[EB\/OL\]/);
  assert.match(outcome.shown.markdown, /^\[A new combinational logic minimization technique\]\(https:\/\/doi\.org\//);

  assert.equal(outcome.copied.length, 1, 'the copy button copies exactly once');
  assert.equal(outcome.copied[0], outcome.shown.bibtex, 'and what it copies is what the dialog shows');
  assert.match(outcome.status, /已复制 BibTeX/);
  assert.deepEqual(outcome.warnings, [], 'a complete record has nothing to warn about');

  // The sparse record: title falls back to the file name, and every missing field is spelled out.
  assert.equal(outcome.sparseWarnings.length, 4, JSON.stringify(outcome.sparseWarnings));
  assert.match(outcome.sparseText, /title = \{Some Scan\}/, 'the file name is used, but only as a last resort');
  assert.equal(outcome.closed, true);
});

test('数据体检：每条问题一个动作，人工的那条没有按钮，徽标只在有问题时出现', async () => {
  const outcome = await page.evaluate(async () => {
    const { dataHealthDialog } = window.lib;
    const fixed = [];
    const report = {
      total: 3,
      broken: 1,
      findings: [
        {
          kind: 'chunks-missing', severity: 'broken', documentId: 'd1', documentName: 'Lost Index.pdf',
          message: '记录显示已索引 5 个片段，但本地分块数据是 0 段。', fix: 'rebuild-index',
          fixLabel: '重建索引', costsMoney: false,
        },
        {
          kind: 'metadata-missing', severity: 'warn', documentId: 'd1', documentName: 'Lost Index.pdf',
          message: '作者、发表日期、DOI 都还空着。', fix: 'complete-metadata',
          fixLabel: '补全元数据', costsMoney: true,
        },
        {
          kind: 'duplicate', severity: 'warn', documentId: 'd2', documentName: 'Same Paper.pdf',
          message: '知识库里还有 1 条同名同页数的记录。', fix: 'manual',
          fixLabel: '确认保留哪一条后再删掉其余记录。', costsMoney: false,
        },
      ],
    };
    dataHealthDialog.configureDataHealthDialog({
      fix: async (finding) => {
        fixed.push(finding.kind);
        return '已处理。';
      },
      rescan: async () => ({ total: 0, broken: 0, findings: [] }),
    });
    // The dialog's own buttons (close/done/rescan) are bound by this call — normally `installDataHealth()` does it.
    dataHealthDialog.registerDataHealthDialogEvents(() => {});
    dataHealthDialog.renderDataHealth(report);
    const badge = document.getElementById('knowledge-data-health-count');
    const beforeOpen = {
      badgeText: badge.textContent,
      badgeHidden: badge.hidden,
      badgeBroken: badge.classList.contains('is-broken'),
    };

    dataHealthDialog.openDataHealthDialog(report);
    const rows = [...document.querySelectorAll('.knowledge-data-health-row')].map((row) => ({
      kind: row.dataset.kind,
      severity: row.classList.contains('is-broken') ? 'broken' : 'warn',
      fixLabel: row.querySelector('.knowledge-data-health-fix')?.textContent ?? null,
      hint: row.querySelector('.knowledge-data-health-hint')?.textContent ?? null,
      badge: row.querySelector('.knowledge-data-health-badge')?.textContent ?? '',
    }));
    const dialogElement = document.getElementById('knowledge-data-health-dialog');
    const dialogOpen = Boolean(dialogElement?.open);
    const diagnostic = {
      hasDialog: Boolean(dialogElement),
      openAttr: dialogElement?.getAttribute('open'),
    };
    const groupCount = document.querySelectorAll('.knowledge-data-health-group').length;

    // The paid action says so on the button; the manual one has no button at all.
    document.querySelector('.knowledge-data-health-fix').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterFix = {
      fixed,
      rowsLeft: document.querySelectorAll('.knowledge-data-health-row').length,
      badgeHidden: badge.hidden,
    };
    document.getElementById('knowledge-data-health-done').click();
    return { beforeOpen, rows, dialogOpen, groupCount, afterFix, diagnostic, closed: !document.getElementById('knowledge-data-health-dialog').open };
  });

  assert.equal(outcome.beforeOpen.badgeText, '3');
  assert.equal(outcome.beforeOpen.badgeHidden, false);
  assert.equal(outcome.beforeOpen.badgeBroken, true, 'a broken finding is not painted like a cosmetic one');
  assert.equal(outcome.diagnostic.hasDialog, true, 'the dialog partial is part of the page');
  assert.equal(outcome.dialogOpen, true, JSON.stringify(outcome.diagnostic));
  assert.equal(outcome.groupCount, 2, 'rows are grouped by document');

  assert.deepEqual(outcome.rows.map((row) => row.kind), ['chunks-missing', 'metadata-missing', 'duplicate']);
  assert.deepEqual(outcome.rows.map((row) => row.severity), ['broken', 'warn', 'warn']);
  assert.equal(outcome.rows[0].fixLabel, '重建索引', 'a free action has no price tag');
  assert.equal(outcome.rows[1].fixLabel, '补全元数据（计费）', 'a paid action says so on the button');
  assert.equal(outcome.rows[2].fixLabel, null, 'the duplicate finding has no automatic fix in v1');
  assert.match(outcome.rows[2].hint, /确认保留/, 'it explains what to do instead');
  assert.deepEqual(outcome.rows.map((row) => row.badge), ['不可用', '不一致', '不一致']);

  assert.deepEqual(outcome.afterFix.fixed, ['chunks-missing'], 'one click fixes exactly one finding');
  assert.equal(outcome.afterFix.rowsLeft, 0, 'and the list is re-derived from the rescan, not patched locally');
  assert.equal(outcome.afterFix.badgeHidden, true, 'the badge goes away with the last finding');
  assert.equal(outcome.closed, true);
});

test('侧栏「缺元数据」计数与筛选一致', async () => {
  const counts = await page.evaluate(() => {
    const { panel, corpus, metadata } = window.lib;
    const documents = [];
    const add = (id, patch) => {
      const document = {
        documentId: id, documentName: `${id}.pdf`, pageCount: 3, addedAt: '2026-01-01T00:00:00.000Z',
        indexStatus: 'ready', overviewStatus: 'ready', chunkCount: 1, metadataStatus: 'ready', ...patch,
      };
      corpus.set(id, document);
      documents.push(document);
      return document;
    };
    add('full', { authors: ['A B'], publishDate: '2020', doi: '10.1000/z' });
    add('half', { authors: ['A B'] });
    const waved = add('waved', {});
    metadata.skipDocumentMetadata('waved');
    documents[2] = corpus.get('waved');
    panel.renderMetadataMissingCount(documents);
    return {
      text: document.getElementById('knowledge-missing-count').textContent,
      missing: documents.filter((item) => metadata.isMetadataMissing(item)).length,
    };
  });
  assert.equal(counts.text, '1', 'the counter agrees with the filter it belongs to');
  assert.equal(counts.missing, 1);
});

test('后台能从模型的各种回答里读出元数据', async () => {
  const parsed = await page.evaluate(() => {
    const { metadataService } = window.lib;
    const parse = (content) => metadataService.parseDocumentMetadataJson(content);
    return {
      plain: parse('{"authors":["A One","B Two"],"publishDate":"2026-05","language":"en","documentUrl":"https://x.test/a","doi":"10.1/abc"}'),
      fenced: parse('```json\n{"authors":"A One","doi":"10.1/abc"}\n```'),
      prose: parse('好的，结果如下：\n{"authors":["A One"],"url":"https://x.test/a"}\n希望有帮助。'),
      nested: parse('{"authors":["A {B} One"],"doi":"10.1/abc"}'),
      missing: parse('{"authors":[],"publishDate":"","language":"","documentUrl":"","doi":""}'),
      broken: parse('{"authors":["A One"'),
      chatter: parse('没有找到任何元数据。'),
      array: parse('[{"authors":["A"]}]'),
    };
  });

  assert.deepEqual(parsed.plain.authors, ['A One', 'B Two']);
  assert.equal(parsed.plain.doi, '10.1/abc');
  assert.deepEqual(parsed.fenced.authors, ['A One'], 'a fenced block is unwrapped');
  assert.deepEqual(parsed.prose.authors, ['A One'], 'JSON after a sentence is still found');
  assert.equal(parsed.prose.documentUrl, 'https://x.test/a', 'the `url` alias is accepted');
  assert.deepEqual(parsed.nested.authors, ['A {B} One'], 'braces inside strings do not confuse the scanner');
  assert.deepEqual(parsed.missing, {
    title: '', authors: [], publishDate: '', language: '', documentUrl: '', doi: '',
  }, 'an all-empty answer is a valid result');
  assert.equal(parsed.broken, null, 'a truncated object is not silently reported as empty');
  assert.equal(parsed.chatter, null);
  assert.equal(parsed.array, null, 'a bare array is not the shape we asked for');
});

test('思考占满输出额度时，元数据那次调用会加大额度重试', async () => {
  const runs = await page.evaluate(async () => {
    const { metadataService } = window.lib;
    const config = { providerId: 'deepseek', apiKey: 'k', baseUrl: 'https://x.test', model: 'm' };
    const budgetHit = () => Object.assign(new Error('模型已达到输出 Token 上限，但尚未生成正文。'), {
      details: { name: 'EmptyModelResponseError', finishReason: 'length', contentLength: 0, reasoningLength: 900 },
    });
    const answer = '{"authors":["Ada Lovelace"],"publishDate":"1843","language":"en","documentUrl":"","doi":"10.1/abc"}';

    // Attempt 1: thinking ate the whole budget (what the user hit). Attempt 2: the larger budget leaves room.
    const budgetsFirst = [];
    const recovering = {
      chat: async (_config, _messages, budget) => {
        budgetsFirst.push(budget);
        if (budgetsFirst.length === 1) throw budgetHit();
        return { content: answer, model: 'm', completion: { finishReason: 'stop' } };
      },
    };
    const recovered = await metadataService.extractDocumentMetadata(recovering, config, {
      documentName: 'notes.pdf', text: 'Ada Lovelace, 1843',
    });

    // Every attempt truncates the JSON: the ladder stops and says so instead of pretending nothing was found.
    const budgetsAll = [];
    const alwaysTruncated = {
      chat: async (_config, _messages, budget) => {
        budgetsAll.push(budget);
        return { content: '{"authors":["Ada', model: 'm', completion: { finishReason: 'length' } };
      },
    };
    const truncated = await metadataService.extractDocumentMetadata(alwaysTruncated, config, {
      documentName: 'notes.pdf', text: 'Ada Lovelace, 1843',
    });

    // A complete answer that simply is not JSON: one call, no retry ladder, and a truthful note.
    const budgetsChatter = [];
    const chatting = {
      chat: async (_config, _messages, budget) => {
        budgetsChatter.push(budget);
        return { content: '这篇文献没有署名。', model: 'm', completion: { finishReason: 'stop' } };
      },
    };
    const chatter = await metadataService.extractDocumentMetadata(chatting, config, {
      documentName: 'notes.pdf', text: 'Ada Lovelace, 1843',
    });

    // A real failure (bad key) is not retried: it is reported.
    const budgetsFatal = [];
    const failing = {
      chat: async () => {
        budgetsFatal.push(1);
        throw new Error('请先在 PDFPal 的“设置”中配置 API Key。');
      },
    };
    let fatal = '';
    try {
      await metadataService.extractDocumentMetadata(failing, config, { documentName: 'x.pdf', text: 'y' });
    } catch (error) {
      fatal = error.message;
    }

    return {
      recovered,
      budgetsFirst,
      truncated,
      budgetsAll,
      chatter,
      budgetsChatter,
      fatal,
      budgetsFatal: budgetsFatal.length,
    };
  });

  assert.deepEqual(runs.budgetsFirst, [2048, 4096], 'the second attempt gets a bigger budget, not the same one');
  assert.deepEqual(runs.recovered.authors, ['Ada Lovelace'], 'and the answer it finally got is kept');
  assert.equal(runs.recovered.doi, '10.1/abc');
  assert.deepEqual(runs.budgetsAll, [2048, 4096, 8192], 'the ladder is bounded');
  assert.deepEqual(runs.truncated.authors, [], 'a permanently truncated answer stores nothing');
  assert.match(runs.truncated.degraded, /截断/, 'and says it was truncated, not that nothing was found');
  assert.deepEqual(runs.budgetsChatter, [2048], 'a complete non-JSON answer is not retried');
  assert.match(runs.chatter.degraded, /JSON/);
  assert.equal(runs.fatal, '请先在 PDFPal 的“设置”中配置 API Key。', 'provider failures surface as failures');
  assert.equal(runs.budgetsFatal, 1, 'and cost exactly one call');
});

test('同一篇文献换了一份文件（批注保存后再打开）不会被重复添加', async () => {
  const result = await page.evaluate(() => {
    const { identityMatch, corpusAdapter } = window.lib;
    const key = identityMatch.paperNameKey;

    const keys = {
      plain: key('Attention Is All You Need.pdf'),
      caseAndSpace: key('  attention   is all you need.PDF '),
      pdfpal: key('Attention Is All You Need-pdfpal.pdf'),
      copy: key('Attention Is All You Need (1).pdf'),
      chineseCopy: key('注意力机制 副本.pdf'),
      annotated: key('Attention Is All You Need_annotated.pdf'),
      stacked: key('Attention Is All You Need-pdfpal (1).pdf'),
      numbered: key('Attention Is All You Need - 2.pdf'),
      // Names whose trailing number is part of the paper's name, not a copy marker: Llama-3 is not Llama-2.
      llama2: key('Llama-2.pdf'),
      llama3: key('Llama-3.pdf'),
    };

    // The real adapter: a record, then the same paper re-saved as a new file identity.
    localStorage.removeItem('pdf-helper-knowledge-corpus-v1');
    corpusAdapter.addKnowledgeDocument({
      documentId: 'pdf:AAA', documentName: 'Attention Is All You Need.pdf', pageCount: 15, recentEntryId: 'local:AAA',
    });
    corpusAdapter.addKnowledgeDocument({
      documentId: 'pdf:OTHER', documentName: 'Something Else.pdf', pageCount: 9,
    });
    const linked = corpusAdapter.linkKnowledgeDocumentSource('pdf:AAA', {
      sourceDocumentId: 'pdf:BBB', recentEntryId: 'local:BBB',
    });
    // Writes and reads by the *new* file identity land on the original record.
    corpusAdapter.updateKnowledgeDocument('pdf:BBB', { readingStatus: 'done' });
    const byAlias = corpusAdapter.getKnowledgeDocument('pdf:BBB');
    const byCanonical = corpusAdapter.getKnowledgeDocument('pdf:AAA');

    const documents = corpusAdapter.listKnowledgeDocuments();
    const matches = {
      decorated: identityMatch.findSamePaperDocument(documents, {
        documentId: 'pdf:CCC', documentName: 'Attention Is All You Need-pdfpal.pdf', pageCount: 15,
      })?.documentId ?? null,
      differentPages: identityMatch.findSamePaperDocument(documents, {
        documentId: 'pdf:CCC', documentName: 'Attention Is All You Need-pdfpal.pdf', pageCount: 16,
      })?.documentId ?? null,
      itself: identityMatch.findSamePaperDocument(documents, {
        documentId: 'pdf:AAA', documentName: 'Attention Is All You Need.pdf', pageCount: 15,
      })?.documentId ?? null,
      unrelated: identityMatch.findSamePaperDocument(documents, {
        documentId: 'pdf:CCC', documentName: 'Third Paper.pdf', pageCount: 12,
      })?.documentId ?? null,
    };

    // Removing by the alias removes the paper, not nothing.
    corpusAdapter.removeKnowledgeDocument('pdf:BBB');
    const remaining = corpusAdapter.listKnowledgeDocuments().map((item) => item.documentId);

    return {
      keys,
      linked: { documentId: linked?.documentId, aliases: linked?.aliases, recentEntryId: linked?.recentEntryId },
      byAlias: { documentId: byAlias?.documentId, readingStatus: byAlias?.readingStatus, recentEntryId: byAlias?.recentEntryId },
      byCanonical: { readingStatus: byCanonical?.readingStatus },
      matches,
      remaining,
    };
  });

  assert.equal(result.keys.plain, 'attention is all you need');
  assert.equal(result.keys.caseAndSpace, result.keys.plain, 'case and spacing do not matter');
  assert.equal(result.keys.pdfpal, result.keys.plain, 'the app’s own download suffix is stripped');
  assert.equal(result.keys.copy, result.keys.plain, 'a " (1)" copy is the same paper');
  assert.equal(result.keys.chineseCopy, '注意力机制', 'and so is a 副本');
  assert.equal(result.keys.annotated, result.keys.plain);
  assert.equal(result.keys.stacked, result.keys.plain, 'decorations stack');
  assert.equal(result.keys.numbered, result.keys.plain, 'a spaced " - 2" is a copy');
  assert.notEqual(result.keys.llama3, result.keys.llama2, 'but Llama-3 and Llama-2 are different papers');

  assert.equal(result.linked.documentId, 'pdf:AAA', 'the record keeps its id: the graph’s paper id hangs off it');
  assert.deepEqual(result.linked.aliases, ['pdf:BBB'], 'and remembers the newer file');
  assert.equal(result.linked.recentEntryId, 'local:BBB', 'so 「打开原文」 opens the annotated copy');
  assert.equal(result.byAlias.documentId, 'pdf:AAA', 'the new file resolves to the existing record');
  assert.equal(result.byAlias.readingStatus, 'done', 'and writes through the alias reach it');
  assert.equal(result.byAlias.recentEntryId, 'local:BBB');
  assert.equal(result.byCanonical.readingStatus, 'done', 'the canonical id sees the same record');

  assert.equal(result.matches.decorated, 'pdf:AAA', 'a re-saved copy matches the paper already in the library');
  assert.equal(result.matches.differentPages, null, 'a different page count means a different file, not the same paper');
  assert.equal(result.matches.itself, null, 'the exact same record is not a "match": that add just refreshes it');
  assert.equal(result.matches.unrelated, null);
  assert.ok(!result.remaining.includes('pdf:AAA'), 'removing through the alias removes the paper');
  assert.ok(result.remaining.includes('pdf:OTHER'), 'and leaves the rest alone');
});

test('续读位置的回写：只在页码变化时写，而且不动更新时间', async () => {
  const result = await page.evaluate(() => {
    const { corpusAdapter } = window.lib;
    localStorage.removeItem('pdf-helper-knowledge-corpus-v1');
    corpusAdapter.addKnowledgeDocument({
      documentId: 'pdf:PROGRESS', documentName: 'Progress.pdf', pageCount: 30,
    });
    const before = { ...corpusAdapter.getKnowledgeDocument('pdf:PROGRESS') };

    const first = corpusAdapter.setDocumentReadingProgress('pdf:PROGRESS', { page: 12, at: '2026-10-18T02:00:00.000Z' });
    const afterFirst = { ...corpusAdapter.getKnowledgeDocument('pdf:PROGRESS') };
    // 阅读器每 ~600ms 保存一次位置：同一页不该把整个库再序列化一遍。
    const samePage = corpusAdapter.setDocumentReadingProgress('pdf:PROGRESS', { page: 12, at: '2026-10-18T02:05:00.000Z' });
    const afterSame = { ...corpusAdapter.getKnowledgeDocument('pdf:PROGRESS') };
    const nextPage = corpusAdapter.setDocumentReadingProgress('pdf:PROGRESS', { page: 13, at: '2026-10-18T02:06:00.000Z' });
    const afterNext = { ...corpusAdapter.getKnowledgeDocument('pdf:PROGRESS') };
    const missing = corpusAdapter.setDocumentReadingProgress('pdf:NOPE', { page: 5 });
    const badPage = corpusAdapter.setDocumentReadingProgress('pdf:PROGRESS', { page: 0 });
    return { before, first, afterFirst, samePage, afterSame, nextPage, afterNext, missing, badPage };
  });

  assert.equal(result.first, true);
  assert.equal(result.afterFirst.lastReadPage, 12);
  assert.equal(result.afterFirst.lastReadAt, '2026-10-18T02:00:00.000Z');
  assert.equal(result.afterFirst.updatedAt, result.before.updatedAt, 'scrolling is not an edit: 更新时间 must not move');
  assert.equal(result.samePage, false, 'an unchanged page is not written again');
  assert.equal(result.afterSame.lastReadAt, '2026-10-18T02:00:00.000Z');
  assert.equal(result.nextPage, true);
  assert.equal(result.afterNext.lastReadPage, 13);
  assert.equal(result.missing, false);
  assert.equal(result.badPage, false);
});

test('手填一条元数据不会抹掉在线查来的 ISSN/出版类型的来源标记', async () => {
  const result = await page.evaluate(() => {
    const { metadata, corpus } = window.lib;
    corpus.set('manual-keep', {
      documentId: 'manual-keep',
      metadataStatus: 'ready',
    });
    // 一次「在线确认」：ISSN/ISBN/出版类型只可能来自 Crossref。
    metadata.applyExtractedMetadata('manual-keep', {
      title: 'T', authors: ['A One'], publishDate: '2020', language: 'en', documentUrl: '', doi: '10.1/x',
      containerTitle: 'Journal', volume: '1', issue: '2', page: '3-4',
      publisher: 'Springer', publisherPlace: 'Berlin', issn: '1234-5678', isbn: '', publicationKind: 'journal-article',
    }, 'online');
    // 然后用户手填作者并保存：表单对 ISSN/出版类型一律发空字符串。
    metadata.saveManualDocumentMetadata('manual-keep', {
      title: '', authors: ['A One', 'B Two'], publishDate: '', language: '', documentUrl: '', doi: '',
      containerTitle: '', volume: '', issue: '', page: '', publisher: '', publisherPlace: '',
      issn: '', isbn: '', publicationKind: '',
    });
    const document = corpus.get('manual-keep');
    return { sources: metadata.readMetadataSources(document), document };
  });

  assert.equal(result.document.authors.length, 2, 'the hand-typed value wins');
  assert.equal(result.sources.authors, 'manual');
  assert.equal(result.sources.issn, 'online', 'a field the form does not edit keeps the label it had');
  assert.equal(result.sources.publicationKind, 'online');
  assert.equal(result.sources.volume, 'online');
  assert.equal(result.document.issn, '1234-5678', 'and the value is still there');
});

console.log('Knowledge library workbench tests passed.');
