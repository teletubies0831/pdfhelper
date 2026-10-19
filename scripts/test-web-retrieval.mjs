import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

/**
 * DeepSeek's Search / Fetch tools, and the settings that point at them.
 *
 * The API documents three things this feature depends on and cannot check at runtime: billing is per successful
 * request (so an empty answer is free and `count` changes nothing), only 408/429/5xx are worth retrying, and each
 * error code means something different to the user. All three are asserted here against scripted responses, so the
 * mapping is pinned to the documentation rather than to whatever a live call happens to return.
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

const contracts = load(await compile('modules/ai/contracts'));
const domain = load(await compile('modules/ai/domain/ai-connection'), {
  '../contracts': contracts,
});
const tools = load(await compile('background/ai/deepseek-tools-client'));
const catalogModule = load(await compile('modules/ai/application/ai-connection-catalog'), {
  '../contracts': contracts,
  '../domain/ai-connection': domain,
});

const config = {
  baseUrl: 'https://api.deepseek.com/v1/tools',
  apiKey: 'sk-test',
  count: 8,
  maxFetches: 1,
};

/** Replaces `fetch` for the duration of `run`, recording every request. */
async function mockFetch(handler, run) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    return handler(String(url), init, requests.length);
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = original;
  }
}

const searchPayload = (results) => Response.json({ results });

test('a search is one POST to <base>/search, with the bodies asked for in the same request', async () => {
  await mockFetch((url) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/search');
    return searchPayload([{
      rerank_score: 2.4, title: 'Paper A', url: 'https://example.org/a',
      snippet: 'short', summary: 'long summary', content: 'body',
      site_name: 'Example', site_icon: null, date: '2026-06-01T00:00:00+00:00', authority: 3,
    }, { title: '', url: 'https://example.org/no-title' }]);
  }, async (requests) => {
    const hits = await tools.searchWeb(config, {
      query: 'a title', count: 8, needContent: true, oriQuestion: 'what is related',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, 'Bearer sk-test');
    assert.equal(requests[0].body.need_content, true, 'page bodies in the same request: billing is per request');
    assert.equal(requests[0].body.ori_question, 'what is related');
    // A hit without a title or a URL is not a result.
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      title: 'Paper A', url: 'https://example.org/a', snippet: 'short', summary: 'long summary',
      content: 'body', siteName: 'Example', date: '2026-06-01T00:00:00+00:00',
      authority: 3, rerankScore: 2.4,
    });
  });
});

test('count is clamped to the documented 1–50 and an empty answer is not an error', async () => {
  await mockFetch(() => searchPayload([]), async (requests) => {
    assert.deepEqual(await tools.searchWeb(config, { query: 'x', count: 999 }), []);
    assert.equal(requests[0].body.count, 50);
    assert.equal(requests[0].body.need_content, false, 'the body is opt-in');
    assert.deepEqual(await tools.searchWeb(config, { query: 'x', count: 0 }), []);
    assert.equal(requests[1].body.count, 1);
    // No results also means no charge, so the caller may retry with another query for free.
    assert.equal(requests.length, 2);
  });
});

test('an oversized page body is truncated at parse time', async () => {
  await mockFetch(() => searchPayload([{
    title: 'Huge', url: 'https://example.org/huge', content: 'x'.repeat(50_000),
  }]), async () => {
    const [hit] = await tools.searchWeb(config, { query: 'x', count: 1, needContent: true });
    assert.equal(hit.content.length, tools.MAX_CONTENT_CHARS);
  });
});

test('the error codes mean what the documentation says they mean', async () => {
  const cases = [
    { status: 400, failure: 'request', retryable: false },
    { status: 401, failure: 'auth', retryable: false },
    { status: 402, failure: 'balance', retryable: false },
    { status: 403, failure: 'blocked', retryable: false },
    { status: 404, failure: 'unavailable', retryable: false },
    { status: 504, failure: 'server', retryable: true },
  ];
  for (const expected of cases) {
    await mockFetch(() => Response.json(
      { error: { message: 'boom', type: 'invalid_request_error', param: null } },
      { status: expected.status },
    ), async (requests) => {
      await assert.rejects(
        () => tools.searchWeb(config, { query: 'x', count: 1 }),
        (error) => {
          assert.equal(error.name, 'WebRetrievalError');
          assert.equal(error.failure, expected.failure, `HTTP ${expected.status} classified as ${error.failure}`);
          assert.equal(error.httpStatus, expected.status);
          assert.equal(error.retryable, expected.retryable);
          return true;
        },
      );
      // A 5xx is retried exactly once; the terminal 4xx answers are not retried at all.
      assert.equal(requests.length, expected.retryable ? 2 : 1, `HTTP ${expected.status} retried incorrectly`);
    });
  }
});

test('a transient failure that clears on the retry is not reported as an error', async () => {
  await mockFetch((url, init, attempt) => (attempt === 1
    ? Response.json({ error: { message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '0' } })
    : searchPayload([{ title: 'Recovered', url: 'https://example.org/r' }])), async (requests) => {
    const hits = await tools.searchWeb(config, { query: 'x', count: 1 });
    assert.equal(requests.length, 2);
    assert.equal(hits[0].title, 'Recovered');
  });
});

test('fetch returns the Markdown body and treats a page without one as unavailable', async () => {
  await mockFetch((url) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/fetch');
    return Response.json({ title: 'Example', content: '# Example\n\nBody' });
  }, async (requests) => {
    const page = await tools.fetchPage(config, 'https://example.org/page');
    assert.equal(requests[0].body.url, 'https://example.org/page');
    assert.deepEqual(page, { title: 'Example', content: '# Example\n\nBody' });
  });

  await mockFetch(() => Response.json({ title: 'Example', content: '' }), async () => {
    await assert.rejects(
      () => tools.fetchPage(config, 'https://example.org/empty'),
      (error) => error.failure === 'unavailable' && error.retryable === false,
    );
  });
});

test('the user-facing wording names the cause, not the status code alone', () => {
  const message = (status, failure, retryable) => tools.describeWebRetrievalError(
    new tools.WebRetrievalError(`HTTP ${status}`, failure, status, retryable),
  );
  assert.match(message(401, 'auth', false), /API Key/, 'a wrong key is the most common cause');
  assert.match(message(402, 'balance', false), /余额不足/);
  assert.match(message(429, 'rate-limit', true), /限流/);
  assert.match(message(504, 'server', true), /暂时不可用/);
  assert.doesNotMatch(message(402, 'balance', false), /undefined/);
});

test('the tools settings default the address and clamp the numbers', () => {
  const defaults = catalogModule.normalizeWebRetrievalSettings(undefined);
  assert.equal(defaults.baseUrl, 'https://api.deepseek.com/v1/tools', 'a DeepSeek key is enough to start');
  assert.equal(defaults.apiKey, '');
  assert.equal(defaults.count, 8);
  assert.equal(defaults.maxFetches, 1);

  const clamped = catalogModule.normalizeWebRetrievalSettings({
    baseUrl: 'https://proxy.example.com/deepseek/v1/tools/',
    apiKey: '  sk-x  ',
    count: 500,
    maxFetches: 99,
  });
  assert.equal(clamped.baseUrl, 'https://proxy.example.com/deepseek/v1/tools', 'trailing slashes are trimmed');
  assert.equal(clamped.apiKey, 'sk-x');
  assert.equal(clamped.count, 20);
  assert.equal(clamped.maxFetches, 3);

  // An unparsable stored address falls back to the default rather than locking the settings page.
  assert.equal(
    catalogModule.normalizeWebRetrievalSettings({ baseUrl: 'not a url' }).baseUrl,
    'https://api.deepseek.com/v1/tools',
  );
});

test('the resolver answers null without a key and borrows the DeepSeek connection key otherwise', async () => {
  const state = {
    connections: [{
      id: 'c1', name: 'DeepSeek', providerId: 'deepseek', capabilities: ['text'],
      modelCapabilities: { 'deepseek-v4-flash': ['text'] }, apiKey: 'sk-connection',
      baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-flash'],
      createdAt: 1, updatedAt: 1,
    }],
    routes: { chat: { connectionId: 'c1', model: 'deepseek-v4-flash' } },
    reasoning: 'disabled',
    maxOutputTokens: 8192,
    webRetrieval: { baseUrl: 'https://api.deepseek.com/v1/tools', apiKey: '', count: 8, maxFetches: 1 },
  };
  const repository = { load: async () => state, save: async (next) => { Object.assign(state, next); } };
  const catalog = new catalogModule.AiConnectionCatalog(repository);

  const borrowed = await catalog.resolveWebRetrievalConfig();
  assert.equal(borrowed.apiKey, 'sk-connection', 'the chat connection key is reused, no second field to fill');

  // Clearing the address is how the user turns the capability off: no address, no configuration.
  await catalog.saveWebRetrieval({ baseUrl: '' });
  assert.equal(await catalog.resolveWebRetrievalConfig(), null);
  assert.equal(state.webRetrieval.apiKey, '', 'saving does not resurrect a key');

  // An OpenAI-compatible connection's key is not a DeepSeek key, so it must not be borrowed.
  state.connections[0] = { ...state.connections[0], providerId: 'openai-compatible' };
  await catalog.saveWebRetrieval({ baseUrl: 'https://api.deepseek.com/v1/tools' });
  assert.equal(await catalog.resolveWebRetrievalConfig(), null);
});
