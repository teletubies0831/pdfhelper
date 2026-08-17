import type { AiConfig, AiNativeToolCall, AiStreamCompletionInfo } from '../contracts';
import { AiProviderRequestError, getProviderErrorMessage } from './provider-error';
import type { AiProviderAdapter, ProviderChatResult, ProviderMessage, ProviderStreamDelta } from './provider';

const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;

async function fetchProviderJson(
  path: string,
  config: AiConfig,
  init?: RequestInit,
): Promise<unknown> {
  if (!config.apiKey) throw new Error('请先在 PDFPal 的设置中配置 API Key。');
  const requestController = new AbortController();
  let timedOut = false;
  const handleCallerAbort = (): void => requestController.abort(init?.signal?.reason);
  const timeoutId = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, PROVIDER_REQUEST_TIMEOUT_MS);
  if (init?.signal?.aborted) {
    handleCallerAbort();
  } else {
    init?.signal?.addEventListener('abort', handleCallerAbort, { once: true });
  }

  try {
    const requestUrl = `${config.baseUrl}${path}`;
    const response = await fetch(requestUrl, {
      ...init,
      signal: requestController.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (path === '/models') {
      console.info('[PDFPal AI 连接测试] 供应商 HTTP 返回', {
        providerId: config.providerId,
        url: requestUrl,
        method: init?.method ?? 'GET',
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        payload,
      });
    }
    if (!response.ok) {
      throw new Error(getProviderErrorMessage(payload, `AI 请求失败：HTTP ${response.status}`));
    }
    return payload;
  } catch (error) {
    if (timedOut) {
      throw new Error('AI 供应商超过 120 秒仍未响应，请检查网络、接口地址或模型状态后重试。');
    }
    if (path === '/models') {
      console.error('[PDFPal AI 连接测试] 供应商请求异常', {
        providerId: config.providerId,
        url: `${config.baseUrl}${path}`,
        method: init?.method ?? 'GET',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    init?.signal?.removeEventListener('abort', handleCallerAbort);
  }
}

const getProviderError = getProviderErrorMessage;

function isBailianCompatibleEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase().endsWith('.aliyuncs.com');
  } catch {
    return baseUrl.toLowerCase().includes('aliyuncs.com');
  }
}

function isMiniMaxM3Model(model: string): boolean {
  return model.toLowerCase().replace(/[\s_/.]+/g, '-').includes('minimax-m3');
}

function supportsEnableThinkingParameter(model: string): boolean {
  const normalized = model.toLowerCase();
  return [
    'qwen',
    'deepseek',
    'glm',
    'kimi',
    'stepfun',
    'step-',
    'mimo',
  ].some((family) => normalized.includes(family));
}

function appendStreamFragment(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current) return fragment;
  // Most providers return disjoint fragments. A few return the cumulative
  // value again, so avoid duplicating it without discarding real fragments.
  if (fragment.startsWith(current)) return fragment;
  if (current.endsWith(fragment)) return current;
  return current + fragment;
}

function prepareProviderMessages(baseUrl: string, messages: ProviderMessage[]): ProviderMessage[] {
  const keepToolCallIndex = isBailianCompatibleEndpoint(baseUrl);
  return messages.map((message) => {
    if (!message.tool_calls?.length) return message;
    return {
      ...message,
      tool_calls: message.tool_calls.map((call, index) => ({
        id: call.id,
        type: call.type,
        ...(keepToolCallIndex ? { index: call.index ?? index } : {}),
        function: { ...call.function },
      })),
    };
  });
}

function summarizeProviderMessages(messages: ProviderMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    role: message.role,
    contentLength: message.content.length,
    reasoningLength: message.reasoning_content?.length ?? 0,
    toolCallId: message.tool_call_id,
    toolCalls: message.tool_calls?.map((call) => ({
      index: call.index,
      id: call.id,
      name: call.function.name,
      argumentsLength: call.function.arguments.length,
    })),
  }));
}

export class DeepSeekProviderAdapter implements AiProviderAdapter {
  readonly descriptor;

  constructor(
    readonly id: 'deepseek' | 'openai-compatible' = 'deepseek',
    label = id === 'deepseek' ? 'DeepSeek' : 'OpenAI 兼容接口',
  ) {
    this.descriptor = {
      id,
      label,
      capabilities: {
        streaming: true,
        tools: true,
        vision: id === 'openai-compatible',
        reasoning: true,
        modelDiscovery: true,
      },
    };
  }

  private reasoningPayload(config: AiConfig): Record<string, unknown> {
    if (this.id === 'deepseek') {
      return { thinking: { type: config.reasoning } };
    }

    const enabled = config.reasoning === 'enabled';
    if (isMiniMaxM3Model(config.model)) {
      return { thinking: { type: enabled ? 'adaptive' : 'disabled' } };
    }
    if (
      isBailianCompatibleEndpoint(config.baseUrl)
      || supportsEnableThinkingParameter(config.model)
    ) {
      return { enable_thinking: enabled };
    }

    // A generic OpenAI-compatible endpoint has no universal reasoning field.
    // Unknown model families keep the standard payload so ordinary chat
    // models are not broken by a vendor-specific parameter.
    return {};
  }

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
        ...this.reasoningPayload(config),
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
    if (!config.apiKey) throw new Error('请先在 PDFPal 的“设置”中配置 API Key。');
    const providerMessages = prepareProviderMessages(config.baseUrl, messages);
    const requestSummary = {
      providerId: config.providerId,
      model: config.model,
      baseUrl: config.baseUrl,
      reasoning: config.reasoning,
      toolChoice: options.tools?.length ? options.toolChoice ?? 'auto' : 'none',
      tools: (options.tools ?? []).map((tool) => (
        tool && typeof tool === 'object' && 'function' in tool
          ? (tool as { function?: { name?: unknown } }).function?.name
          : undefined
      )).filter(Boolean),
      messages: summarizeProviderMessages(providerMessages),
    };
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
          messages: providerMessages,
          ...this.reasoningPayload(config),
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
      console.info('[PDFPal AI] 供应商请求格式（已隐藏正文与密钥）', requestSummary);
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
      console.error('[PDFPal AI] 供应商 HTTP 请求失败', {
        ...requestSummary,
        httpStatus: response.status,
        providerRequestId,
        responseBody: responseBody.slice(0, 4000),
      });
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
        if (typeof part.id === 'string') existing.id = appendStreamFragment(existing.id, part.id);
        if (typeof part.function?.name === 'string') {
          existing.name = appendStreamFragment(existing.name, part.function.name);
        }
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
          rawArguments: part.arguments,
          index,
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

