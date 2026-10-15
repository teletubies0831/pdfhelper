import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Single source of truth for "PDF page -> raw text" extraction. Shared by the
 * Viewer's translation/summary flows and the selection page's PDF reader
 * diagnostics, so the PDF.js text-join loop is not duplicated per runtime.
 */
export async function extractPdfPageRawText(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => {
      if (!("str" in item) || typeof item.str !== "string") return "";
      return `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`;
    })
    .join("");
}
