import { browser } from 'wxt/browser';

import {
  AI_EXPLANATION_STREAM_PORT_NAME,
  type AiExplanationStreamServerMessage,
  type AiExplanationStreamStartMessage,
} from '../../modules/ai/public';
import { getAiConfig } from './ai-config-repository';
import { streamEntityExplanation } from './entity-explanation-service';
import { getProviderAdapter } from './provider-runtime';
import { withAiRequestLifetime } from './request-lifetime';

/**
 * The explanation stream port.
 *
 * A dedicated port rather than a `sendMessage` call for one reason: the panel shows the sentence
 * while it is being written. A one-shot response leaves the user with a disabled button and no idea
 * whether anything is happening — which is exactly the failure this is meant to end.
 *
 * The shape mirrors the chat stream (`started` / `delta` / `done` / `error`) so the viewer client
 * reads the same way, but there is no tool round and no conversation: one item in, one sentence out.
 */

function isStartMessage(value: unknown): value is AiExplanationStreamStartMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiExplanationStreamStartMessage>;
  return candidate.type === 'start'
    && typeof candidate.requestId === 'string'
    && Boolean(candidate.item && typeof candidate.item.name === 'string');
}

export function registerExplanationStreamPort(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_EXPLANATION_STREAM_PORT_NAME) return;

    let active: AbortController | undefined;
    const post = (message: AiExplanationStreamServerMessage): void => {
      try {
        port.postMessage(message);
      } catch {
        // The viewer may have closed while a chunk was in flight.
      }
    };

    port.onMessage.addListener((value: unknown) => {
      if (!isStartMessage(value)) return;
      // One explanation at a time per port: a second click replaces the first rather than racing it.
      active?.abort();
      active = new AbortController();
      const { signal } = active;
      const { requestId } = value;

      void withAiRequestLifetime(async () => {
        const config = await getAiConfig();
        const adapter = getProviderAdapter(config);
        post({ type: 'started', requestId, model: config.model });
        const content = await streamEntityExplanation(
          adapter,
          config,
          value.item,
          (delta) => post({ type: 'delta', requestId, content: delta }),
          signal,
        );
        if (content.trim()) post({ type: 'done', requestId, model: config.model });
        else post({ type: 'error', requestId, error: '模型没有返回可用的解释，请稍后再试。' });
      }).catch((error: unknown) => {
        if (signal.aborted) return;
        post({
          type: 'error',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    port.onDisconnect.addListener(() => {
      active?.abort();
      active = undefined;
    });
  });
}
