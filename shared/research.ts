export type CcfRank = "A" | "B" | "C";

export type CcfRankResult = {
  status: "verified" | "not-listed" | "unavailable";
  rank?: CcfRank;
  venue: string;
  sourceUrl: string;
  sourceKind?: "pdf" | "html" | "official-snapshot";
  matchedText?: string;
  checkedAt: number;
};

export type LiteratureRegion = "domestic" | "international";
export type LiteratureSource =
  | "Semantic Scholar"
  | "Semantic Scholar Recommendations"
  | "OpenAlex"
  | "DBLP"
  | "Crossref";

export type RelatedPaper = {
  id: string;
  title: string;
  abstract?: string;
  year?: number;
  venue: string;
  publisher?: string;
  citationCount: number;
  url: string;
  doi?: string;
  source: LiteratureSource;
  sources: LiteratureSource[];
  region: LiteratureRegion;
  language?: string;
  relevance: number;
  overlap: number;
  recommendationSeed: boolean;
  ccfStatus: CcfRankResult["status"];
  ccfRank?: CcfRank;
  ccfSourceUrl: string;
  ccfSourceKind?: CcfRankResult["sourceKind"];
  qualityScore: number;
};

export type RelatedResearchRequest = {
  type: "pdf-helper:research-related";
  title: string;
  keywords?: string;
  researchArea?: string;
  force?: boolean;
};

export type CcfLookupRequest = {
  type: "pdf-helper:research-ccf";
  venue: string;
  force?: boolean;
};

export type ResearchRuntimeRequest = RelatedResearchRequest | CcfLookupRequest;

export type RelatedResearchResponse =
  | {
      ok: true;
      papers: RelatedPaper[];
      diagnostics: {
        queries: string[];
        sourceCounts: Record<string, number>;
        currentPaperMatched: boolean;
        ccfDirectorySource: string;
      };
    }
  | { ok: false; error: string };

export type CcfLookupResponse =
  | { ok: true; result: CcfRankResult }
  | { ok: false; error: string };

export function isResearchRuntimeRequest(
  value: unknown,
): value is ResearchRuntimeRequest {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "pdf-helper:research-related" || type === "pdf-helper:research-ccf";
}
