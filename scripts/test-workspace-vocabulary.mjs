import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

let browser, page;
before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  await page.setContent(`<!doctype html><div class="app-frame">
    <header class="toolbar"><button id="viewer">PDF 阅读</button><button id="knowledge">知识库</button><button id="vocabulary">单词库</button></header>
    <div class="workspace-stage" id="stage"><div id="reader" class="workspace">PDF</div><section id="kb" class="knowledge-base-page" hidden>知识库</section>
      <section id="vocab" class="vocabulary-library-page" hidden><div class="vocabulary-library-shell">
        <input id="search"><select id="sort"><option value="newest">newest</option></select><select id="time"><option value="all">all</option></select>
        <span id="status"></span><span id="count"></span><main id="main" class="vocabulary-library-main"><div id="grid" class="vocabulary-card-grid"></div></main>
      </div></section></div></div>`);
  for (const path of ['styles/toolbar-shell.css', 'styles/workspace-navigation.css', 'features/vocabulary-library/styles.css']) {
    await page.addStyleTag({ content: await readFile(new URL(`../src/viewer/${path}`, import.meta.url), 'utf8') });
  }
  const sources = await Promise.all(['app/workspace-navigation.ts', 'features/vocabulary-library/vocabulary-library-controller.ts'].map(async path => {
    const source = await readFile(new URL(`../src/viewer/${path}`, import.meta.url), 'utf8');
    return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  }));
  await page.evaluate(([navigationCode, controllerCode]) => {
    const get = id => document.getElementById(id);
    const elements = {
      workspaceStageElement: get('stage'), readerWorkspaceElement: get('reader'), knowledgeBasePageElement: get('kb'), vocabularyLibraryPageElement: get('vocab'),
      vocabularyCardGridElement: get('grid'), vocabularyLibraryMainElement: get('main'), vocabularyLibraryStatusElement: get('status'), vocabularyTotalCountElement: get('count'),
      vocabularySearchInput: get('search'), vocabularySortSelect: get('sort'), vocabularyTimeFilterSelect: get('time'), vocabularyLibraryEntryButton: get('vocabulary'),
    };
    window.cards = Array.from({ length: 5000 }, (_, i) => ({
      id: String(i), term: `word-${String(i).padStart(5, '0')}`, pronunciation: '', partOfSpeech: 'noun',
      markdown: '## Definition\nAn example definition.\n## Example\nExample sentence.', tags: ['test'],
      sourceText: '', documentName: 'Fixture.pdf', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z',
    }));
    window.navigation = {};
    new Function('require', 'exports', navigationCode)(() => elements, navigation);
    window.pendingReads = [];
    window.holdReads = false;
    const dependencies = {
      '../../app/viewer-elements': elements, '../../app/viewer-state': {}, '../../app/workspace-navigation': navigation,
      '../../core/pdf-reader/public': { persistCurrentAppViewState() {} },
      '../assistant/public': { setCurrentApplicationView() {} }, '../recent-files/public': { setStatus() {} },
      '../../shared-ui/markdown/markdown-renderer': {}, '../../shared-ui/dialog/dialog-motion': {},
      './learning-card-markdown': {}, './vocabulary-preference': { isVocabularyLibraryEnabled: () => true },
      './vocabulary-repository': { readVocabularyCards: () => holdReads ? new Promise(resolve => pendingReads.push(resolve)) : Promise.resolve(cards) },
    };
    window.controller = {};
    new Function('require', 'exports', controllerCode)(name => {
      if (!(name in dependencies)) throw Error(`Missing dependency: ${name}`);
      return dependencies[name];
    }, controller);
    get('vocabulary').onclick = controller.openVocabularyLibraryPage;
    get('knowledge').onclick = () => navigation.transitionWorkspaceView('knowledge');
    get('viewer').onclick = () => navigation.transitionWorkspaceView('viewer');
    get('search').oninput = () => controller.renderVocabularyLibrary();
    window.transitions = [];
  }, sources);
});
after(async () => { await browser?.close(); });

test('5000 cards have bounded DOM, working pagination and full-library search', async () => {
  await page.locator('#vocabulary').click();
  await page.waitForFunction(() => document.querySelectorAll('.vocabulary-card').length === 60);
  assert.equal(await page.locator('#count').textContent(), '5000 张卡片');
  assert.equal(await page.locator('.vocabulary-card').first().getAttribute('data-open-vocabulary-card'), '0');
  await page.getByRole('button', { name: '下一页' }).click();
  assert.equal(await page.locator('.vocabulary-card').count(), 60);
  assert.equal(await page.locator('.vocabulary-card').first().getAttribute('data-open-vocabulary-card'), '60');
  await page.locator('#search').fill('word-04999');
  await page.waitForFunction(() => document.querySelectorAll('.vocabulary-card').length === 1);
  assert.equal(await page.locator('.vocabulary-card').getAttribute('data-open-vocabulary-card'), '4999');
  await page.locator('#search').fill('');
  await page.waitForFunction(() => document.querySelectorAll('.vocabulary-card').length === 60);
});

test('real toolbar pointer clicks during interrupted transitions settle on the last destination', async () => {
  for (const name of ['knowledge', 'viewer', 'vocabulary', 'viewer', 'knowledge', 'vocabulary', 'viewer']) {
    const box = await page.locator(`#${name}`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForFunction(() => !document.getElementById('stage').classList.contains('is-transitioning'));
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('stage').children].map(e => [e.id, e.hidden, e.inert])), [
    ['reader', false, false], ['kb', true, true], ['vocab', true, true],
  ]);
});

test('an older storage read cannot overwrite the latest refresh', async () => {
  await page.evaluate(async () => {
    holdReads = true;
    const first = controller.renderVocabularyLibrary(true);
    const second = controller.renderVocabularyLibrary(true);
    pendingReads[1]([{ ...cards[0], id: 'new', term: 'latest' }]);
    await second;
    pendingReads[0]([{ ...cards[0], id: 'old', term: 'outdated' }]);
    await first;
    holdReads = false;
  });
  assert.equal(await page.locator('.vocabulary-card').count(), 1);
  assert.equal(await page.locator('.vocabulary-card').getAttribute('data-open-vocabulary-card'), 'new');
});
