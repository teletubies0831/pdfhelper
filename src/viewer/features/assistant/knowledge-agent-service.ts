import { type PDFDocumentProxy } from "pdfjs-dist";
import { browser } from "wxt/browser";
import { type AiRuntimeResponse } from "../../../../shared/ai";
import { type MemoryToolCall } from "../../../../shared/memory";
import { executeMemoryTool } from "../../../../entrypoints/viewer/memory-store";

import { updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";

import { sourceName } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getDocumentChatId } from './chat-session';
import { enrichPaperLibraryData } from './library-tools';
import { isExplicitMemoryForgetRequest } from "./memory-forget-service";

export interface KnowledgeAgentResult {
  contextText: string;
  completedTools: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

export async function runKnowledgeAgentTools(
  userMessage: string,
  documentProxy: PDFDocumentProxy | null,
  assistantElement: HTMLElement,
): Promise<KnowledgeAgentResult> {
  // Explicit deletion is handled by the guarded memory.forget path above so
  // the planner cannot accidentally turn a forget request into memory.upsert.
  if (isExplicitMemoryForgetRequest(userMessage)) {
    return { contextText: "", completedTools: [] };
  }
  const relevantIntent = /长期记忆|记住了什么|你记得|忘记|删除.{0,8}记忆|以前|历史|读过|看过|文献库|相关文献|哪篇论文/i;
  if (!relevantIntent.test(userMessage)) {
    return { contextText: "", completedTools: [] };
  }
  const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
  updateChatActivity(assistantElement, "knowledge-agent", "Agent 正在规划工具 · memory/library", "active");
  try {
    const response = await browser.runtime.sendMessage({
      type: "pdf-helper:ai-plan-knowledge-tools",
      userMessage,
      documentId,
      documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
    }) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || "记忆/文献工具规划失败。");
    const calls = response.toolCalls ?? [];
    const results: Array<{ call: typeof calls[number]; result: Awaited<ReturnType<typeof executeMemoryTool>> }> = [];
    for (const call of calls.slice(0, 5)) {
      const args = { ...call.arguments };
      if (call.name === "library.getPaper" && !args.id && typeof args.documentId === "string") {
        args.id = args.documentId;
      }
      if (call.name === "memory.forget" && !/(?:忘记|删除|移除)/i.test(userMessage)) {
        console.warn("[PDF Helper Agent] 已阻止没有用户明确授权的 memory.forget", call);
        continue;
      }
      const executable = { name: call.name, arguments: args } as MemoryToolCall;
      updateChatActivity(
        assistantElement,
        `knowledge-tool-${call.id}`,
        `Agent 正在调用工具 · ${call.name}`,
        "active",
        call.name.startsWith("library.") ? "历史文献" : "长期记忆",
      );
      console.info(`[PDF Helper 工具调用] ${call.name}`, executable.arguments);
      const result = await executeMemoryTool(executable);
      if (result.ok && call.name.startsWith("library.")) {
        result.data = enrichPaperLibraryData(result.data);
      }
      console.info(`[PDF Helper 工具结果] ${call.name}`, result);
      results.push({ call, result });
      updateChatActivity(
        assistantElement,
        `knowledge-tool-${call.id}`,
        result.ok ? `Agent 已完成 · ${call.name}` : `Agent 工具失败 · ${call.name}`,
        result.ok ? "done" : "error",
        result.ok ? "" : result.error || "未知错误",
      );
    }
    updateChatActivity(
      assistantElement,
      "knowledge-agent",
      results.length ? "记忆/文献工具执行完成" : "本轮无需调用记忆/文献工具",
      "done",
      results.length ? `${results.length} 次调用` : "",
    );
    return {
      contextText: results.length
        ? [
          "【Agent 记忆/历史文献工具结果】",
          ...results.map(({ call, result }) => [
            `${call.name}：${result.ok ? "成功" : "失败"}`,
            JSON.stringify(result.ok ? result.data : { error: result.error }, null, 2).slice(0, 10000),
          ].join("\n")),
        ].join("\n\n")
        : "",
      completedTools: results.filter(({ result }) => result.ok).map(({ call }) => ({
        name: call.name,
        arguments: call.arguments,
      })),
    };
  } catch (error) {
    console.error("[PDF Helper Agent] 记忆/文献工具流程失败", error);
    updateChatActivity(
      assistantElement,
      "knowledge-agent",
      "记忆/文献工具流程失败",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { contextText: "", completedTools: [] };
  }
}
