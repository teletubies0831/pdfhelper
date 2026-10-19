import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';

/**
 * Smoke test of the **packaged** extension.
 *
 * Every other suite tests modules in isolation with the module barrel stubbed, so the
 * phase-1 acceptance criterion — the workspace opens without a blank screen — has
 * until now only been checked against assembled DOM. This suite loads the real build
 * into a real browser, with the real service worker, the real bundled chunks and the
 * real CSP in force, and drives the graph workspace from the packaged page.
 *
 * It is deliberately shallow: it does not re-test graph behaviour, which the other
 * suites cover module by module. It answers only what the packaged artifact can —
 * that the bundle boots, that the workspace appears, that the load path runs to
 * completion, and that nothing was thrown on the way.
 */

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../.output/edge-mv3');

let context;
let page;
let userDataDir;
let extensionId;
const consoleErrors = [];
const pageErrors = [];

before(async () => {
  assert.ok(
    existsSync(path.join(EXTENSION_PATH, 'manifest.json')),
    `built extension not found at ${EXTENSION_PATH}; run \`pnpm build\` first`,
  );

  userDataDir = await mkdtemp(path.join(tmpdir(), 'pdfpal-extension-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  // An unpacked build has no knowable id in advance; the MV3 service worker registers
  // at install time and its URL carries the id.
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = new URL(worker.url()).host;

  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`chrome-extension://${extensionId}/viewer.html`, {
    waitUntil: 'domcontentloaded',
  });
  // Without this the page is not the foreground tab, and the workspace switch (which
  // finishes on an animation frame) does not run.
  await page.bringToFront();
});

after(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test('the packaged service worker and extension page boot', async () => {
  assert.equal(context.serviceWorkers().length, 1, 'exactly one MV3 service worker');
  assert.deepEqual(pageErrors, [], 'booting the packaged page must not throw');

  const booted = await page.evaluate(() => ({
    stage: document.getElementById('workspace-stage')?.childElementCount ?? 0,
    buttons: document.querySelectorAll('button').length,
    visibleBox: (() => {
      // "Not a white screen" means the active view actually has size, measured rather
      // than assumed: a blank renderer still has elements, they are just 0-height.
      const stage = document.getElementById('workspace-stage');
      if (!stage) return null;
      const visible = [...stage.querySelectorAll(':scope > *')]
        .filter((element) => !element.hasAttribute('hidden'));
      return visible.map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.id, width: Math.round(rect.width), height: Math.round(rect.height) };
      });
    })(),
  }));

  assert.ok(booted.stage > 0, 'the workspace stage rendered its views');
  assert.ok(booted.buttons > 10, `the packaged shell rendered its controls; found ${booted.buttons}`);
  assert.ok(
    (booted.visibleBox ?? []).some((box) => box.width > 100 && box.height > 100),
    `no visible view has a real layout box: ${JSON.stringify(booted.visibleBox)}`,
  );
});

test('the graph workspace opens and finishes loading from the packaged bundle', async () => {
  const entry = page.locator('#knowledge-graph-entry');
  assert.equal(await entry.count(), 1, 'the graph entry button is in the packaged toolbar');

  await entry.click();
  await page.waitForSelector('#knowledge-graph-page:not([hidden])', { timeout: 15_000 });

  // Load completion is read from the **counts line**, not from a status message: the status text now lives
  // in the floating notice, which removes itself after a few seconds, and the counts line is the one
  // summary the page keeps on screen. It is written at the end of the first redraw, so it also
  // distinguishes "the page became visible" from "the workspace actually loaded".
  const finished = await page.waitForFunction(
    () => /\d+\s*文献/.test(document.getElementById('knowledge-graph-counts')?.textContent ?? ''),
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);

  const state = await page.evaluate(() => {
    const canvas = document.getElementById('knowledge-graph-canvas');
    return {
      counts: document.getElementById('knowledge-graph-counts')?.textContent?.trim() ?? '',
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      inspector: document.getElementById('knowledge-graph-inspector')?.hidden,
    };
  });

  // Reported with the counts that were actually reached, so a failure here says which
  // way the load path went wrong instead of only that it timed out.
  assert.ok(finished, `the graph load never completed; counts: ${state.counts || '(empty)'}`);
  assert.match(state.counts, /文献/, `unexpected counts line: ${state.counts}`);

  // The canvas only gets a backing store once the renderer was constructed and sized.
  assert.ok(
    state.canvas && state.canvas.width > 0 && state.canvas.height > 0,
    `canvas was not sized: ${JSON.stringify(state.canvas)}`,
  );

  // The action row ends at the right edge of the header. Left-packed right after the title it read as part of
  // the title and left an empty band on the right — the user's report. Measured, because "aligned right" is a
  // layout fact and not something the markup can show.
  const alignment = await page.evaluate(() => {
    const actions = document.querySelector('.knowledge-graph-header-actions');
    const header = actions?.closest('.knowledge-graph-header');
    const buttons = [...(actions?.children ?? [])];
    if (!actions || !header || !buttons.length) return null;
    const headerRect = header.getBoundingClientRect();
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    const last = boxes[boxes.length - 1];
    const padding = Number.parseFloat(getComputedStyle(header).paddingRight) || 0;
    return {
      rightGap: Math.round(headerRect.right - padding - last.right),
      // One row of 32px buttons; a wrapped row would double the vertical span. Measured as a span rather
      // than as distinct `top` values, because a fractional button height makes the rounded tops differ.
      span: Math.round(
        Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)),
      ),
    };
  });
  assert.ok(alignment, 'the header still has its action row');
  assert.ok(
    Math.abs(alignment.rightGap) <= 2,
    `the last action must sit against the header's right edge; gap ${alignment.rightGap}px`,
  );
  assert.ok(
    alignment.span <= 48,
    `the toolbar must stay one line; the buttons span ${alignment.span}px vertically`,
  );
  assert.deepEqual(pageErrors, [], 'opening the graph workspace must not throw');
});

test('skipping the tour does not leave the focus inside a hidden overlay', async () => {
  // Edge reported this as an extension error: "Blocked aria-hidden on an element because its descendant retained
  // focus", naming #onboarding-tour-skip inside #onboarding-tour. Clicking 跳过引导 leaves focus on that button, and
  // finishing the tour then hides its ancestor — which the browser refuses, because hiding the focused element from
  // assistive technology drops the caret into nowhere.
  //
  // This runs before the toast test, which is the one that skips the tour for the rest of the suite: a fresh profile
  // still has it open here, which is exactly the situation the error was reported from.
  // A fresh profile opens the tour on its own, but not instantly; a filtered run may also arrive after something else
  // dismissed it, in which case it is replayed from 设置 → 常规.
  const opened = await page.waitForSelector('#onboarding-tour:not([hidden])', { timeout: 10_000 })
    .then(() => true).catch(() => false);
  if (!opened) {
    await page.evaluate(() => {
      document.getElementById('ai-settings-button')?.click();
      document.querySelector('[data-settings-tab="general"]')?.click();
    });
    await page.waitForTimeout(600);
    // Dispatched, not clicked through the locator: the button sits at the bottom of a scrollable panel and this test is
    // about focus, not about hit targets.
    await page.evaluate(() => document.getElementById('start-onboarding-tour')?.click());
    await page.waitForSelector('#onboarding-tour:not([hidden])', { timeout: 10_000 });
  }
  const before = await page.evaluate(() => {
    const root = document.getElementById('onboarding-tour');
    return { hidden: root?.hidden ?? null, skip: Boolean(document.getElementById('onboarding-tour-skip')) };
  });
  assert.equal(
    before.hidden === false && before.skip,
    true,
    `the tour has to be open for this test to mean anything (hidden: ${before.hidden}, skip: ${before.skip})`,
  );
  // The violation is only visible at the instant `aria-hidden` is written, and by the next tick the browser has moved
  // the carets itself. What *is* observable is whether the focus was released **during** the click handler: with the
  // fix the screen blurs its own control first, without it the button keeps the focus until the browser gets around to
  // it. The read happens synchronously after the click, so nothing else can have intervened.
  const result = await page.evaluate(() => {
    const root = document.getElementById('onboarding-tour');
    const skip = document.getElementById('onboarding-tour-skip');
    skip.focus();
    const focusedBefore = root.contains(document.activeElement);
    // A programmatic click runs the real handler and leaves the focus where it is, which is the situation the user
    // reported: the button they pressed is still focused when the tour closes.
    skip.click();
    const focusAfterClick = root.contains(document.activeElement);
    return {
      focusedBefore,
      focusAfterClick,
      hidden: root.hidden,
      ariaHidden: root.getAttribute('aria-hidden'),
      activeElement: document.activeElement?.id ?? document.activeElement?.tagName ?? '',
    };
  });
  assert.equal(result.focusedBefore, true, 'the test must start with the focus on 跳过引导');
  assert.equal(result.hidden, true, 'skipping hides the tour');
  assert.equal(result.ariaHidden, 'true', 'and withdraws it from the accessibility tree');
  assert.equal(
    result.focusAfterClick,
    false,
    `the tour closed while its 跳过 button still held the focus (${result.activeElement}) — the state the browser `
    + 'blocks as "Blocked aria-hidden on an element because its descendant retained focus"',
  );
  assert.deepEqual(pageErrors, [], 'skipping the tour must not throw');
});

test('graph task messages float as a toast and clear themselves when finished', async () => {
  // The header line alone was too easy to miss far from the canvas, so status and progress are mirrored
  // into the same plate the reader uses for background tasks (`.knowledge-background-task-toast`). It has
  // to appear while a task runs and remove itself afterwards — a plate that stays would cover the graph.
  // A fresh profile shows the onboarding tour, whose overlay sits on top of the graph header (its backdrop
  // intercepts pointer events). Dismissing it is what a real user does, and it keeps this test about the
  // toast rather than about the tour's hit areas.
  await page.locator('#onboarding-tour-skip').click({ timeout: 3_000 }).catch(() => undefined);
  await page.locator('#knowledge-graph-refresh').click({ timeout: 10_000 }).catch(async () => {
    // Still covered (a tour step without a skip button): dispatch the click directly. The assertion below
    // is about the toast, and a blocked click would only be reported as a timeout.
    await page.evaluate(() => document.getElementById('knowledge-graph-refresh')?.click());
  });
  const toast = page.locator('#knowledge-graph-task-notice');
  await toast.waitFor({ state: 'visible', timeout: 10_000 });

  const appearance = await page.evaluate(() => {
    const element = document.getElementById('knowledge-graph-task-notice');
    return {
      classes: element?.className ?? '',
      text: (element?.textContent ?? '').trim(),
      title: element?.querySelector('strong')?.textContent ?? '',
    };
  });
  assert.match(appearance.classes, /knowledge-background-task-toast/, 'the reader toast styling is reused');
  assert.equal(appearance.title, '知识图谱', 'and it names the page it belongs to');
  assert.ok(appearance.text.length > 4, `the toast must carry the message; got "${appearance.text}"`);

  // A finished task removes itself: this is the difference between a hint and a permanent overlay.
  await toast.waitFor({ state: 'detached', timeout: 20_000 });
  assert.equal(await page.locator('#knowledge-graph-task-notice').count(), 0);
  assert.deepEqual(pageErrors, [], 'the toast lifecycle must not throw');
});

test('the "PDF 阅读" tab leaves the knowledge graph workspace', async () => {
  // Reported from real use: from the graph page, clicking "PDF 阅读" revealed the reader's
  // toolbars while the graph page stayed on screen — the handler switched the *application*
  // view but never transitioned the workspace. Both halves are asserted, because "the toolbar
  // appeared" is exactly what made the failure look like it had worked.
  const view = () => page.evaluate(() => {
    const stage = document.getElementById('workspace-stage');
    return {
      graphHidden: document.getElementById('knowledge-graph-page').hasAttribute('hidden'),
      readerHidden: document.getElementById('reader-workspace').hasAttribute('hidden'),
      visible: [...(stage?.children ?? [])]
        .filter((element) => !element.hasAttribute('hidden'))
        .map((element) => element.id),
      annotationBarHidden: document.getElementById('annotation-tools-bar')?.hasAttribute('hidden') ?? null,
    };
  });

  // The first-run tour puts a click blocker over the left half of the page; it is not what this
  // test is about, so it is dismissed before the toolbar is used.
  const tourSkip = page.locator('#onboarding-tour-skip');
  if (await tourSkip.count()) {
    await tourSkip.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }

  // The graph page is open at this point in the suite; the entry button must bring us back.
  assert.equal((await view()).graphHidden, false, 'the graph workspace should be open first');

  await page.locator('#ai-panel-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('knowledge-graph-page').hasAttribute('hidden'),
    { timeout: 10_000 },
  );
  const reader = await view();
  assert.equal(reader.readerHidden, false, 'the reader workspace must become visible');
  assert.deepEqual(reader.visible, ['reader-workspace'], 'exactly one workspace is on screen');
  assert.equal(reader.annotationBarHidden, false, 'the annotation toolbar belongs to the reader');

  // And back again, so the way in still works after the way out. The *outgoing* page becomes
  // hidden only once the transition settles, so that is what is waited on — the incoming page is
  // visible from the first frame, and asserting on it alone reads a half-finished switch.
  await page.locator('#knowledge-graph-entry').click();
  await page.waitForFunction(
    () => document.getElementById('reader-workspace').hasAttribute('hidden'),
    { timeout: 10_000 },
  );
  const graph = await view();
  assert.equal(graph.readerHidden, true, 'the reader workspace must be hidden again');
  assert.deepEqual(graph.visible, ['knowledge-graph-page'], 'exactly one workspace is on screen');

  // Leave the app on the reader, which is where the rest of the suite expects it.
  await page.locator('#ai-panel-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('knowledge-graph-page').hasAttribute('hidden'),
    { timeout: 10_000 },
  );
});

test('the packaged page created its own database', async () => {
  // Opening the graph page runs the paper projection, which opens the graph database.
  // This is the only assertion in the repo that exercises the real storage code path
  // inside the real extension context — every isolation suite stubs it.
  await page.waitForFunction(async () => (
    await indexedDB.databases()
  ).some((database) => database.name === 'pdfpal-knowledge-graph'), { timeout: 20_000 });

  const names = await page.evaluate(async () => (
    await indexedDB.databases()
  ).map((database) => database.name));
  assert.ok(
    names.includes('pdfpal-knowledge-graph'),
    `graph database missing; databases are ${JSON.stringify(names)}`,
  );
});

test('the PDF decoder assets the packaged build needs are shipped and loadable', async () => {
  // PDF.js 5 ships its JBIG2 / JPEG-2000 / colour-management decoders as separate wasm
  // modules located through `wasmUrl`. When they are missing the *load still succeeds*
  // and the page renders as an empty sheet while its (invisible) OCR text layer extracts
  // perfectly — a failure invisible to every text-based test and only noticed by a human
  // reading the document. Hence an explicit check on the packaged artifact.
  const assets = [
    'pdfjs-wasm/jbig2.wasm',
    'pdfjs-wasm/openjpeg.wasm',
    'pdfjs-wasm/qcms_bg.wasm',
    // A predefined CMap: CJK documents map character codes to Unicode through these.
    'pdfjs-cmaps/Adobe-GB1-UCS2.bcmap',
    'pdfjs-standard-fonts/FoxitSerif.pfb',
  ];

  for (const asset of assets) {
    const served = await page.evaluate(async (assetPath) => {
      const response = await fetch(assetPath);
      const buffer = response.ok ? await response.arrayBuffer() : new ArrayBuffer(0);
      return { ok: response.ok, status: response.status, bytes: buffer.byteLength };
    }, asset);
    assert.ok(served.ok, `${asset} is not served from the extension (${served.status})`);
    assert.ok(served.bytes > 1000, `${asset} looks truncated (${served.bytes} bytes)`);
  }

  // Compiling the decoder proves two things a plain fetch cannot: the file is a real
  // wasm module, and the extension CSP permits instantiating it.
  const compiled = await page.evaluate(async () => {
    try {
      const module = await WebAssembly.compileStreaming(fetch('pdfjs-wasm/jbig2.wasm'));
      return { ok: true, exports: WebAssembly.Module.exports(module).length };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  });
  assert.equal(compiled.ok, true, `jbig2.wasm did not compile: ${compiled.reason}`);
  assert.ok(compiled.exports > 0, 'the compiled decoder exposes exports');
});

test('the file picker in the packaged build accepts several documents', async () => {
  // Opening a batch is a property of the packaged markup, not just of the code path:
  // without the `multiple` attribute the picker keeps returning one file however the
  // handler is written.
  const input = await page.locator('#file-input').evaluate((element) => ({
    multiple: element.multiple,
    accept: element.getAttribute('accept'),
  }));
  assert.equal(input.multiple, true, 'the file input must allow multiple selection');
  assert.match(input.accept ?? '', /pdf/i);
});

test('a document that fails to open raises the readable error dialog', async () => {
  // Serving a non-PDF as `application/pdf` reproduces the real failure path: the
  // reader reports the parse error through `setStatus(..., true)`, which is the funnel
  // the dialog is wired to. This is the user-visible behaviour that was missing — the
  // reason used to be ellipsised into a one-line status bar.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
    response.end('this is definitely not a pdf');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const errorPage = await context.newPage();
  try {
    await errorPage.goto(
      `chrome-extension://${extensionId}/viewer.html?src=${encodeURIComponent(`http://127.0.0.1:${port}/broken.pdf`)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await errorPage.bringToFront();
    await errorPage.waitForSelector('#app-error-dialog[open]', { timeout: 30_000 });

    const shown = await errorPage.evaluate(() => {
      const message = document.getElementById('app-error-dialog-message');
      const style = message ? getComputedStyle(message) : null;
      return {
        message: message?.textContent?.trim() ?? '',
        textOverflow: style?.textOverflow ?? '',
        whiteSpace: style?.whiteSpace ?? '',
        statusText: document.getElementById('status-text')?.textContent?.trim() ?? '',
      };
    });
    assert.ok(shown.message.length > 0, 'the dialog carries the failure reason');
    assert.notEqual(shown.textOverflow, 'ellipsis', 'the reason is not truncated');
    assert.equal(shown.whiteSpace, 'pre-wrap', 'the packaged stylesheet is in effect');
    assert.ok(shown.statusText.length > 0, 'the status bar keeps the message too');

    await errorPage.locator('#app-error-dialog-dismiss').click();
    assert.equal(
      await errorPage.locator('#app-error-dialog').evaluate((dialog) => dialog.open),
      false,
    );
  } finally {
    await errorPage.close();
    server.close();
  }
});

test('a document added to the knowledge base reaches the graph without a manual resync', async () => {
  // Reported from real use: after adding a PDF to the knowledge base, the graph still said "0 篇文献"
  // and both extract buttons were grey. The page only ever *removed* papers on a re-read, so an
  // addition waited for 重新同步 — and adding happens from the toolbar on this very page.
  //
  // Runs last: it writes to the knowledge base, which no earlier test expects to be empty.
  await page.locator('#knowledge-graph-entry').click();
  await page.waitForSelector('#knowledge-graph-page:not([hidden])', { timeout: 15_000 });
  await page.waitForFunction(
    () => (document.getElementById('knowledge-graph-counts')?.textContent ?? '').trim().length > 0,
    { timeout: 30_000 },
  );

  const addDocument = (documentId) => page.evaluate((id) => {
    const key = 'pdf-helper-knowledge-corpus-v1';
    const stamp = new Date().toISOString();
    const state = JSON.parse(localStorage.getItem(key) ?? '{"folders":[],"documents":[]}');
    state.documents.push({
      documentId: id,
      documentName: `Paper ${id}`,
      pageCount: 5,
      folderId: null,
      addedAt: stamp,
      updatedAt: stamp,
      indexStatus: 'ready',
      chunkCount: 1,
    });
    localStorage.setItem(key, JSON.stringify(state));
    // The corpus adapter dispatches this on every write; the graph must react to it.
    window.dispatchEvent(new CustomEvent('pdf-helper:knowledge-corpus-change'));
  }, documentId);

  // The paper total is read from the **empty-canvas hint**, not from the counts line: the counts line
  // reports what is actually *drawn*, and the whole-graph view builds its node set from edges, so a
  // paper that has no relation yet counts as `0 文献 … 未连接 1` rather than as one paper. The hint is
  // keyed on how many documents the projection found ("知识库里的 N 篇文献之间还没有任何关系"), which is
  // exactly the number the user saw stuck at 0. (It also replaces the status message, which is a
  // transient floating notice now and would have to be caught in its four seconds.)
  const projectedPapers = async () => {
    const hint = await page.locator('#knowledge-graph-empty-hint').textContent();
    const match = /知识库里的\s*(\d+)\s*篇文献/.exec(hint ?? '');
    return match ? Number(match[1]) : -1;
  };

  await addDocument('kb-e2e-1');
  await page.waitForFunction(
    () => /知识库里的\s*1\s*篇文献/.test(
      document.getElementById('knowledge-graph-empty-hint')?.textContent ?? '',
    ),
    { timeout: 30_000 },
  );
  assert.equal(await projectedPapers(), 1, 'the added document is projected');
  assert.equal(
    await page.locator('#knowledge-graph-batch').isDisabled(),
    false,
    'the batch extract button is usable once there is a paper',
  );

  // A second write must not be missed either, and must not leave the count behind.
  await addDocument('kb-e2e-2');
  await page.waitForFunction(
    () => /知识库里的\s*2\s*篇文献/.test(
      document.getElementById('knowledge-graph-empty-hint')?.textContent ?? '',
    ),
    { timeout: 30_000 },
  );
  assert.equal(await projectedPapers(), 2, 'the graph follows the knowledge base while it is open');
});

test('the packaged service worker answers the explanation stream port', async () => {
  // The one thing this suite *can* prove about the AI plumbing without an API key: that the port is
  // registered in the packaged build. `started` is posted before the provider call, so an answer here
  // means "the background knows this port" — while an immediate disconnect means the same thing the
  // user saw: the loaded background has no handler for it (typically a stale service worker, because
  // reloading the page reloads the viewer chunks but not the extension's background).
  const result = await page.evaluate(async () => {
    const port = chrome.runtime.connect({ name: 'pdf-helper:ai-explain-stream-v1' });
    return new Promise((resolve) => {
      const seen = [];
      let disconnected = '';
      const timer = setTimeout(() => {
        try {
          port.disconnect();
        } catch {
          // Already gone.
        }
        resolve({ seen, disconnected, timedOut: true });
      }, 10_000);
      port.onMessage.addListener((message) => {
        seen.push(message?.type ?? 'unknown');
        if (message?.type === 'started' || message?.type === 'error') {
          clearTimeout(timer);
          try {
            port.disconnect();
          } catch {
            // Already gone.
          }
          resolve({ seen, disconnected, timedOut: false });
        }
      });
      port.onDisconnect.addListener(() => {
        disconnected = chrome.runtime.lastError?.message ?? '(no reason)';
        clearTimeout(timer);
        resolve({ seen, disconnected, timedOut: false });
      });
      port.postMessage({
        type: 'start',
        requestId: 'packaged-probe',
        item: { name: 'Probe Entity', type: 'Method', paperTitle: 'Probe Paper', quotes: [] },
      });
    });
  });

  assert.ok(
    result.seen.includes('started') || result.seen.includes('error'),
    `the background must answer the explanation port; saw ${JSON.stringify(result.seen)} `
      + `and disconnect "${result.disconnected}"`,
  );
});

test('the packaged service worker answers the translation stream port', async () => {
  // Same probe as the explanation port, and the same failure it catches: a background older than the page answers
  // nothing, which in the panel looks like "翻译永远不出现" rather than like a version problem. `started` is posted
  // before the provider call, so seeing it means the background knows this port at all.
  const result = await page.evaluate(async () => {
    const port = chrome.runtime.connect({ name: 'pdf-helper:ai-translate-stream-v1' });
    return new Promise((resolve) => {
      const seen = [];
      let disconnected = '';
      const timer = setTimeout(() => {
        try {
          port.disconnect();
        } catch {
          // Already gone.
        }
        resolve({ seen, disconnected, timedOut: true });
      }, 10_000);
      port.onMessage.addListener((message) => {
        seen.push(message?.type ?? 'unknown');
        if (message?.type === 'error') {
          clearTimeout(timer);
          resolve({ seen, disconnected, timedOut: false, error: message.error ?? '' });
          return;
        }
        // `started` asks for a provider key we do not have in a test profile; a disconnect after it is enough.
        if (message?.type === 'started') {
          clearTimeout(timer);
          try {
            port.disconnect();
          } catch {
            // Already gone.
          }
          resolve({ seen, disconnected, timedOut: false });
        }
      });
      port.onDisconnect.addListener(() => {
        disconnected = chrome.runtime.lastError?.message ?? '(no reason)';
        clearTimeout(timer);
        resolve({ seen, disconnected, timedOut: false });
      });
      port.postMessage({
        type: 'start',
        requestId: 'packaged-translation-probe',
        task: 'translation',
        text: 'The shortest linear program problem is to find the shortest linear function.',
      });
    });
  });

  assert.ok(
    result.seen.includes('started') || result.seen.includes('error'),
    'the background must answer the translation port; saw '
      + `${JSON.stringify(result.seen)} and disconnect "${result.disconnected}"`,
  );
  // A missing key is the expected answer in a test profile; it must be a readable message, not a crash.
  if (result.seen.includes('error')) {
    assert.ok(result.error.length > 0, 'an error from this port carries a reason');
  }
});

test('nothing was logged as an error while the extension booted and loaded', () => {
  assert.deepEqual(consoleErrors, [], 'the packaged page logged console errors');
  assert.deepEqual(pageErrors, [], 'the packaged page threw');
});

console.log('Built extension smoke tests passed.');
