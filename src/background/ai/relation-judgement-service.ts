import type {
  AiConfig,
  AiJudgeRelationsRequest,
} from "../../modules/ai/public";
import { buildRelationJudgementPrompt } from "../../modules/knowledge-graph/public";
import type { AiProviderAdapter } from "./provider-runtime";
import { requestOverviewCompletion } from "./overview-completion";

/**
 * Paper-to-paper relationship judgement, provider side only.
 *
 * Like the extraction service, this file makes the network calls and nothing
 * else: the prompt and the response parser live in the knowledge-graph module,
 * where Node's contract tests can execute them. Nothing under
 * `src/background/` can be covered by those tests.
 */

export interface JudgeRelationsResult {
  content: string;
  /** Pairs the provider answered for, in the order they were sent. */
  batchCount: number;
  failedBatches: Array<{ pairKeys: string[]; error: string }>;
}

/**
 * Pairs per provider call.
 *
 * The caller already caps the total at the user's Top-K. This is the second,
 * smaller ceiling, and it exists because one judgement with two abstracts is a
 * longer prompt than one extraction chunk: sending all pairs at once would put a
 * single call close to the 120 s provider timeout, and a timeout loses the whole
 * batch rather than one pair.
 */
export const RELATION_PAIRS_PER_CALL = 5;

export function planRelationBatches<T>(
  pairs: readonly T[],
  pairsPerCall = RELATION_PAIRS_PER_CALL,
): T[][] {
  const batches: T[][] = [];
  const size = Math.max(1, Math.floor(pairsPerCall));
  for (let index = 0; index < pairs.length; index += size) {
    batches.push(pairs.slice(index, index + size));
  }
  return batches;
}

/**
 * Runs every batch and concatenates the raw responses.
 *
 * A failed batch is recorded and skipped rather than aborting the run: pairs that
 * were answered are still worth keeping, and the caller persists per-pair
 * conclusions so the next run only re-asks what failed.
 */
export async function judgeRelations(
  adapter: AiProviderAdapter,
  config: AiConfig,
  message: AiJudgeRelationsRequest,
  signal?: AbortSignal,
): Promise<JudgeRelationsResult> {
  const prompt = message.promptOverride?.trim() || buildRelationJudgementPrompt();
  const batches = planRelationBatches(message.pairs);
  const contents: string[] = [];
  const failedBatches: JudgeRelationsResult["failedBatches"] = [];

  for (const batch of batches) {
    signal?.throwIfAborted();
    try {
      // Only the papers this batch mentions: a batch of five pairs would otherwise re-send every
      // excerpt in the run, which is most of the input.
      const batchPaperIds = new Set(batch.flatMap((pair) => [pair.leftPaperId, pair.rightPaperId]));
      const papers = message.papers.filter((paper) => batchPaperIds.has(paper.paperId));
      // Reused for the same reason extraction reuses it: it forces
      // `reasoning: 'disabled'` and retries once with a doubled budget on
      // truncation. Without it a reasoning model can spend the entire output
      // budget thinking and return empty content, which would read as "no
      // relationships found" rather than a failure.
      const result = await requestOverviewCompletion(adapter, config, [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            "论文清单：",
            JSON.stringify(papers),
            "待判断的论文对：",
            JSON.stringify(batch),
          ].join("\n\n"),
        },
      ], signal);
      contents.push(result.content);
    } catch (error) {
      if (signal?.aborted) throw error;
      failedBatches.push({
        pairKeys: batch.map((pair) => pair.pairKey),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!contents.length && failedBatches.length) {
    throw new Error(failedBatches[0]!.error);
  }

  return {
    content: contents.join("\n"),
    batchCount: batches.length,
    failedBatches,
  };
}
