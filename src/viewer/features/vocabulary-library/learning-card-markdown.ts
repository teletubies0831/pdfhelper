import type { EnglishLearningResult } from "../../core/pdf-reader/public";

function markdownList(items: string[], fallback: string): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

export function getVocabularyCardTerm(result: EnglishLearningResult): string {
  if (result.kind === "word") return result.word || result.selectedWord;
  const compact = result.sourceText.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

export function getVocabularyCardPartOfSpeech(
  result: EnglishLearningResult,
): string {
  if (result.kind === "sentence") return "句子";
  const labels = result.partsOfSpeech.map((item) => item.label).filter(Boolean);
  return labels.slice(0, 3).join(" / ") || result.wordForm;
}

export function formatLearningResultAsMarkdown(
  result: EnglishLearningResult,
): string {
  if (result.kind === "sentence") {
    const keywords = result.keywords.map((keyword) =>
      `**${keyword.word}**（${keyword.partOfSpeech}）— ${keyword.meaningInSentence}${
        keyword.reason ? `  \n_${keyword.reason}_` : ""
      }`,
    );
    return [
      "## 原句",
      result.sourceText,
      "",
      "## 翻译",
      result.translation,
      "",
      "## 重点词汇",
      markdownList(keywords, "- 暂无需要额外记忆的难词"),
    ].join("\n");
  }

  const senses = result.senses.length
    ? result.senses.map((sense) =>
        `**${sense.label}** ${sense.meaning}${
          sense.definitionEn ? `  \n${sense.definitionEn}` : ""
        }`,
      )
    : result.partsOfSpeech.map(
        (part) => `**${part.label}** ${part.meaning}`,
      );
  const forms = result.forms.map(
    (form) => `**${form.label}：** ${form.value}`,
  );
  const examples = result.examples.flatMap((example) => [
    `> ${example.sentence}`,
    `> ${example.translation}`,
    example.usage ? `_${example.usage}_` : "",
    "",
  ]).filter(Boolean);

  return [
    "## 文中含义",
    result.meaningInSentence,
    "",
    "## 文中原句",
    `> ${result.sentence}`,
    `> ${result.sentenceTranslation}`,
    "",
    "## 词性与释义",
    markdownList(senses, "- 暂无词性释义"),
    ...(forms.length ? ["", "## 词形变化", markdownList(forms, "")] : []),
    "",
    "## 例句",
    ...(examples.length ? examples : ["- 暂无例句"]),
  ].join("\n").trim();
}
