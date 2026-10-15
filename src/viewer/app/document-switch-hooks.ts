import type { PDFDocumentProxy } from "pdfjs-dist";

import { setInkEraserMode } from "../features/annotations/public";
import {
  cancelPendingAutomaticTranslation,
  cancelPendingSummaryGeneration,
  ensureTranslationHistoryLoaded,
  renderTranslationHistory,
  resetSummaryState,
  setMoreExamplesButtonVisible,
  setTranslationLearningTitle,
  setTranslationSelectionEditor,
  setTranslationState,
} from "../features/translation/public";
import {
  cancelPendingCardGeneration,
  resetCardState,
} from "../features/paper-card/public";
import {
  clearPendingChatImages,
  restoreChatConversation,
} from "../features/assistant/public";
import {
  cardAbortController,
  currentEnglishLearningResult,
  currentEnglishLearningSourceSentence,
  lastTranslatedText,
  lastViewerSelectionText,
  moreExamplesAbortController,
  selectedTextForAi,
  selectedTextPageNumber,
  summaryAbortController,
  translationAbortController,
  translationHistoryDocumentKey,
  translationHistoryEntries,
} from "./feature-models";
import { translationLearningHintElement } from "./viewer-elements";

/**
 * Feature-state choreography that surrounds a document switch. Called by the
 * document-open orchestration (app/document-open.ts) at the exact lifecycle
 * points previously owned by the PDF core.
 */
export function runBeforeDocumentSwitchResets(): void {
  setInkEraserMode(false);
  cancelPendingAutomaticTranslation();
  cancelPendingSummaryGeneration();
  cancelPendingCardGeneration();
  translationAbortController.value?.abort();
  moreExamplesAbortController.value?.abort();
  summaryAbortController.value?.abort();
  cardAbortController.value?.abort();
}

export async function runAfterDocumentOpenResets(
  documentProxy: PDFDocumentProxy,
): Promise<void> {
  selectedTextForAi.value = "";
  selectedTextPageNumber.value = 0;
  lastViewerSelectionText.value = "";
  lastTranslatedText.value = "";
  currentEnglishLearningResult.value = null;
  currentEnglishLearningSourceSentence.value = "";
  setTranslationSelectionEditor("", "");
  translationHistoryDocumentKey.value = "";
  translationHistoryEntries.value = [];
  renderTranslationHistory();
  void ensureTranslationHistoryLoaded();
  setTranslationLearningTitle("学习结果");
  translationLearningHintElement.textContent =
    "选一个单词可查看语境词义、词性和例句；选一句话可获得翻译与重点词讲解。";
  setTranslationState("选中英文后将自动生成学习卡片。");
  setMoreExamplesButtonVisible(false);
  clearPendingChatImages();
  await restoreChatConversation(documentProxy);
  resetSummaryState();
  resetCardState();
}
