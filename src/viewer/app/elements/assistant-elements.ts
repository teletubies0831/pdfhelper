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

export const clearChatDialog = requiredElement<HTMLDialogElement>(
  "clear-chat-dialog",
);

export const clearChatDialogCloseButton = requiredElement<HTMLButtonElement>(
  "clear-chat-dialog-close",
);

export const clearChatDialogCancelButton = requiredElement<HTMLButtonElement>(
  "clear-chat-dialog-cancel",
);

export const clearChatDialogConfirmButton = requiredElement<HTMLButtonElement>(
  "clear-chat-dialog-confirm",
);

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

/** The reasoning switch. Its state is carried by colour, so the button is only a switch, not a menu. */
export const chatReasoningTrigger = requiredElement<HTMLButtonElement>(
  "chat-reasoning-trigger",
);

/**
 * The web-search switch, next to it and the same shape.
 *
 * Kept separate from `chat-reasoning-trigger` on purpose: the two capabilities cost money per use and are
 * switched independently, so one shared control would make "which one is on" ambiguous in the UI.
 */
export const chatWebSearchTrigger = requiredElement<HTMLButtonElement>(
  "chat-web-search-trigger",
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
export const testSelectedModelsButton = requiredElement<HTMLButtonElement>("test-selected-models");

/**
 * The 「联网检索」 block: DeepSeek's Search / Fetch settings.
 *
 * Its own fields rather than a per-connection one, because these endpoints take no model: the settings belong
 * to the DeepSeek *service*, and a user whose chat runs on another provider still needs them.
 */
export const webRetrievalBaseUrlInput =
  requiredElement<HTMLInputElement>("web-retrieval-base-url");

export const webRetrievalApiKeyInput =
  requiredElement<HTMLInputElement>("web-retrieval-api-key");

export const webRetrievalCountInput =
  requiredElement<HTMLInputElement>("web-retrieval-count");

export const webRetrievalMaxFetchesInput =
  requiredElement<HTMLInputElement>("web-retrieval-max-fetches");

export const testWebRetrievalButton =
  requiredElement<HTMLButtonElement>("test-web-retrieval");

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

export const autoSaveAnnotationsInput =
  requiredElement<HTMLInputElement>("auto-save-annotations");

export const knowledgeRetrievalModeSelect =
  requiredElement<HTMLSelectElement>("knowledge-retrieval-mode");

export const knowledgeEmbeddingModelSelect =
  requiredElement<HTMLSelectElement>("knowledge-embedding-model");

export const knowledgeCustomEmbeddingModelField =
  requiredElement<HTMLElement>("knowledge-custom-embedding-model-field");

export const knowledgeCustomEmbeddingModelInput =
  requiredElement<HTMLInputElement>("knowledge-custom-embedding-model");

export const knowledgeEmbeddingActiveStatus =
  requiredElement<HTMLElement>("knowledge-embedding-active-status");

export const knowledgeEmbeddingProgress =
  requiredElement<HTMLProgressElement>("knowledge-embedding-progress");

export const knowledgeEmbeddingProgressLabel =
  requiredElement<HTMLElement>("knowledge-embedding-progress-label");

export const applyKnowledgeRetrievalSettingsButton =
  requiredElement<HTMLButtonElement>("apply-knowledge-retrieval-settings");

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

export const settingsAvailableModelCount = requiredElement<HTMLElement>(
  "settings-available-model-count",
);

export const settingsAvailableModelResults = requiredElement<HTMLElement>(
  "settings-available-model-results",
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

export const settingsTutorialButton = requiredElement<HTMLButtonElement>(
  "settings-tutorial-button",
);

export const startOnboardingTourButton = requiredElement<HTMLButtonElement>(
  "start-onboarding-tour",
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

export const translationPreferenceCount = requiredElement<HTMLElement>(
  "translation-preference-count",
);

export const translationPreferenceList = requiredElement<HTMLElement>(
  "translation-preference-list",
);

export const translationPreferenceStatus = requiredElement<HTMLElement>(
  "translation-preference-status",
);

export const addTranslationPreferenceButton = requiredElement<HTMLButtonElement>(
  "add-translation-preference",
);

export const suggestTranslationPreferencesButton = requiredElement<HTMLButtonElement>(
  "suggest-translation-preferences",
);

export const translationPreferenceDialog = requiredElement<HTMLDialogElement>(
  "translation-preference-dialog",
);

export const translationPreferenceForm = requiredElement<HTMLFormElement>(
  "translation-preference-form",
);

export const translationPreferenceTermInput = requiredElement<HTMLInputElement>(
  "translation-preference-term",
);

export const translationPreferenceKindSelect = requiredElement<HTMLSelectElement>(
  "translation-preference-kind",
);

export const translationPreferenceContextualFields = requiredElement<HTMLElement>(
  "translation-preference-contextual-fields",
);

export const translationPreferenceDefaultInput = requiredElement<HTMLInputElement>(
  "translation-preference-default",
);

export const translationPreferenceContextTermsInput = requiredElement<HTMLInputElement>(
  "translation-preference-context-terms",
);

export const translationPreferenceContextTranslationInput = requiredElement<HTMLInputElement>(
  "translation-preference-context-translation",
);

export const translationPreferenceCancelButton = requiredElement<HTMLButtonElement>(
  "translation-preference-cancel",
);

export const translationPreferenceSuggestionsDialog = requiredElement<HTMLDialogElement>(
  "translation-preference-suggestions-dialog",
);

export const translationPreferenceSuggestionsList = requiredElement<HTMLElement>(
  "translation-preference-suggestions",
);

export const translationPreferenceSuggestionsCancelButton = requiredElement<HTMLButtonElement>(
  "translation-preference-suggestions-cancel",
);

export const translationPreferenceSuggestionsSaveButton = requiredElement<HTMLButtonElement>(
  "translation-preference-suggestions-save",
);
