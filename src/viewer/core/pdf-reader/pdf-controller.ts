import {
  AnnotationEditorType,
  getDocument,
  type PDFDocumentProxy,
  VerbosityLevel,
} from "pdfjs-dist";

import {
  activeEditorMode,
  annotationEditor,
  annotationEditorWarmUpInFlight,
  canRedoAnnotation,
  canUndoAnnotation,
  currentFileHandle,
  eventBus,
  findController,
  linkService,
  nativeAnnotationNotes,
  pdfDocument,
  pdfViewer,
  restoredAnnotationWarmUpPending,
  restoredHighlightTextBySignature,
  restoredHighlightTextByStorageKey,
  restoredHelperNotesBySignature,
  restoredHelperNotesByStorageKey,
  sourceName,
  sourcePdfBytes,
} from "../../app/viewer-state";
import {
  findBar,
  findCount,
  findInput,
  viewerContainer,
} from "../../app/viewer-elements";
import type { FileHandleLike } from "../../app/viewer-types";
import { buildPdfAssetOptions } from "./pdf-asset-options";

/**
 * Installs an already-parsed document into the viewer-state runtime and resets
 * the annotation runtime state. Used both by first-open and by document-tab
 * re-activation (which re-attaches a kept-alive proxy).
 */
export function installPdfDocument(
  documentProxy: PDFDocumentProxy,
  name: string,
  fileHandle: FileHandleLike | null,
  bytes: Uint8Array,
): void {
  pdfDocument.value = documentProxy;
  sourceName.value = name;
  currentFileHandle.value = fileHandle;
  sourcePdfBytes.value = bytes;
  const displayName = getDisplayFileName(name);
  document.title = `${displayName} · PDFPal`;
  annotationEditor.value = null;
  activeEditorMode.value = AnnotationEditorType.NONE;
  canUndoAnnotation.value = false;
  canRedoAnnotation.value = false;
  nativeAnnotationNotes.clear();
  restoredHighlightTextBySignature.clear();
  restoredHighlightTextByStorageKey.clear();
  restoredHelperNotesBySignature.clear();
  restoredHelperNotesByStorageKey.clear();
  restoredAnnotationWarmUpPending.value = false;
  annotationEditorWarmUpInFlight.value = false;
}

/**
 * Parses PDF bytes and installs the resulting document into the viewer-state
 * runtime. The previously attached document is intentionally NOT destroyed:
 * the document-tab layer keeps other tabs' proxies alive for fast switching
 * and destroys them explicitly via destroyPdfDocument when a tab closes.
 */
export async function parsePdfIntoViewer(
  data: ArrayBuffer | Uint8Array,
  name: string,
  fileHandle: FileHandleLike | null,
): Promise<PDFDocumentProxy> {
  const rawPdfBytes =
    data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  const loadingTask = getDocument({
    data: new Uint8Array(rawPdfBytes),
    // Many third-party PDF editors store annotation /DA operators as
    // UTF-16 strings. PDF.js can recover and render them, but reports every
    // NUL/BOM byte as a parser warning. Keep recoverable source-file noise
    // out of the production console; loading failures still reject the task
    // and are surfaced by the caller's catch path.
    verbosity: VerbosityLevel.ERRORS,
    // Decoder and CMap assets. Omitting them does not fail the load: it silently
    // produces blank scanned pages and broken CJK text. See pdf-asset-options.ts.
    ...buildPdfAssetOptions(),
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const documentProxy = await loadingTask.promise;
  installPdfDocument(documentProxy, name, fileHandle, rawPdfBytes);
  return documentProxy;
}

/**
 * Destroys a kept-alive document proxy when its tab closes. Safe to call with
 * a proxy that failed to load or was never attached.
 */
export async function destroyPdfDocument(
  documentProxy: PDFDocumentProxy | null,
): Promise<void> {
  if (!documentProxy) return;
  try {
    await documentProxy.destroy();
  } catch (error) {
    // Destroying an already-destroyed or failed proxy is a no-op.
    if (!(error instanceof Error) || !/destroy/i.test(error.message)) {
      console.warn("PDFPal failed to destroy a document proxy.", error);
    }
  }
}

/** Attaches an already-parsed document to the PDF.js viewer/link/find services. */
export function attachPdfToViewer(documentProxy: PDFDocumentProxy): void {
  pdfViewer.setDocument(documentProxy);
  linkService.setDocument(documentProxy);
  findController.setDocument(documentProxy);
}

/** Detaches the current document from the viewer (empty workspace state). */
export function detachPdfFromViewer(): void {
  pdfViewer.setDocument(null as unknown as PDFDocumentProxy);
  linkService.setDocument(null as unknown as PDFDocumentProxy);
  findController.setDocument(null as unknown as PDFDocumentProxy);
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
