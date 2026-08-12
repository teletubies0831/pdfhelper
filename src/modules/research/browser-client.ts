import { browser } from "wxt/browser";

import type { RelatedResearchRequest, RelatedResearchResponse } from "./contracts";

export type { RelatedPaper } from "./contracts";

export async function runRelatedResearch(
  request: Omit<RelatedResearchRequest, "type">,
): Promise<RelatedResearchResponse> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "pdf-helper:research-related",
      ...request,
    } satisfies RelatedResearchRequest) as RelatedResearchResponse | undefined;
    if (!response) return { ok: false, error: "研究工具未返回结果。" };
    return response;
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
