import { knowledgeRetrievalService } from "../../../modules/knowledge/public";
import {
  applyExtractedMetadata,
  extractOfflineDocumentMetadata,
  findSamePaperDocument,
  hasDocumentMetadata,
  putDocumentFileHandle,
  type StoredFileHandle,
} from "../../../modules/knowledge/public";
import { getDocument } from "pdfjs-dist";
import { currentFileHandle, currentRecentEntryId, pdfDocument, sourceName, sourcePdfBytes } from "../../app/viewer-state";
import { getDisplayFileName, buildPdfAssetOptions } from "../../core/pdf-reader/public";
import { getDocumentChatId } from "../../app/document-identity";
import {
  addKnowledgeDocument,
  getKnowledgeDocument,
  linkKnowledgeDocumentSource,
  listKnowledgeDocuments,
  updateKnowledgeDocument,
} from "./knowledge-corpus-repository";
import { generateAndSaveKnowledgeOverview } from "./knowledge-overview-background-task";
import { extractDocumentMetadataFor } from "./document-metadata-extraction";
import { extractTextItems } from "./pdf-text-extraction";

interface KnowledgeIndexWorkerMessage {
  type: "progress" | "done" | "error";
  phase?: "extracting" | "embedding";
  message?: string;
  completed?: number;
  total?: number;
  chunkCount?: number;
}

const knowledgeIndexWorkers = new Map<string, Worker>();

/** True while this page is indexing that document; the library uses it to tell "running" from "interrupted". */
export function isKnowledgeIndexRunning(documentId: string): boolean {
  return knowledgeIndexWorkers.has(documentId);
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

function setToolbarButtonLabel(
  button: HTMLButtonElement,
  label: string,
  showAddIcon = false,
): void {
  button.replaceChildren();
  if (showAddIcon) {
    const icon = document.createElement("img");
    icon.className = "toolbar-action-icon";
    icon.src = "/resources/add.svg";
    icon.alt = "";
    button.append(icon);
  }
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
}

export function syncCurrentPdfLibraryButton(): void {
  const button = getToolbarButton();
  if (!button) return;
  const documentProxy = pdfDocument.value;
  if (!documentProxy) {
    button.disabled = true;
    button.classList.remove("is-added", "is-indexing");
    setToolbarButtonLabel(button, "添加到知识库", true);
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
        : "已添加到库"
    : "添加到知识库", !member);
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
  const documentName = getDisplayFileName(sourceName.value) || "未命名 PDF";
  const existingDocument = getKnowledgeDocument(documentId);
  if (existingDocument && existingDocument.indexStatus !== "error") {
    syncCurrentPdfLibraryButton();
    return;
  }

  // Before a second record is created: is this the *same paper* under a new file identity? Saving annotated PDFs
  // re-writes the bytes (pdf-lib embeds an attachment), which changes the fingerprint — so the file the user just
  // opened is not the file the library knows, even though the paper is the same one. Adding it again would mean a
  // second index, a second graph paper and two entries for one work, so the existing record is pointed at this file
  // instead ("打开原文" then opens the annotated copy rather than the stale one).
  //
  // Everything below works on `targetDocumentId`, the *record* id — not the file id. They only differ after linking,
  // and the index has to be written under the record id or the chunks land on an id nothing looks up.
  let targetDocumentId = documentId;
  let linkedToExisting = false;
  const samePaper = findSamePaperDocument(listKnowledgeDocuments(), {
    documentId,
    documentName,
    pageCount: documentProxy.numPages,
  });
  if (samePaper) {
    linkKnowledgeDocumentSource(samePaper.documentId, {
      sourceDocumentId: documentId,
      recentEntryId: currentRecentEntryId.value || undefined,
    });
    // The record's durable link to the file on disk, so 「打开原文」 does not depend on the 12-entry 最近打开 list.
    void putDocumentFileHandle(samePaper.documentId, currentFileHandle.value as unknown as StoredFileHandle | null);
    targetDocumentId = samePaper.documentId;
    linkedToExisting = true;
    const linked = getKnowledgeDocument(targetDocumentId);
    if (linked && linked.indexStatus !== "error") {
      syncCurrentPdfLibraryButton();
      showBackgroundIndexNotice(
        targetDocumentId,
        "这篇文献已在知识库中，已把原文指向刚打开的这份文件，不会重复添加。",
        "success",
        100,
      );
      return;
    }
    // The linked record's index failed earlier: fall through to the retry, but under the record's id — otherwise the
    // 「↻ 重试知识库索引」 button would link and return forever without ever indexing anything.
  }

  if (!linkedToExisting && !existingDocument) {
    addKnowledgeDocument({
      documentId: targetDocumentId,
      documentName,
      pageCount: documentProxy.numPages,
      recentEntryId: currentRecentEntryId.value || undefined,
    });
    void putDocumentFileHandle(targetDocumentId, currentFileHandle.value as unknown as StoredFileHandle | null);
  }
  updateKnowledgeDocument(targetDocumentId, { indexStatus: "indexing" });
  syncCurrentPdfLibraryButton();
  const bytes = sourcePdfBytes.value;
  if (!bytes) {
    updateKnowledgeDocument(targetDocumentId, {
      indexStatus: "error",
      indexError: "无法读取当前 PDF 数据，请重新打开后再添加。",
    });
    syncCurrentPdfLibraryButton();
    showBackgroundIndexNotice(targetDocumentId, "无法读取 PDF 数据，请重新打开后再试。", "error");
    return;
  }

  void startBackgroundKnowledgeIndex({
    documentId: targetDocumentId,
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
    // Same decoder/CMap assets as the reader: this pass extracts the full text that
    // gets indexed, so a missing CMap here silently indexes garbage for CJK papers.
    backgroundPdf = await getDocument({
      data: input.pdfBytes,
      ...buildPdfAssetOptions(),
    }).promise;
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
    // Read before the proxy is destroyed: the PDF's own document-information dictionary is the cheapest source there is
    // (its `Author` is often filled in even when the page text says nothing).
    const pdfInfo = await backgroundPdf
      .getMetadata()
      .then((value) => (value?.info ?? null) as Parameters<typeof extractOfflineDocumentMetadata>[0]["pdfInfo"])
      .catch(() => null);
    await backgroundPdf.destroy();
    backgroundPdf = null;

    // 第一层：免费离线。DOI / arXiv 编号 / 版权行 / 中文日期行 / PDF 属性，全部读文件本身，不花钱、不联网，
    // 而且不可能张冠李戴——找到的东西就印在这份文件里。它先跑，模型只补它没找到的字段。
    const offline = extractOfflineDocumentMetadata({
      documentName: input.documentName,
      headText: pages.slice(0, 4).map((page) => page.text).join("\n\n"),
      pdfInfo,
    });
    if (hasDocumentMetadata(offline.fromPdf)) {
      applyExtractedMetadata(documentId, offline.fromPdf, "pdf", { onlyEmpty: true });
    }
    if (hasDocumentMetadata(offline.fromText)) {
      applyExtractedMetadata(documentId, offline.fromText, "text", { onlyEmpty: true });
    }

    // 第二层：模型读首页，只补前面没找到的字段（`onlyEmpty`），绝不覆盖用户手填的值。
    void extractDocumentMetadataFor(documentId, {
      documentName: input.documentName,
      text: pages.slice(0, 2).map((page) => page.text).join("\n\n").slice(0, 6_000),
    });

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
