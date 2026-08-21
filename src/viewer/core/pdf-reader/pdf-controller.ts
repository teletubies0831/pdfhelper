import { AnnotationEditorType, getDocument } from "pdfjs-dist";

import { executeMemoryTool } from "../../../../entrypoints/viewer/memory-store";

import {
  activeEditorMode,
  annotationEditor,
  annotationEditorWarmUpInFlight,
  canRedoAnnotation,
  canUndoAnnotation,
  currentFileHandle,
  currentRecentEntryId,
  eventBus,
  findController,
  isOpeningDocument,
  isRestoringReadingPosition,
  isSavingAnnotatedPdf,
  lastReadingPosition,
  linkService,
  nativeAnnotationNotes,
  pdfDocument,
  pdfViewer,
  pendingReadingPosition,
  restoredAnnotationWarmUpPending,
  restoredHelperNotesBySignature,
  restoredHelperNotesByStorageKey,
  sourceName,
  sourcePdfBytes,
} from "../../app/viewer-state";
import {
  confirmDiscardUnsavedChanges,
  embedHelperAnnotationsIntoPdf,
  getPdfFingerprint,
  markSavedChanges,
  restoreHelperAnnotations,
  writeEmbeddedPdfBytes,
} from "../../features/annotations/public";
import {
  cancelReadingPositionSave,
  rememberRecentPdf,
  setStatus,
} from "../../features/recent-files/public";
import {
  cancelPendingAutomaticTranslation,
  ensureTranslationHistoryLoaded,
  renderTranslationHistory,
  setMoreExamplesButtonVisible,
  setTranslationLearningTitle,
  setTranslationSelectionEditor,
  setTranslationState,
} from "../../features/translation/public";
import {
  cancelPendingSummaryGeneration,
  resetSummaryState,
} from "../../services/document-agent/viewer-document-agent";
import {
  cancelPendingCardGeneration,
  generatePaperOverviewCard,
  resetCardState,
  resetPaperCardPageState,
} from "../../features/paper-card/public";
import {
  cardAbortController,
  clearOutlineList,
  currentEnglishLearningResult,
  currentEnglishLearningSourceSentence,
  lastTranslatedText,
  lastViewerSelectionText,
  moreExamplesAbortController,
  readingModeDocumentKey,
  readingModeError,
  readingModePreference,
  readingModeRationale,
  renderDocumentOutline,
  resolvedReadingMode,
  selectedTextForAi,
  selectedTextPageNumber,
  summaryAbortController,
  translationAbortController,
  translationHistoryDocumentKey,
  translationHistoryEntries,
  updateControls,
} from "./reader-ui";
import {
  clearInternalNavigationHistory,
  clearPendingChatImages,
  getDocumentChatId,
  loadReadingModeForDocument,
  restoreChatConversation,
  updateReadingModeUi,
} from "../../features/assistant/public";
import {
  findBar,
  findCount,
  findInput,
  paperCardPageElement,
  textStatus,
  translationLearningHintElement,
  viewerContainer,
} from "../../app/viewer-elements";
import type { FileHandleLike } from "../../app/viewer-types";

export async function openPdf(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null = null,
  shouldConfirmUnsavedChanges = true,
) {
  if (
    shouldConfirmUnsavedChanges &&
    pdfDocument.value &&
    !confirmDiscardUnsavedChanges()
  )
    return;
  isOpeningDocument.value = true;
  cancelPendingAutomaticTranslation();
  cancelPendingSummaryGeneration();
  cancelPendingCardGeneration();
  translationAbortController.value?.abort();
  moreExamplesAbortController.value?.abort();
  summaryAbortController.value?.abort();
  cardAbortController.value?.abort();
  cancelReadingPositionSave();
  currentRecentEntryId.value = null;
  pendingReadingPosition.value = null;
  lastReadingPosition.value = null;
  isRestoringReadingPosition.value = false;
  clearInternalNavigationHistory();

  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = "正在建立文字层…";

  try {
    if (pdfDocument.value) {
      await pdfDocument.value.destroy();
      pdfDocument.value = null;
    }

    const rawPdfBytes =
      data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
    sourcePdfBytes.value = rawPdfBytes;
    const loadingTask = getDocument({
      data: new Uint8Array(rawPdfBytes),
      standardFontDataUrl: new URL(
        "pdfjs-standard-fonts/",
        window.location.href,
      ).href,
      useSystemFonts: true,
      useWorkerFetch: false,
    });
    const documentProxy = await loadingTask.promise;
    pdfDocument.value = documentProxy;
    sourceName.value = name;
    currentFileHandle.value = fileHandle;
    const displayName = getDisplayFileName(name);
    annotationEditor.value = null;
    activeEditorMode.value = AnnotationEditorType.NONE;
    canUndoAnnotation.value = false;
    canRedoAnnotation.value = false;
    nativeAnnotationNotes.clear();
    restoredHelperNotesBySignature.clear();
    restoredHelperNotesByStorageKey.clear();
    restoredAnnotationWarmUpPending.value = false;
    annotationEditorWarmUpInFlight.value = false;
    const restoredAnnotations = await restoreHelperAnnotations(documentProxy);
    restoredAnnotationWarmUpPending.value = restoredAnnotations > 0;
    const recentEntry = await rememberRecentPdf(
      name,
      fileHandle,
      fileHandle
        ? undefined
        : name.startsWith("http://") || name.startsWith("https://")
          ? name
          : undefined,
    );
    currentRecentEntryId.value = recentEntry?.id ?? null;
    pendingReadingPosition.value = recentEntry?.readingPosition ?? null;
    lastReadingPosition.value = recentEntry?.readingPosition ?? null;
    await executeMemoryTool({
      name: "library.recordOpen",
      arguments: {
        documentId: getDocumentChatId(documentProxy),
        fingerprint: getPdfFingerprint(documentProxy),
        title: displayName.replace(/\.pdf$/i, ""),
        pageCount: documentProxy.numPages,
        currentPage: 1,
        sourceName: name,
        recentEntryId: recentEntry?.id,
        sourceKind: recentEntry?.kind,
        sourceUrl: recentEntry?.url,
        sourceLocator:
          recentEntry?.kind === "local"
            ? `local-file-handle:${recentEntry.id}`
            : recentEntry?.url,
      },
    });

    pdfViewer.setDocument(documentProxy);
    linkService.setDocument(documentProxy);
    findController.setDocument(documentProxy);
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
    resetPaperCardPageState();
    void renderDocumentOutline(documentProxy);
    void loadReadingModeForDocument(documentProxy);
    if (!paperCardPageElement.hidden) void generatePaperOverviewCard();
    markSavedChanges();
    window.setTimeout(() => {
      if (pdfDocument.value !== documentProxy) return;
      markSavedChanges();
      isOpeningDocument.value = false;
      updateControls();
    }, 500);
    if (restoredAnnotations > 0) {
      setStatus(`已载入 PDF 内嵌 PDFPal 批注：${restoredAnnotations} 条。`);
    }
    updateControls();
  } catch (error) {
    isOpeningDocument.value = false;
    pdfDocument.value = null;
    currentFileHandle.value = null;
    currentRecentEntryId.value = null;
    pendingReadingPosition.value = null;
    lastReadingPosition.value = null;
    isRestoringReadingPosition.value = false;
    sourcePdfBytes.value = null;
    restoredAnnotationWarmUpPending.value = false;
    annotationEditorWarmUpInFlight.value = false;
    clearOutlineList("打开 PDF 后显示目录");
    readingModeDocumentKey.value = "";
    readingModePreference.value = "auto";
    resolvedReadingMode.value = "general";
    readingModeRationale.value = "";
    readingModeError.value = "";
    updateReadingModeUi();
    resetSummaryState();
    resetCardState();
    sourceName.value = "";
    resetPaperCardPageState();
    updateControls();
    setStatus(error instanceof Error ? error.message : String(error), true);
    textStatus.textContent = "PDF解析失败";
  }
}

export function getDisplayFileName(source: string): string {
  try {
    const pathname =
      source.startsWith("http://") || source.startsWith("https://")
        ? new URL(source).pathname
        : source;
    return (
      decodeURIComponent(pathname.split(/[\\/]/).pop() || source) ||
      "未命名.pdf"
    );
  } catch {
    return source.split(/[\\/]/).pop() || source;
  }
}

export async function openRemotePdf(url: string) {
  setStatus(`正在下载 ${url}…`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    await openPdf(await response.arrayBuffer(), url);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

export function runSearch(findPrevious: boolean, again: boolean) {
  const query = findInput.value.trim();
  if (!query || !pdfDocument.value) return;

  eventBus.dispatch("find", {
    source: window,
    type: again ? "again" : "",
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: true,
  });
}

export function openFindBar() {
  if (!pdfDocument.value) return;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}

export function closeFindBar() {
  findBar.hidden = true;
  findCount.textContent = "0/0";
  eventBus.dispatch("findbarclose", { source: window });
  viewerContainer.focus();
}

export async function saveAnnotatedPdf(): Promise<boolean> {
  if (!pdfDocument.value || isSavingAnnotatedPdf.value) return false;
  isSavingAnnotatedPdf.value = true;

  try {
    setStatus("正在把 PDFPal 批注嵌入 PDF…");
    const { bytes, count } = await embedHelperAnnotationsIntoPdf();
    const result = await writeEmbeddedPdfBytes(bytes);
    sourcePdfBytes.value = new Uint8Array(bytes);
    markSavedChanges();
    if (result === "overwritten") {
      setStatus(`批注已嵌入当前 PDF（${count} 条）。`);
    } else if (result === "permission-denied-downloaded") {
      setStatus(
        `未获得覆盖原文件的写入权限，已下载带 PDFPal 数据的新 PDF（${count} 条）。`,
      );
    } else {
      setStatus(
        `当前打开方式不能覆盖原文件，已下载带 PDFPal 数据的新 PDF（${count} 条）。`,
      );
    }
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    isSavingAnnotatedPdf.value = false;
  }
}
