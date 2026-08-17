

import { normalizeConversationMemoryConfig, type ConversationMemoryConfig } from "../../../../shared/memory";

import { aiConfig } from "../../core/pdf-reader/public";

import { chatCompressionKeepRecentMessagesInput, chatCompressionMaxRecentMessagesInput, chatCompressionTriggerCharactersInput, chatProviderStatus, deepSeekModelSelect } from "../../app/viewer-elements";






export function updateDeepSeekProviderStatus(): void {
  const modelLabel =
    deepSeekModelSelect.selectedOptions[0]?.textContent?.trim() ||
    aiConfig.value.model;
  chatProviderStatus.textContent = aiConfig.value.apiKey
    ? `${modelLabel} · 已配置`
    : "AI 尚未配置";
  chatProviderStatus.classList.toggle("configured", Boolean(aiConfig.value.apiKey));
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
