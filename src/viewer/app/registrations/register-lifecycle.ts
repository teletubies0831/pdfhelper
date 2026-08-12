














import { installOnlineRelatedPapers } from "../../../../entrypoints/viewer/online-related-papers";
import { installCurrentPaperCcfRank } from "../../../../entrypoints/viewer/ccf-rank";
import { citationReturnButton, saveAnnotatedPdfButton, selectedSnippetElement, textStatus, toggleNotesButton, translationSourceSentenceField, translationSourceSentenceInput, viewerContainer, viewerElement } from "../viewer-elements";
import { activeSummaryScope, cardAbortController, clearOutlineList, moreExamplesAbortController, persistCurrentAppViewState, restoreAppViewAfterRefresh, setLeftPanelCollapsed, summaryAbortController, translationAbortController, updateControls } from "../../core/pdf-reader/public";
import { autoResizeTranslationTextarea, cancelPendingAutomaticTranslation, scheduleAiSelectedSnippetUpdate } from "../../features/translation/public";
import { cancelPendingSummaryGeneration } from "../../services/document-agent/viewer-document-agent";
import { cancelPendingCardGeneration, installPaperCardInlineEditing } from "../../features/paper-card/public";
import { areNoteIndicatorsHidden, hasUnsavedChanges } from "../viewer-state";
import { loadDeepSeekConfig, returnToPreviousInternalNavigationPosition, setCurrentApplicationView, updateReadingModeUi } from "../../features/assistant/public";
import { updateNoteIndicatorsVisibility } from "../../features/annotations/public";
import { cancelReadingPositionSave, persistCurrentReadingPosition, restoreMostRecentPdf, scheduleReadingPositionSave } from "../../features/recent-files/public";
import { openRemotePdf, saveAnnotatedPdf } from "../../core/pdf-reader/public";
import { hideAnnotationActionBar, hideHighlightNote, hideSelectionContextMenu } from "../../features/annotations/public";



import { source } from '../app-ui';

export function registerLifecycle(): void {
  let viewerSelectionPointerActive = false;

  document.addEventListener("selectionchange", () => {
      // Building the AI sentence context walks the full PDF.js text layer.
      // Keep that work out of the pointer-drag hot path and run it once after
      // the browser has finalized the selection on pointerup.
      if (!viewerSelectionPointerActive) scheduleAiSelectedSnippetUpdate();
    });
  
  viewerElement.addEventListener("pointerdown", (event) => {
      if (event.button === 0) viewerSelectionPointerActive = true;
      // 开始新一轮拖选时，停止旧选区尚未发出的 AI 请求。
      cancelPendingAutomaticTranslation();
      translationAbortController.value?.abort();
      moreExamplesAbortController.value?.abort();
      if (activeSummaryScope.value === "selection") {
        cancelPendingSummaryGeneration();
        summaryAbortController.value?.abort();
      }
      cancelPendingCardGeneration();
      cardAbortController.value?.abort();
    });
  
  const finishViewerPointerSelection = () => {
      if (!viewerSelectionPointerActive) return;
      viewerSelectionPointerActive = false;
      scheduleAiSelectedSnippetUpdate();
    };

  document.addEventListener("pointerup", finishViewerPointerSelection, true);
  document.addEventListener("pointercancel", finishViewerPointerSelection, true);
  window.addEventListener("blur", finishViewerPointerSelection);
  
  viewerElement.addEventListener("keyup", () =>
      scheduleAiSelectedSnippetUpdate(),
    );
  
  citationReturnButton.addEventListener(
      "click",
      returnToPreviousInternalNavigationPosition,
    );
  
  viewerContainer.addEventListener(
      "scroll",
      () => {
        scheduleReadingPositionSave();
        hideSelectionContextMenu();
        hideHighlightNote();
        hideAnnotationActionBar();
      },
      { passive: true },
    );
  
  window.addEventListener("resize", () => {
      autoResizeTranslationTextarea(selectedSnippetElement);
      if (!translationSourceSentenceField.hidden) {
        autoResizeTranslationTextarea(translationSourceSentenceInput);
      }
    });
  
  document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        cancelReadingPositionSave();
        void persistCurrentReadingPosition();
        persistCurrentAppViewState();
      }
    });
  
  window.addEventListener("beforeunload", (event) => {
      cancelReadingPositionSave();
      void persistCurrentReadingPosition();
      persistCurrentAppViewState();
      if (!hasUnsavedChanges.value) return;
      event.preventDefault();
      event.returnValue = "";
    });
  
  saveAnnotatedPdfButton.addEventListener("click", () => {
      void saveAnnotatedPdf();
    });
  
  toggleNotesButton.addEventListener("click", () => {
      areNoteIndicatorsHidden.value = !areNoteIndicatorsHidden.value;
      updateNoteIndicatorsVisibility();
    });
  
  updateNoteIndicatorsVisibility();
  
  setCurrentApplicationView("viewer");
  
  clearOutlineList("打开 PDF 后显示目录");
  
  setLeftPanelCollapsed(false);
  
  updateControls();
  
  updateReadingModeUi();
  
  void loadDeepSeekConfig();
  
  textStatus.textContent = "交互已就绪";
  
  restoreAppViewAfterRefresh();
  
  if (source?.startsWith("http://") || source?.startsWith("https://")) {
      void openRemotePdf(source);
    } else {
      void restoreMostRecentPdf();
    }
  
  installOnlineRelatedPapers();
  
  installCurrentPaperCcfRank();
  
  installPaperCardInlineEditing();
}
