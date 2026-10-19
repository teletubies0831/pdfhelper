import { browser } from 'wxt/browser';

import { webRetrievalConfig } from '../../app/public';
import { chatWebSearchTrigger } from '../../app/viewer-elements';
import { setStatus } from '../recent-files/public';
import type { AiRuntimeResponse } from '../../../modules/ai/public';

/**
 * The web-search switch beside the chat composer.
 *
 * Same control as 思考 on purpose: one boolean, shown as a colour, flipped by one click. What differs is the
 * precondition — web search is DeepSeek's Search API, so it needs a DeepSeek key. Without one the button is
 * grey and *not* actionable (the user's rule: no silent fallback to another provider, no half-working state),
 * but it still answers a hover with why it cannot be used.
 *
 * The state is deliberately not persisted: it spends money per question, so a reload starting grey is the
 * safe default. `isChatWebSearchEnabled()` is what the chat request reads.
 */

let enabled = false;

/**
 * Availability comes from the *resolved* settings, not from the chat route: the tools endpoints belong to
 * DeepSeek, so a user whose chat runs on another provider can still search — and a DeepSeek route with no key
 * still cannot.
 */
export function isChatWebSearchAvailable(): boolean {
  return webRetrievalConfig.value !== null;
}

/** True only when the switch is on *and* still usable, so a stale on-state cannot outlive its key. */
export function isChatWebSearchEnabled(): boolean {
  return enabled && isChatWebSearchAvailable();
}

export function syncChatWebSearchToggle(): void {
  const available = isChatWebSearchAvailable();
  if (!available) enabled = false;
  const on = available && enabled;
  chatWebSearchTrigger.classList.toggle('is-on', on);
  chatWebSearchTrigger.classList.toggle('is-unavailable', !available);
  chatWebSearchTrigger.setAttribute('aria-pressed', String(on));
  // `aria-disabled` rather than the `disabled` attribute: a disabled button receives no pointer events, so
  // its tooltip — the only place that explains how to enable it — would never appear.
  chatWebSearchTrigger.setAttribute('aria-disabled', String(!available));
  chatWebSearchTrigger.title = available
    ? `联网搜索：${on ? '开启' : '关闭'}（提问时检索网页，约 ¥0.005 一次）`
    : '联网搜索需要先配置 DeepSeek API Key：设置 → 模型与任务 → 联网检索';
}

export function toggleChatWebSearch(): void {
  if (!isChatWebSearchAvailable()) {
    syncChatWebSearchToggle();
    setStatus('联网搜索需要 DeepSeek 的 API Key：设置 → 模型与任务 → 联网检索。', true);
    return;
  }
  enabled = !enabled;
  syncChatWebSearchToggle();
}

/** Turns the switch off when the configuration goes away, so a stale "on" cannot outlive its key. */
export function disableChatWebSearch(): void {
  enabled = false;
  syncChatWebSearchToggle();
}

export interface ChatWebSearchNotes {
  /** Pre-formatted prompt material, with each hit's URL kept verbatim. */
  notes: string;
  hitCount: number;
  searchCalls: number;
}

/** Questions this short are usually pronouns ("它有什么局限？"), so the document title is added to the query. */
const SHORT_QUERY_CHARS = 12;

/**
 * Runs this turn's search in the service worker.
 *
 * One search per turn, results as context: the model cannot page through the web, which is what keeps a turn's
 * latency and cost predictable. `null` means the search found nothing — not an error, and not worth a line in the
 * answer.
 */
export async function fetchChatWebSearchNotes(
  question: string,
  documentLabel?: string,
): Promise<ChatWebSearchNotes | null> {
  const trimmed = question.trim();
  const query = trimmed.length < SHORT_QUERY_CHARS && documentLabel
    ? `${trimmed} ${documentLabel}`.trim()
    : trimmed;
  const response = await browser.runtime.sendMessage({
    type: 'pdf-helper:ai-web-search',
    requestId: `web-search:${crypto.randomUUID()}`,
    query: query.slice(0, 128),
    oriQuestion: trimmed.slice(0, 128),
  }) as AiRuntimeResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || '联网检索失败。');
  const hits = response.webSearch?.hits ?? [];
  if (!hits.length) return null;
  return {
    notes: hits
      .map((hit, index) => [
        `[${index + 1}] ${hit.title}`,
        `URL：${hit.url}`,
        hit.summary ? `摘要：${hit.summary.slice(0, 600)}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n'),
    hitCount: hits.length,
    searchCalls: response.webSearch?.searchCalls ?? 1,
  };
}
