import { getSafeProviderErrorDetails, type AiConfig } from "../../modules/ai/public";
import type { AiProviderAdapter } from "./provider-runtime";
import type { ProviderMessage } from "./vision-service";

/** Overview budgets include reasoning tokens on models that cannot turn thinking off. */
export async function requestOverviewCompletion(
  adapter: AiProviderAdapter,
  config: AiConfig,
  messages: ProviderMessage[],
  signal?: AbortSignal,
) {
  const taskConfig: AiConfig = { ...config, reasoning: "disabled" };
  const initialBudget = Math.max(8_192, config.maxOutputTokens);
  for (const budget of [initialBudget, initialBudget * 2]) {
    try {
      const result = await adapter.chat(taskConfig, messages, budget, signal);
      if (result.completion?.finishReason === "length") {
        if (budget === initialBudget) continue;
        throw new Error("概览输出仍被模型截断，未将不完整内容保存为成功结果。请换用支持关闭思考的模型后重试。");
      }
      if (!result.content.trim()) throw new Error("AI 模型没有返回概览正文。");
      return result;
    } catch (error) {
      const details = getSafeProviderErrorDetails(error);
      if (budget === initialBudget && (details.finishReason === "length" ||
          (details.contentLength === 0 && (details.reasoningLength ?? 0) > 0))) continue;
      throw error;
    }
  }
  throw new Error("AI 模型没有返回完整概览。");
}
