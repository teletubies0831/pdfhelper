import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * "Jump back to the source sentence" — the contract, in a real browser.
 *
 * This was the one phase-3 deliverable with no automated coverage at all: the jump
 * crosses four features (viewer state, shared navigation, the PDF reader, and the
 * citation highlighter) and ends in a DOM effect nobody can assert on headlessly. So
 * the *contract* is pinned instead — with what arguments each collaborator is called,
 * in what order, and which fallback runs when the citation cannot be located.
 *
 * The fallbacks are the parts worth testing, because each one is a decision that
 * someone will be tempted to "simplify":
 *
 * - a quote that cannot be found still navigates to the page (a re-flowed text layer
 *   is the usual cause, not a missing paper), and
 * - the graph page is closed *before* navigating, because navigating under a
 *   covering workspace leaves the user looking at a graph over the document.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');

  const source = await loadModule(
    'src/viewer/features/knowledge-graph/graph-source-navigation.ts',
  );

  await page.evaluate((code) => {
    window.calls = [];
    window.openResult = true;
    window.citeThrows = false;

    // StateCell-like holder: the module reads `pdfDocument.value`.
    const viewerState = { pdfDocument: { value: null } };
    const sourceNavigation = {
      async ensureSourcePdfOpen(name) {
        window.calls.push(['open', name]);
        return window.openResult;
      },
    };
    const pdfReader = {
      async navigateToPdfPageWhenVisible(pageNumber) {
        window.calls.push(['navigate', pageNumber]);
      },
    };
    const translation = {
      async jumpToPdfCitations(pageNumber, quotes) {
        window.calls.push(['cite', pageNumber, quotes]);
        if (window.citeThrows) throw new Error('citation not found');
      },
    };
    const graphPage = {
      closeKnowledgeGraphPage() {
        window.calls.push(['close']);
      },
    };

    const build = (moduleCode, target) => {
      new Function('require', 'exports', moduleCode)((name) => {
        if (name.includes('viewer-state')) return viewerState;
        if (name.includes('source-pdf-navigation')) return sourceNavigation;
        if (name.includes('pdf-reader/public')) return pdfReader;
        if (name.includes('translation/public')) return translation;
        if (name.includes('knowledge-graph-page')) return graphPage;
        throw new Error(`Unmocked dependency: ${name}`);
      }, target);
    };

    window.nav = {};
    build(code, window.nav);
    window.viewerState = viewerState;
  }, source);
});

after(async () => { await browser?.close(); });

const PAPER = { paperId: 'paper-1', title: 'Attention Is All You Need.pdf' };

/** Runs one jump and returns the recorded collaborator calls. */
async function jump({ numPages = 12, pageNumber = 1, quote, open = true, citeThrows = false } = {}) {
  return page.evaluate((options) => {
    window.calls = [];
    window.openResult = options.open;
    window.citeThrows = options.citeThrows;
    // `null` means no document is open; 0 is a document that reports no pages, which
    // is a different case and must stay distinguishable in the fixture.
    window.viewerState.pdfDocument.value = options.numPages === null
      ? null
      : { numPages: options.numPages };
    return window.nav
      .openGraphSourcePdf(options.paper, options.pageNumber, options.quote)
      .then((result) => ({ result, calls: window.calls }));
  }, { paper: PAPER, numPages, pageNumber, quote, open, citeThrows });
}

test('a paper that cannot be opened reports failure without navigating anywhere', async () => {
  const outcome = await jump({ open: false });
  assert.equal(outcome.result, false);
  // The title, not the graph id: the recent-files list the jump can actually open is
  // keyed by document name, and the projection's title *is* that name.
  assert.deepEqual(outcome.calls, [['open', PAPER.title]]);
});

test('an opened paper closes the graph page before landing on the page', async () => {
  const outcome = await jump({ pageNumber: 7, numPages: 12 });
  assert.equal(outcome.result, true);
  assert.deepEqual(outcome.calls, [
    ['open', PAPER.title],
    ['close'],
    ['navigate', 7],
  ]);
});

test('the page number is clamped to the document and rounded', async () => {
  assert.deepEqual((await jump({ pageNumber: 0 })).calls.at(-1), ['navigate', 1]);
  assert.deepEqual((await jump({ pageNumber: 99, numPages: 12 })).calls.at(-1), ['navigate', 12]);
  assert.deepEqual((await jump({ pageNumber: 7.6 })).calls.at(-1), ['navigate', 8]);
  // A malformed page number — from a stored or imported evidence record — must not
  // reach the reader as NaN, which asks for a page that cannot exist.
  assert.deepEqual((await jump({ pageNumber: Number.NaN })).calls.at(-1), ['navigate', 1]);
  // The same normalisation has to survive a document that reports no pages.
  assert.deepEqual(
    (await jump({ pageNumber: 4, numPages: 0 })).calls.at(-1),
    ['navigate', 1],
    'an empty document still yields a page the reader can be asked for',
  );
});

test('a quoted source jumps to the sentence, not just the page', async () => {
  const quote = 'we extend the encoder with a shared attention block';
  const outcome = await jump({ pageNumber: 4, quote });
  assert.deepEqual(outcome.calls, [
    ['open', PAPER.title],
    ['close'],
    ['cite', 4, [quote]],
  ]);
  // The citation jump preserves the reading position itself, so the plain page
  // navigation must not also run.
  assert.ok(
    !outcome.calls.some(([name]) => name === 'navigate'),
    'the citation jump replaces the plain navigation',
  );
});

test('a quote too short to locate falls back to the page', async () => {
  // Below the length floor a "quote" is more likely to be a stray token than a
  // sentence, and a failed citation jump would waste the user's click.
  assert.deepEqual((await jump({ pageNumber: 3, quote: 'short' })).calls.at(-1), ['navigate', 3]);
  assert.deepEqual((await jump({ pageNumber: 3, quote: '   ' })).calls.at(-1), ['navigate', 3]);
});

test('a quote that cannot be located still lands on the page', async () => {
  const quote = 'a sentence that was re-flowed by a different text layer';
  const outcome = await jump({ pageNumber: 5, quote, citeThrows: true });
  assert.equal(outcome.result, true, 'the user is not stranded on the graph page');
  assert.deepEqual(outcome.calls, [
    ['open', PAPER.title],
    ['close'],
    ['cite', 5, [quote]],
    ['navigate', 5],
  ]);
});

console.log('Graph source jump contract tests passed.');
