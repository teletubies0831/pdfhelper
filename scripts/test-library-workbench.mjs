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
    corpusAdapter: await readSource('src/modules/knowledge/adapters/browser-document-corpus.ts'),
    customSelect: await readSource('src/viewer/shared-ui/select/custom-select.ts'),
  };

  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A real origin, not `about:blank`: the corpus adapter stores into `localStorage`, which a `setContent` page refuses to
  // expose. Serving the template from a routed origin is the smallest way to get a storage-backed document.
  const template = await readFile(new URL('../src/viewer/templates/knowledge-base.html', import.meta.url), 'utf8');
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
      knowledgeDocSearchRelatedButton: byId('knowledge-doc-search-related'),
      knowledgeDocOverviewButton: byId('knowledge-doc-overview'),
      knowledgeDocOpenButton: byId('knowledge-doc-open'),
      knowledgeDocGraphButton: byId('knowledge-doc-graph'),
      knowledgeDocRemoveButton: byId('knowledge-doc-remove'),
      knowledgeDocAuthorsElement: byId('knowledge-doc-authors'),
      knowledgeDocDateElement: byId('knowledge-doc-publish-date'),
      knowledgeDocLanguageElement: byId('knowledge-doc-language'),
      knowledgeDocDoiElement: byId('knowledge-doc-doi'),
      knowledgeDocUrlElement: byId('knowledge-doc-url'),
      knowledgeDocMetadataNoteElement: byId('knowledge-doc-metadata-note'),
      knowledgeDocMetadataButton: byId('knowledge-doc-metadata'),
      knowledgeReadingCountElements: {
        todo: byId('knowledge-reading-count-todo'),
        reading: byId('knowledge-reading-count-reading'),
        done: byId('knowledge-reading-count-done'),
      },
    };

    const related = {
      relatedPapersAvailability: () => ({ available: true, reason: '' }),
      isRelatedPapersSearchRunning: () => false,
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

    // Availability/running are read from the viewer's live state, which this harness has no opinion about.
    const metadataExtraction = {
      isMetadataExtractionRunning: () => false,
      metadataExtractionAvailability: () => ({ available: true, reason: '调用一次模型读取首页信息' }),
    };

    const tableModel = load(code.tableModel, (name) => (
      name === '../../../modules/knowledge/public' ? knowledge : fail(name)
    ));
    const table = load(code.table, (name) => {
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === './library-table-model') return tableModel;
      return fail(name);
    });
    const panel = load(code.panel, (name) => {
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../../modules/knowledge/public') return knowledge;
      if (name === './knowledge-related-papers') return related;
      if (name === './document-metadata-extraction') return metadataExtraction;
      return fail(name);
    });
    const selection = load(code.selection, fail);
    const batchActions = load(code.batchActions, (name) => (
      name === '../../../modules/knowledge/public' ? knowledge : fail(name)
    ));
    // 「同一篇文献吗」: pure name/page-count matching.
    const identityMatch = load(code.identityMatch, fail);
    // The real corpus adapter, with the page's localStorage as its store — this is what makes the alias rules
    // (a saved-and-reopened file finding its record) testable rather than assumed.
    const corpusAdapter = load(code.corpusAdapter, fail);
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
      metadataService,
      identityMatch,
      corpusAdapter,
      customSelect,
      selection,
      batchActions,
      tableModel,
      table,
      panel,
      viewMode,
      corpus: corpusDocuments,
      elements,
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
      title: elements.knowledgeDocTitleElement.textContent,
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
  assert.equal(rendered.first.metadataLabel, '重新提取元数据');

  assert.equal(rendered.second.title, 'Beta');
  assert.equal(rendered.second.reading, 'todo');
  assert.equal(rendered.second.issue, '文件已被移动');
  assert.equal(rendered.second.overviewLabel, '生成概览', 'no overview yet means the button offers to make one');
  assert.equal(rendered.second.authors, '—', 'not extracted yet reads as a dash, not a guess');
  assert.equal(rendered.second.doi, '—');
  assert.equal(rendered.second.metadataLabel, '提取元数据');
  assert.match(rendered.second.metadataNote, /自动读取/, 'and the note says when it normally happens');
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
  assert.deepEqual(normalized.empty, { authors: [], publishDate: '', language: '', documentUrl: '', doi: '' });
  assert.deepEqual(normalized.blanks.authors, [], 'placeholders count as empty');
  assert.equal(normalized.hasEmpty, false);
  assert.equal(normalized.hasSome, true);
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
    authors: [], publishDate: '', language: '', documentUrl: '', doi: '',
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

console.log('Knowledge library workbench tests passed.');