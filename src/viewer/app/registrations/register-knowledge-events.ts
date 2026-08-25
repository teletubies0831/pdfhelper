
















import { cardTypeButtons, knowledgeBaseBackButton, knowledgeBaseEntryButton, knowledgeBatchOrganizeButton, knowledgeClearFiltersButton, knowledgeDeleteItemButton, knowledgeDetailCloseButton, knowledgeEditItemButton, knowledgeEditorBodyInput, knowledgeEditorCancelButton, knowledgeEditorCategoryInput, knowledgeEditorCloseButton, knowledgeEditorDeleteButton, knowledgeEditorDialog, knowledgeEditorForm, knowledgeEditorModeToggleButton, knowledgeEditorOpenSourceButton, knowledgeFilterButtons, knowledgeFocusButtons, knowledgeGroupSelect, knowledgeImportButton, knowledgeImportInput, knowledgeMainElement, knowledgeNewNoteButton, knowledgeOriginButtons, knowledgeOriginFilterButtons, knowledgeOpenSourceButton, knowledgePriorityFilterSelect, knowledgeReadingStatusFilterSelect, knowledgeRefreshButton, knowledgeSearchInput, knowledgeSortSelect, knowledgeVenueFilterSelect, knowledgeYearFilterSelect, summaryScopeButtons } from "../viewer-elements";
import { activeKnowledgeCategory, activeKnowledgeFocus, activeKnowledgePriority, activeKnowledgeReadingStatus, activeKnowledgeTag, activeKnowledgeVenue, activeKnowledgeYear, knowledgeEditorTargetKey, selectedKnowledgeRecordKey } from "../../core/pdf-reader/public";

import { setActiveSummaryScope } from "../../services/document-agent/viewer-document-agent";
import { setActiveCardType } from "../../features/paper-card/public";


import { addCurrentPdfToLibrary, closeKnowledgeBasePage, closeKnowledgeEditor, collectKnowledgeItems, deleteKnowledgeItem, deleteSelectedKnowledgeItem, getSelectedKnowledgeItem, importKnowledgeNotes, knowledgeEditorBodyMode, normalizeKnowledgeCategory, openKnowledgeBasePage, openKnowledgeEditor, openSelectedKnowledgeSource, registerKnowledgeCorpusEvents, renderKnowledgeBase, renderKnowledgeDetail, saveKnowledgeEditor, scheduleKnowledgeEditorPreview, setKnowledgeEditorBodyMode, resetKnowledgeOriginFilter, setKnowledgeFilter, setKnowledgeOrigin, setKnowledgeOriginContent, setKnowledgePageStatus } from "../../features/knowledge-base/public";
import type { CardType, KnowledgeFilter, KnowledgeFocus, SummaryScope } from "../../core/pdf-reader/public";
import type { KnowledgeOriginContentFilter, KnowledgeOriginFilter } from "../../features/knowledge-base/public";

import { scheduleAppViewStateSave } from '../app-ui';

export function registerKnowledgeEvents(): void {
  registerKnowledgeCorpusEvents();
  knowledgeBaseEntryButton.addEventListener("click", openKnowledgeBasePage);
  
  knowledgeBaseBackButton.addEventListener("click", closeKnowledgeBasePage);
  
  knowledgeRefreshButton.addEventListener("click", () => {
      setKnowledgePageStatus();
      renderKnowledgeBase();
    });
  
  knowledgeNewNoteButton.addEventListener("click", addCurrentPdfToLibrary);
  document.getElementById("add-current-pdf-to-library")?.addEventListener("click", () => {
    void addCurrentPdfToLibrary();
  });
  
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
