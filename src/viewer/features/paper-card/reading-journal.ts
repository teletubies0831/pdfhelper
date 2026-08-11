
















import { editingReadingJournalId, resolvedReadingMode } from "../../core/pdf-reader/public";
import { appFrame, knowledgeBasePageElement, paperCardPageElement, readingJournalContentInput, readingJournalCountElement, readingJournalDocumentElement, readingJournalEditorElement, readingJournalEditorSourceElement, readingJournalEditorTitleElement, readingJournalEmptyElement, readingJournalForm, readingJournalListElement, readingJournalPageElement, readingJournalQuoteInput, readingJournalSearchInput, readingJournalTagsInput, readingJournalTitleInput } from "../../app/viewer-elements";
import { currentRecentEntryId, pdfDocument, pdfViewer, sourceName } from "../../app/viewer-state";
import { getCurrentChapterContext } from "../translation/public";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import { openRecentFile, readRecentFiles, setStatus } from "../recent-files/public";
import { getDocumentChatId, setCurrentApplicationView } from "../assistant/public";
import { getKnowledgeExcerpt, normalizeKnowledgeTags, readReadingJournalEntries, refreshKnowledgeBaseIfOpen, writeReadingJournalEntries } from "../knowledge-base/public";
import type { SavedReadingJournalEntry } from "../../core/pdf-reader/public";




export function getCurrentJournalContext(): Pick<SavedReadingJournalEntry, "documentId" | "documentName" | "recentEntryId" | "pageNumber" | "positionLabel"> {
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  const chapter = getCurrentChapterContext(pageNumber).title;
  return {
    documentId: pdfDocument.value ? getDocumentChatId(pdfDocument.value) : "",
    documentName: sourceName.value ? getDisplayFileName(sourceName.value) : "未关联文档",
    recentEntryId: currentRecentEntryId.value ?? undefined,
    pageNumber,
    positionLabel: `${chapter} · 第 ${pageNumber} 页`,
  };
}



export function closeReadingJournalEditor(): void {
  readingJournalEditorElement.hidden = true;
  editingReadingJournalId.value = null;
  readingJournalForm.reset();
}



export function openReadingJournalEditor(entry?: SavedReadingJournalEntry): void {
  const context = entry ?? getCurrentJournalContext();
  editingReadingJournalId.value = entry?.id ?? null;
  readingJournalEditorTitleElement.textContent = entry ? "编辑阅读札记" : "新建阅读札记";
  readingJournalEditorSourceElement.textContent = `${context.documentName} · ${context.positionLabel}`;
  readingJournalTitleInput.value = entry?.title ?? "";
  readingJournalQuoteInput.value = entry?.quote ?? "";
  readingJournalContentInput.value = entry?.content ?? "";
  readingJournalTagsInput.value = entry?.tags.join(", ") ?? "";
  readingJournalEditorElement.hidden = false;
  requestAnimationFrame(() => readingJournalTitleInput.focus());
}



export function saveReadingJournalEntry(input: {
  title: string;
  quote?: string;
  content: string;
  tags?: string[];
  origin: SavedReadingJournalEntry["origin"];
  pageNumber?: number;
}): SavedReadingJournalEntry {
  if (!pdfDocument.value) throw new Error("请先打开 PDF。");
  const now = new Date().toISOString();
  const context = getCurrentJournalContext();
  const pageNumber = Math.max(1, input.pageNumber ?? context.pageNumber);
  const existing = editingReadingJournalId.value
    ? readReadingJournalEntries().find((entry) => entry.id === editingReadingJournalId.value)
    : undefined;
  const entry: SavedReadingJournalEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    readingMode: resolvedReadingMode.value,
    documentId: context.documentId,
    documentName: context.documentName,
    recentEntryId: context.recentEntryId,
    pageNumber,
    positionLabel: pageNumber === context.pageNumber ? context.positionLabel : `第 ${pageNumber} 页`,
    title: input.title.trim() || getKnowledgeExcerpt(input.quote || input.content).slice(0, 42) || "阅读札记",
    quote: input.quote?.trim() ?? "",
    content: input.content.trim(),
    tags: normalizeKnowledgeTags(input.tags ?? []),
    origin: input.origin,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeReadingJournalEntries([
    entry,
    ...readReadingJournalEntries().filter((item) => item.id !== entry.id),
  ]);
  renderReadingJournal();
  refreshKnowledgeBaseIfOpen();
  return entry;
}



export async function openReadingJournalSource(entry: SavedReadingJournalEntry): Promise<void> {
  if (currentRecentEntryId.value !== entry.recentEntryId && entry.recentEntryId) {
    const recent = (await readRecentFiles()).find((item) => item.id === entry.recentEntryId);
    if (!recent) {
      setStatus(`找不到“${entry.documentName}”的文件记录，请重新打开该 PDF。`, true);
      return;
    }
    await openRecentFile(recent);
  } else if (!pdfDocument.value || getDisplayFileName(sourceName.value) !== entry.documentName) {
    setStatus(`请先打开来源文件“${entry.documentName}”。`, true);
    return;
  }
  if (!pdfDocument.value) return;
  closeReadingJournalPage();
  const pageNumber = Math.min(pdfDocument.value.numPages, Math.max(1, entry.pageNumber));
  pdfViewer.currentPageNumber = pageNumber;
  requestAnimationFrame(() => pdfViewer.scrollPageIntoView({ pageNumber }));
}



export function renderReadingJournal(): void {
  const query = readingJournalSearchInput.value.trim().toLowerCase();
  const entries = readReadingJournalEntries()
    .filter((entry) => entry.readingMode === resolvedReadingMode.value)
    .filter((entry) => !query || [entry.title, entry.quote, entry.content, entry.tags.join(" "), entry.documentName]
      .join(" ").toLowerCase().includes(query));
  readingJournalDocumentElement.textContent = sourceName.value ? getDisplayFileName(sourceName.value) : "当前阅读模式";
  readingJournalCountElement.textContent = `${entries.length} 条札记`;
  readingJournalEmptyElement.hidden = entries.length > 0;
  const cards = entries.map((entry) => {
    const article = document.createElement("article");
    article.className = "reading-journal-card";
    const head = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const meta = document.createElement("small");
    meta.textContent = `${entry.documentName} · ${entry.positionLabel}`;
    head.append(title, meta);
    article.append(head);
    if (entry.quote) {
      const quote = document.createElement("blockquote");
      quote.textContent = entry.quote;
      article.append(quote);
    }
    const body = document.createElement("div");
    body.className = "reading-journal-markdown";
    renderChatMarkdown(body, entry.content);
    const footer = document.createElement("footer");
    const tags = document.createElement("span");
    tags.textContent = entry.tags.map((tag) => `#${tag}`).join(" ");
    const actions = document.createElement("div");
    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.textContent = "查看原文";
    sourceButton.addEventListener("click", () => void openReadingJournalSource(entry));
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", () => openReadingJournalEditor(entry));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => {
      if (!window.confirm(`确定删除“${entry.title}”吗？`)) return;
      writeReadingJournalEntries(readReadingJournalEntries().filter((item) => item.id !== entry.id));
      renderReadingJournal();
    });
    actions.append(sourceButton, editButton, deleteButton);
    footer.append(tags, actions);
    article.append(body, footer);
    return article;
  });
  readingJournalListElement.replaceChildren(...cards);
}



export function openReadingJournalPage(): void {
  paperCardPageElement.hidden = true;
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("paper-card-page-open", "knowledge-base-page-open");
  readingJournalPageElement.hidden = false;
  appFrame?.classList.add("reading-journal-page-open");
  setCurrentApplicationView("journal");
  renderReadingJournal();
}



export function closeReadingJournalPage(): void {
  readingJournalPageElement.hidden = true;
  appFrame?.classList.remove("reading-journal-page-open");
  closeReadingJournalEditor();
  setCurrentApplicationView("viewer");
}
