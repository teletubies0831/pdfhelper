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

export const knowledgeLibraryView = requiredElement<HTMLElement>(
  "knowledge-library-view",
);

/** 列表 / 卡片 视图切换。 */
export const knowledgeViewListButton =
  requiredElement<HTMLButtonElement>("knowledge-view-list");
export const knowledgeViewGridButton =
  requiredElement<HTMLButtonElement>("knowledge-view-grid");

export const knowledgeTableWrapElement =
  requiredElement<HTMLElement>("knowledge-table-wrap");
export const knowledgeTableBodyElement =
  requiredElement<HTMLElement>("knowledge-table-body");
export const knowledgeTableEmptyElement =
  requiredElement<HTMLElement>("knowledge-table-empty");
export const knowledgeTableSortButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-knowledge-sort]"),
);
export const knowledgeListSummaryElement =
  requiredElement<HTMLElement>("knowledge-list-summary");

/** 批量操作：多选与批量栏. */
export const knowledgeSelectAllCheckbox =
  requiredElement<HTMLInputElement>("knowledge-select-all");
export const knowledgeBatchBarElement =
  requiredElement<HTMLElement>("knowledge-batch-bar");
export const knowledgeBatchCountElement =
  requiredElement<HTMLElement>("knowledge-batch-count");
export const knowledgeBatchFolderSelect =
  requiredElement<HTMLSelectElement>("knowledge-batch-folder");
export const knowledgeBatchMoveButton =
  requiredElement<HTMLButtonElement>("knowledge-batch-move");
export const knowledgeBatchRelatedButton =
  requiredElement<HTMLButtonElement>("knowledge-batch-related");
export const knowledgeBatchRemoveButton =
  requiredElement<HTMLButtonElement>("knowledge-batch-remove");
export const knowledgeBatchClearButton =
  requiredElement<HTMLButtonElement>("knowledge-batch-clear");

/** 阅读状态筛选（侧栏三档）。 */
export const knowledgeReadingFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-reading-filter]"),
);
export const knowledgeReadingCountElements = {
  todo: requiredElement<HTMLElement>("knowledge-reading-count-todo"),
  reading: requiredElement<HTMLElement>("knowledge-reading-count-reading"),
  done: requiredElement<HTMLElement>("knowledge-reading-count-done"),
};

/** 右侧文献面板。 */
export const knowledgeDetailPanelElement =
  requiredElement<HTMLElement>("knowledge-detail-panel");
export const knowledgeDetailCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-detail-close",
);
/** 右栏顶部的文献标题（就是文件名去掉 .pdf）——与「文献信息」里的书目标题不是一回事。 */
export const knowledgeDocCitationButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-citation");
export const knowledgeDocNameElement =
  requiredElement<HTMLElement>("knowledge-doc-title");
export const knowledgeDocFolderSelect =
  requiredElement<HTMLSelectElement>("knowledge-doc-folder");
export const knowledgeDocReadingSelect =
  requiredElement<HTMLSelectElement>("knowledge-doc-reading");
export const knowledgeDocPagesElement =
  requiredElement<HTMLElement>("knowledge-doc-pages");
export const knowledgeDocAddedElement =
  requiredElement<HTMLElement>("knowledge-doc-added");
export const knowledgeDocUpdatedElement =
  requiredElement<HTMLElement>("knowledge-doc-updated");
export const knowledgeDocChunksElement =
  requiredElement<HTMLElement>("knowledge-doc-chunks");
export const knowledgeDocIndexStateElement =
  requiredElement<HTMLElement>("knowledge-doc-index-state");
export const knowledgeDocOverviewStateElement =
  requiredElement<HTMLElement>("knowledge-doc-overview-state");
export const knowledgeDocRelatedStateElement =
  requiredElement<HTMLElement>("knowledge-doc-related-state");
export const knowledgeDocIssueElement =
  requiredElement<HTMLElement>("knowledge-doc-issue");
export const knowledgeDocRelatedNoteElement =
  requiredElement<HTMLElement>("knowledge-doc-related-note");
/** 相关论文正文：以前只能在「查看概览」的末尾读到，现在直接渲染在右栏。 */
export const knowledgeDocRelatedContentElement =
  requiredElement<HTMLElement>("knowledge-doc-related-content");
export const knowledgeDocSearchRelatedButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-search-related");
export const knowledgeDocOverviewButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-overview");
export const knowledgeDocOpenButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-open");
export const knowledgeDocGraphButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-graph");
export const knowledgeDocRemoveButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-remove");
/** 文献信息：标题 / 作者 / 出版日期 / 语言 / DOI / 链接. */
export const knowledgeDocTitleElement =
  requiredElement<HTMLElement>("knowledge-doc-biblio-title");
export const knowledgeDocAuthorsElement =
  requiredElement<HTMLElement>("knowledge-doc-authors");
export const knowledgeDocDateElement =
  requiredElement<HTMLElement>("knowledge-doc-publish-date");
export const knowledgeDocLanguageElement =
  requiredElement<HTMLElement>("knowledge-doc-language");
export const knowledgeDocDoiElement =
  requiredElement<HTMLElement>("knowledge-doc-doi");
export const knowledgeDocUrlElement =
  requiredElement<HTMLElement>("knowledge-doc-url");
export const knowledgeDocMetadataNoteElement =
  requiredElement<HTMLElement>("knowledge-doc-metadata-note");
export const knowledgeDocMetadataButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata");

/** 文献信息的手动编辑：只读视图与表单互斥显示。 */
export const knowledgeDocBiblioViewElement =
  requiredElement<HTMLElement>("knowledge-doc-biblio-view");
export const knowledgeDocBiblioEditElement =
  requiredElement<HTMLElement>("knowledge-doc-biblio-edit");
export const knowledgeDocTitleInput =
  requiredElement<HTMLInputElement>("knowledge-doc-biblio-title-input");
/** 出版信息：期刊/会议名、卷、期、页码、出版者、出版地. */
/** 出版信息：期刊/会议名、卷、期、页码、出版者、出版地. */
export const knowledgeDocBiblioContainerElement = requiredElement<HTMLElement>("knowledge-doc-container");
export const knowledgeDocBiblioVolumeElement = requiredElement<HTMLElement>("knowledge-doc-volume");
export const knowledgeDocBiblioPagesElement = requiredElement<HTMLElement>("knowledge-doc-biblio-pages");
export const knowledgeDocBiblioPublisherElement = requiredElement<HTMLElement>("knowledge-doc-publisher");
export const knowledgeDocBiblioIdentifiersElement = requiredElement<HTMLElement>("knowledge-doc-identifiers");
export const knowledgeDocBiblioContainerInput = requiredElement<HTMLInputElement>("knowledge-doc-container-input");
export const knowledgeDocBiblioVolumeInput = requiredElement<HTMLInputElement>("knowledge-doc-volume-input");
export const knowledgeDocBiblioIssueInput = requiredElement<HTMLInputElement>("knowledge-doc-issue-input");
export const knowledgeDocBiblioPagesInput = requiredElement<HTMLInputElement>("knowledge-doc-page-input");
export const knowledgeDocBiblioPublisherInput = requiredElement<HTMLInputElement>("knowledge-doc-publisher-input");
export const knowledgeDocBiblioPublisherPlaceInput = requiredElement<HTMLInputElement>("knowledge-doc-publisher-place-input");
export const knowledgeDocAuthorsInput =
  requiredElement<HTMLInputElement>("knowledge-doc-authors-input");
export const knowledgeDocDateInput =
  requiredElement<HTMLInputElement>("knowledge-doc-publish-date-input");
export const knowledgeDocLanguageInput =
  requiredElement<HTMLInputElement>("knowledge-doc-language-input");
export const knowledgeDocDoiInput =
  requiredElement<HTMLInputElement>("knowledge-doc-doi-input");
export const knowledgeDocUrlInput =
  requiredElement<HTMLInputElement>("knowledge-doc-url-input");
export const knowledgeDocIdentifierInput =
  requiredElement<HTMLInputElement>("knowledge-doc-identifier-input");
export const knowledgeDocMetadataSaveButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata-save");
export const knowledgeDocMetadataCancelButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata-cancel");
export const knowledgeDocMetadataEditButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata-edit");
export const knowledgeDocMetadataSkipButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata-skip");
/** The three metadata buttons, hidden while the edit form is open. */
export const knowledgeDocMetadataActionsElement =
  requiredElement<HTMLElement>("knowledge-doc-metadata-actions");
/** 联网查找及其候选列表：在线结果只能作为建议出现，永远不自动写入。 */
export const knowledgeDocMetadataOnlineButton =
  requiredElement<HTMLButtonElement>("knowledge-doc-metadata-online");
export const knowledgeDocMetadataSuggestionsElement =
  requiredElement<HTMLElement>("knowledge-doc-metadata-suggestions");
export const knowledgeDocMetadataSuggestionsNoteElement =
  requiredElement<HTMLElement>("knowledge-doc-metadata-suggestions-note");
export const knowledgeDocMetadataSuggestionListElement =
  requiredElement<HTMLElement>("knowledge-doc-metadata-suggestion-list");
/** 侧栏「缺元数据」筛选与计数. */
export const knowledgeMissingCountElement =
  requiredElement<HTMLElement>("knowledge-missing-count");
export const knowledgeMetadataFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-metadata-filter]"),
);
/** 数据体检：侧栏入口与徽标. */
export const knowledgeDataHealthEntryButton =
  requiredElement<HTMLButtonElement>("knowledge-data-health-entry");
export const knowledgeDataHealthCountElement =
  requiredElement<HTMLElement>("knowledge-data-health-count");

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
