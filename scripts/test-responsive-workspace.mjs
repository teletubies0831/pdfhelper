import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
async function css(url) {
  let source = await readFile(url, 'utf8');
  for (const match of [...source.matchAll(/@import url\(["']([^"']+)["']\);/g)]) {
    source = source.replace(match[0], await css(new URL(match[1], url)));
  }
  return source;
}
let browser, page;
before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage({ reducedMotion: 'reduce' });
  const template = name => read(`src/viewer/templates/${name}.html`);
  const stage = (await template('workspace-stage')).replace('<!-- workspace-views -->',
    (await Promise.all(['reader-workspace', 'knowledge-base', 'knowledge-graph', 'vocabulary-library'].map(template))).join('\n'));
  const overlays = (await Promise.all(['reader-overlays', 'knowledge-base-overlays', 'vocabulary-library-overlays', 'overlays'].map(template))).join('\n');
  await page.setContent(`<!doctype html><div class="app-frame">${await template('toolbar')}${stage}</div>${overlays}`);
  await page.addStyleTag({ content: await read('node_modules/pdfjs-dist/web/pdf_viewer.css') });
  await page.addStyleTag({ content: await css(new URL('entrypoints/viewer/style.css', root)) });
  await page.evaluate(() => {
    document.body.append(document.getElementById('assistant-settings-panel'));
    for (const [id, side] of [['outline-toggle', 'left'], ['assistant-panel-toggle', 'right']]) {
      document.getElementById(id).addEventListener('click', () => document.querySelector('.app-frame').classList.toggle(`${side}-panel-collapsed`));
    }
    document.getElementById('knowledge-overview-document-name').textContent = 'A very long PDF filename '.repeat(15) + '.pdf';
    document.getElementById('knowledge-overview-content').innerHTML = '<h1>PDF 概览</h1>' + '<p>Long content / 很长的概览正文。</p>'.repeat(80);
    document.getElementById('vocabulary-editor-preview').innerHTML = '<h2>单词释义</h2>' + '<p>Word definition.</p>'.repeat(80);
    document.getElementById('vocabulary-editor-markdown').value = '# 单词\n\n' + 'Definitions\n'.repeat(60);
    document.getElementById('vocabulary-card-grid').innerHTML = Array.from({ length: 16 }, (_, i) => `<button class="vocabulary-card" type="button">单词 ${i + 1}</button>`).join('');
    document.querySelector('.knowledge-card-grid').innerHTML = '<article class="knowledge-pdf-card"><div>PDF</div><div class="knowledge-pdf-body"><button class="knowledge-pdf-title-button">' + 'A long document filename '.repeat(10) + '</button><p>225 页 · 已索引</p></div><div class="knowledge-pdf-actions"><button>生成概览</button><button>移出知识库</button></div></article>';
  });
  const compiled = ts.transpileModule(await read('src/viewer/app/responsive-workspace.ts'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  await page.evaluate(code => { const exports = {}; new Function('exports', code)(exports); exports.initializeResponsiveWorkspace(); }, compiled);
});
after(async () => { await browser?.close(); });

async function reachable(selector) {
  const failures = await page.locator(selector).evaluateAll(elements => elements.flatMap(element => {
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) return [{ element: element.id || element.className, reason: 'empty' }];
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && hit && element.contains(hit)
      ? [] : [{ element: element.id || element.className, rect: r.toJSON(), hit: hit?.className }];
  }));
  assert.deepEqual(failures, [], selector);
}

for (const [width, height] of [[1920,1080],[1366,768],[1280,720],[1093,614],[1024,600],[960,540],[800,600],[640,400],[390,700],[800,400]]) {
  test(`workspace, dialogs and save actions fit ${width}×${height}`, async () => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      document.getElementById('assistant-settings-panel').hidden = true;
      document.getElementById('reader-workspace').hidden = false;
      document.getElementById('knowledge-base-page').hidden = true;
      document.getElementById('vocabulary-library-page').hidden = true;
    });
    await reachable('#ai-panel-toggle, #knowledge-base-entry, #vocabulary-library-entry, #outline-toggle, #assistant-panel-toggle');
    const reader = await page.locator('.reading-panel').boundingBox();
    assert.ok(reader.width >= Math.min(300, width - 30), `reader width ${reader.width}`);
    await reachable('#zoom-in, #zoom-out, #focus-mode-toggle');
    const viewer = await page.locator('#viewer-container').evaluate(e => ({ position: getComputedStyle(e).position, rect: e.getBoundingClientRect().toJSON(), headerBottom: document.querySelector('.reader-header').getBoundingClientRect().bottom, footerTop: document.querySelector('.reader-footer').getBoundingClientRect().top }));
    assert.equal(viewer.position, 'absolute', 'PDF.js requires an absolutely positioned scroll container');
    assert.ok(viewer.rect.top >= viewer.headerBottom - 1 && viewer.rect.bottom <= viewer.footerTop + 1, `PDF pages must not overlap navigation controls: ${JSON.stringify(viewer)}`);
    await page.evaluate(() => {
      document.getElementById('reader-workspace').hidden = true;
      document.getElementById('knowledge-base-page').hidden = false;
    });
    const overflow = await page.locator('.knowledge-main').evaluate(e => e.scrollWidth <= e.clientWidth + 1 ? [] : [...e.querySelectorAll('*')].filter(c => c.getBoundingClientRect().right > e.getBoundingClientRect().right).map(c => ({ class: c.className, id: c.id, width: c.getBoundingClientRect().width })).slice(0, 12));
    assert.deepEqual(overflow, [], 'knowledge must not overflow horizontally');
    assert.ok(await page.locator('.knowledge-sidebar').isVisible(), 'folders remain accessible on small screens');
    await page.locator('#knowledge-create-folder').scrollIntoViewIfNeeded();
    await reachable('#knowledge-create-folder');
    await page.evaluate(() => {
      document.getElementById('knowledge-base-page').hidden = true;
      document.getElementById('vocabulary-library-page').hidden = false;
      document.querySelector('.vocabulary-library-shell').scrollTop = 0;
      document.querySelector('.vocabulary-library-main').scrollTop = 0;
    });
    await reachable('#vocabulary-new-card');
    await page.locator('.vocabulary-card:last-child').evaluate(e => e.scrollIntoView({ block: 'end' }));
    assert.ok(await page.locator('.vocabulary-card:last-child').evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.bottom - 8));
    }), 'the bottom of the last card must be reachable by scrolling');
    assert.ok(await page.locator('.vocabulary-library-shell').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'vocabulary must fit the viewport width');

    await page.evaluate(() => {
      const d = document.getElementById('knowledge-overview-dialog'); d.classList.add('is-open'); d.showModal();
      document.getElementById('knowledge-overview-editor').hidden = false;
      document.getElementById('knowledge-overview-content').hidden = true;
      document.getElementById('knowledge-overview-save').hidden = false;
      document.getElementById('knowledge-overview-status').hidden = false;
      document.getElementById('knowledge-overview-status').textContent = '修改尚未保存。';
    });
    await reachable('#knowledge-overview-open-source, #knowledge-overview-close, #knowledge-overview-save');
    assert.ok(await page.locator('#knowledge-overview-markdown').evaluate(e => e.getBoundingClientRect().height >= 90));
    assert.ok(await page.locator('#knowledge-overview-dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    if (width === 640) await page.screenshot({ path: '.output/responsive-overview-640.png' });
    await page.evaluate(() => {
      document.getElementById('knowledge-overview-dialog').close();
      const d = document.getElementById('vocabulary-editor-dialog'); d.className = 'vocabulary-editor-dialog app-motion-dialog is-open is-editing'; d.showModal();
      document.getElementById('vocabulary-editor-meta-grid').hidden = false;
      document.getElementById('vocabulary-markdown-editor').hidden = false;
      document.getElementById('vocabulary-markdown-preview-pane').hidden = true;
      document.getElementById('vocabulary-markdown-workspace').className = 'vocabulary-markdown-workspace is-editing';
    });
    await reachable('#vocabulary-editor-close, #vocabulary-editor-cancel, #vocabulary-editor-form button[type="submit"]');
    await page.locator('#vocabulary-editor-markdown').scrollIntoViewIfNeeded();
    await reachable('#vocabulary-editor-markdown');
    if (width === 640) await page.screenshot({ path: '.output/responsive-vocabulary-640.png' });
    await page.evaluate(() => {
      document.getElementById('vocabulary-editor-dialog').close();
      const d = document.getElementById('assistant-settings-panel'); d.hidden = false; d.classList.add('is-open');
    });
    await reachable('#close-deepseek-settings, .settings-footer-actions button:visible');
  });
}

test('narrow sidebars open through their original buttons and restore desktop layout', async () => {
  await page.evaluate(() => {
    document.getElementById('assistant-settings-panel').hidden = true;
    document.getElementById('knowledge-base-page').hidden = true;
    document.getElementById('vocabulary-library-page').hidden = true;
    document.getElementById('reader-workspace').hidden = false;
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const before = await page.locator('.app-frame').getAttribute('class');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.locator('#outline-toggle').click();
  await page.locator('.left-panel').evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
  await reachable('#outline-search-button');
  await page.locator('#assistant-panel-toggle').click();
  assert.equal(await page.locator('.left-panel').isVisible(), false);
  assert.equal(await page.locator('.right-panel').isVisible(), true, await page.locator('.right-panel').evaluate(e => JSON.stringify({ hidden: e.hidden, style: e.getAttribute('style'), display: getComputedStyle(e).display, visibility: getComputedStyle(e).visibility, frame: document.querySelector('.app-frame').className })));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.app-frame').getAttribute('class'), before);
});

test('settings has a 备份与恢复 tab whose actions are reachable', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const result = await page.evaluate(() => {
    // Open the settings panel the way the app does (it becomes a body-level popover), otherwise its page has no size.
    const settings = document.getElementById('assistant-settings-panel');
    document.body.append(settings);
    settings.hidden = false;
    settings.classList.add('is-open');
    const tabs = [...document.querySelectorAll('[data-settings-tab]')].map((button) => button.textContent.trim());
    const backupPanel = document.querySelector('[data-settings-panel="backup"]');
    for (const panel of document.querySelectorAll('[data-settings-panel]')) {
      panel.hidden = panel !== backupPanel;
    }
    const box = (id) => {
      const element = document.getElementById(id);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), display: getComputedStyle(element).display };
    };
    // The two cards must not touch: they stack with the same 14px gap the 常规 page uses.
    const cards = [...backupPanel.querySelectorAll('.settings-general-card')].map((card) => {
      const rect = card.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
    });
    return {
      tabs,
      hasPanel: Boolean(backupPanel),
      cards,
      exportButton: box('settings-backup-export'),
      importButton: box('settings-backup-import'),
      fileInput: box('settings-backup-file'),
      summary: Boolean(document.getElementById('settings-backup-summary')),
      status: Boolean(document.getElementById('settings-backup-status')),
    };
  });
  assert.equal(result.tabs.at(-1), '备份与恢复', 'the tab sits at the end of the row, after 记忆');
  assert.equal(result.hasPanel, true);
  assert.equal(result.cards.length, 2);
  assert.ok(
    result.cards[1].top - result.cards[0].bottom >= 8,
    `the two cards need breathing room, got ${JSON.stringify(result.cards)}`,
  );
  for (const button of [result.exportButton, result.importButton]) {
    assert.ok(button && button.width > 40 && button.height > 20, JSON.stringify(button));
  }
  assert.equal(result.fileInput?.display, 'none', 'the file input stays hidden behind the button');
  assert.ok(result.summary && result.status);
});
