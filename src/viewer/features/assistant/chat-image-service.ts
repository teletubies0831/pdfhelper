import { browser } from "wxt/browser";

import {
  isVisionAiConfigured,
  type AiImageAttachment,
  type AiRuntimeResponse,
  type AiStreamStartMessage,
} from "../../../modules/ai/public";
import {
  pendingChatImages,
  visionAiConfig,
} from "../../core/pdf-reader/public";
import { chatImageInput } from "../../app/viewer-elements";

import { renderPendingChatImages } from "./chat-view";

export function clearPendingChatImages(): void {
  pendingChatImages.value = [];
  chatImageInput.value = "";
  renderPendingChatImages();
}

export async function inspectChatImageWithVision(
  attachment: AiImageAttachment,
  question: string,
  context: AiStreamStartMessage["context"],
): Promise<string> {
  if (!isVisionAiConfigured(visionAiConfig.value)) {
    throw new Error("请先在“设置 → 视觉模型”中启用并配置视觉模型。");
  }
  const response = (await browser.runtime.sendMessage({
    type: "pdf-helper:ai-vision",
    prompt: [
      "这是用户随聊天消息附加的截图。",
      question
        ? `用户问题：${question.slice(0, 2000)}`
        : "用户希望你分析这张截图。",
      "请准确识别截图中的文字、公式、图表、界面状态和重要空间关系。",
      "输出可直接交给主语言模型使用的中文事实说明；不确定的地方明确标注，不要猜测。",
    ].join("\n"),
    imageDataUrl: attachment.dataUrl,
    context,
  })) as AiRuntimeResponse;
  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || `视觉模型未能分析 ${attachment.name}。`);
  }
  return response.content.trim();
}
