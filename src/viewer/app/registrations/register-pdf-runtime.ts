import { AnnotationEditorType, GlobalWorkerOptions, type AnnotationEditorUIManager } from "pdfjs-dist";
// Use the readable worker build so the repository's PDF.js text-metric patch
// is applied before WXT performs the production minification step.
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";















import { findCount, freeTextColorInput, highlightColorInput, knowledgeMainElement, summaryPanelElement, viewerElement } from "../viewer-elements";
import { activeSummaryScope, currentSummaryContext, lastSummaryPoints, lastSummaryRequestKey, selectedTextForAi, updateControls } from "../../core/pdf-reader/public";
import { updateSummaryMetadata } from "../../features/translation/public";
import { scheduleSummaryGeneration } from "../../services/document-agent/viewer-document-agent";
import { updateCardSourceSnippet } from "../../features/paper-card/public";
import { activeEditorMode, annotationEditor, canRedoAnnotation, canUndoAnnotation, eventBus, linkService, pdfDocument, pdfViewer, sourceName } from "../viewer-state";
import { captureInternalNavigationOrigin, goToPdfDestination } from "../../features/assistant/public";
import { scheduleUnsavedChangesCheck } from "../../features/annotations/public";
import { restoreReadingPositionAfterPagesInit, scheduleReadingPositionSave, setStatus } from "../../features/recent-files/public";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { finishEditorModeTransition, getFreeTextSize, installHighlightGeometry, scheduleHighlightNoteIndicatorRefresh, scheduleRestoredAnnotationEditorWarmUp, setEditorMode, setFreeTextColor, setFreeTextSize, setHighlightColor } from "../../features/annotations/public";





export function registerPdfRuntime(): void {
  GlobalWorkerOptions.workerSrc = workerUrl;
  
  if (!knowledgeMainElement) throw new Error("缺少知识库主内容区域");
  
  linkService.setViewer(pdfViewer);
  
  linkService.goToDestination = async (destination: any) => {
      captureInternalNavigationOrigin();
      await goToPdfDestination(destination);
    };
  
  eventBus.on("pagesinit", () => {
      restoreReadingPositionAfterPagesInit();
      setStatus(
        `${getDisplayFileName(sourceName.value)} · ${pdfDocument.value?.numPages ?? 0} 页`,
      );
      setEditorMode(AnnotationEditorType.NONE);
      scheduleHighlightNoteIndicatorRefresh();
      updateControls();
    });
  
  eventBus.on("pagechanging", () => {
      updateControls();
      updateSummaryMetadata();
      scheduleReadingPositionSave();
    
      if (!summaryPanelElement.hidden && activeSummaryScope.value !== "selection") {
        lastSummaryRequestKey.value = "";
        lastSummaryPoints.value = [];
        currentSummaryContext.value = null;
        scheduleSummaryGeneration();
      }
    
      if (!selectedTextForAi.value) updateCardSourceSnippet();
    });
  
  eventBus.on("scalechanging", () => {
      updateControls();
      scheduleReadingPositionSave();
    });
  
  eventBus.on(
      "updatefindmatchescount",
      ({
        matchesCount,
      }: {
        matchesCount?: { current?: number; total?: number };
      }) => {
        findCount.textContent = `${matchesCount?.current ?? 0}/${matchesCount?.total ?? 0}`;
      },
    );
  
  eventBus.on(
      "annotationeditoruimanager",
      ({ uiManager }: { uiManager: AnnotationEditorUIManager }) => {
        annotationEditor.value = uiManager;
        installHighlightGeometry(uiManager);
        setHighlightColor(highlightColorInput.value);
        setFreeTextSize(getFreeTextSize());
        setFreeTextColor(freeTextColorInput.value);
        scheduleRestoredAnnotationEditorWarmUp();
        updateControls();
      },
    );
  
  eventBus.on("annotationeditormodechanged", ({ mode }: { mode: number }) => {
      finishEditorModeTransition();
      activeEditorMode.value = mode;
      viewerElement.classList.toggle(
        "pdf-helper-ink-mode",
        mode === AnnotationEditorType.INK,
      );
      updateControls();
    });
  
  eventBus.on("editorsrendered", ({ pageNumber }: { pageNumber: number }) => {
      scheduleHighlightNoteIndicatorRefresh(pageNumber);
      scheduleRestoredAnnotationEditorWarmUp();
    });
  
  eventBus.on(
      "annotationeditorlayerrendered",
      ({ pageNumber }: { pageNumber: number }) => {
        scheduleHighlightNoteIndicatorRefresh(pageNumber);
        scheduleRestoredAnnotationEditorWarmUp();
      },
    );
  
  eventBus.on(
      "annotationlayerrendered",
      ({ pageNumber }: { pageNumber: number }) => {
        scheduleHighlightNoteIndicatorRefresh(pageNumber);
        scheduleRestoredAnnotationEditorWarmUp();
      },
    );
  
  eventBus.on(
      "editingstateschanged",
      ({
        details,
      }: {
        details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean };
      }) => {
        canUndoAnnotation.value = Boolean(details.hasSomethingToUndo);
        canRedoAnnotation.value = Boolean(details.hasSomethingToRedo);
        scheduleUnsavedChangesCheck();
        updateControls();
      },
    );
}
