import { knowledgeRetrievalService } from "../../../modules/knowledge/public";
import { getDocument } from "pdfjs-dist";
import { currentRecentEntryId, pdfDocument, sourceName, sourcePdfBytes } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getDocumentChatId } from "../assistant/public";
import {
  addKnowledgeDocument,
  getKnowledgeDocument,
  updateKnowledgeDocument,
} from "./knowledge-corpus-repository";
import { generateAndSaveKnowledgeOverview } from "./knowledge-overview-background-task";

interface KnowledgeIndexWorkerMessage {
  type: "progress" | "done" | "error";
  phase?: "extracting" | "embedding";
  message?: string;
  completed?: number;
  total?: number;
  chunkCount?: number;
}

const knowledgeIndexWorkers = new Map<string, Worker>();

function extractTextItems(items: unknown[]): string {
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

function showBackgroundIndexNotice(
  documentId: string,
  message: string,
  state: "active" | "success" | "error" = "active",
  progress?: number,
): void {
  const noticeId = `knowledge-index-notice-${CSS.escape(documentId)}`;
  let notice = document.getElementById(noticeId);
  if (!notice) {
    notice = document.createElement("div");
    notice.id = noticeId;
    notice.className = "knowledge-background-task-toast";
    notice.innerHTML = `<span class="knowledge-background-task-spinner" aria-hidden="true"></span><div><strong>知识库后台任务</strong><p></p><i></i></div>`;
    document.body.append(notice);
  }
  notice.classList.toggle("is-success", state === "success");
  notice.classList.toggle("is-error", state === "error");
  const text = notice.querySelector("p");
  if (text) text.textContent = message;
  const bar = notice.querySelector<HTMLElement>("i");
  if (bar) bar.style.width = `${Math.max(3, Math.min(100, progress ?? (state === "active" ? 12 : 100)))}%`;
  if (state !== "active") window.setTimeout(() => notice?.remove(), 5000);
}

function getToolbarButton(): HTMLButtonElement | null {
  return document.getElementById("add-current-pdf-to-library") as HTMLButtonElement | null;
}

function setToolbarButtonLabel(button: HTMLButtonElement, label: string): void {
  button.replaceChildren();
  const icon = document.createElement("img");
  icon.className = "toolbar-action-icon";
  icon.src = "/resources/add.svg";
  icon.alt = "";
  const text = document.createElement("span");
  text.textContent = label;
  button.append(icon, text);
}

export function syncCurrentPdfLibraryButton(): void {
  const button = getToolbarButton();
  if (!button) return;
  const documentProxy = pdfDocument.value;
  if (!documentProxy) {
    button.disabled = true;
    button.classList.remove("is-added", "is-indexing");
    setToolbarButtonLabel(button, "添加到知识库");
    button.title = "请先打开 PDF";
    return;
  }
  const member = getKnowledgeDocument(getDocumentChatId(documentProxy));
  button.disabled = Boolean(member && member.indexStatus !== "error");
  button.classList.toggle("is-added", Boolean(member));
  button.classList.toggle("is-indexing", member?.indexStatus === "indexing");
  setToolbarButtonLabel(button, member
    ? member.indexStatus === "indexing"
      ? "正在建立索引…"
      : member.indexStatus === "error"
        ? "↻ 重试知识库索引"
        : "✓ 已添加到库"
    : "添加到知识库");
  button.title = member
    ? member.indexStatus === "error"
      ? `已加入知识库，但索引失败：${member.indexError || "未知错误"}`
      : "当前 PDF 已添加到知识库"
    : "将当前 PDF 全文添加到知识库并建立检索索引";
}

export function addCurrentPdfToLibrary(): void {
  const documentProxy = pdfDocument.value;
  if (!documentProxy) return;
  const documentId = getDocumentChatId(documentProxy);
  const existingDocument = getKnowledgeDocument(documentId);
  if (existingDocument && existingDocument.indexStatus !== "error") {
    syncCurrentPdfLibraryButton();
    return;
  }

  if (!existingDocument) {
    addKnowledgeDocument({
      documentId,
      documentName: getDisplayFileName(sourceName.value) || "未命名 PDF",
      pageCount: documentProxy.numPages,
      recentEntryId: currentRecentEntryId.value || undefined,
    });
  }
  updateKnowledgeDocument(documentId, { indexStatus: "indexing" });
  syncCurrentPdfLibraryButton();
  const bytes = sourcePdfBytes.value;
  if (!bytes) {
    updateKnowledgeDocument(documentId, {
      indexStatus: "error",
      indexError: "无法读取当前 PDF 数据，请重新打开后再添加。",
    });
    syncCurrentPdfLibraryButton();
    showBackgroundIndexNotice(documentId, "无法读取 PDF 数据，请重新打开后再试。", "error");
    return;
  }

  void startBackgroundKnowledgeIndex({
    documentId,
    documentName: getDisplayFileName(sourceName.value) || "未命名 PDF",
    fingerprint: documentProxy.fingerprints?.find(Boolean) || documentId,
    pageCount: documentProxy.numPages,
    pdfBytes: new Uint8Array(bytes),
    recentEntryId: currentRecentEntryId.value || undefined,
  });
}

async function startBackgroundKnowledgeIndex(input: {
  documentId: string;
  documentName: string;
  fingerprint: string;
  pageCount: number;
  pdfBytes: Uint8Array;
  recentEntryId?: string;
}): Promise<void> {
  const { documentId } = input;
  showBackgroundIndexNotice(documentId, "已转入后台，正在提取 PDF 全文…");
  let backgroundPdf: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    backgroundPdf = await getDocument({ data: input.pdfBytes }).promise;
    const pages: Array<{ pageNumber: number; text: string }> = [];
    for (let pageNumber = 1; pageNumber <= backgroundPdf.numPages; pageNumber += 1) {
      showBackgroundIndexNotice(
        documentId,
        `后台提取 PDF：${pageNumber}/${backgroundPdf.numPages} 页`,
        "active",
        ((pageNumber - 1) / backgroundPdf.numPages) * 100,
      );
      const page = await backgroundPdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ pageNumber, text: extractTextItems(content.items) });
    }
    await backgroundPdf.destroy();
    backgroundPdf = null;

    const worker = new Worker(new URL("./knowledge-index.worker.ts", import.meta.url), {
    type: "module",
    name: `knowledge-index-${documentId.slice(-12)}`,
    });
    knowledgeIndexWorkers.set(documentId, worker);
    const retrievalSettings = knowledgeRetrievalService.getSettings();

    const finish = (): void => {
      worker.terminate();
      knowledgeIndexWorkers.delete(documentId);
      syncCurrentPdfLibraryButton();
    };
    worker.addEventListener("message", (event: MessageEvent<KnowledgeIndexWorkerMessage>) => {
    const result = event.data;
    if (result.type === "progress") {
      const progress = result.total && typeof result.completed === "number"
        ? (result.completed / result.total) * 100
        : undefined;
      showBackgroundIndexNotice(documentId, result.message || "正在后台建立索引…", "active", progress);
      return;
    }
    if (result.type === "done") {
      updateKnowledgeDocument(documentId, {
        indexStatus: "ready",
        chunkCount: result.chunkCount ?? 0,
        indexError: undefined,
      });
      finish();
      void generateAndSaveKnowledgeOverview({
        documentId,
        documentName: input.documentName,
        recentEntryId: input.recentEntryId,
        pageCount: input.pageCount,
        pages,
        onProgress: (message) => showBackgroundIndexNotice(documentId, message, "active", 92),
      }).then(() => {
        showBackgroundIndexNotice(documentId, "知识库处理完成，PDF 概览已保存", "success", 100);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        showBackgroundIndexNotice(documentId, `全文索引已完成，但 PDF 概览生成失败：${message}`, "error", 100);
      });
      return;
    }
    updateKnowledgeDocument(documentId, {
      indexStatus: "error",
      indexError: result.message || "后台索引失败。",
    });
    showBackgroundIndexNotice(documentId, result.message || "后台索引失败。", "error", 100);
    finish();
    });
    worker.addEventListener("error", (event) => {
      const details = [event.message, event.filename, event.lineno ? `第 ${event.lineno} 行` : ""]
        .filter(Boolean)
        .join(" · ");
      updateKnowledgeDocument(documentId, {
        indexStatus: "error",
        indexError: details || "后台索引线程启动失败。",
      });
      showBackgroundIndexNotice(documentId, details || "后台索引线程启动失败。", "error", 100);
      finish();
    });
    worker.postMessage({
      type: "index",
      pages,
      documentId,
      fingerprint: input.fingerprint,
      documentName: input.documentName,
      pageCount: input.pageCount,
      retrievalMode: retrievalSettings.mode,
      modelId: retrievalSettings.modelId,
    });
  } catch (error) {
    await backgroundPdf?.destroy().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    updateKnowledgeDocument(documentId, { indexStatus: "error", indexError: message });
    showBackgroundIndexNotice(documentId, `PDF 全文提取失败：${message}`, "error", 100);
    syncCurrentPdfLibraryButton();
  }
}
