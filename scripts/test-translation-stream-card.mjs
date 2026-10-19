import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

/** Transpiles a viewer module so it can be exercised in Node (no DOM) — used by the merge tests below. */
async function transpile(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

/** Loads an already-transpiled module object (kept for readability at the call sites). */
function load(exports) {
  return exports;
}

/**
 * The streaming sentence card, in a real DOM.
 *
 * This is the half of the speed work that a prompt test cannot see: the card has to be **on screen before the answer
 * exists**, so the reader sees structure instead of an empty panel, and the two halves have to update independently —
 * the translation as it streams, the vocabulary when it lands, and neither taking the other down with it.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent(await readFile(new URL('../src/viewer/templates/reader-workspace.html', import.meta.url), 'utf8'));
  const code = ts.transpileModule(
    await readFile(new URL('../src/viewer/features/translation/sentence-card-view.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  await page.evaluate((source) => {
    const get = (id) => document.getElementById(id);
    const elements = {
      selectedSnippetElement: get('selected-snippet'),
      translationLearningHintElement: get('translation-learning-hint'),
      translationResultElement: get('translation-result'),
    };
    const appState = { currentEnglishLearningSourceSentence: { value: '' } };
    const selectionContext = {
      autoResizeTranslationTextarea() {},
      createLearningElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      },
      normalizeLearningInlineText: (value) => String(value ?? '').trim(),
      setMoreExamplesButtonVisible() {},
      setTranslationLearningTitle() {},
    };
    const learningView = {
      renderLearningRichText(element, value) {
        element.textContent = value;
        return element;
      },
      setSelectedSnippetDisplayMode() {},
    };
    const exports = {};
    new Function('require', 'exports', source)((name) => {
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../app/public') return appState;
      if (name === './selection-context') return selectionContext;
      if (name === './learning-view') return learningView;
      throw new Error(`Unmocked dependency: ${name}`);
    }, exports);
    window.card = exports;
    window.appState = appState;
    window.dom = {
      result: elements.translationResultElement,
      hint: elements.translationLearningHintElement,
      snippet: elements.selectedSnippetElement,
    };
  }, code);
});

after(async () => { await browser?.close(); });

const lines = (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((node) => node.textContent.trim()), selector);

test('the card exists before the answer does, with both halves announced', async () => {
  const state = await page.evaluate(() => {
    const card = window.card.renderSentenceStreamingCard('The shortest linear program problem.');
    const labels = [...window.dom.result.querySelectorAll('.english-learning-label')].map((node) => node.textContent);
    const notes = [...window.dom.result.querySelectorAll('.english-stream-note')]
      .map((node) => node.textContent)
      .filter(Boolean);
    return {
      labels,
      notes,
      snippet: window.dom.snippet.value,
      hasCard: Boolean(window.dom.result.querySelector('.sentence-card')),
      translationEmpty: window.dom.result.querySelector('.english-sentence-translation')?.textContent === '',
      card: (card.setTranslation('译文'), window.dom.result.querySelector('.english-sentence-translation')?.textContent),
    };
  });
  assert.deepEqual(state.labels, ['原句翻译', '重点单词'], 'both halves are visible from the first frame');
  assert.deepEqual(state.notes, ['正在挑选重点词…'], 'the empty translation slot says nothing yet');
  assert.equal(state.snippet, 'The shortest linear program problem.', 'the English is local, so it needs no model');
  assert.equal(state.hasCard, true);
  assert.equal(state.translationEmpty, true);
  assert.equal(state.card, '译文', 'streamed text lands in the translation slot immediately');
});

test('the translation streams in place and the vocabulary arrives later, independently', async () => {
  const result = await page.evaluate(() => {
    const card = window.card.renderSentenceStreamingCard('Sentence under test.');
    const translationNode = () => window.dom.result.querySelector('.english-sentence-translation');
    const keywordNodesAtStart = window.dom.result.querySelectorAll('.english-keyword-card').length;
    // Characters as they arrive.
    card.setStreaming(true);
    card.setTranslation('短');
    const first = { text: translationNode().textContent, streaming: translationNode().classList.contains('is-streaming') };
    card.setTranslation('最短线性程序问题');
    const growing = translationNode().textContent;
    card.setStreaming(false);
    card.setTranslationNote('');
    // Then the words.
    card.setKeywords([
      { word: 'linear program', partOfSpeech: 'n.', meaningInSentence: '线性程序' },
      { word: 'shortest', partOfSpeech: 'adj.', meaningInSentence: '最短的' },
    ]);
    return {
      keywordNodesAtStart,
      first,
      growing,
      finalTranslation: translationNode().textContent,
      streamingAfterDone: translationNode().classList.contains('is-streaming'),
      keywords: [...window.dom.result.querySelectorAll('.english-keyword-card')].map((node) => node.querySelector('.english-keyword-word')?.textContent),
      leftoverNote: window.dom.result.querySelector('.english-stream-note')?.textContent ?? '',
    };
  });
  assert.equal(result.keywordNodesAtStart, 0, 'the vocabulary block is a promise, not content');
  assert.deepEqual(result.first, { text: '短', streaming: true }, 'the first chunk is visible on its own');
  assert.equal(result.growing, '最短线性程序问题', 'and it is replaced by the accumulated text, not appended twice');
  assert.equal(result.finalTranslation, '最短线性程序问题');
  assert.equal(result.streamingAfterDone, false, 'the caret goes away when the stream ends');
  assert.deepEqual(result.keywords, ['linear program', 'shortest']);
  assert.equal(result.leftoverNote, '', 'the “正在挑选重点词…” line is gone once the words are there');
});

test('a failed keyword half leaves the translation alone', async () => {
  const state = await page.evaluate(() => {
    const card = window.card.renderSentenceStreamingCard('Sentence under test.');
    card.setTranslation('已经出现的译文');
    card.setKeywordNote('重点词没有生成：HTTP 429', true);
    // The keyword block is the one that carries the 重点单词 label; the first note in the card belongs to the
    // translation.
    const keywordBlock = [...window.dom.result.querySelectorAll('.english-learning-block')]
      .find((block) => block.querySelector('.english-learning-label')?.textContent === '重点单词');
    const note = keywordBlock?.querySelector('.english-stream-note');
    return {
      translation: window.dom.result.querySelector('.english-sentence-translation')?.textContent,
      note: note?.textContent,
      isError: note?.classList.contains('is-error'),
    };
  });
  assert.equal(state.translation, '已经出现的译文', 'an optional aid must not take the sentence with it');
  assert.match(state.note, /重点词没有生成/);
  assert.equal(state.isError, true, 'and it says so in the error colour');
});

console.log('Translation streaming card tests passed.');

// ---------------------------------------------------------------------------
// The merge, without a browser.
//
// The reported bug: 「翻译内容直接空了」 — a card showing 「原句翻译」 with nothing under it. The cause was order-dependence
// between the two halves: a history entry was written as soon as the keywords landed, which could be before any
// translation existed, and that entry then came back as a cache hit (no request made) and painted an empty card.
// ---------------------------------------------------------------------------
test('a sentence result is never built without a translation', async () => {
  const state = load(await transpile('src/viewer/features/translation/sentence-stream-state.ts'));

  const empty = state.createSentenceStreamState('The shortest linear program problem.');
  assert.equal(state.toSentenceLearningResult(empty), null, 'no translation, nothing to show or store');

  const withKeywordsOnly = state.setStreamKeywords(empty, [
    { word: 'linear program', partOfSpeech: 'n.', meaningInSentence: '线性程序' },
  ]);
  assert.equal(
    state.toSentenceLearningResult(withKeywordsOnly),
    null,
    'keywords arriving first must not produce a result — that is the entry that poisoned the cache',
  );

  const translated = state.appendTranslation(withKeywordsOnly, '最短线性');
  assert.deepEqual(state.toSentenceLearningResult(translated), {
    kind: 'sentence',
    sourceText: 'The shortest linear program problem.',
    translation: '最短线性',
    keywords: [{ word: 'linear program', partOfSpeech: 'n.', meaningInSentence: '线性程序' }],
  }, 'once the translation exists, the words it arrived with are kept');
});

test('whichever half finishes last does not erase the other', async () => {
  const state = load(await transpile('src/viewer/features/translation/sentence-stream-state.ts'));
  const keywords = [{ word: 'gate', partOfSpeech: 'n.', meaningInSentence: '门电路' }];

  const wordsFirst = state.settleTranslation(
    state.setStreamKeywords(state.createSentenceStreamState('A gate.'), keywords),
    '一个门电路。',
  );
  const wordsLast = state.setStreamKeywords(
    state.settleTranslation(state.createSentenceStreamState('A gate.'), '一个门电路。'),
    keywords,
  );
  assert.deepEqual(state.toSentenceLearningResult(wordsFirst), state.toSentenceLearningResult(wordsLast));
  assert.equal(state.toSentenceLearningResult(wordsLast).keywords.length, 1, 'the translation does not wipe the words');
});

test('an empty delta or a blank final answer cannot blank what streamed', async () => {
  const state = load(await transpile('src/viewer/features/translation/sentence-stream-state.ts'));
  let value = state.createSentenceStreamState('A gate.');
  value = state.appendTranslation(value, '');
  value = state.appendTranslation(value, '一个');
  value = state.settleTranslation(value, '   ');
  assert.equal(
    state.toSentenceLearningResult(value).translation,
    '一个',
    'a provider that ends with whitespace keeps the streamed text',
  );
});

test('a poisoned cache entry is ignored instead of painting an empty card', async () => {
  // Reads go through `readTranslationHistoryEntries`, which must drop a sentence result with no translation.
  const entries = load(
    await transpile('src/viewer/features/translation/translation-history.ts', {
      'wxt/browser': { browser: { storage: { local: { get: async () => ({}), set: async () => {} } } } },
      '../../app/public': {},
      '../../app/viewer-elements': {},
      '../../app/viewer-state': {},
      '../../app/document-identity': { getPdfFingerprint: () => 'test-fingerprint' },
      '../recent-files/public': { setStatus() {} },
      '../../core/pdf-reader/public': { normalizeCopiedText: (value) => String(value ?? '') },
      '../../shared-ui/markdown/markdown-renderer': {},
      '../../shared-ui/markdown/knowledge-markdown': {},
      '../../shared-ui/markdown/citation-text': { normalizeCitationMatchText: (value) => String(value ?? '') },
      './learning-view': {},
      './sentence-card-view': {},
      './selection-context': {},
      './translation-action-layout': {},
    }),
  );
  const read = entries.readTranslationHistoryEntries
    ?? entries.default?.readTranslationHistoryEntries;
  assert.equal(typeof read, 'function', 'the reader is exported');
  const read_back = read([
    {
      id: 'broken',
      sourceText: 'A gate.',
      pageNumber: 1,
      updatedAt: 1,
      result: { kind: 'sentence', sourceText: 'A gate.', translation: '', keywords: [] },
    },
    {
      id: 'good',
      sourceText: 'A gate.',
      pageNumber: 1,
      updatedAt: 2,
      result: { kind: 'sentence', sourceText: 'A gate.', translation: '一个门电路。', keywords: [] },
    },
  ]);
  assert.deepEqual(read_back.map((entry) => entry.id), ['good'], 'the empty entry is dropped, the real one stays');
});
