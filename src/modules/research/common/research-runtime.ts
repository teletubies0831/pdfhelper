




import type { LiteratureRegion, LiteratureSource } from "../../../../shared/research";



export const CURRENT_YEAR = new Date().getFullYear();

export const FETCH_TIMEOUT_MS = 18_000;

export const MAX_VISIBLE_PAPERS = 8;

export const RELATED_CACHE_PREFIX = "pdf-helper:research-graph:v4-official-alias:";


export const LOW_QUALITY_PATTERNS = [
  "hans publishers",
  "汉斯出版社",
  "hanspub",
  "scientific research publishing",
  "scirp",
  "open access library journal",
  "oalib",
];


export const SEARCH_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "using", "based", "towards",
  "toward", "efficient", "practical", "new", "novel", "scheme", "protocol",
  "protocols", "method", "methods", "system", "systems", "paper", "study",
  "of", "on", "in", "to", "a", "an", "is", "are", "via", "breaking",
  "一种", "方法", "研究", "论文", "系统", "协议", "基于", "高效", "实用",
]);


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


export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff&+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export function titleKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}


export function tokenize(value: string): string[] {
  return Array.from(new Set(
    (normalizeText(value).match(/[a-z0-9\u4e00-\u9fff]{2,}/g) ?? [])
      .filter((token) => !SEARCH_STOP_WORDS.has(token)),
  ));
}


export function safeUrl(value?: string | null): string {
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


export function decodeHtmlEntities(value: string): string {
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


export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}


export function isLowQuality(candidate: Pick<RawLiteratureCandidate, "venue" | "publisher" | "url">): boolean {
  const value = normalizeText(`${candidate.venue} ${candidate.publisher ?? ""} ${candidate.url}`);
  return LOW_QUALITY_PATTERNS.some((pattern) => value.includes(normalizeText(pattern)));
}


export function inferRegion(
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


export async function fetchWithRetry(
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


export async function fetchJson<T>(url: string): Promise<T> {
  return await (await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 3)).json() as T;
}


export async function fetchText(url: string): Promise<string> {
  return await (await fetchWithRetry(url, { headers: { Accept: "text/html,*/*" } }, 2)).text();
}


export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  return await (await fetchWithRetry(url, { headers: { Accept: "application/pdf,*/*" } }, 2)).arrayBuffer();
}
