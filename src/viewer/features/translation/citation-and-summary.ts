import { type PDFDocumentProxy } from "pdfjs-dist";
















import { mergeSelectionRects } from "../../shared-ui/geometry/merge-selection-rects";
import { citationReturnButton, citationReturnPosition, outlineList, summaryPositionElement, summaryRangeElement, summaryResultElement, summarySourceElement, viewerElement } from "../../app/viewer-elements";
import { activeSummaryScope, lastSummaryPoints, navigateToPdfPageWhenVisible, normalizeCopiedText } from "../../core/pdf-reader/public";
import { createPdfCitationPattern } from "../../shared-ui/markdown/markdown-renderer";

import { pdfDocument, pdfViewer } from "../../app/viewer-state";





import type { SummaryContext, SummaryScope } from "../../core/pdf-reader/public";
import { preserveReadingPositionForSourceNavigation } from "../recent-files/public";




export function setSummaryState(
  message: string,
  isError = false,
  clearPoints = true,
): void {
  if (clearPoints) lastSummaryPoints.value = [];
  summaryResultElement.textContent = message;
  summaryResultElement.classList.toggle("error", isError);
}



export function renderSummaryPoints(points: string[]): void {
  const list = document.createElement("ul");

  for (const point of points) {
    const item = document.createElement("li");
    item.textContent = point;
    list.append(item);
  }

  lastSummaryPoints.value = points;
  summaryResultElement.replaceChildren(list);
  summaryResultElement.classList.remove("error");
}



export function getOutlinePageItems(): Array<{ pageNumber: number; title: string }> {
  if (!outlineList) return [];

  return Array.from(
    outlineList.querySelectorAll<HTMLButtonElement>(
      "button[data-outline-page]",
    ),
  )
    .map((button) => ({
      pageNumber: Number(button.dataset.outlinePage),
      title: button.textContent?.trim() || "未命名章节",
    }))
    .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}



export function getCurrentChapterContext(pageNumber: number): {
  title: string;
  startPage: number;
  endPage: number;
} {
  const items = getOutlinePageItems();
  let currentItem: { pageNumber: number; title: string } | null = null;

  for (const item of items) {
    if (item.pageNumber > pageNumber) break;
    currentItem = item;
  }

  if (!currentItem) {
    return {
      title: `第 ${pageNumber} 页`,
      startPage: pageNumber,
      endPage: pageNumber,
    };
  }

  const nextItem = items.find(
    (item) => item.pageNumber > currentItem.pageNumber,
  );
  return {
    title: currentItem.title,
    startPage: currentItem.pageNumber,
    endPage: Math.max(
      currentItem.pageNumber,
      Math.min(
        pdfDocument.value?.numPages ?? pageNumber,
        (nextItem?.pageNumber ?? (pdfDocument.value?.numPages ?? pageNumber) + 1) - 1,
      ),
    ),
  };
}



export function getSummaryLabels(scope: SummaryScope): Omit<SummaryContext, "text"> {
  const pageNumber = pdfDocument.value
    ? Math.max(1, pdfViewer.currentPageNumber || 1)
    : 0;
  const chapter =
    pageNumber > 0
      ? getCurrentChapterContext(pageNumber)
      : { title: "未定位", startPage: 0, endPage: 0 };

  if (scope === "chapter") {
    return {
      scope,
      rangeLabel: "当前章节",
      sourceLabel:
        chapter.startPage === chapter.endPage
          ? `第 ${chapter.startPage} 页`
          : `第 ${chapter.startPage}–${chapter.endPage} 页`,
      positionLabel: chapter.title,
    };
  }

  return {
    scope,
    rangeLabel: scope === "page" ? "当前页" : "当前选中文本",
    sourceLabel: pageNumber > 0 ? `第 ${pageNumber} 页` : "未打开 PDF",
    positionLabel: chapter.title,
  };
}



export function updateSummaryMetadata(context?: Omit<SummaryContext, "text">): void {
  const metadata = context ?? getSummaryLabels(activeSummaryScope.value);
  summaryRangeElement.textContent = metadata.rangeLabel;
  summarySourceElement.textContent = metadata.sourceLabel;
  summaryPositionElement.textContent = metadata.positionLabel;
}



export async function extractPageText(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const rawText = textContent.items
    .map((item) => {
      if (!("str" in item) || typeof item.str !== "string") return "";
      return `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`;
    })
    .join("");

  return normalizeCopiedText(rawText);
}



export function normalizeCitationMatchText(value: string): string {
  return value
    .replace(
      /\\(?:mathbb|mathbf|mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\times\b/g, "×")
    .replace(/\\in\b/g, "∈")
    .replace(/\\lambda\b/g, "λ")
    .replace(/\\sigma\b/g, "σ")
    .replace(/[$\\{}_^]/g, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\u00ad/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "");
}



export interface NormalizedCitationMatch {
  start: number;
  end: number;
  exact: boolean;
  confidence: number;
}



export function findNormalizedCitationMatch(
  normalizedSource: string,
  normalizedQuote: string,
): NormalizedCitationMatch | null {
  if (!normalizedSource || normalizedQuote.length < 8) return null;
  const exactStart = normalizedSource.indexOf(normalizedQuote);
  if (exactStart >= 0) {
    return {
      start: exactStart,
      end: exactStart + normalizedQuote.length,
      exact: true,
      confidence: 1,
    };
  }

  // Long PDF passages commonly differ only around formulas, ligatures or
  // extraction order. Confirm several sizeable anchors in source order before
  // accepting the location; this avoids turning an unrelated page number into
  // a clickable citation while still locating the surrounding paragraph.
  if (normalizedQuote.length < 96) return null;
  const anchorLength = Math.min(
    72,
    Math.max(28, Math.floor(normalizedQuote.length / 9)),
  );
  const anchors: Array<{
    quoteStart: number;
    sourceStart: number;
    length: number;
  }> = [];
  let sourceCursor = 0;
  for (
    let quoteStart = 0;
    quoteStart + anchorLength <= normalizedQuote.length;
    quoteStart += anchorLength
  ) {
    const anchor = normalizedQuote.slice(quoteStart, quoteStart + anchorLength);
    const sourceStart = normalizedSource.indexOf(anchor, sourceCursor);
    if (sourceStart < 0) continue;
    anchors.push({ quoteStart, sourceStart, length: anchor.length });
    sourceCursor = sourceStart + anchor.length;
  }

  const matchedCharacters = anchors.reduce(
    (total, anchor) => total + anchor.length,
    0,
  );
  const confidence = matchedCharacters / normalizedQuote.length;
  if (anchors.length < 2 || confidence < 0.32) return null;
  const first = anchors[0];
  const last = anchors.at(-1);
  if (!first || !last) return null;
  const locatedSpan = last.sourceStart + last.length - first.sourceStart;
  if (locatedSpan > normalizedQuote.length * 1.65) return null;

  return {
    start: Math.max(0, first.sourceStart - first.quoteStart),
    end: Math.min(
      normalizedSource.length,
      last.sourceStart +
        last.length +
        normalizedQuote.length -
        last.quoteStart -
        last.length,
    ),
    exact: false,
    confidence,
  };
}



export async function validatePdfCitations(
  content: string,
  documentProxy: PDFDocumentProxy | null,
): Promise<string> {
  const pattern = createPdfCitationPattern();
  const matches = Array.from(content.matchAll(pattern));
  const removeUnverifiableShorthand = (value: string): string =>
    value.replace(/\[?\[PDF:(?:P)?\d{1,5}\]?\]/gi, "");
  if (matches.length === 0) return removeUnverifiableShorthand(content);
  if (!documentProxy)
    return removeUnverifiableShorthand(content.replace(pattern, ""));

  const pageTextCache = new Map<number, string>();
  const parts: string[] = [];
  let cursor = 0;
  let previousValidCitation: {
    pageNumber: number;
    sourceStart: number;
    sourceEnd: number;
    contentEnd: number;
  } | null = null;
  for (const match of matches) {
    const start = match.index ?? 0;
    parts.push(content.slice(cursor, start));
    const pageNumber = Number(match[1]);
    const quote = match[2]?.replace(/\s+/g, " ").trim() ?? "";
    let valid =
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= documentProxy.numPages &&
      normalizeCitationMatchText(quote).length >= 8;

    let locatedMatch: NormalizedCitationMatch | null = null;
    if (valid) {
      if (!pageTextCache.has(pageNumber)) {
        const pageText = await extractPageText(documentProxy, pageNumber).catch(
          () => "",
        );
        pageTextCache.set(pageNumber, normalizeCitationMatchText(pageText));
      }
      locatedMatch = findNormalizedCitationMatch(
        pageTextCache.get(pageNumber) ?? "",
        normalizeCitationMatchText(quote),
      );
      valid = Boolean(locatedMatch);
    }

    const gapAfterPreviousCitation = previousValidCitation
      ? content.slice(previousValidCitation.contentEnd, start)
      : "";
    const citationsAreAdjacent = Boolean(previousValidCitation)
      && !/[\p{L}\p{N}]/u.test(gapAfterPreviousCitation);
    const overlappingSourceCharacters =
      previousValidCitation && locatedMatch
        ? Math.max(
          0,
          Math.min(previousValidCitation.sourceEnd, locatedMatch.end) -
            Math.max(previousValidCitation.sourceStart, locatedMatch.start),
        )
        : 0;
    const shorterSourceLength =
      previousValidCitation && locatedMatch
        ? Math.max(
          1,
          Math.min(
            previousValidCitation.sourceEnd - previousValidCitation.sourceStart,
            locatedMatch.end - locatedMatch.start,
          ),
        )
        : 1;
    const isDuplicateAdjacentCitation = Boolean(
      valid &&
      locatedMatch &&
      previousValidCitation &&
      citationsAreAdjacent &&
      previousValidCitation.pageNumber === pageNumber &&
      overlappingSourceCharacters / shorterSourceLength >= 0.6,
    );

    if (valid && !isDuplicateAdjacentCitation) {
      parts.push(match[0]);
      previousValidCitation = {
        pageNumber,
        sourceStart: locatedMatch?.start ?? 0,
        sourceEnd: locatedMatch?.end ?? 0,
        contentEnd: start + match[0].length,
      };
    } else if (isDuplicateAdjacentCitation) {
      console.info("[PDFPal 引用校验] 已合并相邻的重复原文引用", {
        pageNumber,
        quote,
        overlapRatio: overlappingSourceCharacters / shorterSourceLength,
      });
    } else {
      console.warn("[PDFPal 引用校验] 已移除无法匹配原文的引用", {
        pageNumber,
        quote,
      });
    }
    cursor = start + match[0].length;
  }
  parts.push(content.slice(cursor));
  return removeUnverifiableShorthand(parts.join(""));
}



export interface CitationTextPoint {
  node: Text;
  offset: number;
}



export let activeChatCitationHighlight: { value: HTMLElement | null } = { value: null };


export let activeChatCitationHighlightTimer: number | undefined;



export function clearChatCitationHighlight(): void {
  activeChatCitationHighlight.value?.remove();
  activeChatCitationHighlight.value = null;
  if (activeChatCitationHighlightTimer !== undefined) {
    window.clearTimeout(activeChatCitationHighlightTimer);
    activeChatCitationHighlightTimer = undefined;
  }
}



export async function waitForCitationTextLayer(
  pageNumber: number,
): Promise<HTMLElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 4000) {
    const layer = viewerElement.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .textLayer`,
    );
    if (layer?.textContent?.trim()) return layer;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }
  return null;
}



export function findCitationRange(
  textLayer: HTMLElement,
  quote: string,
): {
  range: Range;
  match: NormalizedCitationMatch;
} | null {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const points: CitationTextPoint[] = [];
  let normalizedText = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      const normalized = normalizeCitationMatchText(value[offset] ?? "");
      for (const character of normalized) {
        normalizedText += character;
        points.push({ node, offset });
      }
    }
  }

  const match = findNormalizedCitationMatch(
    normalizedText,
    normalizeCitationMatchText(quote),
  );
  if (!match || match.end <= match.start) return null;
  const startPoint = points[match.start];
  const endPoint = points[match.end - 1];
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(
    endPoint.node,
    Math.min(endPoint.offset + 1, endPoint.node.length),
  );
  return { range, match };
}



export function highlightCitationRanges(textLayer: HTMLElement, ranges: Range[]): void {
  const page = textLayer.closest<HTMLElement>(".pdfViewer .page");
  if (!page) return;
  const pageRect = page.getBoundingClientRect();
  const rects = mergeSelectionRects(
    ranges.flatMap((range) =>
      Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })),
    ),
  );
  if (rects.length === 0) return;

  clearChatCitationHighlight();
  const layer = document.createElement("div");
  layer.className = "pdf-ai-citation-highlight-layer";
  for (const rect of rects) {
    const highlight = document.createElement("div");
    highlight.className = "pdf-ai-citation-highlight";
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${rect.right - rect.left}px`;
    highlight.style.height = `${rect.bottom - rect.top}px`;
    layer.append(highlight);
  }
  page.append(layer);
  activeChatCitationHighlight.value = layer;
  activeChatCitationHighlightTimer = window.setTimeout(
    clearChatCitationHighlight,
    10000,
  );
}



export async function jumpToPdfCitations(
  pageNumber: number,
  quotes: string[],
): Promise<void> {
  const normalizedQuotes = quotes.map((quote) => quote.trim()).filter(Boolean);
  if (
    !pdfDocument.value ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pdfDocument.value.numPages ||
    normalizedQuotes.length === 0
  ) {
    return;
  }

  console.info("[PDFPal 引用定位] 开始查找原文", {
    pageNumber,
    citedQuotes: normalizedQuotes,
  });
  citationReturnButton.classList.remove("visible");
  citationReturnButton.setAttribute("aria-hidden", "true");
  citationReturnButton.tabIndex = -1;
  citationReturnPosition.textContent = "";
  await preserveReadingPositionForSourceNavigation();
  navigateToPdfPageWhenVisible(pageNumber);
  const textLayer = await waitForCitationTextLayer(pageNumber);
  if (!textLayer) {
    console.warn("[PDFPal 引用定位] 文字层未加载，无法核对原文", {
      pageNumber,
      citedQuotes: normalizedQuotes,
    });
    return;
  }
  const locatedCitations = normalizedQuotes.flatMap((quote) => {
    const locatedCitation = findCitationRange(textLayer, quote);
    if (!locatedCitation) {
      console.warn(
        "[PDFPal 引用定位] 页面已打开，但文字层中未找到对应原句",
        { pageNumber, citedQuote: quote },
      );
      return [];
    }
    const { range, match } = locatedCitation;
    console.info("[PDFPal 引用定位] 已匹配到 PDF 原文", {
      pageNumber,
      citedQuote: quote,
      matchedOriginalText: range.toString(),
      matchMode: match.exact ? "exact" : "multi-anchor",
      matchConfidence: match.confidence,
    });
    return [locatedCitation];
  });
  const firstLocatedCitation = locatedCitations[0];
  if (!firstLocatedCitation) return;

  const target = firstLocatedCitation.range.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", inline: "nearest" });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  highlightCitationRanges(
    textLayer,
    locatedCitations.map(({ range }) => range),
  );
}
