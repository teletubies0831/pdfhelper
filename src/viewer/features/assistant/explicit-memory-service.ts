import { type PDFDocumentProxy } from "pdfjs-dist";
import { browser } from "wxt/browser";
import { type AiMemoryCandidate, type AiRuntimeResponse } from "../../../../shared/ai";

import { memoryTools } from "../../../../entrypoints/viewer/memory-store";
import { chatHistory } from "../../core/pdf-reader/public";
import { updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";
import { assistantSettingsPanel } from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getDocumentChatId } from './chat-session';

import { createLocalExplicitMemoryCandidates, findConfirmedMemoryProposal } from "./memory-candidate-parser";
import { executeExplicitMemoryForget, isExplicitMemoryForgetRequest, type ImmediateMemoryWriteResult } from "./memory-forget-service";
import { refreshLongTermMemoryList } from "./memory-list";

export async function persistImmediateExplicitMemories(
  userMessage: string,
  documentProxy: PDFDocumentProxy | null,
  assistantElement: HTMLElement,
): Promise<ImmediateMemoryWriteResult> {
  if (isExplicitMemoryForgetRequest(userMessage)) {
    return executeExplicitMemoryForget(userMessage, assistantElement);
  }
  const currentUserIndex = chatHistory.value.findLastIndex(
    (message) => message.role === "user" && message.content.trim() === userMessage.trim(),
  );
  const confirmedProposal = findConfirmedMemoryProposal(
    chatHistory.value,
    currentUserIndex,
  );
  const durableMemorySignal =
    /记住|以后|今后|长期|一直|默认|偏好|我(?:更)?喜欢|我希望|我习惯|我的研究方向|我(?:主要|目前|现在)研究|我的项目|项目目标|回答时|不要再|改为/i;
  const directCandidates = createLocalExplicitMemoryCandidates(userMessage);
  const confirmedCandidates = confirmedProposal
    ? createLocalExplicitMemoryCandidates(`请记住：${confirmedProposal}`)
    : [];
  if (
    !durableMemorySignal.test(userMessage) &&
    !confirmedProposal &&
    directCandidates.length === 0
  ) {
    return { stored: [], contextText: "", completedTools: [] };
  }

  updateChatActivity(
    assistantElement,
    "long-term-memory",
    "Agent 正在判断是否调用 memory.upsert",
    "active",
  );
  const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
  const operationId = crypto.randomUUID();
  try {
    const existing = await memoryTools.list({ limit: 100 });
    const previousAssistantMessage = [...chatHistory.value.slice(0, currentUserIndex)]
      .reverse()
      .find((message) => message.role === "assistant")?.content ?? "";
    let modelCandidates: AiMemoryCandidate[] = [];
    try {
      console.info("[PDFPal 模型工具决策] 请求判断长期记忆写入", {
        operationId,
        userMessage,
        confirmedProposal: confirmedProposal || undefined,
      });
      const response = (await browser.runtime.sendMessage({
        type: "pdf-helper:ai-plan-long-term-memory-tools",
        userMessage,
        assistantMessage: previousAssistantMessage,
        confirmedMemoryProposal: confirmedProposal || undefined,
        documentId,
        documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
        existingMemories: existing.map((memory) => ({
          key: memory.key,
          content: memory.content,
          scope: memory.scope,
          scopeId: memory.scopeId,
        })),
      })) as AiRuntimeResponse;
      if (!response?.ok) {
        throw new Error(response?.error || "长期记忆工具决策失败。");
      }
      modelCandidates = response.memoryCandidates ?? [];
      console.info("[PDFPal Agent Tool] 模型返回原生 tool_calls", {
        operationId,
        toolCalls: response.toolCalls ?? [],
        candidates: modelCandidates,
      });
    } catch (planningError) {
      console.warn(
        "[PDFPal 模型工具决策] 模型判断失败，使用明确指令兜底",
        { operationId, error: planningError },
      );
    }

    const fixedProgramRulePattern =
      /latex|markdown|api\s*key|原文引用|查看原文|点击定位|截图优先|全文注入|公式渲染/i;
    const mergedCandidates = new Map<string, AiMemoryCandidate>();
    for (const candidate of modelCandidates) {
      mergedCandidates.set(`${candidate.key}:${candidate.scope}`, candidate);
    }
    for (const candidate of [...directCandidates, ...confirmedCandidates]) {
      // A generic local fact is only a provider-failure fallback. When the
      // model produced a semantic key, keep that single, clearer memory.
      if (candidate.key.startsWith("fact.explicit.") && modelCandidates.length > 0) {
        continue;
      }
      if (candidate.key.startsWith("profile.personal.likes.")) {
        mergedCandidates.delete("profile.personal.likes:global");
      }
      mergedCandidates.set(`${candidate.key}:${candidate.scope}`, candidate);
    }
    const candidates = [...mergedCandidates.values()].filter(
      (candidate) =>
        candidate.sourceType === "explicit" &&
        candidate.confidence >= 0.9 &&
        !fixedProgramRulePattern.test(`${candidate.key} ${candidate.content}`),
    );
    if (candidates.length === 0) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "模型未请求写入长期记忆",
        "done",
      );
      return { stored: [], contextText: "", completedTools: [] };
    }

    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 正在调用工具 · memory.upsert",
      "active",
      `${candidates.length} 条待写入`,
    );
    console.info("[PDFPal 工具调用] memory.upsert", {
      operationId,
      candidates,
      requestedBy: "model-memory-planner",
      execution: "before-main-model",
    });
    const stored = await Promise.all(
      candidates.map((candidate) => memoryTools.upsert({
        ...candidate,
        scopeId: candidate.scope === "pdf" ? documentId : undefined,
        sourceConversationId: operationId,
        sourcePdfId: documentId,
      })),
    );
    if (candidates.some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )) {
      await Promise.all(
        existing
          .filter((memory) => memory.key === "profile.personal.likes")
          .map((memory) => memoryTools.forget(memory.id)),
      );
    }
    console.info("[PDFPal 工具结果] memory.upsert", {
      operationId,
      stored,
    });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 已完成 · memory.upsert",
      "done",
      `${stored.length} 条`,
    );
    stored.forEach((memory, index) => {
      updateChatActivity(
        assistantElement,
        `long-term-memory-result-${index}`,
        `已记住：${memory.content}`,
        "done",
        memory.scope === "global" ? "全局" : memory.scope === "project" ? "项目" : "当前 PDF",
      );
    });
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
    return {
      stored,
      contextText: [
        `模型已在主回答生成前请求调用 memory.upsert，应用已执行成功，共写入 ${stored.length} 条长期记忆：`,
        ...stored.map((memory) => `- ${memory.key}：${memory.content}`),
        "生成最终回答时，请明确、简洁地告诉用户已经记住了哪些内容。",
      ].join("\n"),
      completedTools: candidates.map((candidate) => ({
        name: "memory.upsert",
        arguments: {
          key: candidate.key,
          category: candidate.category,
          content: candidate.content,
          scope: candidate.scope,
        },
      })),
    };
  } catch (error) {
    console.error("[PDFPal 工具失败] memory.upsert", {
      operationId,
      error,
    });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 工具失败 · memory.upsert",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { stored: [], contextText: "", completedTools: [] };
  }
}
