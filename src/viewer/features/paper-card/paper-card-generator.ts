





import { browser } from "wxt/browser";
import { type AiRuntimeResponse } from "../../../../shared/ai";









import { aiConfig, aiConfigLoaded, paperCardPageAbortController, paperCardPageDocumentKey, paperCardPageRequestId, setDeepSeekSettingsOpen } from "../../core/pdf-reader/public";
import { deepSeekSettingsStatus, paperCardDocumentNameElement, paperCardFormElement, paperKeywordsInput, paperResearchAreaInput, paperTitleInput, regeneratePaperCardButton } from "../../app/viewer-elements";
import { pdfDocument, sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";
import { parseAiJson } from "../../shared-ui/markdown/markdown-renderer";

import { loadDeepSeekConfig } from "../assistant/public";

import type { PaperOverviewApiResponse } from "../../core/pdf-reader/public";
import { cancelActivePaperOverviewRequest, clearPaperCardInlineDrafts, collectRelevantKnowledgeContextForPaper, computePaperReadingValueScore, extractPaperOverviewText, finishPaperCardGenerationStatus, normalizePaperOverviewField, renderPaperCardForm, setPaperCardPageStatus, updatePaperCardDocumentName } from './paper-card-form';




export async function generatePaperOverviewCard(force = false): Promise<void> {
  updatePaperCardDocumentName();
  if (!pdfDocument.value) {
    setPaperCardPageStatus("请先打开 PDF，再生成论文卡片。", true);
    return;
  }

  const documentAtStart = pdfDocument.value;
  const documentKey = `${sourceName.value}\u0000${documentAtStart.numPages}`;
  if (
    !force &&
    paperCardPageDocumentKey.value === documentKey &&
    paperTitleInput.value.trim()
  ) {
    return;
  }

  paperCardPageAbortController.value?.abort();
  cancelActivePaperOverviewRequest();
  const controller = new AbortController();
  paperCardPageAbortController.value = controller;
  regeneratePaperCardButton.disabled = true;
  delete paperCardFormElement.dataset.paperReady;
  paperCardFormElement.dataset.generatingDocument =
    sourceName.value ? getDisplayFileName(sourceName.value) : "当前论文";
  paperCardFormElement.classList.add("generating");
  document.dispatchEvent(
    new CustomEvent("pdf-helper:paper-card-reset", {
      detail: {
        documentName: paperCardFormElement.dataset.generatingDocument,
      },
    }),
  );
  setPaperCardPageStatus(
    "正在读取当前论文并准备结构化卡片，请稍候…",
    false,
    { persistent: true },
  );

  try {
    if (force) clearPaperCardInlineDrafts();
    if (!aiConfigLoaded.value) await loadDeepSeekConfig();
    if (!aiConfig.value.apiKey) {
      setDeepSeekSettingsOpen(true);
      deepSeekSettingsStatus.classList.add("error");
      deepSeekSettingsStatus.textContent =
        "生成论文卡片需要先配置并保存 API Key。";
      throw new Error("请先在右上角“设置”中配置 API Key。");
    }

    const text = await extractPaperOverviewText(documentAtStart);
    if (controller.signal.aborted) return;

    setPaperCardPageStatus(
      `已读取 ${text.length.toLocaleString()} 个字符，正在生成结构化论文卡片…`,
      false,
      { persistent: true },
    );
    const knowledgeContext = collectRelevantKnowledgeContextForPaper();

    const requestId = crypto.randomUUID();
    paperCardPageRequestId.value = requestId;
    const paperOverviewResponsePromise = browser.runtime.sendMessage({
      type: "pdf-helper:ai-generate-paper-overview",
      requestId,
      documentName: getDisplayFileName(sourceName.value),
      pageCount: documentAtStart.numPages,
      text,
      knowledgeContext,
    }) as Promise<AiRuntimeResponse>;

    let viewerTimeoutId: number | undefined;
    const viewerTimeoutPromise = new Promise<never>((_resolve, reject) => {
      viewerTimeoutId = window.setTimeout(() => {
        reject(
          new Error(
            "论文卡片生成等待超时，已恢复页面。请检查网络或模型设置后重试。",
          ),
        );
      }, 130_000);
    });

    let overviewResponse: AiRuntimeResponse;
    try {
      overviewResponse = await Promise.race([
        paperOverviewResponsePromise,
        viewerTimeoutPromise,
      ]);
    } finally {
      if (viewerTimeoutId !== undefined) {
        window.clearTimeout(viewerTimeoutId);
      }
    }

    if (
      controller.signal.aborted ||
      pdfDocument.value !== documentAtStart ||
      paperCardPageRequestId.value !== requestId
    ) {
      return;
    }
    if (!overviewResponse?.ok || !overviewResponse.content?.trim()) {
      throw new Error(
        overviewResponse?.error || "AI 模型没有返回有效的论文卡片内容。",
      );
    }

    const aiContent = overviewResponse.content.trim();
    const payload = parseAiJson(aiContent) as PaperOverviewApiResponse;
    if (pdfDocument.value !== documentAtStart || controller.signal.aborted) return;

    renderPaperCardForm({
      title: normalizePaperOverviewField(payload.title),
      authors: normalizePaperOverviewField(payload.authors),
      venueYear: normalizePaperOverviewField(payload.venue_year),
      researchArea: normalizePaperOverviewField(payload.research_area),
      keywords: normalizePaperOverviewField(payload.keywords),
      oneSentenceSummary: normalizePaperOverviewField(
        payload.one_sentence_summary,
      ),
      researchProblem: normalizePaperOverviewField(payload.research_problem),
      coreInnovation: normalizePaperOverviewField(payload.core_innovation),
      worthReading: normalizePaperOverviewField(payload.worth_reading),
      problemSetup: normalizePaperOverviewField(payload.problem_setup),
      researchGap: normalizePaperOverviewField(payload.research_gap),
      whyImportant: normalizePaperOverviewField(payload.why_important),
      topicTags: normalizePaperOverviewField(payload.topic_tags),
      methodOverview: normalizePaperOverviewField(payload.method_overview),
      methodIntuition: normalizePaperOverviewField(payload.method_intuition),
      methodSteps: normalizePaperOverviewField(payload.method_steps),
      keyAssumptions: normalizePaperOverviewField(payload.key_assumptions),
      notationGuide: normalizePaperOverviewField(payload.notation_guide),
      datasets: normalizePaperOverviewField(payload.datasets),
      experimentSetup: normalizePaperOverviewField(payload.experiment_setup),
      metrics: normalizePaperOverviewField(payload.metrics),
      mainFindings: normalizePaperOverviewField(payload.main_findings),
      strongestEvidence: normalizePaperOverviewField(
        payload.strongest_evidence,
      ),
      comparisonWithPriorWork: normalizePaperOverviewField(
        payload.comparison_with_prior_work,
      ),
      limitations: normalizePaperOverviewField(payload.limitations),
      readingStatus: normalizePaperOverviewField(payload.reading_status),
      recommendDeepReading: normalizePaperOverviewField(
        payload.recommend_deep_reading,
      ),
      readingDifficulty: normalizePaperOverviewField(
        payload.reading_difficulty,
      ),
      readingValueScore: computePaperReadingValueScore(payload),
      readingAdvice: normalizePaperOverviewField(payload.reading_advice),
      suitableStages: normalizePaperOverviewField(payload.suitable_stages),
      prerequisites: normalizePaperOverviewField(payload.prerequisites),
      citationPoints: normalizePaperOverviewField(payload.citation_points),
      researchConnection: normalizePaperOverviewField(
        payload.research_connection,
      ),
      followupQuestions: normalizePaperOverviewField(
        payload.followup_questions,
      ),
      weeklyPlan: normalizePaperOverviewField(payload.weekly_plan),
    });

    paperCardPageDocumentKey.value = documentKey;
    paperCardFormElement.dataset.paperReady = "true";
    document.dispatchEvent(
      new CustomEvent("pdf-helper:paper-card-ready", {
        detail: {
          title: paperTitleInput.value.trim(),
          keywords: paperKeywordsInput.value.trim(),
          researchArea: paperResearchAreaInput.value.trim(),
          documentName: paperCardDocumentNameElement.value.trim(),
        },
      }),
    );
    finishPaperCardGenerationStatus();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    setPaperCardPageStatus(`论文卡片生成失败：${message}`, true);
  } finally {
    if (paperCardPageAbortController.value === controller)
      paperCardPageAbortController.value = null;
    if (paperCardPageRequestId.value) {
      cancelActivePaperOverviewRequest();
    }
    regeneratePaperCardButton.disabled = false;
    paperCardFormElement.classList.remove("generating");
    delete paperCardFormElement.dataset.generatingDocument;
  }
}
