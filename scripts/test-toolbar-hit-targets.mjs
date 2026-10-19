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
const ids = ['ai-panel-toggle', 'knowledge-base-entry', 'knowledge-graph-entry', 'vocabulary-library-entry'];
before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  const template = name => read(`src/viewer/templates/${name}.html`);
  const stage = (await template('workspace-stage')).replace('<!-- workspace-views -->',
    (await Promise.all(['reader-workspace', 'knowledge-base', 'knowledge-graph', 'vocabulary-library'].map(template))).join('\n'));
  const overlays = (await Promise.all(['reader-overlays', 'knowledge-base-overlays', 'vocabulary-library-overlays', 'overlays', 'onboarding-tour'].map(template))).join('\n');
  await page.setContent(`<!doctype html><div class="app-frame">${await template('toolbar')}${stage}</div>${overlays}`);
  await page.addStyleTag({ content: await read('node_modules/pdfjs-dist/web/pdf_viewer.css') });
  await page.addStyleTag({ content: await css(new URL('entrypoints/viewer/style.css', root)) });
  const sources = await Promise.all([
    'app/workspace-navigation.ts',
    'app/application-navigation.ts',
    'app/focus-release.ts',
  ].map(async path =>
    ts.transpileModule(await read(`src/viewer/${path}`), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText));
  await page.evaluate(([workspaceCode, presentationCode, focusReleaseCode]) => {
    const get = id => document.getElementById(id);
    const elements = {
      workspaceStageElement: get('workspace-stage'), readerWorkspaceElement: get('reader-workspace'),
      knowledgeBasePageElement: get('knowledge-base-page'), knowledgeGraphPageElement: get('knowledge-graph-page'),
      vocabularyLibraryPageElement: get('vocabulary-library-page'),
      aiPanelToggleButton: get('ai-panel-toggle'), knowledgeBaseEntryButton: get('knowledge-base-entry'),
      knowledgeGraphEntryButton: get('knowledge-graph-entry'),
      vocabularyLibraryEntryButton: get('vocabulary-library-entry'), outlineToggleButton: get('outline-toggle'),
      assistantPanelToggleButton: get('assistant-panel-toggle'),
      // The view switch also hides the annotation row outside the reader; this stub
      // mirrors the module's element dependencies and must gain one whenever it does.
      annotationToolsBar: get('annotation-tools-bar'),
    };
    window.workspace = {};
    // Everything resolves to the element map except the focus helper, which view switching really calls before
    // hiding a workspace.
    const focusRelease = {};
    new Function('require', 'exports', focusReleaseCode)(() => ({}), focusRelease);
    new Function('require', 'exports', workspaceCode)(
      name => (name === './focus-release' ? focusRelease : elements),
      workspace,
    );
    window.presentation = {};
    new Function('require', 'exports', presentationCode)(name => name.endsWith('viewer-elements') ? elements :
      name.endsWith('workspace-navigation') ? workspace : name.endsWith('application-navigation') ? presentation : { renderKnowledgeBase() {} }, presentation);
    window.clicks = [];
    for (const [id, view] of [['ai-panel-toggle', 'viewer'], ['knowledge-base-entry', 'knowledge'], ['knowledge-graph-entry', 'graph'], ['vocabulary-library-entry', 'vocabulary']]) {
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
      for (const [fx, fy] of [[0.12, 0.5], [0.5, 0.12], [0.5, 0.5], [0.5, 0.88], [0.88, 0.5]]) {
        // The box is re-measured for every click: switching views changes the toolbar
        // height (the annotation row only exists in the reader), so a single
        // measurement would send later clicks to where the button used to be and fail
        // as a miss rather than as the geometry problem it is meant to catch.
        const rect = await page.locator(`#${id}`).boundingBox();
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

test('the pen offers a colour choice, not just a thickness', async () => {
  // Reported from real use: 高亮 has a colour picker and three recent colours, but 画笔 only had a
  // thickness slider and drew in PDF.js's default black. The pen's popover now carries black, red, blue,
  // green, orange and purple plus a native picker for anything else, so it has to be *reachable*: real
  // swatches, large enough to hit, all inside the popover and not clipped by it.
  await page.setViewportSize({ width: 1280, height: 900 });
  // The earlier tests leave the app on the vocabulary view, where the annotation row is hidden — a hidden
  // row has no layout box, so every swatch would measure 0×0. Put the reader back first.
  await page.evaluate(() => {
    presentation.setCurrentApplicationView('viewer');
    document.getElementById('annotation-tools-bar').hidden = false;
  });
  const report = await page.evaluate(() => {
    const control = document.getElementById('ink-thickness-control');
    const picker = document.getElementById('ink-color');
    control.hidden = false;
    const swatches = [...control.querySelectorAll('[data-ink-color-index]')];
    const boxes = swatches.map((button) => button.getBoundingClientRect());
    const controlBox = control.getBoundingClientRect();
    return {
      label: control.getAttribute('aria-label'),
      swatches: swatches.map((button) => ({
        color: (button.dataset.inkColor ?? '').toLowerCase(),
        name: button.getAttribute('aria-label') ?? '',
        width: Math.round(button.getBoundingClientRect().width),
        height: Math.round(button.getBoundingClientRect().height),
        // Every swatch must be painted in the colour it stands for.
        paint: getComputedStyle(button).backgroundColor,
        inPopover:
          button.getBoundingClientRect().left >= controlBox.left - 1 &&
          button.getBoundingClientRect().right <= controlBox.right + 1,
      })),
      controlWidth: Math.round(controlBox.width),
      controlHeight: Math.round(controlBox.height),
      // A popover that overflows its own box would clip the last colour or the picker.
      overflow: Math.round(control.scrollWidth - control.clientWidth),
      picker: picker
        ? {
          type: picker.type,
          width: Math.round(picker.getBoundingClientRect().width),
          insideCustomChip: Boolean(picker.closest('.annotation-ink-color-custom')),
        }
        : null,
      height: Math.round(control.getBoundingClientRect().height),
    };
  });

  assert.match(report.label ?? '', /画笔/, 'the popover is announced as the pen’s own settings');
  assert.ok(
    report.swatches.length >= 6,
    `expected a palette, got ${report.swatches.length} swatches; ${JSON.stringify(report)}`,
  );
  assert.equal(
    new Set(report.swatches.map((swatch) => swatch.color)).size,
    report.swatches.length,
    `every swatch is a different colour: ${report.swatches.map((swatch) => swatch.color).join(', ')}`,
  );
  for (const swatch of report.swatches) {
    assert.match(swatch.color, /^#[0-9a-f]{6}$/, `"${swatch.color}" is not a usable colour`);
    assert.ok(swatch.name.length > 0, `the ${swatch.color} swatch needs a spoken name`);
    assert.ok(
      swatch.width >= 16 && swatch.height >= 16,
      `the ${swatch.color} swatch is too small to hit (${swatch.width}×${swatch.height}); ${JSON.stringify(report)}`,
    );
    assert.ok(swatch.inPopover, `the ${swatch.color} swatch is outside the popover`);
    assert.ok(
      swatch.paint !== 'rgba(0, 0, 0, 0)',
      `the ${swatch.color} swatch is not painted, so it cannot show its colour`,
    );
  }
  assert.deepEqual(
    report.picker,
    { type: 'color', width: report.picker.width, insideCustomChip: true },
    'a native picker covers the "anything else" case',
  );
  assert.ok(report.picker.width >= 16, 'the custom picker is clickable too');
  assert.equal(report.overflow, 0, `the popover must not clip its own contents (${report.overflow}px)`);
  assert.ok(
    report.controlHeight < 120,
    `the popover must stay a compact two-row plate; it is ${report.controlHeight}px tall`,
  );
});

test('focus mode still collapses the complete toolbar', async () => {
  await page.evaluate(() => document.querySelector('.app-frame').classList.add('focus-mode'));
  assert.equal(await page.locator('.toolbar').evaluate(element => element.getBoundingClientRect().height), 0);
});
