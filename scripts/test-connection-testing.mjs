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
  // Knowledge-graph entity extraction, relation judgement and entity explanations are exercised by
  // their own contract tests; here they only need to exist so the handler module can be loaded.
  './entity-extraction-service': {},
  './relation-judgement-service': {},
  './entity-explanation-service': {},
  // Web retrieval is exercised by its own contract test; here it only has to exist.
  './web-retrieval-service': {},
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

test('every knowledge-graph AI request type is accepted by the whitelist and answered', async () => {
  // Two independent gates stand between a viewer feature and the provider: `isAiRuntimeRequest`
  // (the background listener ignores anything it does not recognise) and the if-chain in
  // `handleAiRequest`. Missing either one is silent — the feature sees `undefined` instead of a
  // response — so both are asserted here for the whole knowledge-graph family, not just the newest
  // member. This is exactly how a new request type failed once in real use.
  const { handleAiRequest: handle } = evaluate(await compile('src/background/ai/request-handler.ts'), {
    '../../modules/ai/public': ai,
    '../../modules/reading-mode/public': {},
    './vision-service': vision,
    './ai-config-repository': {
      getAiConfig: async () => config,
      getVisionAiConfig: async () => ({}),
    },
    './provider-runtime': { getProviderAdapter: () => adapter },
    './conversation-builder': {},
    './document-overview-service': {},
    './entity-extraction-service': {
      extractEntities: async () => ({
        content: '{"entities":[]}', batchCount: 1, failedBatches: [], promptVersion: 'test',
      }),
    },
    './relation-judgement-service': {
      judgeRelations: async () => ({ content: '{"relations":[]}', batchCount: 1, failedBatches: [] }),
    },
    './entity-explanation-service': {
      explainEntities: async () => ({ content: '{"explanations":[]}' }),
    },
    // Web retrieval is exercised by its own contract test; here it has to exist and answer.
    './web-retrieval-service': {
      probeWebRetrieval: async () => ({ ok: true, content: 'connectivity ok' }),
      generateRelatedLiterature: async () => ({
        markdown: '## related', usage: { searchCalls: 0, fetchCalls: 0 }, sources: [],
      }),
      searchForChat: async () => ({ hits: [], searchCalls: 1 }),
    },
  });

  const messages = [
    {
      type: 'pdf-helper:ai-extract-entities', requestId: 'r-extract', paperId: 'p1',
      paperTitle: 'T', documentName: 'd.pdf', maxCandidatesPerChunk: 5,
      chunks: [{ chunkId: 'c1', startPage: 1, endPage: 1, text: 't' }],
    },
    {
      type: 'pdf-helper:ai-judge-relations', requestId: 'r-judge',
      pairs: [{
        pairKey: 'a|b', leftTitle: 'L', rightTitle: 'R', leftSummary: '', rightSummary: '',
        sharedEntities: [], recallReasons: [],
      }],
    },
    {
      type: 'pdf-helper:ai-explain-entities', requestId: 'r-explain',
      items: [{ name: 'X', type: 'Method', paperTitle: 'T', quotes: [] }],
    },
    // The web-retrieval family: a settings probe, the on-demand 相关论文 section and the chat's 联网 search. They
    // were added later than the rest, which is exactly the case this test exists for.
    { type: 'pdf-helper:ai-test-web-retrieval' },
    {
      type: 'pdf-helper:ai-related-literature', requestId: 'r-related',
      documentName: 'd.pdf', overviewMarkdown: '# T',
    },
    { type: 'pdf-helper:ai-web-search', requestId: 'r-web', query: 'attention' },
  ];

  for (const message of messages) {
    assert.equal(
      contracts.isAiRuntimeRequest(message),
      true,
      `${message.type} must pass the background's whitelist, or the listener ignores it`,
    );
    const response = await handle(message);
    assert.ok(
      response && typeof response.ok === 'boolean',
      `${message.type} must get a response object, not undefined`,
    );
    assert.equal(response.ok, true, `${message.type} failed in the handler: ${response.error}`);
  }
});

let browser, page;
const uiFiles = {
  prefs: 'src/viewer/features/assistant/connection-test-preferences.ts',
  selection: 'src/viewer/features/assistant/connection-model-selection.ts',
  navigation: 'src/viewer/features/assistant/settings-navigation.ts',
  controller: 'src/viewer/features/assistant/connection-test-controller.ts',
  models: 'src/modules/ai/domain/ai-connection.ts',
  primaryTransition: 'src/viewer/features/assistant/settings-primary-transition.ts',
  focusRelease: 'src/viewer/app/focus-release.ts',
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
    // The real element module exposes these as `Array.from(querySelectorAll(...))`; the id map cannot express that,
    // and switching tabs needs them.
    elements.settingsPrimaryTabButtons = [...document.querySelectorAll('[data-settings-tab]')];
    elements.settingsPrimaryPanels = [...document.querySelectorAll('[data-settings-panel]')];
    const { releaseFocusBeforeHiding } = run(uiFiles.focusRelease);
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
      '../../app/viewer-elements': elements,
      // The real module: the focus-before-hiding fix lives in it too, so a stub would hide the bug under test.
      './settings-primary-transition': run(uiFiles.primaryTransition, {
        '../../app/public': { releaseFocusBeforeHiding },
      }),
      '../../app/public': { releaseFocusBeforeHiding },
    });
    const controller = run(uiFiles.controller, {
      'wxt/browser': { browser }, '../../../modules/ai/public': ai,
      '../../../modules/memory/public': {}, '../../core/pdf-reader/public': {},
      '../../app/viewer-elements': elements, '../annotations/public': {}, '../recent-files/public': {},
      '../../app/viewer-state': { linkService: { goToDestination() {} } }, './memory-controller': {},
      './settings-navigation': navigation, './connection-test-preferences': prefs,
      './connection-model-selection': selection, '../../app/chat-reasoning-control': {},
      './chat-web-search': { syncChatWebSearchToggle() {} },
      './web-retrieval-settings': { populateWebRetrievalForm() {} },
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

test('a hidden screen never keeps the focus (the aria-hidden error Edge reported)', async () => {
  // Edge listed "Blocked aria-hidden on an element because its descendant retained focus", naming
  // #settings-connection-back inside #settings-connection-editor: clicking the back button leaves focus on it, and the
  // screen it lives in is then hidden. The browser is right to refuse — hiding the focused element from assistive
  // technology drops the caret into nowhere — so focus has to leave before the attribute is written.
  const result = await page.evaluate(async () => {
    const editor = document.getElementById('settings-connection-editor');
    const overview = document.getElementById('settings-model-overview');
    // The settings panel is hidden in this harness; nothing inside a `hidden` subtree can take focus, and this test is
    // about focus.
    const panel = document.getElementById('assistant-settings-panel');
    if (panel) panel.hidden = false;
    navigation.showSettingsConnectionEditor();
    await new Promise(resolve => setTimeout(resolve, 400));
    const opened = {
      visible: !editor.hidden && !editor.inert,
      focusInside: editor.contains(document.activeElement),
    };
    document.getElementById('settings-connection-back').focus();
    const focusedBefore = editor.contains(document.activeElement);
    // Watch the exact moment the attribute is written: that is when the browser decides whether to block it, and by
    // the time the transition settles the element may already have been blurred for other reasons.
    const violations = [];
    const observer = new MutationObserver(() => {
      if (editor.getAttribute('aria-hidden') !== 'true') return;
      violations.push({
        hidden: editor.hidden,
        focusInside: editor.contains(document.activeElement),
      });
    });
    observer.observe(editor, { attributes: true, attributeFilter: ['aria-hidden'] });
    navigation.showSettingsModelOverview();
    await new Promise(resolve => setTimeout(resolve, 600));
    observer.disconnect();
    return {
      opened,
      focusedBefore,
      violations,
      editorHidden: editor.hidden,
      editorAriaHidden: editor.getAttribute('aria-hidden'),
      focusStillInside: editor.contains(document.activeElement),
      overviewVisible: !overview.hidden && !overview.inert && !overview.hasAttribute('aria-hidden'),
    };
  });
  assert.equal(result.opened.visible, true, 'the editor screen has to open first');
  assert.equal(result.focusedBefore, true, 'the test must start with focus inside the screen being hidden');
  assert.ok(result.violations.length > 0, 'the screen was hidden at least once');
  assert.deepEqual(
    result.violations.filter((entry) => entry.focusInside),
    [],
    'aria-hidden was applied while the screen still held the focus — exactly what the browser blocked',
  );
  assert.equal(result.editorHidden, true);
  assert.equal(result.editorAriaHidden, 'true');
  assert.equal(
    result.focusStillInside,
    false,
    'a hidden screen must not still hold the focus — that is the combination the browser blocks',
  );
  assert.equal(result.overviewVisible, true, 'and the screen that replaced it is exposed');
});
