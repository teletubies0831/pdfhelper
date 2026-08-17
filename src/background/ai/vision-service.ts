import {
  type AiDocumentContext,
  type AiStreamCompletionInfo,
  type AiStreamErrorInfo,
  type AiNativeToolCall,
  type VisionAiConfig,
} from "../../../shared/ai";

export function getProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as { error?: unknown; code?: unknown; message?: unknown };
  const nestedError = record.error;
  if (typeof nestedError === "string" && nestedError.trim()) return nestedError.trim();
  if (nestedError && typeof nestedError === "object") {
    const nestedMessage = (nestedError as { message?: unknown }).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) {
    const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : "";
    return code ? `${code}: ${record.message.trim()}` : record.message.trim();
  }
  return fallback;
}

export type ProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    index?: number;
    function: { name: string; arguments: string };
  }>;
};

export interface ProviderChatResult {
  content: string;
  model: string;
  reasoningContent?: string;
  toolCalls?: AiNativeToolCall[];
  completion?: AiStreamCompletionInfo;
}

export interface ProviderStreamDelta {
  content?: string;
  reasoningContent?: string;
}

export class AiProviderRequestError extends Error {
  constructor(
    message: string,
    readonly details: AiStreamErrorInfo,
  ) {
    super(message);
    this.name = "AiProviderRequestError";
  }
}

export function getSafeErrorDetails(error: unknown): AiStreamErrorInfo {
  if (error instanceof AiProviderRequestError) return error.details;
  return {
    name: error instanceof Error ? error.name : "UnknownError",
  };
}

export function getVisionContent(payload: unknown): string {
  const content = (
    payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
    }
  )?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String((item as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n")
    .trim();
}

export async function requestVisionCompletion(
  config: VisionAiConfig,
  prompt: string,
  imageDataUrl: string,
  context?: AiDocumentContext,
  maxOutputTokens = 1600,
): Promise<ProviderChatResult> {
  if (
    config.mode !== "separate" ||
    !config.apiKey ||
    !config.baseUrl ||
    !config.model
  ) {
    throw new Error("请先在“设置”中完成视觉模型配置。");
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: [
            "你是 PDFPal 的视觉阅读工具，只分析图片中实际可见的内容。",
            "优先识别图表、公式、表格、流程图、页面结构以及文字抽取遗漏的信息。",
            "不确定时明确说明，不要补写图片中不存在的内容。",
            context?.documentName ? `文档：${context.documentName}` : "",
            context?.pageNumber ? `页码：第 ${context.pageNumber} 页` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
      stream: false,
      max_tokens: maxOutputTokens,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      getProviderError(payload, `视觉模型请求失败：HTTP ${response.status}`),
    );
  }
  const content = getVisionContent(payload);
  if (!content) throw new Error("视觉模型没有返回有效内容。");
  return { content, model: config.model };
}
