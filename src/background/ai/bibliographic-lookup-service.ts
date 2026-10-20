import type { AiBibliographicCandidate } from "../../modules/ai/public";
import { searchOpenAlex } from "./related-literature-service";

/**
 * Bibliographic lookup against the free reference databases.
 *
 * This is the *suggestion* path, never the write path: it returns candidates and the viewer's gate decides what may be
 * offered to the user. Nothing here writes to the library, and nothing here spends money — both services are free and
 * keyless, which is why this layer comes before any paid web search.
 *
 * Crossref first because its title/DOI/author metadata is the most complete and it answers by *bibliographic* query
 * (title words, not fuzzy search). OpenAlex second because Crossref misses a fair number of preprints and conference
 * papers, and its own response carries no `container-title` for them.
 *
 * Deliberately not attempted: guessing which record the user meant. That judgement belongs to the gate
 * (`bibliographic-match.ts`), where it is testable.
 */

/** Both services are free; 8 s is the polite ceiling for a lookup the user is waiting on. */
const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_ROWS = 5;

interface CrossrefWork {
  DOI?: unknown;
  title?: unknown;
  author?: Array<{ family?: unknown; given?: unknown; name?: unknown }>;
  issued?: { "date-parts"?: Array<Array<unknown>> } | null;
  "container-title"?: unknown;
  type?: unknown;
  URL?: unknown;
}

/** Crossref dates are `[[2020, 6, 19]]`; a missing month/day stays missing rather than becoming January. */
function crossrefDate(work: CrossrefWork): string {
  const parts = work.issued?.["date-parts"]?.[0];
  if (!Array.isArray(parts) || !parts.length) return "";
  const year = Number(parts[0]);
  if (!Number.isFinite(year) || year < 1000) return "";
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const monthPart = Number.isInteger(month) && month >= 1 && month <= 12
    ? `-${String(month).padStart(2, "0")}`
    : "";
  const dayPart = monthPart && Number.isInteger(day) && day >= 1 && day <= 31
    ? `-${String(day).padStart(2, "0")}`
    : "";
  return `${year}${monthPart}${dayPart}`;
}

function crossrefCandidate(work: CrossrefWork): AiBibliographicCandidate | null {
  const title = Array.isArray(work.title)
    ? String(work.title[0] ?? "").trim()
    : typeof work.title === "string" ? work.title.trim() : "";
  if (!title) return null;
  const doi = typeof work.DOI === "string" ? work.DOI.trim() : "";
  const containerTitle = Array.isArray(work["container-title"])
    ? String(work["container-title"][0] ?? "").trim()
    : "";
  const authors = (work.author ?? [])
    .map((item) => {
      if (typeof item.name === "string" && item.name.trim()) return item.name.trim();
      const family = typeof item.family === "string" ? item.family.trim() : "";
      const given = typeof item.given === "string" ? item.given.trim() : "";
      return [given, family].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .slice(0, 12);
  return {
    source: "crossref",
    title,
    authors,
    publishDate: crossrefDate(work),
    doi,
    documentUrl: doi ? `https://doi.org/${doi}` : (typeof work.URL === "string" ? work.URL : ""),
    containerTitle,
    kind: typeof work.type === "string" ? work.type : "",
  };
}

async function lookupCrossref(title: string, signal: AbortSignal): Promise<AiBibliographicCandidate[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", title);
  url.searchParams.set("rows", String(MAX_ROWS));
  url.searchParams.set("select", "DOI,title,author,issued,container-title,type,URL");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
  const payload = await response.json() as { message?: { items?: CrossrefWork[] } };
  return (payload.message?.items ?? [])
    .map(crossrefCandidate)
    .filter((item): item is AiBibliographicCandidate => Boolean(item));
}

async function lookupOpenAlex(title: string, signal: AbortSignal): Promise<AiBibliographicCandidate[]> {
  const works = await searchOpenAlex(title, signal);
  return works.map((work) => ({
    source: "openalex" as const,
    title: work.title,
    // OpenAlex returns one comma-joined string here; the gate only needs surnames.
    authors: work.authors ? work.authors.split(/,\s*/).filter(Boolean) : [],
    publishDate: work.year,
    doi: work.url.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    documentUrl: work.url,
    containerTitle: work.siteName || "",
    kind: "",
  }));
}

export interface BibliographicLookupResult {
  candidates: AiBibliographicCandidate[];
  /** Non-fatal failures, so the panel can say "Crossref timed out" instead of "nothing found". */
  errors: string[];
}

/**
 * Looks a title up, Crossref first and OpenAlex as a fallback.
 *
 * A source that throws does not empty the result: the other one is still tried, and the failure is reported alongside —
 * "Crossref is down" and "this paper is not in any database" are different answers and the user acts differently on them.
 */
export async function lookupBibliographicRecords(
  input: { title: string; signal?: AbortSignal },
): Promise<BibliographicLookupResult> {
  const title = input.title.trim();
  if (!title) return { candidates: [], errors: ["没有可用的标题，无法在线查找。"] };
  const signal = input.signal ?? new AbortController().signal;
  const errors: string[] = [];

  try {
    const candidates = await lookupCrossref(title, signal);
    if (candidates.length) return { candidates, errors };
  } catch (error) {
    errors.push(`Crossref：${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const candidates = await lookupOpenAlex(title, signal);
    if (candidates.length) return { candidates, errors };
  } catch (error) {
    errors.push(`OpenAlex：${error instanceof Error ? error.message : String(error)}`);
  }

  return { candidates: [], errors };
}
