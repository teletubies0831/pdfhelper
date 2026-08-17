import { type PDFDocumentProxy } from "pdfjs-dist";





import { browser } from "wxt/browser";
import { AI_STREAM_PORT_NAME, type AiConversationMessage, type AiRuntimeResponse, type AiNativeToolCall, type AiStreamServerMessage, type AiStreamStartMessage, type AiStreamToolResult } from "../../../../shared/ai";

import { createDocumentAgentId } from "../../../../shared/document-agent";


import { getLatestDocumentSession, isDocumentAgentStorageAvailable, putDocumentSession } from "../../../../entrypoints/viewer/document-agent-store";




import { chatConversationSummary, chatHistory, chatPersistenceQueue, chatSummarizedMessageCount, conversationMemoryConfig, resolvedReadingMode } from "../../core/pdf-reader/public";
import { createPdfCitationPattern, updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";
import { chatMessagesElement } from "../../app/viewer-elements";
import { getPdfFingerprint } from "../annotations/public";
import { pdfDocument, sourceName } from "../../app/viewer-state";


import { getDisplayFileName } from "../../core/pdf-reader/public";
import { validatePdfCitations } from "../translation/public";

import { clearPendingChatImages, executeNativeToolCalls } from './library-tools';
import { appendChatMessage } from './chat-view';




export function requestAiStream(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage["context"],
  onDelta: (delta: {
    content?: string;
    reasoningContent?: string;
    toolCalls?: AiNativeToolCall[];
    toolResults?: AiStreamToolResult[];
  }) => void,
): Promise<{
  content: string;
  reasoningContent: string;
  requestId: string;
  requestMessages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;
}> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_STREAM_PORT_NAME });

  return new Promise((resolve, reject) => {
    let settled = false;
    let content = "";
    let reasoningContent = "";
    let debugConversation: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      toolCalls?: AiNativeToolCall[];
      toolCallId?: string;
    }> = [];
    const handledToolRounds = new Set<number>();

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
      try {
        port.disconnect();
      } catch {
        // The background may already have closed the port.
      }
    };

    port.onMessage.addListener((value: unknown) => {
      const message = value as AiStreamServerMessage;
      if (!message || message.requestId !== requestId) return;

      if (message.type === "started") {
        const debug = message.debug;
        console.groupCollapsed(`[PDFPal AI] 聊天请求 · ${message.model}`);
        if (debug) {
          debugConversation = debug.messages.map((item) => ({ ...item }));
          console.log("模型配置", {
            provider: debug.providerId,
            model: debug.model,
            baseUrl: debug.baseUrl,
            reasoning: debug.reasoning,
            maxOutputTokens: debug.maxOutputTokens,
          });
          console.log("Native tools payload", {
            toolChoice: debug.toolChoice ?? "none",
            tools: debug.nativeTools ?? [],
          });
          const [systemMessage, ...conversationMessages] = debug.messages;
          if (systemMessage)
            console.log("System Prompt\n", systemMessage.content);
          conversationMessages.forEach((item, index) => {
            console.log(
              `${item.role === "user" ? "User" : item.role === "tool" ? "Tool" : "Assistant"} Prompt #${index + 1}\n`,
              item.content,
            );
          });
          console.log(
            "可用 Agent 工具（已随请求发送）",
            debug.availableTools.length
              ? debug.availableTools
              : "没有向模型发送工具定义",
          );
          console.log(
            "本轮回答前已完成的工具调用",
            debug.completedTools.length
              ? debug.completedTools
              : "本轮回答前未执行工具",
          );
          console.log("完整模型对话（实际发送内容）", debugConversation);
        }
        console.groupEnd();
        return;
      }
      if (message.type === "delta") {
        content += message.content;
        onDelta({ content: message.content });
        return;
      }
      if (message.type === "reasoning-delta") {
        reasoningContent += message.content;
        onDelta({ reasoningContent: message.content });
        return;
      }
      if (message.type === "tool-calls") {
        if (handledToolRounds.has(message.round)) return;
        handledToolRounds.add(message.round);
        console.info("[PDFPal AI] native Agent tool calls", {
          requestId,
          round: message.round,
          calls: message.calls,
        });
        debugConversation.push({
          role: "assistant",
          content: "",
          toolCalls: message.calls,
        });
        onDelta({ toolCalls: message.calls });
        void executeNativeToolCalls(message.calls, context).then((results) => {
          console.info("[PDFPal AI] native Agent tool results", { requestId, round: message.round, results });
          onDelta({ toolResults: results });
          results.forEach((result) => {
            debugConversation.push({
              role: "tool",
              content: result.content,
              toolCallId: result.toolCallId,
            });
          });
          port.postMessage({ type: "tool-results", requestId, results });
        }).catch((error) => {
          const errorText = error instanceof Error ? error.message : String(error);
          const results = message.calls.map((call) => ({
            toolCallId: call.id,
            name: call.name,
            ok: false,
            content: errorText,
          }));
          onDelta({ toolResults: results });
          results.forEach((result) => {
            debugConversation.push({
              role: "tool",
              content: result.content,
              toolCallId: result.toolCallId,
            });
          });
          port.postMessage({ type: "tool-results", requestId, results });
        });
        return;
      }
      if (message.type === "done") {
        if (message.debug) {
          debugConversation = message.debug.messages.map((item) => ({
            ...item,
          }));
        }
        const completedConversation = [
          ...debugConversation,
          { role: "assistant" as const, content },
        ];
        console.groupCollapsed(
          `[PDFPal AI] 聊天响应完成 · ${message.model}`,
        );
        const systemMessage = completedConversation.find(
          (item) => item.role === "system",
        );
        if (systemMessage)
          console.log("System Prompt / 角色设定\n", systemMessage.content);
        console.log("发送给模型的全部历史对话", debugConversation);
        console.log("思考过程\n", reasoningContent || "本轮没有返回思考过程");
        console.log("最终回答\n", content);
        console.log("流式完成信息", message.completion ?? {
          contentLength: content.length,
          reasoningLength: reasoningContent.length,
          note: "供应商未返回完成诊断",
        });
        console.log("完整模型对话（包含最终回答）", completedConversation);
        console.log(
          "完整模型对话 JSON（可直接复制）\n",
          JSON.stringify(completedConversation, null, 2),
        );
        console.groupEnd();
        finish(() =>
          resolve({
            content,
            reasoningContent,
            requestId,
            requestMessages: debugConversation.map((item) => ({ ...item })),
          }),
        );
        return;
      }
      if (message.type === "error") {
        console.groupCollapsed(`[PDFPal AI] 聊天请求失败 · ${requestId}`);
        console.error("错误原因", message.error);
        console.log("安全诊断（不包含 API Key）", message.details ?? "后台未返回诊断详情");
        console.log("失败前已接收内容", {
          contentLength: content.length,
          reasoningLength: reasoningContent.length,
          content,
          reasoningContent,
        });
        console.log("本轮实际发送上下文", debugConversation);
        console.groupEnd();
        const streamError = Object.assign(new Error(message.error), {
          requestId,
          details: message.details,
        });
        finish(() => reject(streamError));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      const error = Object.assign(
        new Error("AI 流式连接已中断，请重新加载扩展后再试。"),
        { requestId },
      );
      console.error("[PDFPal AI] 流式连接异常中断", {
        requestId,
        contentLength: content.length,
        reasoningLength: reasoningContent.length,
      });
      reject(error);
    });

    const startMessage: AiStreamStartMessage = {
      type: "start",
      requestId,
      messages,
      context: {
        ...context,
        readingMode: context?.readingMode ?? resolvedReadingMode.value,
      },
    };
    port.postMessage(startMessage);
  });
}



export function renderChatConversation(messages: AiConversationMessage[]): void {
  chatHistory.value = messages.map((message) => ({
    ...message,
    images: message.images?.map((image) => ({ ...image })),
  }));
  chatMessagesElement.replaceChildren();
  for (const message of chatHistory.value) {
    appendChatMessage(message.role, message.content, {
      images: message.images,
    });
  }
  if (chatHistory.value.length > 0) {
    requestAnimationFrame(() => {
      chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    });
    return;
  }
  appendChatMessage(
    "assistant",
    "你好，我可以结合当前 PDF 和你选中的文字回答问题。选中一段原文后，可以直接让我翻译、解释或总结。",
  );
}



export function resetChatConversation(): void {
  clearPendingChatImages();
  chatConversationSummary.value = "";
  chatSummarizedMessageCount.value = 0;
  renderChatConversation([]);
}



export function getDocumentChatId(documentProxy: PDFDocumentProxy): string {
  return createDocumentAgentId(
    getPdfFingerprint(documentProxy),
    sourceName.value,
    documentProxy.numPages,
  );
}



export function queueChatConversationPersistence(
  documentProxy: PDFDocumentProxy | null,
): Promise<void> {
  if (!documentProxy || !isDocumentAgentStorageAvailable()) return Promise.resolve();
  const documentId = getDocumentChatId(documentProxy);
  const title = sourceName.value ? getDisplayFileName(sourceName.value) : "未命名 PDF";
  const messages = chatHistory.value.map((message) => ({
    ...message,
    images: message.images?.map((image) => ({ ...image })),
  }));
  const conversationSummary = chatConversationSummary.value;
  const summarizedMessageCount = chatSummarizedMessageCount.value;
  chatPersistenceQueue.value = chatPersistenceQueue.value
    .catch(() => undefined)
    .then(async () => {
      const existing = await getLatestDocumentSession(documentId);
      const now = Date.now();
      await putDocumentSession({
        id: existing?.id ?? `${documentId}:chat:default`,
        documentId,
        title,
        messages,
        conversationSummary: conversationSummary || undefined,
        summarizedMessageCount: summarizedMessageCount || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    })
    .catch((error) => {
      console.warn("[PDFPal 对话存储] 保存失败", {
        documentId,
        error,
      });
    });
  return chatPersistenceQueue.value;
}



export async function restoreChatConversation(
  documentProxy: PDFDocumentProxy,
): Promise<void> {
  if (!isDocumentAgentStorageAvailable()) {
    resetChatConversation();
    return;
  }
  const documentId = getDocumentChatId(documentProxy);
  try {
    await chatPersistenceQueue.value;
    const session = await getLatestDocumentSession(documentId);
    if (pdfDocument.value !== documentProxy) return;
    const storedMessages = (session?.messages ?? [])
      .filter(
        (message): message is AiConversationMessage =>
          (message?.role === "user" || message?.role === "assistant") &&
          typeof message.content === "string" &&
          Boolean(message.content.trim()),
      )
      .map((message) => ({
        ...message,
        images: Array.isArray(message.images)
          ? message.images.filter(
              (image) =>
                image &&
                typeof image.id === "string" &&
                typeof image.name === "string" &&
                typeof image.dataUrl === "string" &&
                image.dataUrl.startsWith("data:image/"),
            )
          : undefined,
      }));
    const messages: AiConversationMessage[] = [];
    let citationsChanged = false;
    for (const message of storedMessages) {
      if (
        message.role !== "assistant" ||
        !createPdfCitationPattern().test(message.content)
      ) {
        messages.push(message);
        continue;
      }
      const validatedContent = await validatePdfCitations(
        message.content,
        documentProxy,
      );
      citationsChanged ||= validatedContent !== message.content;
      messages.push({ ...message, content: validatedContent });
    }
    if (pdfDocument.value !== documentProxy) return;
    chatConversationSummary.value =
      typeof session?.conversationSummary === "string"
        ? session.conversationSummary.trim().slice(0, 12000)
        : "";
    chatSummarizedMessageCount.value = chatConversationSummary.value
      ? Math.min(
          messages.length,
          Math.max(0, Math.trunc(Number(session?.summarizedMessageCount) || 0)),
        )
      : 0;
    renderChatConversation(messages);
    if (citationsChanged) void queueChatConversationPersistence(documentProxy);
    console.info("[PDFPal 对话存储] 已恢复当前 PDF 对话", {
      documentId,
      messages: messages.length,
      citationsRevalidated: citationsChanged,
      summarizedMessages: chatSummarizedMessageCount.value,
      updatedAt: session?.updatedAt,
    });
  } catch (error) {
    if (pdfDocument.value === documentProxy) resetChatConversation();
    console.warn("[PDFPal 对话存储] 恢复失败", {
      documentId,
      error,
    });
  }
}



export async function prepareChatRequestHistory(
  assistantMessage: HTMLElement,
  documentProxy: PDFDocumentProxy | null,
): Promise<{
  messages: AiConversationMessage[];
  summary?: string;
}> {
  const unsummarizedMessages = chatHistory.value.slice(chatSummarizedMessageCount.value);
  const unsummarizedCharacters = unsummarizedMessages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  const shouldCompress =
    unsummarizedMessages.length >
      conversationMemoryConfig.value.compressionMaxRecentMessages ||
    unsummarizedCharacters >
      conversationMemoryConfig.value.compressionTriggerCharacters;
  if (!shouldCompress) {
    return {
      messages: unsummarizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      summary: chatConversationSummary.value || undefined,
    };
  }

  const compressThrough = Math.max(
    chatSummarizedMessageCount.value,
    chatHistory.value.length - conversationMemoryConfig.value.compressionKeepRecentMessages,
  );
  const messagesToCompress = chatHistory.value
    .slice(chatSummarizedMessageCount.value, compressThrough)
    .map((message) => ({ role: message.role, content: message.content }));
  if (messagesToCompress.length === 0) {
    return {
      messages: unsummarizedMessages.slice(
        -conversationMemoryConfig.value.compressionMaxRecentMessages,
      ),
      summary: chatConversationSummary.value || undefined,
    };
  }

  updateChatActivity(
    assistantMessage,
    "conversation-compression",
    "正在压缩较早对话",
    "active",
    `${messagesToCompress.length} 条`,
  );
  console.groupCollapsed("[PDFPal AI] 对话上下文压缩");
  console.log("已有长期摘要\n", chatConversationSummary.value || "（无）");
  console.log("本次压缩对话\n", messagesToCompress);
  console.groupEnd();

  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-compress-conversation",
      previousSummary: chatConversationSummary.value || undefined,
      messages: messagesToCompress,
    })) as AiRuntimeResponse;
    if (!response?.ok || !response.content?.trim()) {
      throw new Error(response?.error || "模型没有返回有效的对话摘要。");
    }
    chatConversationSummary.value = response.content.trim().slice(0, 12000);
    chatSummarizedMessageCount.value = compressThrough;
    console.log("[PDFPal AI] 对话长期摘要\n", chatConversationSummary.value);
    updateChatActivity(
      assistantMessage,
      "conversation-compression",
      "较早对话已压缩",
      "done",
      `${chatSummarizedMessageCount.value} 条已归入长期摘要`,
    );
    void queueChatConversationPersistence(documentProxy);
    return {
      messages: chatHistory.value
        .slice(chatSummarizedMessageCount.value)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
      summary: chatConversationSummary.value,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[PDFPal AI] 对话压缩失败，回退到最近对话", error);
    updateChatActivity(
      assistantMessage,
      "conversation-compression",
      "对话压缩失败，已使用最近记录",
      "error",
      message,
    );
    return {
      messages: unsummarizedMessages.slice(
        -conversationMemoryConfig.value.compressionMaxRecentMessages,
      ),
      summary: chatConversationSummary.value || undefined,
    };
  }
}
