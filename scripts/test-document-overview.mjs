import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const compile = async path => ts.transpileModule(await readFile(new URL(`../src/${path}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(code, dependencies = {}) {
  const exports = {};
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Missing dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const contracts = load(await compile('modules/ai/contracts'));
const errors = load(await compile('modules/ai/providers/provider-error'));
const moonshot = load(await compile('modules/ai/providers/moonshot-reasoning'));
const rateLimit = load(await compile('modules/ai/providers/provider-rate-limit'), { '../contracts': contracts, './provider-error': errors });
let now = 0;
const requestWithRateLimit = rateLimit.createRateLimitedRequester({ now: () => now, wait: async ms => { now += ms; } });
const { DeepSeekProviderAdapter } = load(await compile('modules/ai/providers/deepseek-provider'), {
  '../contracts': contracts, './provider-error': errors, './moonshot-reasoning': moonshot,
  './provider-rate-limit': { ...rateLimit, requestWithRateLimit },
});
const completion = load(await compile('background/ai/overview-completion'), { '../../modules/ai/public': errors });
/** The tools client is replaced by a scripted fake: this suite is about the pipeline, not HTTP. */
const toolsClient = {
  MAX_CONTENT_CHARS: 6000,
  addUsage: (usage, field) => ({ ...usage, [field]: usage[field] + 1 }),
  describeWebRetrievalError: error => String(error?.message ?? error),
  searchWeb: async () => [],
  fetchPage: async () => ({ title: '', content: '' }),
};
const related = load(await compile('background/ai/related-literature-service'), {
  './overview-completion': completion,
  './deepseek-tools-client': toolsClient,
});
const service = load(await compile('background/ai/document-overview-service'), {
  './overview-completion': completion, './related-literature-service': related,
});
const config = { ...contracts.DEFAULT_AI_CONFIG, providerId: 'openai-compatible',
  apiKey: 'test-only-placeholder', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', reasoning: 'enabled' };
const adapter = new DeepSeekProviderAdapter('openai-compatible');
const bookOverview = '<!-- pdfpal-document-type: book -->\n# 测试书籍\n\n## 核心内容\n这是完整概览。';
const input = { documentName: 'Fixture.pdf', pageCount: 225, text: '[第 1 页]\nPDF sample.' };
async function mockFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('Kimi overview requests disable optional thinking without changing chat preferences', async () => {
  await mockFetch(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.ok(body.max_tokens >= 8192);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: bookOverview } }] });
  }, async () => {
    assert.equal((await service.generateDocumentOverview(adapter, config, input)).content, bookOverview);
    assert.equal(config.reasoning, 'enabled');
  });
});

test('HTTP 200 with reasoning-only truncation retries once with a larger budget', async () => {
  const budgets = [];
  await mockFetch(async (_, init) => {
    const body = JSON.parse(init.body);
    budgets.push(body.max_tokens);
    assert.equal(body.thinking, undefined, 'K2.7 Code must not receive an unsupported disable flag');
    return Response.json({ choices: [{ finish_reason: budgets.length === 1 ? 'length' : 'stop',
      message: budgets.length === 1 ? { content: '', reasoning_content: 'reasoning' } : { content: bookOverview } }] });
  }, async () => {
    const result = await service.generateDocumentOverview(adapter, { ...config, model: 'kimi-k2.7-code' }, input);
    assert.equal(result.content, bookOverview);
    assert.deepEqual(budgets, [8192, 16384]);
  });
});

test('partial Markdown with finish_reason length is not silently saved as complete', async () => {
  let calls = 0;
  await mockFetch(async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: 'length', message: { content: '# unfinished' } }] });
  }, async () => {
    await assert.rejects(service.generateDocumentOverview(adapter, config, input), /截断/);
    assert.equal(calls, 2);
  });
});

test('persistent rate limits stop after bounded cooldown retries, without token-budget retries', async () => {
  let calls = 0;
  await mockFetch(async () => {
    calls++;
    return Response.json({ error: { message: 'rate limit' } }, { status: 429 });
  }, async () => {
    await assert.rejects(service.generateDocumentOverview(adapter, config, input), /429/);
    assert.equal(calls, 4);
  });
});

test('context fallback retries a rate-limited final merge without redoing summaries', async () => {
  const requests = [];
  await mockFetch(async (_, init) => {
    const body = JSON.parse(init.body);
    requests.push({ text: body.messages.at(-1).content, at: now });
    if (requests.length === 1) return Response.json({ error: { message: 'context_length_exceeded' } }, { status: 400 });
    if (requests.length === 4) {
      return Response.json({ error: { type: 'rate_limit_reached_error',
        message: 'request reached organization max RPM: 3, please try again after 1 seconds' } }, { status: 429 });
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: bookOverview } }] });
  }, async () => {
    const text = Array.from({ length: 6 }, (_, i) => `[第 ${i + 1} 页]\n${'source '.repeat(1000)}`).join('\n\n');
    const result = await service.generateDocumentOverview(adapter, config, { ...input, text });
    assert.equal(result.content, bookOverview);
    assert.equal(requests.length, 5);
    assert.equal(requests[3].text, requests[4].text, 'retry exactly the failed batch');
    assert.ok(requests[4].at - requests[3].at >= 61000);
  });
});

test('long documents use one overview request when the provider accepts the input', async () => {
  let calls = 0;
  await mockFetch(async (_, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.ok(body.max_tokens >= 8192);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: bookOverview } }] });
  }, async () => {
    const text = Array.from({ length: 6 }, (_, index) => `[第 ${index + 1} 页]\n${'source '.repeat(1000)}`).join('\n\n');
    await service.generateDocumentOverview(adapter, config, { ...input, text });
    assert.equal(calls, 1);
  });
});

test('successful partials are published before a later request fails', async () => {
  let calls = 0;
  const progress = [];
  const text = Array.from({ length: 6 }, (_, i) => `[第 ${i + 1} 页]\n${'source '.repeat(1000)}`).join('\n\n');
  const failingAdapter = { chat: async () => {
    if (++calls === 1) throw Error('context_length_exceeded');
    if (calls === 4) throw Error('HTTP 429');
    return { content: `Summary ${calls - 1}`, model: 'fixture' };
  } };
  await assert.rejects(service.generateDocumentOverview(failingAdapter, config, { ...input, text }, async p => { progress.push(p); }), /429/);
  assert.equal(progress.length, 2);
  assert.match(progress[1].content, /Summary 1[\s\S]*Summary 2/);
  assert.match(progress[1].content, /尚未整合/);
  assert.equal(progress[1].complete, false);
});

test('all providers try one complete overview and respect larger configured output budgets', async () => {
  for (const model of ['kimi-k2.6', 'deepseek-v4-flash', 'qwen', 'custom-model']) {
    const requests = [];
    const single = { chat: async (_, messages, budget) => {
      requests.push({ messages, budget }); return { content: bookOverview, model };
    } };
    const text = `FIRST ${'正文内容'.repeat(12000)} LAST`;
    await service.generateDocumentOverview(single, { ...config, model, maxOutputTokens: 32768 }, { ...input, text });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].budget, 32768);
    assert.ok(requests[0].messages.at(-1).content.includes(text));
  }
});

test('context fallback progressively reduces oversized pages without losing their tail', async () => {
  const accepted = [];
  const smallModel = { chat: async (_, messages) => {
    const material = messages.at(-1).content;
    if (material.length > 8000) throw Error('maximum context length exceeded');
    if (material.includes('片段批次')) accepted.push(material.split(/片段批次 \d+\/\d+：\n/)[1]);
    return { content: 'A short summary', model: 'small-context' };
  } };
  await service.generateDocumentOverview(smallModel, config, { ...input, text: `START ${'x'.repeat(30000)} ENDTAIL` });
  const combined = accepted.filter(Boolean).join('');
  assert.ok(combined.startsWith('START'));
  assert.ok(combined.endsWith('ENDTAIL'));
  assert.equal([...combined].filter(c => c === 'x').length, 30000);
});

// ---------------------------------------------------------------------------
// 「相关论文」：built on demand, from two sources, and billed by call.
//
// It used to be appended during overview generation. It is now a button, because it spends a retrieval call plus a
// model call — so the rules that matter are: which source answered, what it cost, and what happens when one of them
// fails.
// ---------------------------------------------------------------------------
const paperOverview = '<!-- pdfpal-document-type: paper -->\n# A New Combinational Logic Minimization Technique\n\n概览正文。';
const webConfig = { baseUrl: 'https://api.deepseek.com/v1/tools', apiKey: 'key', count: 8, maxFetches: 1 };
const sectionReply = '## 相关论文\n\n### Other work\n简介。\n\n**与当前论文的关系：** 同一问题的另一解法。';

/** Runs `run` with the tools client wired to the given scripts. */
async function withTools({ search = [], fetchPage: fetchImpl, fail }, run) {
  const calls = { search: [], fetch: [] };
  const client = {
    ...toolsClient,
    searchWeb: async (config, options) => {
      calls.search.push(options);
      if (fail) throw fail;
      const script = typeof search === 'function' ? search(options, calls) : search;
      return script;
    },
    fetchPage: async (config, url) => {
      calls.fetch.push(url);
      if (fetchImpl) return fetchImpl(url);
      return { title: '', content: '' };
    },
  };
  const module = load(await compile('background/ai/related-literature-service'), {
    './overview-completion': completion,
    './deepseek-tools-client': client,
  });
  return run(module, calls);
}

const hit = (title, extra = {}) => ({
  title, url: `https://example.org/${encodeURIComponent(title)}`,
  snippet: '片段', summary: `${title} 的摘要`, content: '', siteName: 'Example',
  date: '2025-03-01T00:00:00+00:00', authority: 3, rerankScore: 2.1, source: 'deepseek', ...extra,
});

/** A model stub that records the prompt and answers with a 「相关论文」 section. */
function modelStub(record = {}) {
  return { chat: async (_, messages) => {
    record.messages = messages;
    return { content: sectionReply, model: 'stub' };
  } };
}

test('a non-paper document has no related-paper section to build', async () => {
  await withTools({}, async (module) => {
    const result = await module.buildRelatedLiteratureSection(modelStub(), config, {
      documentName: 'book.pdf', overviewMarkdown: bookOverview, webRetrieval: webConfig,
    });
    assert.equal(result.markdown, '');
    assert.match(result.degraded, /不是学术论文/);
  });
});

test('web search supplies the candidates and the body, in one request', async () => {
  const search = [hit('Related A', { content: 'A 的正文' }), hit('Related B'), hit('Related C'),
    hit('A New Combinational Logic Minimization Technique', { url: 'https://example.org/self' })];
  await withTools({ search, fetchPage: () => ({ title: '', content: '补抓的正文' }) }, async (module, calls) => {
    const record = {};
    const result = await module.buildRelatedLiteratureSection(modelStub(record), config, {
      documentName: 'fixture.pdf', overviewMarkdown: paperOverview, webRetrieval: webConfig,
    });
    // One search request, asking for page bodies: that is what turns three calls into one.
    assert.equal(calls.search.length, 1, 'one search, one request');
    assert.equal(calls.search[0].needContent, true, 'the bodies are asked for in the same request');
    assert.equal(result.usage.searchCalls, 1);
    assert.deepEqual(result.sources.includes('deepseek'), true);
    assert.match(result.markdown, /^## 相关论文/);
    assert.equal(result.degraded, '');

    // The paper's own page is not a related paper.
    const prompt = record.messages.at(-1).content;
    assert.doesNotMatch(prompt, /example\.org\/self/, 'the current paper must be filtered out');
    // Only the candidates without a body are fetched, and only up to the configured limit.
    assert.deepEqual(calls.fetch, [hit('Related B').url], 'exactly one补抓, for the candidate with no body');
    assert.equal(result.usage.fetchCalls, 1);
  });
});

test('a search failure degrades to OpenAlex and says so', async () => {
  await mockFetch(async (url) => {
    assert.match(String(url), /api\.openalex\.org/);
    return Response.json({ results: [{
      id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1/x',
      display_name: 'OpenAlex Related', publication_year: 2024, cited_by_count: 12,
      authorships: [{ author: { display_name: 'A. Author' } }],
      abstract_inverted_index: { Hello: [0], world: [1] },
    }] });
  }, async () => {
    await withTools({ fail: Object.assign(new Error('余额不足（HTTP 402）'), {}) }, async (module) => {
      const result = await module.buildRelatedLiteratureSection(modelStub(), config, {
        documentName: 'fixture.pdf', overviewMarkdown: paperOverview, webRetrieval: webConfig,
      });
      assert.deepEqual(result.sources, ['openalex'], 'the free source still answered');
      assert.match(result.markdown, /^## 相关论文/);
      assert.match(result.degraded, /余额不足/);
      assert.equal(result.usage.searchCalls, 0, 'a failed request is not counted as a paid call');
    });
  });
});

test('without a web configuration the section comes from OpenAlex alone', async () => {
  await mockFetch(async () => Response.json({ results: [{
    id: 'https://openalex.org/W2', display_name: 'Free Source Work',
    publication_year: 2023, cited_by_count: 3, authorships: [],
  }] }), async () => {
    await withTools({}, async (module, calls) => {
      const result = await module.buildRelatedLiteratureSection(modelStub(), config, {
        documentName: 'fixture.pdf', overviewMarkdown: paperOverview, webRetrieval: null,
      });
      assert.equal(calls.search.length, 0, 'no key, no call');
      assert.deepEqual(result.sources, ['openalex']);
      assert.deepEqual(result.usage, { searchCalls: 0, fetchCalls: 0 });
    });
  });
});

test('a thin answer is widened with a second query; a rich one is not', async () => {
  await mockFetch(async () => Response.json({ results: [] }), async () => {
    await withTools({
      search: (options, calls) => (calls.search.length === 1 ? [] : [hit('Widened A'), hit('Widened B'), hit('Widened C')]),
    }, async (module, calls) => {
      const result = await module.buildRelatedLiteratureSection(modelStub(), config, {
        documentName: 'fixture.pdf', overviewMarkdown: paperOverview, webRetrieval: webConfig,
      });
      assert.equal(calls.search.length, 2, 'an empty result is free, so widening costs nothing');
      assert.match(calls.search[1].query, /相关工作/, 'the second query is topic-oriented');
      assert.equal(result.usage.searchCalls, 2);
      assert.deepEqual(result.sources, ['deepseek']);
    });
  });
});

test('candidate ranking is deterministic and drops noise before the model sees it', () => {
  const ranked = related.rankRelatedCandidates([
    hit('Low relevance', { rerankScore: 0.4 }),
    hit('Authoritative recent', { rerankScore: 1.6, authority: 4, date: '2026-01-01T00:00:00+00:00' }),
    hit('Plain', { rerankScore: 1.6, authority: 0, date: '2010-01-01T00:00:00+00:00' }),
    hit('Plain', { rerankScore: 2.9 }),
    { ...hit('OpenAlex entry'), source: 'openalex', rerankScore: 0, citedByCount: 900 },
  ], 'Some paper', Date.UTC(2026, 5, 1));
  const titles = ranked.map((candidate) => candidate.title);
  // A well-cited OpenAlex record outranks a merely relevant web page; authority and recency break the tie among
  // web hits. The order has to be stable without a model in the loop.
  assert.deepEqual(titles, ['OpenAlex entry', 'Authoritative recent', 'Plain'], `unexpected order: ${titles}`);
  assert.equal(titles.includes('Low relevance'), false, 'a weak hit is not a candidate');
});

let server, browser, page, origin;
const browserSources = await Promise.all([
  'modules/knowledge/adapters/browser-document-corpus',
  'viewer/features/knowledge-base/knowledge-overview-background-task',
  'viewer/features/knowledge-base/knowledge-pdf-overview',
  'modules/knowledge/application/document-overview',
  'viewer/features/knowledge-base/knowledge-related-papers',
].map(compile));
before(async () => {
  const fixture = await readFile(new URL('../src/viewer/templates/knowledge-base-overlays.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/viewer/features/knowledge-base/pdf-overview.css', import.meta.url), 'utf8');
  server = createServer((_, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<style>${css}</style>${fixture}`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve) ?? resolve());
});
async function setupBrowser(status = 'generating', markdown = '') {
  await page?.close();
  page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(({ sources, status, markdown }) => {
    const load = (code, dependencies = {}) => {
      const exports = {};
      new Function('require', 'exports', code)(name => {
        if (!(name in dependencies)) throw Error(`Missing dependency: ${name}`);
        return dependencies[name];
      }, exports);
      return exports;
    };
    localStorage.clear();
    window.repo = load(sources[0]);
    repo.addKnowledgeDocument({ documentId: 'book', documentName: 'Test book.pdf', pageCount: 2 });
    repo.updateKnowledgeDocument('book', { overviewStatus: status, overviewMarkdown: markdown });
    window.pending = [];
    window.relatedRequests = [];
    window.relatedResponse = null;
    window.appState = { webRetrievalConfig: { value: null } };
    window.progressListeners = new Set();
    window.emitProgress = message => { for (const listener of progressListeners) listener(message); };
    window.tasks = load(sources[1], {
      'wxt/browser': { browser: { runtime: {
        sendMessage: request => new Promise(resolve => pending.push({ request, resolve })),
        onMessage: { addListener: fn => progressListeners.add(fn), removeListener: fn => progressListeners.delete(fn) },
      } } },
      '../../core/pdf-reader/public': { MAX_PAPER_CARD_SOURCE_LENGTH: 52000 },
      './knowledge-corpus-repository': repo,
    });
    window.view = load(sources[2], {
      '../../../modules/knowledge/public': load(sources[3], { '../adapters/browser-document-corpus': repo }),
      // 检索相关论文 lives on the card, but the dialog asks this module two things: is a search running, and (in one
      // test) its availability rule. Same instance for both.
      './knowledge-related-papers': (window.related = load(sources[4], {
        'wxt/browser': { browser: { runtime: { sendMessage: async (request) => {
          window.relatedRequests.push(request);
          return window.relatedResponse ?? { ok: false, error: 'no response scripted' };
        } } } },
        '../../app/public': window.appState,
        '../../../modules/knowledge/public': load(sources[3], { '../adapters/browser-document-corpus': repo }),
      })),
      '../../app/viewer-state': { pdfDocument: { value: { numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Page text' }] }) }) } } },
      // Web retrieval availability and the on-demand 「相关论文」 request both go through these two.
      '../../app/public': window.appState,
      'wxt/browser': { browser: { runtime: { sendMessage: async (request) => {
        window.relatedRequests.push(request);
        return window.relatedResponse ?? { ok: false, error: 'no response scripted' };
      } } } },
      '../../shared-ui/markdown/markdown-renderer': { renderChatMarkdown: (element, value) => { element.textContent = value; } },
      '../../shared-ui/dialog/dialog-motion': { showAnimatedDialog: dialog => dialog.showModal(), dismissAnimatedDialog: dialog => dialog.close() },
      '../../shared-ui/navigation/source-pdf-navigation': { ensureSourcePdfOpen: async () => true },
      './knowledge-corpus-repository': repo, './knowledge-base-controller': {},
      './knowledge-overview-background-task': tasks,
    });
    window.taskInput = { documentId: 'book', documentName: 'Test book.pdf', pageCount: 2, pages: [{ pageNumber: 1, text: 'Sample' }] };
    view.registerKnowledgePdfOverviewEvents();
  }, { sources: browserSources, status, markdown });
}

// 「相关论文」 in the dialog: it is appended to the overview body, and the button that produces it lives on the card.
test('the dialog renders the saved related papers inside the overview body, once', async () => {
  // The overview *stored* by an older version already ends with a 「相关论文」 section (usually the failure note).
  // Rendering that and the retrieved one put two headings in one dialog — the user's screenshot.
  const storedOverview = '# Saved overview\n\n正文。\n\n## 相关论文\n\n> 暂时未能完成在线相关论文检索，可以稍后重新生成 PDF 概览。\n';
  await setupBrowser('ready', storedOverview);
  await page.evaluate(() => {
    repo.updateKnowledgeDocument('book', {
      relatedLiteratureMarkdown: '## 相关论文\n\n### Other work\n简介。',
      relatedLiteratureUsage: { searchCalls: 1, fetchCalls: 1 },
      relatedLiteratureSources: ['deepseek', 'openalex'],
      relatedLiteratureAt: '2026-06-01T10:00:00.000Z',
    });
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });

  const body = await page.locator('#knowledge-overview-content').textContent();
  assert.match(body, /Other work/, 'the retrieved section is shown');
  assert.doesNotMatch(body, /暂时未能完成/, 'the stale auto-generated section is not repeated');
  assert.equal(
    (body.match(/相关论文/g) ?? []).length,
    1,
    `one 「相关论文」 heading, got: ${body}`,
  );
  assert.match(
    await page.locator('#knowledge-overview-content').textContent(),
    /DeepSeek 联网检索 \+ OpenAlex · 联网调用 1 次搜索 \+ 1 次抓取/,
    'what it cost is on screen',
  );
  // The paid action belongs to the card; a second button here is what made the dialog look like two documents.
  assert.equal(await page.locator('#knowledge-overview-related-search').count(), 0);
});

test('the legacy-section stripper only removes that one section', async () => {
  await setupBrowser('ready', '# Saved overview');
  const stripped = await page.evaluate(() => ({
    section: view.stripLegacyRelatedSection(
      '# Title\n\n## 方法\n方法正文。\n\n## 相关论文\n\n> 暂时未能完成在线相关论文检索。\n\n## 可以继续问什么\n1. 问题\n',
    ),
    untouched: view.stripLegacyRelatedSection('# Title\n\n没有相关小节。'),
  }));
  assert.match(stripped.section, /## 方法/);
  assert.match(stripped.section, /## 可以继续问什么/, 'the heading after it survives');
  assert.doesNotMatch(stripped.section, /相关论文/);
  assert.equal(stripped.untouched, '# Title\n\n没有相关小节。', 'an overview without the section is untouched');
});

test('the related-paper entry point hides itself while the overview has nothing to search from', async () => {
  await setupBrowser('pending', '');
  const states = await page.evaluate(async () => {
    const related = window.related;
    const item = repo.getKnowledgeDocument('book');
    const withoutKey = related.relatedPapersAvailability(item);
    appState.webRetrievalConfig.value = {
      baseUrl: 'https://api.deepseek.com/v1/tools', apiKey: 'k', count: 8, maxFetches: 1,
    };
    const withoutOverview = related.relatedPapersAvailability(item);
    repo.updateKnowledgeDocument('book', { overviewMarkdown: '# Saved overview' });
    const ready = related.relatedPapersAvailability(repo.getKnowledgeDocument('book'));
    return { withoutKey, withoutOverview, ready };
  });
  assert.equal(states.withoutKey.available, false);
  assert.match(states.withoutKey.reason, /DeepSeek API Key/);
  assert.equal(states.withoutOverview.available, false);
  assert.match(states.withoutOverview.reason, /概览/, 'a paper with no overview has nothing to search from');
  assert.equal(states.ready.available, true);
  assert.match(states.ready.reason, /0\.005/, 'the tooltip states the price');
  assert.equal(
    await page.evaluate(() => relatedRequests.length),
    0,
    'nothing is requested until the user asks',
  );
});

test('background success is saved and displayed in an already open overview dialog', async () => {  await setupBrowser();
  await page.evaluate(() => {
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput);
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });
  await page.evaluate(async () => { pending[0].resolve({ ok: true, content: '# Saved overview' }); await job; });
  assert.match(await page.locator('#knowledge-overview-content').textContent(), /Saved overview/);
  assert.equal(await page.locator('#knowledge-overview-regenerate').isEnabled(), true);
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewStatus), 'ready');
});

test('background failure updates the open dialog and preserves a previous overview', async () => {
  await setupBrowser('ready', '# Previous overview');
  await page.evaluate(() => {
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput).catch(() => {});
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });
  await page.evaluate(async () => { pending[0].resolve({ ok: false, error: '模型只返回了思考过程，没有返回正文。' }); await job; });
  assert.match(await page.locator('#knowledge-overview-status').textContent(), /思考过程/);
  assert.match(await page.locator('#knowledge-overview-content').textContent(), /Previous overview/);
  assert.equal(await page.locator('#knowledge-overview-regenerate').isEnabled(), true);
});

test('stale generating state after refresh permits an explicit retry', async () => {
  await setupBrowser();
  await page.evaluate(() => view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book')));
  assert.equal(await page.locator('#knowledge-overview-regenerate').isEnabled(), true);
  assert.match(await page.locator('#knowledge-overview-status').textContent(), /未检测到/);
  await page.locator('#knowledge-overview-regenerate').click();
  await page.waitForFunction(() => pending.length === 1);
  await page.evaluate(() => pending[0].resolve({ ok: true, content: '# Recovered overview' }));
  await page.waitForFunction(() => document.getElementById('knowledge-overview-content').textContent.includes('Recovered overview'));
});

test('duplicate requests share one job, and a superseded response cannot overwrite newer saved content', async () => {
  await setupBrowser();
  await page.evaluate(() => {
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput);
    window.sameJob = tasks.generateAndSaveKnowledgeOverview(taskInput);
  });
  assert.equal(await page.evaluate(() => job === sameJob && pending.length === 1), true);
  await page.evaluate(async () => {
    repo.updateKnowledgeDocument('book', { overviewRequestId: 'new-request', overviewStatus: 'ready', overviewMarkdown: '# Newer overview' });
    pending[0].resolve({ ok: true, content: '# Old overview' });
    await job;
  });
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewMarkdown), '# Newer overview');
});

test('intermediate summaries are kept internally and never displayed as an overview', async () => {
  await setupBrowser();
  await page.evaluate(() => {
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput).catch(() => {});
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });
  await page.evaluate(() => emitProgress({ type: 'pdf-helper:ai-document-overview-progress', requestId: pending[0].request.requestId,
    content: '# 分段摘要（尚未整合）\nFirst and second partials', message: '正在阅读文档（50%）', complete: false }));
  assert.doesNotMatch(await page.locator('#knowledge-overview-content').textContent(), /First and second|分段|批次/);
  assert.match(await page.locator('#knowledge-overview-status').textContent(), /50%/);
  await page.evaluate(async () => { pending[0].resolve({ ok: false, error: 'HTTP 429' }); await job; });
  assert.doesNotMatch(await page.locator('#knowledge-overview-content').textContent(), /First and second|分段|批次/);
  assert.match(await page.locator('#knowledge-overview-status').textContent(), /429/);
  assert.equal(await page.evaluate(() => progressListeners.size), 0);
  await page.reload();
  assert.match(await page.evaluate(() => localStorage.getItem('pdf-helper-knowledge-corpus-v1')), /First and second/);
});

test('old partial caches stay hidden in preview and editor; a completed overview can display immediately', async () => {
  await setupBrowser('ready', '# Previous complete overview');
  await page.evaluate(() => {
    repo.updateKnowledgeDocument('book', { overviewDraftMarkdown: '# 分段摘要\n## 片段批次 1' });
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput);
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });
  assert.equal(await page.locator('#knowledge-overview-content').textContent(), '# Previous complete overview');
  await page.locator('#knowledge-overview-edit').click();
  assert.equal(await page.locator('#knowledge-overview-markdown').inputValue(), '# Previous complete overview');
  await page.locator('#knowledge-overview-cancel-edit').click();
  await page.evaluate(() => emitProgress({ type: 'pdf-helper:ai-document-overview-progress', requestId: pending[0].request.requestId,
    content: '# New complete overview', message: '概览正文已生成', complete: true }));
  assert.equal(await page.locator('#knowledge-overview-content').textContent(), '# New complete overview');
  await page.evaluate(async () => { pending[0].resolve({ ok: true, content: '# New complete overview' }); await job; });
});

test('edit, preview and save persist content after closing and reopening', async () => {
  await setupBrowser('ready', '# Original');
  await page.evaluate(() => view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book')));
  await page.locator('#knowledge-overview-edit').click();
  await page.locator('#knowledge-overview-markdown').fill('# My edited overview\n\n- My notes');
  await page.locator('#knowledge-overview-preview').click();
  assert.match(await page.locator('#knowledge-overview-content').textContent(), /My notes/);
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewMarkdown), '# Original');
  await page.locator('#knowledge-overview-save').click();
  await page.locator('#knowledge-overview-done').click();
  await page.evaluate(() => view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book')));
  assert.match(await page.locator('#knowledge-overview-content').textContent(), /My edited overview/);
  assert.match(await page.evaluate(() => localStorage.getItem('pdf-helper-knowledge-corpus-v1')), /My notes/);
});

test('background progress and completion cannot clobber an editor or a manually saved overview', async () => {
  await setupBrowser('ready', '# Original');
  await page.evaluate(() => {
    window.job = tasks.generateAndSaveKnowledgeOverview(taskInput);
    view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book'));
  });
  await page.locator('#knowledge-overview-edit').click();
  await page.locator('#knowledge-overview-markdown').fill('# My draft');
  await page.evaluate(() => emitProgress({ type: 'pdf-helper:ai-document-overview-progress', requestId: pending[0].request.requestId,
    content: '# AI partial', message: '2/6', complete: false }));
  assert.equal(await page.locator('#knowledge-overview-markdown').inputValue(), '# My draft');
  await page.locator('#knowledge-overview-save').click();
  await page.evaluate(async () => {
    emitProgress({ type: 'pdf-helper:ai-document-overview-progress', requestId: pending[0].request.requestId,
      content: '# Late partial', message: '3/6', complete: false });
    pending[0].resolve({ ok: true, content: '# AI final' }); await job;
  });
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewMarkdown), '# My draft');
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewDraftMarkdown), undefined);
  assert.equal(await page.locator('#knowledge-overview-content').textContent(), '# My draft');
});

test('cancel discards edits, closing retains an unsaved draft, and empty saves are rejected', async () => {
  await setupBrowser('ready', '# Original');
  await page.evaluate(() => view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book')));
  await page.locator('#knowledge-overview-edit').click();
  await page.locator('#knowledge-overview-markdown').fill('# Unsaved');
  await page.locator('#knowledge-overview-close').click();
  await page.evaluate(() => view.openKnowledgePdfOverview(repo.getKnowledgeDocument('book')));
  assert.equal(await page.locator('#knowledge-overview-markdown').inputValue(), '# Unsaved');
  await page.locator('#knowledge-overview-cancel-edit').click();
  assert.equal(await page.locator('#knowledge-overview-content').textContent(), '# Original');
  await page.locator('#knowledge-overview-edit').click();
  await page.locator('#knowledge-overview-markdown').fill(' ');
  await page.locator('#knowledge-overview-save').click();
  assert.match(await page.locator('#knowledge-overview-status').textContent(), /请填写/);
  assert.equal(await page.evaluate(() => repo.getKnowledgeDocument('book').overviewMarkdown), '# Original');
  await page.locator('#knowledge-overview-markdown').fill('# PDF 阅读笔记\n\n## 核心观点\n- 可以自由修改和补充概览。\n- 保存后会保留在知识库中。');
  await page.screenshot({ path: '.output/overview-edit-preview.png' });
});
