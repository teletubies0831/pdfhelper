import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const root = process.cwd();
const compiled = {};
const compile = async (file) => {
  if (!compiled[file]) compiled[file] = ts.transpileModule(await readFile(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return compiled[file];
};
const evaluate = (code, dependencies = {}) => {
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
};

const contracts = evaluate(await compile('src/modules/ai/contracts.ts'));
const preferences = evaluate(await compile('src/modules/ai/domain/connection-test-settings.ts'));
const moonshot = evaluate(await compile('src/modules/ai/providers/moonshot-reasoning.ts'));
const errors = evaluate(await compile('src/modules/ai/providers/provider-error.ts'));
const rateLimit = evaluate(await compile('src/modules/ai/providers/provider-rate-limit.ts'), { '../contracts': contracts, './provider-error': errors });
let rateLimitTime = 0;
const requestWithRateLimit = rateLimit.createRateLimitedRequester({ now: () => rateLimitTime, wait: async ms => { rateLimitTime += ms; } });
const ai = { ...contracts, ...preferences, ...moonshot, ...errors };
const { DeepSeekProviderAdapter } = evaluate(await compile('src/modules/ai/providers/deepseek-provider.ts'), {
  '../contracts': contracts, './provider-error': errors, './moonshot-reasoning': moonshot,
  './provider-rate-limit': { ...rateLimit, requestWithRateLimit },
});
const vision = evaluate(await compile('src/background/ai/vision-service.ts'), { '../../modules/ai/public': ai });
const adapter = new DeepSeekProviderAdapter('openai-compatible');
const { handleAiRequest } = evaluate(await compile('src/background/ai/request-handler.ts'), {
  '../../modules/ai/public': ai,
  '../../modules/reading-mode/public': {},
  './vision-service': vision,
  './ai-config-repository': {},
  './provider-runtime': { getProviderAdapter: () => adapter },
  './conversation-builder': {},
  './document-overview-service': {},
});
const config = { ...contracts.DEFAULT_AI_CONFIG, providerId: 'openai-compatible',
  apiKey: 'unit-test-key', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code' };

test('test preferences handle defaults, invalid storage and safe bounds', () => {
  assert.deepEqual(preferences.normalizeConnectionTestSettings(null), { maxOutputTokens: 8192, concurrency: 1 });
  assert.deepEqual(preferences.normalizeConnectionTestSettings({ maxOutputTokens: '', concurrency: 'oops' }),
    { maxOutputTokens: 8192, concurrency: 1 });
  assert.deepEqual(preferences.normalizeConnectionTestSettings({ maxOutputTokens: 999999, concurrency: -3 }),
    { maxOutputTokens: 65536, concurrency: 1 });
  assert.equal(preferences.redactConnectionTestText('bad unit-test-key sk-EXAMPLE', 'unit-test-key'),
    'bad [密钥已隐藏] [密钥已隐藏]');
});

test('Moonshot reasoning respects the endpoint and model family', () => {
  const payload = moonshot.getMoonshotReasoningPayload;
  assert.deepEqual(payload(config.baseUrl, 'kimi-k2.7-code', false), {});
  assert.deepEqual(payload(config.baseUrl, 'kimi-k2.7-code-highspeed', false), {});
  assert.deepEqual(payload(config.baseUrl, 'kimi-k3', false), { reasoning_effort: 'low' });
  assert.deepEqual(payload(config.baseUrl, 'kimi-k2.6', false), { thinking: { type: 'disabled' } });
  assert.deepEqual(payload(config.baseUrl, 'kimi-k2.6', true), { thinking: { type: 'enabled' } });
  assert.equal(payload('https://api.moonshot.cn.example.org/v1', 'kimi-k3', false), undefined);
  assert.equal(payload('https://dashscope.aliyuncs.com/compatible-mode/v1', 'kimi-k2.6', false), undefined);
});

test('real background handler sends normal prompts, adequate budgets, and returns answers', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const content = Array.isArray(body.messages.at(-1).content) ? contracts.AI_VISION_TEST_MARKER : '我可以帮助你理解 PDF。';
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  };
  try {
    const text = await handleAiRequest({ type: 'pdf-helper:ai-test', mode: 'validate', config: { ...config, capabilities: ['text'] } });
    assert.equal(text.content, '我可以帮助你理解 PDF。');
    assert.equal(calls[0].max_tokens, 8192);
    assert.equal(calls[0].messages[0].content, preferences.CONNECTION_TEST_PROMPT);
    assert.equal('enable_thinking' in calls[0], false);
    assert.equal('thinking' in calls[0], false);
    const image = await handleAiRequest({ type: 'pdf-helper:ai-test', mode: 'validate',
      config: { ...config, capabilities: ['vision'] }, imageDataUrl: 'data:image/png;base64,TEST',
      testSettings: { maxOutputTokens: 16384, concurrency: 1 } });
    assert.equal(image.ok, true);
    assert.equal(image.content, contracts.AI_VISION_TEST_MARKER);
    assert.equal(calls[1].max_tokens, 16384);
    assert.ok(!JSON.stringify(calls[1].messages).includes(contracts.AI_VISION_TEST_MARKER), 'Vision answer stays out of prompt');
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: 'I cannot see the image' } }] });
    assert.equal((await handleAiRequest({ type: 'pdf-helper:ai-test', mode: 'validate',
      config: { ...config, capabilities: ['vision'] } })).ok, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('empty thinking-only responses and provider errors remain distinguishable', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking' } }] });
    await assert.rejects(adapter.chat(config, [], 8192), /Token 上限/);
    globalThis.fetch = async () => Response.json({ error: { type: 'rate_limit_reached_error', message: 'Too many requests' } }, { status: 429 });
    const result = await handleAiRequest({ type: 'pdf-helper:ai-test', mode: 'validate', config });
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 429.*rate_limit_reached_error/);
    assert.match(preferences.explainConnectionTestError(result.error), /限流/);
  } finally { globalThis.fetch = originalFetch; }
});

let browser, page;
const uiFiles = {
  prefs: 'src/viewer/features/assistant/connection-test-preferences.ts',
  selection: 'src/viewer/features/assistant/connection-model-selection.ts',
  navigation: 'src/viewer/features/assistant/settings-navigation.ts',
  controller: 'src/viewer/features/assistant/connection-test-controller.ts',
  models: 'src/modules/ai/domain/ai-connection.ts',
};
const elementIds = {};
before(async () => {
  for (const file of Object.values(uiFiles)) await compile(file);
  for (const file of await readdir(path.join(root, 'src/viewer/app/elements'))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(path.join(root, 'src/viewer/app/elements', file), 'utf8');
    for (const match of source.matchAll(/export const (\w+)\s*=\s*requiredElement(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)) {
      elementIds[match[1]] = match[2];
    }
  }
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
});
beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  await page.setContent(await readFile(path.join(root, 'src/viewer/templates/reader-workspace.html'), 'utf8'));
  await page.evaluate(({ compiled, uiFiles, elementIds }) => {
    const run = (file, dependencies = {}) => {
      const exports = {};
      new Function('exports', 'require', compiled[file])(exports, name => {
        if (!(name in dependencies)) throw new Error(`Unmocked UI dependency: ${name}`);
        return dependencies[name];
      });
      return exports;
    };
    const ai = { ...run('src/modules/ai/contracts.ts'),
      ...run('src/modules/ai/domain/connection-test-settings.ts'), ...run(uiFiles.models) };
    const elements = Object.fromEntries(Object.entries(elementIds).map(([name, id]) => [name, document.getElementById(id)]));
    window.saved = {};
    const browser = { storage: { local: {
      get: async () => window.saved,
      set: async value => Object.assign(window.saved, value),
    } }, runtime: { sendMessage: async message => window.sendMessage(message) } };
    const prefs = run(uiFiles.prefs, {
      'wxt/browser': { browser }, '../../../modules/ai/public': ai,
      '../../app/elements/required-element': { requiredElement: id => document.getElementById(id) },
    });
    const selection = run(uiFiles.selection, {
      '../../../modules/ai/public': ai,
      '../../app/viewer-elements': elements,
    });
    const navigation = run(uiFiles.navigation, {
      '../../../modules/ai/public': ai, './connection-test-preferences': prefs,
      './connection-model-selection': selection,
      '../../app/viewer-elements': elements, './settings-primary-transition': {},
    });
    const controller = run(uiFiles.controller, {
      'wxt/browser': { browser }, '../../../modules/ai/public': ai,
      '../../../modules/memory/public': {}, '../../core/pdf-reader/public': {},
      '../../app/viewer-elements': elements, '../annotations/public': {}, '../recent-files/public': {},
      '../../app/viewer-state': { linkService: { goToDestination() {} } }, './memory-controller': {},
      './settings-navigation': navigation, './connection-test-preferences': prefs,
      './connection-model-selection': selection, '../../app/chat-reasoning-control': {},
    });
    Object.assign(window, { prefs, selection, navigation, controller, elements });
    elements.aiProviderSelect.value = 'openai-compatible';
    elements.deepSeekApiKeyInput.value = 'unit-test-key';
    elements.deepSeekBaseUrlInput.value = 'https://api.moonshot.cn/v1';
    elements.settingsConnectionModelsInput.value = '';
  }, { compiled, uiFiles, elementIds });
});
after(async () => { await browser?.close(); });

async function screenshotSettings(name, panel = 'general') {
  if (!process.env.PDFPAL_TEST_SCREENSHOTS) return;
  const expandCss = async file => {
    let source = await readFile(file, 'utf8');
    for (const match of [...source.matchAll(/@import url\(["']([^"']+)["']\);/g)]) {
      source = source.replace(match[0], await expandCss(path.resolve(path.dirname(file), match[1])));
    }
    return source;
  };
  await page.addStyleTag({ content: await expandCss(path.join(root, 'entrypoints/viewer/style.css')) });
  await page.evaluate(panel => {
    const modal = document.getElementById('assistant-settings-panel');
    document.body.replaceChildren(modal);
    modal.hidden = false;
    modal.classList.add('is-open');
    for (const node of modal.querySelectorAll('[data-settings-panel]')) node.hidden = node.dataset.settingsPanel !== panel;
    if (panel === 'models') {
      document.getElementById('settings-model-overview').hidden = true;
      document.getElementById('settings-connection-editor').hidden = false;
    }
  }, panel);
  if (panel === 'models') await page.locator('#connection-test-results').scrollIntoViewIfNeeded();
  await mkdir(path.join(root, '.output/test-artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, `.output/test-artifacts/${name}.png`) });
}

test('General test settings persist and normalize after reopening', async () => {
  const result = await page.evaluate(async () => {
    await prefs.loadConnectionTestPreferences();
    document.getElementById('connection-test-max-output-tokens').value = '16384';
    document.getElementById('connection-test-concurrency').value = '2';
    await prefs.saveConnectionTestPreferences();
    document.getElementById('connection-test-max-output-tokens').value = '';
    await prefs.loadConnectionTestPreferences();
    return prefs.readConnectionTestPreferences();
  });
  assert.deepEqual(result, { maxOutputTokens: 16384, concurrency: 2 });
  assert.equal(await page.locator('[data-settings-panel="general"] #connection-test-max-output-tokens').count(), 1);
  await screenshotSettings('connection-test-general');
});

test('discovery sends no model tests; only the selected model is validated and merged', async () => {
  const result = await page.evaluate(async () => {
    let active = 0, peak = 0, validateCalls = 0;
    window.sendMessage = async message => {
      if (message.mode === 'discover') return { ok: true, models: ['kimi-k2.7-code', 'kimi-k3'] };
      validateCalls++;
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return { ok: true, content: '真实测试回答 <b>纯文本</b>' };
    };
    const discovered = await controller.discoverDeepSeekModels();
    const callsAfterDiscovery = validateCalls;
    const choices = [...document.querySelectorAll('#settings-available-model-results input')];
    choices[0].checked = true;
    choices[0].dispatchEvent(new Event('change'));
    const first = await controller.testDeepSeekConnection();
    const verified = navigation.isSettingsConnectionDraftVerified();
    const content = document.getElementById('connection-test-results').textContent;
    const htmlInjected = document.querySelector('#connection-test-results b') !== null;
    window.sendMessage = async message => message.mode === 'discover' ? { ok: true, models: ['kimi-k2.7-code'] }
      : { ok: false, error: 'HTTP 429 rate_limit_reached_error unit-test-key' };
    const second = await controller.testDeepSeekConnection();
    return { discovered, callsAfterDiscovery, choiceCount: choices.length, validateCalls,
      first, peak, verified, content, htmlInjected, second,
      stillVerified: navigation.isSettingsConnectionDraftVerified(),
      badgeCount: elements.settingsConnectionModelCount.textContent,
      errors: document.getElementById('connection-test-results').textContent,
      disabled: elements.testDeepSeekButton.disabled };
  });
  assert.equal(result.discovered, true);
  assert.equal(result.callsAfterDiscovery, 0);
  assert.equal(result.choiceCount, 2);
  assert.equal(result.validateCalls, 2, 'Only one selected model receives text and vision tests');
  assert.equal(result.first, true);
  assert.equal(result.peak, 1);
  assert.equal(result.verified, true);
  assert.match(result.content, /真实测试回答/);
  assert.equal(result.htmlInjected, false);
  assert.equal(result.second, false);
  assert.equal(result.stillVerified, true);
  assert.equal(result.badgeCount, '1 个');
  assert.match(result.errors, /限流/);
  assert.ok(!result.errors.includes('unit-test-key'));
  assert.equal(result.disabled, false);
  await screenshotSettings('connection-test-errors', 'models');
});

test('late results cannot verify an edited or switched connection', async () => {
  const result = await page.evaluate(async () => {
    window.sendMessage = async message => {
      if (message.mode === 'discover') return { ok: true, models: ['kimi-k2.7-code'] };
      await new Promise(resolve => setTimeout(resolve, 30));
      return { ok: true, content: 'old connection response' };
    };
    await controller.discoverDeepSeekModels();
    const choice = document.querySelector('#settings-available-model-results input');
    choice.checked = true;
    choice.dispatchEvent(new Event('change'));
    const pending = controller.testDeepSeekConnection();
    await new Promise(resolve => setTimeout(resolve, 10));
    navigation.invalidateSettingsConnectionTest();
    elements.deepSeekBaseUrlInput.value = 'https://example.org/v1';
    return { ok: await pending, verified: navigation.isSettingsConnectionDraftVerified(),
      content: document.getElementById('connection-test-results').textContent,
      disabled: elements.testDeepSeekButton.disabled };
  });
  assert.deepEqual(result, { ok: false, verified: false, content: '', disabled: false });
});
