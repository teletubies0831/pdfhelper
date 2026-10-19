import type { ProviderMessage } from "../../modules/ai/public";
import type { AiTranslationStreamStartMessage } from "../../modules/ai/public";

/**
 * Prompts for the two halves of the translation card.
 *
 * Both are deliberately small, and neither goes through `buildSystemContent()`. That function builds the *chat*
 * assistant: agent-tool rules, memory upsert rules and the `[[PDF:P8|原文]]` citation contract — roughly two thousand
 * tokens of instructions that a one-sentence translation must pay for on every request and that actively invite the
 * model to answer like a document assistant instead of emitting one short JSON object.
 *
 * Two other decisions worth knowing:
 *
 * - **The translation half asks for plain text, not JSON.** Streaming a JSON object means the reader waits for a
 *   closing brace before anything can be rendered; plain text can be shown character by character. The LaTeX-ised
 *   copy of the *source* sentence therefore moved to the keyword half, which already returns JSON.
 * - **No `reason` field.** The old prompt asked the model to state its internal justification for every candidate
 *   word and then re-check it — inside the response, where it was parsed and thrown away. That was a large share of
 *   the output tokens on the slowest possible path.
 */

/**
 * Output budgets.
 *
 * These are **caps, not targets**, and they are deliberately much larger than the answer: on providers where thinking
 * cannot be switched off, reasoning tokens are billed against the same `max_tokens` budget. The first version used 512
 * and 768 and the reported result was a translation cut off mid-parenthesis plus "模型没有返回有效 JSON" for the words —
 * reasoning had eaten the budget before the answer finished. `overview-completion.ts` documents the same trap.
 */
export const TRANSLATION_STREAM_MAX_TOKENS = 2_048;
export const KEYWORD_STREAM_MAX_TOKENS = 3_072;
/** The card shows six; more than that is a vocabulary dump, not a reading aid. */
export const MAX_SENTENCE_KEYWORDS = 6;

function preferenceLines(preferenceBlock: string | undefined): string[] {
  const block = preferenceBlock?.trim();
  return block ? [block] : [];
}

/** Phase one: the translation, as text. */
export function buildSentenceTranslationMessages(
  input: AiTranslationStreamStartMessage,
): ProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是英译中的学术译者。把用户给出的英文句子翻译成准确、通顺的简体中文。",
        "只输出译文本身：不要原文、不要解释、不要 Markdown 代码块、不要 JSON、不要任何前后缀。",
        "保留专业术语的通行译法；人名、方法名、数据集名等专有名词保留原文。",
        "原文中的数学关系必须保留，公式用 LaTeX：行内 $...$，独立公式 $$...$$。",
        ...preferenceLines(input.preferenceBlock),
      ].join("\n"),
    },
    { role: "user", content: input.text },
  ];
}

/**
 * Phase two: the words worth learning, as JSON.
 *
 * The inclusion/exclusion criteria stay — they are what makes the list worth reading — but they are stated once, as a
 * rubric, instead of demanding a written justification per candidate.
 */
export function buildSentenceKeywordMessages(
  input: AiTranslationStreamStartMessage,
): ProviderMessage[] {
  const schema = input.wantsSourceLatex
    ? '{"sourceTextLatex":"保留完整英文原句并把公式重建为 $...$ 或 $$...$$","keywords":[{"word":"原文词或短语","partOfSpeech":"词性","meaningInSentence":"在本句中的准确含义"}]}'
    : '{"keywords":[{"word":"原文词或短语","partOfSpeech":"词性","meaningInSentence":"在本句中的准确含义"}]}';
  return [
    {
      role: "system",
      content: [
        "你是面向英语学习者的阅读助手，任务是从一个英文句子中挑出值得学习的重点词。",
        "筛选标准（满足其一即可）：CET-6 及以上或 CEFR B2+ 难度；在当前学科中具有区别于日常含义的专业义；理解本句所必需的规范术语；低频、不可按字面直接理解、或作者自造的固定搭配。",
        "排除：高频基础词与功能词、仅由时态或复数变化而来的普通词形、可由组成部分直接推断含义的常用组合、研究生读者无需查词即可理解的一般表达。",
        `最多 ${MAX_SENTENCE_KEYWORDS} 个，宁少勿滥；没有合格项时 keywords 返回空数组。`,
        "meaningInSentence 用不超过 20 字的中文说明它在这句话里具体指什么，不要罗列词典义项。",
        input.wantsSourceLatex
          ? "本句含公式，请同时返回 sourceTextLatex：保留英文原句的全部文字与标点，只把其中的公式重建为 LaTeX，不要翻译、概括或删减原句。"
          : "",
        "严格只输出一个 JSON 对象，不要 Markdown、代码块或任何额外说明。",
        `JSON 格式：${schema}`,
        ...preferenceLines(input.preferenceBlock),
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: input.text },
  ];
}

/** Messages for one stream request, chosen by task. */
export function buildTranslationStreamMessages(
  input: AiTranslationStreamStartMessage,
): ProviderMessage[] {
  return input.task === "translation"
    ? buildSentenceTranslationMessages(input)
    : buildSentenceKeywordMessages(input);
}
