import { type PDFDocumentProxy } from "pdfjs-dist";

import { MAX_PAPER_CARD_SOURCE_LENGTH, paperCardPageSourceCache } from "../../core/pdf-reader/public";

import { pdfDocument } from "../../app/viewer-state";
import { extractPageText } from "../translation/public";






export function getPaperOverviewPageNumbers(totalPages: number): number[] {
  if (totalPages <= 18) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pageNumbers = new Set<number>();
  for (let page = 1; page <= Math.min(6, totalPages); page += 1)
    pageNumbers.add(page);
  for (let page = Math.max(1, totalPages - 4); page <= totalPages; page += 1)
    pageNumbers.add(page);

  const middleStart = 7;
  const middleEnd = Math.max(middleStart, totalPages - 5);
  const middleSamples = 7;
  for (let index = 0; index < middleSamples; index += 1) {
    const ratio = index / (middleSamples - 1);
    pageNumbers.add(
      Math.round(middleStart + (middleEnd - middleStart) * ratio),
    );
  }

  return Array.from(pageNumbers)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((left, right) => left - right);
}

export async function extractPaperOverviewText(
  documentProxy: PDFDocumentProxy,
): Promise<string> {
  if (paperCardPageSourceCache.value?.document === documentProxy) {
    return paperCardPageSourceCache.value.text;
  }

  const pageNumbers = getPaperOverviewPageNumbers(documentProxy.numPages);
  const chunks: string[] = [];
  let currentLength = 0;

  for (const pageNumber of pageNumbers) {
    if (pdfDocument.value !== documentProxy)
      throw new Error("PDF 已切换，请重新生成论文卡片。");
    const pageText = await extractPageText(documentProxy, pageNumber);
    if (!pageText) continue;

    const pageHeader = `\n\n[第 ${pageNumber} 页]\n`;
    const remainingLength =
      MAX_PAPER_CARD_SOURCE_LENGTH - currentLength - pageHeader.length;
    if (remainingLength <= 0) break;

    const clippedText = pageText.slice(0, remainingLength);
    chunks.push(`${pageHeader}${clippedText}`);
    currentLength += pageHeader.length + clippedText.length;
  }

  const text = chunks.join("").trim();
  if (!text) throw new Error("当前 PDF 没有可读取的文字内容。");
  paperCardPageSourceCache.value = { document: documentProxy, text };
  return text;
}
