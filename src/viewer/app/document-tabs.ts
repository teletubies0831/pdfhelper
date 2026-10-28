import {
  attachPdfToViewer,
  clearOutlineList,
  destroyPdfDocument,
  detachPdfFromViewer,
  getDisplayFileName,
  installPdfDocument,
  parsePdfIntoViewer,
  renderDocumentOutline,
  updateControls,
} from "../core/pdf-reader/public";
import { executeMemoryTool } from "../../modules/memory/public";
import {
  annotationEditorWarmUpInFlight,
  currentFileHandle,
  currentRecentEntryId,
  documentKnowledgeCache,
  documentKnowledgeTasks,
  hasUnsavedChanges,
  internalNavigationHistory,
  isOpeningDocument,
  isRestoringReadingPosition,
  lastReadingPosition,
  pdfDocument,
  pendingReadingPosition,
  restoredAnnotationWarmUpPending,
  savedAnnotationSnapshot,
  sourceName,
  sourcePdfBytes,
} from "./viewer-state";
import {
  confirmDiscardTabChanges,
  confirmDiscardUnsavedChanges,
  getSerializableAnnotationEntries,
  markSavedChanges,
  restoreAnnotationSaveState,
  restoreHelperAnnotations,
} from "../features/annotations/public";
import {
  cancelReadingPositionSave,
  getCurrentReadingPosition,
  persistCurrentReadingPosition,
  rememberRecentPdf,
} from "../features/recent-files/public";
import { resetSummaryState } from "../features/translation/public";
import { resetCardState } from "../features/paper-card/public";
import {
  ensureKnowledgeIndexForOpenDocument,
  syncCurrentPdfLibraryButton,
} from "../features/knowledge-base/public";
import { updateCitationReturnButton } from "../features/assistant/public";
import { setStatus } from "./status-bar";
import { getDocumentChatId, getPdfFingerprint } from "./document-identity";
import {
  runAfterDocumentOpenResets,
  runBeforeDocumentSwitchResets,
} from "./document-switch-hooks";
import {
  createDocumentTabId,
  documentTabLabel,
  findDocumentTab,
  findDocumentTabByFingerprint,
  planTabClose,
  planTabCloseGuard,
  type DocumentTab,
} from "./document-tabs-model";
import { documentTabsBar, documentTabsList, textStatus } from "./viewer-elements";
import type { FileHandleLike } from "./viewer-types";

const tabs: DocumentTab[] = [];
let activeTabId: string | null = null;
let isSwitchingTabs = false;

export function getDocumentTabs(): readonly DocumentTab[] {
  return tabs;
}

export function getActiveDocumentTab(): DocumentTab | null {
  return activeTabId ? findDocumentTab(tabs, activeTabId) : null;
}

function clearInternalNavigationHistory(): void {
  internalNavigationHistory.length = 0;
  updateCitationReturnButton();
}

/**
 * Persists the active tab's runtime state (reading position, unsaved flag,
 * latest annotated bytes) into its tab record before the viewer is pointed at
 * another document.
 */
function snapshotActiveTab(): void {
  const tab = getActiveDocumentTab();
  if (!tab || !pdfDocument.value) return;
  tab.readingPosition = getCurrentReadingPosition();
  tab.hasUnsavedChanges = hasUnsavedChanges.value;
  tab.savedSnapshot = savedAnnotationSnapshot.value;
  tab.bytes = sourcePdfBytes.value ?? tab.bytes;
  cancelReadingPositionSave();
  void persistCurrentReadingPosition();
}

function prepareDocumentSwitch(): void {
  isOpeningDocument.value = true;
  runBeforeDocumentSwitchResets();
  cancelReadingPositionSave();
  currentRecentEntryId.value = null;
  pendingReadingPosition.value = null;
  lastReadingPosition.value = null;
  isRestoringReadingPosition.value = false;
  clearInternalNavigationHistory();
}

export interface OpenPdfInTabOptions {
  url?: string;
}

/**
 * Opens a PDF in a new tab (or activates the existing tab for the same
 * document). The previously active document stays alive in its own tab.
 */
export async function openPdfInTab(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null = null,
  options: OpenPdfInTabOptions = {},
): Promise<DocumentTab | null> {
  // Opening a different document never disturbs the active tab, so there is
  // no unsaved-changes prompt here. Re-opening an already-open document
  // re-activates its tab instead, and *that* path prompts when the active
  // tab has unsaved work.
  snapshotActiveTab();
  prepareDocumentSwitch();
  setStatus(`正在解析 ${name}…`);
  textStatus.textContent = "正在建立文字层…";

  try {
    const documentProxy = await parsePdfIntoViewer(data, name, fileHandle);
    const fingerprint = getPdfFingerprint(documentProxy);
    const existing = findDocumentTabByFingerprint(tabs, fingerprint);
    if (existing?.documentProxy) {
      await destroyPdfDocument(documentProxy);
      isOpeningDocument.value = false;
      if (existing.id === activeTabId) {
        // Re-opening the document that is already on screen. Parsing installed the duplicate proxy as the live
        // document (`parsePdfIntoViewer` → `installPdfDocument`), so simply activating the tab would return early and
        // leave the viewer holding the destroyed duplicate: its annotation storage is empty, which made the next save
        // write an empty pdfhelper payload over the real one. Put the tab's own, still-alive proxy back instead.
        installPdfDocument(existing.documentProxy, existing.name, existing.fileHandle, existing.bytes);
        currentRecentEntryId.value = existing.recentEntryId;
        // Its baseline is unchanged, so restore it instead of stamping the current state as saved.
        restoreAnnotationSaveState(existing.savedSnapshot, existing.hasUnsavedChanges);
        syncCurrentPdfLibraryButton();
        return existing;
      }
      await activateDocumentTab(existing.id);
      return existing;
    }

    const documentId = getDocumentChatId(documentProxy);
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
    await executeMemoryTool({
      name: "library.recordOpen",
      arguments: {
        documentId,
        fingerprint,
        title: getDisplayFileName(name).replace(/\.pdf$/i, ""),
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

    const tab: DocumentTab = {
      id: createDocumentTabId(),
      name,
      bytes: new Uint8Array(sourcePdfBytes.value ?? new Uint8Array(data)),
      fileHandle,
      url: options.url,
      documentProxy,
      documentId,
      fingerprint,
      recentEntryId: recentEntry?.id ?? null,
      readingPosition: recentEntry?.readingPosition ?? null,
      hasUnsavedChanges: false,
      savedSnapshot: "",
    };
    tabs.push(tab);
    activeTabId = tab.id;
    currentRecentEntryId.value = tab.recentEntryId;
    pendingReadingPosition.value = tab.readingPosition;
    lastReadingPosition.value = tab.readingPosition;

    attachPdfToViewer(documentProxy);
    await runAfterDocumentOpenResets(documentProxy);
    void renderDocumentOutline(documentProxy);
    syncCurrentPdfLibraryButton();
    // A2: if this document is in the library and its full-text index has gone missing, rebuild it in the background. The
    // decision, the once-per-session guard and the "no model call" rule all live in that module.
    void ensureKnowledgeIndexForOpenDocument();
    markSavedChanges();
    tab.savedSnapshot = savedAnnotationSnapshot.value;
    window.setTimeout(() => {
      if (pdfDocument.value !== documentProxy) return;
      // Settling after the annotation editor warms up: only re-baseline while nothing is unsaved, otherwise a real edit
      // made in this window would be swallowed as "already in the file".
      if (!hasUnsavedChanges.value) {
        markSavedChanges();
        tab.savedSnapshot = savedAnnotationSnapshot.value;
      }
      isOpeningDocument.value = false;
      updateControls();
    }, 500);
    if (restoredAnnotations > 0) {
      setStatus(`已载入 PDF 内嵌 PDFPal 批注：${restoredAnnotations} 条。`);
    }
    updateControls();
    renderDocumentTabs();
    return tab;
  } catch (error) {
    isOpeningDocument.value = false;
    const message = error instanceof Error ? error.message : String(error);
    if (tabs.length > 0 && activeTabId) {
      // A later tab failed to open; the previously active document is still
      // attached, just reset the busy state.
      updateControls();
      setStatus(`打开失败：${message}`, true);
      return null;
    }
    // First-document failure: fall back to the empty workspace state.
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
    resetSummaryState();
    resetCardState();
    sourceName.value = "";
    document.title = "PDFPal 阅读器";
    syncCurrentPdfLibraryButton();
    updateControls();
    setStatus(message, true);
    textStatus.textContent = "PDF解析失败";
    return null;
  }
}

export interface ActivateTabOptions {
  skipUnsavedConfirm?: boolean;
}

/**
 * Switches the viewer to an already-open tab, restoring its reading position,
 * annotations and per-document conversation.
 */
export async function activateDocumentTab(
  tabId: string,
  options: ActivateTabOptions = {},
): Promise<boolean> {
  if (isSwitchingTabs) return false;
  const target = findDocumentTab(tabs, tabId);
  if (!target || !target.documentProxy) return false;
  if (tabId === activeTabId && pdfDocument.value) return true;
  if (!options.skipUnsavedConfirm && pdfDocument.value && !confirmDiscardUnsavedChanges()) {
    return false;
  }

  isSwitchingTabs = true;
  try {
    snapshotActiveTab();
    prepareDocumentSwitch();
    installPdfDocument(target.documentProxy, target.name, target.fileHandle, target.bytes);
    currentRecentEntryId.value = target.recentEntryId;
    pendingReadingPosition.value = target.readingPosition;
    lastReadingPosition.value = target.readingPosition;

    // A tab keeps its proxy — and with it its annotation storage — alive while another tab is shown, so re-running the
    // restore here would overwrite unsaved edits with the last version written into the file. Only restore when the
    // storage is empty (a first activation whose open-time restore was interrupted).
    const alreadyHasAnnotations = getSerializableAnnotationEntries().length > 0;
    const restoredAnnotations = alreadyHasAnnotations
      ? 0
      : await restoreHelperAnnotations(target.documentProxy);
    restoredAnnotationWarmUpPending.value = restoredAnnotations > 0;
    activeTabId = tabId;

    attachPdfToViewer(target.documentProxy);
    await runAfterDocumentOpenResets(target.documentProxy);
    void renderDocumentOutline(target.documentProxy);
    syncCurrentPdfLibraryButton();
    // This tab's own baseline, not "whatever is on screen is saved": an edit made before the switch has to come back
    // still unsaved, or its marker disappears and closing the tab stops asking.
    restoreAnnotationSaveState(target.savedSnapshot, target.hasUnsavedChanges);
    updateControls();
    isOpeningDocument.value = false;
    const displayName = getDisplayFileName(target.name);
    setStatus(
      restoredAnnotations > 0
        ? `已切换到 ${displayName}，载入内嵌批注 ${restoredAnnotations} 条。`
        : `已切换到 ${displayName}。`,
    );
    renderDocumentTabs();
    return true;
  } catch (error) {
    isOpeningDocument.value = false;
    setStatus(
      `切换失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return false;
  } finally {
    isSwitchingTabs = false;
  }
}

/**
 * Closes a tab.
 *
 * **Both** cases confirm: the active tab through the live `hasUnsavedChanges` flag, a background tab through its snapshotted
 * one. Background tabs absolutely can carry unsaved work — switching away runs `snapshotActiveTab()`, which copies the flag and
 * the annotation state into the tab instead of saving or resolving it — so closing one used to throw that work away silently.
 *
 * Closing a background tab removes it and re-renders — and deliberately does **not** activate anything: the reader keeps showing
 * the document it was showing. Activating the neighbour there made a background close silently switch the visible PDF, which
 * reads as "the × button does something else than close".
 */
export async function closeDocumentTab(tabId: string): Promise<void> {
  const target = findDocumentTab(tabs, tabId);
  if (!target) return;
  const isActive = tabId === activeTabId;
  const guard = planTabCloseGuard({
    isActive,
    hasActiveDocument: Boolean(pdfDocument.value),
    tabHasUnsavedChanges: target.hasUnsavedChanges,
  });
  if (guard === "active" && !confirmDiscardUnsavedChanges()) return;
  if (guard === "background" && !confirmDiscardTabChanges(target.name, true)) return;
  if (isActive) snapshotActiveTab();

  const plan = planTabClose(tabs, tabId, activeTabId);
  tabs.splice(0, tabs.length, ...plan.remainingTabs);
  if (plan.closedActiveTab) activeTabId = null;

  documentKnowledgeCache.delete(target.documentId);
  documentKnowledgeTasks.delete(target.documentId);
  await destroyPdfDocument(target.documentProxy);

  if (plan.nextActiveTabId) {
    await activateDocumentTab(plan.nextActiveTabId, { skipUnsavedConfirm: true });
    return;
  }
  if (plan.shouldClearWorkspace) {
    await clearDocumentWorkspace();
    return;
  }
  // Background close: nothing else to tear down, just show the shorter strip.
  renderDocumentTabs();
  updateControls();
}

async function clearDocumentWorkspace(): Promise<void> {
  prepareDocumentSwitch();
  detachPdfFromViewer();
  pdfDocument.value = null;
  sourceName.value = "";
  sourcePdfBytes.value = null;
  currentFileHandle.value = null;
  currentRecentEntryId.value = null;
  pendingReadingPosition.value = null;
  lastReadingPosition.value = null;
  isRestoringReadingPosition.value = false;
  restoredAnnotationWarmUpPending.value = false;
  annotationEditorWarmUpInFlight.value = false;
  clearOutlineList("打开 PDF 后显示目录");
  resetSummaryState();
  resetCardState();
  document.title = "PDFPal 阅读器";
  syncCurrentPdfLibraryButton();
  updateControls();
  setStatus("请选择PDF文件。");
  textStatus.textContent = "文字层尚未加载";
  isOpeningDocument.value = false;
  activeTabId = null;
  renderDocumentTabs();
}

function createTabElement(tab: DocumentTab): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "document-tab";
  wrap.dataset.tabId = tab.id;
  if (tab.id === activeTabId) {
    wrap.classList.add("active");
    wrap.setAttribute("aria-selected", "true");
  } else {
    wrap.setAttribute("aria-selected", "false");
  }

  const activate = document.createElement("button");
  activate.type = "button";
  activate.className = "document-tab-activate";
  activate.title = tab.name;
  activate.setAttribute("role", "tab");
  const label = document.createElement("span");
  label.className = "document-tab-label";
  label.textContent = documentTabLabel(tab);
  if (tab.hasUnsavedChanges) label.textContent += " ●";
  activate.append(label);
  activate.addEventListener("click", () => {
    void activateDocumentTab(tab.id);
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "document-tab-close";
  close.title = `关闭“${tab.name}”`;
  close.setAttribute("aria-label", `关闭“${tab.name}”`);
  close.textContent = "×";
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    void closeDocumentTab(tab.id);
  });

  // Middle-click closes, matching every tabbed browser. Without it the only way to
  // close a tab is the small × — which is the interaction users reported as
  // "I can't close the earlier document".
  wrap.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    void closeDocumentTab(tab.id);
  });

  wrap.append(activate, close);
  return wrap;
}

export function renderDocumentTabs(): void {
  documentTabsList.replaceChildren(...tabs.map(createTabElement));
  documentTabsBar.hidden = tabs.length === 0;
  // With a full strip of tabs the active one can be scrolled out of view; keep the
  // document being read reachable without hunting along the strip.
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) return;
  const element = documentTabsList.querySelector<HTMLElement>(
    `[data-tab-id="${activeTab.id}"]`,
  );
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
