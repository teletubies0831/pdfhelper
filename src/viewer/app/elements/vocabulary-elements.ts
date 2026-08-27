import { requiredElement } from "./required-element";

export const vocabularyLibraryEntryButton = requiredElement<HTMLButtonElement>(
  "vocabulary-library-entry",
);

export const vocabularyLibraryPageElement = requiredElement<HTMLElement>(
  "vocabulary-library-page",
);

export const vocabularyLibraryBackButton = requiredElement<HTMLButtonElement>(
  "vocabulary-library-back",
);

export const vocabularyNewCardButton = requiredElement<HTMLButtonElement>(
  "vocabulary-new-card",
);

export const vocabularyTotalCountElement = requiredElement<HTMLElement>(
  "vocabulary-total-count",
);

export const vocabularySearchInput = requiredElement<HTMLInputElement>(
  "vocabulary-search",
);

export const vocabularyTimeFilterSelect = requiredElement<HTMLSelectElement>(
  "vocabulary-time-filter",
);

export const vocabularySortSelect = requiredElement<HTMLSelectElement>(
  "vocabulary-sort",
);

export const vocabularyLibraryMainElement = requiredElement<HTMLElement>(
  "vocabulary-library-main",
);

export const vocabularyLibraryStatusElement = requiredElement<HTMLElement>(
  "vocabulary-library-status",
);

export const vocabularyCardGridElement = requiredElement<HTMLElement>(
  "vocabulary-card-grid",
);

export const vocabularyEditorDialog = requiredElement<HTMLDialogElement>(
  "vocabulary-editor-dialog",
);

export const vocabularyEditorForm = requiredElement<HTMLFormElement>(
  "vocabulary-editor-form",
);

export const vocabularyEditorTitleElement = requiredElement<HTMLElement>(
  "vocabulary-editor-title",
);

export const vocabularyEditorPronunciationRow = requiredElement<HTMLElement>(
  "vocabulary-editor-pronunciation-row",
);

export const vocabularyEditorPronunciationDisplay = requiredElement<HTMLElement>(
  "vocabulary-editor-pronunciation-display",
);

export const vocabularyEditorBadgesElement = requiredElement<HTMLElement>(
  "vocabulary-editor-badges",
);

export const vocabularyEditorSpeakButton = requiredElement<HTMLButtonElement>(
  "vocabulary-editor-speak",
);

export const vocabularyEditorCloseButton = requiredElement<HTMLButtonElement>(
  "vocabulary-editor-close",
);

export const vocabularyEditorMetaGridElement = requiredElement<HTMLElement>(
  "vocabulary-editor-meta-grid",
);

export const vocabularyEditorTermInput = requiredElement<HTMLInputElement>(
  "vocabulary-editor-term",
);

export const vocabularyEditorPronunciationInput = requiredElement<HTMLInputElement>(
  "vocabulary-editor-pronunciation",
);

export const vocabularyEditorPartOfSpeechInput = requiredElement<HTMLInputElement>(
  "vocabulary-editor-part-of-speech",
);

export const vocabularyEditorTagsInput = requiredElement<HTMLInputElement>(
  "vocabulary-editor-tags",
);

export const vocabularyEditorMarkdownInput = requiredElement<HTMLTextAreaElement>(
  "vocabulary-editor-markdown",
);

export const vocabularyMarkdownWorkspace = requiredElement<HTMLElement>(
  "vocabulary-markdown-workspace",
);

export const vocabularyMarkdownEditorElement = requiredElement<HTMLElement>(
  "vocabulary-markdown-editor",
);

export const vocabularyMarkdownPreviewPane = requiredElement<HTMLElement>(
  "vocabulary-markdown-preview-pane",
);

export const vocabularyEditorModeToggleButton = requiredElement<HTMLButtonElement>(
  "vocabulary-editor-mode-toggle",
);

export const vocabularyEditorBodyModeLabel = requiredElement<HTMLElement>(
  "vocabulary-editor-body-mode-label",
);

export const vocabularyEditorBodyModeHint = requiredElement<HTMLElement>(
  "vocabulary-editor-body-mode-hint",
);

export const vocabularyEditorPreviewElement = requiredElement<HTMLElement>(
  "vocabulary-editor-preview",
);

export const vocabularyEditorDeleteButton = requiredElement<HTMLButtonElement>(
  "vocabulary-editor-delete",
);

export const vocabularyEditorCancelButton = requiredElement<HTMLButtonElement>(
  "vocabulary-editor-cancel",
);

export const showVocabularyLibraryInput = requiredElement<HTMLInputElement>(
  "show-vocabulary-library",
);

export const translationSaveToVocabularyButton = requiredElement<HTMLButtonElement>(
  "translation-primary-actions",
).querySelector<HTMLButtonElement>("[data-translation-action='save']")!;
