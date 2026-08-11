import { requiredElement } from "./required-element";

export const assistantViewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-assistant-view]"),
);

export const assistantChatPanel = requiredElement<HTMLElement>("assistant-chat-panel");

export const assistantSettingsPanel = requiredElement<HTMLElement>(
  "assistant-settings-panel",
);

export const settingsModalBackdrop = requiredElement<HTMLElement>(
  "settings-modal-backdrop",
);

export const assistantToolsRuntime = requiredElement<HTMLElement>(
  "assistant-tools-runtime",
);

export const closeDeepSeekSettingsButton = requiredElement<HTMLButtonElement>(
  "close-deepseek-settings",
);

export const chatMessagesElement = requiredElement<HTMLElement>("chat-messages");

export const chatForm = requiredElement<HTMLFormElement>("chat-form");

export const chatInput = requiredElement<HTMLTextAreaElement>("chat-input");

export const chatAttachmentsElement = requiredElement<HTMLElement>("chat-attachments");

export const chatImageInput = requiredElement<HTMLInputElement>("chat-image-input");

export const chatImageButton = requiredElement<HTMLButtonElement>("chat-image-button");

export const chatSendButton = requiredElement<HTMLButtonElement>("chat-send");

export const clearChatButton = requiredElement<HTMLButtonElement>("clear-chat");

export const chatProviderStatus = requiredElement<HTMLElement>("chat-provider-status");

export const aiProviderSelect = requiredElement<HTMLSelectElement>("ai-provider");

export const deepSeekApiKeyInput =
  requiredElement<HTMLInputElement>("deepseek-api-key");

export const deepSeekModelSelect =
  requiredElement<HTMLSelectElement>("deepseek-model");

export const translationModelSelect =
  requiredElement<HTMLSelectElement>("translation-model");

export const deepSeekMaxOutputTokensInput = requiredElement<HTMLInputElement>(
  "deepseek-max-output-tokens",
);

export const deepSeekThinkingSelect =
  requiredElement<HTMLSelectElement>("deepseek-thinking");

export const deepSeekBaseUrlInput =
  requiredElement<HTMLInputElement>("deepseek-base-url");

export const deepSeekSettingsStatus = requiredElement<HTMLElement>(
  "deepseek-settings-status",
);

export const saveDeepSeekSettingsButton = requiredElement<HTMLButtonElement>(
  "save-deepseek-settings",
);

export const testDeepSeekButton = requiredElement<HTMLButtonElement>("test-deepseek");

export const visionAiModeSelect = requiredElement<HTMLSelectElement>("vision-ai-mode");

export const visionAiFields = requiredElement<HTMLElement>("vision-ai-fields");

export const visionApiKeyInput = requiredElement<HTMLInputElement>("vision-api-key");

export const visionModelInput = requiredElement<HTMLInputElement>("vision-model");

export const visionBaseUrlInput = requiredElement<HTMLInputElement>("vision-base-url");

export const visionSettingsStatus = requiredElement<HTMLElement>(
  "vision-settings-status",
);

export const testVisionAiButton = requiredElement<HTMLButtonElement>("test-vision-ai");

export const chatCompressionTriggerCharactersInput = requiredElement<HTMLInputElement>(
  "chat-compression-trigger-characters",
);

export const chatCompressionMaxRecentMessagesInput = requiredElement<HTMLInputElement>(
  "chat-compression-max-recent-messages",
);

export const chatCompressionKeepRecentMessagesInput = requiredElement<HTMLInputElement>(
  "chat-compression-keep-recent-messages",
);

export const longTermMemoryCount = requiredElement<HTMLElement>(
  "long-term-memory-count",
);

export const longTermMemoryList = requiredElement<HTMLElement>(
  "long-term-memory-list",
);

export const refreshLongTermMemoriesButton = requiredElement<HTMLButtonElement>(
  "refresh-long-term-memories",
);

export const aiTabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".ai-tabs button"),
);

export const aiTabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-ai-panel]"),
);
