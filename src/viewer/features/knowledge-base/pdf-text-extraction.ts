/**
 * PDF 文本抽取的小工具。
 *
 * Two callers need "the first page or two as plain text": the indexing pass (which extracts every page anyway) and the
 * metadata extraction (which only wants the head). Kept here so the page-1 read does not get rewritten a second time
 * with slightly different whitespace rules — the head text is fed to a model, and the same document should produce the
 * same prompt on both paths.
 */

/** Joins pdf.js text items into lines, the same way the indexer and the reader's copy action do. */
export function extractTextItems(items: unknown[]): string {
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || !("str" in item)) return "";
      const textItem = item as { str?: unknown; hasEOL?: unknown };
      const text = typeof textItem.str === "string" ? textItem.str : "";
      return textItem.hasEOL ? `${text}\n` : `${text} `;
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The metadata prompt's input ceiling; also what keeps one odd first page from inflating a cheap call. */
export const METADATA_TEXT_LIMIT = 6_000;

/**
 * Reads the first pages of an already-loaded PDF as text.
 *
 * Page 1 alone misses the author line on many two-column papers (it sits under a logo or after the abstract), so two
 * pages are read and then truncated — the model reads a prompt, not a document.
 */
export async function readPdfHeadText(
  documentProxy: { numPages: number; getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> },
  maxPages = 2,
): Promise<string> {
  const pages = Math.max(1, Math.min(maxPages, documentProxy.numPages || 1));
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(extractTextItems(content.items));
    if (parts.join("\n\n").length >= METADATA_TEXT_LIMIT) break;
  }
  return parts.join("\n\n").slice(0, METADATA_TEXT_LIMIT);
}
