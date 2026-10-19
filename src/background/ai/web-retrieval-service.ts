import { aiConnectionCatalog, type AiWebRetrievalUsage } from "../../modules/ai/public";
import {
  describeWebRetrievalError,
  searchWeb,
} from "./deepseek-tools-client";
import {
  buildRelatedLiteratureSection,
  type RelatedLiteratureResult,
} from "./related-literature-service";
import type { AiProviderAdapter } from "./provider-runtime";
import type { AiConfig } from "../../modules/ai/public";

/**
 * The two entry points that spend DeepSeek tool calls: the settings probe and 「检索相关论文」.
 *
 * Both resolve the retrieval configuration inside the service worker rather than accepting it from the page,
 * so the key never travels through a message and there is one place that decides "is this configured".
 */

/** One search with a fixed query: enough to prove the key, the address and the balance. */
export async function probeWebRetrieval(): Promise<{
  ok: boolean;
  content?: string;
  error?: string;
}> {
  const config = await aiConnectionCatalog.resolveWebRetrievalConfig();
  if (!config) {
    return {
      ok: false,
      error: '还没有可用的联网检索配置：请填写 DeepSeek API Key，或先添加一个 DeepSeek 供应商连接。',
    };
  }
  const startedAt = Date.now();
  try {
    const hits = await searchWeb(config, {
      query: 'PDFPal PDF 阅读助手',
      count: 3,
      needContent: false,
      signal: AbortSignal.timeout(20_000),
    });
    const elapsed = ((Date.now() - startedAt) / 1_000).toFixed(1);
    // Empty results are a normal answer and are not billed; saying "1 次调用" there would be wrong.
    const billed = hits.length ? '1 次成功调用（约 ¥0.005）' : '0 次计费（没有结果）';
    return {
      ok: true,
      content: hits.length
        ? `联网检索可用：返回 ${hits.length} 条结果，耗时 ${elapsed}s，${billed}。示例：${hits[0]?.title ?? ''}`
        : `联网检索可用，但这次查询没有返回结果（不计费），耗时 ${elapsed}s。`,
    };
  } catch (error) {
    return { ok: false, error: describeWebRetrievalError(error) };
  }
}

export async function generateRelatedLiterature(
  adapter: AiProviderAdapter,
  config: AiConfig,
  input: { documentName: string; overviewMarkdown: string },
): Promise<RelatedLiteratureResult> {
  return buildRelatedLiteratureSection(adapter, config, {
    documentName: input.documentName,
    overviewMarkdown: input.overviewMarkdown,
    webRetrieval: await aiConnectionCatalog.resolveWebRetrievalConfig(),
  });
}

/** Candidates per chat turn: enough to ground an answer, few enough to stay inside one prompt. */
const CHAT_SEARCH_COUNT = 5;

/**
 * One search for a chat turn.
 *
 * `null` means "web retrieval is not configured" — the caller then answers without notes rather than failing. A
 * thrown error is a real failure the caller reports in the turn's activity row; it must never sink the answer,
 * because the switch is an enrichment, not the question.
 */
export async function searchForChat(input: {
  query: string;
  oriQuestion?: string;
}): Promise<{ hits: Array<{ title: string; url: string; summary: string }>; searchCalls: number } | null> {
  const config = await aiConnectionCatalog.resolveWebRetrievalConfig();
  if (!config) return null;
  const hits = await searchWeb(config, {
    query: input.query,
    count: Math.min(config.count, CHAT_SEARCH_COUNT),
    // Chat only needs the summary: the page body would cost prompt space for facts a 800-character summary
    // already carries.
    needContent: false,
    oriQuestion: input.oriQuestion,
    signal: AbortSignal.timeout(20_000),
  });
  return {
    hits: hits.map((hit) => ({
      title: hit.title,
      url: hit.url,
      summary: hit.summary || hit.snippet,
    })),
    searchCalls: 1,
  };
}

export type { AiWebRetrievalUsage };
