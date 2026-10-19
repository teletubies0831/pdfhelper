import { browser } from "wxt/browser";

import { pdfDocument } from "../../app/viewer-state";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import {
  dismissAnimatedDialog,
  showAnimatedDialog,
} from "../../shared-ui/dialog/dialog-motion";
import {
  ensureSourcePdfOpen,
  openSourcePdfFromKnowledge,
} from "../../shared-ui/navigation/source-pdf-navigation";
import type { KnowledgeLibraryDocument } from "./knowledge-corpus-repository";
import { getKnowledgeDocument } from "./knowledge-corpus-repository";
import { closeKnowledgeBasePage } from "./knowledge-base-controller";
import {
  saveDocumentOverview,
  getDocumentOverviewMarkdown,
} from "../../../modules/knowledge/public";
import {
  isRelatedPapersSearchRunning,
} from "./knowledge-related-papers";
import { generateAndSaveKnowledgeOverview, getDocumentOverviewPageNumbers, isKnowledgeOverviewActive, type ExtractedKnowledgePage } from "./knowledge-overview-background-task";

let activeOverviewDocumentId = "";
const preparingOverviews = new Set<string>();
const editDrafts = new Map<string, string>();
let editing = false;
let previewingDraft = false;

function editorInput(): HTMLTextAreaElement {
  return document.getElementById('knowledge-overview-markdown') as HTMLTextAreaElement;
}

function syncEditorMode(): void {
  document.getElementById('knowledge-overview-editor')!.hidden = !editing || previewingDraft;
  elements().content.hidden = editing && !previewingDraft;
  for (const id of ['edit', 'regenerate', 'done']) document.getElementById(`knowledge-overview-${id}`)!.hidden = editing;
  for (const id of ['preview', 'cancel-edit', 'save']) document.getElementById(`knowledge-overview-${id}`)!.hidden = !editing;
  document.getElementById('knowledge-overview-preview')!.textContent = previewingDraft ? '继续编辑' : '预览排版';
  if (editing && previewingDraft) renderChatMarkdown(elements().content, editorInput().value, false);
  // 相关论文 is stored apart from the markdown, so leaving the editor has to rebuild the body's tail; entering it
  // drops the section, because it is not part of the text being edited.
  if (!editing) {
    const item = activeOverviewDocumentId ? getKnowledgeDocument(activeOverviewDocumentId) : undefined;
    if (item) renderSavedOverview(item);
  }
}

function beginEditing(): void {
  const item = getKnowledgeDocument(activeOverviewDocumentId);
  if (!item) return;
  editorInput().value = editDrafts.get(item.documentId) ?? getDocumentOverviewMarkdown(item);
  editing = true;
  previewingDraft = false;
  syncEditorMode();
  setOverviewStatus('修改尚未保存。后台生成结果不会覆盖正在编辑的内容。');
  editorInput().focus();
}

function saveEditing(): void {
  if (!editing || !activeOverviewDocumentId) return;
  try {
    saveDocumentOverview(activeOverviewDocumentId, editorInput().value);
    editDrafts.delete(activeOverviewDocumentId);
    editing = false;
    previewingDraft = false;
    syncEditorMode();
    renderSavedOverview(getKnowledgeDocument(activeOverviewDocumentId)!);
    setOverviewStatus('修改已保存。');
  } catch (error) {
    setOverviewStatus(error instanceof Error ? error.message : String(error), true);
  }
}

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
  if (editing) return;
  const { title, documentName, content, regenerate } = elements();
  title.textContent = "PDF 概览";
  documentName.textContent = item.documentName;
  content.classList.remove("is-loading");
  content.replaceChildren();
  const markdown = getDocumentOverviewMarkdown(item);
  if (markdown?.trim()) {
    renderChatMarkdown(content, stripLegacyRelatedSection(markdown), false);
    renderRelatedLiteratureSection(item, content);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "knowledge-overview-placeholder";
    placeholder.textContent = item.overviewStatus === "error"
      ? "PDF 概览生成失败，请查看下方原因后重新生成。"
      : item.overviewStatus === "generating"
        ? "PDF 概览尚未完成。"
        : "尚未生成 PDF 概览。";
    content.append(placeholder);
  }
  const active = isKnowledgeOverviewActive(item.documentId) || preparingOverviews.has(item.documentId);
  regenerate.disabled = active;
  if (item.overviewStatus === "error") {
    setOverviewStatus(`${markdown ? '已保留上次概览。' : ''}${item.overviewError || "概览生成失败，请重新生成。"}`, true);
  } else if (active) {
    setOverviewStatus(item.overviewProgress || "PDF 概览正在后台生成；遇到供应商限流会自动等待重试，长文可能需要几分钟。完成后会自动显示，你可以关闭此窗口继续阅读。");
  } else if (item.overviewStatus === "generating") {
    setOverviewStatus("当前页面未检测到运行中的概览任务。如果刷新过页面或任务已中断，请点击“重新生成”。");
  } else {
    setOverviewStatus();
  }
}

/**
 * Drops a 「相关论文」 section that an older version appended to the overview markdown itself.
 *
 * Retrieval used to run automatically during overview generation, so stored overviews carry a section — often just
 * the failure note "暂时未能完成在线相关论文检索". Rendering that *and* the freshly retrieved section put two
 * 「相关论文」 headings in one dialog. The stored text is left untouched (editing still shows it); only the display
 * skips it, and only up to the next top-level heading.
 */
export function stripLegacyRelatedSection(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^##\s+相关论文\s*$/.test(line.trim()));
  if (start < 0) return markdown;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index]?.trim() ?? '')) {
      end = index;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Appends the on-demand 「相关论文」 section *inside* the overview body.
 *
 * Inside, not beside: the body already owns this dialog's padding and typography, so a second panel with its own
 * heading, hint and button read as a second document stacked under the first. The button that produces this
 * section lives on the PDF card.
 */
function renderRelatedLiteratureSection(
  item: KnowledgeLibraryDocument,
  container: HTMLElement,
): void {
  const markdown = item.relatedLiteratureMarkdown?.trim() ?? "";
  const running = isRelatedPapersSearchRunning(item.documentId);
  if (!markdown && !running && !item.relatedLiteratureError) return;

  if (running) {
    const note = document.createElement("p");
    note.className = "knowledge-overview-related-note";
    note.textContent = "正在检索相关论文…";
    container.append(note);
    return;
  }

  if (markdown) {
    const holder = document.createElement("div");
    holder.className = "knowledge-overview-related-section";
    renderChatMarkdown(holder, markdown, false);
    const metaParts: string[] = [];
    const labels = (item.relatedLiteratureSources ?? [])
      .map((source) => (source === "deepseek" ? "DeepSeek 联网检索" : "OpenAlex"));
    if (labels.length) metaParts.push(labels.join(" + "));
    const usage = item.relatedLiteratureUsage;
    if (usage && (usage.searchCalls || usage.fetchCalls)) {
      metaParts.push(`联网调用 ${usage.searchCalls} 次搜索${usage.fetchCalls ? ` + ${usage.fetchCalls} 次抓取` : ""}`);
    }
    if (item.relatedLiteratureAt) {
      metaParts.push(`${new Date(item.relatedLiteratureAt).toLocaleString()} 检索`);
    }
    if (metaParts.length) {
      const meta = document.createElement("p");
      meta.className = "knowledge-overview-related-note";
      meta.textContent = metaParts.join(" · ");
      holder.append(meta);
    }
    container.append(holder);
  }

  if (item.relatedLiteratureError) {
    const hint = document.createElement("p");
    hint.className = "knowledge-overview-related-note is-error";
    hint.textContent = item.relatedLiteratureError;
    container.append(hint);
  }
}

/**
 * The 「相关论文」 block used to be rendered here, with its own heading, hint and 检索 button. It now lives on the
 * PDF card and is appended to the overview body by `renderRelatedLiteratureSection` — a money-spending action
 * deserves a button where documents are chosen, not a second panel inside the reading surface.
 */

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
  if (preparingOverviews.has(item.documentId) || isKnowledgeOverviewActive(item.documentId)) return;
  preparingOverviews.add(item.documentId);
  const { content, regenerate } = elements();
  const isActiveOverview = (): boolean =>
    activeOverviewDocumentId === item.documentId && elements().dialog.open && !editing;
  regenerate.disabled = true;
  if (!getDocumentOverviewMarkdown(item)) {
    content.classList.add("is-loading");
    content.innerHTML = "<div class=\"knowledge-overview-placeholder\"><span></span>AI 正在判断文档类型并生成概览…</div>";
  }
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
      onProgress: (message) => {
        if (isActiveOverview()) setOverviewStatus(message);
      },
    });
    const updated = getKnowledgeDocument(item.documentId);
    if (updated && isActiveOverview()) renderSavedOverview(updated);
  } catch (error) {
    if (!isActiveOverview()) return;
    const message = error instanceof Error ? error.message : String(error);
    const saved = getKnowledgeDocument(item.documentId);
    if (saved?.overviewRequestId?.startsWith('manual:')) { renderSavedOverview(saved); return; }
    if (saved && getDocumentOverviewMarkdown(saved).trim()) renderSavedOverview(saved);
    else {
      content.classList.remove("is-loading");
      content.innerHTML = "<div class=\"knowledge-overview-placeholder is-error\">PDF 概览生成失败，可以稍后重新生成。</div>";
    }
    setOverviewStatus(message, true);
  } finally {
    preparingOverviews.delete(item.documentId);
    if (isActiveOverview()) regenerate.disabled = isKnowledgeOverviewActive(item.documentId);
  }
}

export function openKnowledgePdfOverview(item: KnowledgeLibraryDocument): void {
  if (editing && activeOverviewDocumentId) editDrafts.set(activeOverviewDocumentId, editorInput().value);
  editing = false;
  previewingDraft = false;
  activeOverviewDocumentId = item.documentId;
  syncEditorMode();
  const { dialog } = elements();
  renderSavedOverview(item);
  showAnimatedDialog(dialog);
  if (editDrafts.has(item.documentId)) { beginEditing(); return; }
  if (!item.overviewMarkdown?.trim() &&
      (!item.overviewStatus || item.overviewStatus === "pending")) {
    void generateOverview(item);
  }
}

export function registerKnowledgePdfOverviewEvents(): void {
  const close = (): void => {
    const { dialog } = elements();
    if (editing) editDrafts.set(activeOverviewDocumentId, editorInput().value);
    editing = false;
    previewingDraft = false;
    syncEditorMode();
    activeOverviewDocumentId = "";
    dismissAnimatedDialog(dialog);
  };
  elements().dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  elements().dialog.addEventListener("pointerdown", (event) => {
    if (event.target === elements().dialog) close();
  });
  document.getElementById("knowledge-overview-close")?.addEventListener("click", close);
  document.getElementById("knowledge-overview-done")?.addEventListener("click", close);
  document.getElementById('knowledge-overview-edit')?.addEventListener('click', beginEditing);
  document.getElementById('knowledge-overview-preview')?.addEventListener('click', () => {
    previewingDraft = !previewingDraft;
    syncEditorMode();
  });
  document.getElementById('knowledge-overview-save')?.addEventListener('click', saveEditing);
  document.getElementById('knowledge-overview-cancel-edit')?.addEventListener('click', () => {
    editDrafts.delete(activeOverviewDocumentId);
    editing = false;
    previewingDraft = false;
    syncEditorMode();
    const item = getKnowledgeDocument(activeOverviewDocumentId);
    if (item) renderSavedOverview(item);
  });
  editorInput().addEventListener('input', () => {
    if (editing) setOverviewStatus('修改尚未保存。预览确认后点击“保存修改”。');
  });
  editorInput().addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveEditing(); }
  });
  document.getElementById("knowledge-overview-regenerate")?.addEventListener("click", () => {
    const item = getKnowledgeDocument(activeOverviewDocumentId);
    if (item) void generateOverview(item);
  });
  // 检索相关论文 lives on the PDF card now; a second entry point here would put the paid action back inside the
  // reading surface.
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
    if (item) renderSavedOverview(item);
  });
}
