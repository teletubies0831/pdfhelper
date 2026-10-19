import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

/**
 * The translation card's prompts.
 *
 * These are assertions about **cost**, which is why they are written down: every extra field is output tokens on the
 * slowest path in the product, and every chat-assistant rule that leaks in here is paid for by a one-sentence
 * translation. The complaint that started this was "translating one sentence takes about seven seconds", and the
 * prompt shape was most of it.
 */

const compile = async (path) => ts.transpileModule(
  await readFile(new URL(`../src/${path}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function load(code, dependencies = {}) {
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    assert.ok(name in dependencies, `Missing dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const prompts = load(await compile('background/ai/translation-prompts'));
const viewerStream = load(await compile('viewer/features/translation/translation-stream'), {
  'wxt/browser': { browser: { runtime: { connect: () => { throw new Error('unused'); } } } },
  '../../../modules/ai/public': { AI_TRANSLATION_STREAM_PORT_NAME: 'test-port' },
});

const SENTENCE = 'The shortest linear program problem is to find the shortest linear function.';
const start = (overrides = {}) => ({
  type: 'start',
  requestId: 'r1',
  task: 'translation',
  text: SENTENCE,
  ...overrides,
});

const joined = (messages) => messages.map((message) => message.content).join('\n');

test('the translation half asks for plain text, not JSON', () => {
  const messages = prompts.buildSentenceTranslationMessages(start());
  assert.equal(messages.length, 2, 'one system instruction plus the sentence');
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, SENTENCE, 'the sentence is sent verbatim, once');
  const text = joined(messages);
  assert.match(text, /只输出译文/);
  // It *mentions* JSON to forbid it ("不要 JSON"); what must not appear is a request for a JSON document.
  assert.doesNotMatch(text, /JSON 格式/, 'JSON is what made the reader wait for a closing brace');
  assert.match(text, /\$\.\.\.\$/, 'the LaTeX rules still apply to the translation itself');
});

test('the keyword half keeps the rubric but no longer asks for a written justification', () => {
  const text = joined(prompts.buildSentenceKeywordMessages(start({ task: 'keywords' })));
  assert.match(text, /最多 6 个/, 'the six-word list is the user’s decision and stays');
  assert.match(text, /CET-6/, 'the inclusion rubric is what makes the list worth reading');
  assert.match(text, /排除/);
  assert.doesNotMatch(text, /reason/, 'the reason field was parsed and thrown away — pure output tokens');
  assert.doesNotMatch(text, /判定依据/, 'and so was the instruction to write one per candidate');
});

test('the LaTeX rebuild is requested only when the sentence carries maths', () => {
  assert.doesNotMatch(
    joined(prompts.buildSentenceKeywordMessages(start({ task: 'keywords' }))),
    /sourceTextLatex/,
  );
  assert.match(
    joined(prompts.buildSentenceKeywordMessages(start({ task: 'keywords', wantsSourceLatex: true }))),
    /sourceTextLatex/,
    'the field appears exactly when it is useful',
  );
});

test('the chat assistant prompt is not part of a translation request', () => {
  const text = joined([
    ...prompts.buildSentenceTranslationMessages(start()),
    ...prompts.buildSentenceKeywordMessages(start({ task: 'keywords' })),
  ]);
  // These belong to the chat contract; paying for them on every sentence was most of the latency.
  assert.doesNotMatch(text, /\[\[PDF:/);
  assert.doesNotMatch(text, /memory\.upsert/);
  assert.doesNotMatch(text, /Agent tool/i);
  assert.doesNotMatch(text, /知识库/);
});

test('the learning preferences the user configured are passed through, last', () => {
  const text = joined(prompts.buildSentenceTranslationMessages(start({
    preferenceBlock: '译文使用更口语的表达，并保留英文术语。',
  })));
  assert.match(text, /译文使用更口语的表达/);
  assert.ok(
    text.indexOf('译文使用更口语的表达') > text.indexOf('只输出译文'),
    'the preference block comes after the fixed rules, so it can refine them',
  );
});

test('the two tasks are dispatched by the message, not by the caller', () => {
  const translation = joined(prompts.buildTranslationStreamMessages(start()));
  const keywords = joined(prompts.buildTranslationStreamMessages(start({ task: 'keywords' })));
  assert.match(translation, /只输出译文/);
  assert.match(keywords, /重点词/);
  assert.notEqual(translation, keywords);
});

test('the ceilings leave room for a model whose thinking cannot be switched off', () => {
  // They are caps, not targets — but too small a cap truncates the answer on providers that bill reasoning against the
  // same `max_tokens`. 512/768 produced a translation cut off mid-sentence and "没有返回有效 JSON" for the words.
  assert.ok(prompts.TRANSLATION_STREAM_MAX_TOKENS >= 2_048);
  assert.ok(prompts.KEYWORD_STREAM_MAX_TOKENS >= 2_048);
  assert.ok(prompts.KEYWORD_STREAM_MAX_TOKENS >= prompts.TRANSLATION_STREAM_MAX_TOKENS);
  assert.equal(prompts.MAX_SENTENCE_KEYWORDS, 6);
});

test('maths detection only fires where a rebuild would help', () => {
  // Kept in the viewer: it decides what to ask for.
  assert.equal(viewerStream.sentenceNeedsLatex('a plain English sentence'), false);
  assert.equal(viewerStream.sentenceNeedsLatex('the additive complexity $E^s$ of the function'), true);
  assert.equal(viewerStream.sentenceNeedsLatex('a set A ∩ B such that A ⊆ B'), true);
  assert.equal(viewerStream.sentenceNeedsLatex('the ratio α/β stays under 1'), true);
});

console.log('Translation prompt tests passed.');
