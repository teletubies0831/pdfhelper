import { browser } from 'wxt/browser';

import {
  AI_TRANSLATION_STREAM_PORT_NAME,
  type AiTranslationStreamServerMessage,
  type AiTranslationStreamTask,
} from '../../../modules/ai/public';

/**
 * Streams one half of the translation card from the background.
 *
 * Same shape as `graph-explanation-stream.ts` (`started` / `delta` / `done` / `error`), with the same three failure
 * names the caller switches on: a port that was never listened to (a service worker older than the page), a stream
 * that broke halfway, and a plain error. The caller needs them apart because the first is recoverable with an older
 * code path while the others are not.
 */

/** Generous but bounded: a sentence that takes longer than this is not worth holding the card open for. */
const STREAM_TIMEOUT_MS = 60_000;

export const TRANSLATION_PORT_UNAVAILABLE = 'TranslationPortUnavailable';
export const TRANSLATION_STREAM_INTERRUPTED = 'TranslationStreamInterrupted';

function readDisconnectReason(): string {
  try {
    const runtime = browser.runtime as unknown as { lastError?: { message?: string } };
    return runtime.lastError?.message?.trim() ?? '';
  } catch {
    return '';
  }
}

export interface TranslationStreamRequest {
  task: AiTranslationStreamTask;
  text: string;
  sentence?: string;
  wantsSourceLatex?: boolean;
  preferenceBlock?: string;
}

/**
 * True when a sentence carries maths worth rebuilding as LaTeX.
 *
 * Decided here rather than in the prompt: asking the model to re-emit a plain sentence as JSON is a waste of output
 * tokens and a chance for it to mangle the text, so the extra field is only requested when there is something to
 * convert.
 */
export function sentenceNeedsLatex(sentence: string): boolean {
  return /[$\\]|[\u0370-\u03ff\u2200-\u22ff\u2211\u221a\u2264\u2265\u2260\u00b1\u00d7\u00f7]|\^\{|_\{/.test(
    sentence,
  );
}

export interface TranslationStreamHandlers {
  /** Called for every chunk of new text (not the accumulated text). */
  onDelta?(delta: string): void;
  /** Called when the background accepted the request, i.e. the wait is a model wait, not a plumbing problem. */
  onStarted?(): void;
  /** Cancels the request: the port closes and the background aborts the provider call. */
  signal?: AbortSignal;
}

export interface TranslationStreamResult {
  text: string;
  /** The provider stopped at its output limit: the text is a prefix, not an answer. */
  truncated: boolean;
}

/** Resolves with the accumulated text once the stream is done. */
export function streamTranslationHalf(
  request: TranslationStreamRequest,
  handlers: TranslationStreamHandlers = {},
): Promise<TranslationStreamResult> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_TRANSLATION_STREAM_PORT_NAME });

  return new Promise<TranslationStreamResult>((resolve, reject) => {
    let settled = false;
    let content = '';
    const timer = setTimeout(() => {
      finish(() => reject(new Error('翻译请求超时，请稍后再试。')));
    }, STREAM_TIMEOUT_MS);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handlers.signal?.removeEventListener('abort', handleAbort);
      callback();
      try {
        port.disconnect();
      } catch {
        // The background may already have closed the port.
      }
    };

    // Aborting closes the port, which is what tells the background to stop spending tokens on a sentence the reader
    // has already moved on from.
    const handleAbort = (): void => {
      finish(() => reject(new DOMException('翻译已取消。', 'AbortError')));
    };
    if (handlers.signal?.aborted) {
      handleAbort();
      return;
    }
    handlers.signal?.addEventListener('abort', handleAbort, { once: true });

    port.onMessage.addListener((value: unknown) => {
      const message = value as AiTranslationStreamServerMessage;
      if (!message || message.requestId !== requestId) return;
      if (message.type === 'started') {
        handlers.onStarted?.();
        return;
      }
      if (message.type === 'delta') {
        content += message.content;
        handlers.onDelta?.(message.content);
        return;
      }
      if (message.type === 'done') {
        const truncated = message.finishReason === 'length';
        finish(() => resolve({ text: content, truncated }));
        return;
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.error)));
      }
    });

    port.onDisconnect.addListener(() => {
      // A disconnect after `done`/`error` is normal; before them it means the background went away mid-request — or
      // was never listening, which is what a stale service worker looks like.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const reason = readDisconnectReason();
      const partial = content.trim().length > 0;
      const error = new Error(
        partial
          ? '翻译中断（后台已断开），请重试。'
          : `后台没有响应翻译流式端口${reason ? `（${reason}）` : ''}。`,
      );
      error.name = partial ? TRANSLATION_STREAM_INTERRUPTED : TRANSLATION_PORT_UNAVAILABLE;
      reject(error);
    });

    port.postMessage({ type: 'start', requestId, ...request });
  });
}
