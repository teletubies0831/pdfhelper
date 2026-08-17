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

export const chatReasoningControl = requiredElement<HTMLElement>(
  "chat-reasoning-control",
);

export const chatReasoningTrigger = requiredElement<HTMLButtonElement>(
  "chat-reasoning-trigger",
);

export const chatReasoningValue = requiredElement<HTMLElement>(
  "chat-reasoning-value",
);

export const chatReasoningMenu = requiredElement<HTMLElement>(
  "chat-reasoning-menu",
);

export const chatReasoningOptionButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-chat-reasoning-value]"),
);

export const deepSeekBaseUrlInput =
  requiredElement<HTMLInputElement>("deepseek-base-url");

export const deepSeekSettingsStatus = requiredElement<HTMLElement>(
  "deepseek-settings-status",
);

export const saveDeepSeekSettingsButton = requiredElement<HTMLButtonElement>(
  "save-deepseek-settings",
);

export const testDeepSeekButton = requiredElement<HTMLButtonElement>("test-deepseek");

export const visionSettingsStatus = requiredElement<HTMLElement>(
  "vision-settings-status",
);

export const testVisionAiButton = requiredElement<HTMLButtonElement>("test-vision-ai");

export const settingsPrimaryTabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"),
);

export const settingsPrimaryPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-settings-panel]"),
);

export const settingsPages = requiredElement<HTMLElement>("settings-pages");

export const settingsAgentToolCount = requiredElement<HTMLElement>(
  "settings-agent-tool-count",
);

export const settingsAgentToolCatalog = requiredElement<HTMLElement>(
  "settings-agent-tool-catalog",
);

export const settingsModelNavigation = requiredElement<HTMLElement>(
  "settings-model-navigation",
);

export const settingsModelOverview = requiredElement<HTMLElement>(
  "settings-model-overview",
);

export const settingsConnectionEditor = requiredElement<HTMLElement>(
  "settings-connection-editor",
);

export const settingsConnectionBackButton = requiredElement<HTMLButtonElement>(
  "settings-connection-back",
);

export const settingsConnectionTitle = requiredElement<HTMLElement>(
  "settings-connection-title",
);

export const settingsConnectionFields = requiredElement<HTMLElement>(
  "settings-connection-fields",
);

export const settingsConnectionGrid = requiredElement<HTMLElement>(
  "settings-connection-grid",
);

export const settingsConnectionNameInput = requiredElement<HTMLInputElement>(
  "settings-connection-name",
);

export const settingsConnectionCapabilitySelect = requiredElement<HTMLSelectElement>(
  "settings-connection-capability",
);

export const settingsConnectionModelsInput = requiredElement<HTMLTextAreaElement>(
  "settings-connection-models",
);

export const settingsConnectionModelCount = requiredElement<HTMLElement>(
  "settings-connection-model-count",
);

export const settingsConnectionModelResults = requiredElement<HTMLElement>(
  "settings-connection-model-results",
);

export const settingsConnectionManualModelInput = requiredElement<HTMLInputElement>(
  "settings-connection-manual-model",
);

export const settingsConnectionAddManualModelButton = requiredElement<HTMLButtonElement>(
  "settings-connection-add-manual-model",
);

export const settingsConnectionDeleteButton = requiredElement<HTMLButtonElement>(
  "settings-connection-delete",
);

export const visionRouteSummary = requiredElement<HTMLSelectElement>(
  "vision-route-summary",
);

export const settingsFooterNote = requiredElement<HTMLElement>(
  "settings-footer-note",
);

export const addAiProviderButton = requiredElement<HTMLButtonElement>(
  "add-ai-provider",
);

export const secretToggleButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-toggle-secret]"),
);

export const addLongTermMemoryButton = requiredElement<HTMLButtonElement>(
  "add-long-term-memory",
);

export const longTermMemorySearchInput = requiredElement<HTMLInputElement>(
  "long-term-memory-search",
);

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
