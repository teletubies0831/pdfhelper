import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";

import { browser } from "wxt/browser";
import {
  isVisionAiConfigured,
  type AiImageAttachment,
  type AiRuntimeResponse,
  type AiNativeToolCall,
  type AiStreamStartMessage,
  type AiStreamToolResult,
} from "../../../../shared/ai";

import { getAgentToolDefinitionByApiName } from "../../../../shared/agent-tools";
import {
  type MemoryToolCall,
  type PaperLibraryRecord,
} from "../../../../shared/memory";

import { executeMemoryTool } from "../../../../entrypoints/viewer/memory-store";

import {
  pendingChatImages,
  readingModePreference,
  resolvedReadingMode,
  visionAiConfig,
} from "../../core/pdf-reader/public";

import {
  aiPanelToggleButton,
  assistantPanelToggleButton,
  chatImageInput,
  knowledgeBaseEntryButton,
  knowledgeBasePageElement,
  outlineToggleButton,
  paperCardPageElement,
  readingModeSelect,
} from "../../app/viewer-elements";
import { isRecord } from "../annotations/public";
import { readRecentFiles } from "../recent-files/public";
import { pdfDocument } from "../../app/viewer-state";
import {
  closePaperCardPage,
  readSavedPaperCards,
  readSavedPaperOverviews,
  saveReadingJournalEntry,
} from "../paper-card/public";
import {
  readReadingJournalEntries,
  renderKnowledgeBase,
} from "../knowledge-base/public";

import { getDocumentChatId } from "./chat-session";
import { renderPendingChatImages } from "./chat-view";

export function setCurrentApplicationView(
  view: "viewer" | "paper-card" | "journal" | "knowledge",
): void {
  const isViewer = view === "viewer";
  aiPanelToggleButton?.classList.toggle("active", view === "viewer");
  knowledgeBaseEntryButton.classList.toggle("active", view === "knowledge");
  if (outlineToggleButton instanceof HTMLButtonElement) {
    outlineToggleButton.disabled = !isViewer;
    outlineToggleButton.setAttribute("aria-disabled", String(!isViewer));
  }
  assistantPanelToggleButton.disabled = !isViewer;
  assistantPanelToggleButton.setAttribute("aria-disabled", String(!isViewer));
}

export function updateModeNavigation(): void {
  const hasDocument = Boolean(pdfDocument.value);
  readingModeSelect.disabled = !hasDocument;
  if (!hasDocument) {
    let emptyOption = readingModeSelect.querySelector<HTMLOptionElement>(
      'option[value="unopened"]',
    );
    if (!emptyOption) {
      emptyOption = document.createElement("option");
      emptyOption.value = "unopened";
      readingModeSelect.prepend(emptyOption);
    }
    emptyOption.textContent = "未打开 PDF";
    readingModeSelect.value = "unopened";
  } else {
    readingModeSelect.querySelector('option[value="unopened"]')?.remove();
    readingModeSelect.value = readingModePreference.value;
  }

  knowledgeBaseEntryButton.textContent = "知识库";
  // The knowledge library is backed by saved records and remains available
  // even when the reader has no active PDF document.
  knowledgeBaseEntryButton.disabled = false;
  if (hasDocument && !paperCardPageElement.hidden) closePaperCardPage();
  if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
}

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

export async function getHistoricalPaperBytes(
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
    if (!response.ok)
      throw new Error(`历史论文下载失败：HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error(
    "历史记录中没有可读取的文件句柄或远程地址，请重新打开这篇 PDF。 ",
  );
}

export async function extractLibraryPaperPageText(
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

export async function executeLibraryReadPaper(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const documentId =
    typeof args.documentId === "string" ? args.documentId.trim() : "";
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
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const limit = Math.min(8, Math.max(1, Number(args.limit) || 5));
    const requestedStart = Math.max(1, Number(args.startPage) || 1);
    const requestedEnd = Math.min(
      loadedDocument.numPages,
      Math.max(requestedStart, Number(args.endPage) || requestedStart + 2),
    );
    const pageNumbers = query
      ? Array.from({ length: loadedDocument.numPages }, (_, index) => index + 1)
      : Array.from(
          { length: requestedEnd - requestedStart + 1 },
          (_, index) => requestedStart + index,
        );
    const queryTerms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const pages: Array<{ pageNumber: number; text: string; score: number }> =
      [];
    for (const pageNumber of pageNumbers) {
      const text = await extractLibraryPaperPageText(
        loadedDocument,
        pageNumber,
      );
      const normalized = text.toLocaleLowerCase();
      const score = queryTerms.reduce(
        (total, term) => total + (normalized.includes(term) ? 1 : 0),
        0,
      );
      if (!query || score > 0) pages.push({ pageNumber, text, score });
    }
    const selectedPages = (
      query
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

export function clearPendingChatImages(): void {
  pendingChatImages.value = [];
  chatImageInput.value = "";
  renderPendingChatImages();
}

export async function inspectChatImageWithVision(
  attachment: AiImageAttachment,
  question: string,
  context: AiStreamStartMessage["context"],
): Promise<string> {
  if (!isVisionAiConfigured(visionAiConfig.value)) {
    throw new Error("请先在“设置 → 视觉模型”中启用并配置视觉模型。");
  }
  const response = (await browser.runtime.sendMessage({
    type: "pdf-helper:ai-vision",
    prompt: [
      "这是用户随聊天消息附加的截图。",
      question
        ? `用户问题：${question.slice(0, 2000)}`
        : "用户希望你分析这张截图。",
      "请准确识别截图中的文字、公式、图表、界面状态和重要空间关系。",
      "输出可直接交给主语言模型使用的中文事实说明；不确定的地方明确标注，不要猜测。",
    ].join("\n"),
    imageDataUrl: attachment.dataUrl,
    context,
  })) as AiRuntimeResponse;
  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || `视觉模型未能分析 ${attachment.name}。`);
  }
  return response.content.trim();
}

export async function executeNativeToolCalls(
  calls: AiNativeToolCall[],
  context: AiStreamStartMessage["context"],
): Promise<AiStreamToolResult[]> {
  return Promise.all(
    calls.map(async (call): Promise<AiStreamToolResult> => {
      const definition = getAgentToolDefinitionByApiName(call.name);
      const toolName = definition?.name ?? call.name;
      console.info("[PDFPal Agent] native tool call", {
        toolCallId: call.id,
        requestedName: call.name,
        toolName,
        arguments: call.arguments,
      });
      try {
        if (toolName === "journal.add") {
          const args = (call.arguments ?? {}) as Record<string, unknown>;
          const entry = saveReadingJournalEntry({
            title: typeof args.title === "string" ? args.title : "知识库笔记",
            quote: typeof args.quote === "string" ? args.quote : "",
            content: typeof args.content === "string" ? args.content : "",
            tags: Array.isArray(args.tags)
              ? args.tags.filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : [],
            origin: "ai",
            pageNumber:
              typeof args.pageNumber === "number" ? args.pageNumber : undefined,
          });
          return {
            toolCallId: call.id,
            name: toolName,
            ok: true,
            content: JSON.stringify({ saved: true, entry }, null, 2),
          };
        }
        if (toolName === "journal.search") {
          const args = (call.arguments ?? {}) as Record<string, unknown>;
          const query =
            typeof args.query === "string"
              ? args.query.trim().toLowerCase()
              : "";
          const limit =
            typeof args.limit === "number"
              ? Math.min(30, Math.max(1, args.limit))
              : 10;
          const entries = readReadingJournalEntries()
            .filter((entry) => entry.readingMode === resolvedReadingMode.value)
            .filter(
              (entry) =>
                !query ||
                [entry.title, entry.quote, entry.content, entry.tags.join(" ")]
                  .join(" ")
                  .toLowerCase()
                  .includes(query),
            )
            .slice(0, limit);
          return {
            toolCallId: call.id,
            name: toolName,
            ok: true,
            content: JSON.stringify(
              { readingMode: resolvedReadingMode.value, entries },
              null,
              2,
            ),
          };
        }
        if (toolName === "library.readPaper") {
          const data = await executeLibraryReadPaper(call.arguments ?? {});
          return {
            toolCallId: call.id,
            name: toolName,
            ok: true,
            content: JSON.stringify(data, null, 2).slice(0, 50000),
          };
        }
        if (toolName.startsWith("memory.") || toolName.startsWith("library.")) {
          const args = { ...(call.arguments ?? {}) } as Record<string, unknown>;
          if (
            toolName === "library.getPaper" &&
            typeof args.documentId === "string" &&
            !args.id
          ) {
            args.id = args.documentId;
            delete args.documentId;
          }
          const result = await executeMemoryTool({
            name: toolName as MemoryToolCall["name"],
            arguments: args as never,
          });
          if (result.ok && toolName.startsWith("library.")) {
            result.data = enrichPaperLibraryData(result.data);
          }
          const content = JSON.stringify(result, null, 2).slice(0, 30000);
          console.info("[PDFPal Agent] native tool result", {
            toolCallId: call.id,
            toolName,
            result,
          });
          return {
            toolCallId: call.id,
            name: toolName,
            ok: result.ok,
            content,
          };
        }
        const evidence =
          context?.agentEvidence?.trim() ||
          context?.pageText?.trim() ||
          context?.documentText?.trim() ||
          "当前轮次没有可用的文档证据。";
        const content = JSON.stringify({
          tool: toolName,
          status: "already_prepared",
          sourcePages: context?.sourcePages ?? [],
          evidence: evidence.slice(0, 14000),
        });
        console.info("[PDFPal Agent] native document tool result", {
          toolCallId: call.id,
          toolName,
        });
        return { toolCallId: call.id, name: toolName, ok: true, content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[PDFPal Agent] native tool failed", {
          toolCallId: call.id,
          toolName,
          error: message,
        });
        return {
          toolCallId: call.id,
          name: toolName,
          ok: false,
          content: message,
        };
      }
    }),
  );
}
