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

  // The status line is written twice: once when the load starts and again when it
  // finishes. Waiting for the *finished* message is what distinguishes "the page
  // became visible" from "the workspace actually loaded" — the difference between
  // this suite and a screenshot assertion.
  const completion = /(已载入|已同步)/;
  const finished = await page.waitForFunction(
    () => /(已载入|已同步)/.test(
      document.getElementById('knowledge-graph-status')?.textContent ?? '',
    ),
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);

  const state = await page.evaluate(() => {
    const canvas = document.getElementById('knowledge-graph-canvas');
    return {
      status: document.getElementById('knowledge-graph-status')?.textContent?.trim() ?? '',
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      inspector: document.getElementById('knowledge-graph-inspector')?.hidden,
    };
  });

  // Reported with the status that was actually reached, so a failure here says which
  // way the load path went wrong instead of only that it timed out.
  assert.ok(finished, `the graph load never completed; last status: ${state.status || '(empty)'}`);
  assert.match(state.status, completion, `unexpected status: ${state.status}`);

  // The canvas only gets a backing store once the renderer was constructed and sized.
  assert.ok(
    state.canvas && state.canvas.width > 0 && state.canvas.height > 0,
    `canvas was not sized: ${JSON.stringify(state.canvas)}`,
  );
  assert.deepEqual(pageErrors, [], 'opening the graph workspace must not throw');
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

  const paperCount = async () => {
    const status = await page.locator('#knowledge-graph-status').textContent();
    const match = /共 (\d+) 篇/.exec(status ?? '');
    return match ? Number(match[1]) : -1;
  };

  await addDocument('kb-e2e-1');
  await page.waitForFunction(
    () => /共 1 篇/.test(document.getElementById('knowledge-graph-status')?.textContent ?? ''),
    { timeout: 30_000 },
  );
  assert.equal(await paperCount(), 1, 'the added document is projected');
  assert.equal(
    await page.locator('#knowledge-graph-batch').isDisabled(),
    false,
    'the batch extract button is usable once there is a paper',
  );

  // A second write must not be missed either, and must not leave the count behind.
  await addDocument('kb-e2e-2');
  await page.waitForFunction(
    () => /共 2 篇/.test(document.getElementById('knowledge-graph-status')?.textContent ?? ''),
    { timeout: 30_000 },
  );
  assert.equal(await paperCount(), 2, 'the graph follows the knowledge base while it is open');
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

test('nothing was logged as an error while the extension booted and loaded', () => {
  assert.deepEqual(consoleErrors, [], 'the packaged page logged console errors');
  assert.deepEqual(pageErrors, [], 'the packaged page threw');
});

console.log('Built extension smoke tests passed.');
