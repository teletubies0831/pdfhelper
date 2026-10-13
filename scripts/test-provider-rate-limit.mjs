import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../src/${path}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Missing dependency ${name}`);
    return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}
const contracts = await load('modules/ai/contracts');
const errors = await load('modules/ai/providers/provider-error');
const rate = await load('modules/ai/providers/provider-rate-limit', { '../contracts': contracts, './provider-error': errors });
const config = { ...contracts.DEFAULT_AI_CONFIG, apiKey: 'test-placeholder' };
const limited = (message = 'max RPM: 3, please try again after 1 seconds', headers = {}) =>
  rate.providerHttpError(new Response(null, { status: 429, headers }), { error: { message } });
function fixture() {
  let now = 0;
  const waits = [];
  const request = rate.createRateLimitedRequester({ now: () => now, wait: async ms => { waits.push(ms); now += ms; } });
  return { request, waits, now: () => now };
}

test('RPM cooldown is shared across concurrent requests and later model selections', async () => {
  const f = fixture(), calls = [];
  let attempts = 0;
  const a = f.request(config, undefined, async () => {
    calls.push(['a', f.now()]);
    if (++attempts === 1) throw limited();
    return 'a';
  });
  await a;
  const b = f.request({ ...config, model: 'another-model' }, undefined, async () => { calls.push(['b', f.now()]); return 'b'; });
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.deepEqual(calls, [['a', 0], ['a', 61000], ['b', 82000]]);
});

test('Retry-After seconds and HTTP dates are respected', async () => {
  for (const retryAfter of ['180', new Date(Date.now() + 180000).toUTCString()]) {
    const f = fixture();
    let count = 0;
    await f.request(config, undefined, async () => { if (!count++) throw limited('rate limit', { 'Retry-After': retryAfter }); });
    assert.ok(f.waits[0] >= 179000);
  }
});

test('persistent RPM rejection has only three retries with exponential cooldown', async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(f.request(config, undefined, async () => { calls++; throw limited(); }), /重试 3 次/);
  assert.equal(calls, 4);
  assert.deepEqual(f.waits, [61000, 122000, 244000]);
});

test('authentication, exhausted quota and daily limits do not retry', async () => {
  for (const [status, message] of [[401, 'bad credentials'], [429, 'insufficient_quota'], [429, 'organization max TPD: 100']]) {
    const f = fixture();
    let calls = 0;
    await assert.rejects(f.request(config, undefined, async () => {
      calls++;
      throw rate.providerHttpError(new Response(null, { status }), { error: { message } });
    }));
    assert.equal(calls, 1);
    assert.deepEqual(f.waits, []);
  }
});

test('a queued cancellation returns immediately and never sends its request', async () => {
  const f = fixture();
  let release;
  let calls = 0;
  const a = f.request(config, undefined, async () => {
    if (!calls++) throw limited();
    return new Promise(resolve => { release = resolve; });
  });
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  let sent = false;
  const b = f.request(config, controller.signal, async () => { sent = true; });
  controller.abort();
  await assert.rejects(b, { name: 'AbortError' });
  release();
  await a;
  await f.request(config, undefined, async () => {});
  assert.equal(sent, false);
});

test('cancellation during a cooldown clears the wait and does not retry', async () => {
  const controller = new AbortController();
  const request = rate.createRateLimitedRequester({ now: () => 0, wait: async (_, signal) => {
    controller.abort(); signal.throwIfAborted();
  } });
  let sent = 0;
  await assert.rejects(request(config, controller.signal, async () => { sent++; throw limited(); }), { name: 'AbortError' });
  assert.equal(sent, 1);
});

test('an unrelated credential is not held behind another account cooldown', async () => {
  let unblock;
  const request = rate.createRateLimitedRequester({ now: () => 0, wait: () => new Promise(resolve => { unblock = resolve; }) });
  let calls = 0;
  const a = request(config, undefined, async () => { if (!calls++) throw limited(); return 'a'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await request({ ...config, apiKey: 'different-test-account' }, undefined, async () => 'b'), 'b');
  unblock();
  assert.equal(await a, 'a');
});

test('streaming and non-streaming requests share the same cooldown', async () => {
  const f = fixture();
  const moonshot = await load('modules/ai/providers/moonshot-reasoning');
  let calls = 0;
  const times = [];
  const { DeepSeekProviderAdapter } = await load('modules/ai/providers/deepseek-provider', {
    '../contracts': contracts, './provider-error': errors, './moonshot-reasoning': moonshot,
    './provider-rate-limit': { ...rate, requestWithRateLimit: f.request },
  }, { fetch: async (_, init) => {
    times.push(f.now());
    if (++calls === 1) return Response.json({ error: { message: 'max RPM: 3' } }, { status: 429 });
    if (JSON.parse(init.body).stream) return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  } });
  const adapter = new DeepSeekProviderAdapter();
  const streamed = adapter.stream(config, [], 1000, new AbortController().signal, () => {});
  await streamed;
  const plain = adapter.chat(config, [], 1000);
  assert.deepEqual((await Promise.all([streamed, plain])).map(r => r.content), ['ok', 'ok']);
  assert.deepEqual(times, [0, 61000, 82000]);
});

test('providers without observed rate limits keep concurrent requests and no waits', async () => {
  for (const baseUrl of ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://api.moonshot.cn/v1', 'https://custom.example/v1']) {
    const f = fixture(), releases = [];
    const attempt = () => new Promise(resolve => releases.push(resolve));
    const a = f.request({ ...config, baseUrl }, undefined, attempt);
    const b = f.request({ ...config, baseUrl }, undefined, attempt);
    assert.equal(releases.length, 2, `${baseUrl} must not be serialized`);
    releases.forEach(resolve => resolve('ok'));
    assert.deepEqual(await Promise.all([a, b]), ['ok', 'ok']);
    assert.deepEqual(f.waits, []);
  }
});

test('background keepalive stops on both success and failure', async () => {
  let callback, clears = 0, pings = 0;
  const { withAiRequestLifetime } = await load('background/ai/request-lifetime', {
    'wxt/browser': { browser: { runtime: { getPlatformInfo: async () => { pings++; } } } },
  }, { setInterval: fn => { callback = fn; return 42; }, clearInterval: id => { assert.equal(id, 42); clears++; } });
  assert.equal(await withAiRequestLifetime(async () => { callback(); return 'ok'; }), 'ok');
  await assert.rejects(withAiRequestLifetime(async () => { callback(); throw Error('failed'); }));
  assert.equal(pings, 2);
  assert.equal(clears, 2);
});
