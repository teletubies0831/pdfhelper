import {
  selectedSnippetElement,
  translationLearningHintElement,
  translationResultElement,
} from "../../app/viewer-elements";
import {
  currentEnglishLearningSourceSentence,
  type SentenceKeyword,
  type SentenceLearningResult,
} from "../../app/public";
import {
  autoResizeTranslationTextarea,
  createLearningElement,
  normalizeLearningInlineText,
  setMoreExamplesButtonVisible,
  setTranslationLearningTitle,
} from "./selection-context";
import { renderLearningRichText, setSelectedSnippetDisplayMode } from "./learning-view";

/**
 * The sentence half of the learning panel: the finished card and the streaming one.
 *
 * Split from `learning-view.ts` because the sentence card and the word card are two different presentations that only
 * share helpers (and because that file was over its size limit). What matters here is one invariant: the translation
 * is the part the reader asked for, so it is rendered as early and as independently as possible — the streaming
 * variant exists so the sentence can arrive on its own while the vocabulary is still being chosen.
 */

function getTranslationPrimaryActions(): HTMLElement | null {
  const actions = document.getElementById("translation-primary-actions");
  return actions && actions.childElementCount > 0 ? actions : null;
}

/** Shared opening of both variants: the source line, the panel mode, the section title. */
function prepareSentenceCard(sourceText: string, hint: string): void {
  translationResultElement.closest("[data-ai-panel='translate']")
    ?.classList.remove("word-learning-mode");
  const selectionTitle = document.querySelector<HTMLElement>(
    ".translation-selection-section h3",
  );
  if (selectionTitle) selectionTitle.textContent = "1. 选中英文";
  setTranslationLearningTitle("原句翻译");
  translationLearningHintElement.textContent = hint;
  // 原文预览只应由本地真实选区驱动。模型可能会重组原文，不能用其结果
  // 覆盖或清空用户实际选中的英文。
  const localSourceText = normalizeLearningInlineText(
    currentEnglishLearningSourceSentence.value || selectedSnippetElement.value || sourceText,
  );
  if (localSourceText) {
    selectedSnippetElement.value = localSourceText;
    selectedSnippetElement.removeAttribute("title");
    autoResizeTranslationTextarea(selectedSnippetElement);
  }
  setSelectedSnippetDisplayMode("preview");
}

/** The 「重点单词」 block, shared by the finished card and the streaming one. */
function createKeywordBlock(keywords: readonly SentenceKeyword[]): HTMLElement {
  const block = createLearningElement("section", "english-learning-block");
  block.append(createLearningElement("h4", "english-learning-label", "重点单词"));
  if (!keywords.length) {
    block.append(
      createLearningElement("p", "english-learning-empty", "这句话以常用词为主，暂时没有需要额外记忆的难词。"),
    );
    return block;
  }
  const list = createLearningElement("div", "english-keyword-list");
  keywords.forEach((keyword) => {
    const item = createLearningElement("article", "english-keyword-card");
    const title = createLearningElement("div", "english-keyword-title");
    title.append(
      createLearningElement("strong", "english-keyword-word", keyword.word),
      createLearningElement("span", "english-pos-tag", keyword.partOfSpeech),
    );
    item.append(title);
    item.append(
      renderLearningRichText(
        createLearningElement("div", "english-keyword-meaning"),
        keyword.meaningInSentence,
      ),
    );
    list.append(item);
  });
  block.append(list);
  return block;
}

export function renderSentenceLearningResult(result: SentenceLearningResult): void {
  prepareSentenceCard(
    result.sourceText,
    "已给出当前选中原句的完整译文，并仅挑选值得学习的术语、学术表达或较难词汇。",
  );
  const card = createLearningElement("article", "english-learning-card sentence-card");
  const translation = createLearningElement("section", "english-learning-block");
  translation.append(createLearningElement("h4", "english-learning-label", "原句翻译"));
  translation.append(
    renderLearningRichText(
      createLearningElement("div", "english-sentence-translation"),
      result.translation,
    ),
  );
  card.append(translation);
  const primaryActions = getTranslationPrimaryActions();
  if (primaryActions) card.append(primaryActions);
  card.append(createKeywordBlock(result.keywords));
  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(false);
}

export interface StreamingSentenceCard {
  /** Replaces the visible translation; called with the accumulated text on every chunk. */
  setTranslation(text: string): void;
  /** A muted line under the translation: “正在翻译…”, or why it failed. */
  setTranslationNote(text: string, isError?: boolean): void;
  /** Marks the translation as still arriving, which paints the caret. */
  setStreaming(streaming: boolean): void;
  /** Fills the keyword block once the second half of the answer lands. */
  setKeywords(keywords: readonly SentenceKeyword[]): void;
  /** Says the words will not arrive, without touching the translation above. */
  setKeywordNote(text: string, isError?: boolean): void;
}

/**
 * Renders the card **before** the answer exists, so the reader sees structure instead of an empty panel.
 *
 * The translation is its own small request and the vocabulary is a second one, so the sentence can appear in about a
 * second and the words fill in underneath while the reader is already reading — instead of one large JSON object
 * holding both until its closing brace.
 */
export function renderSentenceStreamingCard(sourceText: string): StreamingSentenceCard {
  prepareSentenceCard(sourceText, "正在翻译原句，重点词会在译文出现后继续补充。");

  const card = createLearningElement("article", "english-learning-card sentence-card");
  const translationBlock = createLearningElement("section", "english-learning-block");
  translationBlock.append(createLearningElement("h4", "english-learning-label", "原句翻译"));
  const translationText = createLearningElement("div", "english-sentence-translation");
  const translationNote = createLearningElement("p", "english-stream-note");
  translationBlock.append(translationText, translationNote);
  card.append(translationBlock);
  const primaryActions = getTranslationPrimaryActions();
  if (primaryActions) card.append(primaryActions);

  let keywordBlock = createLearningElement("section", "english-learning-block");
  keywordBlock.append(
    createLearningElement("h4", "english-learning-label", "重点单词"),
    createLearningElement("p", "english-stream-note", "正在挑选重点词…"),
  );
  card.append(keywordBlock);

  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(false);

  return {
    setTranslation(text) {
      translationText.textContent = text;
    },
    setTranslationNote(text, isError = false) {
      translationNote.textContent = text;
      translationNote.classList.toggle("is-error", isError);
    },
    setStreaming(streaming) {
      translationText.classList.toggle("is-streaming", streaming);
    },
    setKeywords(keywords) {
      const next = createKeywordBlock(keywords);
      keywordBlock.replaceWith(next);
      keywordBlock = next;
    },
    setKeywordNote(text, isError = false) {
      const note = keywordBlock.querySelector(".english-stream-note");
      if (!note) return;
      note.textContent = text;
      note.classList.toggle("is-error", isError);
    },
  };
}
