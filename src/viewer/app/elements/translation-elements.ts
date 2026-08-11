import { requiredElement } from "./required-element";

export const selectedSnippetElement =
  requiredElement<HTMLTextAreaElement>("selected-snippet");

export const selectedSnippetShell = requiredElement<HTMLElement>(
  "selected-snippet-shell",
);

export const selectedSnippetMathPreview = requiredElement<HTMLElement>(
  "selected-snippet-math-preview",
);

export const selectedSnippetModeToggleButton =
  requiredElement<HTMLButtonElement>("selected-snippet-mode-toggle");

export const translationSourceSentenceField = requiredElement<HTMLElement>(
  "translation-source-sentence-field",
);

export const translationSourceSentenceInput = requiredElement<HTMLTextAreaElement>(
  "translation-source-sentence",
);

export const translationSourceSentenceTranslation = requiredElement<HTMLElement>(
  "translation-source-sentence-translation",
);

export const translationSourceSentenceMathPreview = requiredElement<HTMLElement>(
  "translation-source-sentence-math-preview",
);

export const applyTranslationEditButton = requiredElement<HTMLButtonElement>(
  "apply-translation-edit",
);

export const translationLearningHintElement = requiredElement<HTMLElement>(
  "translation-learning-hint",
);

export const translationLearningTitleElement = requiredElement<HTMLElement>(
  "translation-learning-title",
);

export const translationResultElement =
  requiredElement<HTMLElement>("translation-result");

export const saveTranslationNoteButton = requiredElement<HTMLButtonElement>(
  "save-translation-note",
);

export const generateMoreExamplesButton = requiredElement<HTMLButtonElement>(
  "generate-more-examples",
);

export const translationHistoryCountElement = requiredElement<HTMLElement>(
  "translation-history-count",
);

export const clearTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "clear-translation-history",
);

export const openTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "open-translation-history",
);

export const translationHistoryDialog = requiredElement<HTMLElement>(
  "translation-history-dialog",
);

export const closeTranslationHistoryButton = requiredElement<HTMLButtonElement>(
  "close-translation-history",
);

export const translationHistorySearchInput = requiredElement<HTMLInputElement>(
  "translation-history-search",
);

export const translationHistoryDialogCount = requiredElement<HTMLElement>(
  "translation-history-dialog-count",
);

export const translationHistoryDialogList = requiredElement<HTMLElement>(
  "translation-history-dialog-list",
);

export const copyTranslationButton =
  requiredElement<HTMLButtonElement>("copy-translation");

export const summaryPanelElement = requiredElement<HTMLElement>("summary-panel");

export const summaryRangeElement = requiredElement<HTMLElement>("summary-range");

export const summarySourceElement = requiredElement<HTMLElement>("summary-source");

export const summaryPositionElement = requiredElement<HTMLElement>("summary-position");

export const summaryResultElement = requiredElement<HTMLElement>("summary-result");

export const summaryScopeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-summary-scope]"),
);

export const copySummaryButton = requiredElement<HTMLButtonElement>("copy-summary");

export const saveSummaryNoteButton =
  requiredElement<HTMLButtonElement>("save-summary-note");
