import { isVisionAiConfigured } from "../../../../shared/ai";

import { getAgentToolDefinitionByApiName } from "../../../../shared/agent-tools";

import {
  aiConfig,
  chatHistory,
  chatRequestPending,
  pendingChatImages,
  resolvedReadingMode,
  selectedTextForAi,
  selectedTextPageNumber,
  setDeepSeekSettingsOpen,
  visionAiConfig,
} from "../../core/pdf-reader/public";
import { updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";
import {
  chatImageButton,
  chatInput,
  chatSendButton,
  clearChatButton,
  deepSeekSettingsStatus,
  visionSettingsStatus,
} from "../../app/viewer-elements";

import { pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";

import { attachChatSaveAction } from "../knowledge-base/public";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { validatePdfCitations } from "../translation/public";
import { buildAgentEvidence } from "../../services/document-agent/viewer-document-agent";
import {
  clearPendingChatImages,
  inspectChatImageWithVision,
} from "./library-tools";
import {
  appendChatMessage,
  failActiveChatActivities,
  updateChatMessage,
  updateChatReasoning,
} from "./chat-view";
import {
  prepareChatRequestHistory,
  queueChatConversationPersistence,
  requestAiStream,
} from "./chat-session";
import {
  extractAndStoreLongTermMemories,
  loadLongTermMemoryContext,
  persistImmediateExplicitMemories,
  runKnowledgeAgentTools,
} from "./memory-controller";
import type { ImmediateMemoryWriteResult } from "./memory-controller";

export async function sendChatMessage(): Promise<void> {
  const content = chatInput.value.trim();
  const requestImages = pendingChatImages.value.map((image) => ({ ...image }));
  const userPrompt =
    content || (requestImages.length ? "请直接分析这些截图中的内容。" : "");
  if (!userPrompt || chatRequestPending.value) return;

  if (!aiConfig.value.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent = "先配置并保存 API Key，之后即可聊天。";
    return;
  }
  if (requestImages.length > 0 && !isVisionAiConfigured(visionAiConfig.value)) {
    setDeepSeekSettingsOpen(true);
    visionSettingsStatus.classList.add("error");
    visionSettingsStatus.textContent = "发送截图前，请先启用并配置视觉模型。";
    return;
  }

  chatRequestPending.value = true;
  const documentAtRequestStart = pdfDocument.value;
  const documentNameAtRequestStart = sourceName.value;
  chatInput.value = "";
  clearPendingChatImages();
  chatInput.disabled = true;
  chatImageButton.disabled = true;
  chatSendButton.disabled = true;
  clearChatButton.disabled = true;
  chatHistory.value.push({
    role: "user",
    content: userPrompt,
    images: requestImages,
  });
  appendChatMessage("user", userPrompt, { images: requestImages });
  void queueChatConversationPersistence(documentAtRequestStart);
  const assistantMessage = appendChatMessage("assistant", "", {
    pending: true,
  });
  updateChatActivity(
    assistantMessage,
    "context",
    requestImages.length > 0
      ? "正在准备截图分析"
      : documentAtRequestStart
        ? "正在准备 Agent 文档检索"
        : "正在准备对话上下文",
    "active",
  );
  let streamedContent = "";
  let streamedReasoningContent = "";
  let renderFrame = 0;
  let modelActivityStarted = false;
  let immediateMemoryResult: ImmediateMemoryWriteResult = {
    stored: [],
    contextText: "",
    completedTools: [],
  };

  const flushStreamedContent = (): void => {
    renderFrame = 0;
    updateChatReasoning(assistantMessage, streamedReasoningContent, true);
    updateChatMessage(assistantMessage, streamedContent, { streaming: true });
  };

  try {
    immediateMemoryResult = await persistImmediateExplicitMemories(
      userPrompt,
      documentAtRequestStart,
      assistantMessage,
    );
    const pageNumber = Math.max(
      1,
      selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
    );
    const longTermMemoryPromise = loadLongTermMemoryContext(
      documentAtRequestStart,
    );
    const knowledgeAgentPromise = runKnowledgeAgentTools(
      userPrompt,
      documentAtRequestStart,
      assistantMessage,
    );
    const agentEvidencePromise = documentAtRequestStart
      ? buildAgentEvidence(
          userPrompt,
          documentAtRequestStart,
          pageNumber,
          requestImages.length === 0 ? selectedTextForAi.value : "",
          requestImages.length > 0,
          assistantMessage,
        )
      : Promise.resolve(null);
    const preparedChatHistoryPromise = prepareChatRequestHistory(
      assistantMessage,
      documentAtRequestStart,
    );

    const visionContext = {
      documentName: documentNameAtRequestStart
        ? getDisplayFileName(documentNameAtRequestStart)
        : undefined,
      pageNumber,
      totalPages: documentAtRequestStart?.numPages,
      readingMode: documentAtRequestStart
        ? ("paper" as const)
        : resolvedReadingMode.value,
    };
    const visionTasks = requestImages.map(async (attachment, index) => {
      const activityKey = `vision-${attachment.id}`;
      updateChatActivity(
        assistantMessage,
        activityKey,
        `Agent 正在调用工具 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
        "active",
        attachment.name,
      );
      console.info("[PDFPal 工具调用] analyze_screenshot", {
        index: index + 1,
        name: attachment.name,
        width: attachment.width,
        height: attachment.height,
        execution: "parallel",
      });
      try {
        const analysis = await inspectChatImageWithVision(
          attachment,
          userPrompt,
          visionContext,
        );
        console.info("[PDFPal 工具结果] analyze_screenshot", {
          index: index + 1,
          name: attachment.name,
          analysis,
        });
        updateChatActivity(
          assistantMessage,
          activityKey,
          `Agent 已完成 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
          "done",
          attachment.name,
        );
        return `[截图 ${index + 1}：${attachment.name}]\n${analysis}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateChatActivity(
          assistantMessage,
          activityKey,
          `Agent 工具失败 · vision.analyze_screenshot ${index + 1}/${requestImages.length}`,
          "error",
          message,
        );
        console.error("[PDFPal 工具失败] analyze_screenshot", {
          index: index + 1,
          name: attachment.name,
          error,
        });
        throw error;
      }
    });
    // 文档工具规划、截图分析、会话压缩和长期记忆读取互不依赖，全部并行执行。
    const [
      visionResults,
      agentEvidence,
      preparedChatHistory,
      longTermMemoryContext,
      knowledgeAgentResult,
    ] = await Promise.all([
      Promise.allSettled(visionTasks),
      agentEvidencePromise,
      preparedChatHistoryPromise,
      longTermMemoryPromise,
      knowledgeAgentPromise,
    ]);
    if (pdfDocument.value !== documentAtRequestStart) {
      throw new Error("PDF 已切换，请在新文档中重新发送问题。");
    }
    const visionFailures = visionResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (visionFailures.length > 0) {
      const firstReason = visionFailures[0]?.reason;
      throw new Error(
        `${visionFailures.length} 张截图分析失败：${firstReason instanceof Error ? firstReason.message : String(firstReason)}`,
      );
    }
    const imageAnalyses = visionResults.map(
      (result) => (result as PromiseFulfilledResult<string>).value,
    );

    updateChatActivity(
      assistantMessage,
      "context",
      requestImages.length > 0
        ? "截图与 Agent 证据已准备"
        : documentAtRequestStart
          ? "Agent 文档证据已准备"
          : "对话上下文已准备",
      "done",
      agentEvidence?.sourcePages.length
        ? `证据页：${agentEvidence.sourcePages.join("、")}`
        : "",
    );
    const requestHistory = preparedChatHistory.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    if (imageAnalyses.length > 0) {
      const lastUserMessage = requestHistory.at(-1);
      if (lastUserMessage?.role === "user") {
        lastUserMessage.content = [
          userPrompt,
          "本轮附带了用户截图。“这部分/这里/这个/图里”均指截图，不是当前 PDF 页面。",
          "必须先直接分析截图中实际展示的内容，再结合论文全文补充背景、术语或上下文。",
          "禁止跳过截图分析，直接改为总结当前 PDF 页面或整篇论文。",
        ].join("\n\n");
      }
    }

    updateChatActivity(
      assistantMessage,
      "model",
      aiConfig.value.reasoning === "enabled"
        ? "主模型正在思考"
        : "主模型正在生成回答",
      "active",
      aiConfig.value.model,
    );
    modelActivityStarted = true;
    const response = await requestAiStream(
      requestHistory,
      {
        documentName: documentNameAtRequestStart
          ? getDisplayFileName(documentNameAtRequestStart)
          : undefined,
        pageNumber,
        totalPages: documentAtRequestStart?.numPages,
        agentEvidence: agentEvidence?.text || undefined,
        sourceScope: agentEvidence ? "document" : undefined,
        sourceLabel: agentEvidence ? "Agent 按需检索证据" : undefined,
        sourcePages: agentEvidence?.sourcePages,
        contextNote: agentEvidence
          ? `文档内容由 Agent 经过 ${agentEvidence.planningRounds} 轮规划、按需调用工具获得；未向本轮模型注入整篇 PDF。`
          : undefined,
        selectedText:
          requestImages.length === 0
            ? selectedTextForAi.value || undefined
            : undefined,
        imageAnalysis: imageAnalyses.join("\n\n") || undefined,
        conversationSummary: preparedChatHistory.summary,
        longTermMemory: longTermMemoryContext.text || undefined,
        memoryOperationResult:
          [immediateMemoryResult.contextText, knowledgeAgentResult.contextText]
            .filter(Boolean)
            .join("\n\n") || undefined,
        completedTools: [
          ...immediateMemoryResult.completedTools,
          ...knowledgeAgentResult.completedTools,
          ...(agentEvidence?.toolResults.map((tool) => ({
            name: tool.name,
            arguments: { pages: tool.pages, label: tool.label },
          })) ?? []),
        ],
        readingMode: documentAtRequestStart
          ? "paper"
          : resolvedReadingMode.value,
      },
      (delta) => {
        if (delta.content) streamedContent += delta.content;
        if (delta.reasoningContent)
          streamedReasoningContent += delta.reasoningContent;
        if (delta.toolCalls?.length) {
          for (const call of delta.toolCalls) {
            updateChatActivity(
              assistantMessage,
              `native-tool-${call.id}`,
              `Agent 正在调用工具 · ${getAgentToolDefinitionByApiName(call.name)?.label ?? call.name}`,
              "active",
              call.name,
            );
          }
          updateChatActivity(
            assistantMessage,
            "model",
            "Agent 正在等待工具结果",
            "active",
            aiConfig.value.model,
          );
        }
        if (delta.toolResults?.length) {
          for (const result of delta.toolResults) {
            updateChatActivity(
              assistantMessage,
              `native-tool-${result.toolCallId}`,
              result.ok
                ? `工具已完成 · ${result.name}`
                : `工具失败 · ${result.name}`,
              result.ok ? "done" : "error",
              result.ok ? "" : result.content.slice(0, 160),
            );
          }
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型继续生成回答",
            "active",
            aiConfig.value.model,
          );
        }
        if (delta.content) {
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型正在生成回答",
            "active",
            aiConfig.value.model,
          );
        } else if (delta.reasoningContent && modelActivityStarted) {
          updateChatActivity(
            assistantMessage,
            "model",
            "主模型正在思考",
            "active",
            aiConfig.value.model,
          );
        }
        if (!renderFrame)
          renderFrame = window.requestAnimationFrame(flushStreamedContent);
      },
    );

    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    updateChatActivity(
      assistantMessage,
      "model",
      "回答生成完成",
      "done",
      aiConfig.value.model,
    );
    const rawModelContent = response.content;
    streamedContent = await validatePdfCitations(
      rawModelContent,
      documentAtRequestStart,
    );
    streamedReasoningContent = response.reasoningContent;
    if (!streamedContent.trim()) {
      throw new Error(
        streamedReasoningContent.trim()
          ? `模型只返回了思考过程，没有返回最终回答（已收到思考 ${streamedReasoningContent.length} 字符）。`
          : "模型流已结束，但没有返回正文或思考内容。",
      );
    }
    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(assistantMessage, streamedContent, { streaming: false });
    chatHistory.value.push({ role: "assistant", content: streamedContent });
    void queueChatConversationPersistence(documentAtRequestStart);
    if (immediateMemoryResult.stored.length === 0) {
      void extractAndStoreLongTermMemories(
        userPrompt,
        streamedContent,
        documentAtRequestStart,
        documentNameAtRequestStart,
        response.requestId,
        assistantMessage,
      );
    }
    attachChatSaveAction(
      assistantMessage,
      userPrompt,
      streamedContent,
      documentNameAtRequestStart
        ? getDisplayFileName(documentNameAtRequestStart)
        : "未关联文档",
      pageNumber,
    );
  } catch (error) {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    const failureMessage =
      error instanceof Error ? error.message : String(error);
    failActiveChatActivities(
      assistantMessage,
      `${failureMessage.slice(0, 180)}${failureMessage.length > 180 ? "…" : ""}`,
    );
    updateChatReasoning(assistantMessage, streamedReasoningContent, false);
    updateChatMessage(assistantMessage, `请求失败：${failureMessage}`, {
      error: true,
    });
  } finally {
    chatRequestPending.value = false;
    chatInput.disabled = false;
    chatImageButton.disabled = false;
    chatSendButton.disabled = false;
    clearChatButton.disabled = false;
    chatInput.focus();
  }
}
