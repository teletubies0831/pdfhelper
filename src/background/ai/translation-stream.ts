import { browser } from "wxt/browser";

import {
  AI_TRANSLATION_STREAM_PORT_NAME,
  type AiTranslationStreamServerMessage,
  type AiTranslationStreamStartMessage,
} from "../../modules/ai/public";
import { getAiConfig } from "./ai-config-repository";
import { getProviderAdapter } from "./provider-runtime";
import { withAiRequestLifetime } from "./request-lifetime";
import {
  buildTranslationStreamMessages,
  KEYWORD_STREAM_MAX_TOKENS,
  TRANSLATION_STREAM_MAX_TOKENS,
} from "./translation-prompts";

/**
 * The translation card's stream port.
 *
 * Structurally the same as the explanation port: `started` / `delta` / `done` / `error`, no tools, no conversation.
 * Two differences matter.
 *
 * **Several requests may be in flight on one port.** The card asks for its translation and its vocabulary at the same
 * time — the reader gets the sentence immediately and the words arrive while they are already reading — so requests
 * are tracked per `requestId` instead of one-aborts-the-other.
 *
 * **The prompt is small on purpose.** See `translation-prompts.ts`: the chat system prompt is the wrong contract for
 * "translate this sentence", and paying two thousand tokens of agent instructions for it was most of the latency.
 */

function isStartMessage(value: unknown): value is AiTranslationStreamStartMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiTranslationStreamStartMessage>;
  return candidate.type === "start"
    && typeof candidate.requestId === "string"
    && typeof candidate.text === "string"
    && (candidate.task === "translation" || candidate.task === "keywords");
}

export function registerTranslationStreamPort(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_TRANSLATION_STREAM_PORT_NAME) return;

    const active = new Map<string, AbortController>();
    const post = (message: AiTranslationStreamServerMessage): void => {
      try {
        port.postMessage(message);
      } catch {
        // The viewer may have closed while a chunk was in flight.
      }
    };

    port.onMessage.addListener((value: unknown) => {
      if (!isStartMessage(value)) return;
      const { requestId } = value;
      // Replacing a request with the same id is a retry; a different id is the other half of the card.
      active.get(requestId)?.abort();
      const controller = new AbortController();
      active.set(requestId, controller);
      const { signal } = controller;

      void withAiRequestLifetime(async () => {
        // The translation route, not the chat route: a user who assigned a small fast model to 翻译与英语学习 gets it
        // here too.
        const config = await getAiConfig("translation");
        const adapter = getProviderAdapter(config);
        post({ type: "started", requestId, model: config.model });
        const maxTokens = Math.min(
          value.task === "translation" ? TRANSLATION_STREAM_MAX_TOKENS : KEYWORD_STREAM_MAX_TOKENS,
          config.maxOutputTokens,
        );
        const result = await adapter.stream(
          // `reasoning: 'disabled'` for the same reason every other short task does it: a thinking model can spend the
          // whole budget reasoning and stream nothing, which in a live card looks exactly like a broken request.
          { ...config, reasoning: "disabled" },
          buildTranslationStreamMessages(value),
          maxTokens,
          signal,
          (delta) => {
            if (delta.content) post({ type: "delta", requestId, content: delta.content });
          },
          { toolChoice: "none" },
        );
        const finishReason = result.completion?.finishReason;
        // Reasoning that cannot be turned off is billed against `max_tokens`, so "no content + length" means the budget
        // went to thinking. Saying that is far more useful than "模型没有返回内容".
        if (!result.content.trim() && finishReason === "length") {
          post({
            type: "error",
            requestId,
            error: "模型的思考过程占满了输出预算（finish_reason: length），没有生成正文。可在设置里换用能关闭思考的模型，或重试。",
          });
          return;
        }
        if (result.content.trim()) post({ type: "done", requestId, model: config.model, finishReason });
        else post({
          type: "error",
          requestId,
          error: value.task === "translation"
            ? "模型没有返回译文，请稍后再试。"
            : "模型没有返回重点词，请稍后再试。",
        });
      })
        .catch((error: unknown) => {
          if (signal.aborted) return;
          post({
            type: "error",
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          active.delete(requestId);
        });
    });

    port.onDisconnect.addListener(() => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    });
  });
}
