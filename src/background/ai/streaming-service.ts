import { browser } from "wxt/browser";

import { getNativeAgentTools } from "../../../shared/agent-tools";
import {
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type AiStreamToolResultsMessage,
  type AiStreamToolResult,
} from "../../../shared/ai";

import { AiProviderRequestError } from "./vision-service";
import type { ProviderMessage } from "./vision-service";
import { getAiConfig } from "./ai-config-repository";

import { getProviderAdapter } from "./provider-runtime";
import { buildConversation } from "./conversation-builder";

export type RuntimePort = ReturnType<typeof browser.runtime.connect>;

export function isAiStreamStartMessage(
  value: unknown,
): value is AiStreamStartMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiStreamStartMessage>;
  return (
    candidate.type === "start" &&
    typeof candidate.requestId === "string" &&
    Array.isArray(candidate.messages)
  );
}

export function isAiStreamToolResultsMessage(
  value: unknown,
): value is AiStreamToolResultsMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiStreamToolResultsMessage>;
  return (
    candidate.type === "tool-results" &&
    typeof candidate.requestId === "string" &&
    Array.isArray(candidate.results)
  );
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
  waitForToolResults: (
    requestId: string,
    signal: AbortSignal,
  ) => Promise<AiStreamToolResult[]>,
): Promise<void> {
  const config = await getAiConfig();
  const adapter = getProviderAdapter(config);
  const maxOutputTokens = config.maxOutputTokens;
  const conversation = buildConversation(request.messages, request.context);
  const nativeTools = getNativeAgentTools();
  const workingConversation: ProviderMessage[] = [...conversation];
  postAiStreamMessage(port, {
    type: "started",
    requestId: request.requestId,
    model: config.model,
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
            type: "reasoning-delta",
            requestId: request.requestId,
            content: delta.reasoningContent,
          });
        }
        if (delta.content) {
          postAiStreamMessage(port, {
            type: "delta",
            requestId: request.requestId,
            content: delta.content,
          });
        }
      },
      { tools: nativeTools, toolChoice: "auto" },
    );

    if (!result.toolCalls?.length) {
      postAiStreamMessage(port, {
        type: "done",
        requestId: request.requestId,
        model: result.model,
        completion: result.completion,
      });
      return;
    }

    postAiStreamMessage(port, {
      type: "tool-calls",
      requestId: request.requestId,
      calls: result.toolCalls,
      round,
    });
    const toolResults = await waitForToolResults(request.requestId, signal);
    if (signal.aborted) return;
    if (!toolResults.length) {
      throw new AiProviderRequestError(
        "Agent 工具没有返回结果，无法继续生成回答。",
        {
          name: "MissingToolResultsError",
          model: config.model,
          baseUrl: config.baseUrl,
        },
      );
    }
    workingConversation.push({
      role: "assistant",
      content: result.content || "",
      ...(result.reasoningContent
        ? { reasoning_content: result.reasoningContent }
        : {}),
      tool_calls: result.toolCalls.map((call, index) => ({
        id: call.id,
        type: "function",
        index: call.index ?? index,
        function: {
          name: call.name,
          arguments: call.rawArguments || JSON.stringify(call.arguments ?? {}),
        },
      })),
    });
    for (const toolResult of toolResults) {
      workingConversation.push({
        role: "tool",
        tool_call_id: toolResult.toolCallId,
        content: toolResult.content.slice(0, 16000),
      });
    }
  }
  throw new AiProviderRequestError(
    `Agent 工具调用超过 ${maxToolRounds} 轮，已停止继续请求。`,
    {
      name: "ToolRoundLimitError",
      model: config.model,
      baseUrl: config.baseUrl,
    },
  );
}
