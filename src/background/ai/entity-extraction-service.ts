import type {
  AiConfig,
  AiExtractEntitiesRequest,
} from "../../modules/ai/public";
import {
  EXTRACTION_PROMPT_VERSION,
  buildEntityExtractionPrompt,
  buildExtractionUserMessage,
  planExtractionBatches,
} from "../../modules/knowledge-graph/public";
import type { AiProviderAdapter } from "./provider-runtime";
import { requestOverviewCompletion } from "./overview-completion";

/**
 * Candidate entity extraction, provider side only.
 *
 * This file exists to make the network calls; the prompt and the batching plan
 * live in the knowledge-graph module where they are unit tested, because nothing
 * under `src/background/` can be exercised by the contract tests in this repo.
 */

export interface ExtractEntitiesResult {
  content: string;
  batchCount: number;
  /** Batches that failed after retry, so the caller can report partial results. */
  failedBatches: Array<{ chunkIds: string[]; error: string }>;
  promptVersion: string;
}

/**
 * Runs every batch and concatenates the raw responses.
 *
 * A failed batch is recorded and skipped rather than aborting the paper: partial
 * candidates are more useful than none, and the caller persists a per-job cursor
 * so the next run retries only what failed. Only a run where *every* batch failed
 * throws, because that is a configuration problem rather than bad luck.
 */
export async function extractEntities(
  adapter: AiProviderAdapter,
  config: AiConfig,
  message: AiExtractEntitiesRequest,
  signal?: AbortSignal,
): Promise<ExtractEntitiesResult> {
  const prompt = message.promptOverride?.trim()
    || buildEntityExtractionPrompt();
  const batches = planExtractionBatches(message.chunks);
  const contents: string[] = [];
  const failedBatches: ExtractEntitiesResult["failedBatches"] = [];

  for (const batch of batches) {
    signal?.throwIfAborted();
    try {
      // `requestOverviewCompletion` is reused deliberately: it forces
      // `reasoning: 'disabled'` and retries once with a doubled budget on
      // truncation. Without it a reasoning model can spend the entire output
      // budget thinking and return empty content, which would look like "no
      // entities found" rather than a failure.
      const result = await requestOverviewCompletion(adapter, config, [
        { role: "system", content: prompt },
        {
          role: "user",
          // The abstract goes in front of every batch (see `buildExtractionUserMessage`): a call
          // only carries three chunks, and without the abstract a background method is
          // indistinguishable from this paper's contribution.
          content: buildExtractionUserMessage({
            paperTitle: message.paperTitle,
            documentName: message.documentName,
            abstract: message.abstract,
            batch: batch.prompt,
          }),
        },
      ], signal);
      contents.push(result.content);
    } catch (error) {
      if (signal?.aborted) throw error;
      failedBatches.push({
        chunkIds: batch.chunkIds,
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
    promptVersion: EXTRACTION_PROMPT_VERSION,
  };
}
