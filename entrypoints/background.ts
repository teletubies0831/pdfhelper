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
  AGENT_TOOL_DEFINITIONS,
  getAgentToolDefinitionByApiName,
  getNativeAgentTools,
} from '../shared/agent-tools';
import {
  AI_CONFIG_STORAGE_KEY,
  AI_STREAM_PORT_NAME,
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  VISION_AI_CONFIG_STORAGE_KEY,
  isAiRuntimeRequest,
  normalizeAiBaseUrl,
  normalizeAiMaxOutputTokens,
  type AiConfig,
  type AiConversationMessage,
  type AiDocumentContext,
  type AiMemoryCandidate,
  type AiRuntimeRequest,
  type AiRuntimeResponse,
  type AiStreamCompletionInfo,
  type AiStreamDebugInfo,
  type AiStreamErrorInfo,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type AiStreamToolResultsMessage,
  type AiStreamToolResult,
  type AiNativeToolCall,
  type VisionAiConfig,
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
    translationModel:
      source?.translationModel?.trim()
      || source?.model?.trim()
      || DEFAULT_AI_CONFIG.translationModel,
    maxOutputTokens: normalizeAiMaxOutputTokens(source?.maxOutputTokens),
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

type ProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

interface ProviderChatResult {
  content: string;
  model: string;
  reasoningContent?: string;
  toolCalls?: AiNativeToolCall[];
  completion?: AiStreamCompletionInfo;
}

interface ProviderStreamDelta {
  content?: string;
  reasoningContent?: string;
}

class AiProviderRequestError extends Error {
  constructor(
    message: string,
    readonly details: AiStreamErrorInfo,
  ) {
    super(message);
    this.name = 'AiProviderRequestError';
  }
}

function getSafeErrorDetails(error: unknown): AiStreamErrorInfo {
  if (error instanceof AiProviderRequestError) return error.details;
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
  };
}

function getVisionContent(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => item && typeof item === 'object' && 'text' in item
      ? String((item as { text?: unknown }).text ?? '')
      : '')
    .join('\n')
    .trim();
}

async function requestVisionCompletion(
  config: VisionAiConfig,
  prompt: string,
  imageDataUrl: string,
  context?: AiDocumentContext,
): Promise<ProviderChatResult> {
  if (config.mode !== 'separate' || !config.apiKey || !config.baseUrl || !config.model) {
    throw new Error('请先在“设置”中完成视觉模型配置。');
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
            '你是 PDF Helper 的视觉阅读工具，只分析图片中实际可见的内容。',
            '优先识别图表、公式、表格、流程图、页面结构以及文字抽取遗漏的信息。',
            '不确定时明确说明，不要补写图片中不存在的内容。',
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
  return { content, model: config.model };
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
    onDelta: (delta: ProviderStreamDelta) => void,
    options?: {
      toolChoice?: 'auto' | 'none' | 'required';
      tools?: Array<Record<string, unknown>>;
    },
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
    onDelta: (delta: ProviderStreamDelta) => void,
    options: {
      toolChoice?: 'auto' | 'none' | 'required';
      tools?: Array<Record<string, unknown>>;
    } = {},
  ): Promise<ProviderChatResult> {
    if (!config.apiKey) throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          thinking: { type: config.reasoning },
          // Tool definitions are sent through the provider's native `tools`
          // parameter. They are intentionally not duplicated in the system
          // prompt, so the provider can emit standard tool_calls.
          ...(options.tools?.length ? { tools: options.tools } : {}),
          ...(options.tools?.length ? { tool_choice: options.toolChoice ?? 'auto' } : {}),
          stream: true,
          max_tokens: maxOutputTokens,
        }),
        signal,
      });
      console.info('[PDF Helper AI] native tools payload', {
        toolChoice: options.tools?.length ? options.toolChoice ?? 'auto' : 'none',
        tools: (options.tools ?? []).map((tool) => (
          tool && typeof tool === 'object' && 'function' in tool
            ? (tool as { function?: { name?: unknown } }).function?.name
            : undefined
        )).filter(Boolean),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AiProviderRequestError(
        `无法连接 AI 供应商：${error instanceof Error ? error.message : String(error)}`,
        {
          name: error instanceof Error ? error.name : 'ProviderNetworkError',
          model: config.model,
          baseUrl: config.baseUrl,
        },
      );
    }

    const providerRequestId = response.headers.get('x-request-id')
      ?? response.headers.get('request-id')
      ?? undefined;
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      let payload: unknown = null;
      try {
        payload = responseBody ? JSON.parse(responseBody) : null;
      } catch {
        // Keep the raw body in the safe diagnostics below.
      }
      throw new AiProviderRequestError(
        getProviderError(payload, `AI 请求失败：HTTP ${response.status}`),
        {
          name: 'ProviderHttpError',
          httpStatus: response.status,
          responseBody: responseBody.slice(0, 4000),
          model: config.model,
          baseUrl: config.baseUrl,
          providerRequestId,
        },
      );
    }
    if (!response.body) {
      throw new AiProviderRequestError('当前浏览器没有提供可读取的 AI 流式响应。', {
        name: 'MissingResponseBodyError',
        httpStatus: response.status,
        model: config.model,
        baseUrl: config.baseUrl,
        providerRequestId,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completeContent = '';
    let completeReasoningContent = '';
    let finished = false;
    let finishReason: string | undefined;
    let receivedDoneMarker = false;
    let eventCount = 0;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let totalTokens: number | undefined;
    const toolCallParts = new Map<number, { id: string; name: string; arguments: string }>();

    const processEvent = (event: string): boolean => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data) return false;
      eventCount += 1;
      if (data === '[DONE]') {
        receivedDoneMarker = true;
        return true;
      }
      let payload: {
        error?: unknown;
        usage?: {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
          total_tokens?: unknown;
        };
        choices?: Array<{
          finish_reason?: unknown;
          delta?: {
            content?: unknown;
            reasoning_content?: unknown;
            tool_calls?: Array<{
              index?: unknown;
              id?: unknown;
              type?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            }>;
          };
        }>;
      };
      try {
        payload = JSON.parse(data) as typeof payload;
      } catch (error) {
        throw new AiProviderRequestError('AI 流式响应包含无法解析的数据。', {
          name: error instanceof Error ? error.name : 'StreamParseError',
          httpStatus: response.status,
          responseBody: data.slice(0, 2000),
          model: config.model,
          baseUrl: config.baseUrl,
          contentLength: completeContent.length,
          reasoningLength: completeReasoningContent.length,
          finishReason,
          receivedDoneMarker,
          eventCount,
          providerRequestId,
        });
      }
      if (payload.error) {
        throw new AiProviderRequestError(
          getProviderError(payload, 'AI 供应商在流式响应中返回了错误。'),
          {
            name: 'ProviderStreamError',
            httpStatus: response.status,
            responseBody: JSON.stringify(payload).slice(0, 4000),
            model: config.model,
            baseUrl: config.baseUrl,
            contentLength: completeContent.length,
            reasoningLength: completeReasoningContent.length,
            finishReason,
            receivedDoneMarker,
            eventCount,
            providerRequestId,
          },
        );
      }
      const choice = payload.choices?.[0];
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      const usage = payload.usage;
      if (typeof usage?.prompt_tokens === 'number') promptTokens = usage.prompt_tokens;
      if (typeof usage?.completion_tokens === 'number') completionTokens = usage.completion_tokens;
      if (typeof usage?.total_tokens === 'number') totalTokens = usage.total_tokens;
      const delta = choice?.delta;
      const reasoningContent = delta?.reasoning_content;
      if (typeof reasoningContent === 'string' && reasoningContent) {
        completeReasoningContent += reasoningContent;
        onDelta({ reasoningContent });
      }
      const content = delta?.content;
      if (typeof content === 'string' && content) {
        completeContent += content;
        onDelta({ content });
      }
      for (const part of delta?.tool_calls ?? []) {
        const index = Number.isFinite(Number(part.index)) ? Number(part.index) : toolCallParts.size;
        const existing = toolCallParts.get(index) ?? { id: '', name: '', arguments: '' };
        if (typeof part.id === 'string' && part.id) existing.id = part.id;
        if (typeof part.function?.name === 'string') existing.name += part.function.name;
        if (typeof part.function?.arguments === 'string') existing.arguments += part.function.arguments;
        toolCallParts.set(index, existing);
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

    const completion: AiStreamCompletionInfo = {
      finishReason,
      promptTokens,
      completionTokens,
      totalTokens,
      contentLength: completeContent.length,
      reasoningLength: completeReasoningContent.length,
      receivedDoneMarker,
      eventCount,
      httpStatus: response.status,
      providerRequestId,
    };

    const toolCalls: AiNativeToolCall[] = Array.from(toolCallParts.entries())
      .sort(([left], [right]) => left - right)
      .flatMap(([index, part]) => {
        if (!part.name) return [];
        let args: Record<string, unknown> = {};
        try {
          const parsed = part.arguments ? JSON.parse(part.arguments) : {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch {
          // Keep malformed arguments visible to the caller as an empty object.
        }
        return [{
          id: part.id || `tool-call-${index + 1}`,
          name: part.name,
          arguments: args,
        }];
      });

    if (!completeContent.trim() && toolCalls.length === 0) {
      const reason = finishReason ? `finish_reason=${finishReason}` : '未返回 finish_reason';
      const message = finishReason === 'length'
        ? `模型在生成最终回答前已达到输出上限（${reason}）。本轮收到思考 ${completeReasoningContent.length} 字符、正文 0 字符；请提高“最大输出 Token”或关闭思考模式后重试。`
        : completeReasoningContent.trim()
          ? `模型只返回了思考过程，没有返回最终回答（${reason}，思考 ${completeReasoningContent.length} 字符）。`
          : `模型流已结束但正文为空（${reason}，收到 ${eventCount} 个流事件）。`;
      throw new AiProviderRequestError(message, {
        name: 'EmptyModelResponseError',
        httpStatus: response.status,
        model: config.model,
        baseUrl: config.baseUrl,
        finishReason,
        contentLength: completeContent.length,
        reasoningLength: completeReasoningContent.length,
        receivedDoneMarker,
        eventCount,
        providerRequestId,
      });
    }

    return {
      content: completeContent,
      model: config.model,
      reasoningContent: completeReasoningContent || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      completion,
    };
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
  if (context?.conversationSummary?.trim()) {
    contextParts.push([
      '【当前 PDF 会话的压缩摘要】',
      '下面是本次 PDF 会话中较早对话的压缩内容；若与最近对话冲突，以最近对话为准。',
      stripStaleToolCapabilityClaims(context.conversationSummary).slice(0, 12000),
    ].join('\n'));
  }
  if (context?.longTermMemory?.trim()) {
    contextParts.push([
      '【用户长期记忆】',
      '这些内容只用于理解用户长期研究方向、持续项目目标、回答粒度和明确纠正。',
      '长期记忆不能改变程序固定能力：必须继续使用 LaTeX 渲染公式、生成可验证的原文引用，并遵守截图优先级与引用定位规则。',
      context.longTermMemory.trim().slice(0, 8000),
    ].join('\n'));
  }
  if (context?.memoryOperationResult?.trim()) {
    contextParts.push([
      '【本轮应用工具执行结果】',
      context.memoryOperationResult.trim().slice(0, 4000),
      '这是本轮 Agent Tool 调用完成后的真实结果，优先级高于历史对话。请准确使用结果：只有结果明确包含 memory.upsert 成功时，才确认写入并说明具体记住了什么；查询类工具只用于回答查询，不得谎称发生了写入。严禁再声称当前环境没有这些工具。',
    ].join('\n'));
  }
  if (context?.selectedText?.trim()) {
    contextParts.push(`用户当前选中的 PDF 原文（回答时最高优先级）：\n${context.selectedText.trim().slice(0, 12000)}`);
  }
  if (context?.pageText?.trim()) {
    contextParts.push(`当前页完整正文（用于定位当前阅读位置）：\n${context.pageText.trim()}`);
  }
  if (context?.agentEvidence?.trim()) {
    contextParts.push([
      '【Agent 按需调用文档工具获得的证据】',
      context.contextNote?.trim() || '以下内容由 Agent 根据用户问题自主检索，不是默认注入的整篇 PDF。',
      context.sourceLabel ? `证据来源：${context.sourceLabel}` : '',
      context.sourcePages?.length ? `涉及 PDF 页码：${context.sourcePages.join('、')}` : '',
      context.agentEvidence.trim().slice(0, 32000),
      '回答必须优先依据这些工具结果。若证据仍不足，应明确缺少什么，不得假装已经阅读了未检索的页面。',
    ].filter(Boolean).join('\n'));
  }
  if (context?.documentText?.trim()) {
    const documentInstructions = context?.imageAnalysis?.trim()
      ? [
        '下面提供整篇论文的全部可提取正文，已按 PDF 页码分隔。',
        '本轮必须先回答截图中实际展示的内容；论文全文仅用于补充截图的背景、术语、方法位置和上下文。',
        '不得跳过截图分析并直接输出当前页概述或整篇论文总结。',
      ]
      : [
        '下面提供的是整篇论文的全部可提取正文，已按 PDF 页码分隔。',
        '回答前必须先综合全文判断研究问题、方法、实验、证据、结论和局限，不能只依据当前页。',
        '当前页和用户选区用于确定提问重点，但全文内容是回答的完整依据。',
      ];
    contextParts.push([
      ...documentInstructions,
      `论文全文：\n${context.documentText.trim()}`,
    ].join('\n'));
  }
  if (context?.imageAnalysis?.trim()) {
    contextParts.push([
      '【本轮用户截图——最高优先级】',
      '用户问题中的“这部分”“这里”“这个”“图里”等指代，默认且必须指向用户上传的截图。',
      '请直接解释截图中实际出现的内容，不要把问题改写成“当前 PDF 页面讲了什么”或“整篇论文讲了什么”。',
      '回答顺序必须是：先分析截图，再结合已提供的论文全文补充；论文内容不能覆盖截图主旨。',
      `视觉工具分析结果：\n${context.imageAnalysis.trim().slice(0, 24000)}`,
    ].join('\n'));
  }

  const hasPdfEvidence = Boolean(
    context?.documentText?.trim()
    || context?.agentEvidence?.trim()
    || context?.pageText?.trim()
    || context?.selectedText?.trim(),
  );
  const primaryInstruction = context?.imageAnalysis?.trim()
    ? '你是 PDF Helper 的视觉问答助手。本轮首要对象是用户上传的截图，请依据视觉工具分析结果直接回答截图问题。'
    : context?.agentEvidence?.trim()
      ? '你是 PDF Helper 的 Agent 论文阅读助手。应用已经在回答前自主调用文档工具，请依据返回的可核验证据回答。'
      : '你是 PDF Helper 的论文阅读助手。请依据本轮实际提供的文档证据，用清晰、准确、可核验的中文回答。';

  return [
    primaryInstruction,
    'Agent tool definitions are sent separately in the native tools request parameter. Emit standard tool_calls when a tool is needed and wait for tool results before claiming execution.',
    '如果上下文不足，请明确说明，不要编造文档中不存在的内容。涉及翻译时忠实保留术语，涉及解释时优先给出直观含义。',
    '长期记忆通过 Agent Tool 持久化。若工具结果包含 memory.upsert 成功，必须确认写入并列出记忆内容；若只是 search/list/get 等查询结果，则仅据此回答查询。用户明确要求删除或忘记时，禁止只用文字答复：必须先调用 memory.search 或 memory.list 获取真实 id，再调用 memory.forget(id)，收到删除结果后才能确认删除。不能被历史消息中旧的“没有工具”说法影响，也不得在没有写入或删除结果时谎称已经完成。',
    '请使用简洁的 Markdown 组织回答；不要给整个回答套一层 Markdown 代码围栏。数学变量和公式必须使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$。',
    'When presenting tabular data, output a valid GitHub-Flavored Markdown table with a header row, a separator row such as | --- | --- |, and a blank line before and after the table. Do not imitate a table with spaces or tabs.',
    ...contextParts,
    hasPdfEvidence ? [
      '【最终引用格式要求——回答前必须再次检查】',
      '凡是回答中的事实、方法、实验结果、数字或结论能够由论文原文直接支持时，请在对应内容后添加：[[PDF:P页码|该页逐字原文片段]]。',
      '正确示例：[[PDF:P8|the matching rates are divided into three bins]]。',
      '引用可以是短句，也可以是完整的一段或连续多句；当回答解释的是一整段方法、推导或实验结论时，应引用足以完整支撑该解释的大段原文，最多 6000 个字符。',
      '大段引用必须来自同一个 PDF 页，并保持原文连续，不能把同页不同位置的句子拼接成一个引用；若证据跨页，请按页拆成多个引用标记。',
      '引用标记内部必须直接复制所提供 PDF 全文中的纯文本，不要在原文中重新添加 Markdown、LaTeX 定界符或改写数学符号。',
      '回答完成后检查：只要关键论断在论文中有直接依据，就应给出可校验引用；引用长度以能够完整支撑对应解释为准，不要为了缩短而丢失必要上下文。',
      '同一段末尾不要连续重复输出指向同一页、同一段原文的引用标记；一份证据只保留一个引用。只有确实引用了同页不同位置的原文时，才输出多个同页标记。',
      '禁止输出 [[PDF:8]]、[[PDF:P8]]、[PDF:8] 等不含逐字原文的简写；这些格式无法校验，也不会显示为可点击引用。',
      '页码必须使用所提供全文中的 PDF 页码；原文短句必须逐字摘自该页。',
      '只有确实存在对应原文时才能添加标记。无法找到逐字原文时不要添加引用，严禁编造页码、改写原句后冒充原文或给推测性内容添加引用。',
      '引用标记只用于事实依据，不要单独列出参考文献清单。',
    ].join('\n') : '',
    // Keep the capability catalog at the very end as well. Long PDF text can
    // be large, and the model must not lose this authoritative runtime fact.
    'Available tools are supplied by the runtime through the native tools parameter. Only claim a tool was executed after receiving its result; otherwise state that execution has not happened.',
    '以上工具属于当前 Agent 运行时。文档检索、视觉检查和记忆写入会在最终回答前由应用执行；如本轮给出工具执行结果，说明对应调用已经真实完成。',
  ].filter(Boolean).join('\n\n');
}

function stripStaleToolCapabilityClaims(value: string): string {
  return value
    .split(/\n{2,}/)
    .filter((paragraph) => !(
      /(?:工具列表|Agent\s*工具列表).{0,20}(?:为空|空的|没有)/i.test(paragraph)
      || /(?:没有|不存在|未注册|无法使用|不能调用|没有给我).{0,40}(?:记忆|长期记忆|Agent)?\s*工具/i.test(paragraph)
      || /(?:无法|不能).{0,20}(?:写入|持久化).{0,20}长期记忆/i.test(paragraph)
      || /等.{0,30}(?:支持|可用).{0,20}工具.{0,20}(?:补写|再写)/i.test(paragraph)
    ))
    .join('\n\n')
    .trim();
}

function buildConversation(
  messages: AiConversationMessage[],
  context?: AiDocumentContext,
): ProviderMessage[] {
  const conversation: ProviderMessage[] = messages
    .filter((item) => item.content.trim())
    .slice(-16)
    .map((item) => {
      let content = item.content.trim();
      if (item.role === 'assistant') {
        // Older builds incorrectly told users that no memory tool existed.
        // Those stale capability claims must not override the current system
        // tool result when a persisted conversation is restored.
        content = stripStaleToolCapabilityClaims(content);
      }
      return { role: item.role, content: content.slice(0, 16000) };
    })
    .filter((item) => item.content);
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

function isAiStreamToolResultsMessage(value: unknown): value is AiStreamToolResultsMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiStreamToolResultsMessage>;
  return candidate.type === 'tool-results'
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.results);
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
  waitForToolResults: (requestId: string, signal: AbortSignal) => Promise<AiStreamToolResult[]>,
): Promise<void> {
  const config = await getAiConfig();
  const adapter = getProviderAdapter(config);
  const maxOutputTokens = config.maxOutputTokens;
  const conversation = buildConversation(request.messages, request.context);
  const nativeTools = getNativeAgentTools();
  const workingConversation: ProviderMessage[] = [...conversation];
  const toDebugMessage = (item: ProviderMessage): AiStreamDebugInfo['messages'][number] => ({
    role: item.role,
    content: item.content,
    ...(item.tool_calls?.length
      ? {
        toolCalls: item.tool_calls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: (() => {
            try {
              const parsed = JSON.parse(call.function.arguments);
              return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
            } catch {
              return {};
            }
          })(),
        })),
      }
      : {}),
    ...(item.tool_call_id ? { toolCallId: item.tool_call_id } : {}),
  });
  const debug: AiStreamDebugInfo = {
    providerId: config.providerId,
    model: config.model,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning,
    maxOutputTokens,
    messages: conversation.map(toDebugMessage),
    availableTools: AGENT_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSummary,
    })),
    completedTools: request.context?.completedTools?.map((tool) => ({ ...tool })) ?? [],
    nativeTools,
    toolChoice: 'auto',
  };
  postAiStreamMessage(port, {
    type: 'started',
    requestId: request.requestId,
    model: config.model,
    debug,
  });
  const maxToolRounds = 8;
  for (let round = 1; round <= maxToolRounds; round += 1) {
    const result = await adapter.stream(
      config,
      workingConversation,
      maxOutputTokens,
      signal,
      (delta) => {
        if (delta.reasoningContent) {
          postAiStreamMessage(port, {
            type: 'reasoning-delta',
            requestId: request.requestId,
            content: delta.reasoningContent,
          });
        }
        if (delta.content) {
          postAiStreamMessage(port, {
            type: 'delta',
            requestId: request.requestId,
            content: delta.content,
          });
        }
      },
      { tools: nativeTools, toolChoice: 'auto' },
    );

    if (!result.toolCalls?.length) {
      postAiStreamMessage(port, {
        type: 'done',
        requestId: request.requestId,
        model: result.model,
        debug: {
          ...debug,
          messages: workingConversation.map(toDebugMessage),
        },
        completion: result.completion,
      });
      return;
    }

    console.info('[PDF Helper AI] 原生工具调用请求', {
      requestId: request.requestId,
      round,
      calls: result.toolCalls,
    });
    postAiStreamMessage(port, {
      type: 'tool-calls',
      requestId: request.requestId,
      calls: result.toolCalls,
      round,
    });
    const toolResults = await waitForToolResults(request.requestId, signal);
    if (signal.aborted) return;
    if (!toolResults.length) {
      throw new AiProviderRequestError('Agent 工具没有返回结果，无法继续生成回答。', {
        name: 'MissingToolResultsError',
        model: config.model,
        baseUrl: config.baseUrl,
      });
    }
    workingConversation.push({
      role: 'assistant',
      content: result.content || '',
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    });
    for (const toolResult of toolResults) {
      workingConversation.push({
        role: 'tool',
        tool_call_id: toolResult.toolCallId,
        content: toolResult.content.slice(0, 16000),
      });
      debug.completedTools.push({
        name: toolResult.name,
        arguments: result.toolCalls.find((call) => call.id === toolResult.toolCallId)?.arguments,
      });
    }
    console.info('[PDF Helper AI] 原生工具结果', {
      requestId: request.requestId,
      round,
      results: toolResults,
    });
  }
  throw new AiProviderRequestError(`Agent 工具调用超过 ${maxToolRounds} 轮，已停止继续请求。`, {
    name: 'ToolRoundLimitError',
    model: config.model,
    baseUrl: config.baseUrl,
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
          ? '这是连接测试图，请只回答“视觉连接成功”。'
          : message.prompt,
        message.type === 'pdf-helper:ai-vision-test'
          ? message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg=='
          : message.imageDataUrl,
        message.type === 'pdf-helper:ai-vision' ? message.context : undefined,
      );
      return { ok: true, content: result.content, model: result.model };
    }

    const savedConfig = await getAiConfig();
    const requestOverride =
      message.type === 'pdf-helper:ai-chat' ? message.configOverride : undefined;
    const config: AiConfig = requestOverride
      ? {
          ...savedConfig,
          ...requestOverride,
          model: requestOverride.model?.trim() || savedConfig.model,
          reasoning: requestOverride.reasoning ?? savedConfig.reasoning,
          maxOutputTokens: normalizeAiMaxOutputTokens(
            requestOverride.maxOutputTokens ?? savedConfig.maxOutputTokens,
          ),
        }
      : savedConfig;
    const adapter = getProviderAdapter(config);

    if (message.type === 'pdf-helper:ai-test') {
      const models = await adapter.test(config);
      return { ok: true, models };
    }

    if (message.type === 'pdf-helper:ai-compress-conversation') {
      const transcript = message.messages
        .filter((item) => item.content.trim())
        .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.trim().slice(0, 12000)}`)
        .join('\n\n')
        .slice(0, 80000);
      if (!transcript) throw new Error('没有可压缩的对话内容。');
      // Conversation compression is a summarization task. Reasoning mode can
      // consume the entire small output budget as reasoning_content and leave
      // message.content empty, which looks like a failed compression to the
      // viewer. Keep the user's reasoning preference for the main chat only.
      const compressionConfig: AiConfig = {
        ...config,
        reasoning: 'disabled',
      };
      const result = await adapter.chat(compressionConfig, [{
        role: 'system',
        content: [
          '你是对话记忆压缩器。请把较早的 PDF 阅读对话压缩成可供后续模型继续交流的中文长期摘要。',
          '必须保留：用户真实目标和偏好、用户纠正过的内容、重要术语与公式含义、已确认结论、关键页码或引用线索、尚未解决的问题以及后续约定。',
          '删除：寒暄、重复解释、过程性状态、冗长原文复制和已经失效的临时信息。',
          '不要补充论文或对话中没有的信息，不要回答用户当前问题，不要输出引用标记。',
          '使用紧凑的分点结构，只输出摘要正文，控制在 4000 个中文字符以内。',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          message.previousSummary?.trim()
            ? `已有长期摘要（请与新增对话合并）：\n${message.previousSummary.trim().slice(0, 12000)}`
            : '当前尚无长期摘要。',
          `需要并入摘要的新增旧对话：\n${transcript}`,
        ].join('\n\n'),
      }], Math.min(4096, config.maxOutputTokens));
      return { ok: true, content: result.content.slice(0, 12000), model: result.model };
    }

    if (message.type === 'pdf-helper:ai-plan-knowledge-tools') {
      const availableNames = [
        'memory.search',
        'memory.list',
        'memory.forget',
        'library.searchPapers',
        'library.getPaper',
      ];
      const payload = await fetchProviderJson('/chat/completions', config, {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: [{
            role: 'system',
            content: [
              '你是 PDF Helper 的记忆与历史文献 Agent。根据用户本轮问题决定是否调用已通过原生 tools 参数提供的函数，不直接回答用户。',
              '用户询问已保存的信息时调用记忆查询函数；需要查找某项偏好或资料时也调用记忆查询函数。',
              '用户明确要求忘记或删除时，必须先查询并取得真实条目 id，再调用删除函数；没有删除函数结果时不能声称已删除。',
              '询问以前看过、读过或相关的历史 PDF 时调用文献查询函数；获得 documentId 后可调用文献详情函数。',
              '问题与长期记忆或历史文献无关时不要调用任何工具。',
            ].join('\n'),
          }, {
            role: 'user',
            content: [
              message.documentName ? `当前 PDF：${message.documentName}` : '',
              message.documentId ? `当前 PDF ID：${message.documentId}` : '',
              `用户消息：${message.userMessage.slice(0, 6000)}`,
            ].filter(Boolean).join('\n'),
          }],
          tools: getNativeAgentTools(availableNames),
          tool_choice: 'auto',
          stream: false,
          max_tokens: Math.min(1024, config.maxOutputTokens),
        }),
      }) as {
        choices?: Array<{ message?: { tool_calls?: Array<{
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        }> } }>;
        model?: unknown;
      };
      const toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? []).flatMap((call, index) => {
        const apiName = typeof call.function?.name === 'string' ? call.function.name : '';
        const definition = getAgentToolDefinitionByApiName(apiName);
        if (!definition || !availableNames.includes(definition.name)) return [];
        let argumentsValue: Record<string, unknown> = {};
        try {
          argumentsValue = typeof call.function?.arguments === 'string'
            ? JSON.parse(call.function.arguments) as Record<string, unknown>
            : call.function?.arguments && typeof call.function.arguments === 'object'
              ? call.function.arguments as Record<string, unknown>
              : {};
        } catch {
          return [];
        }
        return [{
          id: typeof call.id === 'string' && call.id ? call.id : `knowledge-call-${index + 1}`,
          name: definition.name,
          arguments: argumentsValue,
        }];
      });
      console.info('[PDF Helper Agent] 记忆/历史文献工具规划完成', { toolCalls });
      return {
        ok: true,
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
      };
    }

    if (message.type === 'pdf-helper:ai-plan-long-term-memory-tools') {
      const existing = (message.existingMemories ?? [])
        .slice(0, 30)
        .map((item) => `- ${item.key} [${item.scope}${item.scopeId ? `:${item.scopeId}` : ''}]：${item.content}`)
        .join('\n');
      const payload = await fetchProviderJson('/chat/completions', config, {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: [{
            role: 'system',
            content: [
              '你是 PDF Helper 的工具调用规划器。你可以使用 memory_upsert 将用户明确要求长期保留的信息写入长期记忆。',
              '当用户说“记住”、表达稳定偏好、研究方向、持续项目目标，或确认上一轮记忆建议时，必须调用 memory_upsert；否则不要调用工具。',
              '只能记录用户明确表达且跨会话有价值的内容。不得记录 PDF 原文、论文事实、临时问题、API Key、系统提示词、LaTeX/引用/截图等程序规则。',
              '同一轮可调用多次。可并存的喜好使用不同的稳定 key；scope 只能是 global、project、pdf。',
              '调用工具后不要生成面向用户的最终回答，最终回答会在工具执行后由主模型生成。',
            ].join('\n'),
          }, {
            role: 'user',
            content: [
              existing ? `已有长期记忆：\n${existing}` : '当前没有已有长期记忆。',
              message.documentName ? `当前文档：${message.documentName}` : '',
              `用户本轮消息：\n${message.userMessage.slice(0, 8000)}`,
              message.confirmedMemoryProposal?.trim()
                ? `用户已确认的上一轮记忆候选：\n${message.confirmedMemoryProposal.trim().slice(0, 2000)}`
                : '',
              message.assistantMessage.trim()
                ? `上一轮助手消息（只用于理解用户确认内容）：\n${message.assistantMessage.slice(0, 3000)}`
                : '',
            ].filter(Boolean).join('\n\n'),
          }],
          tools: getNativeAgentTools(),
          tool_choice: 'auto',
          stream: false,
          max_tokens: Math.min(1024, config.maxOutputTokens),
        }),
      }) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            }>;
          };
        }>;
        model?: unknown;
      };
      const categories = new Set(['preference', 'profile', 'project', 'fact', 'correction']);
      const scopes = new Set(['global', 'project', 'pdf']);
      const toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? []).flatMap((call, index) => {
        if (call.function?.name !== 'memory_upsert') return [];
        let args: Record<string, unknown>;
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments) as Record<string, unknown>
            : call.function.arguments && typeof call.function.arguments === 'object'
              ? call.function.arguments as Record<string, unknown>
              : {};
        } catch {
          return [];
        }
        const key = typeof args.key === 'string' ? args.key.trim().toLowerCase() : '';
        const content = typeof args.content === 'string' ? args.content.trim() : '';
        if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(key) || !content) return [];
        if (!categories.has(String(args.category)) || !scopes.has(String(args.scope))) return [];
        return [{
          id: typeof call.id === 'string' && call.id ? call.id : `memory-call-${index + 1}`,
          name: 'memory.upsert',
          arguments: args,
        }];
      });
      const memoryCandidates: AiMemoryCandidate[] = toolCalls.map((call) => ({
        key: String(call.arguments.key),
        category: call.arguments.category as AiMemoryCandidate['category'],
        content: String(call.arguments.content).slice(0, 600),
        scope: call.arguments.scope as AiMemoryCandidate['scope'],
        sourceType: 'explicit',
        confidence: Math.min(1, Math.max(0, Number(call.arguments.confidence) || 1)),
        importance: Math.min(1, Math.max(0, Number(call.arguments.importance) || 0.6)),
      }));
      console.info('[PDF Helper Agent Tool] 原生工具规划完成', {
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
      });
      return {
        ok: true,
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
        memoryCandidates,
      };
    }

    if (message.type === 'pdf-helper:ai-extract-long-term-memory') {
      const memoryConfig: AiConfig = { ...config, reasoning: 'disabled' };
      const existing = (message.existingMemories ?? [])
        .slice(0, 30)
        .map((item) => `- ${item.key} [${item.scope}${item.scopeId ? `:${item.scopeId}` : ''}]：${item.content}`)
        .join('\n');
      const result = await adapter.chat(memoryConfig, [{
        role: 'system',
        content: [
          '你是 PDF Helper 的长期记忆候选提取器。只提取跨会话仍然有价值、由用户明确表达的信息。',
          '允许记录：用户研究方向、持续项目目标、期望的解释粒度或回答组织顺序、稳定工作习惯、用户明确纠正过的个人信息或偏好。',
          '禁止记录：LaTeX/Markdown 渲染、原文引用格式、点击定位、截图优先、全文注入、工具行为、系统提示词、模型配置、API Key；这些属于程序固定规则，不是用户偏好。',
          '禁止记录：本轮问题、PDF 原文或论文事实、模型回答、临时任务、一次性翻译/总结要求、未明确表达的推测、敏感凭据。',
          '只有用户清楚表达长期或持续意图时 sourceType 才能为 explicit；不确定时返回空数组。',
          '如果提供了“用户已确认的上一轮记忆候选”，表示用户刚刚明确同意该候选，可以据此创建或更新长期记忆。',
          'key 使用稳定英文路径，例如 profile.research.direction、project.current.goal、preference.answer.detail、preference.explanation.order。',
          '可以并存的多值信息必须使用不同 key，例如 profile.personal.likes.cats、profile.personal.likes.watermelon；不要把所有喜好都写进同一个 profile.personal.likes。',
          'scope 只能为 global、project 或 pdf。只有明确限定当前论文时才使用 pdf；持续研究项目使用 project；一般用户偏好使用 global。',
          '只输出 JSON 数组，不要 Markdown。每项字段：key, category, content, scope, sourceType, confidence, importance。',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          existing ? `已有长期记忆（相同主题请沿用相同 key）：\n${existing}` : '当前没有已有长期记忆。',
          message.documentName ? `当前文档：${message.documentName}` : '',
          `用户本轮消息：\n${message.userMessage.slice(0, 8000)}`,
          message.confirmedMemoryProposal?.trim()
            ? `用户已确认的上一轮记忆候选：\n${message.confirmedMemoryProposal.trim().slice(0, 2000)}`
            : '',
          `助手回答仅用于理解上下文，不得把助手内容保存为用户记忆：\n${message.assistantMessage.slice(0, 4000)}`,
        ].filter(Boolean).join('\n\n'),
      }], Math.min(2048, config.maxOutputTokens));
      const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const arrayStart = cleaned.indexOf('[');
      const arrayEnd = cleaned.lastIndexOf(']');
      const objectStart = cleaned.indexOf('{');
      const objectEnd = cleaned.lastIndexOf('}');
      const jsonText = arrayStart >= 0 && arrayEnd > arrayStart
        ? cleaned.slice(arrayStart, arrayEnd + 1)
        : objectStart >= 0 && objectEnd > objectStart
          ? cleaned.slice(objectStart, objectEnd + 1)
          : '';
      if (!jsonText) {
        console.warn('[PDF Helper 长期记忆] 提取模型没有返回可解析 JSON', {
          model: result.model,
          content: cleaned.slice(0, 1200),
        });
        return { ok: true, memoryCandidates: [], model: result.model };
      }
      const parsed = JSON.parse(jsonText) as unknown;
      const parsedItems = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? [parsed]
          : [];
      const categories = new Set(['preference', 'profile', 'project', 'fact', 'correction']);
      const scopes = new Set(['global', 'project', 'pdf']);
      const candidates: AiMemoryCandidate[] = parsedItems
        .flatMap((value): AiMemoryCandidate[] => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          const key = typeof item.key === 'string' ? item.key.trim().toLowerCase() : '';
          const content = typeof item.content === 'string' ? item.content.trim() : '';
          if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(key) || !content) return [];
          if (!categories.has(String(item.category)) || !scopes.has(String(item.scope))) return [];
          if (item.sourceType !== 'explicit') return [];
          return [{
            key,
            category: item.category as AiMemoryCandidate['category'],
            content: content.slice(0, 600),
            scope: item.scope as AiMemoryCandidate['scope'],
            sourceType: 'explicit',
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 1)),
            importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5)),
          }];
        }).slice(0, 6);
      return { ok: true, memoryCandidates: candidates, model: result.model };
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

    if (message.type === 'pdf-helper:ai-generate-paper-overview') {
      const sourceText = message.text.trim().slice(0, 55_000);
      if (!sourceText) throw new Error('论文原文不能为空。');

      const result = await adapter.chat(config, [{
        role: 'system',
        content: [
          '你是一名严谨的中文论文阅读助手，服务对象是研究生论文阅读。请根据用户提供的整篇论文或论文采样文本，生成一张更适合研究生使用的结构化论文卡片。',
          '事实类信息必须忠于原文，不能编造作者、数据集、指标、实验结果、局限性、会议等级等；原文没有明确说明的字段必须填写“原文未明确出现”。',
          '标题和作者尽量从论文首页识别；年份、会议或期刊只有明确出现时才填写。keywords、topic_tags 可以根据原文标题、摘要与正文关键词概括。',
          'reading_status 固定填写“略读完成”。recommend_deep_reading 只能填写“建议精读”“建议按需精读”或“暂不建议精读”。reading_difficulty 只能填写“较易”“中等”或“较难”。reading_value_score 填 0 到 10 的数字，可以带 1 位小数，它是基于论文内容做出的阅读辅助判断，不属于论文原始事实。',
          'worth_reading、reading_advice、suitable_stages、prerequisites、research_connection、followup_questions、weekly_plan 属于“研究生阅读辅助建议”，允许你基于论文内容做合理判断，但要简洁、具体、可执行。',
          'method_steps 尽量写成 1/2/3/4 结构；citation_points 应概括最值得在后续写作中引用的 1 到 3 个观点，并说明其用途。',
          '只返回一个 JSON 对象，不要使用 Markdown，不要添加解释。JSON 字段必须是：',
          '{"title":"","authors":"","venue_year":"","research_area":"","keywords":"","one_sentence_summary":"","research_problem":"","core_innovation":"","worth_reading":"","problem_setup":"","research_gap":"","why_important":"","topic_tags":"","method_overview":"","method_intuition":"","method_steps":"","key_assumptions":"","notation_guide":"","datasets":"","experiment_setup":"","metrics":"","main_findings":"","strongest_evidence":"","comparison_with_prior_work":"","limitations":"","reading_status":"略读完成","recommend_deep_reading":"建议按需精读","reading_difficulty":"中等","reading_value_score":"8.0","reading_advice":"","suitable_stages":"","prerequisites":"","citation_points":"","research_connection":"","followup_questions":"","weekly_plan":""}',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          `文件名：${message.documentName || '未提供'}`,
          `PDF 页数：${Math.max(1, Math.trunc(message.pageCount || 1))}`,
          '论文原文：',
          sourceText,
        ].join('\n\n'),
      }], 4096);

      return {
        ok: true,
        content: result.content,
        model: result.model,
      };
    }

    const result = await adapter.chat(
      config,
      buildConversation(message.messages, message.context),
      config.maxOutputTokens,
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
    let pendingToolResults:
      | { requestId: string; resolve: (results: AiStreamToolResult[]) => void }
      | undefined;
    const waitForToolResults = (
      requestId: string,
      signal: AbortSignal,
    ): Promise<AiStreamToolResult[]> => new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        if (pendingToolResults?.requestId !== requestId) return;
        pendingToolResults = undefined;
        console.error('[PDF Helper AI] 工具结果等待超时', { requestId, timeoutMs: 45_000 });
        resolve([]);
      }, 45_000);
      const finish = (results: AiStreamToolResult[]): void => {
        clearTimeout(timeoutId);
        resolve(results);
      };
      if (signal.aborted) {
        finish([]);
        return;
      }
      pendingToolResults = { requestId, resolve: finish };
      signal.addEventListener('abort', () => {
        if (pendingToolResults?.requestId === requestId) {
          pendingToolResults = undefined;
          finish([]);
        }
      }, { once: true });
    });
    port.onMessage.addListener((message) => {
      if (isAiStreamToolResultsMessage(message)) {
        if (pendingToolResults?.requestId === message.requestId) {
          const resolve = pendingToolResults.resolve;
          pendingToolResults = undefined;
          resolve(message.results);
        }
        return;
      }
      if (!isAiStreamStartMessage(message)) return;

      activeRequest?.abort();
      pendingToolResults = undefined;
      activeRequest = new AbortController();
      const { signal } = activeRequest;
      void streamAiResponse(message, port, signal, waitForToolResults).catch((error) => {
        if (signal.aborted) return;
        const details = getSafeErrorDetails(error);
        console.error('[PDF Helper AI] 流式请求失败', {
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
          details,
        });
        postAiStreamMessage(port, {
          type: 'error',
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
          details,
        });
      });
    });
    port.onDisconnect.addListener(() => {
      activeRequest?.abort();
      pendingToolResults = undefined;
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
