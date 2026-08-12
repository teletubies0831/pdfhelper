

















import { generateMoreExamplesButton, translationLearningHintElement } from "../../app/viewer-elements";
import { AUTO_TRANSLATE_DELAY_MS, activeAssistantView, activeSummaryScope, aiConfig, aiSelectionUpdateFrame, autoTranslateTimer, cardAbortController, currentCardContext, currentEnglishLearningResult, currentEnglishLearningSourceSentence, currentEnglishLearningSourceText, currentGeneratedCard, currentSummaryContext, getViewerSelectionText, lastCardRequestKey, lastSummaryPoints, lastSummaryRequestKey, lastTranslatedText, lastViewerSelectionText, moreExamplesAbortController, selectedTextForAi, selectedTextPageNumber, translationAbortController } from "../../core/pdf-reader/public";
import { parseAiJson, requestAiContent } from "../../shared-ui/markdown/markdown-renderer";

import { pdfViewer, sourceName } from "../../app/viewer-state";

import { setStatus } from "../recent-files/public";
import { scheduleSummaryGeneration } from "../../services/document-agent/viewer-document-agent";
import { scheduleCardGeneration, updateCardSourceSnippet } from "../paper-card/public";
import { getDisplayFileName } from "../../core/pdf-reader/public";

import { getEnglishWordSelection, getSelectedEnglishWord, getSelectionSentenceContext, getSelectionSurroundingText, getTranslationScopeFromSelection, normalizeLearningInlineText, setMoreExamplesButtonVisible, setTranslationLearningTitle, setTranslationState } from './selection-context';
import { parseSentenceLearningResult, parseVocabularyLearningResult, readVocabularyExamples, renderSentenceLearningResult, renderVocabularyLearningResult, setTranslationSelectionEditor } from './learning-view';
import { updateSummaryMetadata } from './citation-and-summary';
import { findTranslationHistoryResult, storeTranslationHistoryResult } from './translation-history';




export function cancelPendingAutomaticTranslation(): void {
  if (autoTranslateTimer.value !== null) {
    clearTimeout(autoTranslateTimer.value);
    autoTranslateTimer.value = null;
  }
}



export function scheduleAutomaticTranslation(text: string): void {
  cancelPendingAutomaticTranslation();

  // 用户还在拖动选区时 selectionchange 会频繁触发。
  // 等选区稳定 700ms 后再请求，避免每个字符都调用一次接口。
  autoTranslateTimer.value = setTimeout(() => {
    autoTranslateTimer.value = null;

    if (text !== selectedTextForAi.value || text === lastTranslatedText.value) {
      return;
    }

    void translateSelectedText(text);
  }, AUTO_TRANSLATE_DELAY_MS);
}



export function updateAiSelectedSnippet(): void {
  const surroundingText = getSelectionSurroundingText();
  const rawSelectedText = getViewerSelectionText(surroundingText);
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  if (!rawSelectedText) {
    lastViewerSelectionText.value = "";
    return;
  }
  if (
    rawSelectedText === lastViewerSelectionText.value
    && pageNumber === selectedTextPageNumber.value
  ) return;

  const automaticWordSelection = getEnglishWordSelection(
    rawSelectedText,
    surroundingText,
  );
  const sourceSentence = getSelectionSentenceContext(
    rawSelectedText,
    surroundingText,
  );
  const text = automaticWordSelection?.word
    || getTranslationScopeFromSelection(rawSelectedText, sourceSentence)
    || rawSelectedText;

  lastViewerSelectionText.value = rawSelectedText;
  selectedTextForAi.value = text;
  selectedTextPageNumber.value = pageNumber;
  setTranslationSelectionEditor(
    text,
    automaticWordSelection ? sourceSentence : text,
    "",
    rawSelectedText,
  );
  translationAbortController.value?.abort();
  moreExamplesAbortController.value?.abort();
  cancelPendingAutomaticTranslation();
  lastTranslatedText.value = "";
  currentEnglishLearningResult.value = null;
  setMoreExamplesButtonVisible(false);
  if (activeAssistantView.value === "translate") {
    scheduleAutomaticTranslation(text);
  } else {
    setTranslationLearningTitle("学习结果");
    translationLearningHintElement.textContent =
      "切换到“英语学习”后将自动处理当前选区。";
    setTranslationState("切换到“英语学习”后将自动生成学习卡片。");
  }

  if (activeSummaryScope.value === "selection") {
    lastSummaryRequestKey.value = "";
    lastSummaryPoints.value = [];
    currentSummaryContext.value = null;
    updateSummaryMetadata();
    if (activeAssistantView.value === "summary") scheduleSummaryGeneration();
  }

  lastCardRequestKey.value = "";
  currentCardContext.value = null;
  currentGeneratedCard.value = null;
  cardAbortController.value?.abort();
  updateCardSourceSnippet();
  if (activeAssistantView.value === "cards") scheduleCardGeneration();
}



export function scheduleAiSelectedSnippetUpdate(): void {
  cancelAnimationFrame(aiSelectionUpdateFrame.value);
  aiSelectionUpdateFrame.value = requestAnimationFrame(updateAiSelectedSnippet);
}



export async function translateSelectedText(text: string): Promise<void> {
  if (!text || text !== selectedTextForAi.value) return;

  const selectedWord = getSelectedEnglishWord(text);
  const isWord = Boolean(selectedWord);
  const sourceSentence = normalizeLearningInlineText(
    currentEnglishLearningSourceSentence.value || text,
  );

  const cachedEntry = await findTranslationHistoryResult(
    selectedWord || sourceSentence,
    sourceSentence,
    isWord ? "word" : "sentence",
  );
  if (text !== selectedTextForAi.value) return;
  if (cachedEntry) {
    lastTranslatedText.value = text;
    currentEnglishLearningSourceText.value = text;
    currentEnglishLearningResult.value = cachedEntry.result;
    if (cachedEntry.result.kind === "word") {
      renderVocabularyLearningResult(cachedEntry.result);
    } else {
      renderSentenceLearningResult(cachedEntry.result);
    }
    translationLearningHintElement.textContent = "已从当前 PDF 的历史记录中恢复结果，未调用大模型。";
    void storeTranslationHistoryResult(text, cachedEntry.result);
    return;
  }

  translationAbortController.value?.abort();
  const controller = new AbortController();
  translationAbortController.value = controller;
  currentEnglishLearningSourceText.value = text;
  currentEnglishLearningResult.value = null;
  setMoreExamplesButtonVisible(false);
  setTranslationLearningTitle(isWord ? "单词学习" : "原句翻译");
  translationLearningHintElement.textContent = isWord
    ? "正在结合该单词所在的原句查询语境词义、词性和例句。"
    : "正在翻译原句，并筛选其中值得学习的重点词汇。";
  if (
    isWord
    && lastViewerSelectionText.value
    && normalizeLearningInlineText(lastViewerSelectionText.value) !== selectedWord
  ) {
    translationLearningHintElement.textContent = `已自动识别为完整单词 “${selectedWord}”，正在查询其语境词义、词性和例句。`;
  }
  setTranslationState(
    isWord ? "正在生成单词学习卡片，请稍候…" : "正在翻译原句并整理重点词汇，请稍候…",
  );

  try {
    const prompt = isWord
      ? [
          "你是严谨的英汉词典与英语教师。请为一个英文单词制作学习卡。",
          `当前选中单词：${selectedWord}`,
          `该单词所在的 PDF 原句：${sourceSentence}`,
          "原句或释义中出现数学公式时，使用标准 LaTeX，并用 $...$（行内）或 $$...$$（独立公式）包裹；不要把公式改写成乱码或纯文字。",
          "先核验当前选中内容是否完整单词；若不是，selectionComplete 必须为 false。",
          "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
          "JSON 格式：",
          '{"selectionComplete":true,"headword":"单词原形或当前词形","sourceSentenceLatex":"保留英文原句并把公式重建为 $...$ 或 $$...$$","pronunciation":"音标或空字符串","partsOfSpeech":[{"label":"词性缩写","meaning":"常见中文义"}],"meaningInSentence":"该词在原句中的准确中文含义","sentenceTranslation":"原句完整中文翻译","examples":[{"sentence":"例句","translation":"中文翻译","usage":"该例句展示的不同用法"},{"sentence":"例句","translation":"中文翻译","usage":"该例句展示的不同用法"}]}',
          "规则：examples 必须正好给出 2 个原创例句，且尽量覆盖不同常见用法；不要把 PDF 原句放进 examples。",
        ].join("\n")
      : [
          "你是面向英语学习者的 PDF 原句翻译助手。",
          `需要翻译的当前 PDF 原句或短段：${sourceSentence}`,
          "即使用户最初只框选了句子的一部分，也必须翻译这里提供的完整句子，译文不得在句中截断。",
          "保留原文中的数学关系；所有公式使用标准 LaTeX，并用 $...$（行内）或 $$...$$（独立公式）包裹，以便客户端渲染。",
          "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
          "JSON 格式：",
          '{"sourceTextLatex":"保留完整英文原句并把公式重建为 $...$ 或 $$...$$","translation":"忠实、自然的简体中文翻译并保留 LaTeX 公式","keywords":[{"word":"原文词或短语","partOfSpeech":"词性","meaningInSentence":"在本句中的准确含义","reason":"内部筛选依据，不向用户展示"}]}',
          "keywords 最多保留 6 个真正值得学习的重点单词或固定短语；没有合格项时返回空数组，不要为了数量凑词。",
          "通用筛选标准：候选项至少满足一项——大学英语六级（CET-6）及以上或 CEFR B2+ 难度；在当前学科中具有区别于日常含义的专业义；属于理解本句所必需的规范术语；属于低频、不可按字面直接理解的学术固定搭配。",
          "通用排除标准：高频基础词、常见功能词、仅因复数或时态变化而显得复杂的普通词、可由组成词直接推断含义的常用组合，以及一般研究生读者无需查词即可理解的表达。",
          "对每个候选项先在 reason 中给出内部判定依据，并据此复核是否符合上述标准；不符合就不要放入 keywords。reason 仅供内部筛选，客户端不会展示。",
        ].join("\n");
    const content = await requestAiContent(
      isWord
        ? [
            { role: "user", content: prompt },
            {
              role: "user",
              content: [
                "补充且优先执行以下要求：当前选区已由客户端识别为完整英文词形，绝不能因为过去式、过去分词、现在分词、复数、连字符词或专有名词而拒绝解释。",
                "请识别原形 headword、选中的实际词形 selectedWord、wordForm（如过去分词、过去式、现在分词、复数、专有名词等）和 namedEntityType（人名、地名、机构、作品名；没有则为空字符串）。",
                "必须返回 sourceSentenceLatex：保留英文原句的全部普通文字和标点，只把 PDF 中的数学公式重建为标准 LaTeX，并用 $...$ 或 $$...$$ 包裹；不得翻译、概括或删减英文原句。",
                "请返回该词的全部常用义项，每个义项都要有词性 label、中文 meaning 和简洁英文释义 definitionEn；文中义项放在最前。",
                "请给出 forms 词形变化列表，例如原形、第三人称单数、现在分词、过去式、过去分词、复数。",
                "examples 必须包含 3 个新的不同用法例句；PDF 原句由客户端另行展示，不要放进 examples。",
                "严格只输出 JSON，对象必须符合：{\"selectionComplete\":true,\"headword\":\"...\",\"selectedWord\":\"...\",\"sourceSentenceLatex\":\"英文原句与 $LaTeX$ 公式\",\"wordForm\":\"...\",\"namedEntityType\":\"\",\"pronunciation\":\"\",\"senses\":[{\"label\":\"v.\",\"meaning\":\"\",\"definitionEn\":\"\"}],\"forms\":[{\"label\":\"过去式\",\"value\":\"\"}],\"meaningInSentence\":\"\",\"sentenceTranslation\":\"\",\"examples\":[{\"sentence\":\"\",\"translation\":\"\",\"usage\":\"\"}]}",
              ].join("\\n"),
            },
          ]
        : [
            {
              role: "user",
              content: prompt,
            },
          ],
      {
        documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
        pageNumber: selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
        selectedText: isWord ? text : sourceSentence,
        task: isWord ? "英语学习：单词语境释义" : "英语学习：原句翻译",
      },
      {
        model: aiConfig.value.translationModel || aiConfig.value.model,
        reasoning: "disabled",
        maxOutputTokens: Math.min(4096, aiConfig.value.maxOutputTokens),
      },
    );

    // Only show the result for the current selection so a slow request cannot
    // overwrite a newer word or sentence.
    if (controller.signal.aborted || text !== selectedTextForAi.value) return;

    lastTranslatedText.value = text;
    if (isWord) {
      const result = parseVocabularyLearningResult(
        content,
        selectedWord,
        sourceSentence,
      );
      if (false && !result.selectionComplete) {
        currentEnglishLearningResult.value = null;
        translationLearningHintElement.textContent =
          "模型判断当前内容不是完整英文单词，请重新完整选中后再查询。";
        setTranslationState("当前选区不是完整单词，请重新完整选中后再查询。");
        return;
      }
      currentEnglishLearningResult.value = result;
      renderVocabularyLearningResult(result);
      void storeTranslationHistoryResult(text, result);
    } else {
      const result = parseSentenceLearningResult(content, sourceSentence);
      currentEnglishLearningResult.value = result;
      renderSentenceLearningResult(result);
      void storeTranslationHistoryResult(text, result);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (controller.signal.aborted || text !== selectedTextForAi.value) return;

    const message = error instanceof Error ? error.message : String(error);
    setTranslationState(`英语学习结果生成失败：${message}`, true);
  } finally {
    if (translationAbortController.value === controller) {
      translationAbortController.value = null;
    }
  }
}



export async function generateMoreVocabularyExamples(): Promise<void> {
  const result = currentEnglishLearningResult.value;
  if (!result || result.kind !== "word") return;

  moreExamplesAbortController.value?.abort();
  const controller = new AbortController();
  moreExamplesAbortController.value = controller;
  generateMoreExamplesButton.disabled = true;
  generateMoreExamplesButton.textContent = "正在生成…";

  try {
    const existingExamples = result.examples
      .map((example) => example.sentence)
      .join("\n");
    const content = await requestAiContent(
      [
        {
          role: "user",
          content: [
            "你是英语教师，请为下面单词补充 2 个新的英语例句。",
            `单词：${result.word}`,
            `该词在论文中的语境含义：${result.meaningInSentence}`,
            "以下例句已经展示过，禁止重复或只改写：",
            existingExamples,
            "严格只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
            'JSON 格式：{"examples":[{"sentence":"例句","translation":"中文翻译","usage":"不同含义或用法说明"},{"sentence":"例句","translation":"中文翻译","usage":"不同含义或用法说明"}]}',
          ].join("\n"),
        },
      ],
      {
        documentName: sourceName.value ? getDisplayFileName(sourceName.value) : undefined,
        pageNumber: selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
        selectedText: result.word,
        task: "英语学习：扩展单词例句",
      },
      {
        model: aiConfig.value.translationModel || aiConfig.value.model,
        reasoning: "disabled",
        maxOutputTokens: Math.min(4096, aiConfig.value.maxOutputTokens),
      },
    );
    if (controller.signal.aborted || currentEnglishLearningResult.value !== result) return;

    const parsed = parseAiJson(content);
    const newExamples = readVocabularyExamples(parsed.examples).filter(
      (candidate) =>
        !result.examples.some(
          (existing) =>
            normalizeLearningInlineText(existing.sentence).toLocaleLowerCase()
            === normalizeLearningInlineText(candidate.sentence).toLocaleLowerCase(),
        ),
    );
    if (!newExamples.length) {
      setStatus("没有生成新的非重复例句，请再试一次。", true);
      return;
    }
    result.examples.push(...newExamples.slice(0, 3));
    renderVocabularyLearningResult(result);
    void storeTranslationHistoryResult(
      currentEnglishLearningSourceText.value || result.selectedWord || result.word,
      result,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`生成更多例句失败：${message}`, true);
  } finally {
    if (moreExamplesAbortController.value === controller) {
      moreExamplesAbortController.value = null;
      generateMoreExamplesButton.disabled = false;
      generateMoreExamplesButton.textContent = "生成更多例句";
    }
  }
}
