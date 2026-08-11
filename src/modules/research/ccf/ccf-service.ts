import { tool } from "@langchain/core/tools";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { browser } from "wxt/browser";
import { z } from "zod";
import type { CcfLookupRequest, CcfRank, CcfRankResult } from "../../../../shared/research";
import { decodeHtmlEntities, fetchBytes, fetchText, stripHtml } from '../common/research-runtime';


export const CCF_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export const CCF_CACHE_KEY = "pdf-helper:ccf-directory:live-v7-official-alias";


export const CCF_INDEX_URL = "https://www.ccf.org.cn/Academic_Evaluation/By_category/";

export const CCF_SECURITY_URL = "https://www.ccf.org.cn/Academic_Evaluation/NIS/";


export const OFFICIAL_NIS_SNAPSHOT: Array<{
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


export type CcfDirectoryRecord = {
  rank: CcfRank;
  shortName: string;
  fullName: string;
  aliases: string[];
  normalizedAliases: string[];
  sourceUrl: string;
  sourceKind: "pdf" | "html" | "official-snapshot";
};


export type CcfDirectory = {
  savedAt: number;
  records: CcfDirectoryRecord[];
  sourceUrl: string;
  liveRecordCount: number;
};


export function discoverOfficialLinks(html: string, baseUrl: string): { categoryUrls: string[]; pdfUrls: string[] } {
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


export function detectRank(text: string): CcfRank | null {
  const compact = stripHtml(text).replace(/\s+/g, "");
  if (/^(?:CCF)?A类/.test(compact)) return "A";
  if (/^(?:CCF)?B类/.test(compact)) return "B";
  if (/^(?:CCF)?C类/.test(compact)) return "C";
  return null;
}


export function createCcfRecord(
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


export function parseCcfHtml(html: string, sourceUrl: string): CcfDirectoryRecord[] {
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


export async function extractPdfLines(url: string): Promise<string[]> {
  const bytes = await fetchBytes(url);
  const { getDocument } = await import("pdfjs-dist");
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


export function parseCcfPdf(lines: string[], sourceUrl: string): CcfDirectoryRecord[] {
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


export const CCF_GENERIC_MATCH_TOKENS = new Set([
  "acm", "ieee", "ifip", "usenix", "springer", "elsevier", "wiley",
  "international", "conference", "symposium", "workshop", "journal",
  "transactions", "proceedings", "annual", "society", "association",
  "computer", "computing", "information", "science", "sciences",
  "technology", "technologies", "system", "systems", "application",
  "applications", "security", "privacy", "network", "networks",
  "communications", "communication", "engineering", "research",
  "on", "of", "and", "for", "in", "the", "with", "to",
]);


export const CCF_ACRONYM_IGNORE = new Set([
  "acm", "ieee", "ifip", "usenix", "lncs", "springer", "elsevier",
]);


export function normalizeCcfVenue(value: string): string {
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


export function compactCcfName(value: string): string {
  return normalizeCcfVenue(value).replace(/[^a-z0-9]/g, "");
}


export function distinctiveCcfTokens(value: string): Set<string> {
  return new Set(
    normalizeCcfVenue(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !CCF_GENERIC_MATCH_TOKENS.has(token)),
  );
}


export function explicitAcronymCandidates(value: string): string[] {
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


export function generatedCcfAcronym(value: string): string {
  const tokens = normalizeCcfVenue(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !CCF_GENERIC_MATCH_TOKENS.has(token));
  return tokens.length >= 2 ? tokens.map((token) => token[0]).join("") : "";
}


export function ccfMatchScore(venue: string, record: CcfDirectoryRecord): number {
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


export function deduplicateCcfRecords(records: CcfDirectoryRecord[]): CcfDirectoryRecord[] {
  const map = new Map<string, CcfDirectoryRecord>();
  for (const record of records) {
    const key = `${record.rank}:${normalizeCcfVenue(record.shortName)}:${normalizeCcfVenue(record.fullName)}`;
    const existing = map.get(key);
    if (!existing || ccfSourcePriority(record.sourceKind) > ccfSourcePriority(existing.sourceKind)) map.set(key, record);
  }
  return Array.from(map.values());
}


export function ccfSourcePriority(kind: CcfDirectoryRecord["sourceKind"]): number {
  return kind === "html" ? 3 : kind === "pdf" ? 2 : 1;
}


export async function readStorage<T>(key: string): Promise<T | null> {
  const stored = await browser.storage.local.get(key);
  return (stored[key] as T | undefined) ?? null;
}


export async function loadCcfDirectory(force = false): Promise<CcfDirectory> {
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


export const ccfOfficialDirectoryTool = tool(
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


export const CcfState = new StateSchema({
  request: z.custom<CcfLookupRequest>(),
  result: z.custom<CcfRankResult>().optional(),
});


export const lookupCcfNode = async (state: { request: CcfLookupRequest }) => {
  const raw = await ccfOfficialDirectoryTool.invoke({ venue: state.request.venue, force: Boolean(state.request.force) });
  return { result: JSON.parse(String(raw)) as CcfRankResult };
};


export const ccfLookupGraph = new StateGraph(CcfState)
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
