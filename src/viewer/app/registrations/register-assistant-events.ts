





import { browser } from "wxt/browser";
import { AI_CONFIG_STORAGE_KEY, AI_PROVIDERS, type AiProviderId, type AiReasoningMode } from "../../../../shared/ai";
import { isReadingModePreference } from "../../../../shared/reading-mode";




import { memoryTools } from "../../../../entrypoints/viewer/memory-store";



import { aiPanelToggleButton, aiProviderSelect, aiSettingsButton, aiTabButtons, appFrame, assistantPanelToggleButton, assistantSettingsPanel, assistantViewButtons, chatCompressionKeepRecentMessagesInput, chatCompressionMaxRecentMessagesInput, chatForm, chatImageButton, chatImageInput, chatInput, chatMessagesElement, clearChatButton, closeDeepSeekSettingsButton, deepSeekBaseUrlInput, deepSeekSettingsStatus, deepSeekThinkingSelect, detectReadingModeButton, focusModeButton, knowledgeBasePageElement, longTermMemoryList, outlineToggleButton, paperCardPageElement, readingJournalPageElement, readingModeSelect, refreshLongTermMemoriesButton, saveDeepSeekSettingsButton, settingsModalBackdrop, testDeepSeekButton, testVisionAiButton, visionAiModeSelect } from "../viewer-elements";
import { aiConfig, aiConfigLoaded, chatHistory, chatImagePreviewOverlay, chatRequestPending, readingModePreference, setAssistantView, setDeepSeekSettingsOpen, setFocusMode, setLeftPanelCollapsed, showSettingsSavedFeedback } from "../../core/pdf-reader/public";
import { jumpToPdfCitations } from "../../features/translation/public";

import { bindPaperCardTextareaAutoResize, closePaperCardPage, closeReadingJournalPage } from "../../features/paper-card/public";
import { pdfDocument } from "../viewer-state";
import { addChatImageFiles, closeChatImagePreview, detectReadingMode, getDocumentChatId, openChatImagePreview, queueChatConversationPersistence, refreshLongTermMemoryList, resetChatConversation, saveDeepSeekConfig, sendChatMessage, setCurrentApplicationView, setReadingModePreference, testDeepSeekConnection, testVisionAiConnection, updateVisionAiFieldsVisibility } from "../../features/assistant/public";



import { closeKnowledgeBasePage } from "../../features/knowledge-base/public";
import type { AssistantView } from "../../core/pdf-reader/public";

import { toolbarMenus, setToolbarMenuOpen, closeToolbarMenus, activateAiTab } from '../app-ui';

export function registerAssistantEvents(): void {
  for (const menu of toolbarMenus) {
      const trigger = menu.querySelector<HTMLButtonElement>(
        ".toolbar-menu-trigger",
      );
      const panel = menu.querySelector<HTMLElement>(".toolbar-menu-panel");
      if (!trigger || !panel) continue;
    
      trigger.addEventListener("click", () => {
        const willOpen = panel.hidden;
        closeToolbarMenus(menu);
        setToolbarMenuOpen(menu, willOpen);
      });
    
      panel.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const action = target.closest('button, label[role="menuitem"]');
        const isColorPicker = Boolean(target.closest(".highlight-color-control"));
        if (action && !isColorPicker) {
          window.setTimeout(() => setToolbarMenuOpen(menu, false), 0);
        }
      });
    }
  
  document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (!toolbarMenus.some((menu) => menu.contains(target))) closeToolbarMenus();
    });
  
  document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeToolbarMenus();
      if (!assistantSettingsPanel.hidden) setDeepSeekSettingsOpen(false);
    });
  
  outlineToggleButton?.addEventListener("click", () => {
      setLeftPanelCollapsed(!appFrame?.classList.contains("left-panel-collapsed"));
    });
  
  aiPanelToggleButton?.addEventListener("click", () => {
      if (!readingJournalPageElement.hidden) {
        closeReadingJournalPage();
        return;
      }
      if (!paperCardPageElement.hidden) {
        closePaperCardPage();
        return;
      }
      if (!knowledgeBasePageElement.hidden) {
        closeKnowledgeBasePage();
        return;
      }
      setCurrentApplicationView("viewer");
    });
  
  assistantPanelToggleButton.addEventListener("click", () => {
      if (!readingJournalPageElement.hidden) closeReadingJournalPage();
      if (!paperCardPageElement.hidden) closePaperCardPage();
      if (!knowledgeBasePageElement.hidden) closeKnowledgeBasePage();
      const willOpen =
        appFrame?.classList.contains("right-panel-collapsed") ?? false;
      appFrame?.classList.toggle("right-panel-collapsed");
      assistantPanelToggleButton.classList.toggle("active", willOpen);
      if (willOpen) setAssistantView("chat");
    });
  
  focusModeButton.addEventListener("click", () => {
      setFocusMode(!appFrame?.classList.contains("focus-mode"));
    });
  
  for (const button of assistantViewButtons) {
      button.addEventListener("click", () => {
        const view = button.dataset.assistantView as AssistantView | undefined;
        if (view) setAssistantView(view);
      });
    }
  
  aiSettingsButton.addEventListener("click", () => {
      setDeepSeekSettingsOpen(assistantSettingsPanel.hidden);
    });
  
  readingModeSelect.addEventListener("change", () => {
      const preference = readingModeSelect.value;
      if (isReadingModePreference(preference))
        void setReadingModePreference(preference);
    });
  
  detectReadingModeButton.addEventListener("click", () => {
      readingModePreference.value = "auto";
      void detectReadingMode(true);
    });
  
  aiProviderSelect.addEventListener("change", () => {
      const providerId = aiProviderSelect.value as AiProviderId;
      const provider = AI_PROVIDERS.find((item) => item.id === providerId);
      if (!provider?.available) {
        aiProviderSelect.value = aiConfig.value.providerId;
        deepSeekSettingsStatus.classList.add("error");
        deepSeekSettingsStatus.textContent = "该模型供应商尚未接入。";
        return;
      }
      deepSeekBaseUrlInput.value = provider.defaultBaseUrl;
    });
  
  visionAiModeSelect.addEventListener("change", updateVisionAiFieldsVisibility);
  
  closeDeepSeekSettingsButton.addEventListener("click", () => {
      setDeepSeekSettingsOpen(false);
    });
  
  settingsModalBackdrop.addEventListener("pointerdown", (event) => {
      if (event.target !== settingsModalBackdrop) return;
      setDeepSeekSettingsOpen(false);
    });
  
  saveDeepSeekSettingsButton.addEventListener("click", () => {
      void saveDeepSeekConfig().then((saved) => {
        if (!saved) return;
    
        setDeepSeekSettingsOpen(false);
        showSettingsSavedFeedback();
    
        if (pdfDocument.value && readingModePreference.value === "auto") {
          void detectReadingMode(true);
        }
      });
    });
  
  testDeepSeekButton.addEventListener("click", () => {
      void testDeepSeekConnection();
    });
  
  testVisionAiButton.addEventListener("click", () => {
      void testVisionAiConnection();
    });
  
  refreshLongTermMemoriesButton.addEventListener("click", () => {
      void refreshLongTermMemoryList();
    });
  
  longTermMemoryList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-memory-id]",
      );
      const memoryId = button?.dataset.memoryId;
      if (!memoryId) return;
      button.disabled = true;
      void memoryTools
        .forget(memoryId)
        .then(() => refreshLongTermMemoryList())
        .catch((error) => {
          button.disabled = false;
          console.warn("[PDF Helper 长期记忆] 删除失败", error);
        });
    });
  
  chatCompressionMaxRecentMessagesInput.addEventListener("input", () => {
      const maxRecent = Math.max(
        4,
        Math.trunc(Number(chatCompressionMaxRecentMessagesInput.value) || 16),
      );
      chatCompressionKeepRecentMessagesInput.max = String(maxRecent - 1);
    });
  
  deepSeekThinkingSelect.addEventListener("change", () => {
      aiConfig.value = {
        ...aiConfig.value,
        reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
      };
      if (aiConfigLoaded.value)
        void browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig.value });
    });
  
  chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendChatMessage();
    });
  
  chatImageButton.addEventListener("click", () => {
      if (!chatRequestPending.value) chatImageInput.click();
    });
  
  chatImageInput.addEventListener("change", () => {
      const files = chatImageInput.files;
      if (files?.length) void addChatImageFiles(files);
      chatImageInput.value = "";
    });
  
  chatInput.addEventListener("paste", (event) => {
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (imageFiles.length === 0) return;
      event.preventDefault();
      void addChatImageFiles(imageFiles);
    });
  
  clearChatButton.addEventListener("click", () => {
      if (chatRequestPending.value) return;
      if (
        chatHistory.value.length > 0 &&
        !window.confirm("确定清空当前 PDF 的全部聊天记录吗？")
      )
        return;
      const documentAtClear = pdfDocument.value;
      resetChatConversation();
      void queueChatConversationPersistence(documentAtClear).then(() => {
        console.info("[PDF Helper 对话存储] 已清空当前 PDF 对话", {
          documentId: documentAtClear
            ? getDocumentChatId(documentAtClear)
            : undefined,
        });
      });
    });
  
  chatMessagesElement.addEventListener("click", (event) => {
      const previewImage = (
        event.target as Element | null
      )?.closest<HTMLImageElement>(".chat-message-image");
      if (previewImage) {
        openChatImagePreview(previewImage.src, previewImage.alt);
        return;
      }
      const citation = (event.target as Element | null)?.closest<HTMLButtonElement>(
        ".pdf-source-citation",
      );
      if (!citation) return;
      const pageNumber = Number(citation.dataset.pdfPage);
      const fallbackQuote = citation.dataset.pdfQuote?.trim() ?? "";
      let quotes = fallbackQuote ? [fallbackQuote] : [];
      try {
        const parsedQuotes = JSON.parse(citation.dataset.pdfQuotes ?? "null");
        if (Array.isArray(parsedQuotes)) {
          quotes = parsedQuotes.filter(
            (quote): quote is string => typeof quote === "string" && Boolean(quote.trim()),
          );
        }
      } catch {
        // Compatibility with citations stored before multi-range citation support.
      }
      void jumpToPdfCitations(pageNumber, quotes);
    });
  
  chatMessagesElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const previewImage = (
        event.target as Element | null
      )?.closest<HTMLImageElement>(".chat-message-image");
      if (!previewImage) return;
      event.preventDefault();
      openChatImagePreview(previewImage.src, previewImage.alt);
    });
  
  document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && chatImagePreviewOverlay.value) {
        event.preventDefault();
        closeChatImagePreview();
      }
    });
  
  chatInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void sendChatMessage();
    });
  
  for (const button of aiTabButtons) {
      button.addEventListener("click", () => {
        const tabName = button.dataset.aiTab;
        if (tabName) activateAiTab(tabName);
      });
    }
  
  bindPaperCardTextareaAutoResize();
}
