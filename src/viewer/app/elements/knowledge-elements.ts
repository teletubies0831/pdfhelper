import { requiredElement } from "./required-element";

export const knowledgeBaseEntryButton = requiredElement<HTMLButtonElement>(
  "knowledge-base-entry",
);

export const knowledgeBasePageElement = requiredElement<HTMLElement>(
  "knowledge-base-page",
);

export const knowledgeMainElement = requiredElement<HTMLElement>(
  "knowledge-library-view",
).closest<HTMLElement>(".knowledge-main");

export const knowledgeBaseBackButton = requiredElement<HTMLButtonElement>(
  "knowledge-base-back",
);

export const knowledgeFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-filter]"),
);

export const knowledgeOriginButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-origin]"),
);

export const knowledgeOriginFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-origin-filter]"),
);

export const knowledgeCountAllElement = requiredElement<HTMLElement>(
  "knowledge-count-all",
);

export const knowledgeCountOriginNovelElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-novel",
);

export const knowledgeCountOriginNovelReadingCardElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-novel-reading-card",
);

export const knowledgeCountOriginNovelNoteElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-novel-note",
);

export const knowledgeCountOriginPaperElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-paper",
);

export const knowledgeCountOriginPaperReadingCardElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-paper-reading-card",
);

export const knowledgeCountOriginPaperNoteElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-paper-note",
);

export const knowledgeCountOriginGeneralElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-general",
);

export const knowledgeCountOriginGeneralReadingCardElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-general-reading-card",
);

export const knowledgeCountOriginGeneralNoteElement = requiredElement<HTMLElement>(
  "knowledge-count-origin-general-note",
);

export const knowledgeCategoryListElement = requiredElement<HTMLElement>(
  "knowledge-category-list",
);

export const knowledgeTagListElement =
  requiredElement<HTMLElement>("knowledge-tag-list");

export const knowledgeRecentSummaryElement = requiredElement<HTMLElement>(
  "knowledge-recent-summary",
);

export const knowledgePageTitleElement = requiredElement<HTMLElement>(
  "knowledge-page-title",
);

export const knowledgeTotalCountElement = requiredElement<HTMLElement>(
  "knowledge-total-count",
);

export const knowledgeDocumentCountElement = requiredElement<HTMLElement>(
  "knowledge-document-count",
);

export const knowledgeRefreshButton =
  requiredElement<HTMLButtonElement>("knowledge-refresh");

export const knowledgeImportButton =
  requiredElement<HTMLButtonElement>("knowledge-import");

export const knowledgeImportInput = requiredElement<HTMLInputElement>(
  "knowledge-import-input",
);

export const knowledgeNewNoteButton =
  requiredElement<HTMLButtonElement>("knowledge-new-note");

export const knowledgeSearchInput = requiredElement<HTMLInputElement>(
  "knowledge-search-input",
);

export const knowledgeSortSelect = requiredElement<HTMLSelectElement>(
  "knowledge-sort-select",
);

export const knowledgeGroupSelect = requiredElement<HTMLSelectElement>(
  "knowledge-group-select",
);

export const knowledgePageStatusElement = requiredElement<HTMLElement>(
  "knowledge-page-status",
);

export const knowledgeListElement = requiredElement<HTMLElement>("knowledge-list");

export const knowledgePageSubtitleElement = document.getElementById(
  "knowledge-page-subtitle",
) as HTMLElement | null;

export const knowledgeDashboardMetricsElement = document.getElementById(
  "knowledge-dashboard-metrics",
) as HTMLElement | null;

export const knowledgeStudentWorkbenchElement = document.getElementById(
  "knowledge-student-workbench",
) as HTMLElement | null;

export const knowledgeWeeklyTasksElement = document.getElementById(
  "knowledge-weekly-tasks",
) as HTMLElement | null;

export const knowledgeFocusButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-focus]"),
);

export const knowledgeFocusCountTodoElement = document.getElementById(
  "knowledge-focus-count-todo",
) as HTMLElement | null;

export const knowledgeFocusCountDeepElement = document.getElementById(
  "knowledge-focus-count-deep",
) as HTMLElement | null;

export const knowledgeFocusCountFinishedElement = document.getElementById(
  "knowledge-focus-count-finished",
) as HTMLElement | null;

export const knowledgeFocusCountCitableElement = document.getElementById(
  "knowledge-focus-count-citable",
) as HTMLElement | null;

export const knowledgeFocusCountReplicateElement = document.getElementById(
  "knowledge-focus-count-replicate",
) as HTMLElement | null;

export const knowledgeFocusCountRelatedElement = document.getElementById(
  "knowledge-focus-count-related",
) as HTMLElement | null;

export const knowledgeFocusCountMethodsElement = document.getElementById(
  "knowledge-focus-count-methods",
) as HTMLElement | null;

export const knowledgeYearFilterSelect = document.getElementById(
  "knowledge-year-filter",
) as HTMLSelectElement | null;

export const knowledgeVenueFilterSelect = document.getElementById(
  "knowledge-venue-filter",
) as HTMLSelectElement | null;

export const knowledgeReadingStatusFilterSelect = document.getElementById(
  "knowledge-reading-status-filter",
) as HTMLSelectElement | null;

export const knowledgePriorityFilterSelect = document.getElementById(
  "knowledge-priority-filter",
) as HTMLSelectElement | null;

export const knowledgeClearFiltersButton = document.getElementById(
  "knowledge-clear-filters",
) as HTMLButtonElement | null;

export const knowledgeBatchOrganizeButton = document.getElementById(
  "knowledge-batch-organize",
) as HTMLButtonElement | null;

export const knowledgeModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-mode]"),
);

export const knowledgeLibraryView = requiredElement<HTMLElement>(
  "knowledge-library-view",
);

export const knowledgeResearchView = requiredElement<HTMLElement>(
  "knowledge-research-view",
);

export const knowledgeResearchHeading = requiredElement<HTMLElement>(
  "knowledge-research-heading",
);

export const knowledgeResearchDescription = requiredElement<HTMLElement>(
  "knowledge-research-description",
);

export const knowledgeResearchScopeSelect = requiredElement<HTMLSelectElement>(
  "knowledge-research-scope",
);

export const knowledgeResearchScopeSummary = requiredElement<HTMLElement>(
  "knowledge-research-scope-summary",
);

export const knowledgeSelectVisibleButton = requiredElement<HTMLButtonElement>(
  "knowledge-select-visible",
);

export const knowledgeClearSelectionButton = requiredElement<HTMLButtonElement>(
  "knowledge-clear-selection",
);

export const knowledgeQaControls = requiredElement<HTMLElement>(
  "knowledge-qa-controls",
);

export const knowledgeInsightControls = requiredElement<HTMLElement>(
  "knowledge-insight-controls",
);

export const knowledgeResearchQuestionInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-research-question",
);

export const knowledgeInsightQuestionInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-insight-question",
);

export const knowledgeQuestionPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-question]"),
);

export const knowledgeInsightPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-insight]"),
);

export const knowledgeRunResearchButton = requiredElement<HTMLButtonElement>(
  "knowledge-run-research",
);

export const knowledgeClearResearchButton = requiredElement<HTMLButtonElement>(
  "knowledge-clear-research",
);

export const knowledgeResearchStatus = requiredElement<HTMLElement>(
  "knowledge-research-status",
);

export const knowledgeResearchResult = requiredElement<HTMLElement>(
  "knowledge-research-result",
);

export const knowledgeResearchResultKind = requiredElement<HTMLElement>(
  "knowledge-research-result-kind",
);

export const knowledgeResearchResultTitle = requiredElement<HTMLElement>(
  "knowledge-research-result-title",
);

export const knowledgeResearchResultBody = requiredElement<HTMLElement>(
  "knowledge-research-result-body",
);

export const knowledgeResearchSourceList = requiredElement<HTMLElement>(
  "knowledge-research-source-list",
);

export const knowledgeSaveResearchResultButton = requiredElement<HTMLButtonElement>(
  "knowledge-save-research-result",
);

export const knowledgeDetailCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-detail-close",
);

export const knowledgeDetailEmptyElement = requiredElement<HTMLElement>(
  "knowledge-detail-empty",
);

export const knowledgeDetailContentElement = requiredElement<HTMLElement>(
  "knowledge-detail-content",
);

export const knowledgeDetailTypeElement = requiredElement<HTMLElement>(
  "knowledge-detail-type",
);

export const knowledgeDetailTimeElement = requiredElement<HTMLElement>(
  "knowledge-detail-time",
);

export const knowledgeDetailTitleElement = requiredElement<HTMLElement>(
  "knowledge-detail-title",
);

export const knowledgeDetailTagsElement = requiredElement<HTMLElement>(
  "knowledge-detail-tags",
);

export const knowledgeDetailDocumentElement = requiredElement<HTMLElement>(
  "knowledge-detail-document",
);

export const knowledgeDetailPositionElement = requiredElement<HTMLElement>(
  "knowledge-detail-position",
);

export const knowledgeDetailCreatedElement = requiredElement<HTMLElement>(
  "knowledge-detail-created",
);

export const knowledgeDetailUpdatedElement = requiredElement<HTMLElement>(
  "knowledge-detail-updated",
);

export const knowledgeDetailBodyElement = requiredElement<HTMLElement>(
  "knowledge-detail-body",
);

export const knowledgeRelatedSummaryElement = requiredElement<HTMLElement>(
  "knowledge-related-summary",
);

export const knowledgeOpenSourceButton = requiredElement<HTMLButtonElement>(
  "knowledge-open-source",
);

export const knowledgeEditItemButton = requiredElement<HTMLButtonElement>(
  "knowledge-edit-item",
);

export const knowledgeDeleteItemButton = requiredElement<HTMLButtonElement>(
  "knowledge-delete-item",
);

export const knowledgeEditorDialog = requiredElement<HTMLElement>(
  "knowledge-editor-dialog",
);

export const knowledgeEditorForm = requiredElement<HTMLFormElement>(
  "knowledge-editor-form",
);

export const knowledgeEditorHeading = requiredElement<HTMLElement>(
  "knowledge-editor-heading",
);

export const knowledgeEditorSource = requiredElement<HTMLElement>(
  "knowledge-editor-source",
);

export const knowledgeEditorSourceDocument = requiredElement<HTMLElement>(
  "knowledge-editor-source-document",
);

export const knowledgeEditorSourcePosition = requiredElement<HTMLElement>(
  "knowledge-editor-source-position",
);

export const knowledgeEditorSourceQuote = requiredElement<HTMLElement>(
  "knowledge-editor-source-quote",
);

export const knowledgeEditorCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-close",
);

export const knowledgeEditorCancelButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-cancel",
);

export const knowledgeEditorOpenSourceButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-open-source",
);

export const knowledgeEditorDeleteButton = requiredElement<HTMLButtonElement>(
  "knowledge-editor-delete",
);

export const knowledgeEditorPreviewElement = requiredElement<HTMLElement>(
  "knowledge-editor-preview",
);

export const knowledgeEditorPreviewPane = requiredElement<HTMLElement>(
  "knowledge-editor-preview-pane",
);

export const knowledgeEditorEditPane = requiredElement<HTMLElement>(
  "knowledge-editor-edit-pane",
);

export const knowledgeEditorModeToggleButton =
  requiredElement<HTMLButtonElement>("knowledge-editor-mode-toggle");

export const knowledgeEditorBodyModeLabel = requiredElement<HTMLElement>(
  "knowledge-editor-body-mode-label",
);

export const knowledgeEditorTitleInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-title",
);

export const knowledgeEditorCategoryInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-category",
);

export const knowledgeEditorTagsInput = requiredElement<HTMLInputElement>(
  "knowledge-editor-tags",
);

export const knowledgeEditorBodyInput = requiredElement<HTMLTextAreaElement>(
  "knowledge-editor-body",
);
