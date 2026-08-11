import { tool } from "@langchain/core/tools";



import { z } from "zod";
import type { LiteratureSource } from "../../../../shared/research";
import { CURRENT_YEAR, fetchJson, inferRegion, isLowQuality, safeUrl, stripHtml, titleKey } from '../common/research-runtime';
import type { RawLiteratureCandidate } from '../common/research-runtime';
import { titleSimilarity } from '../related-papers/related-paper-service';



export type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  url?: string | null;
  externalIds?: { DOI?: string } | null;
  openAccessPdf?: { url?: string | null } | null;
};


export type SemanticScholarSearchResponse = { data?: SemanticScholarPaper[] };

export type SemanticScholarRecommendationResponse = { recommendedPapers?: SemanticScholarPaper[] };


export type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  publication_year?: number;
  cited_by_count?: number;
  language?: string | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: { display_name?: string | null; host_organization_name?: string | null } | null;
  } | null;
  best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null;
  authorships?: Array<{ institutions?: Array<{ country_code?: string | null }> }>;
};


export type OpenAlexResponse = { results?: OpenAlexWork[] };


export type CrossrefItem = {
  DOI?: string;
  title?: string[];
  abstract?: string;
  URL?: string;
  publisher?: string;
  language?: string;
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  published?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
};


export type CrossrefResponse = { message?: { items?: CrossrefItem[] } };


export type DblpResponse = {
  result?: {
    hits?: {
      hit?: Array<{
        info?: {
          key?: string;
          title?: string;
          venue?: string;
          year?: string;
          url?: string;
          ee?: string | string[];
        };
      }>;
    };
  };
};


export function reconstructOpenAlexAbstract(index?: Record<string, number[]> | null): string {
  if (!index) return "";
  const entries = Object.entries(index).flatMap(([word, positions]) =>
    positions.map((position) => ({ word, position })),
  );
  entries.sort((left, right) => left.position - right.position);
  return entries.map((entry) => entry.word).join(" ").slice(0, 2500);
}


export function mapSemanticScholar(
  paper: SemanticScholarPaper,
  source: LiteratureSource,
  origin: RawLiteratureCandidate["origin"],
): RawLiteratureCandidate | null {
  const title = paper.title?.trim() ?? "";
  if (!title) return null;
  const doi = paper.externalIds?.DOI?.trim();
  const venue = paper.venue?.trim() ?? "";
  const candidate: RawLiteratureCandidate = {
    id: paper.paperId || doi || titleKey(title),
    paperId: paper.paperId,
    title,
    abstract: paper.abstract?.trim() ?? "",
    year: paper.year ?? undefined,
    venue,
    citationCount: (paper.citationCount ?? 0) + (paper.influentialCitationCount ?? 0),
    url: safeUrl(paper.openAccessPdf?.url) || safeUrl(paper.url) || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : ""),
    doi,
    source,
    sources: [source],
    region: inferRegion(undefined, title, venue),
    origin,
  };
  return isLowQuality(candidate) ? null : candidate;
}


export function semanticFields(): string {
  return [
    "paperId", "title", "abstract", "year", "venue", "citationCount",
    "influentialCitationCount", "url", "externalIds", "openAccessPdf",
  ].join(",");
}


export const semanticScholarExactTool = tool(
  async ({ title }) => {
    const params = new URLSearchParams({ query: title.slice(0, 300), limit: "10", fields: semanticFields() });
    const payload = await fetchJson<SemanticScholarSearchResponse>(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    );
    const candidates = (payload.data ?? [])
      .map((paper) => mapSemanticScholar(paper, "Semantic Scholar", "exact"))
      .filter((paper): paper is RawLiteratureCandidate => Boolean(paper));
    const target = titleKey(title);
    candidates.sort((left, right) => {
      const leftExact = titleKey(left.title) === target ? 1 : 0;
      const rightExact = titleKey(right.title) === target ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      return titleSimilarity(title, right.title) - titleSimilarity(title, left.title);
    });
    return JSON.stringify(candidates.slice(0, 3));
  },
  {
    name: "semantic_scholar_exact_paper",
    description: "Find the current paper in Semantic Scholar by its exact title so recommendation APIs can use its paperId.",
    schema: z.object({ title: z.string().min(3) }),
  },
);


export const semanticScholarRecommendationsTool = tool(
  async ({ paperId }) => {
    const params = new URLSearchParams({ from: "all-cs", limit: "60", fields: semanticFields() });
    const payload = await fetchJson<SemanticScholarRecommendationResponse>(
      `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${encodeURIComponent(paperId)}?${params}`,
    );
    return JSON.stringify((payload.recommendedPapers ?? [])
      .map((paper) => mapSemanticScholar(paper, "Semantic Scholar Recommendations", "recommendation"))
      .filter((paper): paper is RawLiteratureCandidate => Boolean(paper)));
  },
  {
    name: "semantic_scholar_paper_recommendations",
    description: "Fetch real Semantic Scholar recommendations for an identified paperId.",
    schema: z.object({ paperId: z.string().min(1) }),
  },
);


export const semanticScholarSearchTool = tool(
  async ({ query }) => {
    const params = new URLSearchParams({ query: query.slice(0, 280), limit: "35", fields: semanticFields() });
    const payload = await fetchJson<SemanticScholarSearchResponse>(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    );
    return JSON.stringify((payload.data ?? [])
      .map((paper) => mapSemanticScholar(paper, "Semantic Scholar", "search"))
      .filter((paper): paper is RawLiteratureCandidate => Boolean(paper)));
  },
  {
    name: "semantic_scholar_search",
    description: "Search Semantic Scholar for papers matching a focused scholarly query.",
    schema: z.object({ query: z.string().min(2) }),
  },
);


export const openAlexSearchTool = tool(
  async ({ query, domesticOnly }) => {
    const filterParts = [
      `from_publication_date:${CURRENT_YEAR - 12}-01-01`,
      "type:article|proceedings-article",
    ];
    if (domesticOnly) filterParts.push("institutions.country_code:CN");
    const params = new URLSearchParams({
      search: query.slice(0, 260),
      filter: filterParts.join(","),
      "per-page": "40",
      sort: "relevance_score:desc",
    });
    const payload = await fetchJson<OpenAlexResponse>(`https://api.openalex.org/works?${params}`);
    const results = (payload.results ?? []).flatMap((work): RawLiteratureCandidate[] => {
      const title = work.title?.trim() ?? "";
      if (!title) return [];
      const venue = work.primary_location?.source?.display_name?.trim() ?? "";
      const publisher = work.primary_location?.source?.host_organization_name?.trim() ?? "";
      const countryCodes = (work.authorships ?? []).flatMap((authorship) =>
        (authorship.institutions ?? []).map((institution) => institution.country_code ?? "").filter(Boolean),
      );
      const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "") || undefined;
      const candidate: RawLiteratureCandidate = {
        id: work.id || doi || titleKey(title),
        title,
        abstract: reconstructOpenAlexAbstract(work.abstract_inverted_index),
        year: work.publication_year,
        venue,
        publisher,
        citationCount: work.cited_by_count ?? 0,
        url: safeUrl(work.best_oa_location?.pdf_url) || safeUrl(work.best_oa_location?.landing_page_url) ||
          safeUrl(work.primary_location?.pdf_url) || safeUrl(work.primary_location?.landing_page_url) ||
          (doi ? `https://doi.org/${encodeURIComponent(doi)}` : ""),
        doi,
        source: "OpenAlex",
        sources: ["OpenAlex"],
        region: inferRegion(work.language, title, venue, countryCodes),
        language: work.language ?? undefined,
        origin: "search",
      };
      return isLowQuality(candidate) ? [] : [candidate];
    });
    return JSON.stringify(results);
  },
  {
    name: "openalex_search",
    description: "Search OpenAlex. Can require at least one Chinese institution to find domestic scholarship without scraping CNKI.",
    schema: z.object({ query: z.string().min(2), domesticOnly: z.boolean().default(false) }),
  },
);


export const crossrefSearchTool = tool(
  async ({ query }) => {
    const params = new URLSearchParams({
      "query.bibliographic": query.slice(0, 260),
      filter: `from-pub-date:${CURRENT_YEAR - 12}-01-01`,
      rows: "40",
      sort: "relevance",
      order: "desc",
    });
    const payload = await fetchJson<CrossrefResponse>(`https://api.crossref.org/works?${params}`);
    const results = (payload.message?.items ?? []).flatMap((item): RawLiteratureCandidate[] => {
      const title = item.title?.[0]?.trim() ?? "";
      if (!title) return [];
      const venue = item["container-title"]?.[0]?.trim() ?? "";
      const doi = item.DOI?.trim();
      const year = (item.published?.["date-parts"] ?? item["published-online"]?.["date-parts"] ??
        item["published-print"]?.["date-parts"])?.[0]?.[0];
      const candidate: RawLiteratureCandidate = {
        id: doi || titleKey(title),
        title,
        abstract: stripHtml(item.abstract ?? "").slice(0, 2500),
        year,
        venue,
        publisher: item.publisher?.trim(),
        citationCount: item["is-referenced-by-count"] ?? 0,
        url: safeUrl(item.URL) || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : ""),
        doi,
        source: "Crossref",
        sources: ["Crossref"],
        region: inferRegion(item.language, title, venue),
        language: item.language,
        origin: "search",
      };
      return isLowQuality(candidate) ? [] : [candidate];
    });
    return JSON.stringify(results);
  },
  {
    name: "crossref_search",
    description: "Search Crossref bibliographic metadata and exclude known predatory/low-quality publishers.",
    schema: z.object({ query: z.string().min(2) }),
  },
);


export const dblpSearchTool = tool(
  async ({ query }) => {
    const params = new URLSearchParams({ q: query.slice(0, 220), format: "json", h: "40" });
    const payload = await fetchJson<DblpResponse>(`https://dblp.org/search/publ/api?${params}`);
    const results = (payload.result?.hits?.hit ?? []).flatMap((hit): RawLiteratureCandidate[] => {
      const info = hit.info;
      const title = stripHtml(info?.title ?? "");
      if (!title) return [];
      const venue = info?.venue?.trim() ?? "";
      const ee = Array.isArray(info?.ee) ? info.ee[0] : info?.ee;
      const candidate: RawLiteratureCandidate = {
        id: info?.key || titleKey(title),
        title,
        year: Number.parseInt(info?.year ?? "", 10) || undefined,
        venue,
        citationCount: 0,
        url: safeUrl(ee) || safeUrl(info?.url),
        source: "DBLP",
        sources: ["DBLP"],
        region: inferRegion(undefined, title, venue),
        origin: "search",
      };
      return isLowQuality(candidate) ? [] : [candidate];
    });
    return JSON.stringify(results);
  },
  {
    name: "dblp_search",
    description: "Search the DBLP computer-science bibliography for conference and journal papers.",
    schema: z.object({ query: z.string().min(2) }),
  },
);
