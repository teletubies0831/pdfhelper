import { tool } from "@langchain/core/tools";
import {
  END,
  START,
  StateGraph,
  StateSchema
} from "@langchain/langgraph";
import { getDocument } from "pdfjs-dist";
import { browser } from "wxt/browser";
import { z } from "zod";

import type {
  CcfLookupRequest,
  CcfRank,
  CcfRankResult,
  LiteratureRegion,
  LiteratureSource,
  RelatedPaper,
  RelatedResearchRequest,
  RelatedResearchResponse,
} from "./research";

const CURRENT_YEAR = new Date().getFullYear();
const FETCH_TIMEOUT_MS = 18_000;
const MAX_VISIBLE_PAPERS = 8;
const RELATED_CACHE_TTL = 4 * 60 * 60 * 1000;
const CCF_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const RELATED_CACHE_PREFIX = "pdf-helper:research-graph:v4-official-alias:";
const CCF_CACHE_KEY = "pdf-helper:ccf-directory:live-v7-official-alias";

const CCF_INDEX_URL = "https://www.ccf.org.cn/Academic_Evaluation/By_category/";
const CCF_SECURITY_URL = "https://www.ccf.org.cn/Academic_Evaluation/NIS/";

const LOW_QUALITY_PATTERNS = [
  "hans publishers",
  "汉斯出版社",
  "hanspub",
  "scientific research publishing",
  "scirp",
  "open access library journal",
  "oalib",
];

const SEARCH_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "using", "based", "towards",
  "toward", "efficient", "practical", "new", "novel", "scheme", "protocol",
  "protocols", "method", "methods", "system", "systems", "paper", "study",
  "of", "on", "in", "to", "a", "an", "is", "are", "via", "breaking",
  "一种", "方法", "研究", "论文", "系统", "协议", "基于", "高效", "实用",
]);

const OFFICIAL_NIS_SNAPSHOT: Array<{
  rank: CcfRank;
  shortName: string;
  fullName: string;
  aliases?: string[];
}> = [
  // Journals from the official CCF Network and Information Security page.
  { rank: "A", shortName: "TDSC", fullName: "IEEE Transactions on Dependable and Secure Computing" },
  { rank: "A", shortName: "TIFS", fullName: "IEEE Transactions on Information Forensics and Security" },
  { rank: "A", shortName: "JOC", fullName: "Journal of Cryptology", aliases: ["Journal of Cryptology"] },
  {
    rank: "B",
    shortName: "TOPS",
    fullName: "ACM Transactions on Privacy and Security",
    aliases: [
      "ACM Transactions on Information and System Security",
      "ACM Transactions on Information and System Security TISSEC",
      "TISSEC",
    ],
  },
  { rank: "B", shortName: "C&S", fullName: "Computers & Security", aliases: ["Computers and Security"] },
  { rank: "B", shortName: "DCC", fullName: "Designs, Codes and Cryptography" },
  { rank: "B", shortName: "JCS", fullName: "Journal of Computer Security" },
  { rank: "C", shortName: "CLSR", fullName: "Computer Law & Security Review", aliases: ["Computer Law and Security Review"] },
  { rank: "C", shortName: "EJIS", fullName: "EURASIP Journal on Information Security" },
  { rank: "C", shortName: "IET-IFS", fullName: "IET Information Security" },
  { rank: "C", shortName: "IMCS", fullName: "Information and Computer Security", aliases: ["Information Management and Computer Security"] },
  { rank: "C", shortName: "IJICS", fullName: "International Journal of Information and Computer Security" },
  { rank: "C", shortName: "IJISP", fullName: "International Journal of Information Security and Privacy" },
  { rank: "C", shortName: "JISA", fullName: "Journal of Information Security and Applications", aliases: ["Information Security Technical Report", "ISTR"] },
  { rank: "C", shortName: "SCN", fullName: "Security and Communication Networks" },
  { rank: "C", shortName: "Cybersecurity", fullName: "Cybersecurity" },

  { rank: "A", shortName: "CCS", fullName: "ACM Conference on Computer and Communications Security" },
  { rank: "A", shortName: "EUROCRYPT", fullName: "International Conference on the Theory and Applications of Cryptographic Techniques" },
  { rank: "A", shortName: "S&P", fullName: "IEEE Symposium on Security and Privacy" },
  { rank: "A", shortName: "CRYPTO", fullName: "International Cryptology Conference" },
  { rank: "A", shortName: "USENIX Security", fullName: "USENIX Security Symposium" },
  { rank: "A", shortName: "NDSS", fullName: "Network and Distributed System Security Symposium" },
  { rank: "B", shortName: "ACSAC", fullName: "Annual Computer Security Applications Conference" },
  { rank: "B", shortName: "ASIACRYPT", fullName: "Annual International Conference on the Theory and Application of Cryptology and Information Security" },
  { rank: "B", shortName: "ESORICS", fullName: "European Symposium on Research in Computer Security" },
  { rank: "B", shortName: "FSE", fullName: "Fast Software Encryption" },
  { rank: "B", shortName: "CSFW", fullName: "IEEE Computer Security Foundations Workshop" },
  { rank: "B", shortName: "SRDS", fullName: "IEEE International Symposium on Reliable Distributed Systems" },
  { rank: "B", shortName: "CHES", fullName: "International Conference on Cryptographic Hardware and Embedded Systems" },
  { rank: "B", shortName: "DSN", fullName: "International Conference on Dependable Systems and Networks" },
  { rank: "B", shortName: "RAID", fullName: "International Symposium on Recent Advances in Intrusion Detection" },
  { rank: "B", shortName: "PKC", fullName: "International Workshop on Practice and Theory in Public Key Cryptography" },
  { rank: "B", shortName: "TCC", fullName: "Theory of Cryptography Conference" },
  { rank: "C", shortName: "WiSec", fullName: "ACM Conference on Security and Privacy in Wireless and Mobile Networks" },
  { rank: "C", shortName: "SACMAT", fullName: "ACM Symposium on Access Control Models and Technologies" },
  { rank: "C", shortName: "DRM", fullName: "ACM Workshop on Digital Rights Management" },
  { rank: "C", shortName: "IH&MMSec", fullName: "ACM Workshop on Information Hiding and Multimedia Security" },
  { rank: "C", shortName: "ACNS", fullName: "International Conference on Applied Cryptography and Network Security" },
  { rank: "C", shortName: "AsiaCCS", fullName: "ACM Asia Conference on Computer and Communications Security" },
  { rank: "C", shortName: "ACISP", fullName: "Australasia Conference on Information Security and Privacy" },
  { rank: "C", shortName: "CT-RSA", fullName: "The Cryptographer's Track at RSA Conference" },
  { rank: "C", shortName: "DIMVA", fullName: "Conference on Detection of Intrusions and Malware & Vulnerability Assessment" },
  { rank: "C", shortName: "DFRWS", fullName: "Digital Forensic Research Workshop" },
  { rank: "C", shortName: "FC", fullName: "Financial Cryptography and Data Security" },
  { rank: "C", shortName: "TrustCom", fullName: "IEEE International Conference on Trust, Security and Privacy in Computing and Communications" },
  { rank: "C", shortName: "SEC", fullName: "IFIP International Information Security Conference" },
];

export type RawLiteratureCandidate = {
  id: string;
  paperId?: string;
  title: string;
  abstract?: string;
  year?: number;
  venue: string;
  publisher?: string;
  citationCount: number;
  url: string;
  doi?: string;
  source: LiteratureSource;
  sources?: LiteratureSource[];
  region: LiteratureRegion;
  language?: string;
  origin: "exact" | "recommendation" | "search";
};

type CcfDirectoryRecord = {
  rank: CcfRank;
  shortName: string;
  fullName: string;
  aliases: string[];
  normalizedAliases: string[];
  sourceUrl: string;
  sourceKind: "pdf" | "html" | "official-snapshot";
};

type CcfDirectory = {
  savedAt: number;
  records: CcfDirectoryRecord[];
  sourceUrl: string;
  liveRecordCount: number;
};

type SemanticScholarPaper = {
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

type SemanticScholarSearchResponse = { data?: SemanticScholarPaper[] };
type SemanticScholarRecommendationResponse = { recommendedPapers?: SemanticScholarPaper[] };

type OpenAlexWork = {
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

type OpenAlexResponse = { results?: OpenAlexWork[] };

type CrossrefItem = {
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

type CrossrefResponse = { message?: { items?: CrossrefItem[] } };

type DblpResponse = {
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff&+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    (normalizeText(value).match(/[a-z0-9\u4e00-\u9fff]{2,}/g) ?? [])
      .filter((token) => !SEARCH_STOP_WORDS.has(token)),
  ));
}

function safeUrl(value?: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  }
  catch {
    return "";
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isLowQuality(candidate: Pick<RawLiteratureCandidate, "venue" | "publisher" | "url">): boolean {
  const value = normalizeText(`${candidate.venue} ${candidate.publisher ?? ""} ${candidate.url}`);
  return LOW_QUALITY_PATTERNS.some((pattern) => value.includes(normalizeText(pattern)));
}

function inferRegion(
  language: string | null | undefined,
  title: string,
  venue: string,
  countryCodes: string[] = [],
): LiteratureRegion {
  if (
    language?.toLowerCase().startsWith("zh") ||
    /[\u4e00-\u9fff]/.test(`${title} ${venue}`) ||
    countryCodes.some((code) => code.toUpperCase() === "CN")
  ) {
    return "domestic";
  }
  return "international";
}

async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/html,application/pdf,*/*",
          ...(init.headers ?? {}),
        },
      });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
      lastError = new Error(`HTTP ${response.status}: ${url}`);
    }
    catch (error) {
      lastError = error;
    }
    finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJson<T>(url: string): Promise<T> {
  return await (await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 3)).json() as T;
}

async function fetchText(url: string): Promise<string> {
  return await (await fetchWithRetry(url, { headers: { Accept: "text/html,*/*" } }, 2)).text();
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  return await (await fetchWithRetry(url, { headers: { Accept: "application/pdf,*/*" } }, 2)).arrayBuffer();
}

function reconstructOpenAlexAbstract(index?: Record<string, number[]> | null): string {
  if (!index) return "";
  const entries = Object.entries(index).flatMap(([word, positions]) =>
    positions.map((position) => ({ word, position })),
  );
  entries.sort((left, right) => left.position - right.position);
  return entries.map((entry) => entry.word).join(" ").slice(0, 2500);
}

function mapSemanticScholar(
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

function semanticFields(): string {
  return [
    "paperId", "title", "abstract", "year", "venue", "citationCount",
    "influentialCitationCount", "url", "externalIds", "openAccessPdf",
  ].join(",");
}

const semanticScholarExactTool = tool(
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

const semanticScholarRecommendationsTool = tool(
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

const semanticScholarSearchTool = tool(
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

const openAlexSearchTool = tool(
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

const crossrefSearchTool = tool(
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

const dblpSearchTool = tool(
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

function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function buildFocusedQueries(request: RelatedResearchRequest): string[] {
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

function deduplicateCandidates(items: RawLiteratureCandidate[]): RawLiteratureCandidate[] {
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

function scoreCandidateCompleteness(item: RawLiteratureCandidate): number {
  return (item.abstract ? 3 : 0) + (item.venue ? 2 : 0) + (item.doi ? 2 : 0) +
    (item.url ? 1 : 0) + (item.citationCount > 0 ? 1 : 0) + (item.origin === "recommendation" ? 1 : 0);
}

function discoverOfficialLinks(html: string, baseUrl: string): { categoryUrls: string[]; pdfUrls: string[] } {
  const categoryUrls = new Set<string>();
  const pdfUrls = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeHtmlEntities(match[1] ?? ""), baseUrl);
      if (!/(^|\.)ccf\.org\.cn$/i.test(url.hostname)) continue;
      const value = url.toString();
      if (/\.pdf(?:$|[?#])/i.test(value) || /resource\/download|file\/download/i.test(value)) pdfUrls.add(value);
      if (/\/Academic_Evaluation\//i.test(url.pathname) && !/\/By_category\/?$/i.test(url.pathname)) {
        categoryUrls.add(value);
      }
    }
    catch {
      // Ignore malformed links.
    }
  }
  return { categoryUrls: Array.from(categoryUrls), pdfUrls: Array.from(pdfUrls) };
}

function detectRank(text: string): CcfRank | null {
  const compact = stripHtml(text).replace(/\s+/g, "");
  if (/^(?:CCF)?A类/.test(compact)) return "A";
  if (/^(?:CCF)?B类/.test(compact)) return "B";
  if (/^(?:CCF)?C类/.test(compact)) return "C";
  return null;
}

function createCcfRecord(
  rank: CcfRank,
  cells: string[],
  sourceUrl: string,
  sourceKind: CcfDirectoryRecord["sourceKind"],
  extraAliases: string[] = [],
): CcfDirectoryRecord | null {
  const useful = cells.map((cell) => stripHtml(cell)).filter(Boolean);
  const withoutIndex = useful[0] && /^\d+$/.test(useful[0]) ? useful.slice(1) : useful;
  const shortName = withoutIndex[0]?.trim() ?? "";
  const fullName = withoutIndex[1]?.trim() ?? shortName;
  if (!shortName || !/[A-Za-z]/.test(`${shortName} ${fullName}`)) return null;
  const aliases = Array.from(
    new Set([shortName, fullName, ...extraAliases].map((item) => item.trim()).filter(Boolean)),
  );
  return {
    rank,
    shortName,
    fullName,
    aliases,
    normalizedAliases: aliases.map(normalizeCcfVenue),
    sourceUrl,
    sourceKind,
  };
}

function parseCcfHtml(html: string, sourceUrl: string): CcfDirectoryRecord[] {
  const markers = Array.from(html.matchAll(/(?:>|\s)([ABC])\s*类(?:<|\s)/gi)).map((match) => ({
    rank: (match[1] ?? "").toUpperCase() as CcfRank,
    index: match.index ?? 0,
  }));
  const records: CcfDirectoryRecord[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowIndex = row.index ?? 0;
    const marker = markers.filter((item) => item.index < rowIndex).at(-1);
    if (!marker) continue;
    const cells = Array.from((row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((cell) => stripHtml(cell[1] ?? ""))
      .filter(Boolean);
    if (cells.length < 2 || cells.some((cell) => /刊物名称|刊物全称|会议名称|序号/.test(cell))) continue;
    const record = createCcfRecord(marker.rank, cells, sourceUrl, "html");
    if (record) records.push(record);
  }
  return records;
}

async function extractPdfLines(url: string): Promise<string[]> {
  const bytes = await fetchBytes(url);
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let current = "";
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as { str: string; hasEOL?: boolean };
      current += `${item.str} `;
      if (item.hasEOL) {
        const clean = current.replace(/\s+/g, " ").trim();
        if (clean) lines.push(clean);
        current = "";
      }
    }
    const clean = current.replace(/\s+/g, " ").trim();
    if (clean) lines.push(clean);
  }
  return lines;
}

function parseCcfPdf(lines: string[], sourceUrl: string): CcfDirectoryRecord[] {
  const records: CcfDirectoryRecord[] = [];
  let rank: CcfRank | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const foundRank = detectRank(line);
    if (foundRank) {
      rank = foundRank;
      continue;
    }
    if (!rank || !/[A-Za-z]/.test(line)) continue;
    const current = line.replace(/^\d+\s+/, "").trim();
    const next = lines[index + 1]?.trim() ?? "";
    const shortLike = /^[A-Za-z][A-Za-z0-9&+.-]{1,20}$/.test(current);
    if (shortLike && /[A-Za-z]{3}/.test(next)) {
      const record = createCcfRecord(rank, [current, next], sourceUrl, "pdf");
      if (record) records.push(record);
      continue;
    }
    const parts = current.split(/\s{2,}|\t+/).filter(Boolean);
    if (parts.length >= 2) {
      const record = createCcfRecord(rank, parts, sourceUrl, "pdf");
      if (record) records.push(record);
    }
  }
  return records;
}

const CCF_GENERIC_MATCH_TOKENS = new Set([
  "acm", "ieee", "ifip", "usenix", "springer", "elsevier", "wiley",
  "international", "conference", "symposium", "workshop", "journal",
  "transactions", "proceedings", "annual", "society", "association",
  "computer", "computing", "information", "science", "sciences",
  "technology", "technologies", "system", "systems", "application",
  "applications", "security", "privacy", "network", "networks",
  "communications", "communication", "engineering", "research",
  "on", "of", "and", "for", "in", "the", "with", "to",
]);

const CCF_ACRONYM_IGNORE = new Set([
  "acm", "ieee", "ifip", "usenix", "lncs", "springer", "elsevier",
]);

function normalizeCcfVenue(value: string): string {
  return value
    .replace(/\([A-Za-z][A-Za-z0-9&+.-]{1,18}\)/g, " ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, " ")
    .replace(/\bproceedings\s+of\b/g, " ")
    .replace(/\bproceedings\b/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCcfName(value: string): string {
  return normalizeCcfVenue(value).replace(/[^a-z0-9]/g, "");
}

function distinctiveCcfTokens(value: string): Set<string> {
  return new Set(
    normalizeCcfVenue(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !CCF_GENERIC_MATCH_TOKENS.has(token)),
  );
}

function explicitAcronymCandidates(value: string): string[] {
  const results: string[] = [];
  for (const match of value.matchAll(/\(([A-Za-z][A-Za-z0-9&+.-]{1,18})\)/g)) {
    const acronym = (match[1] ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (acronym.length >= 2 && !CCF_ACRONYM_IGNORE.has(acronym)) results.push(acronym);
  }
  for (const match of value.matchAll(/\b([A-Z][A-Z0-9&+.-]{1,15})\b/g)) {
    const acronym = (match[1] ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (acronym.length >= 2 && !CCF_ACRONYM_IGNORE.has(acronym)) results.push(acronym);
  }
  return Array.from(new Set(results));
}

function generatedCcfAcronym(value: string): string {
  const tokens = normalizeCcfVenue(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !CCF_GENERIC_MATCH_TOKENS.has(token));
  return tokens.length >= 2 ? tokens.map((token) => token[0]).join("") : "";
}

function ccfMatchScore(venue: string, record: CcfDirectoryRecord): number {
  const normalizedVenue = normalizeCcfVenue(venue);
  if (!normalizedVenue) return 0;

  const normalizedShort = normalizeCcfVenue(record.shortName);
  const normalizedFull = normalizeCcfVenue(record.fullName);
  const normalizedAliases = Array.from(
    new Set(record.aliases.map((alias) => normalizeCcfVenue(alias)).filter(Boolean)),
  );
  const compactShort = compactCcfName(record.shortName);
  const venueWords = new Set(normalizedVenue.split(" ").filter(Boolean));
  let best = 0;

  // Exact matches against the official short name, full name, and documented
  // historical aliases always win. This is the primary path for TIFS and TOPS.
  if (normalizedAliases.includes(normalizedVenue)) best = 300;

  // Exact full-name matching is the strongest evidence. This correctly
  // distinguishes ambiguous abbreviations such as TCC (Theory of Cryptography
  // Conference vs. IEEE Transactions on Cloud Computing).
  if (normalizedFull && normalizedVenue === normalizedFull) best = 240;
  if (normalizedShort && normalizedVenue === normalizedShort) best = Math.max(best, 220);

  if (
    normalizedFull.length >= 12 &&
    (normalizedVenue.includes(normalizedFull) || normalizedFull.includes(normalizedVenue))
  ) {
    const shorter = normalizedVenue.length < normalizedFull.length
      ? normalizedVenue
      : normalizedFull;
    if (distinctiveCcfTokens(shorter).size >= 2) best = Math.max(best, 210);
  }

  for (const alias of normalizedAliases) {
    if (alias.length < 4) continue;
    const aliasTokens = distinctiveCcfTokens(alias);
    const phraseMatch =
      normalizedVenue === alias ||
      normalizedVenue.startsWith(`${alias} `) ||
      normalizedVenue.endsWith(` ${alias}`) ||
      normalizedVenue.includes(` ${alias} `);
    if (phraseMatch && aliasTokens.size >= 1) best = Math.max(best, 235);
  }

  // Match a real short name as a complete token/phrase, never a generic word
  // such as IEEE or Transactions.
  if (normalizedShort && normalizedShort.length >= 3) {
    const shortWords = normalizedShort.split(" ").filter(Boolean);
    const phraseMatch = normalizedVenue === normalizedShort ||
      normalizedVenue.startsWith(`${normalizedShort} `) ||
      normalizedVenue.endsWith(` ${normalizedShort}`) ||
      normalizedVenue.includes(` ${normalizedShort} `);
    if (phraseMatch && shortWords.some((word) => !CCF_GENERIC_MATCH_TOKENS.has(word))) {
      best = Math.max(best, 195);
    }
  }

  const venueAcronyms = explicitAcronymCandidates(venue);
  if (compactShort.length >= 2 && venueAcronyms.includes(compactShort)) {
    best = Math.max(best, 190);
  }

  const generated = generatedCcfAcronym(venue);
  if (generated.length >= 3 && generated === compactShort) {
    best = Math.max(best, 175);
  }

  // Conservative distinctive-token matching. Generic publisher/title words are
  // excluded so that all IEEE Transactions titles cannot collapse to CCF A.
  const venueTokens = distinctiveCcfTokens(venue);
  const recordTokens = distinctiveCcfTokens(record.aliases.join(" "));
  let overlap = 0;
  for (const token of venueTokens) if (recordTokens.has(token)) overlap += 1;
  const recordCoverage = overlap / Math.max(1, recordTokens.size);
  const venueCoverage = overlap / Math.max(1, venueTokens.size);
  const unionSize = new Set([...venueTokens, ...recordTokens]).size;
  const jaccard = overlap / Math.max(1, unionSize);

  if (overlap >= 2 && recordCoverage >= 0.72 && venueCoverage >= 0.55) {
    best = Math.max(best, 125 + overlap * 4 + jaccard * 15);
  }
  else if (overlap >= 3 && jaccard >= 0.5) {
    best = Math.max(best, 118 + overlap * 3 + jaccard * 12);
  }

  // A compact short name appearing as a standalone normalized token is useful
  // for names such as IEEE TrustCom, but only for non-generic CCF aliases.
  if (
    compactShort.length >= 4 &&
    !CCF_ACRONYM_IGNORE.has(compactShort) &&
    venueWords.has(compactShort)
  ) {
    best = Math.max(best, 188);
  }

  return best;
}

function deduplicateCcfRecords(records: CcfDirectoryRecord[]): CcfDirectoryRecord[] {
  const map = new Map<string, CcfDirectoryRecord>();
  for (const record of records) {
    const key = `${record.rank}:${normalizeCcfVenue(record.shortName)}:${normalizeCcfVenue(record.fullName)}`;
    const existing = map.get(key);
    if (!existing || ccfSourcePriority(record.sourceKind) > ccfSourcePriority(existing.sourceKind)) map.set(key, record);
  }
  return Array.from(map.values());
}

function ccfSourcePriority(kind: CcfDirectoryRecord["sourceKind"]): number {
  return kind === "html" ? 3 : kind === "pdf" ? 2 : 1;
}

async function readStorage<T>(key: string): Promise<T | null> {
  const stored = await browser.storage.local.get(key);
  return (stored[key] as T | undefined) ?? null;
}

async function loadCcfDirectory(force = false): Promise<CcfDirectory> {
  if (!force) {
    const cached = await readStorage<CcfDirectory>(CCF_CACHE_KEY);
    if (cached && cached.records.length > 0 && Date.now() - cached.savedAt < CCF_CACHE_TTL) return cached;
  }

  const records: CcfDirectoryRecord[] = [];
  const categoryUrls = new Set<string>([CCF_SECURITY_URL]);
  const pdfUrls = new Set<string>();
  let liveRecordCount = 0;
  let bestSourceUrl = CCF_INDEX_URL;

  try {
    const indexHtml = await fetchText(CCF_INDEX_URL);
    const links = discoverOfficialLinks(indexHtml, CCF_INDEX_URL);
    links.categoryUrls.forEach((url) => categoryUrls.add(url));
    links.pdfUrls.forEach((url) => pdfUrls.add(url));
  }
  catch (error) {
    console.warn("[ResearchGraph] CCF index fetch failed", error);
  }

  const categoryResults = await Promise.allSettled(Array.from(categoryUrls).slice(0, 32).map(async (url) => {
    const html = await fetchText(url);
    return { url, html, links: discoverOfficialLinks(html, url) };
  }));
  for (const result of categoryResults) {
    if (result.status !== "fulfilled") continue;
    const parsed = parseCcfHtml(result.value.html, result.value.url);
    if (parsed.length > 0) {
      records.push(...parsed);
      liveRecordCount += parsed.length;
      bestSourceUrl = result.value.url;
    }
    result.value.links.pdfUrls.forEach((url) => pdfUrls.add(url));
  }

  const pdfResults = await Promise.allSettled(Array.from(pdfUrls).slice(0, 20).map(async (url) => ({
    url,
    lines: await extractPdfLines(url),
  })));
  for (const result of pdfResults) {
    if (result.status !== "fulfilled") continue;
    const parsed = parseCcfPdf(result.value.lines, result.value.url);
    if (parsed.length > 0) {
      records.push(...parsed);
      liveRecordCount += parsed.length;
      bestSourceUrl = result.value.url;
    }
  }

  // Always merge the official NIS snapshot as a resilience layer. Live PDF/HTML
  // records have higher priority during deduplication, so the snapshot never
  // overrides a newly fetched official entry. This prevents a temporary failure
  // on one CCF category page from incorrectly marking USENIX Security/NDSS/etc.
  // as unavailable.
  records.push(...OFFICIAL_NIS_SNAPSHOT.map((item) => createCcfRecord(
    item.rank,
    [item.shortName, item.fullName],
    CCF_SECURITY_URL,
    "official-snapshot",
    item.aliases ?? [],
  )).filter((record): record is CcfDirectoryRecord => Boolean(record)));
  if (liveRecordCount === 0) bestSourceUrl = CCF_SECURITY_URL;

  const directory: CcfDirectory = {
    savedAt: Date.now(),
    records: deduplicateCcfRecords(records),
    sourceUrl: bestSourceUrl,
    liveRecordCount,
  };
  await browser.storage.local.set({ [CCF_CACHE_KEY]: directory });
  return directory;
}

const ccfOfficialDirectoryTool = tool(
  async ({ venue, force }) => {
    const cleanedVenue = venue.trim();
    if (!cleanedVenue) {
      return JSON.stringify({ status: "not-listed", venue: cleanedVenue, sourceUrl: CCF_INDEX_URL, checkedAt: Date.now() } satisfies CcfRankResult);
    }
    const directory = await loadCcfDirectory(force);
    const matches = directory.records
      .map((record) => ({ record, score: ccfMatchScore(cleanedVenue, record) }))
      .filter((item) => item.score >= 118)
      .sort((left, right) =>
        right.score - left.score ||
        ccfSourcePriority(right.record.sourceKind) - ccfSourcePriority(left.record.sourceKind)
      );
    const best = matches[0];
    const second = matches[1];
    const conflicting = best
      ? matches.find((item, index) =>
          index > 0 &&
          item.record.rank !== best.record.rank &&
          item.score >= best.score - 4 &&
          ccfSourcePriority(item.record.sourceKind) >=
            ccfSourcePriority(best.record.sourceKind)
        )
      : undefined;
    const isExactOfficialAlias = Boolean(best && best.score >= 290);
    const hasSafeMargin = Boolean(
      best && (!second || best.score - second.score >= 12 || best.record.rank === second.record.rank),
    );
    if (best && !conflicting && (isExactOfficialAlias || hasSafeMargin)) {
      return JSON.stringify({
        status: "verified",
        rank: best.record.rank,
        venue: cleanedVenue,
        sourceUrl: best.record.sourceUrl,
        sourceKind: best.record.sourceKind,
        matchedText: `${best.record.shortName} — ${best.record.fullName}`,
        checkedAt: Date.now(),
      } satisfies CcfRankResult);
    }
    return JSON.stringify({
      status: "not-listed",
      venue: cleanedVenue,
      sourceUrl: directory.sourceUrl,
      checkedAt: Date.now(),
    } satisfies CcfRankResult);
  },
  {
    name: "ccf_official_directory_lookup",
    description: "Look up a venue only from live CCF category pages and official PDFs discovered there. If CCF is unreachable, use a clearly marked official NIS snapshot; never infer a rank from model knowledge.",
    schema: z.object({ venue: z.string().min(1), force: z.boolean().default(false) }),
  },
);

function phraseSet(value: string): Set<string> {
  const tokens = tokenize(value);
  const phrases = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      phrases.add(tokens.slice(index, index + size).join(" "));
    }
  }
  return phrases;
}

function calculateRelevance(
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

function qualityScore(rank: CcfRankResult, candidate: RawLiteratureCandidate): number {
  if (rank.rank === "A") return 100;
  if (rank.rank === "B") return 80;
  if (rank.rank === "C") return 60;
  const citationSignal = Math.min(15, Math.log1p(candidate.citationCount) * 3);
  const metadataSignal = (candidate.doi ? 4 : 0) + (candidate.venue ? 4 : 0) + (candidate.abstract ? 2 : 0);
  return 20 + citationSignal + metadataSignal;
}

function compareRelated(left: RelatedPaper, right: RelatedPaper): number {
  if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
  if (Math.abs(right.relevance - left.relevance) > 0.0001) return right.relevance - left.relevance;
  if ((right.year ?? 0) !== (left.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0);
  return right.citationCount - left.citationCount;
}

function selectDiversePapers(sorted: RelatedPaper[]): RelatedPaper[] {
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

const RelatedState = new StateSchema({
  request: z.custom<RelatedResearchRequest>(),
  queries: z.array(z.string()).default(() => []),
  candidates: z.array(z.custom<RawLiteratureCandidate>()).default(() => []),
  papers: z.array(z.custom<RelatedPaper>()).default(() => []),
  currentPaperMatched: z.boolean().default(false),
  sourceCounts: z.record(z.string(), z.number()).default(() => ({})),
  ccfDirectorySource: z.string().default(CCF_INDEX_URL),
});

const planQueriesNode = async (state: { request: RelatedResearchRequest }) => ({
  queries: buildFocusedQueries(state.request),
});

const searchSourcesNode = async (state: { request: RelatedResearchRequest; queries: string[] }) => {
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

const verifyAndRankNode = async (state: { request: RelatedResearchRequest; candidates: RawLiteratureCandidate[] }) => {
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

const relatedResearchGraph = new StateGraph(RelatedState)
  .addNode("plan_queries", planQueriesNode)
  .addNode("search_sources", searchSourcesNode)
  .addNode("verify_and_rank", verifyAndRankNode)
  .addEdge(START, "plan_queries")
  .addEdge("plan_queries", "search_sources")
  .addEdge("search_sources", "verify_and_rank")
  .addEdge("verify_and_rank", END)
  .compile();

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function relatedCacheKey(request: RelatedResearchRequest): string {
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

const CcfState = new StateSchema({
  request: z.custom<CcfLookupRequest>(),
  result: z.custom<CcfRankResult>().optional(),
});

const lookupCcfNode = async (state: { request: CcfLookupRequest }) => {
  const raw = await ccfOfficialDirectoryTool.invoke({ venue: state.request.venue, force: Boolean(state.request.force) });
  return { result: JSON.parse(String(raw)) as CcfRankResult };
};

const ccfLookupGraph = new StateGraph(CcfState)
  .addNode("lookup_official_ccf", lookupCcfNode)
  .addEdge(START, "lookup_official_ccf")
  .addEdge("lookup_official_ccf", END)
  .compile();

export async function runCcfLookupGraph(request: CcfLookupRequest): Promise<CcfRankResult> {
  try {
    const state = await ccfLookupGraph.invoke({ request });
    if (state.result) return state.result;
  }
  catch (error) {
    console.error("[ResearchGraph] CCF workflow failed", error);
  }
  return {
    status: "unavailable",
    venue: request.venue,
    sourceUrl: CCF_INDEX_URL,
    checkedAt: Date.now(),
  };
}
