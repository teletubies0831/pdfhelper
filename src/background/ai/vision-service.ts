import {
  getMoonshotReasoningPayload,
  getProviderErrorMessage,
  type AiDocumentContext,
  type AiNativeToolCall,
  type AiStreamCompletionInfo,
  type AiStreamErrorInfo,
  type ProviderChatResult,
  type VisionAiConfig,
} from "../../modules/ai/public";

export function getProviderError(payload: unknown, fallback: string): string {
  return getProviderErrorMessage(payload, fallback);
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
  testMaxOutputTokens?: number,
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
    signal: AbortSignal.timeout(120_000),
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
            "你是 PDF Helper 的视觉阅读工具，只分析图片中实际可见的内容。",
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
      max_tokens: testMaxOutputTokens ?? 1600,
      ...(testMaxOutputTokens ? getMoonshotReasoningPayload(config.baseUrl, config.model, false) : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}：${getProviderError(payload, '视觉模型请求失败')}`,
    );
  }
  const content = getVisionContent(payload);
  if (!content) {
    if (payload?.choices?.[0]?.finish_reason === 'length') {
      throw new Error('视觉模型已达到输出 Token 上限，尚未生成正文；可在“设置 → 常规”提高测试输出上限后重试。');
    }
    throw new Error("视觉模型没有返回有效内容。");
  }
  return { content, model: config.model };
}
