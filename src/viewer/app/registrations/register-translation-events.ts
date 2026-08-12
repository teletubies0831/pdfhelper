
















import { applyTranslationEditButton, clearTranslationHistoryButton, closeTranslationHistoryButton, copyCardButton, copySummaryButton, copyTranslationButton, generateMoreExamplesButton, openTranslationHistoryButton, saveCardButton, saveSummaryNoteButton, saveTranslationNoteButton, selectedSnippetElement, selectedSnippetMathPreview, selectedSnippetModeToggleButton, translationHistoryDialog, translationHistorySearchInput, translationSourceSentenceInput, translationSourceSentenceMathPreview, translationSourceSentenceTranslation } from "../viewer-elements";
import { currentCardContext, currentEnglishLearningResult, currentEnglishLearningSourceSentence, currentGeneratedCard, lastSummaryPoints, lastTranslatedText, moreExamplesAbortController, normalizeCopiedText, selectedTextForAi, selectedTextPageNumber, translationAbortController } from "../../core/pdf-reader/public";
import { autoResizeTranslationTextarea, cancelPendingAutomaticTranslation, clearCurrentTranslationHistory, ensureTranslationHistoryLoaded, generateMoreVocabularyExamples, getEnglishLearningPlainText, getSelectedEnglishWord, markTranslationEditorChanged, normalizeLearningInlineText, renderLearningRichText, renderTranslationHistoryDialog, renderTranslationMathPreview, selectedSnippetDisplayMode, setSelectedSnippetDisplayMode, setTranslationSelectionEditor, setTranslationState, translateSelectedText } from "../../features/translation/public";
import { saveCurrentSummaryAsNote } from "../../services/document-agent/viewer-document-agent";
import { formatGeneratedCardText, saveCurrentPaperCard } from "../../features/paper-card/public";
import { pdfViewer } from "../viewer-state";

import { setStatus } from "../../features/recent-files/public";


import { saveTranslationAndExplanationAsNote } from "../../features/knowledge-base/public";




export function registerTranslationEvents(): void {
  document
    .querySelector<HTMLButtonElement>("#translation-inline-history")
    ?.addEventListener("click", () => openTranslationHistoryButton.click());
  for (const actionButton of document.querySelectorAll<HTMLButtonElement>(
    "[data-translation-action]",
  )) {
    const targetId = {
      save: "save-translation-note",
      examples: "generate-more-examples",
      copy: "copy-translation",
    }[actionButton.dataset.translationAction || ""];
    if (!targetId) continue;
    actionButton.addEventListener("click", () => {
      document.querySelector<HTMLButtonElement>(`#${targetId}`)?.click();
    });
  }
  saveTranslationNoteButton.addEventListener(
      "click",
      saveTranslationAndExplanationAsNote,
    );
  
  generateMoreExamplesButton.addEventListener("click", () => {
      void generateMoreVocabularyExamples();
    });
  
  selectedSnippetElement.addEventListener("input", markTranslationEditorChanged);
  
  selectedSnippetModeToggleButton.addEventListener("click", () => {
      setSelectedSnippetDisplayMode(
        selectedSnippetDisplayMode.value === "preview" ? "edit" : "preview",
        true,
      );
    });
  
  selectedSnippetMathPreview.addEventListener("dblclick", () => {
      setSelectedSnippetDisplayMode("edit", true);
    });
  
  selectedSnippetMathPreview.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setSelectedSnippetDisplayMode("edit", true);
    });
  
  translationSourceSentenceInput.addEventListener("input", () => {
      autoResizeTranslationTextarea(translationSourceSentenceInput);
      renderTranslationMathPreview(
        translationSourceSentenceMathPreview,
        translationSourceSentenceInput.value,
      );
      currentEnglishLearningSourceSentence.value = normalizeLearningInlineText(
        translationSourceSentenceInput.value,
      );
      renderLearningRichText(
        translationSourceSentenceTranslation,
        "原句已修改，重新查询后更新翻译",
      );
      applyTranslationEditButton.disabled = !normalizeCopiedText(
        selectedSnippetElement.value,
      );
    });
  
  applyTranslationEditButton.addEventListener("click", () => {
      const text = normalizeCopiedText(selectedSnippetElement.value);
      if (!text) {
        setTranslationState("请先填写需要翻译或解释的英文。", true);
        selectedSnippetElement.focus();
        return;
      }
    
      translationAbortController.value?.abort();
      moreExamplesAbortController.value?.abort();
      cancelPendingAutomaticTranslation();
      const existingWordResult = currentEnglishLearningResult.value?.kind === "word"
        ? currentEnglishLearningResult.value
        : null;
      const queryText = existingWordResult
        ? existingWordResult.selectedWord || existingWordResult.word
        : text;
      selectedTextForAi.value = queryText;
      selectedTextPageNumber.value = Math.max(
        1,
        selectedTextPageNumber.value || pdfViewer.currentPageNumber || 1,
      );
      currentEnglishLearningSourceSentence.value = existingWordResult
        ? text
        : getSelectedEnglishWord(text)
          ? normalizeLearningInlineText(translationSourceSentenceInput.value || text)
          : text;
      setTranslationSelectionEditor(
        queryText,
        currentEnglishLearningSourceSentence.value,
        "",
        queryText,
      );
      setSelectedSnippetDisplayMode("preview");
      lastTranslatedText.value = "";
      currentEnglishLearningResult.value = null;
      void translateSelectedText(queryText);
    });
  
  openTranslationHistoryButton.addEventListener("click", async () => {
      await ensureTranslationHistoryLoaded();
      translationHistorySearchInput.value = "";
      renderTranslationHistoryDialog();
      translationHistoryDialog.hidden = false;
      requestAnimationFrame(() => translationHistorySearchInput.focus());
    });
  
  closeTranslationHistoryButton.addEventListener("click", () => {
      translationHistoryDialog.hidden = true;
    });
  
  translationHistoryDialog.addEventListener("pointerdown", (event) => {
      if (event.target === translationHistoryDialog) {
        translationHistoryDialog.hidden = true;
      }
    });
  
  translationHistorySearchInput.addEventListener(
      "input",
      renderTranslationHistoryDialog,
    );
  
  clearTranslationHistoryButton.addEventListener("click", () => {
      void clearCurrentTranslationHistory();
    });
  
  copyTranslationButton.addEventListener("click", async () => {
      const learningText = getEnglishLearningPlainText();
      if (!currentEnglishLearningResult.value || !learningText) {
        setTranslationState("当前没有可复制的英语学习结果。", true);
        return;
      }
    
      await navigator.clipboard.writeText(learningText);
      setStatus(
        `已复制 ${learningText.length.toLocaleString("zh-CN")} 个学习字符。`,
      );
    });
  
  copySummaryButton.addEventListener("click", async () => {
      if (lastSummaryPoints.value.length === 0) {
        setStatus("当前没有可复制的总结要点。", true);
        return;
      }
    
      const text = lastSummaryPoints.value.map((point) => `• ${point}`).join("\n");
      await navigator.clipboard.writeText(text);
      setStatus(`已复制 ${lastSummaryPoints.value.length} 条总结要点。`);
    });
  
  saveSummaryNoteButton.addEventListener("click", saveCurrentSummaryAsNote);
  
  copyCardButton.addEventListener("click", async () => {
      if (!currentCardContext.value || !currentGeneratedCard.value) {
        setStatus("当前没有可复制的论文卡片。", true);
        return;
      }
    
      await navigator.clipboard.writeText(
        formatGeneratedCardText(currentCardContext.value, currentGeneratedCard.value),
      );
      setStatus(`已复制“${currentGeneratedCard.value.title}”论文卡片。`);
    });
  
  saveCardButton.addEventListener("click", saveCurrentPaperCard);
}
