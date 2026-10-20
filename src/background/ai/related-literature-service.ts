import type { AiConfig, AiWebRetrievalConfig, AiWebRetrievalUsage } from "../../modules/ai/public";
import type { AiProviderAdapter } from "./provider-runtime";
import { requestOverviewCompletion } from "./overview-completion";
import {
  addUsage,
  describeWebRetrievalError,
  fetchPage,
  searchWeb,
  type WebSearchHit,
} from "./deepseek-tools-client";

/**
 * The 「相关论文」 section of a PDF 概览.
 *
 * Built **on demand** (the 检索 button), not during overview generation: it spends a retrieval call plus a
 * model call, and the user is the one who decides when to spend them.
 *
 * Two candidate sources, deliberately different:
 *
 * - **DeepSeek Search** (`/v1/tools/search`) — recent work, publisher and repository pages, and the citation
 *   pages a keyword database does not index. One request brings the page bodies too (`need_content`), which is
 *   why the Fetch endpoint is only a fallback.
 * - **OpenAlex** — free, and the only source that states authors, year, DOI and citation counts reliably.
 *
 * They run together and are merged. A DeepSeek failure never empties the section: it degrades to OpenAlex and
 * says so. The reference database is not allowed to decide *who is related* either — the ranking below is
 * deterministic and the model only writes the prose.
 */

interface OpenAlexWork {
  id?: unknown;
  doi?: unknown;
  display_name?: unknown;
  publication_year?: unknown;
  cited_by_count?: unknown;
  authorships?: Array<{ author?: { display_name?: unknown } }>;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_topic?: { display_name?: unknown } | null;
}

export interface RelatedLiteratureCandidate {
  title: string;
  url: string;
  year: string;
  authors: string;
  source: 'deepseek' | 'openalex';
  /** Abstract-quality text from the search result, else the restored OpenAlex abstract. */
  summary: string;
  /** Page body in Markdown, only kept for the few candidates the model should read closely. */
  content: string;
  siteName: string;
  authority: number;
  rerankScore: number;
  citedByCount: number;
}

export interface RelatedLiteratureInput {
  documentName: string;
  overviewMarkdown: string;
  /** `null` when web retrieval is not configured — the section then comes from OpenAlex alone. */
  webRetrieval: AiWebRetrievalConfig | null;
}

export interface RelatedLiteratureResult {
  /** The `## 相关论文` section, or '' when this document is not a paper. */
  markdown: string;
  usage: AiWebRetrievalUsage;
  sources: Array<'deepseek' | 'openalex'>;
  /** One line for the UI when something did not go to plan; empty when everything worked. */
  degraded: string;
}

/** Below this a search hit is not worth a candidate slot (the API calls ≥1.5 a good result). */
const MIN_RERANK_SCORE = 1.2;
/** Candidates handed to the model. More than this and the section repeats itself. */
const MAX_CANDIDATES = 5;
/** Characters of page body given to the model per candidate, for the two it reads closely. */
const CLOSE_READ_CHARS = 2_500;
/** Below this many usable candidates the search is widened with a second query. */
const WIDEN_BELOW = 3;

const UNAVAILABLE_NOTE = "> 这次没有检索到可用的相关论文，可以稍后重试。";

export function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function restoreAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  return words
    .sort((left, right) => left[0] - right[0])
    .map((item) => item[1])
    .join(" ")
    .slice(0, 1_200);
}

function openAlexCandidate(value: OpenAlexWork): RelatedLiteratureCandidate | null {
  const title = typeof value.display_name === "string" ? value.display_name.trim() : "";
  if (!title) return null;
  const doi = typeof value.doi === "string" ? value.doi : "";
  const id = typeof value.id === "string" ? value.id : "";
  const authors = (value.authorships || [])
    .map((item) => item.author?.display_name)
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    .slice(0, 4)
    .join(", ");
  return {
    title,
    url: doi || id,
    year: Number.isFinite(value.publication_year) ? String(value.publication_year) : "",
    authors,
    source: 'openalex',
    summary: restoreAbstract(value.abstract_inverted_index),
    content: '',
    siteName: '',
    authority: -1,
    rerankScore: 0,
    citedByCount: Math.max(0, Number(value.cited_by_count) || 0),
  };
}

export async function searchOpenAlex(
  title: string,
  signal: AbortSignal,
): Promise<RelatedLiteratureCandidate[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", title);
  url.searchParams.set("per-page", "10");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`OpenAlex 检索失败：HTTP ${response.status}`);
  const payload = await response.json() as { results?: OpenAlexWork[] };
  return (payload.results || [])
    .map(openAlexCandidate)
    .filter((work): work is RelatedLiteratureCandidate => Boolean(work));
}

function webCandidate(hit: WebSearchHit): RelatedLiteratureCandidate {
  return {
    title: hit.title,
    url: hit.url,
    // `date` is RFC 3339; only the year is ever printed.
    year: hit.date.slice(0, 4),
    authors: '',
    source: 'deepseek',
    summary: hit.summary || hit.snippet,
    content: hit.content,
    siteName: hit.siteName,
    authority: hit.authority,
    rerankScore: hit.rerankScore,
    citedByCount: 0,
  };
}

/**
 * Merges the two lists and decides the order, without asking a model to.
 *
 * Search hits arrive mixed (news pages, blogs, repositories), so the score has to reward what makes a page
 * worth citing: relevance first, then authority, then recency. OpenAlex results carry no rerank score, so
 * they are ranked by their citation count instead of being dropped.
 */
export function rankRelatedCandidates(
  candidates: readonly RelatedLiteratureCandidate[],
  currentTitle: string,
  now = Date.now(),
): RelatedLiteratureCandidate[] {
  const current = normalizeTitle(currentTitle);
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const scored: Array<{ candidate: RelatedLiteratureCandidate; score: number }> = [];
  for (const candidate of candidates) {
    const title = normalizeTitle(candidate.title);
    if (!title || title === current) continue;
    const urlKey = candidate.url.trim().toLocaleLowerCase();
    if (seenTitles.has(title) || (urlKey && seenUrls.has(urlKey))) continue;
    if (candidate.source === 'deepseek' && candidate.rerankScore > 0
      && candidate.rerankScore < MIN_RERANK_SCORE) continue;
    seenTitles.add(title);
    if (urlKey) seenUrls.add(urlKey);
    let score = candidate.rerankScore;
    if (candidate.source === 'openalex') {
      // No rerank score exists for a keyword-database hit; citations are the nearest honest proxy.
      score = 1.5 + Math.min(1, Math.log10(candidate.citedByCount + 1) / 2);
    }
    if (candidate.authority >= 3) score += 0.5;
    const year = Number.parseInt(candidate.year, 10);
    if (Number.isFinite(year) && now - Date.UTC(year, 0, 1) < 3 * 365 * 24 * 3_600_000) score += 0.3;
    scored.push({ candidate, score });
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.candidate);
}

export function extractDocumentMetadata(markdown: string): { type: string; title: string } {
  const type = markdown.match(/<!--\s*pdfpal-document-type:\s*([^>]+?)\s*-->/i)?.[1]?.trim().toLowerCase() || "";
  const markedTitle = markdown.match(/<!--\s*pdfpal-document-title:\s*([^>]+?)\s*-->/i)?.[1]?.trim() || "";
  const headingTitle = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  return { type, title: markedTitle || headingTitle };
}

const SECTION_INSTRUCTIONS = [
  "你负责为一篇论文的 PDF 概览补充相关论文。",
  "只能使用候选数据中明确提供的信息，不得发明论文、作者、结论或关系。",
  "只输出一个以“## 相关论文”开头的 Markdown 章节，不要重复当前论文概览。",
  "选择 3 至 5 篇最相关且互有区分的论文：优先选其它来源里确实相关的独立工作，其次是引用或延续当前论文的工作。",
  "每篇使用三级标题；链接必须逐字使用候选里的 url，不得拼接或改写；年份只能取候选里给出的年份，没有就不写。",
  "每篇依次写一段不超过 60 字的简介，以及一行“**与当前论文的关系：** …”。",
  "候选里的 summary 是摘要级材料，content 是网页正文；没有 content 的候选只能写标题、链接和年份，不得补写摘要或结论。",
].join("\n");

function candidateForPrompt(candidate: RelatedLiteratureCandidate, closeRead: boolean) {
  return {
    title: candidate.title,
    url: candidate.url,
    year: candidate.year,
    source: candidate.source === 'deepseek' ? '网络检索' : 'OpenAlex',
    site: candidate.siteName || undefined,
    authors: candidate.authors || undefined,
    summary: candidate.summary.slice(0, 800),
    content: closeRead && candidate.content
      ? candidate.content.slice(0, CLOSE_READ_CHARS)
      : undefined,
  };
}

/**
 * A plain Markdown list of the candidates, used when the model call fails after the retrieval succeeded.
 *
 * The search is the part that costs calls and cannot be re-derived cheaply; the model only writes it up. So when the
 * write-up times out, the user still gets what was found instead of nothing.
 */
function formatCandidateFallback(candidates: readonly RelatedLiteratureCandidate[]): string {
  const lines = candidates.slice(0, 8).map((candidate) => {
    const meta = [candidate.authors, candidate.year].filter(Boolean).join(' · ');
    const link = candidate.url ? ` — ${candidate.url}` : '';
    return `- **${candidate.title}**${meta ? `（${meta}）` : ''}${link}`;
  });
  return [
    '## 相关论文',
    '',
    '> 检索已完成，但整理这段结果时超时/失败，下面是原始候选（可点开原文，稍后重试可以拿到整理版）。',
    '',
    ...lines,
  ].join('\n');
}

/** Turns an abort/timeout into a Chinese explanation instead of `signal timed out`. */
function describeGenerationError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|abort/i.test(message)) {
    return '检索已完成，但生成整理结果超时，下面给的是原始候选。';
  }
  return `检索已完成，但生成整理结果失败：${message}`;
}

export async function buildRelatedLiteratureSection(
  adapter: AiProviderAdapter,
  config: AiConfig,
  input: RelatedLiteratureInput,
): Promise<RelatedLiteratureResult> {
  const emptyUsage: AiWebRetrievalUsage = { searchCalls: 0, fetchCalls: 0 };
  const metadata = extractDocumentMetadata(input.overviewMarkdown);
  if (metadata.type !== "paper" || !metadata.title) {
    return {
      markdown: '',
      usage: emptyUsage,
      sources: [],
      degraded: '这份 PDF 不是学术论文，因此没有相关论文可查。',
    };
  }

  // The retrieval phase gets its own budget: it is a handful of HTTP calls and must not keep an already finished
  // overview waiting indefinitely.
  const searchSignal = AbortSignal.timeout(30_000);
  let usage = emptyUsage;
  let degraded = '';
  const sources: Array<'deepseek' | 'openalex'> = [];
  const webHits: RelatedLiteratureCandidate[] = [];
  let openAlexWorks: RelatedLiteratureCandidate[] = [];
  /** Search hits seen, including the widening query: `webHits` alone would miss a second-query answer. */
  let webHitCount = 0;

  const webTask = (async () => {
    if (!input.webRetrieval) return;
    try {
      const hits = await searchWeb(input.webRetrieval, {
        query: `"${metadata.title}"`,
        count: input.webRetrieval.count,
        needContent: true,
        oriQuestion: `查找与《${metadata.title}》相关的其他学术论文`,
        signal: searchSignal,
      });
      usage = addUsage(usage, 'searchCalls');
      webHitCount += hits.length;
      webHits.push(...hits.map(webCandidate));
    } catch (error) {
      degraded = describeWebRetrievalError(error);
    }
  })();
  const openAlexTask = (async () => {
    try {
      openAlexWorks = await searchOpenAlex(metadata.title, searchSignal);
    } catch {
      // OpenAlex is the fallback, so its own failure only matters when web retrieval failed too.
      openAlexWorks = [];
    }
  })();
  await Promise.all([webTask, openAlexTask]);

  let ranked = rankRelatedCandidates([...webHits, ...openAlexWorks], metadata.title);
  // A thin answer is worth widening: an empty search is not billed, and the second query is the only way to
  // find work that is related by topic rather than by title.
  if (input.webRetrieval && !degraded && ranked.length < WIDEN_BELOW) {
    try {
      const wider = await searchWeb(input.webRetrieval, {
        query: `"${metadata.title}" 相关工作 综述`,
        count: input.webRetrieval.count,
        needContent: true,
        signal: searchSignal,
      });
      usage = addUsage(usage, 'searchCalls');
      if (wider.length) {
        webHitCount += wider.length;
        ranked = rankRelatedCandidates(
          [...ranked, ...wider.map(webCandidate)],
          metadata.title,
        );
      }
    } catch (error) {
      degraded = describeWebRetrievalError(error);
    }
  }

  if (input.webRetrieval && webHitCount) sources.push('deepseek');
  if (openAlexWorks.length) sources.push('openalex');

  // Only the candidates the model should read closely get a body, and only when the search did not already
  // bring one; that is what keeps the Fetch endpoint a fallback rather than the main path.
  if (input.webRetrieval && input.webRetrieval.maxFetches > 0) {
    let fetches = 0;
    for (const candidate of ranked) {
      if (fetches >= input.webRetrieval.maxFetches) break;
      if (candidate.content || candidate.source !== 'deepseek') continue;
      if (fetches >= 2) break;
      fetches += 1;
      try {
        const page = await fetchPage(input.webRetrieval, candidate.url, searchSignal);
        usage = addUsage(usage, 'fetchCalls');
        candidate.content = page.content;
      } catch {
        // A page without a body is normal (paywall, blocked, JS-only). The candidate stays usable through its
        // summary, so this is not worth degrading the whole section over.
      }
    }
  }

  if (!ranked.length) {
    return { markdown: `## 相关论文\n\n${UNAVAILABLE_NOTE}`, usage, sources, degraded };
  }

  // The write-up gets its own, much longer budget. It shares nothing with the retrieval timeout above: a model that
  // thinks before answering, or one queued behind a rate-limit back-off, would otherwise be killed at 30 s — after the
  // searches had already been paid for. 180 s clears the provider's own 120 s ceiling.
  let section = '';
  try {
    const result = await requestOverviewCompletion(adapter, config, [{
      role: "system",
      content: SECTION_INSTRUCTIONS,
    }, {
      role: "user",
      content: [
        `当前论文标题：${metadata.title}`,
        "当前论文概览：",
        input.overviewMarkdown.slice(0, 12_000),
        "候选论文：",
        JSON.stringify(ranked.map((candidate, index) => candidateForPrompt(candidate, index < 2))),
      ].join("\n\n"),
    }], AbortSignal.timeout(180_000));
    section = result.content.trim();
  } catch (error) {
    // Retrieval already succeeded and cost calls; hand the raw candidates over rather than throwing the whole thing
    // away, and say in Chinese what happened instead of surfacing `signal timed out`.
    return {
      markdown: formatCandidateFallback(ranked),
      usage,
      sources,
      degraded: describeGenerationError(error),
    };
  }
  if (!/^##\s+相关论文/m.test(section)) {
    return {
      markdown: formatCandidateFallback(ranked),
      usage,
      sources,
      degraded: degraded || '模型没有按要求返回「相关论文」章节，下面是原始候选。',
    };
  }
  return { markdown: section, usage, sources, degraded };
}
