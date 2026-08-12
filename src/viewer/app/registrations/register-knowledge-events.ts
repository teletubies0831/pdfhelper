
















import { cardTypeButtons, editPaperCardButton, knowledgeBaseBackButton, knowledgeBaseEntryButton, knowledgeBatchOrganizeButton, knowledgeClearFiltersButton, knowledgeClearResearchButton, knowledgeClearSelectionButton, knowledgeDeleteItemButton, knowledgeDetailCloseButton, knowledgeEditItemButton, knowledgeEditorBodyInput, knowledgeEditorCancelButton, knowledgeEditorCategoryInput, knowledgeEditorCloseButton, knowledgeEditorDeleteButton, knowledgeEditorDialog, knowledgeEditorForm, knowledgeEditorModeToggleButton, knowledgeEditorOpenSourceButton, knowledgeFilterButtons, knowledgeFocusButtons, knowledgeGroupSelect, knowledgeImportButton, knowledgeImportInput, knowledgeInsightPresetButtons, knowledgeInsightQuestionInput, knowledgeMainElement, knowledgeModeButtons, knowledgeNewNoteButton, knowledgeOriginButtons, knowledgeOriginFilterButtons, knowledgeOpenSourceButton, knowledgePriorityFilterSelect, knowledgeQuestionPresetButtons, knowledgeReadingStatusFilterSelect, knowledgeRefreshButton, knowledgeResearchQuestionInput, knowledgeResearchScopeSelect, knowledgeRunResearchButton, knowledgeSaveResearchResultButton, knowledgeSearchInput, knowledgeSelectVisibleButton, knowledgeSortSelect, knowledgeVenueFilterSelect, knowledgeYearFilterSelect, paperCardBackButton, exportPaperCardButton, paperCardCloseButton, paperCardPageElement, paperCardScrollContainers, paperCardSectionButtons, regeneratePaperCardButton, returnToPdfButton, savePaperCardPageButton, summaryScopeButtons } from "../viewer-elements";
import { activeKnowledgeCategory, activeKnowledgeFocus, activeKnowledgeInsightPrompt, activeKnowledgePageMode, activeKnowledgePriority, activeKnowledgeReadingStatus, activeKnowledgeTag, activeKnowledgeVenue, activeKnowledgeYear, editingPaperOverviewId, knowledgeEditorTargetKey, paperCardPageDocumentKey, paperCardReturnTarget, persistCurrentAppViewState, selectedKnowledgeRecordKey, selectedKnowledgeResearchKeys } from "../../core/pdf-reader/public";

import { setActiveSummaryScope } from "../../services/document-agent/viewer-document-agent";
import { closePaperCardPage, exportPaperOverviewCard, generatePaperOverviewCard, openSavedPaperOverviewReview, paperCardEditMode, savePaperOverviewCard, setActiveCardType, setActivePaperCardSection, setPaperCardEditMode, setPaperCardPageStatus, syncPaperCardSectionFromScroll } from "../../features/paper-card/public";


import { setStatus } from "../../features/recent-files/public";


import { clearKnowledgeResearchResult, closeKnowledgeBasePage, closeKnowledgeEditor, collectKnowledgeItems, deleteKnowledgeItem, deleteSelectedKnowledgeItem, getFilteredKnowledgeItems, getSelectedKnowledgeItem, importKnowledgeNotes, knowledgeEditorBodyMode, normalizeKnowledgeCategory, openKnowledgeBasePage, openKnowledgeEditor, openSelectedKnowledgeSource, renderKnowledgeBase, renderKnowledgeDetail, runKnowledgeResearch, saveKnowledgeEditor, saveKnowledgeResearchResult, scheduleKnowledgeEditorPreview, setKnowledgeEditorBodyMode, resetKnowledgeOriginFilter, setKnowledgeFilter, setKnowledgeOrigin, setKnowledgeOriginContent, setKnowledgePageMode, setKnowledgePageStatus, updateKnowledgeResearchScopeSummary } from "../../features/knowledge-base/public";
import type { CardType, KnowledgeFilter, KnowledgeFocus, KnowledgePageMode, SummaryScope } from "../../core/pdf-reader/public";
import type { KnowledgeOriginContentFilter, KnowledgeOriginFilter } from "../../features/knowledge-base/public";

import { scheduleAppViewStateSave, source } from '../app-ui';
import { addCurrentPdfToLibrary } from "../../features/knowledge-base/current-pdf-add-to-library";
import { openSavedPaperCardSourcePdf } from "../../features/paper-card/paper-card-source-navigation";

export function registerKnowledgeEvents(): void {
  knowledgeBaseEntryButton.addEventListener("click", openKnowledgeBasePage);
  
  knowledgeBaseBackButton.addEventListener("click", closeKnowledgeBasePage);
  
  for (const button of knowledgeModeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.knowledgeMode as KnowledgePageMode | undefined;
        if (mode) setKnowledgePageMode(mode);
      });
    }
  
  knowledgeResearchScopeSelect.addEventListener(
      "change",
      updateKnowledgeResearchScopeSummary,
    );
  
  knowledgeSelectVisibleButton.addEventListener("click", () => {
      for (const item of getFilteredKnowledgeItems(collectKnowledgeItems())) {
        selectedKnowledgeResearchKeys.value.add(item.recordKey);
      }
      knowledgeResearchScopeSelect.value = "selected";
      renderKnowledgeBase();
      setKnowledgePageMode(
        activeKnowledgePageMode.value === "library" ? "qa" : activeKnowledgePageMode.value,
      );
    });
  
  knowledgeClearSelectionButton.addEventListener("click", () => {
      selectedKnowledgeResearchKeys.value.clear();
      renderKnowledgeBase();
    });
  
  for (const button of knowledgeQuestionPresetButtons) {
      button.addEventListener("click", () => {
        knowledgeResearchQuestionInput.value =
          button.dataset.knowledgeQuestion || "";
        knowledgeResearchQuestionInput.focus();
      });
    }
  
  for (const button of knowledgeInsightPresetButtons) {
      button.addEventListener("click", () => {
        activeKnowledgeInsightPrompt.value =
          button.dataset.knowledgeInsight || activeKnowledgeInsightPrompt.value;
        for (const candidate of knowledgeInsightPresetButtons)
          candidate.classList.toggle("active", candidate === button);
      });
    }
  
  knowledgeRunResearchButton.addEventListener(
      "click",
      () => void runKnowledgeResearch(),
    );
  
  knowledgeClearResearchButton.addEventListener(
      "click",
      clearKnowledgeResearchResult,
    );
  
  knowledgeSaveResearchResultButton.addEventListener(
      "click",
      saveKnowledgeResearchResult,
    );
  
  knowledgeResearchQuestionInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        void runKnowledgeResearch();
    });
  
  knowledgeInsightQuestionInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        void runKnowledgeResearch();
    });
  
  knowledgeRefreshButton.addEventListener("click", () => {
      setKnowledgePageStatus();
      renderKnowledgeBase();
    });
  
  knowledgeNewNoteButton.addEventListener("click", addCurrentPdfToLibrary);
  
  knowledgeImportButton.addEventListener("click", () =>
      knowledgeImportInput.click(),
    );
  
  knowledgeImportInput.addEventListener("change", () => {
      const file = knowledgeImportInput.files?.[0];
      if (file) void importKnowledgeNotes(file);
    });
  
  knowledgeSearchInput.addEventListener("input", renderKnowledgeBase);
  
  knowledgeSortSelect.addEventListener("change", renderKnowledgeBase);
  
  knowledgeMainElement?.addEventListener("scroll", scheduleAppViewStateSave, {
      passive: true,
    });
  
  paperCardPageElement.addEventListener("scroll", () => {
      scheduleAppViewStateSave();
    }, { passive: true });
  
  for (const container of paperCardScrollContainers) {
      container.addEventListener("scroll", () => {
        scheduleAppViewStateSave();
        syncPaperCardSectionFromScroll(container);
      }, { passive: true });
    }
  
  for (const button of paperCardSectionButtons) {
      button.addEventListener("click", () => {
        const sectionId = button.dataset.paperCardSection;
        if (!sectionId) return;
        const section = document.getElementById(sectionId);
        if (!section) return;
        setActivePaperCardSection(sectionId);
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  
  knowledgeResearchQuestionInput.addEventListener(
      "input",
      scheduleAppViewStateSave,
    );
  
  knowledgeInsightQuestionInput.addEventListener(
      "input",
      scheduleAppViewStateSave,
    );
  
  knowledgeResearchScopeSelect.addEventListener(
      "change",
      persistCurrentAppViewState,
    );
  
  knowledgeGroupSelect.addEventListener("change", renderKnowledgeBase);
  
  knowledgeYearFilterSelect?.addEventListener("change", () => {
      activeKnowledgeYear.value = knowledgeYearFilterSelect?.value ?? "all";
      renderKnowledgeBase();
    });
  
  knowledgeVenueFilterSelect?.addEventListener("change", () => {
      activeKnowledgeVenue.value = knowledgeVenueFilterSelect?.value ?? "all";
      renderKnowledgeBase();
    });
  
  knowledgeReadingStatusFilterSelect?.addEventListener("change", () => {
      activeKnowledgeReadingStatus.value = knowledgeReadingStatusFilterSelect?.value ?? "all";
      renderKnowledgeBase();
    });
  
  knowledgePriorityFilterSelect?.addEventListener("change", () => {
      activeKnowledgePriority.value = knowledgePriorityFilterSelect?.value ?? "all";
      renderKnowledgeBase();
    });
  
  knowledgeClearFiltersButton?.addEventListener("click", () => {
      activeKnowledgeYear.value = "all";
      activeKnowledgeVenue.value = "all";
      activeKnowledgeReadingStatus.value = "all";
      activeKnowledgePriority.value = "all";
      activeKnowledgeCategory.value = "all";
      activeKnowledgeTag.value = "";
      activeKnowledgeFocus.value = "all";
      resetKnowledgeOriginFilter();
      knowledgeSearchInput.value = "";
      if (knowledgeYearFilterSelect) knowledgeYearFilterSelect.value = "all";
      if (knowledgeVenueFilterSelect) knowledgeVenueFilterSelect.value = "all";
      if (knowledgeReadingStatusFilterSelect)
        knowledgeReadingStatusFilterSelect.value = "all";
      if (knowledgePriorityFilterSelect)
        knowledgePriorityFilterSelect.value = "all";
      renderKnowledgeBase();
    });
  
  for (const button of knowledgeFocusButtons) {
      button.addEventListener("click", () => {
        const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
        if (!focus) return;
        activeKnowledgeFocus.value = focus;
        renderKnowledgeBase();
      });
    }
  
  knowledgeBatchOrganizeButton?.addEventListener("click", () => {
      setKnowledgePageStatus(
        "已切换到研究型知识库视图。后续可以继续扩展批量整理逻辑。",
      );
    });
  
  for (const button of knowledgeOriginButtons) {
      button.addEventListener("click", () => {
        const origin = button.dataset.knowledgeOrigin as
          | Exclude<KnowledgeOriginFilter, "all">
          | undefined;
        if (origin) setKnowledgeOrigin(origin);
      });
    }

  for (const button of knowledgeOriginFilterButtons) {
      button.addEventListener("click", () => {
        const [origin, content] = (button.dataset.knowledgeOriginFilter || "").split(":") as [
          Exclude<KnowledgeOriginFilter, "all">,
          Exclude<KnowledgeOriginContentFilter, "all">,
        ];
        if (!origin || !content) return;
        setKnowledgeOriginContent(origin, content);
      });
    }

  for (const button of knowledgeFilterButtons) {
      button.addEventListener("click", () => {
        const filter = button.dataset.knowledgeFilter as
          | KnowledgeFilter
          | undefined;
        if (filter) setKnowledgeFilter(filter);
      });
    }
  
  knowledgeDetailCloseButton.addEventListener("click", () => {
      selectedKnowledgeRecordKey.value = "";
      renderKnowledgeDetail([], undefined);
    });
  
  knowledgeOpenSourceButton.addEventListener(
      "click",
      openSelectedKnowledgeSource,
    );
  
  knowledgeEditItemButton.addEventListener("click", () => {
      const item = getSelectedKnowledgeItem();
      if (!item) return;
      if (item.source === "paper-overview") {
        openSavedPaperOverviewReview(item);
        return;
      }
      openKnowledgeEditor(item);
    });
  
  knowledgeDeleteItemButton.addEventListener(
      "click",
      deleteSelectedKnowledgeItem,
    );
  
  knowledgeEditorCloseButton.addEventListener("click", closeKnowledgeEditor);
  
  knowledgeEditorCancelButton.addEventListener("click", () => {
      const item = knowledgeEditorTargetKey.value
        ? collectKnowledgeItems().find(
            (candidate) => candidate.recordKey === knowledgeEditorTargetKey.value,
          )
        : undefined;
      if (item) openKnowledgeEditor(item);
      else closeKnowledgeEditor();
    });

  knowledgeEditorOpenSourceButton.addEventListener(
      "click",
      openSelectedKnowledgeSource,
    );
  
  knowledgeEditorBodyInput.addEventListener(
      "input",
      scheduleKnowledgeEditorPreview,
    );
  
  knowledgeEditorModeToggleButton.addEventListener("click", () => {
      setKnowledgeEditorBodyMode(
        knowledgeEditorBodyMode.value === "preview" ? "edit" : "preview",
        true,
      );
    });
  
  knowledgeEditorCategoryInput.addEventListener("blur", () => {
      knowledgeEditorCategoryInput.value = normalizeKnowledgeCategory(
        knowledgeEditorCategoryInput.value,
      );
    });
  
  knowledgeEditorDeleteButton.addEventListener("click", () => {
      if (!knowledgeEditorTargetKey.value) return;
      const item = collectKnowledgeItems().find(
        (candidate) => candidate.recordKey === knowledgeEditorTargetKey.value,
      );
      if (!item) {
        setKnowledgePageStatus("这条内容已经不存在，请刷新知识库。", true);
        closeKnowledgeEditor();
        return;
      }
      deleteKnowledgeItem(item, true);
    });
  
  knowledgeEditorDialog.addEventListener("pointerdown", (event) => {
      if (event.target === knowledgeEditorDialog) closeKnowledgeEditor();
    });
  
  knowledgeEditorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveKnowledgeEditor();
    });
  
  paperCardBackButton.addEventListener("click", () =>
      closePaperCardPage(paperCardReturnTarget.value),
    );
  
  returnToPdfButton.addEventListener("click", () => {
      if (editingPaperOverviewId.value) {
        void openSavedPaperCardSourcePdf();
        return;
      }
      closePaperCardPage("pdf");
    });

  paperCardCloseButton.addEventListener("click", () =>
      closePaperCardPage(paperCardReturnTarget.value),
    );

  editPaperCardButton.addEventListener("click", () => {
      const enteringEditMode = !paperCardEditMode.value;
      setPaperCardEditMode(enteringEditMode);
      if (enteringEditMode) {
        setPaperCardPageStatus("已进入编辑模式，可直接点击字段修改内容。");
      }
      else if (!editingPaperOverviewId.value) {
        setPaperCardPageStatus("编辑完成，修改已保存到本地草稿。");
      }
    });
  
  regeneratePaperCardButton.addEventListener("click", () => {
      paperCardPageDocumentKey.value = "";
      void generatePaperOverviewCard(true);
    });
  
  savePaperCardPageButton.addEventListener("click", savePaperOverviewCard);
  exportPaperCardButton.addEventListener("click", exportPaperOverviewCard);
  
  for (const button of summaryScopeButtons) {
      button.addEventListener("click", () => {
        const scope = button.dataset.summaryScope as SummaryScope | undefined;
        if (scope) setActiveSummaryScope(scope);
      });
    }
  
  for (const button of cardTypeButtons) {
      button.addEventListener("click", () => {
        const cardType = button.dataset.cardType as CardType | undefined;
        if (cardType) setActiveCardType(cardType);
      });
    }
}
