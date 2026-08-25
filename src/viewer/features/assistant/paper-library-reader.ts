import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";

import type { PaperLibraryRecord } from "../../../modules/memory/public";
import { executeMemoryTool } from "../../../../entrypoints/viewer/memory-store";
import { pdfDocument } from "../../app/viewer-state";
import { isRecord } from "../annotations/public";
import { readRecentFiles } from "../recent-files/public";
import {
  readSavedPaperCards,
  readSavedPaperOverviews,
} from "../paper-card/public";

import { getDocumentChatId } from "./chat-session";

export function getPaperLibraryCardContext(
  record: PaperLibraryRecord,
): Record<string, unknown> {
  const overviews = readSavedPaperOverviews().filter(
    (card) =>
      card.documentId === record.documentId ||
      card.documentName === record.sourceName ||
      card.documentName === record.title ||
      card.documentName.replace(/\.pdf$/i, "") ===
        record.title.replace(/\.pdf$/i, ""),
  );
  const overviewIds = new Set(overviews.map((card) => card.id));
  const readingCards = readSavedPaperCards().filter(
    (card) =>
      card.documentId === record.documentId ||
      (card.paperOverviewId ? overviewIds.has(card.paperOverviewId) : false) ||
      card.documentName === record.sourceName ||
      card.documentName.replace(/\.pdf$/i, "") ===
        record.title.replace(/\.pdf$/i, ""),
  );
  return {
    source: {
      kind: record.sourceKind,
      name: record.sourceName,
      url: record.sourceUrl,
      locator: record.sourceLocator,
      recentEntryId: record.recentEntryId,
      localPathAvailable: false,
      note:
        record.sourceKind === "local"
          ? "浏览器不暴露绝对路径；locator 对应持久化文件句柄，可由 library.readPaper 读取。"
          : undefined,
    },
    paperCards: overviews,
    readingCards,
    paperCardCount: overviews.length,
    readingCardCount: readingCards.length,
  };
}

export function enrichPaperLibraryData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) =>
      isRecord(item)
        ? {
            ...item,
            ...getPaperLibraryCardContext(
              item as unknown as PaperLibraryRecord,
            ),
          }
        : item,
    );
  }
  return isRecord(data)
    ? {
        ...data,
        ...getPaperLibraryCardContext(data as unknown as PaperLibraryRecord),
      }
    : data;
}

async function getHistoricalPaperBytes(
  record: PaperLibraryRecord,
): Promise<Uint8Array> {
  const entries = await readRecentFiles();
  const entry =
    entries.find((item) => item.id === record.recentEntryId) ??
    entries.find((item) => item.name === record.sourceName);
  if (entry?.kind === "local" && entry.fileHandle) {
    const permission = await entry.fileHandle.queryPermission?.({
      mode: "read",
    });
    if (permission && permission !== "granted") {
      throw new Error(
        "该本地论文的读取权限已失效，请先从最近文件中重新打开一次。模型不会绕过浏览器权限。 ",
      );
    }
    const file = await entry.fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
  const url = entry?.url || record.sourceUrl;
  if (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`历史论文下载失败：HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error(
    "历史记录中没有可读取的文件句柄或远程地址，请重新打开这篇 PDF。 ",
  );
}

async function extractPaperPageText(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await documentProxy.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) =>
      "str" in item && typeof item.str === "string" ? item.str : "",
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readHistoricalPaper(
  argumentsValue: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const documentId =
    typeof argumentsValue.documentId === "string"
      ? argumentsValue.documentId.trim()
      : "";
  if (!documentId) throw new Error("library.readPaper 缺少 documentId。 ");
  const paperResult = await executeMemoryTool({
    name: "library.getPaper",
    arguments: { id: documentId },
  });
  const record = paperResult.data as PaperLibraryRecord | null | undefined;
  if (!record) throw new Error("没有找到对应的历史论文记录。 ");

  const isCurrentDocument = Boolean(
    pdfDocument.value &&
      getDocumentChatId(pdfDocument.value) === record.documentId,
  );
  const loadedDocument = isCurrentDocument
    ? pdfDocument.value!
    : await getDocument({ data: await getHistoricalPaperBytes(record) })
        .promise;
  try {
    const query =
      typeof argumentsValue.query === "string"
        ? argumentsValue.query.trim()
        : "";
    const limit = Math.min(8, Math.max(1, Number(argumentsValue.limit) || 5));
    const requestedStart = Math.max(
      1,
      Number(argumentsValue.startPage) || 1,
    );
    const requestedEnd = Math.min(
      loadedDocument.numPages,
      Math.max(
        requestedStart,
        Number(argumentsValue.endPage) || requestedStart + 2,
      ),
    );
    const pageNumbers = query
      ? Array.from(
          { length: loadedDocument.numPages },
          (_, index) => index + 1,
        )
      : Array.from(
          { length: requestedEnd - requestedStart + 1 },
          (_, index) => requestedStart + index,
        );
    const queryTerms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const pages: Array<{ pageNumber: number; text: string; score: number }> =
      [];
    for (const pageNumber of pageNumbers) {
      const text = await extractPaperPageText(loadedDocument, pageNumber);
      const normalizedText = text.toLocaleLowerCase();
      const score = queryTerms.reduce(
        (total, term) => total + (normalizedText.includes(term) ? 1 : 0),
        0,
      );
      if (!query || score > 0) pages.push({ pageNumber, text, score });
    }
    const selectedPages = (query
      ? pages.sort(
          (left, right) =>
            right.score - left.score || left.pageNumber - right.pageNumber,
        )
      : pages
    )
      .slice(0, limit)
      .map(({ pageNumber, text }) => ({
        pageNumber,
        text: text.slice(0, 12000),
      }));
    return {
      documentId: record.documentId,
      title: record.title,
      pageCount: loadedDocument.numPages,
      query: query || undefined,
      pages: selectedPages,
      ...getPaperLibraryCardContext(record),
    };
  } finally {
    if (!isCurrentDocument) await loadedDocument.destroy();
  }
}
