import { requiredElement } from "./required-element";

export const knowledgeGraphEntryButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-entry",
);

export const knowledgeGraphPageElement = requiredElement<HTMLElement>(
  "knowledge-graph-page",
);

export const knowledgeGraphBackButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-back",
);

export const knowledgeGraphRefreshButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-refresh",
);

export const knowledgeGraphFitButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-fit",
);

export const knowledgeGraphZoomInButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-zoom-in",
);

export const knowledgeGraphZoomOutButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-zoom-out",
);

export const knowledgeGraphSearchInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-search",
);

export const knowledgeGraphCountsElement = requiredElement<HTMLElement>(
  "knowledge-graph-counts",
);

export const knowledgeGraphCanvasElement = requiredElement<HTMLCanvasElement>(
  "knowledge-graph-canvas",
);

export const knowledgeGraphEmptyElement = requiredElement<HTMLElement>(
  "knowledge-graph-empty",
);

export const knowledgeGraphEmptyHintElement = requiredElement<HTMLElement>(
  "knowledge-graph-empty-hint",
);

export const knowledgeGraphInspectorElement = requiredElement<HTMLElement>(
  "knowledge-graph-inspector",
);

export const knowledgeGraphInspectorEmptyElement = requiredElement<HTMLElement>(
  "knowledge-graph-inspector-empty",
);

export const knowledgeGraphInspectorBodyElement = requiredElement<HTMLElement>(
  "knowledge-graph-inspector-body",
);

export const knowledgeGraphFilterPaperInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-paper",
);

export const knowledgeGraphFilterEntityInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-entity",
);

export const knowledgeGraphFilterPersonalInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-personal",
);

export const knowledgeGraphFilterOriginAiInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-origin-ai",
);

export const knowledgeGraphFilterOriginRuleInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-origin-rule",
);

export const knowledgeGraphFilterOriginUserInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-origin-user",
);

export const knowledgeGraphFilterConfidenceInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-filter-confidence",
);

export const knowledgeGraphFilterConfidenceValue = requiredElement<HTMLOutputElement>(
  "knowledge-graph-filter-confidence-value",
);

export const knowledgeGraphFocusAllButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-focus-all",
);

export const knowledgeGraphFocusCurrentButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-focus-current",
);

export const knowledgeGraphFocusHopsInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-focus-hops",
);

export const knowledgeGraphFocusHopsValue = requiredElement<HTMLOutputElement>(
  "knowledge-graph-focus-hops-value",
);

export const knowledgeGraphExtractButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-extract",
);

export const knowledgeGraphBatchButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-batch",
);

export const knowledgeGraphPendingButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-pending",
);

export const knowledgeGraphPendingCountElement = requiredElement<HTMLElement>(
  "knowledge-graph-pending-count",
);

export const knowledgeGraphReviewDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-review-dialog",
);

export const knowledgeGraphReviewTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-review-title",
);

export const knowledgeGraphReviewSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-review-summary",
);

export const knowledgeGraphReviewGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-review-groups",
);

export const knowledgeGraphReviewSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-review-selection",
);

export const knowledgeGraphReviewShowLowInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-review-show-low",
);

/** The wrapper of the translation checkbox, hidden when no translator is wired up. */
export const knowledgeGraphReviewTranslateField = requiredElement<HTMLElement>(
  "knowledge-graph-review-translate-field",
);

export const knowledgeGraphReviewTranslateInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-review-translate",
);

/** The wrapper of the synonym-check checkbox, hidden when no checker is wired up. */
export const knowledgeGraphReviewSynonymField = requiredElement<HTMLElement>(
  "knowledge-graph-review-synonym-field",
);

export const knowledgeGraphReviewSynonymInput = requiredElement<HTMLInputElement>(
  "knowledge-graph-review-synonym",
);

export const knowledgeGraphReviewSelectAllButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-review-select-all",
);

export const knowledgeGraphReviewSelectNoneButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-review-select-none",
);

export const knowledgeGraphReviewConfirmButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-review-confirm",
);

export const knowledgeGraphReviewLaterButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-review-later",
);

export const knowledgeGraphReviewCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-review-close",
);

export const knowledgeGraphMergeButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-merge",
);

/** One click to give every entity without a meaning one: batched, and it says how many first. */
export const knowledgeGraphExplainAllButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-explain",
);

export const knowledgeGraphRelationButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation",
);

/** Exports the current graph as a PNG image; there is no import counterpart (the library owns graph membership). */
export const knowledgeGraphExportButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-export",
);

export const knowledgeGraphMergeDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-merge-dialog",
);

export const knowledgeGraphMergeTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-merge-title",
);

export const knowledgeGraphMergeSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-merge-summary",
);

export const knowledgeGraphMergeGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-merge-groups",
);

export const knowledgeGraphMergeSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-merge-selection",
);

export const knowledgeGraphMergeApplyButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-merge-apply",
);

export const knowledgeGraphMergeLaterButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-merge-later",
);

/** Restores merge suggestions the user previously rejected; hidden when there are none. */
export const knowledgeGraphMergeRestoreButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-merge-restore",
);

export const knowledgeGraphMergeCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-merge-close",
);

export const knowledgeGraphMetricsButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-metrics",
);

export const knowledgeGraphMetricsDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-metrics-dialog",
);

export const knowledgeGraphMetricsTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-metrics-title",
);

export const knowledgeGraphMetricsSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-metrics-summary",
);

export const knowledgeGraphMetricsBodyElement = requiredElement<HTMLElement>(
  "knowledge-graph-metrics-body",
);

export const knowledgeGraphMetricsNoteElement = requiredElement<HTMLElement>(
  "knowledge-graph-metrics-note",
);

export const knowledgeGraphMetricsCopyButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-metrics-copy",
);

export const knowledgeGraphMetricsDoneButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-metrics-done",
);

export const knowledgeGraphMetricsCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-metrics-close",
);

export const knowledgeGraphConflictsButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-conflicts",
);

export const knowledgeGraphConflictsCountElement = requiredElement<HTMLElement>(
  "knowledge-graph-conflicts-count",
);

export const knowledgeGraphConflictDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-conflict-dialog",
);

export const knowledgeGraphConflictTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-conflict-title",
);

export const knowledgeGraphConflictSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-conflict-summary",
);

export const knowledgeGraphConflictGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-conflict-groups",
);

export const knowledgeGraphConflictSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-conflict-selection",
);

export const knowledgeGraphConflictApplyButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-conflict-apply",
);

export const knowledgeGraphConflictLaterButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-conflict-later",
);

export const knowledgeGraphConflictCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-conflict-close",
);

export const knowledgeGraphRelationDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-relation-dialog",
);

export const knowledgeGraphPapersButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-papers",
);

export const knowledgeGraphPapersDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-papers-dialog",
);

export const knowledgeGraphPapersTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-papers-title",
);

export const knowledgeGraphPapersSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-papers-summary",
);

export const knowledgeGraphPapersGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-papers-groups",
);

export const knowledgeGraphPapersSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-papers-selection",
);

export const knowledgeGraphPapersLibraryButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-papers-library",
);

export const knowledgeGraphPapersLaterButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-papers-later",
);

export const knowledgeGraphPapersCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-papers-close",
);

export const knowledgeGraphRelationTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-title",
);

export const knowledgeGraphRelationSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-summary",
);

export const knowledgeGraphRelationGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-groups",
);

export const knowledgeGraphRelationSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-selection",
);

export const knowledgeGraphRelationSelectAllButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-select-all",
);

export const knowledgeGraphRelationSelectNoneButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-select-none",
);

export const knowledgeGraphRelationWriteButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-write",
);

export const knowledgeGraphRelationDiscardButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-discard",
);

export const knowledgeGraphRelationCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-close",
);

export const knowledgeGraphRelationPickerDialog = requiredElement<HTMLDialogElement>(
  "knowledge-graph-relation-picker-dialog",
);

export const knowledgeGraphRelationPickerTitleElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-picker-title",
);

export const knowledgeGraphRelationPickerSummaryElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-picker-summary",
);

export const knowledgeGraphRelationPickerGroupsElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-picker-groups",
);

export const knowledgeGraphRelationPickerSelectionElement = requiredElement<HTMLElement>(
  "knowledge-graph-relation-picker-selection",
);

export const knowledgeGraphRelationPickerRunButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-picker-run",
);

export const knowledgeGraphRelationPickerCancelButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-picker-cancel",
);

export const knowledgeGraphRelationPickerCloseButton = requiredElement<HTMLButtonElement>(
  "knowledge-graph-relation-picker-close",
);
