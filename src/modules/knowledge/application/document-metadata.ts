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

/** The five fields, as one record, so the panel can render them in a fixed order. */
export interface KnowledgeDocumentMetadata {
  authors: string[];
  publishDate: string;
  language: string;
  documentUrl: string;
  doi: string;
}

export const EMPTY_DOCUMENT_METADATA: KnowledgeDocumentMetadata = {
  authors: [],
  publishDate: '',
  language: '',
  documentUrl: '',
  doi: '',
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

/** Normalizes a whole record, so every writer produces the same shapes. */
export function normalizeDocumentMetadata(
  input: Partial<Record<keyof KnowledgeDocumentMetadata, unknown>> | null | undefined,
): KnowledgeDocumentMetadata {
  const source = input ?? {};
  return {
    authors: normalizeAuthors(source.authors),
    publishDate: normalizePublishDate(source.publishDate),
    language: normalizeLanguage(source.language),
    documentUrl: normalizeDocumentUrl(source.documentUrl),
    doi: normalizeDoi(source.doi),
  };
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
 * Stores the result of one extraction.
 *
 * Empty results are written too: without the record the panel could not tell "the model found nothing" from "this
 * document was never processed", and would keep offering to spend another call on it.
 */
export function setDocumentMetadata(
  documentId: string,
  metadata: KnowledgeDocumentMetadata,
): void {
  if (!getKnowledgeDocument(documentId)) return;
  const normalized = normalizeDocumentMetadata(metadata);
  updateKnowledgeDocument(documentId, {
    authors: normalized.authors.length ? normalized.authors : undefined,
    publishDate: normalized.publishDate || undefined,
    language: normalized.language || undefined,
    documentUrl: normalized.documentUrl || undefined,
    doi: normalized.doi || undefined,
    metadataStatus: 'ready',
    metadataError: undefined,
    metadataAt: new Date().toISOString(),
  });
}

export function markDocumentMetadataExtracting(documentId: string): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, { metadataStatus: 'extracting', metadataError: undefined });
}

export function markDocumentMetadataFailed(documentId: string, message: string): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, { metadataStatus: 'error', metadataError: message });
}

/** The DOI's canonical link, for the anchor the panel renders. */
export function doiUrl(doi: string): string {
  return doi ? `https://doi.org/${doi}` : '';
}
