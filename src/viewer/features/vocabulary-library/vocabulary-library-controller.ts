import {
  currentEnglishLearningResult,
  persistCurrentAppViewState,
  selectedTextPageNumber,
} from "../../core/pdf-reader/public";
import {
  vocabularyCardGridElement,
  vocabularyEditorDeleteButton,
  vocabularyEditorDialog,
  vocabularyEditorBadgesElement,
  vocabularyEditorBodyModeHint,
  vocabularyEditorBodyModeLabel,
  vocabularyEditorMarkdownInput,
  vocabularyEditorMetaGridElement,
  vocabularyEditorModeToggleButton,
  vocabularyEditorPartOfSpeechInput,
  vocabularyEditorPronunciationDisplay,
  vocabularyEditorPreviewElement,
  vocabularyEditorPronunciationInput,
  vocabularyEditorPronunciationRow,
  vocabularyEditorSpeakButton,
  vocabularyEditorTagsInput,
  vocabularyEditorTermInput,
  vocabularyEditorTitleElement,
  vocabularyMarkdownEditorElement,
  vocabularyMarkdownPreviewPane,
  vocabularyMarkdownWorkspace,
  vocabularyLibraryEntryButton,
  vocabularyLibraryMainElement,
  vocabularyLibraryStatusElement,
  vocabularySearchInput,
  vocabularySortSelect,
  vocabularyTimeFilterSelect,
  vocabularyTotalCountElement,
} from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";
import {
  getActiveWorkspaceView,
  transitionWorkspaceView,
} from "../../app/workspace-navigation";
import { getDisplayFileName } from "../../core/pdf-reader/public";
import { setCurrentApplicationView } from "../assistant/public";
import { setStatus } from "../recent-files/public";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import {
  dismissAnimatedDialog,
  showAnimatedDialog,
} from "../../shared-ui/dialog/dialog-motion";
import {
  formatLearningResultAsMarkdown,
  getVocabularyCardPartOfSpeech,
  getVocabularyCardTerm,
} from "./learning-card-markdown";
import { isVocabularyLibraryEnabled } from "./vocabulary-preference";
import {
  createVocabularyCard,
  deleteVocabularyCard,
  readVocabularyCards,
  updateVocabularyCard,
  type VocabularyCard,
} from "./vocabulary-repository";

const NEW_CARD_MARKDOWN = [
  "## 释义",
  "",
  "在这里写下单词的含义。",
  "",
  "## 例句",
  "",
  "> Add an example sentence here.",
  "> 在这里补充例句翻译。",
  "",
  "## 备注",
  "",
  "补充容易混淆的词、词根或记忆方法。",
].join("\n");

let cards: VocabularyCard[] = [];
let cardsLoaded = false;
let vocabularyLibraryNeedsRender = true;
let vocabularyOpenToken = 0;
let editingCardId: string | null = null;

export type VocabularyEditorBodyMode = "preview" | "edit";
export const vocabularyEditorBodyMode: { value: VocabularyEditorBodyMode } = {
  value: "preview",
};

function formatCardDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseTags(value: string): string[] {
  return Array.from(new Set(
    value.split(/[,，、\n]+/).map((tag) => tag.trim()).filter(Boolean),
  )).slice(0, 20);
}

function getTimeFilterCutoff(value: string): number | null {
  const now = new Date();
  if (value === "today") {
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  if (value === "week") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (value === "month") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return null;
}

function getFilteredCards(): VocabularyCard[] {
  const query = vocabularySearchInput.value.trim().toLocaleLowerCase();
  const cutoff = getTimeFilterCutoff(vocabularyTimeFilterSelect.value);
  const filtered = cards.filter((card) => {
    const timestamp = new Date(card.createdAt).getTime();
    if (cutoff !== null && (!Number.isFinite(timestamp) || timestamp < cutoff)) {
      return false;
    }
    if (!query) return true;
    return [
      card.term,
      card.pronunciation,
      card.partOfSpeech,
      card.markdown,
      card.sourceText,
      card.documentName,
      card.tags.join(" "),
    ].join("\n").toLocaleLowerCase().includes(query);
  });
  return filtered.sort((left, right) => {
    if (vocabularySortSelect.value === "oldest") {
      return left.createdAt.localeCompare(right.createdAt);
    }
    if (vocabularySortSelect.value === "updated") {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    if (vocabularySortSelect.value === "alphabetical") {
      return left.term.localeCompare(right.term, "en", { sensitivity: "base" });
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function createEmptyState(filtered: boolean): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "vocabulary-empty-state";
  const content = document.createElement("div");
  const icon = document.createElement("span");
  icon.className = "vocabulary-empty-icon";
  icon.textContent = filtered ? "⌕" : "Aa";
  const title = document.createElement("strong");
  title.textContent = filtered ? "没有找到匹配的卡片" : "从第一张单词卡开始";
  const copy = document.createElement("p");
  copy.textContent = filtered
    ? "换一个关键词或调整添加时间筛选，就能继续浏览。"
    : "在 PDF 中选中英文并生成学习结果，然后点“保存到单词库”；也可以手动新建 Markdown 卡片。";
  content.append(icon, title, copy);
  empty.append(content);
  return empty;
}

function stripPreviewMarkdown(value: string): string {
  return value
    .replace(/^>\s?/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function renderCardPreview(preview: HTMLElement, markdown: string): void {
  const fragment = document.createDocumentFragment();
  let renderedLines = 0;
  let renderedCharacters = 0;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    const text = stripPreviewMarkdown(headingMatch?.[2] ?? line);
    if (!text) continue;

    const element = document.createElement(headingMatch ? "h3" : "p");
    element.textContent = text;
    fragment.append(element);
    renderedLines += 1;
    renderedCharacters += text.length;
    if (renderedLines >= 4 || renderedCharacters >= 180) break;
  }

  if (!fragment.childNodes.length) {
    const fallback = document.createElement("p");
    fallback.textContent = "暂无卡片内容";
    fragment.append(fallback);
  }
  preview.replaceChildren(fragment);
}

function createCardElement(card: VocabularyCard): HTMLElement {
  const article = document.createElement("article");
  article.className = "vocabulary-card";
  article.dataset.openVocabularyCard = card.id;
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `编辑单词卡片：${card.term}`);

  const openArea = document.createElement("div");
  openArea.className = "vocabulary-card-open";
  const heading = document.createElement("div");
  heading.className = "vocabulary-card-heading";
  const term = document.createElement("div");
  term.className = "vocabulary-card-term";
  const title = document.createElement("strong");
  title.textContent = card.term;
  const pronunciation = document.createElement("small");
  pronunciation.textContent = card.pronunciation || "未填写音标";
  term.append(title, pronunciation);
  heading.append(term);
  if (card.partOfSpeech) {
    const partOfSpeech = document.createElement("span");
    partOfSpeech.className = "vocabulary-pos-badge";
    partOfSpeech.textContent = card.partOfSpeech;
    heading.append(partOfSpeech);
  }

  const preview = document.createElement("div");
  preview.className = "vocabulary-card-preview";
  renderCardPreview(preview, card.markdown);

  const tags = document.createElement("div");
  tags.className = "vocabulary-card-tags";
  for (const tag of card.tags.slice(0, 3)) {
    const chip = document.createElement("span");
    chip.textContent = tag;
    tags.append(chip);
  }
  openArea.append(heading, preview, tags);

  const footer = document.createElement("footer");
  footer.className = "vocabulary-card-footer";
  const source = document.createElement("span");
  source.className = "vocabulary-card-source";
  const sourceLabel = card.documentName
    ? `${card.documentName}${card.pageNumber ? ` · P${card.pageNumber}` : ""}`
    : "手动创建";
  source.textContent = `${sourceLabel} · ${formatCardDate(card.createdAt)}`;
  source.title = source.textContent;
  const remove = document.createElement("button");
  remove.className = "vocabulary-card-delete";
  remove.type = "button";
  remove.dataset.deleteVocabularyCard = card.id;
  remove.title = "删除卡片";
  remove.setAttribute("aria-label", `删除 ${card.term}`);
  remove.textContent = "×";
  footer.append(source, remove);
  article.append(openArea, footer);
  return article;
}

export async function loadVocabularyCards(force = false): Promise<void> {
  if (cardsLoaded && !force) return;
  cards = await readVocabularyCards();
  cardsLoaded = true;
}

export async function renderVocabularyLibrary(forceReload = false): Promise<void> {
  vocabularyLibraryStatusElement.textContent = cardsLoaded
    ? ""
    : "正在读取单词卡片…";
  await loadVocabularyCards(forceReload);
  const filtered = getFilteredCards();
  vocabularyTotalCountElement.textContent = `${cards.length} 张卡片`;
  vocabularyLibraryStatusElement.textContent = filtered.length === cards.length
    ? ""
    : `当前显示 ${filtered.length} / ${cards.length} 张卡片`;
  vocabularyCardGridElement.replaceChildren();
  if (filtered.length === 0) {
    vocabularyCardGridElement.append(createEmptyState(
      Boolean(vocabularySearchInput.value.trim()) ||
        vocabularyTimeFilterSelect.value !== "all",
    ));
  } else {
    vocabularyCardGridElement.append(...filtered.map(createCardElement));
  }
  vocabularyLibraryNeedsRender = false;
  persistCurrentAppViewState();
}

function renderEditorPreview(): void {
  const markdown = vocabularyEditorMarkdownInput.value.trim();
  if (!markdown) {
    vocabularyEditorPreviewElement.textContent = "在左侧输入 Markdown 后，这里会实时预览。";
    return;
  }
  renderChatMarkdown(vocabularyEditorPreviewElement, markdown, false, true);
}

function renderEditorIdentity(): void {
  const term = vocabularyEditorTermInput.value.trim() || "未命名单词";
  const pronunciation = vocabularyEditorPronunciationInput.value.trim();
  const partOfSpeech = vocabularyEditorPartOfSpeechInput.value.trim();
  const tags = parseTags(vocabularyEditorTagsInput.value);

  vocabularyEditorTitleElement.textContent = term;
  vocabularyEditorPronunciationDisplay.textContent = pronunciation;
  vocabularyEditorPronunciationDisplay.hidden = !pronunciation;
  vocabularyEditorPronunciationRow.hidden = false;
  vocabularyEditorBadgesElement.replaceChildren();

  if (partOfSpeech) {
    const badge = document.createElement("span");
    badge.className = "is-part-of-speech";
    badge.textContent = partOfSpeech;
    vocabularyEditorBadgesElement.append(badge);
  }
  for (const tag of tags) {
    const badge = document.createElement("span");
    badge.textContent = tag;
    vocabularyEditorBadgesElement.append(badge);
  }
  vocabularyEditorBadgesElement.hidden = !vocabularyEditorBadgesElement.childElementCount;
  vocabularyEditorSpeakButton.setAttribute("aria-label", `朗读 ${term}`);
}

export function setVocabularyEditorBodyMode(
  mode: VocabularyEditorBodyMode,
  focusEditor = false,
): void {
  vocabularyEditorBodyMode.value = mode;
  const editing = mode === "edit";
  vocabularyEditorDialog.classList.toggle("is-editing", editing);
  vocabularyEditorDialog.classList.toggle("is-previewing", !editing);
  vocabularyMarkdownWorkspace.classList.toggle("is-editing", editing);
  vocabularyMarkdownWorkspace.classList.toggle("is-previewing", !editing);
  vocabularyEditorMetaGridElement.hidden = !editing;
  vocabularyMarkdownEditorElement.hidden = !editing;
  vocabularyMarkdownPreviewPane.hidden = editing;
  vocabularyEditorModeToggleButton.textContent = editing
    ? "完成编辑"
    : "编辑内容";
  vocabularyEditorBodyModeLabel.textContent = editing
    ? "编辑卡片内容"
    : "卡片内容";
  vocabularyEditorBodyModeHint.textContent = editing
    ? "修改完成后切回排版结果进行确认"
    : "当前显示 Markdown 渲染结果";

  if (!editing) {
    renderEditorIdentity();
    renderEditorPreview();
    return;
  }
  vocabularyEditorTitleElement.textContent = editingCardId
    ? "编辑单词卡片"
    : "新建单词卡片";
  if (focusEditor) {
    requestAnimationFrame(() => {
      vocabularyEditorMarkdownInput.focus();
      vocabularyEditorMarkdownInput.setSelectionRange(
        vocabularyEditorMarkdownInput.value.length,
        vocabularyEditorMarkdownInput.value.length,
      );
    });
  }
}

export function openVocabularyEditor(card?: VocabularyCard): void {
  editingCardId = card?.id ?? null;
  vocabularyEditorTermInput.value = card?.term ?? "";
  vocabularyEditorPronunciationInput.value = card?.pronunciation ?? "";
  vocabularyEditorPartOfSpeechInput.value = card?.partOfSpeech ?? "";
  vocabularyEditorTagsInput.value = card?.tags.join(", ") ?? "";
  vocabularyEditorMarkdownInput.value = card?.markdown ?? NEW_CARD_MARKDOWN;
  vocabularyEditorDeleteButton.hidden = !card;
  renderEditorPreview();
  showAnimatedDialog(vocabularyEditorDialog);
  setVocabularyEditorBodyMode(card ? "preview" : "edit");
  if (!card) requestAnimationFrame(() => vocabularyEditorTermInput.focus());
}

export function closeVocabularyEditor(): void {
  editingCardId = null;
  dismissAnimatedDialog(vocabularyEditorDialog);
}

export async function saveVocabularyEditor(): Promise<void> {
  const term = vocabularyEditorTermInput.value.trim();
  const markdown = vocabularyEditorMarkdownInput.value.trim();
  if (!term || !markdown) return;
  const editable = {
    term,
    pronunciation: vocabularyEditorPronunciationInput.value.trim(),
    partOfSpeech: vocabularyEditorPartOfSpeechInput.value.trim(),
    markdown,
    tags: parseTags(vocabularyEditorTagsInput.value),
  };
  if (editingCardId) {
    await updateVocabularyCard(editingCardId, editable);
  } else {
    await createVocabularyCard({
      ...editable,
      sourceText: "",
      documentName: "",
    });
  }
  closeVocabularyEditor();
  await renderVocabularyLibrary(true);
}

export async function removeVocabularyCard(id: string): Promise<void> {
  const card = cards.find((item) => item.id === id);
  if (!card) return;
  if (!window.confirm(`确定删除单词卡片“${card.term}”吗？`)) return;
  await deleteVocabularyCard(id);
  if (editingCardId === id) closeVocabularyEditor();
  await renderVocabularyLibrary(true);
}

export async function saveCurrentTranslationToVocabulary(): Promise<void> {
  if (!isVocabularyLibraryEnabled()) return;
  const result = currentEnglishLearningResult.value;
  if (!result) {
    setStatus("当前没有可保存的英语学习结果。", true);
    return;
  }
  const term = getVocabularyCardTerm(result);
  const sourceText = result.kind === "word" ? result.sentence : result.sourceText;
  const existing = (await readVocabularyCards()).find((card) =>
    card.term.toLocaleLowerCase() === term.toLocaleLowerCase() &&
    card.sourceText === sourceText,
  );
  if (existing) {
    setStatus(`“${term}”已经保存在单词库中。`);
    return;
  }
  await createVocabularyCard({
    term,
    pronunciation: result.kind === "word" ? result.pronunciation : "",
    partOfSpeech: getVocabularyCardPartOfSpeech(result),
    markdown: formatLearningResultAsMarkdown(result),
    tags: result.kind === "word" ? ["英语学习"] : ["英语学习", "句子"],
    sourceText,
    documentName: getDisplayFileName(sourceName.value),
    pageNumber: Math.max(1, selectedTextPageNumber.value || 1),
  });
  cardsLoaded = false;
  vocabularyLibraryNeedsRender = true;
  setStatus(`已将“${term}”保存到单词库。`);
  const button = document.querySelector<HTMLButtonElement>(
    "[data-translation-action='save']",
  );
  if (button) {
    const previous = button.innerHTML;
    button.textContent = "✓ 已保存";
    window.setTimeout(() => { button.innerHTML = previous; }, 1_400);
  }
  if (getActiveWorkspaceView() === "vocabulary") {
    await renderVocabularyLibrary(true);
  }
}

export function openVocabularyLibraryPage(): void {
  if (!isVocabularyLibraryEnabled()) return;
  const openToken = ++vocabularyOpenToken;
  setCurrentApplicationView("vocabulary");
  vocabularyLibraryMainElement.scrollTop = 0;
  if (vocabularyLibraryNeedsRender) {
    vocabularyLibraryStatusElement.textContent = "正在读取单词卡片…";
  }
  void transitionWorkspaceView("vocabulary").then(() => {
    if (
      openToken !== vocabularyOpenToken ||
      getActiveWorkspaceView() !== "vocabulary" ||
      !vocabularyLibraryNeedsRender
    ) {
      return;
    }
    requestAnimationFrame(() => {
      if (
        openToken === vocabularyOpenToken &&
        getActiveWorkspaceView() === "vocabulary"
      ) {
        void renderVocabularyLibrary();
      }
    });
  });
}

export function closeVocabularyLibraryPage(): void {
  if (getActiveWorkspaceView() !== "vocabulary") return;
  vocabularyOpenToken += 1;
  vocabularyLibraryEntryButton.classList.remove("active");
  setCurrentApplicationView("viewer");
  void transitionWorkspaceView("viewer");
  persistCurrentAppViewState();
}

export function applyPersistedVocabularyState(state: {
  search?: string;
  sort?: string;
  timeFilter?: string;
}): void {
  vocabularySearchInput.value = state.search ?? "";
  vocabularySortSelect.value = ["newest", "oldest", "updated", "alphabetical"]
    .includes(state.sort ?? "") ? state.sort! : "newest";
  vocabularyTimeFilterSelect.value = ["all", "today", "week", "month"]
    .includes(state.timeFilter ?? "") ? state.timeFilter! : "all";
}

export function scheduleVocabularyPreview(): void {
  renderEditorPreview();
}

export function speakVocabularyEditorTerm(): void {
  const term = vocabularyEditorTermInput.value.trim();
  if (!term || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(term);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

export function getEditingVocabularyCardId(): string | null {
  return editingCardId;
}

export function getVocabularyCardById(id: string): VocabularyCard | undefined {
  return cards.find((card) => card.id === id);
}
