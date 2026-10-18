import { browser } from 'wxt/browser';

import {
  AI_EXPLANATION_STREAM_PORT_NAME,
  type AiEntityExplainItem,
  type AiExplanationStreamServerMessage,
} from '../../../modules/ai/public';

/**
 * Streams one entity's meaning from the background.
 *
 * Mirrors `chat-session.ts`'s port handling (`started` / `delta` / `done` / `error`), minus the tool
 * rounds: the panel needs the sentence as it is written, so `onDelta` fires per chunk and the caller
 * patches the text it is already showing. Everything that can go wrong here — the port closing, the
 * worker going away, a provider error — becomes a rejected promise with a readable reason, because
 * the caller has a button whose state has to end up back to normal.
 */

/** Generous but bounded: a one-sentence answer that takes longer than this is not worth waiting for. */
const STREAM_TIMEOUT_MS = 60_000;

/** Error names the action layer switches on: one is recoverable, the other is not. */
export const EXPLANATION_PORT_UNAVAILABLE = 'ExplanationPortUnavailable';
export const EXPLANATION_STREAM_INTERRUPTED = 'ExplanationStreamInterrupted';

/**
 * The browser's own disconnect reason, when it gives one.
 *
 * "Could not establish connection. Receiving end does not exist." is the precise signature of a
 * background that has no handler for this port — which in practice means the extension's service
 * worker is older than the page (a page refresh reloads the viewer chunks, not the background).
 */
function readDisconnectReason(): string {
  try {
    const runtime = browser.runtime as unknown as { lastError?: { message?: string } };
    return runtime.lastError?.message?.trim() ?? '';
  } catch {
    return '';
  }
}

export interface ExplanationStreamHandlers {
  /** Called for every chunk of new text (not the accumulated text). */
  onDelta(delta: string): void;
}

export function streamEntityExplanation(
  item: AiEntityExplainItem,
  handlers: ExplanationStreamHandlers,
): Promise<string> {
  const requestId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: AI_EXPLANATION_STREAM_PORT_NAME });

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let content = '';
    const timer = setTimeout(() => {
      finish(() => reject(new Error('解释生成超时，请稍后再试。')));
    }, STREAM_TIMEOUT_MS);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
      try {
        port.disconnect();
      } catch {
        // The background may already have closed the port.
      }
    };

    port.onMessage.addListener((value: unknown) => {
      const message = value as AiExplanationStreamServerMessage;
      if (!message || message.requestId !== requestId) return;
      if (message.type === 'delta') {
        content += message.content;
        handlers.onDelta(message.content);
        return;
      }
      if (message.type === 'done') {
        finish(() => resolve(content));
        return;
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.error)));
      }
    });

    port.onDisconnect.addListener(() => {
      // A disconnect after `done`/`error` is normal; before them it means the background went away
      // mid-request — or was never listening, which is what a stale service worker looks like.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const reason = readDisconnectReason();
      const partial = content.trim().length > 0;
      const error = new Error(
        partial
          ? '解释生成中断（后台已断开），请重试。'
          : `后台没有响应流式解释端口${reason ? `（${reason}）` : ''}。`,
      );
      error.name = partial ? EXPLANATION_STREAM_INTERRUPTED : EXPLANATION_PORT_UNAVAILABLE;
      reject(error);
    });

    port.postMessage({
      type: 'start',
      requestId,
      item,
    });
  });
}
