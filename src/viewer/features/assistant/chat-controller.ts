import { isVisionAiConfigured, type AiEvidenceSource } from "../../../modules/ai/public";

import { getAgentToolByProtocolName } from "../../../modules/ai/public";

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

import { getDisplayFileName } from "../../core/pdf-reader/public";
import { validatePdfCitations } from "../translation/public";
import {
  clearPendingChatImages,
  inspectChatImageWithVision,
} from "./chat-image-service";
import {
  appendChatMessage,
  failActiveChatActivities,
  renderChatEvidenceSources,
  updateChatMessage,
  updateChatReasoning,
} from "./chat-view";
import {
  prepareChatRequestHistory,
  queueChatConversationPersistence,
  requestAiStream,
} from "./chat-session";
import { loadLongTermMemoryContext } from "./memory-controller";
import { mergeEvidenceSources, readKnowledgeEvidenceSources } from "./tool-evidence";

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
      : "正在准备对话与工具环境",
    "active",
  );
  let streamedContent = "";
  let streamedReasoningContent = "";
  let renderFrame = 0;
  let modelActivityStarted = false;
  let evidenceSources: AiEvidenceSource[] = [];

  const flushStreamedContent = (): void => {
    renderFrame = 0;
    updateChatReasoning(assistantMessage, streamedReasoningContent, true);
    updateChatMessage(assistantMessage, streamedContent, { streaming: true });
  };

  try {
    const pageNumber = Math.max(
      1,
      selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
    );
    const longTermMemoryPromise = loadLongTermMemoryContext(
      documentAtRequestStart,
    );
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
    // 这里只准备被动上下文。所有 MCP 工具均由主模型在原生工具循环中按需调用。
    const [
      visionResults,
      preparedChatHistory,
      longTermMemoryContext,
    ] = await Promise.all([
      Promise.allSettled(visionTasks),
      preparedChatHistoryPromise,
      longTermMemoryPromise,
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
        ? "截图与工具环境已准备"
        : "对话与工具环境已准备",
      "done",
      "",
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
        userMessage: userPrompt,
        documentName: documentNameAtRequestStart
          ? getDisplayFileName(documentNameAtRequestStart)
          : undefined,
        pageNumber,
        totalPages: documentAtRequestStart?.numPages,
        selectedText:
          requestImages.length === 0
            ? selectedTextForAi.value || undefined
            : undefined,
        imageAnalysis: imageAnalyses.join("\n\n") || undefined,
        conversationSummary: preparedChatHistory.summary,
        longTermMemory: longTermMemoryContext.text || undefined,
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
              `Agent 正在调用工具 · ${getAgentToolByProtocolName(call.name)?.label ?? call.name}`,
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
            if (result.ok && result.name === "library.searchPapers") {
              evidenceSources = mergeEvidenceSources(
                evidenceSources,
                readKnowledgeEvidenceSources(result.content),
              );
              renderChatEvidenceSources(assistantMessage, evidenceSources);
            }
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
    chatHistory.value.push({
      role: "assistant",
      content: streamedContent,
      evidenceSources,
    });
    void queueChatConversationPersistence(documentAtRequestStart);
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
