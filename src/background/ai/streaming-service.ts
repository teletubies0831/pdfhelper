import { browser } from "wxt/browser";


import { AGENT_TOOL_DEFINITIONS, getNativeAgentTools } from "../../../shared/agent-tools";
import { type AiStreamDebugInfo, type AiStreamServerMessage, type AiStreamStartMessage, type AiStreamToolResultsMessage, type AiStreamToolResult } from "../../../shared/ai";

import { AiProviderRequestError } from './vision-service';
import type { ProviderMessage } from './vision-service';
import { getAiConfig } from './ai-config-repository';

import { getProviderAdapter } from "./provider-runtime";
import { buildConversation } from "./conversation-builder";

export type RuntimePort = ReturnType<typeof browser.runtime.connect>;

export function isAiStreamStartMessage(value: unknown): value is AiStreamStartMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiStreamStartMessage>;
  return candidate.type === 'start'
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.messages);
}

export function isAiStreamToolResultsMessage(value: unknown): value is AiStreamToolResultsMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiStreamToolResultsMessage>;
  return candidate.type === 'tool-results'
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.results);
}

export function postAiStreamMessage(
  port: RuntimePort,
  message: AiStreamServerMessage,
): void {
  try {
    port.postMessage(message);
  } catch {
    // The viewer may have closed while a network chunk was in flight.
  }
}

export async function streamAiResponse(
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
    ...(item.reasoning_content ? { reasoningContent: item.reasoning_content } : {}),
    ...(item.tool_calls?.length
      ? {
        toolCalls: item.tool_calls.map((call) => ({
          id: call.id,
          name: call.function.name,
          ...(typeof call.index === 'number' ? { index: call.index } : {}),
          rawArguments: call.function.arguments,
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

    console.info('[PDFPal AI] 原生工具调用请求', {
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
      ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      tool_calls: result.toolCalls.map((call, index) => ({
        id: call.id,
        type: 'function',
        index: call.index ?? index,
        function: {
          name: call.name,
          arguments: call.rawArguments || JSON.stringify(call.arguments ?? {}),
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
    console.info('[PDFPal AI] 原生工具结果', {
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
