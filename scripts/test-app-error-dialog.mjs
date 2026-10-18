import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * The readable error dialog.
 *
 * The reason it exists: failures used to appear only in the status bar or in a 260px
 * progress slot with `text-overflow: ellipsis`, so a message like "1 次抽取失败且已重试 3
 * 次：…" was cut off before the part that says what to do. These tests pin the two
 * properties that make it useful — the **whole** message is shown, and every error
 * funnel reaches it — plus the rules that keep it from becoming noise.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage();

  // The real dialog markup and the real stylesheet, plus the status-bar slot the
  // funnel writes to. Loading the stylesheet is what makes the "not truncated"
  // assertions meaningful: they would otherwise measure a page with no CSS at all.
  const [overlays, errorDialogCss] = await Promise.all([
    readFile(new URL('../src/viewer/templates/overlays.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/viewer/styles/error-dialog.css', import.meta.url), 'utf8'),
  ]);
  await page.setContent(
    `<!doctype html><html><head><style>${errorDialogCss}</style></head>`
    + `<body>${overlays}<div id="status-text"></div></body></html>`,
  );

  const errorDialogCode = await loadModule('src/viewer/app/error-dialog.ts');
  const statusBarCode = await loadModule('src/viewer/app/status-bar.ts');

  await page.evaluate(([errorSource, statusSource]) => {
    window.copied = [];

    const get = (id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing required element: #${id}`);
      return element;
    };

    // Element handles, spelled out the way the barrel does it, so a template/handle
    // mismatch fails here rather than at runtime.
    const elements = {
      appErrorDialog: get('app-error-dialog'),
      appErrorDialogSummaryElement: get('app-error-dialog-summary'),
      appErrorDialogMessageElement: get('app-error-dialog-message'),
      appErrorDialogCloseButton: get('app-error-dialog-close'),
      appErrorDialogCopyButton: get('app-error-dialog-copy'),
      appErrorDialogDismissButton: get('app-error-dialog-dismiss'),
    };
    const statusElements = { statusText: get('status-text') };

    const dialogMotion = {
      showAnimatedDialog(dialog) {
        if (!dialog.open) dialog.showModal();
      },
    };

    const build = (code, target, requireFn) => {
      new Function('require', 'exports', code)(requireFn, target);
    };

    window.errorDialog = {};
    build(errorSource, window.errorDialog, (name) => {
      if (name.includes('dialog-motion')) return dialogMotion;
      if (name.includes('viewer-elements')) return elements;
      throw new Error(`Unmocked dependency: ${name}`);
    });
    window.errorDialog.registerAppErrorDialogEvents();

    // The status bar is a separate module with its own (small) element dependency;
    // loading it for real is what proves the funnel, not just the dialog.
    window.statusBar = {};
    build(statusSource, window.statusBar, (name) => {
      if (name.includes('viewer-elements')) return statusElements;
      if (name.includes('error-dialog')) return window.errorDialog;
      throw new Error(`Unmocked dependency: ${name}`);
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(text) { window.copied.push(text); } },
    });
  }, [errorDialogCode, statusBarCode]);
});

after(async () => { await browser?.close(); });

const LONG_MESSAGE =
  '1 次抽取失败且已重试 3 次：请先在 PDFPal 的知识库中为这篇文献建立全文索引，'
  + '抽取需要正文内容；如果索引已经存在，请确认正文没有被加密或使用了图片型扫描页。\n'
  + '失败批次：第 1 批（chunk 1-3）。';

test('a long error message is shown in full, wrapping instead of being cut off', async () => {
  await page.evaluate((message) => {
    window.statusBar.setStatus(message, true);
  }, LONG_MESSAGE);

  assert.equal(
    await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open),
    true,
    'an error opens the dialog',
  );

  const rendered = await page.evaluate(() => {
    const element = document.getElementById('app-error-dialog-message');
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      whiteSpace: style.whiteSpace,
      // Nothing may clip the message: the container may scroll, not truncate.
      textOverflow: style.textOverflow,
      overflowY: style.overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });

  assert.equal(rendered.text, LONG_MESSAGE, 'the whole message is present, not a prefix');
  assert.equal(rendered.whiteSpace, 'pre-wrap', 'line breaks in the message survive');
  assert.notEqual(rendered.textOverflow, 'ellipsis', 'the message must not be ellipsised');
  assert.equal(rendered.overflowY, 'auto', 'long messages scroll rather than clip');
  assert.ok(rendered.scrollHeight > 0 && rendered.clientHeight > 0);

  // The status bar keeps the message too, so dismissing the dialog loses nothing.
  assert.equal(
    await page.locator('#status-text').textContent(),
    LONG_MESSAGE,
  );
  assert.equal(
    await page.locator('#status-text').evaluate((element) => element.classList.contains('error')),
    true,
  );

  await page.locator('#app-error-dialog-dismiss').click();
  assert.equal(
    await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open),
    false,
  );
});

test('a repeated error does not stack a second dialog', async () => {
  await page.evaluate(() => window.statusBar.setStatus('同一个错误', true));
  assert.equal(await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open), true);

  // The same message arriving again (a retry loop reports it once per attempt) must
  // not re-modal anything: the dialog would otherwise block the reader repeatedly.
  await page.evaluate(() => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      window.statusBar.setStatus('同一个错误', true);
    }
  });
  assert.equal(
    await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open),
    true,
    'still exactly one dialog',
  );
  assert.equal(await page.locator('dialog[open]').count(), 1, 'no dialog was stacked');

  // A different message replaces the content of the open dialog.
  await page.evaluate(() => window.statusBar.setStatus('另一个错误', true));
  assert.equal(await page.locator('#app-error-dialog-message').textContent(), '另一个错误');
  assert.equal(await page.locator('dialog[open]').count(), 1);

  await page.locator('#app-error-dialog-dismiss').click();
});

test('a dismissed error can be raised again later', async () => {
  // Deduplication is about not stacking while open, not about suppressing a new
  // occurrence: after dismissing, the same failure happening again is new information.
  await page.evaluate(() => window.statusBar.setStatus('抽取失败', true));
  await page.locator('#app-error-dialog-dismiss').click();
  await page.evaluate(() => window.statusBar.setStatus('抽取失败', true));
  assert.equal(await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open), true);
  await page.locator('#app-error-dialog-close').click();
});

test('non-error status messages do not open the dialog', async () => {
  await page.evaluate(() => window.statusBar.setStatus('已打开 3 篇文献。'));
  assert.equal(
    await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open),
    false,
    'ordinary status updates stay in the status bar',
  );
  assert.equal(await page.locator('#status-text').textContent(), '已打开 3 篇文献。');
});

test('the message can be copied, and Escape dismisses without losing it', async () => {
  await page.evaluate(() => {
    window.errorDialog.showAppError('可复制的错误信息', { title: '抽取失败', summary: '这次抽取没有完成。' });
  });
  assert.equal(await page.locator('#app-error-dialog-summary').textContent(), '这次抽取没有完成。');

  await page.locator('#app-error-dialog-copy').click();
  await page.waitForFunction(() => window.copied.length > 0);
  assert.deepEqual(await page.evaluate(() => window.copied), ['可复制的错误信息']);
  assert.equal(await page.locator('#app-error-dialog-copy').textContent(), '已复制');

  await page.evaluate(() => {
    document.getElementById('app-error-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  assert.equal(await page.locator('#app-error-dialog').evaluate((dialog) => dialog.open), false);
  assert.equal(
    await page.locator('#app-error-dialog-message').textContent(),
    '可复制的错误信息',
    'dismissing keeps the text available',
  );
});

console.log('App error dialog tests passed.');
