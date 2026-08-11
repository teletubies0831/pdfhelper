


import { paperAuthorsInput, paperCitationPointsInput, paperComparisonPriorWorkInput, paperCoreInnovationInput, paperDatasetsInput, paperExperimentSetupInput, paperFollowupQuestionsInput, paperKeyAssumptionsInput, paperKeywordsInput, paperLimitationsInput, paperMainFindingsInput, paperMethodIntuitionInput, paperMethodOverviewInput, paperMethodStepsInput, paperMetricsInput, paperNotationGuideInput, paperOneSentenceSummaryInput, paperPersonalNotesInput, paperPrerequisitesInput, paperProblemSetupInput, paperReadingAdviceInput, paperReadingDifficultyInput, paperReadingStatusInput, paperReadingValueScoreInput, paperRecommendDeepReadingInput, paperResearchAreaInput, paperResearchConnectionInput, paperResearchGapInput, paperResearchProblemInput, paperStrongestEvidenceInput, paperSuitableStagesInput, paperTitleInput, paperTopicTagsInput, paperVenueYearInput, paperWeeklyPlanInput, paperWhyImportantInput, paperWorthReadingInput } from "../../app/viewer-elements";




import type { PaperCardFormData } from "../../core/pdf-reader/public";



export function setSelectValue(select: HTMLSelectElement, value: string): void {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    select.value = "";
    return;
  }

  const hasOption = Array.from(select.options).some(
    (option) => option.value === normalizedValue,
  );
  if (!hasOption) {
    const option = document.createElement("option");
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    select.append(option);
  }
  select.value = normalizedValue;
}

export function collectPaperCardFormData(): PaperCardFormData {
  return {
    title: paperTitleInput.value.trim(),
    authors: paperAuthorsInput.value.trim(),
    venueYear: normalizePaperVenueYearDisplay(paperVenueYearInput.value),
    researchArea: paperResearchAreaInput.value.trim(),
    keywords: paperKeywordsInput.value.trim(),
    oneSentenceSummary: paperOneSentenceSummaryInput.value.trim(),
    researchProblem: paperResearchProblemInput.value.trim(),
    coreInnovation: paperCoreInnovationInput.value.trim(),
    worthReading: paperWorthReadingInput.value.trim(),
    problemSetup: paperProblemSetupInput.value.trim(),
    researchGap: paperResearchGapInput.value.trim(),
    whyImportant: paperWhyImportantInput.value.trim(),
    topicTags: paperTopicTagsInput.value.trim(),
    methodOverview: paperMethodOverviewInput.value.trim(),
    methodIntuition: paperMethodIntuitionInput.value.trim(),
    methodSteps: paperMethodStepsInput.value.trim(),
    keyAssumptions: paperKeyAssumptionsInput.value.trim(),
    notationGuide: paperNotationGuideInput.value.trim(),
    datasets: paperDatasetsInput.value.trim(),
    experimentSetup: paperExperimentSetupInput.value.trim(),
    metrics: paperMetricsInput.value.trim(),
    mainFindings: paperMainFindingsInput.value.trim(),
    strongestEvidence: paperStrongestEvidenceInput.value.trim(),
    comparisonWithPriorWork: paperComparisonPriorWorkInput.value.trim(),
    limitations: paperLimitationsInput.value.trim(),
    readingStatus: paperReadingStatusInput.value.trim(),
    recommendDeepReading: paperRecommendDeepReadingInput.value.trim(),
    readingDifficulty: paperReadingDifficultyInput.value.trim(),
    readingValueScore: paperReadingValueScoreInput.value.trim(),
    readingAdvice: paperReadingAdviceInput.value.trim(),
    suitableStages: paperSuitableStagesInput.value.trim(),
    prerequisites: paperPrerequisitesInput.value.trim(),
    citationPoints: paperCitationPointsInput.value.trim(),
    researchConnection: paperResearchConnectionInput.value.trim(),
    followupQuestions: paperFollowupQuestionsInput.value.trim(),
    weeklyPlan: paperWeeklyPlanInput.value.trim(),
    personalNotes: paperPersonalNotesInput.value.trim(),
  };
}

export function normalizePaperVenueYearDisplay(value: string): string {
  let normalized = value.trim();
  if (!normalized) return "";

  normalized = normalized
    .replace(/\s*[，,]\s*(?=(?:19|20)\d{2}\b)/g, " · ")
    .replace(/\s*[·•]\s*/g, " · ")
    .replace(/\s+((?:19|20)\d{2})\s*$/g, " · $1")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}
