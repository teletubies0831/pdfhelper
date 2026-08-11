

import { normalizeAiBaseUrl, normalizeAiMaxOutputTokens, type AiConfig, type AiProviderId, type AiReasoningMode } from "../../../../shared/ai";
import { normalizeConversationMemoryConfig, type ConversationMemoryConfig } from "../../../../shared/memory";

import { aiConfig } from "../../core/pdf-reader/public";

import { aiProviderSelect, chatCompressionKeepRecentMessagesInput, chatCompressionMaxRecentMessagesInput, chatCompressionTriggerCharactersInput, chatProviderStatus, deepSeekApiKeyInput, deepSeekBaseUrlInput, deepSeekMaxOutputTokensInput, deepSeekModelSelect, deepSeekThinkingSelect, translationModelSelect } from "../../app/viewer-elements";






export function updateDeepSeekProviderStatus(): void {
  const modelLabel =
    deepSeekModelSelect.selectedOptions[0]?.textContent?.trim() ||
    aiConfig.value.model;
  chatProviderStatus.textContent = aiConfig.value.apiKey
    ? `${modelLabel} · 已配置`
    : "AI 尚未配置";
  chatProviderStatus.classList.toggle("configured", Boolean(aiConfig.value.apiKey));
}

export function readDeepSeekConfigFromForm(): AiConfig {
  const providerId = aiProviderSelect.value as AiProviderId;
  return {
    providerId,
    apiKey: deepSeekApiKeyInput.value.trim(),
    baseUrl: normalizeAiBaseUrl(deepSeekBaseUrlInput.value, providerId),
    model: deepSeekModelSelect.value,
    translationModel: translationModelSelect.value,
    reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
    maxOutputTokens: normalizeAiMaxOutputTokens(
      deepSeekMaxOutputTokensInput.value,
    ),
  };
}

export function readConversationMemoryConfigFromForm(): ConversationMemoryConfig {
  return normalizeConversationMemoryConfig({
    compressionTriggerCharacters:
      Number(chatCompressionTriggerCharactersInput.value),
    compressionMaxRecentMessages:
      Number(chatCompressionMaxRecentMessagesInput.value),
    compressionKeepRecentMessages:
      Number(chatCompressionKeepRecentMessagesInput.value),
  });
}

export function populateConversationMemoryConfigForm(
  config: ConversationMemoryConfig,
): void {
  chatCompressionTriggerCharactersInput.value = String(
    config.compressionTriggerCharacters,
  );
  chatCompressionMaxRecentMessagesInput.value = String(
    config.compressionMaxRecentMessages,
  );
  chatCompressionKeepRecentMessagesInput.value = String(
    config.compressionKeepRecentMessages,
  );
  chatCompressionKeepRecentMessagesInput.max = String(
    Math.max(2, config.compressionMaxRecentMessages - 1),
  );
}
