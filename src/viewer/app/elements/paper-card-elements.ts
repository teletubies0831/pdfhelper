import { requiredElement } from "./required-element";

export const paperCardPageElement = requiredElement<HTMLElement>("paper-card-page");

export const paperCardSectionButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-paper-card-section]"),
);

export const paperCardScrollContainers = Array.from(
  document.querySelectorAll<HTMLElement>(".paper-card-main, .paper-card-sidebar"),
);

export const readingJournalPageElement = requiredElement<HTMLElement>("reading-journal-page");

export const readingJournalBackButton = requiredElement<HTMLButtonElement>("reading-journal-back");

export const readingJournalNewButton = requiredElement<HTMLButtonElement>("reading-journal-new");

export const readingJournalDocumentElement = requiredElement<HTMLElement>("reading-journal-document");

export const readingJournalSearchInput = requiredElement<HTMLInputElement>("reading-journal-search");

export const readingJournalCountElement = requiredElement<HTMLElement>("reading-journal-count");

export const readingJournalListElement = requiredElement<HTMLElement>("reading-journal-list");

export const readingJournalEmptyElement = requiredElement<HTMLElement>("reading-journal-empty");

export const readingJournalEditorElement = requiredElement<HTMLElement>("reading-journal-editor");

export const readingJournalForm = requiredElement<HTMLFormElement>("reading-journal-form");

export const readingJournalEditorTitleElement = requiredElement<HTMLElement>("reading-journal-editor-title");

export const readingJournalEditorSourceElement = requiredElement<HTMLElement>("reading-journal-editor-source");

export const readingJournalEditorCloseButton = requiredElement<HTMLButtonElement>("reading-journal-editor-close");

export const readingJournalEditorCancelButton = requiredElement<HTMLButtonElement>("reading-journal-editor-cancel");

export const readingJournalTitleInput = requiredElement<HTMLInputElement>("reading-journal-title");

export const readingJournalQuoteInput = requiredElement<HTMLTextAreaElement>("reading-journal-quote");

export const readingJournalContentInput = requiredElement<HTMLTextAreaElement>("reading-journal-content");

export const readingJournalTagsInput = requiredElement<HTMLInputElement>("reading-journal-tags");

export const paperCardPageTitleElement = requiredElement<HTMLElement>(
  "paper-card-page-title",
);

export const paperCardPageSubtitleElement = requiredElement<HTMLElement>(
  "paper-card-page-subtitle",
);

export const paperCardBackButton =
  requiredElement<HTMLButtonElement>("paper-card-back");

export const editPaperCardButton =
  requiredElement<HTMLButtonElement>("edit-paper-card");

export const returnToPdfButton = requiredElement<HTMLButtonElement>("return-to-pdf");

export const regeneratePaperCardButton = requiredElement<HTMLButtonElement>(
  "regenerate-paper-card",
);

export const savePaperCardPageButton = requiredElement<HTMLButtonElement>(
  "save-paper-card-page",
);

export const exportPaperCardButton =
  requiredElement<HTMLButtonElement>("export-paper-card");

export const paperCardDocumentNameElement = requiredElement<HTMLTextAreaElement>(
  "paper-card-document-name",
);

export const paperCardPageStatusElement = requiredElement<HTMLElement>(
  "paper-card-page-status",
);

export const paperCardFormElement =
  requiredElement<HTMLFormElement>("paper-card-form");

export const paperTitleInput = requiredElement<HTMLTextAreaElement>("paper-title");

export const paperAuthorsInput = requiredElement<HTMLTextAreaElement>("paper-authors");

export const paperVenueYearInput =
  requiredElement<HTMLTextAreaElement>("paper-venue-year");

export const paperResearchAreaInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-area",
);

export const paperKeywordsInput = requiredElement<HTMLInputElement>("paper-keywords");

export const paperOneSentenceSummaryInput = requiredElement<HTMLTextAreaElement>(
  "paper-one-sentence-summary",
);

export const paperResearchProblemInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-problem",
);

export const paperCoreInnovationInput = requiredElement<HTMLTextAreaElement>(
  "paper-core-innovation",
);

export const paperWorthReadingInput = requiredElement<HTMLTextAreaElement>(
  "paper-worth-reading",
);

export const paperProblemSetupInput = requiredElement<HTMLTextAreaElement>(
  "paper-problem-setup",
);

export const paperResearchGapInput =
  requiredElement<HTMLTextAreaElement>("paper-research-gap");

export const paperWhyImportantInput = requiredElement<HTMLTextAreaElement>(
  "paper-why-important",
);

export const paperTopicTagsInput =
  requiredElement<HTMLTextAreaElement>("paper-topic-tags");

export const paperMethodOverviewInput = requiredElement<HTMLTextAreaElement>(
  "paper-method-overview",
);

export const paperMethodIntuitionInput = requiredElement<HTMLTextAreaElement>(
  "paper-method-intuition",
);

export const paperMethodStepsInput =
  requiredElement<HTMLTextAreaElement>("paper-method-steps");

export const paperKeyAssumptionsInput = requiredElement<HTMLTextAreaElement>(
  "paper-key-assumptions",
);

export const paperNotationGuideInput = requiredElement<HTMLTextAreaElement>(
  "paper-notation-guide",
);

export const paperDatasetsInput =
  requiredElement<HTMLTextAreaElement>("paper-datasets");

export const paperExperimentSetupInput = requiredElement<HTMLTextAreaElement>(
  "paper-experiment-setup",
);

export const paperMetricsInput = requiredElement<HTMLTextAreaElement>("paper-metrics");

export const paperMainFindingsInput = requiredElement<HTMLTextAreaElement>(
  "paper-main-findings",
);

export const paperStrongestEvidenceInput = requiredElement<HTMLTextAreaElement>(
  "paper-strongest-evidence",
);

export const paperComparisonPriorWorkInput = requiredElement<HTMLTextAreaElement>(
  "paper-comparison-prior-work",
);

export const paperLimitationsInput =
  requiredElement<HTMLTextAreaElement>("paper-limitations");

export const paperReadingStatusInput = requiredElement<HTMLSelectElement>(
  "paper-reading-status",
);

export const paperRecommendDeepReadingInput = requiredElement<HTMLSelectElement>(
  "paper-recommend-deep-reading",
);

export const paperReadingDifficultyInput = requiredElement<HTMLSelectElement>(
  "paper-reading-difficulty",
);

export const paperReadingValueScoreInput = requiredElement<HTMLInputElement>(
  "paper-reading-value-score",
);

export const paperReadingAdviceInput = requiredElement<HTMLTextAreaElement>(
  "paper-reading-advice",
);

export const paperSuitableStagesInput = requiredElement<HTMLTextAreaElement>(
  "paper-suitable-stages",
);

export const paperPrerequisitesInput = requiredElement<HTMLTextAreaElement>(
  "paper-prerequisites",
);

export const paperCitationPointsInput = requiredElement<HTMLTextAreaElement>(
  "paper-citation-points",
);

export const paperResearchConnectionInput = requiredElement<HTMLTextAreaElement>(
  "paper-research-connection",
);

export const paperFollowupQuestionsInput = requiredElement<HTMLTextAreaElement>(
  "paper-followup-questions",
);

export const paperWeeklyPlanInput =
  requiredElement<HTMLTextAreaElement>("paper-weekly-plan");

export const paperPersonalNotesInput = requiredElement<HTMLTextAreaElement>(
  "paper-personal-notes",
);
