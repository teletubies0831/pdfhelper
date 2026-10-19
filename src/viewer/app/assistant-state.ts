import {
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  type AiConfig,
  type AiConversationMessage,
  type AiImageAttachment,
  type AiWebRetrievalConfig,
  type VisionAiConfig,
} from "../../modules/ai/public";
import {
  DEFAULT_CONVERSATION_MEMORY_CONFIG,
  type ConversationMemoryConfig,
} from "../../modules/memory/public";
import {
  type ReadingModePreference,
  type ResolvedReadingMode,
} from "../../modules/reading-mode/public";
import {
  aiSettingsButton,
  appFrame,
  assistantChatPanel,
  assistantSettingsPanel,
  assistantToolsRuntime,
  assistantViewButtons,
  chatInput,
  settingsModalBackdrop,
} from "./viewer-elements";

export let aiConfig: { value: AiConfig } = { value: { ...DEFAULT_AI_CONFIG } };

export let conversationMemoryConfig: { value: ConversationMemoryConfig } = { value: {
  ...DEFAULT_CONVERSATION_MEMORY_CONFIG,
} };

export let aiConfigLoaded = { value: false };

export let visionAiConfig: { value: VisionAiConfig } = { value: { ...DEFAULT_VISION_AI_CONFIG } };

/**
 * The resolved DeepSeek tools settings, or `null` when they cannot be used.
 *
 * Resolved once per configuration change and read synchronously by the UI (the 联网 switch, the 检索 button)
 * instead of each of them re-deriving "is web retrieval available" from the raw catalog.
 */
export let webRetrievalConfig: { value: AiWebRetrievalConfig | null } = { value: null };

export let chatHistory: { value: AiConversationMessage[] } = { value: [] };

export let chatConversationSummary = { value: "" };

export let chatSummarizedMessageCount = { value: 0 };

export let chatRequestPending = { value: false };

export let chatPersistenceQueue: { value: Promise<void> } = { value: Promise.resolve() };

export let pendingChatImages: { value: AiImageAttachment[] } = { value: [] };

export let chatImagePreviewOverlay: { value: HTMLElement | null } = { value: null };

export let readingModePreference: { value: ReadingModePreference } = { value: "auto" };

export let resolvedReadingMode: { value: ResolvedReadingMode } = { value: "general" };

export let readingModeDetectionPending = { value: false };

export let readingModeDocumentKey = { value: "" };

export let readingModeRationale = { value: "" };

export let readingModeError = { value: "" };

export type AssistantView = "chat" | "translate" | "summary" | "cards";

export let activeAssistantView: { value: AssistantView } = { value: "chat" };

export let settingsCloseAnimationTimer: number | undefined;

/**
 * Assistant-domain state must not import feature code (features import this
 * state back through app/public). Interactions that need feature behavior —
 * cancelling translation/summary/card work, activating the AI tab, refreshing
 * the settings presentation — are injected by the registration layer.
 */
export interface AssistantChoreography {
  cancelTranslation(): void;
  cancelSummary(): void;
  cancelCard(): void;
  activateTab(view: AssistantView): void;
  resetSettingsPresentation(): void;
  refreshLongTermMemory(): void;
}

let assistantChoreography: AssistantChoreography | null = null;

export function setAssistantChoreography(next: AssistantChoreography | null): void {
  assistantChoreography = next;
}

export function setAssistantView(view: AssistantView): void {
  activeAssistantView.value = view;
  const showChat = view === "chat";
  for (const button of assistantViewButtons) {
    const isActive = button.dataset.assistantView === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  assistantChatPanel.hidden = !showChat;
  assistantToolsRuntime.classList.toggle("active", !showChat);
  assistantToolsRuntime.setAttribute("aria-hidden", String(showChat));

  if (view !== "translate") assistantChoreography?.cancelTranslation();
  if (view !== "summary") assistantChoreography?.cancelSummary();
  if (view !== "cards") assistantChoreography?.cancelCard();

  if (showChat) {
    window.setTimeout(() => chatInput.focus(), 0);
  } else {
    assistantChoreography?.activateTab(view);
  }
}

export function showSettingsSavedFeedback(): void {
  aiSettingsButton.classList.remove("saved");
  aiSettingsButton.setAttribute("aria-label", "打开设置");
}

export function setDeepSeekSettingsOpen(open: boolean): void {
  if (assistantSettingsPanel.parentElement !== document.body) {
    document.body.append(assistantSettingsPanel);
  }

  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer);
    settingsCloseAnimationTimer = undefined;
  }

  if (open) {
    assistantSettingsPanel.hidden = false;
    settingsModalBackdrop.hidden = false;
    settingsModalBackdrop.setAttribute("aria-hidden", "false");
    if (appFrame) appFrame.inert = true;
    document.body.classList.add("settings-modal-open");
    aiSettingsButton.classList.add("active");
    aiSettingsButton.setAttribute("aria-expanded", "true");
    assistantChoreography?.resetSettingsPresentation();

    // Commit the resting state before entering so both opacity and transform
    // interpolate. This is one small layout read, not a per-frame layout cost.
    assistantSettingsPanel.classList.remove("is-open");
    settingsModalBackdrop.classList.remove("is-open");
    void assistantSettingsPanel.offsetWidth;
    assistantSettingsPanel.classList.add("is-open");
    settingsModalBackdrop.classList.add("is-open");

    assistantChoreography?.refreshLongTermMemory();
  } else {
    assistantSettingsPanel.classList.remove("is-open");
    settingsModalBackdrop.classList.remove("is-open");
    settingsModalBackdrop.setAttribute("aria-hidden", "true");
    if (appFrame) appFrame.inert = false;
    document.body.classList.remove("settings-modal-open");
    aiSettingsButton.classList.remove("active");
    aiSettingsButton.setAttribute("aria-expanded", "false");

    settingsCloseAnimationTimer = window.setTimeout(() => {
      assistantSettingsPanel.hidden = true;
      settingsModalBackdrop.hidden = true;
      settingsCloseAnimationTimer = undefined;
    }, 340);
    aiSettingsButton.focus({ preventScroll: true });
  }
}
