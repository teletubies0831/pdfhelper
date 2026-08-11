

















import { applyTranslationEditButton, selectedSnippetElement, selectedSnippetMathPreview, selectedSnippetModeToggleButton, selectedSnippetShell, translationLearningHintElement, translationResultElement, translationSourceSentenceField, translationSourceSentenceInput, translationSourceSentenceMathPreview, translationSourceSentenceTranslation } from "../../app/viewer-elements";
import { currentEnglishLearningResult, currentEnglishLearningSourceSentence, normalizeCopiedText } from "../../core/pdf-reader/public";
import { parseAiJson, renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import { prepareKnowledgeEditorMarkdown } from "../knowledge-base/public";






import type { SentenceKeyword, SentenceLearningResult, VocabularyExample, VocabularyLearningResult, VocabularySense, VocabularyWordForm } from "../../core/pdf-reader/public";
import { autoResizeTranslationTextarea, createLearningElement, getSelectedEnglishWord, normalizeLearningInlineText, readLearningArray, readLearningString, setMoreExamplesButtonVisible, setTranslationLearningTitle } from './selection-context';




export function containsLatexMath(value: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\)|\\(?:frac|sum|prod|int|sqrt|log|alpha|beta|gamma|lambda|sigma|mathbf|mathbb|mathrm)\b|[_^]\{/.test(
    value,
  );
}



export type SelectedSnippetDisplayMode = "preview" | "edit";



export let selectedSnippetDisplayMode: { value: SelectedSnippetDisplayMode } = { value: "preview" };



export function renderSelectedSnippetRichView(value: string): void {
  const text = value.trim();
  selectedSnippetMathPreview.replaceChildren();

  if (!text) {
    selectedSnippetMathPreview.innerHTML = `
      <div class="selected-snippet-empty">
        请在左侧 PDF 中选择英文内容
      </div>
    `;
    return;
  }

  renderChatMarkdown(
    selectedSnippetMathPreview,
    prepareKnowledgeEditorMarkdown(text),
    false,
    true,
  );
}



export function setSelectedSnippetDisplayMode(
  mode: SelectedSnippetDisplayMode,
  focusEditor = false,
): void {
  selectedSnippetDisplayMode.value = mode;
  const editing = mode === "edit";

  selectedSnippetShell.classList.toggle("editing", editing);
  selectedSnippetElement.hidden = !editing;
  selectedSnippetMathPreview.hidden = editing;
  selectedSnippetModeToggleButton.textContent = editing
    ? "查看排版"
    : "编辑英文";
  selectedSnippetModeToggleButton.setAttribute(
    "aria-pressed",
    String(editing),
  );

  if (editing) {
    autoResizeTranslationTextarea(selectedSnippetElement);
    if (focusEditor) {
      requestAnimationFrame(() => {
        selectedSnippetElement.focus();
        selectedSnippetElement.setSelectionRange(
          selectedSnippetElement.value.length,
          selectedSnippetElement.value.length,
        );
      });
    }
    return;
  }

  renderSelectedSnippetRichView(selectedSnippetElement.value);
}



export function renderTranslationMathPreview(
  container: HTMLElement,
  value: string,
): void {
  const text = value.trim();
  const formatted = text ? prepareKnowledgeEditorMarkdown(text) : "";
  container.hidden = !formatted || !containsLatexMath(formatted);
  if (container.hidden) {
    container.replaceChildren();
    return;
  }

  renderChatMarkdown(container, formatted, false, true);
}



export function renderLearningRichText(
  element: HTMLElement,
  value: string,
): HTMLElement {
  renderChatMarkdown(
    element,
    prepareKnowledgeEditorMarkdown(value),
    false,
    true,
  );
  return element;
}



export function setTranslationSelectionEditor(
  text: string,
  sourceSentence = "",
  sourceSentenceTranslation = "",
): void {
  const normalizedText = normalizeCopiedText(text);
  const normalizedSourceSentence = normalizeLearningInlineText(
    sourceSentence || normalizedText,
  );
  selectedSnippetElement.value = normalizedText;
  selectedSnippetElement.removeAttribute("title");
  autoResizeTranslationTextarea(selectedSnippetElement);
  renderSelectedSnippetRichView(normalizedText);
  setSelectedSnippetDisplayMode("preview");
  const isWord = Boolean(getSelectedEnglishWord(normalizedText));
  translationSourceSentenceField.hidden = !isWord;
  translationSourceSentenceInput.value = isWord
    ? normalizedSourceSentence
    : "";
  autoResizeTranslationTextarea(translationSourceSentenceInput);
  renderTranslationMathPreview(
    translationSourceSentenceMathPreview,
    translationSourceSentenceInput.value,
  );
  renderLearningRichText(
    translationSourceSentenceTranslation,
    sourceSentenceTranslation || "查询后显示原句的完整翻译",
  );
  currentEnglishLearningSourceSentence.value = normalizedSourceSentence;
  applyTranslationEditButton.disabled = !normalizedText;
}



export function markTranslationEditorChanged(): void {
  const text = normalizeCopiedText(selectedSnippetElement.value);
  autoResizeTranslationTextarea(selectedSnippetElement);
  renderSelectedSnippetRichView(text);
  const isWord = Boolean(getSelectedEnglishWord(text));
  translationSourceSentenceField.hidden = !isWord;
  applyTranslationEditButton.disabled = !text;
}



export function readVocabularyExamples(value: unknown): VocabularyExample[] {
  return readLearningArray(value)
    .map((example): VocabularyExample | null => {
      if (!example || typeof example !== "object") return null;
      const record = example as Record<string, unknown>;
      const sentence = readLearningString(record.sentence)
        || readLearningString(record.en);
      const translation = readLearningString(record.translation)
        || readLearningString(record.zh);
      if (!sentence || !translation) return null;
      return {
        sentence,
        translation,
        usage: readLearningString(record.usage)
          || readLearningString(record.note)
          || "常见用法",
        source: record.source === "document" ? "document" : "generated",
      };
    })
    .filter((example): example is VocabularyExample => Boolean(example));
}



export function parseVocabularyLearningResult(
  content: string,
  word: string,
  sentence: string,
): VocabularyLearningResult {
  const value = parseAiJson(content);
  const senses = readLearningArray(value.senses ?? value.partsOfSpeech)
    .map((item): VocabularySense | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = readLearningString(record.label)
        || readLearningString(record.partOfSpeech)
        || readLearningString(record.pos);
      const meaning = readLearningString(record.meaning)
        || readLearningString(record.definition)
        || readLearningString(record.translation);
      if (!label || !meaning) return null;
      return {
        label,
        meaning,
        definitionEn: readLearningString(record.definitionEn)
          || readLearningString(record.englishDefinition)
          || readLearningString(record.enDefinition),
      };
    })
    .filter((item): item is VocabularySense => Boolean(item));
  const forms = readLearningArray(value.forms)
    .map((item): VocabularyWordForm | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = readLearningString(record.label) || readLearningString(record.name);
      const form = readLearningString(record.value) || readLearningString(record.form);
      return label && form ? { label, value: form } : null;
    })
    .filter((item): item is VocabularyWordForm => Boolean(item));
  const sourceSentence = readLearningString(value.sourceSentenceLatex)
    || readLearningString(value.sourceSentence)
    || sentence;
  const sentenceTranslation = readLearningString(value.sentenceTranslation)
    || readLearningString(value.contextTranslation);
  const meaningInSentence = readLearningString(value.meaningInSentence)
    || readLearningString(value.contextMeaning);

  if (!meaningInSentence || !sentenceTranslation) {
    throw new Error("模型没有返回完整的单词学习结果。");
  }

  const generatedExamples = readVocabularyExamples(value.examples)
    .filter((example) =>
      normalizeLearningInlineText(example.sentence).toLocaleLowerCase()
        !== normalizeLearningInlineText(sourceSentence).toLocaleLowerCase(),
    )
    .slice(0, 3);

  return {
    kind: "word",
    // The viewer has already expanded the user's selection to a complete
    // lexical token. The model may classify its form, but must not reject it.
    selectionComplete: true,
    selectedWord: word,
    word: readLearningString(value.headword)
      || readLearningString(value.lemma)
      || readLearningString(value.word)
      || word,
    wordForm: readLearningString(value.wordForm)
      || readLearningString(value.inflection)
      || readLearningString(value.selectedFormType),
    namedEntityType: readLearningString(value.namedEntityType)
      || readLearningString(value.entityType),
    pronunciation: readLearningString(value.pronunciation)
      || readLearningString(value.phonetic),
    partsOfSpeech: senses.map(({ label, meaning }) => ({ label, meaning })),
    senses,
    forms,
    meaningInSentence,
    sentence: sourceSentence,
    sentenceTranslation,
    examples: generatedExamples,
  };
}



export function parseSentenceLearningResult(
  content: string,
  sourceText: string,
): SentenceLearningResult {
  const value = parseAiJson(content);
  const translation = readLearningString(value.translation);
  if (!translation) throw new Error("模型没有返回原句翻译。");
  const keywords = readLearningArray(value.keywords)
    .map((item): SentenceKeyword | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const word = readLearningString(record.word);
      const partOfSpeech = readLearningString(record.partOfSpeech)
        || readLearningString(record.pos);
      const meaningInSentence = readLearningString(record.meaningInSentence)
        || readLearningString(record.meaning);
      if (!word || !partOfSpeech || !meaningInSentence) return null;
      return {
        word,
        partOfSpeech,
        meaningInSentence,
        reason: readLearningString(record.reason),
      };
    })
    .filter((item): item is SentenceKeyword => Boolean(item))
    .slice(0, 8);
  return {
    kind: "sentence",
    sourceText: readLearningString(value.sourceTextLatex)
      || readLearningString(value.sourceText)
      || sourceText,
    translation,
    keywords,
  };
}



export function renderVocabularyLearningResult(result: VocabularyLearningResult): void {
  setTranslationLearningTitle("单词学习");
  translationLearningHintElement.textContent =
    "原句与完整翻译显示在上方；下方例句只用于扩展不同用法。";
  translationSourceSentenceField.hidden = false;
  translationSourceSentenceInput.value = result.sentence;
  autoResizeTranslationTextarea(translationSourceSentenceInput);
  renderTranslationMathPreview(
    translationSourceSentenceMathPreview,
    result.sentence,
  );
  renderLearningRichText(
    translationSourceSentenceTranslation,
    result.sentenceTranslation,
  );
  const card = createLearningElement("article", "english-learning-card word-card");
  const header = createLearningElement("div", "english-learning-header");
  const displayWord = result.selectedWord || result.word;
  const word = createLearningElement("strong", "english-learning-word", displayWord);
  header.append(word);
  if (result.pronunciation) {
    header.append(
      createLearningElement("span", "english-learning-pronunciation", result.pronunciation),
    );
  }
  card.append(header);

  const meta = createLearningElement("div", "english-learning-meta");
  if (result.word && result.word.toLocaleLowerCase() !== displayWord.toLocaleLowerCase()) {
    meta.append(createLearningElement("span", "english-learning-chip", `原形：${result.word}`));
  }
  if (result.wordForm) {
    meta.append(createLearningElement("span", "english-learning-chip", `当前词形：${result.wordForm}`));
  }
  if (result.namedEntityType) {
    meta.append(createLearningElement("span", "english-learning-chip", result.namedEntityType));
  }
  if (meta.childElementCount) card.append(meta);

  const meaning = createLearningElement("section", "english-learning-block");
  meaning.append(createLearningElement("h4", "english-learning-label", "文中含义"));
  meaning.append(
    renderLearningRichText(
      createLearningElement("div", "english-learning-context-meaning"),
      result.meaningInSentence,
    ),
  );
  if (result.partsOfSpeech.length) {
    const list = createLearningElement("dl", "english-pos-list");
    result.partsOfSpeech.forEach((part) => {
      const row = createLearningElement("div", "english-pos-row");
      row.append(
        createLearningElement("dt", "english-pos-tag", part.label),
        createLearningElement("dd", "english-pos-meaning", part.meaning),
      );
      list.append(row);
    });
    meaning.append(list);
  }
  card.append(meaning);

  const senses = createLearningElement("section", "english-learning-block");
  senses.append(createLearningElement("h4", "english-learning-label", "全部义项与英英释义"));
  const allSenses = result.senses.length
    ? result.senses
    : result.partsOfSpeech.map((part) => ({ ...part, definitionEn: "" }));
  if (!allSenses.length) {
    senses.append(createLearningElement("p", "english-learning-empty", "未返回可用义项。"));
  } else {
    const list = createLearningElement("div", "english-sense-list");
    allSenses.forEach((sense) => {
      const item = createLearningElement("article", "english-sense-card");
      const title = createLearningElement("div", "english-sense-title");
      title.append(
        createLearningElement("span", "english-pos-tag", sense.label),
        createLearningElement("strong", "english-sense-meaning", sense.meaning),
      );
      item.append(title);
      if (sense.definitionEn) {
        item.append(createLearningElement("p", "english-sense-definition", sense.definitionEn));
      }
      list.append(item);
    });
    senses.append(list);
  }
  card.append(senses);

  if (result.forms.length) {
    const forms = createLearningElement("section", "english-learning-block");
    forms.append(createLearningElement("h4", "english-learning-label", "词形变化"));
    const list = createLearningElement("div", "english-form-list");
    result.forms.forEach((form) => {
      const item = createLearningElement("span", "english-form-chip");
      item.append(
        createLearningElement("strong", "english-form-label", form.label),
        document.createTextNode(` ${form.value}`),
      );
      list.append(item);
    });
    forms.append(list);
    card.append(forms);
  }

  const examples = createLearningElement("section", "english-learning-block");
  examples.append(createLearningElement("h4", "english-learning-label", "例句"));
  result.examples.forEach((example, index) => {
    const item = createLearningElement("article", "english-example-card");
    const label = "例句 " + String(index + 1) + " · " + example.usage;
    item.append(createLearningElement("span", "english-example-label", label));
    item.append(
      renderLearningRichText(
        createLearningElement("div", "english-example-en"),
        example.sentence,
      ),
    );
    item.append(
      renderLearningRichText(
        createLearningElement("div", "english-example-zh"),
        example.translation,
      ),
    );
    examples.append(item);
  });
  card.append(examples);

  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(true);
}



export function renderSentenceLearningResult(result: SentenceLearningResult): void {
  setTranslationLearningTitle("原句翻译");
  translationLearningHintElement.textContent =
    "已给出当前选中原句的完整译文，并仅挑选值得学习的术语、学术表达或较难词汇。";
  // 原文预览只应由本地真实选区驱动。模型可能会重组原文，不能用其结果
  // 覆盖或清空用户实际选中的英文。
  const localSourceText = normalizeLearningInlineText(
    currentEnglishLearningSourceSentence.value ||
      selectedSnippetElement.value ||
      result.sourceText,
  );
  if (localSourceText) {
    selectedSnippetElement.value = localSourceText;
    selectedSnippetElement.removeAttribute("title");
    autoResizeTranslationTextarea(selectedSnippetElement);
  }
  setSelectedSnippetDisplayMode("preview");
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

  const keywords = createLearningElement("section", "english-learning-block");
  keywords.append(
    createLearningElement(
      "h4",
      "english-learning-label",
      "重点单词",
    ),
  );
  if (!result.keywords.length) {
    keywords.append(
      createLearningElement("p", "english-learning-empty", "这句话以常用词为主，暂时没有需要额外记忆的难词。"),
    );
  } else {
    const list = createLearningElement("div", "english-keyword-list");
    result.keywords.forEach((keyword) => {
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
    keywords.append(list);
  }
  card.append(keywords);
  translationResultElement.replaceChildren(card);
  translationResultElement.classList.remove("error");
  setMoreExamplesButtonVisible(false);
}



export function getEnglishLearningPlainText(): string {
  const result = currentEnglishLearningResult.value;
  if (!result) return "";

  if (result.kind === "sentence") {
    const keywordText = result.keywords.length
      ? result.keywords
          .map(
            (keyword) =>
              `- ${keyword.word}（${keyword.partOfSpeech}）：${keyword.meaningInSentence}`,
          )
          .join("\n")
      : "- 暂无需要额外记忆的难词";
    return ["原句翻译", result.translation, "", "重点词汇", keywordText].join("\n");
  }

  const partsOfSpeech = result.partsOfSpeech.length
    ? result.partsOfSpeech
        .map((part) => `- ${part.label}：${part.meaning}`)
        .join("\n")
    : "- 未返回词性释义";
  const examples = result.examples
    .map(
      (example, index) =>
        `例句 ${index + 1}（${example.usage}）\n${example.sentence}\n${example.translation}`,
    )
    .join("\n\n");
  return [
    `${result.word}${result.pronunciation ? ` ${result.pronunciation}` : ""}`,
    "",
    "文中原句",
    result.sentence,
    result.sentenceTranslation,
    "",
    "文中含义",
    result.meaningInSentence,
    "",
    "词性与释义",
    partsOfSpeech,
    "",
    "例句",
    examples,
  ].join("\n");
}
