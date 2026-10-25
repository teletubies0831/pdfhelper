import {
  getKnowledgeDocument,
  updateKnowledgeDocument,
  type KnowledgeLibraryDocument,
} from '../adapters/browser-document-corpus';

/**
 * 文献元数据：作者、出版日期、语言、URL、DOI.
 *
 * Zotero's real value is not the list, it is the *record*: authors and a DOI are what make a paper citable, and a
 * timestamped library without them is a folder of files. The model fills these in when a document is added (see
 * `document-metadata-extraction` in the viewer); this module owns what counts as a stored value.
 *
 * The rule that shapes everything here: **empty is a legitimate answer**. A contract has no DOI, a scanned report has
 * no discoverable authors, and a model that invents either is worse than a blank field — so nothing is defaulted,
 * guessed or filled from the file name.
 */

/** The bibliographic fields, as one record, so the panel can render them in a fixed order. */
export interface KnowledgeDocumentMetadata {
  /** 标题：文献自己的标题，不是文件名。 */
  title: string;
  authors: string[];
  publishDate: string;
  language: string;
  documentUrl: string;
  doi: string;
  /** 期刊名或论文集名（GB/T 里 `[J]` 与 `[C]` 后面那一段）。 */
  containerTitle: string;
  volume: string;
  issue: string;
  /** 起止页码，原文写法（`45-56` / `e1234`）。 */
  page: string;
  publisher: string;
  /** 出版地，Crossref 的 `publisher-location`。 */
  publisherPlace: string;
  issn: string;
  isbn: string;
  /**
   * 文献类型：Crossref 的 `type` 原值（`journal-article` / `proceedings-article` / `posted-content` / …）。
   *
   * Stored rather than inferred from the container title, because 「会议论文集」 and 「期刊」 look alike in text and the
   * difference decides whether a citation says `[C]` or `[J]`.
   */
  publicationKind: string;
}

export const EMPTY_DOCUMENT_METADATA: KnowledgeDocumentMetadata = {
  title: '',
  authors: [],
  publishDate: '',
  language: '',
  documentUrl: '',
  doi: '',
  containerTitle: '',
  volume: '',
  issue: '',
  page: '',
  publisher: '',
  publisherPlace: '',
  issn: '',
  isbn: '',
  publicationKind: '',
};

/** A name is worth keeping only if it can be read; models occasionally return `[""]` or `["N/A"]`. */
const PLACEHOLDER_NAMES = /^(?:n\/?a|unknown|未知|不详|-|—|null|undefined)$/i;

/** Beyond this, the list stops being a citation and becomes a contributor dump. */
const MAX_AUTHORS = 12;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Authors arrive as an array, as "A, B and C", or as "张三、李四".
 *
 * Accepting all three is not politeness: the JSON schema asks for an array, and models answer with the string form
 * often enough that rejecting it would silently lose the field for most papers. `、`/`；` are included because a
 * Chinese author list uses them, and a comma inside a Western name ("Wang, Xiaolong") must not split — which is why
 * the ASCII comma only splits when what follows looks like the start of another name.
 */
export function normalizeAuthors(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\s*(?:;|；|、|\band\b|&)\s*|\s*,\s*(?=[A-Z])/u)
      : [];
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const part of parts) {
    const name = cleanText(part);
    if (!name || PLACEHOLDER_NAMES.test(name)) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    authors.push(name);
    if (authors.length >= MAX_AUTHORS) break;
  }
  return authors;
}

/**
 * A bare DOI, `10.<registrant>/<suffix>`.
 *
 * Stripped of the resolver prefix and the `doi:` label because that is how the field is *displayed* and linked; storing
 * the URL form would make `doi:` and `documentUrl` the same string and the two rows redundant.
 */
export function normalizeDoi(value: unknown): string {
  const text = cleanText(value)
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim();
  if (!text) return '';
  const match = text.match(/10\.\d{4,9}\/[^\s"'<>]+/);
  return match ? match[0].replace(/[.,;]+$/, '') : '';
}

/** Only http(s) links are stored: a `javascript:` or `file:` URL in a record that gets rendered as a link is a hole. */
export function normalizeDocumentUrl(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Two-letter language tag, lower-cased; anything longer that is not a tag (`English`) is kept as words. */
export function normalizeLanguage(value: unknown): string {
  const text = cleanText(value).replace(/[()]/g, '');
  if (!text) return '';
  const tag = text.match(/^([a-z]{2,3})(?:[-_][a-z0-9]+)?$/i);
  return tag?.[1] ? tag[1].toLowerCase() : text.slice(0, 24);
}

/**
 * A date the way the model read it, not a date this code constructed.
 *
 * Only shapes a library can sort and print are normalised: `2026`, `2026-10`, `2026-10-18` — and the same written with
 * Chinese units (`2026年10月18日`) or dots (`2026.10.18`), which is how most first pages state it. Anything else
 * ("October 2026") is kept verbatim: the comment below used to promise that and the code did not deliver it, so a date
 * the model read as month-and-year silently lost its month.
 */
const ENGLISH_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthNumberFromEnglish(text: string): string {
  const lower = text.toLowerCase();
  const index = ENGLISH_MONTHS.findIndex((month) => lower.includes(month)
    || lower.includes(month.slice(0, 3)));
  return index >= 0 ? String(index + 1).padStart(2, '0') : '';
}

export function normalizePublishDate(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  // 2026-10-18 / 2026/10/18 / 2026.10.18 / 2026年10月18日
  const numeric = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (numeric) {
    const [, year, month, day] = numeric;
    return `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`;
  }
  // 2026-10 / 2026年10月 / 2026.10
  const yearMonth = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?/);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    return `${year}-${month?.padStart(2, '0')}`;
  }
  // "October 2026" / "Oct 2026" — the year is unambiguous, the month word is not a number, so put them together.
  const englishMonth = text.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (englishMonth) {
    const month = monthNumberFromEnglish(englishMonth[1] ?? '');
    return month ? `${englishMonth[2]}-${month}` : englishMonth[2] ?? text.slice(0, 40);
  }
  // A bare year is a legitimate answer (many preprints only state one).
  const bareYear = text.match(/^(\d{4})$/);
  if (bareYear) return bareYear[1] ?? '';
  return text.slice(0, 40);
}

/**
 * 标题的规范化.
 *
 * The one rule that matters: never fall back to the file name here. A title that is really a file name would be quoted
 * in a bibliography as if the paper were called `2010-Boyar-…-technique.pdf`, and nothing downstream could tell. The
 * citation layer decides separately what to show when this is empty.
 */
export function normalizeTitle(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  if (PLACEHOLDER_NAMES.test(text)) return '';
  // Trailing punctuation from a page header (`Title.`) and stray wrapping quotes are not part of the title.
  return text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').replace(/[.。,，;；:：]+$/g, '').trim();
}

/** Normalizes a whole record, so every writer produces the same shapes. */
export function normalizeDocumentMetadata(
  input: Partial<Record<keyof KnowledgeDocumentMetadata, unknown>> | null | undefined,
): KnowledgeDocumentMetadata {
  const source = input ?? {};
  return {
    title: normalizeTitle(source.title),
    authors: normalizeAuthors(source.authors),
    publishDate: normalizePublishDate(source.publishDate),
    language: normalizeLanguage(source.language),
    documentUrl: normalizeDocumentUrl(source.documentUrl),
    doi: normalizeDoi(source.doi),
    containerTitle: normalizeBibliographyText(source.containerTitle),
    volume: normalizeBibliographyText(source.volume),
    issue: normalizeBibliographyText(source.issue),
    page: normalizeBibliographyText(source.page),
    publisher: normalizeBibliographyText(source.publisher),
    publisherPlace: normalizeBibliographyText(source.publisherPlace),
    issn: normalizeBibliographyText(source.issn),
    isbn: normalizeBibliographyText(source.isbn),
    publicationKind: normalizeBibliographyText(source.publicationKind).toLowerCase(),
  };
}

/**
 * 出版信息字段的规范化.
 *
 * These arrive from Crossref or from a paste, and both produce the same two artefacts: stray whitespace and a trailing
 * period (a 刊名 does not end in `.`, and GB/T puts its own punctuation between fields). Placeholders are dropped for the
 * same reason they are dropped elsewhere — 「N/A」 in a citation is worse than an omitted field.
 */
export function normalizeBibliographyText(value: unknown): string {
  const text = cleanText(value);
  if (!text || PLACEHOLDER_NAMES.test(text)) return '';
  return text.replace(/[.。,，;；]+$/g, '').trim();
}

export function readDocumentMetadata(item: KnowledgeLibraryDocument): KnowledgeDocumentMetadata {
  return normalizeDocumentMetadata(item);
}

/** True when the model actually found something; fields it could not read stay out of the count. */
export function hasDocumentMetadata(metadata: KnowledgeDocumentMetadata): boolean {
  return metadata.authors.length > 0
    || Boolean(metadata.publishDate || metadata.language || metadata.documentUrl || metadata.doi);
}

/**
 * Where one field's value came from.
 *
 * Recorded per field because the sources have wildly different reliability — a DOI printed on the page beats a model's
 * guess, the user's own typing beats both, and a reference-database record the user confirmed beats everything automatic
 * — and because the write policy depends on it: an automatic pass may fill a blank, but it must never overwrite something
 * the user typed.
 *
 * - `pdf` — the PDF's own document-information dictionary.
 * - `text` — regular expressions over the file's first pages.
 * - `ai` — the model reading the first page.
 * - `online` — a Crossref/OpenAlex record the user explicitly confirmed (never written without that click).
 * - `manual` — typed by the user; no automatic pass may replace it.
 */
export type KnowledgeMetadataSource = 'pdf' | 'text' | 'ai' | 'online' | 'manual';

export type KnowledgeMetadataSources = Partial<Record<keyof KnowledgeDocumentMetadata, KnowledgeMetadataSource>>;

/** Fields this module manages, in the order the inspector shows them. */
export const METADATA_FIELDS: Array<keyof KnowledgeDocumentMetadata> = [
  // 标题在最前：它是引文里唯一必填的东西。注意「缺元数据」不按它判定——很多文献的首页就是没有可读标题。
  'title',
  'authors',
  'publishDate',
  'language',
  'documentUrl',
  'doi',
  // 出版信息：期刊/会议名、卷期、页码、出版者，以及 Crossref 带来的标识号。顺序即面板里的顺序。
  'containerTitle',
  'volume',
  'issue',
  'page',
  'publisher',
  'publisherPlace',
  'issn',
  'isbn',
  'publicationKind',
];

export function readMetadataSources(item: KnowledgeLibraryDocument): KnowledgeMetadataSources {
  return item.metadataSources ?? {};
}

/** Merges the sources of the fields that actually carry a value now. */
function mergeMetadataSources(
  current: KnowledgeMetadataSources | undefined,
  metadata: KnowledgeDocumentMetadata,
  source: KnowledgeMetadataSource,
): KnowledgeMetadataSources {
  const next: KnowledgeMetadataSources = { ...(current ?? {}) };
  for (const field of METADATA_FIELDS) {
    const value = metadata[field];
    const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (filled) next[field] = source;
    else delete next[field];
  }
  return next;
}

/**
 * Replaces the whole record.
 *
 * Used when the record is known outright (tests, imports, a future bibliographic paste that carries every field). Any
 * partial pass — the offline layer, the model, a re-extract — must go through `applyExtractedMetadata` instead, or it
 * will silently drop fields it did not know about and overwrite values the user typed.
 *
 * `source` labels the fields it filled. Empty results are written too (with `ready`): without that record the panel could
 * not tell "we looked and the document states nothing" from "nobody has looked yet", and would keep offering to spend
 * another call on it.
 */
export function setDocumentMetadata(
  documentId: string,
  metadata: KnowledgeDocumentMetadata,
  source: KnowledgeMetadataSource = 'ai',
): void {
  const item = getKnowledgeDocument(documentId);
  if (!item) return;
  const normalized = normalizeDocumentMetadata(metadata);
  updateKnowledgeDocument(documentId, {
    ...metadataFieldsPatch(normalized),
    metadataSources: mergeMetadataSources(item.metadataSources, normalized, source),
    metadataStatus: 'ready',
    metadataError: undefined,
    metadataAt: new Date().toISOString(),
  });
}

/**
 * Applies an automatic pass (offline heuristics, or the model) without destroying better data.
 *
 * Two rules, both from user reports about "what I typed disappeared":
 * 1. a field whose current source is `manual` is never touched;
 * 2. with `onlyEmpty`, a field that already has a value is kept as-is — so a later pass can add an author the first pass
 *    missed without replacing the DOI the first pass found.
 */
export function applyExtractedMetadata(
  documentId: string,
  incoming: KnowledgeDocumentMetadata,
  source: KnowledgeMetadataSource,
  options: { onlyEmpty?: boolean } = {},
): KnowledgeDocumentMetadata | null {
  const item = getKnowledgeDocument(documentId);
  if (!item) return null;
  const normalized = normalizeDocumentMetadata(incoming);
  const current = readDocumentMetadata(item);
  const sources: KnowledgeMetadataSources = { ...readMetadataSources(item) };
  const merged: KnowledgeDocumentMetadata = { ...current };
  for (const field of METADATA_FIELDS) {
    const value = normalized[field];
    const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!filled) continue;
    if (sources[field] === 'manual') continue;
    const existing = current[field];
    const hasExisting = Array.isArray(existing) ? existing.length > 0 : Boolean(existing);
    if (options.onlyEmpty && hasExisting) continue;
    // `authors` is an array on both sides; the cast is local to this one assignment.
    (merged[field] as unknown) = value;
    // Only the fields this pass actually wrote get its label — a refused value must not relabel the value it left alone.
    sources[field] = source;
  }
  for (const field of METADATA_FIELDS) {
    const value = merged[field];
    const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!filled) delete sources[field];
  }
  updateKnowledgeDocument(documentId, {
    ...metadataFieldsPatch(merged),
    metadataSources: sources,
    metadataStatus: 'ready',
    metadataError: undefined,
    metadataAt: new Date().toISOString(),
  });
  return merged;
}

/** Writes what the user typed. Every field it touches is labelled `manual`, which no automatic pass may overwrite. */
export function saveManualDocumentMetadata(
  documentId: string,
  metadata: KnowledgeDocumentMetadata,
): void {
  const item = getKnowledgeDocument(documentId);
  if (!item) return;
  const normalized = normalizeDocumentMetadata(metadata);
  updateKnowledgeDocument(documentId, {
    ...metadataFieldsPatch(normalized),
    // Only the fields the user actually filled in become manual. A field the form left blank keeps whatever label it had,
    // because the form does not edit every field (ISSN/ISBN/出版类型 only ever come from Crossref) — relabelling those as
    // "nothing" would lose the fact that an online lookup supplied them.
    metadataSources: manualMetadataSources(item, normalized),
    metadataStatus: 'ready',
    metadataError: undefined,
    metadataAt: new Date().toISOString(),
  });
}

/**
 * 手填之后的来源标记.
 *
 * `mergeMetadataSources` deletes the label of every empty field, which is right for a *pass* over a whole record and wrong
 * here: the edit form sends `''` for ISSN/ISBN/出版类型 by design, so saving an author would have wiped their 「在线确认」
 * badge while the values stayed in the record.
 */
function manualMetadataSources(
  item: KnowledgeLibraryDocument,
  normalized: KnowledgeDocumentMetadata,
): KnowledgeMetadataSources {
  const sources: KnowledgeMetadataSources = { ...readMetadataSources(item) };
  for (const field of METADATA_FIELDS) {
    const value = normalized[field];
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) {
      sources[field] = 'manual';
      continue;
    }
    const stored = item[field];
    const storedFilled = Array.isArray(stored) ? stored.length > 0 : Boolean(stored);
    // 空着、但记录里有值：表单没编辑这个字段，保留它原来的来源。
    if (!storedFilled) delete sources[field];
  }
  return sources;
}

export function markDocumentMetadataExtracting(documentId: string): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, { metadataStatus: 'extracting', metadataError: undefined });
}

export function markDocumentMetadataFailed(documentId: string, message: string): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, { metadataStatus: 'error', metadataError: message });
}

/**
 * The user says this document needs no bibliographic metadata (a handout, an internal report, a journal without DOIs).
 *
 * A terminal state, not a failure: the library stops offering to extract, and the 缺元数据 filter stops listing it.
 */
export function skipDocumentMetadata(documentId: string): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, {
    metadataStatus: 'skipped',
    metadataError: undefined,
    metadataAt: new Date().toISOString(),
  });
}

export function resumeDocumentMetadata(documentId: string): void {
  const item = getKnowledgeDocument(documentId);
  if (!item || item.metadataStatus !== 'skipped') return;
  updateKnowledgeDocument(documentId, { metadataStatus: 'pending', metadataAt: undefined });
}

/**
 * Whether this document still wants attention in the 缺元数据 view.
 *
 * `skipped` is excluded on purpose: the user told us it needs nothing, and a filter that keeps listing it would nag.
 * A document with a DOI but no authors still counts as missing — the point is citable records, not a filled-in form.
 */
export function isMetadataMissing(item: KnowledgeLibraryDocument): boolean {
  if (item.metadataStatus === 'skipped') return false;
  const metadata = readDocumentMetadata(item);
  return !metadata.publishDate || !metadata.doi || metadata.authors.length === 0;
}

/** Wraps a plain record into the patch shape the corpus expects (empty values are dropped, not stored as ""). */
export function metadataFieldsPatch(
  metadata: KnowledgeDocumentMetadata,
): Pick<Partial<KnowledgeLibraryDocument>, keyof KnowledgeDocumentMetadata> {
  // Derived from METADATA_FIELDS rather than listing the keys: the first version listed six fields, and when the
  // bibliographic ones (卷/期/页码/出版者) were added they were silently dropped on the way to storage — the record showed
  // them nowhere, and nothing failed. `METADATA_FIELDS` is the one list that cannot drift from the merge loop.
  const patch: Partial<Record<keyof KnowledgeDocumentMetadata, unknown>> = {};
  for (const field of METADATA_FIELDS) {
    const value = metadata[field];
    const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
    // Empty values are dropped, not stored as `''`: "not known" and "known to be empty" are different records.
    if (filled) patch[field] = value;
  }
  return patch as Pick<Partial<KnowledgeLibraryDocument>, keyof KnowledgeDocumentMetadata>;
}

/** The DOI's canonical link, for the anchor the panel renders. */
export function doiUrl(doi: string): string {
  return doi ? `https://doi.org/${doi}` : '';
}
