import { pdfDocument } from "../../app/viewer-state";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import {
  ensureSourcePdfOpen,
  openSourcePdfFromKnowledge,
} from "../../shared-ui/navigation/source-pdf-navigation";
import type { KnowledgeLibraryDocument } from "./knowledge-corpus-repository";
import { getKnowledgeDocument } from "./knowledge-corpus-repository";
import { closeKnowledgeBasePage } from "./knowledge-base-controller";
import { generateAndSaveKnowledgeOverview, getDocumentOverviewPageNumbers, type ExtractedKnowledgePage } from "./knowledge-overview-background-task";

let activeOverviewDocumentId = "";

function elements(): {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  documentName: HTMLElement;
  content: HTMLElement;
  status: HTMLElement;
  regenerate: HTMLButtonElement;
} {
  return {
    dialog: document.getElementById("knowledge-overview-dialog") as HTMLDialogElement,
    title: document.getElementById("knowledge-overview-title") as HTMLElement,
    documentName: document.getElementById("knowledge-overview-document-name") as HTMLElement,
    content: document.getElementById("knowledge-overview-content") as HTMLElement,
    status: document.getElementById("knowledge-overview-status") as HTMLElement,
    regenerate: document.getElementById("knowledge-overview-regenerate") as HTMLButtonElement,
  };
}

function setOverviewStatus(message = "", isError = false): void {
  const { status } = elements();
  status.textContent = message;
  status.classList.toggle("error", isError);
  status.hidden = !message;
}

function renderSavedOverview(item: KnowledgeLibraryDocument): void {
  const { title, documentName, content, regenerate } = elements();
  title.textContent = "PDF 概览";
  documentName.textContent = item.documentName;
  content.classList.remove("is-loading");
  content.replaceChildren();
  if (item.overviewMarkdown?.trim()) {
    renderChatMarkdown(content, item.overviewMarkdown, false);
    setOverviewStatus();
  } else {
    content.innerHTML = "<div class=\"knowledge-overview-placeholder\">正在读取并概括这份 PDF…</div>";
  }
  regenerate.disabled = item.overviewStatus === "generating";
}

async function extractOverviewPages(): Promise<ExtractedKnowledgePage[]> {
  const proxy = pdfDocument.value;
  if (!proxy) throw new Error("没有可读取的 PDF。");
  const pages: ExtractedKnowledgePage[] = [];
  for (const pageNumber of getDocumentOverviewPageNumbers(proxy.numPages)) {
    const page = await proxy.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((entry) => {
      if (!entry || typeof entry !== "object" || !("str" in entry)) return "";
      return `${String((entry as { str: unknown }).str || "")} `;
    }).join("").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber, text });
  }
  return pages;
}

async function generateOverview(item: KnowledgeLibraryDocument): Promise<void> {
  const { content, regenerate } = elements();
  regenerate.disabled = true;
  content.classList.add("is-loading");
  content.innerHTML = "<div class=\"knowledge-overview-placeholder\"><span></span>AI 正在判断文档类型并生成概览…</div>";
  setOverviewStatus("正在后台处理；你可以关闭窗口继续阅读，完成后结果会保存在知识库中。");
  try {
    const opened = await ensureSourcePdfOpen(item.documentName, item.recentEntryId);
    if (!opened || !pdfDocument.value) throw new Error("无法打开这份 PDF 的原文。");
    const pages = await extractOverviewPages();
    await generateAndSaveKnowledgeOverview({
      documentId: item.documentId,
      documentName: item.documentName,
      recentEntryId: item.recentEntryId,
      pageCount: item.pageCount,
      pages,
      onProgress: (message) => setOverviewStatus(message),
    });
    const updated = getKnowledgeDocument(item.documentId);
    if (updated && activeOverviewDocumentId === item.documentId) renderSavedOverview(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    content.classList.remove("is-loading");
    content.innerHTML = "<div class=\"knowledge-overview-placeholder is-error\">PDF 概览生成失败，可以稍后重新生成。</div>";
    setOverviewStatus(message, true);
  } finally {
    regenerate.disabled = false;
  }
}

export function openKnowledgePdfOverview(item: KnowledgeLibraryDocument): void {
  activeOverviewDocumentId = item.documentId;
  const { dialog } = elements();
  renderSavedOverview(item);
  if (!dialog.open) dialog.showModal();
  if (!item.overviewMarkdown?.trim() && item.overviewStatus !== "generating") {
    void generateOverview(item);
  } else if (item.overviewStatus === "generating") {
    setOverviewStatus("PDF 概览正在后台生成，完成后会自动保存。");
  }
}

export function registerKnowledgePdfOverviewEvents(): void {
  const close = (): void => elements().dialog.close();
  elements().dialog.addEventListener("pointerdown", (event) => {
    if (event.target === elements().dialog) close();
  });
  document.getElementById("knowledge-overview-close")?.addEventListener("click", close);
  document.getElementById("knowledge-overview-done")?.addEventListener("click", close);
  document.getElementById("knowledge-overview-regenerate")?.addEventListener("click", () => {
    const item = getKnowledgeDocument(activeOverviewDocumentId);
    if (item) void generateOverview(item);
  });
  document.getElementById("knowledge-overview-open-source")?.addEventListener("click", () => {
    const item = getKnowledgeDocument(activeOverviewDocumentId);
    if (!item) return;
    const hadOpenPdf = Boolean(pdfDocument.value);
    void openSourcePdfFromKnowledge(item.documentName, item.recentEntryId).then((opened) => {
      if (!opened) return;
      close();
      if (!hadOpenPdf) closeKnowledgeBasePage();
    });
  });
  window.addEventListener("pdf-helper:knowledge-corpus-change", () => {
    const { dialog } = elements();
    if (!dialog.open || !activeOverviewDocumentId) return;
    const item = getKnowledgeDocument(activeOverviewDocumentId);
    if (item?.overviewMarkdown && item.overviewStatus === "ready") renderSavedOverview(item);
  });
}
