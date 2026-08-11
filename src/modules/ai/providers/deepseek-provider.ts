import type { AiConfig, AiNativeToolCall, AiStreamCompletionInfo } from '../contracts';
import { AiProviderRequestError, getProviderErrorMessage } from './provider-error';
import type { AiProviderAdapter, ProviderChatResult, ProviderMessage, ProviderStreamDelta } from './provider';

async function fetchProviderJson(
  path: string,
  config: AiConfig,
  init?: RequestInit,
): Promise<unknown> {
  if (!config.apiKey) throw new Error('请先在 PDF Helper 的设置中配置 API Key。');
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
    throw new Error(getProviderErrorMessage(payload, `AI 请求失败：HTTP ${response.status}`));
  }
  return payload;
}

const getProviderError = getProviderErrorMessage;

export class DeepSeekProviderAdapter implements AiProviderAdapter {
  readonly id = 'deepseek' as const;
  readonly descriptor = {
    id: this.id,
    label: 'DeepSeek',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true,
      modelDiscovery: true,
    },
  } as const;

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

