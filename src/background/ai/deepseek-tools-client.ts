import type { AiWebRetrievalConfig, AiWebRetrievalUsage } from "../../modules/ai/public";

/**
 * DeepSeek's Search / Fetch tools (`POST <base>/search`, `POST <base>/fetch`).
 *
 * Two properties of the upstream API shape this client:
 *
 * - **Billing is per successful request**, not per result and not per token: a search that returns nothing is
 *   free, and `count` does not change the price. So asking for more candidates costs nothing extra, and a
 *   retry with a different query after an empty answer is free as well.
 * - **The error codes mean different things** and only some are worth retrying: 408/429/5xx are transient,
 *   while 401 (bad key), 402 (no balance), 403 (blocked) and 404 (page unavailable) are answers, not failures
 *   to repeat. The classes below carry that distinction so no caller has to re-read the status codes.
 */

export type WebRetrievalFailure =
  | 'auth'
  | 'balance'
  | 'blocked'
  | 'unavailable'
  | 'rate-limit'
  | 'server'
  | 'request'
  | 'network';

export class WebRetrievalError extends Error {
  constructor(
    message: string,
    readonly failure: WebRetrievalFailure,
    readonly httpStatus: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WebRetrievalError';
  }
}

/** One search hit, as far as PDFPal uses it. */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  /** Longer abstract-quality text (600–800 chars upstream); the field the model should read. */
  summary: string;
  /** Page body in Markdown when `need_content` was on, else ''. */
  content: string;
  siteName: string;
  /** RFC 3339 date or ''. */
  date: string;
  /** 0–4, -1 when unknown. */
  authority: number;
  rerankScore: number;
}

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_200;
/** Everything `content` larger than this is dropped at parse time; the prompt never needs more. */
export const MAX_CONTENT_CHARS = 6_000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function failureFor(status: number): { failure: WebRetrievalFailure; retryable: boolean } {
  if (status === 401) return { failure: 'auth', retryable: false };
  if (status === 402) return { failure: 'balance', retryable: false };
  if (status === 403) return { failure: 'blocked', retryable: false };
  if (status === 404) return { failure: 'unavailable', retryable: false };
  if (status === 429) return { failure: 'rate-limit', retryable: true };
  if (status === 408 || status >= 500) return { failure: 'server', retryable: true };
  return { failure: 'request', retryable: false };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: unknown } };
    const message = text(payload?.error?.message).trim();
    if (message) return message;
  } catch {
    // A non-JSON body (a proxy error page) says nothing usable; the status code carries the meaning.
  }
  return response.statusText || "联网检索失败";
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("Retry-After");
  if (!header) return RETRY_DELAY_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(3_000, Math.max(0, seconds * 1_000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(3_000, Math.max(0, at - Date.now())) : RETRY_DELAY_MS;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * POSTs one tools request, retrying only the transient failures and only once.
 *
 * Deliberately not routed through `createRateLimitedRequester`: that queue partitions by chat base URL and
 * backs off for a minute at a time, which is right for a streamed conversation and wrong for one optional
 * lookup that must finish inside a 30-second budget.
 */
async function postTools<T>(
  config: AiWebRetrievalConfig,
  endpoint: 'search' | 'fetch',
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/${endpoint}`;
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  for (let attempt = 0; ; attempt += 1) {
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new WebRetrievalError(
        error instanceof Error && error.name === "TimeoutError"
          ? "联网检索超时"
          : "联网检索请求失败",
        'network',
        0,
        true,
      );
    }
    if (response.ok) return await response.json() as T;

    const { failure, retryable } = failureFor(response.status);
    const message = await readErrorMessage(response);
    if (!retryable || attempt >= 1) {
      throw new WebRetrievalError(
        `${message}（HTTP ${response.status}）`,
        failure,
        response.status,
        retryable,
      );
    }
    await wait(retryAfterMs(response));
    if (signal?.aborted) throw signal.reason;
  }
}

export interface WebSearchOptions {
  query: string;
  /** 1–50 upstream; the configured default is 8. */
  count: number;
  /** Ask for the page body in the same response — it costs nothing extra and saves a fetch per page. */
  needContent?: boolean;
  /** The user's original question, when there is one; helps the engine read the intent. */
  oriQuestion?: string;
  signal?: AbortSignal;
}

/** Runs one search. An empty array is a normal answer (and is not billed) — not an error. */
export async function searchWeb(
  config: AiWebRetrievalConfig,
  options: WebSearchOptions,
): Promise<WebSearchHit[]> {
  const query = options.query.trim().slice(0, 128);
  if (!query) return [];
  const payload = await postTools<{ results?: unknown }>(config, 'search', {
    query,
    // Documented range is 1–50; a 0 or a NaN falls back to the minimum rather than silently asking for 8.
    count: Math.min(50, Math.max(1, Math.trunc(options.count) || 1)),
    need_content: options.needContent === true,
    ...(options.oriQuestion?.trim()
      ? { ori_question: options.oriQuestion.trim().slice(0, 128) }
      : {}),
  }, options.signal);
  if (!Array.isArray(payload?.results)) return [];
  const hits: WebSearchHit[] = [];
  for (const raw of payload.results) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const url = text(entry.url).trim();
    const title = text(entry.title).trim();
    if (!url || !title) continue;
    hits.push({
      title,
      url,
      snippet: text(entry.snippet).trim(),
      summary: text(entry.summary).trim(),
      content: text(entry.content).slice(0, MAX_CONTENT_CHARS),
      siteName: text(entry.site_name).trim(),
      date: text(entry.date).trim(),
      authority: num(entry.authority, -1),
      rerankScore: num(entry.rerank_score, 0),
    });
  }
  return hits;
}

/** Fetches one page as Markdown. Throws `WebRetrievalError` with failure `unavailable` when there is no body. */
export async function fetchPage(
  config: AiWebRetrievalConfig,
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string }> {
  const payload = await postTools<{ title?: unknown; content?: unknown }>(
    config,
    'fetch',
    { url },
    signal,
  );
  const content = text(payload?.content).trim();
  if (!content) {
    throw new WebRetrievalError('目标页面没有可用的正文', 'unavailable', 404, false);
  }
  return { title: text(payload?.title).trim(), content: content.slice(0, MAX_CONTENT_CHARS) };
}

/** A short, user-facing sentence for the settings page and the overview dialog. */
export function describeWebRetrievalError(error: unknown): string {
  if (!(error instanceof WebRetrievalError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.failure) {
    case 'auth':
      return 'DeepSeek 拒绝了联网检索的 API Key（HTTP 401），请检查密钥是否有效。';
    case 'balance':
      return 'DeepSeek 账户余额不足，联网检索已停止（HTTP 402）。';
    case 'blocked':
      return `目标网页被安全策略拒绝（HTTP 403）：${error.message}`;
    case 'unavailable':
      return `没有抓取到网页正文（HTTP 404）：${error.message}`;
    case 'rate-limit':
      return '联网检索触发了限流（HTTP 429），已重试一次仍失败，请稍后重试。';
    case 'server':
      return `联网检索服务暂时不可用（HTTP ${error.httpStatus || '5xx'}），请稍后重试。`;
    case 'network':
      return `联网检索请求失败：${error.message}`;
    default:
      return `联网检索请求被拒绝：${error.message}`;
  }
}

export function addUsage(
  usage: AiWebRetrievalUsage,
  field: keyof AiWebRetrievalUsage,
): AiWebRetrievalUsage {
  return { ...usage, [field]: usage[field] + 1 };
}
