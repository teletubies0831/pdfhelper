

import { paperCardReviewDocumentName } from "../../core/pdf-reader/public";
import { paperAuthorsInput, paperCardDocumentNameElement, paperCardFormElement, paperCitationPointsInput, paperComparisonPriorWorkInput, paperCoreInnovationInput, paperDatasetsInput, paperExperimentSetupInput, paperFollowupQuestionsInput, paperKeyAssumptionsInput, paperKeywordsInput, paperLimitationsInput, paperMainFindingsInput, paperMethodIntuitionInput, paperMethodOverviewInput, paperMethodStepsInput, paperMetricsInput, paperNotationGuideInput, paperOneSentenceSummaryInput, paperPrerequisitesInput, paperProblemSetupInput, paperReadingAdviceInput, paperReadingDifficultyInput, paperReadingStatusInput, paperReadingValueScoreInput, paperRecommendDeepReadingInput, paperResearchAreaInput, paperResearchConnectionInput, paperResearchGapInput, paperResearchProblemInput, paperStrongestEvidenceInput, paperSuitableStagesInput, paperTitleInput, paperTopicTagsInput, paperVenueYearInput, paperWeeklyPlanInput, paperWhyImportantInput, paperWorthReadingInput } from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";

import type { PaperCardFormData } from "../../core/pdf-reader/public";

import { normalizePaperVenueYearDisplay, setSelectValue } from "./paper-card-form-data";
import { restorePaperCardInlineDrafts, setPaperCardEditMode } from "./paper-card-inline-editor";

export const PAPER_CARD_TEXTAREA_MIN_HEIGHT = 44;

export function updatePaperCardOverviewFieldDensity(
  textarea: HTMLTextAreaElement,
): void {
  const overviewFieldIds = new Set([
    "paper-title",
    "paper-authors",
    "paper-venue-year",
    "paper-research-area",
    "paper-card-document-name",
  ]);
  if (!overviewFieldIds.has(textarea.id)) return;

  const length = textarea.value.trim().length;
  textarea.classList.remove(
    "content-short",
    "content-medium",
    "content-long",
  );

  const shortLimit = textarea.id === "paper-title" ? 72 : 54;
  const mediumLimit = textarea.id === "paper-title" ? 140 : 110;
  textarea.classList.add(
    length <= shortLimit
      ? "content-short"
      : length <= mediumLimit
        ? "content-medium"
        : "content-long",
  );
}

export function autoResizePaperCardTextarea(textarea: HTMLTextAreaElement): void {
  updatePaperCardOverviewFieldDensity(textarea);
  // Reset first so the field can shrink when content becomes shorter.
  textarea.style.height = `${PAPER_CARD_TEXTAREA_MIN_HEIGHT}px`;
  textarea.style.height = "0px";

  const computedStyle = window.getComputedStyle(textarea);
  const borderHeight =
    Number.parseFloat(computedStyle.borderTopWidth || "0") +
    Number.parseFloat(computedStyle.borderBottomWidth || "0");
  const contentHeight = Math.ceil(textarea.scrollHeight + borderHeight);

  textarea.style.height = `${Math.max(PAPER_CARD_TEXTAREA_MIN_HEIGHT, contentHeight)}px`;
}

export function refreshPaperCardTextareaHeights(): void {
  const textareas =
    paperCardFormElement.querySelectorAll<HTMLTextAreaElement>("textarea");
  for (const textarea of textareas) autoResizePaperCardTextarea(textarea);
}

export function schedulePaperCardTextareaRefresh(): void {
  // The paper-card page is initially hidden. Two animation frames ensure
  // layout is measurable after it becomes visible and after AI content renders.
  requestAnimationFrame(() => {
    refreshPaperCardTextareaHeights();
    requestAnimationFrame(refreshPaperCardTextareaHeights);
  });
}

export function bindPaperCardTextareaAutoResize(): void {
  const textareas =
    paperCardFormElement.querySelectorAll<HTMLTextAreaElement>("textarea");
  for (const textarea of textareas) {
    textarea.addEventListener("input", () =>
      autoResizePaperCardTextarea(textarea),
    );
  }

  paperVenueYearInput.addEventListener("blur", () => {
    paperVenueYearInput.value = normalizePaperVenueYearDisplay(
      paperVenueYearInput.value,
      paperTitleInput.value,
    );
    autoResizePaperCardTextarea(paperVenueYearInput);
  });
  window.addEventListener("resize", schedulePaperCardTextareaRefresh);
  schedulePaperCardTextareaRefresh();
}

export function renderPaperCardForm(
  data: Omit<PaperCardFormData, "personalNotes">,
): void {
  paperTitleInput.value = data.title;
  paperAuthorsInput.value = data.authors;
  paperVenueYearInput.value = normalizePaperVenueYearDisplay(
    data.venueYear,
    data.title,
  );
  paperResearchAreaInput.value = data.researchArea;
  paperKeywordsInput.value = data.keywords;
  paperOneSentenceSummaryInput.value = data.oneSentenceSummary;
  paperResearchProblemInput.value = data.researchProblem;
  paperCoreInnovationInput.value = data.coreInnovation;
  paperWorthReadingInput.value = data.worthReading;
  paperProblemSetupInput.value = data.problemSetup;
  paperResearchGapInput.value = data.researchGap;
  paperWhyImportantInput.value = data.whyImportant;
  paperTopicTagsInput.value = data.topicTags;
  paperMethodOverviewInput.value = data.methodOverview;
  paperMethodIntuitionInput.value = data.methodIntuition;
  paperMethodStepsInput.value = data.methodSteps;
  paperKeyAssumptionsInput.value = data.keyAssumptions;
  paperNotationGuideInput.value = data.notationGuide;
  paperDatasetsInput.value = data.datasets;
  paperExperimentSetupInput.value = data.experimentSetup;
  paperMetricsInput.value = data.metrics;
  paperMainFindingsInput.value = data.mainFindings;
  paperStrongestEvidenceInput.value = data.strongestEvidence;
  paperComparisonPriorWorkInput.value = data.comparisonWithPriorWork;
  paperLimitationsInput.value = data.limitations;
  setSelectValue(paperReadingStatusInput, data.readingStatus);
  setSelectValue(paperRecommendDeepReadingInput, data.recommendDeepReading);
  setSelectValue(paperReadingDifficultyInput, data.readingDifficulty);
  paperReadingValueScoreInput.value = data.readingValueScore;
  paperReadingAdviceInput.value = data.readingAdvice;
  paperSuitableStagesInput.value = data.suitableStages;
  paperPrerequisitesInput.value = data.prerequisites;
  paperCitationPointsInput.value = data.citationPoints;
  paperResearchConnectionInput.value = data.researchConnection;
  paperFollowupQuestionsInput.value = data.followupQuestions;
  paperWeeklyPlanInput.value = data.weeklyPlan;
  restorePaperCardInlineDrafts();
  setPaperCardEditMode(false);
  schedulePaperCardTextareaRefresh();
}

export function updatePaperCardDocumentName(): void {
  const currentName = sourceName.value ? getDisplayFileName(sourceName.value) : "";
  const name = paperCardReviewDocumentName.value || currentName || "尚未打开 PDF";
  paperCardDocumentNameElement.value = name;
  paperCardDocumentNameElement.title =
    paperCardReviewDocumentName.value || sourceName.value || name;
  autoResizePaperCardTextarea(paperCardDocumentNameElement);
}
