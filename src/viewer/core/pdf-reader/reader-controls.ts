import { type PDFDocumentProxy } from "pdfjs-dist";
















import { canRedoAnnotation, canUndoAnnotation, pdfDocument, pdfViewer } from "../../app/viewer-state";
import { appFrame, cardTypeButtons, copyCardButton, copySummaryButton, editorModeButtons, findInput, findNextButton, findPreviousButton, focusModeButton, focusModeLabel, freeTextColorInput, freeTextSizeDownButton, freeTextSizeInput, freeTextSizeUpButton, nextButton, outlineList, outlineToggleButton, pageCountElement, pageNumberInput, previousButton, redoAnnotationButton, saveAnnotatedPdfButton, saveCardButton, saveSummaryNoteButton, smartCopyButton, summaryScopeButtons, toggleNotesButton, undoAnnotationButton, viewerElement, zoomInButton, zoomOutButton, zoomValueElement } from "../../app/viewer-elements";
import { navigateToDestinationWithoutReturnHistory } from "../../features/assistant/public";
import { getSelectionSurroundingText, updateSummaryMetadata, type SelectionSurroundingText } from "../../features/translation/public";









export function updateControls() {
  const hasDocument = pdfDocument.value !== null;
  const page = hasDocument ? pdfViewer.currentPageNumber : 0;
  const pages = pdfDocument.value?.numPages ?? 0;
  const scale = hasDocument ? pdfViewer.currentScale : 1;

  pageNumberInput.value = String(page);
  pageNumberInput.max = String(Math.max(1, pages));
  pageCountElement.textContent = String(pages);
  zoomValueElement.textContent = `${Math.round(scale * 100)}%`;

  for (const control of [
    previousButton,
    nextButton,
    pageNumberInput,
    zoomOutButton,
    zoomInButton,
    findInput,
    findPreviousButton,
    findNextButton,
    smartCopyButton,
    saveAnnotatedPdfButton,
    toggleNotesButton,
    copySummaryButton,
    saveSummaryNoteButton,
    copyCardButton,
    saveCardButton,
    ...summaryScopeButtons,
    ...cardTypeButtons,
    freeTextSizeInput,
    freeTextColorInput,
    freeTextSizeDownButton,
    freeTextSizeUpButton,
    ...editorModeButtons,
  ]) {
    control.disabled = !hasDocument;
  }

  previousButton.disabled = !hasDocument || page <= 1;
  nextButton.disabled = !hasDocument || page >= pages;
  undoAnnotationButton.disabled = !hasDocument || !canUndoAnnotation.value;
  redoAnnotationButton.disabled = !hasDocument || !canRedoAnnotation.value;
  updateOutlineActivePage();
}



export function setLeftPanelCollapsed(collapsed: boolean) {
  appFrame?.classList.toggle("left-panel-collapsed", collapsed);
  outlineToggleButton?.classList.toggle("active", !collapsed);
}



export function setFocusMode(enabled: boolean): void {
  if (!appFrame) return;

  appFrame.classList.toggle("focus-mode", enabled);
  const isEnabled = appFrame.classList.contains("focus-mode");
  focusModeButton.classList.toggle("active", isEnabled);
  focusModeButton.setAttribute("aria-pressed", String(isEnabled));
  focusModeButton.title = isEnabled
    ? "恢复顶部工具栏"
    : "隐藏顶部工具栏，专注阅读 PDF";
  focusModeLabel.textContent = isEnabled ? "退出专注" : "专注模式";
}



export function updateOutlineActivePage() {
  if (!outlineList) return;
  const currentPage = String(pdfViewer.currentPageNumber || "");
  for (const button of Array.from(
    outlineList.querySelectorAll<HTMLButtonElement>("button"),
  )) {
    button.classList.toggle(
      "active",
      button.dataset.outlinePage === currentPage,
    );
  }
}



export function clearOutlineList(message: string) {
  if (!outlineList) return;
  outlineList.textContent = "";
  const placeholder = document.createElement("div");
  placeholder.className = "outline-empty";
  placeholder.textContent = message;
  outlineList.appendChild(placeholder);
}



export async function getDestinationPageNumber(
  documentProxy: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    const explicitDest =
      typeof dest === "string"
        ? await documentProxy.getDestination(dest)
        : await dest;
    if (!Array.isArray(explicitDest)) return null;

    const [destRef] = explicitDest;
    if (destRef && typeof destRef === "object") {
      const cachedPageNumber = (documentProxy as any).cachedPageNumber?.(
        destRef,
      );
      if (Number.isInteger(cachedPageNumber)) return cachedPageNumber;
      return (await documentProxy.getPageIndex(destRef)) + 1;
    }

    if (Number.isInteger(destRef)) return (destRef as number) + 1;
  } catch {
    return null;
  }

  return null;
}



export function appendOutlineButton({
  label,
  depth,
  pageNumber,
  onClick,
}: {
  label: string;
  depth: number;
  pageNumber?: number;
  onClick: () => void;
}) {
  if (!outlineList) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.paddingLeft = `${12 + depth * 18}px`;
  if (pageNumber) button.dataset.outlinePage = String(pageNumber);
  button.addEventListener("click", onClick);
  outlineList.appendChild(button);
}



export async function renderOutlineItems(
  documentProxy: PDFDocumentProxy,
  items: Array<{ title?: string; dest?: unknown; items?: unknown[] }>,
  depth = 0,
) {
  for (const item of items) {
    const title = item.title?.trim() || "未命名目录项";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.style.paddingLeft = `${12 + depth * 18}px`;
    button.addEventListener("click", () => {
      if (item.dest) void navigateToDestinationWithoutReturnHistory(item.dest);
    });
    outlineList?.appendChild(button);

    if (item.dest) {
      void getDestinationPageNumber(documentProxy, item.dest).then(
        (pageNumber) => {
          if (!pageNumber || pdfDocument.value !== documentProxy) return;
          button.dataset.outlinePage = String(pageNumber);
          updateOutlineActivePage();
          updateSummaryMetadata();
        },
      );
    }

    if (Array.isArray(item.items) && item.items.length > 0) {
      await renderOutlineItems(documentProxy, item.items as any, depth + 1);
    }
  }
}



export async function renderDocumentOutline(documentProxy: PDFDocumentProxy) {
  if (!outlineList) return;
  outlineList.textContent = "";

  try {
    const outline = (await documentProxy.getOutline()) as Array<{
      title?: string;
      dest?: unknown;
      items?: unknown[];
    }> | null;
    if (pdfDocument.value !== documentProxy) return;

    if (outline && outline.length > 0) {
      await renderOutlineItems(documentProxy, outline);
      updateOutlineActivePage();
      updateSummaryMetadata();
      return;
    }
  } catch (error) {
    console.warn("PDF Helper outline load failed.", error);
  }

  if (pdfDocument.value !== documentProxy) return;
  outlineList.textContent = "";
  const pageCount = documentProxy.numPages;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    appendOutlineButton({
      label: `第 ${pageNumber} 页`,
      depth: 0,
      pageNumber,
      onClick: () => {
        pdfViewer.currentPageNumber = pageNumber;
      },
    });
  }
  updateOutlineActivePage();
  updateSummaryMetadata();
}



export function normalizeCopiedText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, "$1$2")
    .replace(/[\t ]+\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/\s*\n\s*/g, " ")
        .replace(/[\t ]{2,}/g, " ")
        .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}



export function trimSelectionBoundaryWhitespace(text: string): string {
  // PDF.js text layers commonly place whitespace in separate boundary nodes.
  // Keep the user's meaningful internal spacing/line breaks, while making a
  // word or sentence selection behave identically in the UI and on Ctrl+C.
  return text.replace(/^\s+|\s+$/gu, "");
}



export function getViewerSelectionRawText(
  surroundingText?: SelectionSurroundingText,
): string {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !viewerElement.contains(selection.anchorNode)
  ) {
    return "";
  }
  const reconstructed = (surroundingText ?? getSelectionSurroundingText()).selected;
  return trimSelectionBoundaryWhitespace(reconstructed || selection.toString());
}



export function getViewerSelectionText(
  surroundingText?: SelectionSurroundingText,
): string {
  return normalizeCopiedText(getViewerSelectionRawText(surroundingText));
}



export const AUTO_TRANSLATE_DELAY_MS = 700;


export const MAX_SUMMARY_SOURCE_LENGTH = 18_000;


export const MAX_CARD_SOURCE_LENGTH = 18_000;


export const MAX_PAPER_CARD_SOURCE_LENGTH = 55_000;


export const SUMMARY_NOTES_STORAGE_KEY = "pdf-helper-summary-notes-v1";


export const SAVED_CARDS_STORAGE_KEY = "pdf-helper-saved-cards-v1";


export const SAVED_PAPER_OVERVIEWS_STORAGE_KEY = "pdf-helper-paper-overviews-v1";


export const KNOWLEDGE_NOTES_STORAGE_KEY = "pdf-helper-knowledge-notes-v1";


export const KNOWLEDGE_ITEM_META_STORAGE_KEY = "pdf-helper-knowledge-item-meta-v1";


export const PAPER_CARD_INLINE_DRAFT_STORAGE_KEY = "pdf-helper-paper-inline-drafts-v2";


export const READING_JOURNAL_STORAGE_KEY = "pdf-helper-reading-journal-v1";



export type SummaryScope = "selection" | "page" | "chapter";


export type CardType = "concept" | "method" | "experiment" | "viewpoint";


export type KnowledgeKind = "note" | "reading-card" | "paper-card";


export type KnowledgeFilter = "all" | KnowledgeKind;


export type KnowledgeSource =
  | "knowledge-note"
  | "reading-journal"
  | "summary-note"
  | "reading-card"
  | "paper-overview";


export type KnowledgePageMode = "library" | "qa" | "insights";


export type KnowledgeFocus =
  | "all"
  | "todo"
  | "deep"
  | "finished"
  | "citable"
  | "replicate"
  | "related"
  | "methods";
