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
  buildAiSystemContent,
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  isAiRuntimeRequest,
  isMainAiVisionCapable,
  normalizeAiBaseUrl,
  VISION_AI_CONFIG_STORAGE_KEY,
  type AiConfig,
  type AiConversationMessage,
  type AiDocumentContext,
  type AiRuntimeRequest,
  type AiRuntimeResponse,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type VisionAiConfig,
} from '../shared/ai';
import {
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

async function getVisionAiConfig(): Promise<VisionAiConfig> {
  const stored = await browser.storage.local.get(VISION_AI_CONFIG_STORAGE_KEY);
  const value = stored[VISION_AI_CONFIG_STORAGE_KEY] as Partial<VisionAiConfig> | undefined;
  return {
    ...DEFAULT_VISION_AI_CONFIG,
    ...value,
    mode: value?.mode === 'separate' ? 'separate' : 'disabled',
    providerId: 'openai-compatible',
    apiKey: value?.apiKey?.trim() ?? '',
    baseUrl: value?.baseUrl?.trim().replace(/\/+$/, '') ?? '',
    model: value?.model?.trim() ?? '',
  };
}

function getProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function getVisionContent(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item === 'object' && 'text' in item
        ? String((item as { text?: unknown }).text ?? '')
        : '')
      .join('\n')
      .trim();
  }
  return '';
}

async function requestVisionCompletion(
  config: VisionAiConfig,
  prompt: string,
  imageDataUrl: string,
  context?: AiDocumentContext,
): Promise<ProviderChatResult> {
  if (config.mode !== 'separate' || !config.apiKey || !config.baseUrl || !config.model) {
    throw new Error('当前问题需要查看 PDF 图像。请在“设置 → 视觉模型”中完成配置。');
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: [
            '你是 PDF Helper 的视觉阅读工具。请只分析图片中实际可见的 PDF 页面。',
            '优先识别图表、公式、表格、流程图、页面结构以及文字抽取遗漏的信息。',
            '不确定时明确说明，不要补写图片中不存在的内容。数学表达使用 LaTeX。',
            context?.documentName ? `文档：${context.documentName}` : '',
            context?.pageNumber ? `页码：第 ${context.pageNumber} 页` : '',
          ].filter(Boolean).join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        },
      ],
      stream: false,
      max_tokens: 1600,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getProviderError(payload, `视觉模型请求失败：HTTP ${response.status}`));
  }
  const content = getVisionContent(payload);
  if (!content) throw new Error('视觉模型没有返回有效内容。');
  console.info('[PDF Helper Vision] 页面视觉分析完成', {
    model: config.model,
    pageNumber: context?.pageNumber,
    promptLength: prompt.length,
  });
  return { content, model: config.model };
}

type ProviderMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' | 'low' | 'high' } }
>;

type ProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ProviderMessageContent;
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

function buildConversation(
  messages: AiConversationMessage[],
  context?: AiDocumentContext,
  supportsVision = false,
): ProviderMessage[] {
  const conversation: ProviderMessage[] = messages
    .filter((item) => item.content.trim() || (supportsVision && item.images?.length))
    .slice(-16)
    .map((item) => {
      const text = item.content.trim().slice(0, 16000);
      if (!supportsVision || item.role !== 'user' || !item.images?.length) {
        return { role: item.role, content: text };
      }
      return {
        role: item.role,
        content: [
          { type: 'text' as const, text: text || '请分析这些截图。' },
          ...item.images.slice(0, 3).map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.dataUrl, detail: 'high' as const },
          })),
        ],
      };
    });
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: buildAiSystemContent(context) },
    ...conversation,
  ];
  console.groupCollapsed(`[PDF Helper AI] ${context?.task || '未命名请求'} · 最终发送内容`);
  console.log('引用元数据', {
    documentName: context?.documentName,
    sourceScope: context?.sourceScope,
    sourceLabel: context?.sourceLabel,
    sourcePages: context?.sourcePages,
    selectedTextLength: context?.selectedText?.length ?? 0,
    contextLength: context?.pageText?.length ?? 0,
    readingMode: context?.readingMode,
    imageCount: messages.reduce((count, message) => count + (message.images?.length ?? 0), 0),
    supportsVision,
  });
  console.log('最终 Provider Messages', providerMessages);
  console.groupEnd();
  return providerMessages;
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
    buildConversation(request.messages, request.context, isMainAiVisionCapable(config)),
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
    if (message.type === 'pdf-helper:ai-vision' || message.type === 'pdf-helper:ai-vision-test') {
      const visionConfig = await getVisionAiConfig();
      const result = await requestVisionCompletion(
        visionConfig,
        message.type === 'pdf-helper:ai-vision-test'
          ? '这是连接测试图。请只回答“视觉连接成功”。'
          : message.prompt,
        message.type === 'pdf-helper:ai-vision-test'
          ? message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg=='
          : message.imageDataUrl,
        message.type === 'pdf-helper:ai-vision' ? message.context : undefined,
      );
      return { ok: true, content: result.content, model: result.model };
    }

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
      buildConversation(message.messages, message.context, isMainAiVisionCapable(config)),
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
