
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";

import { browser } from "wxt/browser";
import { z } from "zod";
import type { CcfRankResult, RelatedPaper, RelatedResearchRequest, RelatedResearchResponse } from "../../../../shared/research";
import { MAX_VISIBLE_PAPERS, RELATED_CACHE_PREFIX, RELATED_CACHE_TTL, normalizeText, titleKey, tokenize } from '../common/research-runtime';
import type { RawLiteratureCandidate } from '../common/research-runtime';
import { CCF_INDEX_URL, ccfOfficialDirectoryTool, loadCcfDirectory, readStorage } from '../ccf/ccf-service';
import { crossrefSearchTool, dblpSearchTool, openAlexSearchTool, semanticScholarExactTool, semanticScholarRecommendationsTool, semanticScholarSearchTool } from '../providers/literature-providers';



export function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}


export function buildFocusedQueries(request: RelatedResearchRequest): string[] {
  const title = request.title.trim();
  const titleParts = title.split(/[:：—–-]/).map((part) => part.trim()).filter(Boolean);
  const keywordParts = (request.keywords ?? "")
    .split(/[,，;；|/]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  const titleTokens = tokenize(title);
  const focusedTitle = titleTokens.slice(-7).join(" ");
  const broadTitle = titleTokens.filter((token) => token.length >= 3).slice(-5).join(" ");
  const areaParts = (request.researchArea ?? "")
    .split(/[,，;；|/]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  return Array.from(new Set([
    title,
    titleParts.at(-1) ?? "",
    focusedTitle,
    broadTitle,
    keywordParts.slice(0, 4).join(" "),
    areaParts.slice(0, 2).join(" "),
    [...keywordParts.slice(0, 2), ...titleTokens.slice(-4)].join(" "),
  ].map((query) => query.replace(/\s+/g, " ").trim()).filter((query) => query.length >= 4))).slice(0, 7);
}


export function deduplicateCandidates(items: RawLiteratureCandidate[]): RawLiteratureCandidate[] {
  const map = new Map<string, RawLiteratureCandidate>();
  for (const item of items) {
    const key = item.doi ? `doi:${item.doi.toLowerCase()}` : `title:${titleKey(item.title)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, sources: item.sources ?? [item.source] });
      continue;
    }
    const mergedSources = Array.from(new Set([...(existing.sources ?? [existing.source]), ...(item.sources ?? [item.source])]));
    const preferred = scoreCandidateCompleteness(item) > scoreCandidateCompleteness(existing) ? item : existing;
    map.set(key, {
      ...existing,
      ...preferred,
      abstract: preferred.abstract || existing.abstract || item.abstract,
      venue: preferred.venue || existing.venue || item.venue,
      publisher: preferred.publisher || existing.publisher || item.publisher,
      citationCount: Math.max(existing.citationCount, item.citationCount),
      url: preferred.url || existing.url || item.url,
      sources: mergedSources,
      origin: existing.origin === "recommendation" || item.origin === "recommendation" ? "recommendation" : preferred.origin,
      region: existing.region === "domestic" || item.region === "domestic" ? "domestic" : "international",
    } as RawLiteratureCandidate);
  }
  return Array.from(map.values());
}


export function scoreCandidateCompleteness(item: RawLiteratureCandidate): number {
  return (item.abstract ? 3 : 0) + (item.venue ? 2 : 0) + (item.doi ? 2 : 0) +
    (item.url ? 1 : 0) + (item.citationCount > 0 ? 1 : 0) + (item.origin === "recommendation" ? 1 : 0);
}


export function phraseSet(value: string): Set<string> {
  const tokens = tokenize(value);
  const phrases = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      phrases.add(tokens.slice(index, index + size).join(" "));
    }
  }
  return phrases;
}


export function calculateRelevance(
  candidate: RawLiteratureCandidate,
  request: RelatedResearchRequest,
): { relevance: number; overlap: number } {
  const context = `${request.title} ${request.keywords ?? ""} ${request.researchArea ?? ""}`;
  const queryTokens = new Set(tokenize(context));
  const candidateTokens = new Set(tokenize(`${candidate.title} ${candidate.abstract ?? ""} ${candidate.venue}`));
  let overlap = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) overlap += 1;
  const tokenScore = overlap / Math.max(1, Math.min(12, queryTokens.size));

  const queryPhrases = phraseSet(context);
  const normalizedCandidate = normalizeText(`${candidate.title} ${candidate.abstract ?? ""}`);
  let phraseMatches = 0;
  for (const phrase of queryPhrases) {
    if (phrase.length >= 8 && normalizedCandidate.includes(phrase)) phraseMatches += 1;
  }
  const phraseScore = Math.min(1, phraseMatches / 3);
  const titleScore = titleSimilarity(request.title, candidate.title);
  const recommendationBonus = candidate.origin === "recommendation" ? 0.24 : 0;
  const relevance = Math.min(1, tokenScore * 0.42 + phraseScore * 0.28 + titleScore * 0.2 + recommendationBonus);
  return { relevance, overlap };
}


export function qualityScore(rank: CcfRankResult, candidate: RawLiteratureCandidate): number {
  if (rank.rank === "A") return 100;
  if (rank.rank === "B") return 80;
  if (rank.rank === "C") return 60;
  const citationSignal = Math.min(15, Math.log1p(candidate.citationCount) * 3);
  const metadataSignal = (candidate.doi ? 4 : 0) + (candidate.venue ? 4 : 0) + (candidate.abstract ? 2 : 0);
  return 20 + citationSignal + metadataSignal;
}


export function compareRelated(left: RelatedPaper, right: RelatedPaper): number {
  if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
  if (Math.abs(right.relevance - left.relevance) > 0.0001) return right.relevance - left.relevance;
  if ((right.year ?? 0) !== (left.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0);
  return right.citationCount - left.citationCount;
}


export function selectDiversePapers(sorted: RelatedPaper[]): RelatedPaper[] {
  const selected = sorted.slice(0, MAX_VISIBLE_PAPERS);
  const domestic = sorted.find((paper) => paper.region === "domestic");
  const international = sorted.find((paper) => paper.region === "international");
  for (const desired of [domestic, international]) {
    if (!desired || selected.some((paper) => paper.id === desired.id) || selected.length === 0) continue;
    const weakest = selected[selected.length - 1];
    if (weakest && desired.qualityScore >= weakest.qualityScore - 8 && desired.relevance >= weakest.relevance - 0.18) {
      selected[selected.length - 1] = desired;
      selected.sort(compareRelated);
    }
  }
  return Array.from(new Map(selected.map((paper) => [paper.id, paper])).values()).sort(compareRelated).slice(0, MAX_VISIBLE_PAPERS);
}


export const RelatedState = new StateSchema({
  request: z.custom<RelatedResearchRequest>(),
  queries: z.array(z.string()).default(() => []),
  candidates: z.array(z.custom<RawLiteratureCandidate>()).default(() => []),
  papers: z.array(z.custom<RelatedPaper>()).default(() => []),
  currentPaperMatched: z.boolean().default(false),
  sourceCounts: z.record(z.string(), z.number()).default(() => ({})),
  ccfDirectorySource: z.string().default(CCF_INDEX_URL),
});


export const planQueriesNode = async (state: { request: RelatedResearchRequest }) => ({
  queries: buildFocusedQueries(state.request),
});


export const searchSourcesNode = async (state: { request: RelatedResearchRequest; queries: string[] }) => {
  const exactRaw = await semanticScholarExactTool.invoke({ title: state.request.title }).catch(() => "[]");
  const exact = JSON.parse(String(exactRaw)) as RawLiteratureCandidate[];
  const exactPaper = exact.find((paper) => titleKey(paper.title) === titleKey(state.request.title)) ?? exact[0];

  const tasks: Array<Promise<string>> = [];
  if (exactPaper?.paperId) {
    tasks.push(semanticScholarRecommendationsTool.invoke({ paperId: exactPaper.paperId }).then(String).catch(() => "[]"));
  }
  const broadQueries = state.queries.slice(exactPaper?.paperId ? 1 : 0, 5);
  for (const query of broadQueries.slice(0, 2)) {
    tasks.push(semanticScholarSearchTool.invoke({ query }).then(String).catch(() => "[]"));
  }
  for (const query of broadQueries.slice(0, 4)) {
    tasks.push(openAlexSearchTool.invoke({ query, domesticOnly: false }).then(String).catch(() => "[]"));
    tasks.push(crossrefSearchTool.invoke({ query }).then(String).catch(() => "[]"));
  }
  for (const query of broadQueries.slice(0, 3)) {
    tasks.push(dblpSearchTool.invoke({ query }).then(String).catch(() => "[]"));
    tasks.push(openAlexSearchTool.invoke({ query, domesticOnly: true }).then(String).catch(() => "[]"));
  }
  const settled = await Promise.all(tasks);
  const all = [
    ...exact,
    ...settled.flatMap((raw) => {
      try { return JSON.parse(raw) as RawLiteratureCandidate[]; }
      catch { return []; }
    }),
  ];
  const candidates = deduplicateCandidates(all);
  const sourceCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const source of candidate.sources ?? [candidate.source]) {
      sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    }
  }
  return {
    candidates,
    currentPaperMatched: Boolean(exactPaper?.paperId),
    sourceCounts,
  };
};


export const verifyAndRankNode = async (state: { request: RelatedResearchRequest; candidates: RawLiteratureCandidate[] }) => {
  const currentTitleKey = titleKey(state.request.title);
  const scored = state.candidates
    .filter((candidate) => titleKey(candidate.title) !== currentTitleKey)
    .map((candidate) => ({ candidate, ...calculateRelevance(candidate, state.request) }))
    .filter(({ candidate, relevance, overlap }) =>
      candidate.origin === "recommendation" || relevance >= 0.14 || overlap >= 2,
    )
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 36);

  const directory = await loadCcfDirectory(false).catch(() => null);
  const papers = await Promise.all(scored.map(async ({ candidate, relevance, overlap }): Promise<RelatedPaper> => {
    let ccfResult: CcfRankResult = {
      status: "not-listed",
      venue: candidate.venue,
      sourceUrl: directory?.sourceUrl ?? CCF_INDEX_URL,
      checkedAt: Date.now(),
    };
    if (candidate.venue) {
      try {
        ccfResult = JSON.parse(String(await ccfOfficialDirectoryTool.invoke({ venue: candidate.venue, force: false }))) as CcfRankResult;
      }
      catch {
        ccfResult.status = "unavailable";
      }
    }
    return {
      id: candidate.id,
      title: candidate.title,
      abstract: candidate.abstract,
      year: candidate.year,
      venue: candidate.venue,
      publisher: candidate.publisher,
      citationCount: candidate.citationCount,
      url: candidate.url,
      doi: candidate.doi,
      source: candidate.source,
      sources: candidate.sources ?? [candidate.source],
      region: candidate.region,
      language: candidate.language,
      relevance,
      overlap,
      recommendationSeed: candidate.origin === "recommendation",
      ccfStatus: ccfResult.status,
      ccfRank: ccfResult.rank,
      ccfSourceUrl: ccfResult.sourceUrl,
      ccfSourceKind: ccfResult.sourceKind,
      qualityScore: qualityScore(ccfResult, candidate),
    };
  }));

  return {
    papers: selectDiversePapers(papers.sort(compareRelated)),
    ccfDirectorySource: directory?.sourceUrl ?? CCF_INDEX_URL,
  };
};


export const relatedResearchGraph = new StateGraph(RelatedState)
  .addNode("plan_queries", planQueriesNode)
  .addNode("search_sources", searchSourcesNode)
  .addNode("verify_and_rank", verifyAndRankNode)
  .addEdge(START, "plan_queries")
  .addEdge("plan_queries", "search_sources")
  .addEdge("search_sources", "verify_and_rank")
  .addEdge("verify_and_rank", END)
  .compile();


export function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}


export function relatedCacheKey(request: RelatedResearchRequest): string {
  return `${RELATED_CACHE_PREFIX}${hashText(titleKey(request.title))}`;
}


export async function runRelatedResearchGraph(
  request: RelatedResearchRequest,
): Promise<RelatedResearchResponse> {
  const cacheKey = relatedCacheKey(request);
  if (!request.force) {
    const cached = await readStorage<{ savedAt: number; response: RelatedResearchResponse }>(cacheKey);
    if (cached && Date.now() - cached.savedAt < RELATED_CACHE_TTL && cached.response.ok && cached.response.papers.length > 0) {
      return cached.response;
    }
  }

  try {
    const state = await relatedResearchGraph.invoke({
      request,
      queries: [],
      candidates: [],
      papers: [],
      currentPaperMatched: false,
      sourceCounts: {},
      ccfDirectorySource: CCF_INDEX_URL,
    });
    const response: RelatedResearchResponse = {
      ok: true,
      papers: state.papers,
      diagnostics: {
        queries: state.queries,
        sourceCounts: state.sourceCounts,
        currentPaperMatched: state.currentPaperMatched,
        ccfDirectorySource: state.ccfDirectorySource,
      },
    };
    if (response.papers.length > 0) {
      await browser.storage.local.set({ [cacheKey]: { savedAt: Date.now(), response } });
    }
    return response;
  }
  catch (error) {
    console.error("[ResearchGraph] related workflow failed", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
