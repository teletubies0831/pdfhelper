import type { PDFDocumentProxy } from "pdfjs-dist";

import { createDocumentAgentId } from "../../modules/document-agent/public";
import { pdfDocument, sourceName } from "./viewer-state";

/**
 * Document identity helpers shared by the assistant, knowledge, paper-card and
 * annotations features. Lives in the app assembly layer so features can share
 * one definition instead of importing each other.
 */
export function getPdfFingerprint(
  documentProxy: PDFDocumentProxy | null = pdfDocument.value,
): string {
  return (
    documentProxy?.fingerprints?.find((fingerprint): fingerprint is string =>
      Boolean(fingerprint),
    ) || ""
  );
}

export function getDocumentChatId(documentProxy: PDFDocumentProxy): string {
  return createDocumentAgentId(
    getPdfFingerprint(documentProxy),
    sourceName.value,
    documentProxy.numPages,
  );
}
