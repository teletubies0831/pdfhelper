import {
  getSafeProviderErrorDetails,
  type AiConfig,
  type AiDocumentMetadata,
  type ProviderMessage,
} from "../../modules/ai/public";
import type { AiProviderAdapter } from "./provider-runtime";

/**
 * 文献元数据抽取：作者、出版日期、语言、URL、DOI.
 *
 * One short call over the first pages, made when a document enters the library. It reads the *document* — no DOI
 * service or Crossref lookup is contacted, because that would need another credential and another failure mode for
 * a field the first page usually states outright.
 *
 * The prompt's most important instruction is "没写就留空": a model that guesses an author from a citation in the
 * introduction, or invents a DOI to look helpful, produces a record the user will cite wrongly. Empty is a result.
 */

const METADATA_INSTRUCTIONS = [
  "你是文献元数据抽取器。阅读给出的一段 PDF 首页/前几页正文，抽取书目光标字段。",
  "只输出一个 JSON 对象，不要输出解释、Markdown 或代码围栏之外的任何文字。",
  "字段：authors（字符串数组，按原文顺序，逐个人名；单字母缩写保留原文写法）、publishDate（出版或发布日期的原文写法，尽量写成 2026 或 2026-10 或 2026-10-18）、language（正文语言，两字母语言码，如 en、zh）、documentUrl（正文中出现的本文链接，通常是 arXiv、出版社或项目页；没有就不填）、doi（形如 10.xxxx/yyyy 的 DOI，去掉 https://doi.org/ 前缀；没有就不填）。",
  "规则：",
  "1. 文档里明确写出的才填；没有就填空字符串或空数组，绝对不要猜测、不要编造、不要把参考文献里的作者或 DOI 当成这篇文档的。",
  "2. 作者只取本文作者（标题下方、摘要上方），不要取参考文献、致谢或编辑。",
  "3. 如果这是书籍、报告、说明书、合同等非论文文档，同样按封面/首页信息填写；确实没有作者就留空。",
  "4. 不确定的字段一律留空，宁可少填也不要写“unknown”“N/A”“未知”。",
].join("\n");

/** The fields the prompt asks for; used to tell "the model answered in an unreadable shape" from "nothing found". */
const METADATA_KEYS = [
  "authors", "author", "publishDate", "publish_date", "date",
  "language", "documentUrl", "url", "link", "doi", "DOI",
];

const EMPTY: AiDocumentMetadata = {
  authors: [],
  publishDate: "",
  language: "",
  documentUrl: "",
  doi: "",
};

/** `text` is capped so one pathological first page cannot turn a cheap call into an expensive one. */
const MAX_TEXT = 6_000;

/** Strips the answer down to the object: models wrap JSON in fences or add a sentence before it. */
function extractJsonObject(content: string): string | null {
  const withoutFences = content
    .replace(/^[\s\S]*?```(?:json)?\s*/i, "")
    .replace(/\s*```[\s\S]*$/, "")
    .trim();
  // A bare array is not the shape we asked for; taking the first object out of one would mean guessing which answer
  // the model thought it was giving.
  if (withoutFences.startsWith("[") || content.trim().startsWith("[")) return null;
  const candidate = withoutFences.startsWith("{") ? withoutFences : content.slice(content.indexOf("{"));
  if (!candidate.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') inString = !inString;
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(0, index + 1);
    }
  }
  return null;
}

/**
 * Reads the model's answer into the five fields, keeping whatever is usable.
 *
 * Field-level normalization (bare DOI, http-only links, deduplicated authors) happens in the knowledge module, which
 * is the single owner of what a stored metadata value looks like. This function only decides *which* strings the
 * model offered — being liberal here means a slightly malformed answer still yields a usable record.
 */
export function parseDocumentMetadataJson(content: string): AiDocumentMetadata | null {
  const json = extractJsonObject(content);
  if (!json) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  /** `{"name": "X"}` / `{"display_name": "X"}` are common shapes for one author; read the name out of them. */
  const authorText = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      return text(item.name) || text(item.display_name) || text(item.displayName) || text(item.full_name);
    }
    return "";
  };
  const authors = Array.isArray(record.authors)
    ? record.authors.map(authorText).filter(Boolean)
    : authorText(record.authors)
      ? [authorText(record.authors)]
      : [];
  const parsed: AiDocumentMetadata = {
    authors,
    publishDate: text(record.publishDate) || text(record.date) || text(record.publish_date),
    language: text(record.language),
    documentUrl: text(record.documentUrl) || text(record.url) || text(record.link),
    doi: text(record.doi) || text(record.DOI),
  };
  // A field the model *did* answer but in a shape none of the keys above cover: say so instead of reporting "found
  // nothing", otherwise the caller stores a silently empty record and never offers a retry. An explicitly empty answer
  // (`{"authors":[],"doi":""}`) is not such a case — that is the legitimate "this document states none of it" result.
  const hasValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.some(hasValue);
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  };
  const answeredSomething = METADATA_KEYS.some((key) => hasValue(record[key]));
  const readSomething = authors.length > 0 || Boolean(parsed.publishDate || parsed.language
    || parsed.documentUrl || parsed.doi);
  if (answeredSomething && !readSomething) {
    return { ...parsed, degraded: "模型返回的元数据字段无法识别，可以重试。" };
  }
  return parsed;
}

/**
 * Output budgets, tried in order.
 *
 * The first version asked for 1 024 tokens on the theory that a five-field JSON answer is a few hundred. That is true
 * of the *answer*, and wrong about the *call*: on a model that will not stop thinking, the reasoning block is billed
 * against the same budget, so the request came back as `finish_reason: length` with an empty `content` — the exact
 * failure the overview path had already been fixed for. The ladder gives the cheap case a cheap call and still
 * recovers on a model that spends a thousand tokens thinking before it writes `{`.
 */
const OUTPUT_BUDGETS = [2_048, 4_096, 8_192];

/** True when the failure is "the output budget ran out", by either of the two shapes providers report it in. */
function ranOutOfBudget(error: unknown): boolean {
  const details = getSafeProviderErrorDetails(error);
  return details.finishReason === "length"
    || (details.contentLength === 0 && (details.reasoningLength ?? 0) > 0);
}

export async function extractDocumentMetadata(
  adapter: AiProviderAdapter,
  config: AiConfig,
  input: { documentName: string; text: string },
): Promise<AiDocumentMetadata> {
  const sourceText = input.text.trim().slice(0, MAX_TEXT);
  if (!sourceText) {
    return { ...EMPTY, degraded: "没有可用的首页正文，元数据留空。" };
  }
  const messages: ProviderMessage[] = [
    { role: "system", content: METADATA_INSTRUCTIONS },
    {
      role: "user",
      content: `文件名：${input.documentName || "未提供"}\n\n首页正文：\n${sourceText}`,
    },
  ];
  // Thinking is switched off when the provider allows it; when it does not, the ladder below is what keeps this call
  // from failing outright.
  const taskConfig: AiConfig = { ...config, reasoning: "disabled" };

  for (const [index, budget] of OUTPUT_BUDGETS.entries()) {
    const isLastBudget = index === OUTPUT_BUDGETS.length - 1;
    let content: string;
    let finishReason: string | undefined;
    try {
      const result = await adapter.chat(taskConfig, messages, budget);
      content = result.content;
      finishReason = result.completion?.finishReason;
    } catch (error) {
      // A budget failure is worth one more try with more room; anything else (auth, network, policy) is not.
      if (!isLastBudget && ranOutOfBudget(error)) continue;
      throw error;
    }
    const parsed = parseDocumentMetadataJson(content);
    if (parsed) return parsed;
    // Truncated JSON may simply need more room. A complete-but-not-JSON answer will not improve with a bigger budget,
    // so it stops here rather than spending two more calls to learn nothing.
    if (finishReason === "length" && !isLastBudget) continue;
    console.info("[PDFPal 元数据] 模型没有返回可解析的 JSON", content.slice(0, 200));
    return {
      ...EMPTY,
      degraded: finishReason === "length"
        ? "模型输出被截断，没能给出完整的元数据 JSON。请换用支持关闭思考的模型后重试。"
        : "模型没有返回可解析的元数据 JSON。",
    };
  }
  return {
    ...EMPTY,
    degraded: "模型输出一直被截断，没能给出完整的元数据 JSON。请换用支持关闭思考的模型后重试。",
  };
}
