import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
async function read(path) { return readFile(new URL(path, root), 'utf8'); }
async function css(url) {
  const source = await readFile(url, 'utf8');
  const imports = [...source.matchAll(/@import url\(["']([^"']+)["']\);/g)];
  let output = source;
  for (const match of imports) output = output.replace(match[0], await css(new URL(match[1], url)));
  return output;
}
let browser, page;
const ids = ['ai-panel-toggle', 'knowledge-base-entry', 'vocabulary-library-entry'];
before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  const template = name => read(`src/viewer/templates/${name}.html`);
  const stage = (await template('workspace-stage')).replace('<!-- workspace-views -->',
    (await Promise.all(['reader-workspace', 'knowledge-base', 'vocabulary-library'].map(template))).join('\n'));
  const overlays = (await Promise.all(['reader-overlays', 'knowledge-base-overlays', 'vocabulary-library-overlays', 'overlays', 'onboarding-tour'].map(template))).join('\n');
  await page.setContent(`<!doctype html><div class="app-frame">${await template('toolbar')}${stage}</div>${overlays}`);
  await page.addStyleTag({ content: await read('node_modules/pdfjs-dist/web/pdf_viewer.css') });
  await page.addStyleTag({ content: await css(new URL('entrypoints/viewer/style.css', root)) });
  const sources = await Promise.all(['app/workspace-navigation.ts', 'app/application-navigation.ts'].map(async path =>
    ts.transpileModule(await read(`src/viewer/${path}`), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText));
  await page.evaluate(([workspaceCode, presentationCode]) => {
    const get = id => document.getElementById(id);
    const elements = {
      workspaceStageElement: get('workspace-stage'), readerWorkspaceElement: get('reader-workspace'),
      knowledgeBasePageElement: get('knowledge-base-page'), vocabularyLibraryPageElement: get('vocabulary-library-page'),
      aiPanelToggleButton: get('ai-panel-toggle'), knowledgeBaseEntryButton: get('knowledge-base-entry'),
      vocabularyLibraryEntryButton: get('vocabulary-library-entry'), outlineToggleButton: get('outline-toggle'),
      assistantPanelToggleButton: get('assistant-panel-toggle'),
    };
    window.workspace = {};
    new Function('require', 'exports', workspaceCode)(() => elements, workspace);
    window.presentation = {};
    new Function('require', 'exports', presentationCode)(name => name.endsWith('viewer-elements') ? elements :
      name.endsWith('workspace-navigation') ? workspace : name.endsWith('application-navigation') ? presentation : { renderKnowledgeBase() {} }, presentation);
    window.clicks = [];
    for (const [id, view] of [['ai-panel-toggle', 'viewer'], ['knowledge-base-entry', 'knowledge'], ['vocabulary-library-entry', 'vocabulary']]) {
      get(id).addEventListener('click', event => {
        clicks.push({ id, target: event.target.id });
        presentation.setCurrentApplicationView(view);
        window.transition = workspace.transitionWorkspaceView(view);
      });
    }
  }, sources);
});
after(async () => { await browser?.close(); });

for (const width of [2521, 1920, 1701, 1700, 1536, 1280, 1024, 800, 640]) {
  test(`full toolbar navigation hit areas at ${width}px with no vocabulary cards`, async () => {
    await page.setViewportSize({ width, height: 900 });
    const misses = await page.evaluate(ids => ids.flatMap(id => {
      const button = document.getElementById(id);
      const r = button.getBoundingClientRect();
      return [0.12, 0.5, 0.88].flatMap(fx => [0.12, 0.5, 0.88].flatMap(fy => {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        return hit && button.contains(hit) ? [] : [{ id, x, y, hit: hit?.outerHTML.slice(0, 150) ?? null }];
      }));
    }), ids);
    assert.deepEqual(misses, []);
    // Native pointer input, including padding, without force-click or DOM click().
    for (const id of ids) {
      const rect = await page.locator(`#${id}`).boundingBox();
      for (const [fx, fy] of [[0.12, 0.5], [0.5, 0.12], [0.5, 0.5], [0.5, 0.88], [0.88, 0.5]]) {
        const before = await page.evaluate(() => clicks.length);
        await page.mouse.click(rect.x + rect.width * fx, rect.y + rect.height * fy);
        const last = await page.evaluate(() => ({ count: clicks.length, last: clicks.at(-1) }));
        assert.equal(last.count, before + 1);
        assert.deepEqual(last.last, { id, target: id });
      }
    }
    await page.evaluate(() => window.transition);
    assert.equal(await page.evaluate(() => workspace.getActiveWorkspaceView()), 'vocabulary');
    assert.equal(await page.locator('[aria-current="page"]').getAttribute('id'), 'vocabulary-library-entry');
    if (process.env.PDFPAL_TOOLBAR_SCREENSHOTS) {
      await page.locator('.toolbar').screenshot({ path: `.output/toolbar-preview-${width}.png` });
    }
  });
}

test('icon clicks, keyboard navigation and mode refresh keep stable button geometry', async () => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const button = page.locator('#knowledge-base-entry');
  const before = await button.boundingBox();
  await page.evaluate(() => presentation.updateModeNavigation());
  assert.deepEqual(await button.boundingBox(), before);
  const icon = await button.locator('svg').boundingBox();
  await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  assert.equal(await page.evaluate(() => clicks.at(-1).target), 'knowledge-base-entry');
  await page.locator('#ai-panel-toggle').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => workspace.getActiveWorkspaceView()), 'viewer');
  await page.locator('#vocabulary-library-entry').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => workspace.getActiveWorkspaceView()), 'vocabulary');
});

test('focus mode still collapses the complete toolbar', async () => {
  await page.evaluate(() => document.querySelector('.app-frame').classList.add('focus-mode'));
  assert.equal(await page.locator('.toolbar').evaluate(element => element.getBoundingClientRect().height), 0);
});
