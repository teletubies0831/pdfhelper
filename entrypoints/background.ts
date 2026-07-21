import { browser } from 'wxt/browser';

import {
  ACTION_LABELS,
  SELECTION_STORAGE_KEY,
  isSelectionAction,
  type SelectionAction,
  type SelectionRequest,
} from '../shared/selection';
import { extractPdfSource } from '../shared/pdf-source';
import {
  AI_CONFIG_STORAGE_KEY,
  AI_STREAM_PORT_NAME,
  DEFAULT_AI_CONFIG,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  isAiRuntimeRequest,
  normalizeAiBaseUrl,
  type AiConfig,
  type AiConversationMessage,
  type AiDocumentContext,
  type AiRuntimeRequest,
  type AiRuntimeResponse,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
} from '../shared/ai';
import {
  getReadingModeStrategy,
  isResolvedReadingMode,
  type ResolvedReadingMode,
} from '../shared/reading-mode';

const MENU_ROOT_ID = 'pdf-helper-selection';
const MENU_PREFIX = 'pdf-helper-action-';

async function registerContextMenus() {
  await browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: MENU_ROOT_ID,
    title: '发送给 PDF Helper',
    contexts: ['selection'],
  });

  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    browser.contextMenus.create({
      id: `${MENU_PREFIX}${action}`,
      parentId: MENU_ROOT_ID,
      title: label,
      contexts: ['selection'],
    });
  }
}

async function saveSelection(
  action: SelectionAction,
  text: string,
  tab?: { title?: string; url?: string },
) {
  const request: SelectionRequest = {
    id: crypto.randomUUID(),
    action,
    text: text.trim(),
    pageTitle: tab?.title,
    pageUrl: tab?.url,
    createdAt: Date.now(),
  };

  await browser.storage.local.set({ [SELECTION_STORAGE_KEY]: request });
}

async function openEnhancedViewer() {
  const viewerUrl = browser.runtime.getURL('/viewer.html');
  const tabs = await browser.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url?.startsWith(viewerUrl));

  if (existingTab?.id !== undefined) {
    await browser.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: viewerUrl });
}

async function openHelperPanelPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('/helper-panel.html') });
}

type LegacyDeepSeekConfig = Partial<AiConfig> & { thinking?: AiConfig['reasoning'] };

async function getAiConfig(): Promise<AiConfig> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as Partial<AiConfig> | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as LegacyDeepSeekConfig | undefined;
  const source = current || legacy;
  const providerId = source?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...source,
    providerId,
    apiKey: source?.apiKey?.trim() ?? '',
    baseUrl: normalizeAiBaseUrl(source?.baseUrl ?? '', providerId),
    reasoning: source?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
    model: source?.model || DEFAULT_AI_CONFIG.model,
  };

  if (!current && legacy) {
    await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: config });
  }
  return config;
}

function getProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

type ProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

interface ProviderChatResult {
  content: string;
  model: string;
}

interface AiProviderAdapter {
  readonly id: AiConfig['providerId'];
  test(config: AiConfig): Promise<string[]>;
  chat(config: AiConfig, messages: ProviderMessage[], maxOutputTokens: number): Promise<ProviderChatResult>;
  stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (content: string) => void,
  ): Promise<ProviderChatResult>;
}

async function fetchProviderJson(
  path: string,
  config: AiConfig,
  init?: RequestInit,
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getProviderError(payload, `AI 请求失败：HTTP ${response.status}`));
  }

  return payload;
}

class DeepSeekProviderAdapter implements AiProviderAdapter {
  readonly id = 'deepseek' as const;

  async test(config: AiConfig): Promise<string[]> {
    const payload = await fetchProviderJson('/models', config);
    if (!Array.isArray((payload as { data?: unknown })?.data)) return [];
    return (payload as { data: Array<{ id?: unknown }> }).data
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');
  }

  async chat(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
  ): Promise<ProviderChatResult> {
    const payload = await fetchProviderJson('/chat/completions', config, {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        messages,
        thinking: { type: config.reasoning },
        stream: false,
        max_tokens: maxOutputTokens,
      }),
    }) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      model?: unknown;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI 模型没有返回有效回答。');
    }
    return {
      content: content.trim(),
      model: typeof payload.model === 'string' ? payload.model : config.model,
    };
  }

  async stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (content: string) => void,
  ): Promise<ProviderChatResult> {
    if (!config.apiKey) throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        thinking: { type: config.reasoning },
        stream: true,
        max_tokens: maxOutputTokens,
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(getProviderError(payload, `AI 请求失败：HTTP ${response.status}`));
    }
    if (!response.body) throw new Error('当前浏览器没有提供可读取的 AI 流式响应。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completeContent = '';
    let finished = false;

    const processEvent = (event: string): boolean => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data) return false;
      if (data === '[DONE]') return true;
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content) {
        completeContent += content;
        onDelta(content);
      }
      return false;
    };

    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        if (processEvent(event)) {
          finished = true;
          break;
        }
      }
      if (done) {
        if (buffer.trim()) processEvent(buffer);
        break;
      }
    }

    return { content: completeContent, model: config.model };
  }
}

const providerAdapters: Partial<Record<AiConfig['providerId'], AiProviderAdapter>> = {
  deepseek: new DeepSeekProviderAdapter(),
};

function getProviderAdapter(config: AiConfig): AiProviderAdapter {
  const adapter = providerAdapters[config.providerId];
  if (!adapter) throw new Error('当前模型供应商尚未接入，请在设置中选择已支持的供应商。');
  return adapter;
}

function buildSystemContent(context?: AiDocumentContext): string {
  const readingMode = context?.readingMode ?? 'general';
  const strategy = getReadingModeStrategy(readingMode);
  const contextParts: string[] = [
    strategy.systemInstruction,
    strategy.contextInstruction(context?.pageNumber ?? 1, context?.totalPages),
  ];
  if (context?.documentName) contextParts.push(`当前文档：${context.documentName}`);
  if (context?.pageNumber) contextParts.push(`当前页码：第 ${context.pageNumber} 页`);
  if (context?.selectedText?.trim()) {
    contextParts.push(`用户当前选中的 PDF 原文（回答时最高优先级）：\n${context.selectedText.trim().slice(0, 12000)}`);
  }
  if (context?.pageText?.trim()) {
    contextParts.push(`当前页完整正文：\n${context.pageText.trim().slice(0, 24000)}`);
  }

  return [
    '你是 PDF Helper 的阅读助手。请结合提供的 PDF 上下文，用清晰、准确、可核验的中文回答。',
    '如果上下文不足，请明确说明，不要编造文档中不存在的内容。涉及翻译时忠实保留术语，涉及解释时优先给出直观含义。',
    '请使用简洁的 Markdown 组织回答；不要给整个回答套一层 Markdown 代码围栏。',
    ...contextParts,
  ].join('\n\n');
}

function buildConversation(
  messages: AiConversationMessage[],
  context?: AiDocumentContext,
): ProviderMessage[] {
  const conversation: ProviderMessage[] = messages
    .filter((item) => item.content.trim())
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 16000) }));
  return [{ role: 'system', content: buildSystemContent(context) }, ...conversation];
}

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

function isAiStreamStartMessage(value: unknown): value is AiStreamStartMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiStreamStartMessage>;
  return candidate.type === 'start'
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.messages);
}

function postAiStreamMessage(
  port: RuntimePort,
  message: AiStreamServerMessage,
): void {
  try {
    port.postMessage(message);
  } catch {
    // The viewer may have closed while a network chunk was in flight.
  }
}

async function streamAiResponse(
  request: AiStreamStartMessage,
  port: RuntimePort,
  signal: AbortSignal,
): Promise<void> {
  const config = await getAiConfig();
  const adapter = getProviderAdapter(config);
  postAiStreamMessage(port, {
    type: 'started',
    requestId: request.requestId,
    model: config.model,
  });
  const result = await adapter.stream(
    config,
    buildConversation(request.messages, request.context),
    2048,
    signal,
    (content) => {
      postAiStreamMessage(port, {
        type: 'delta',
        requestId: request.requestId,
        content,
      });
    },
  );
  postAiStreamMessage(port, {
    type: 'done',
    requestId: request.requestId,
    model: result.model,
  });
}

function parseReadingModeDetection(content: string): {
  readingMode: ResolvedReadingMode;
  rationale: string;
} {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const payload = JSON.parse(cleaned) as { mode?: unknown; rationale?: unknown };
    if (isResolvedReadingMode(payload.mode)) {
      return {
        readingMode: payload.mode,
        rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : '',
      };
    }
  } catch {
    // Fall back to a strict word match for providers that wrap the JSON in prose.
  }
  const match = cleaned.match(/\b(paper|novel|general)\b/i)?.[1]?.toLowerCase();
  if (!isResolvedReadingMode(match)) throw new Error('AI 没有返回可识别的阅读模式。');
  return { readingMode: match, rationale: cleaned.slice(0, 180) };
}

async function handleAiRequest(message: AiRuntimeRequest): Promise<AiRuntimeResponse> {
  try {
    const config = await getAiConfig();
    const adapter = getProviderAdapter(config);

    if (message.type === 'pdf-helper:ai-test') {
      const models = await adapter.test(config);
      return { ok: true, models };
    }

    if (message.type === 'pdf-helper:ai-detect-reading-mode') {
      const outline = message.outlineTitles?.filter(Boolean).slice(0, 80).join(' / ') || '未提供';
      const result = await adapter.chat(config, [{
        role: 'system',
        content: [
          '你是 PDF 文档类型识别器。只判断最适合的阅读策略，不要总结文档。',
          'paper：学术论文、研究报告、包含研究问题/方法/实验/结论的文档。',
          'novel：小说、故事、戏剧或以人物和情节推进的叙事作品。',
          'general：教材、说明书、传记、普通非虚构或无法明确归类的材料。',
          '只返回 JSON：{"mode":"paper|novel|general","rationale":"不超过40字的理由"}',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          `文件名：${message.documentName}`,
          `目录：${outline}`,
          '文档样本：',
          message.sampleText.slice(0, 24000),
        ].join('\n\n'),
      }], 300);
      const detection = parseReadingModeDetection(result.content);
      return { ok: true, model: result.model, ...detection };
    }

    const result = await adapter.chat(
      config,
      buildConversation(message.messages, message.context),
      2048,
    );
    return {
      ok: true,
      content: result.content,
      model: result.model,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default defineBackground(() => {
  void registerContextMenus();

  browser.action.onClicked.addListener(() => {
    void openEnhancedViewer();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!isAiRuntimeRequest(message)) return undefined;
    return handleAiRequest(message);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_STREAM_PORT_NAME) return;

    let activeRequest: AbortController | undefined;
    port.onMessage.addListener((message) => {
      if (!isAiStreamStartMessage(message)) return;

      activeRequest?.abort();
      activeRequest = new AbortController();
      const { signal } = activeRequest;
      void streamAiResponse(message, port, signal).catch((error) => {
        if (signal.aborted) return;
        postAiStreamMessage(port, {
          type: 'error',
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    port.onDisconnect.addListener(() => {
      activeRequest?.abort();
      activeRequest = undefined;
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
      typeof info.menuItemId !== 'string' ||
      !info.menuItemId.startsWith(MENU_PREFIX) ||
      !info.selectionText
    ) {
      return;
    }

    const action = info.menuItemId.slice(MENU_PREFIX.length);
    if (!isSelectionAction(action)) return;

    const pdfSource = extractPdfSource(tab?.url);
    if (!pdfSource && !tab?.url?.startsWith(browser.runtime.getURL('/viewer.html'))) {
      return;
    }

    await saveSelection(action, info.selectionText, tab);

    await openHelperPanelPage();
  });
});
