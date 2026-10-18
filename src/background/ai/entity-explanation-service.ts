import type {
  AiConfig,
  AiEntityExplainItem,
  AiExplainEntitiesRequest,
} from "../../modules/ai/public";
import {
  buildEntityExplanationPrompt,
  buildExplanationUserMessage,
  buildStreamingExplanationPrompt,
} from "../../modules/knowledge-graph/public";
import type { AiProviderAdapter } from "./provider-runtime";
import { requestOverviewCompletion } from "./overview-completion";

/**
 * Per-entity glosses, provider side only.
 *
 * Same split as the extraction and judgement services: the prompt and the message layout live in the
 * knowledge-graph module where Node's contract tests can execute them, and nothing here does
 * anything but network calls. Two entry points, because they are two different contracts:
 *
 * - `explainEntities` — one **batched** call for a whole confirmation, JSON in and JSON out. Nobody
 *   is watching it, so a single call is the cheapest thing to do.
 * - `streamEntityExplanation` — one entity, **streamed**, plain text. This is the panel's
 *   「生成解释」, where the point is to show the sentence being written instead of leaving the user
 *   staring at a disabled button with no idea whether anything is happening.
 */

export interface ExplainEntitiesResult {
  content: string;
}

export async function explainEntities(
  adapter: AiProviderAdapter,
  config: AiConfig,
  message: AiExplainEntitiesRequest,
  signal?: AbortSignal,
): Promise<ExplainEntitiesResult> {
  const prompt = message.promptOverride?.trim() || buildEntityExplanationPrompt();
  // Reuses the overview call for the same reason extraction does: it forces `reasoning: 'disabled'`
  // and retries once with a doubled budget on truncation, so a reasoning model cannot spend the whole
  // output budget thinking and return nothing.
  const result = await requestOverviewCompletion(adapter, config, [
    { role: "system", content: prompt },
    { role: "user", content: buildExplanationUserMessage(message.items) },
  ], signal);
  return { content: result.content };
}

/** One sentence, so a small budget: the ceiling is about the answer, not the input. */
export const EXPLANATION_STREAM_MAX_TOKENS = 512;

/**
 * Streams one entity's meaning.
 *
 * `reasoning: 'disabled'` for the same reason the batch path goes through
 * `requestOverviewCompletion`: with thinking on, a model can spend the entire budget reasoning and
 * stream nothing, which in a live panel looks exactly like a broken request.
 */
export async function streamEntityExplanation(
  adapter: AiProviderAdapter,
  config: AiConfig,
  item: AiEntityExplainItem,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const result = await adapter.stream(
    { ...config, reasoning: "disabled" },
    [
      { role: "system", content: buildStreamingExplanationPrompt() },
      { role: "user", content: buildExplanationUserMessage([item]) },
    ],
    Math.min(EXPLANATION_STREAM_MAX_TOKENS, config.maxOutputTokens),
    signal,
    (delta) => {
      if (delta.content) onDelta(delta.content);
    },
    { toolChoice: "none" },
  );
  return result.content;
}
