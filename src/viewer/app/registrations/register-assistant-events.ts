import {
  AI_PROVIDERS,
  type AiProviderId,
  type AiReasoningMode,
} from "../../../modules/ai/public";

import {
  aiPanelToggleButton,
  aiProviderSelect,
  aiSettingsButton,
  applyKnowledgeRetrievalSettingsButton,
  aiTabButtons,
  appFrame,
  assistantPanelToggleButton,
  assistantSettingsPanel,
  assistantViewButtons,
  chatCompressionKeepRecentMessagesInput,
  chatCompressionMaxRecentMessagesInput,
  chatForm,
  chatImageButton,
  chatImageInput,
  chatInput,
  chatMessagesElement,
  chatReasoningControl,
  chatReasoningMenu,
  chatReasoningOptionButtons,
  chatReasoningTrigger,
  clearChatButton,
  clearChatDialog,
  clearChatDialogCancelButton,
  clearChatDialogCloseButton,
  clearChatDialogConfirmButton,
  closeDeepSeekSettingsButton,
  deepSeekBaseUrlInput,
  deepSeekThinkingSelect,
  focusModeButton,
  knowledgeEmbeddingModelSelect,
  longTermMemoryList,
  outlineToggleButton,
  refreshLongTermMemoriesButton,
  saveDeepSeekSettingsButton,
  settingsModalBackdrop,
  testDeepSeekButton,
  testVisionAiButton,
} from "../viewer-elements";
import {
  addAiProviderButton,
  addLongTermMemoryButton,
  longTermMemorySearchInput,
  secretToggleButtons,
  settingsConnectionAddManualModelButton,
  settingsConnectionBackButton,
  settingsConnectionDeleteButton,
  settingsConnectionGrid,
  settingsConnectionManualModelInput,
  settingsPrimaryTabButtons,
} from "../viewer-elements";
import {
  aiConfig,
  aiConfigLoaded,
  chatHistory,
  chatImagePreviewOverlay,
  chatRequestPending,
  setAssistantView,
  setDeepSeekSettingsOpen,
  setFocusMode,
  setLeftPanelCollapsed,
  showSettingsSavedFeedback,
} from "../../core/pdf-reader/public";
import { jumpToPdfCitations } from "../../features/translation/public";

import { pdfDocument } from "../viewer-state";
import {
  activateSettingsTab,
  addChatImageFiles,
  cancelSettingsConnectionActivity,
  closeChatImagePreview,
  createLongTermMemory,
  deleteLongTermMemory,
  editLongTermMemory,
  filterLongTermMemoryList,
  getDocumentChatId,
  handleKnowledgeEmbeddingModelSelection,
  initializeKnowledgeRetrievalSettings,
  isEditingSettingsConnection,
  isSettingsConnectionDraftVerified,
  openChatImagePreview,
  queueChatConversationPersistence,
  queueSettingsConnectionModelForValidation,
  refreshLongTermMemoryList,
  applyKnowledgeRetrievalSettings,
  removeActiveSettingsConnection,
  renderAgentToolCatalog,
  resetChatConversation,
  saveDeepSeekConfig,
  saveSettingsConnection,
  saveSettingsRoutes,
  sendChatMessage,
  setCurrentApplicationView,
  showSettingsConnectionEditor,
  showSettingsModelOverview,
  showSettingsStatus,
  syncAiConfigsFromConnectionCatalog,
  testDeepSeekConnection,
  testVisionAiConnection,
  toggleSettingsSecret,
} from "../../features/assistant/public";

import {
  closeKnowledgeBasePage,
  getKnowledgeDocument,
  listKnowledgeDocuments,
} from "../../features/knowledge-base/public";
import { closeVocabularyLibraryPage } from "../../features/vocabulary-library/public";
import { setStatus } from "../../features/recent-files/public";
import { openSourcePdfInNewTab } from "../../shared-ui/navigation/source-pdf-navigation";
import type { AssistantView } from "../../core/pdf-reader/public";

import {
  toolbarMenus,
  setToolbarMenuOpen,
  closeToolbarMenus,
  activateAiTab,
} from "../app-ui";
import {
  selectChatReasoningMode,
  setChatReasoningMenuOpen,
  syncChatReasoningControl,
} from "../chat-reasoning-control";
import { getActiveWorkspaceView } from "../workspace-navigation";

export function registerAssistantEvents(): void {
  renderAgentToolCatalog();
  syncChatReasoningControl();
  initializeKnowledgeRetrievalSettings();

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
    if (!toolbarMenus.some((menu) => menu.contains(target)))
      closeToolbarMenus();
    if (!chatReasoningControl.contains(target)) setChatReasoningMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeToolbarMenus();
    if (!chatReasoningMenu.hidden) {
      setChatReasoningMenuOpen(false);
      chatReasoningTrigger.focus();
    }
    if (!assistantSettingsPanel.hidden) {
      cancelSettingsConnectionActivity();
      setDeepSeekSettingsOpen(false);
    }
  });

  outlineToggleButton?.addEventListener("click", () => {
    setLeftPanelCollapsed(
      !appFrame?.classList.contains("left-panel-collapsed"),
    );
  });

  aiPanelToggleButton?.addEventListener("click", () => {
    const activeWorkspace = getActiveWorkspaceView();
    if (activeWorkspace === "knowledge") {
      closeKnowledgeBasePage();
      return;
    }
    if (activeWorkspace === "vocabulary") {
      closeVocabularyLibraryPage();
      return;
    }
    setCurrentApplicationView("viewer");
  });

  assistantPanelToggleButton.addEventListener("click", () => {
    const activeWorkspace = getActiveWorkspaceView();
    if (activeWorkspace === "knowledge") closeKnowledgeBasePage();
    if (activeWorkspace === "vocabulary") closeVocabularyLibraryPage();
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
    const willOpen = assistantSettingsPanel.hidden;
    if (!willOpen) cancelSettingsConnectionActivity();
    setDeepSeekSettingsOpen(willOpen);
    if (willOpen) initializeKnowledgeRetrievalSettings();
  });

  knowledgeEmbeddingModelSelect.addEventListener(
    "change",
    handleKnowledgeEmbeddingModelSelection,
  );
  applyKnowledgeRetrievalSettingsButton.addEventListener("click", () => {
    void applyKnowledgeRetrievalSettings();
  });

  for (const button of settingsPrimaryTabButtons) {
    button.addEventListener("click", () => {
      const tab = button.dataset.settingsTab;
      if (
        tab === "general" ||
        tab === "models" ||
        tab === "tools" ||
        tab === "memory"
      ) {
        activateSettingsTab(tab);
      }
    });
  }

  settingsConnectionGrid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-edit-connection-id]",
    );
    const connectionId = button?.dataset.editConnectionId;
    if (connectionId) showSettingsConnectionEditor(connectionId);
  });

  addAiProviderButton.addEventListener("click", () => {
    showSettingsConnectionEditor();
  });

  settingsConnectionDeleteButton.addEventListener("click", () => {
    if (
      !window.confirm(
        "确定删除这个供应商连接吗？相关任务会自动选择其他可用连接。",
      )
    )
      return;
    settingsConnectionDeleteButton.disabled = true;
    void removeActiveSettingsConnection().finally(() => {
      settingsConnectionDeleteButton.disabled = false;
      void syncAiConfigsFromConnectionCatalog();
    });
  });

  settingsConnectionBackButton.addEventListener(
    "click",
    showSettingsModelOverview,
  );

  for (const button of secretToggleButtons) {
    button.addEventListener("click", () => {
      const inputId = button.dataset.toggleSecret;
      if (inputId) toggleSettingsSecret(inputId);
    });
  }

  aiProviderSelect.addEventListener("change", () => {
    const providerId = aiProviderSelect.value as AiProviderId;
    const provider = AI_PROVIDERS.find((item) => item.id === providerId);
    if (provider && !provider.available) {
      aiProviderSelect.value = "";
      showSettingsStatus("该模型供应商尚未接入。", "error");
      return;
    }
    if (provider?.defaultBaseUrl && !deepSeekBaseUrlInput.value.trim()) {
      deepSeekBaseUrlInput.value = provider.defaultBaseUrl;
    }
  });

  closeDeepSeekSettingsButton.addEventListener("click", () => {
    cancelSettingsConnectionActivity();
    setDeepSeekSettingsOpen(false);
  });

  settingsModalBackdrop.addEventListener("pointerdown", (event) => {
    if (event.target !== settingsModalBackdrop) return;
    cancelSettingsConnectionActivity();
    setDeepSeekSettingsOpen(false);
  });

  saveDeepSeekSettingsButton.addEventListener("click", async () => {
    if (isEditingSettingsConnection()) {
      if (!isSettingsConnectionDraftVerified()) {
        const tested = await testDeepSeekConnection();
        if (!tested) return;
      }
      const saved = await saveSettingsConnection();
      if (saved) await syncAiConfigsFromConnectionCatalog();
      return;
    }
    void saveDeepSeekConfig().then((saved) => {
      if (!saved) return;

      setDeepSeekSettingsOpen(false);
      showSettingsSavedFeedback();

    });
  });

  testDeepSeekButton.addEventListener("click", () => {
    void testDeepSeekConnection();
  });

  const addManualConnectionModel = () => {
    const model = settingsConnectionManualModelInput.value.trim();
    if (!queueSettingsConnectionModelForValidation(model)) return;
    settingsConnectionManualModelInput.value = "";
    showSettingsStatus(`已加入 ${model}，请点击“测试并获取模型”。`, "info");
  };

  settingsConnectionAddManualModelButton.addEventListener(
    "click",
    addManualConnectionModel,
  );
  settingsConnectionManualModelInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    addManualConnectionModel();
  });

  testVisionAiButton.addEventListener("click", () => {
    void testVisionAiConnection();
  });

  refreshLongTermMemoriesButton.addEventListener("click", () => {
    void refreshLongTermMemoryList();
  });

  addLongTermMemoryButton.addEventListener("click", () => {
    void createLongTermMemory();
  });

  longTermMemorySearchInput.addEventListener("input", () => {
    filterLongTermMemoryList(longTermMemorySearchInput.value);
  });

  longTermMemoryList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-memory-id]",
    );
    const memoryId = button?.dataset.memoryId;
    if (!memoryId) return;
    if (button.dataset.memoryAction === "edit") {
      void editLongTermMemory(memoryId);
      return;
    }
    if (!window.confirm("确定删除这条长期记忆吗？")) return;
    button.disabled = true;
    void deleteLongTermMemory(memoryId).catch((error) => {
      button.disabled = false;
      console.warn("[PDFPal 长期记忆] 删除失败", error);
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
    syncChatReasoningControl();
    aiConfig.value = {
      ...aiConfig.value,
      reasoning: deepSeekThinkingSelect.value as AiReasoningMode,
    };
    if (aiConfigLoaded.value) {
      void saveSettingsRoutes(
        aiConfig.value.reasoning,
        aiConfig.value.maxOutputTokens,
      );
    }
  });

  chatReasoningTrigger.addEventListener("click", () => {
    setChatReasoningMenuOpen(chatReasoningMenu.hidden);
  });

  for (const button of chatReasoningOptionButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.chatReasoningValue;
      if (mode === "enabled" || mode === "disabled") {
        selectChatReasoningMode(mode);
        chatReasoningTrigger.focus();
      }
    });
  }

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

  const clearCurrentChatConversation = (): void => {
    const documentAtClear = pdfDocument.value;
    resetChatConversation();
    void queueChatConversationPersistence(documentAtClear).then(() => {
      console.info("[PDFPal 对话存储] 已清空当前 PDF 对话", {
        documentId: documentAtClear
          ? getDocumentChatId(documentAtClear)
          : undefined,
      });
    });
  };

  const closeClearChatDialog = (): void => {
    if (clearChatDialog.open) clearChatDialog.close();
  };

  clearChatButton.addEventListener("click", () => {
    if (chatRequestPending.value) return;
    if (chatHistory.value.length === 0) {
      clearCurrentChatConversation();
      return;
    }
    if (!clearChatDialog.open) clearChatDialog.showModal();
    window.setTimeout(() => clearChatDialogCancelButton.focus(), 0);
  });

  clearChatDialogCloseButton.addEventListener("click", closeClearChatDialog);
  clearChatDialogCancelButton.addEventListener("click", closeClearChatDialog);
  clearChatDialog.addEventListener("pointerdown", (event) => {
    if (event.target === clearChatDialog) closeClearChatDialog();
  });
  clearChatDialogConfirmButton.addEventListener("click", () => {
    if (chatRequestPending.value) return;
    closeClearChatDialog();
    clearCurrentChatConversation();
  });

  chatMessagesElement.addEventListener("click", (event) => {
    const previewImage = (
      event.target as Element | null
    )?.closest<HTMLImageElement>(".chat-message-image");
    if (previewImage) {
      openChatImagePreview(previewImage.src, previewImage.alt);
      return;
    }
    const citation = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>(".pdf-source-citation");
    if (!citation) return;
    const pageNumber = Number(citation.dataset.pdfPage);
    const libraryDocumentId = citation.dataset.pdfDocumentId?.trim();
    if (libraryDocumentId) {
      const libraryDocument = getKnowledgeDocument(libraryDocumentId)
        ?? listKnowledgeDocuments().find(
          (item) => item.documentName === libraryDocumentId,
        );
      if (!libraryDocument) {
        setStatus("找不到这条引用对应的知识库 PDF。", true);
        return;
      }
      void openSourcePdfInNewTab(
        libraryDocument.documentName,
        libraryDocument.recentEntryId,
        pageNumber,
      ).then((opened) => {
        if (!opened) setStatus("这份知识库 PDF 缺少可重新打开的文件记录。", true);
      }).catch((error) => {
        setStatus(
          `新标签页打开原文失败：${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      });
      return;
    }
    const fallbackQuote = citation.dataset.pdfQuote?.trim() ?? "";
    let quotes = fallbackQuote ? [fallbackQuote] : [];
    try {
      const parsedQuotes = JSON.parse(citation.dataset.pdfQuotes ?? "null");
      if (Array.isArray(parsedQuotes)) {
        quotes = parsedQuotes.filter(
          (quote): quote is string =>
            typeof quote === "string" && Boolean(quote.trim()),
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

}
