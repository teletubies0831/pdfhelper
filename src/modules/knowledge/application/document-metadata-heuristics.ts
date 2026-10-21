import {
  normalizeDocumentMetadata,
  normalizeDoi,
  normalizeLanguage,
  type KnowledgeDocumentMetadata,
} from './document-metadata';

/**
 * 免费离线元数据层.
 *
 * Most academic PDFs already *state* what we want: a DOI printed under the title or in the footer, an `arXiv:2401.01234`
 * stamp down the left margin, a `© 2019 IEEE` line, a Chinese `收稿日期`. Reading those with regular expressions is
 * free, works offline, is deterministic, and — the reason it goes first — cannot mismatch a paper: whatever it finds was
 * literally printed in this file.
 *
 * What it deliberately does *not* do: guess an author from a citation in the introduction, invent a publication date
 * from the file's creation timestamp, or look anything up online. The model pass still runs afterwards and fills the
 * fields this layer leaves empty; the user can always type over both.
 */

export interface OfflineMetadataHints {
  /** File name as the library knows it — often contains the year or the arXiv id. */
  documentName: string;
  /** First few pages of extracted text. */
  headText: string;
  /** `pdfjs` `getMetadata().info` — the PDF's own document information dictionary. */
  pdfInfo?: {
    Title?: unknown;
    Author?: unknown;
    Subject?: unknown;
    Keywords?: unknown;
    CreationDate?: unknown;
  } | null;
}

export interface OfflineMetadataResult {
  /** What the PDF's own document-information dictionary states (title/author/…). */
  fromPdf: KnowledgeDocumentMetadata;
  /** What regular expressions over the first pages — and, as a last resort, the file name — state. */
  fromText: KnowledgeDocumentMetadata;
  /** Field → the rule that produced it, for the panel's "where did this come from" hint and for debugging. */
  matchedRules: Partial<Record<keyof KnowledgeDocumentMetadata, string>>;
}

/** Modern arXiv ids: `YYMM.NNNN(N)`; `2401.01234` reads as January 2024. */
const ARXIV_NEW = /\barxiv[:\s]*((\d{2})(\d{2})\.\d{4,5})(?:v\d+)?/i;
/** Legacy arXiv ids: `cs/0112017` (subject class + YYMM + sequence). */
const ARXIV_OLD = /\barxiv[:\s]*([a-z-]+(?:\.[A-Z]{2})?\/(\d{2})(\d{2})\d{3})(?:v\d+)?/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/((\d{2})(\d{2})\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;
const DOI = /\b10\.\d{4,9}\/[^\s"'<>()\[\]]+/;

/** `© 2019 IEEE`, `Copyright 2019`, `(c) 2019 ACM`. The year is the publication year in every style we have seen. */
const COPYRIGHT = /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/i;
/** 中文期刊常见：收稿日期 / 发表日期 / 出版日期. */
const CHINESE_DATE = /(?:收稿日期|投稿日期|发表日期|出版日期|修回日期)\s*[:：]?\s*((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2}))?/;
/** `Received 12 March 2019` / `Accepted: 2019-03-12` — the *submission* date, only used when nothing better exists. */
const ENGLISH_RECEIVED = /\b(?:received|accepted|published(?:\s+online)?)\b[^\n]{0,24}?((?:19|20)\d{2})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/i;
/** A bare year in the file name (`2010-Boyar & Peralta-….pdf`) — a hint, weaker than anything printed inside. */
const FILENAME_YEAR = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/;

const SOFTWARE_AUTHOR = /^(?:microsoft|word|adobe|acrobat|latex|pdf(?:tex|jam|creator)?|ghostscript|indesign|canva|office|pages|wps|unknown|user|admin|author)\b/i;

/** 生成器写进 Title 的占位文字：`Microsoft Word - 文稿1`、`Untitled`、`无标题`。 */
const PLACEHOLDER_TITLE = /^(?:microsoft\s+word|untitled|无标题|未命名|document\d*|slide\s*\d+|powerpoint\s+presentation|book\s*\d+)\b/i;

/**
 * PDF 的 Title 值不值得当文献标题.
 *
 * The property is unreliable in a specific way: Word, PowerPoint and LaTeX all write their own placeholder, and some
 * exporters copy the file name into it. Those are the cases this rejects — everything else (a sentence-length string with
 * spaces, or a CJK title) is accepted, because a real title read from the document is worth more than a model call.
 */
function plausiblePdfTitle(value: string, documentName: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 300) return '';
  if (PLACEHOLDER_TITLE.test(trimmed)) return '';
  if (SOFTWARE_AUTHOR.test(trimmed)) return '';
  // 与文件名相同（去掉 .pdf）的 Title 没有提供任何新信息。
  const stem = documentName.replace(/\.pdf$/i, '').trim().toLowerCase();
  if (trimmed.toLowerCase() === stem) return '';
  if (!/[A-Za-z\u4e00-\u9fff]/.test(trimmed)) return '';
  return trimmed.replace(/\s+/g, ' ');
}

/** True when a string looks like a person list rather than the software that produced the file. */
function plausibleAuthors(value: string): string[] {  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return [];
  if (SOFTWARE_AUTHOR.test(trimmed)) return [];
  if (!/[A-Za-z\u4e00-\u9fff]/.test(trimmed)) return [];
  // A real author list separates names; a single token with no space is a login name, not an author.
  const parts = trimmed.split(/\s*(?:;|；|\band\b|&|、)\s*/).filter(Boolean);
  const names = parts.filter((part) => part.trim().split(/\s+/).length >= 2 || /[\u4e00-\u9fff]{2,}/.test(part));
  return names.map((name) => name.trim()).filter(Boolean);
}

/** Publication date from an arXiv id: `2401` → `2024-01`, `cs/0112017` → `2001-12`. */
function dateFromArxiv(year: string, month: string): string {
  const monthNumber = Number(month);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return '';
  return `20${year}-${String(monthNumber).padStart(2, '0')}`;
}

/**
 * The language of the document, from its own text: mostly-CJK means Chinese.
 *
 * Deliberately crude and deliberate about its failure mode — an English abstract on page 1 of a Chinese paper can tip this
 * to `en`, which is why it only ever fills an empty field and never overrides the model or the user.
 */
function detectLanguage(text: string): string {
  const sample = text.slice(0, 4_000);
  if (!sample) return '';
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (cjk >= 40 && cjk * 4 >= latin) return 'zh';
  if (latin >= 40) return 'en';
  return '';
}

/**
 * Reads everything the file itself states.
 *
 * Order matters: a DOI/arXiv identifier is the most trustworthy thing a PDF can carry (it *is* the identity), so it wins
 * over the copyright line for the date, which in turn wins over a submission date, which wins over a year in the file
 * name.
 */
export function extractOfflineDocumentMetadata(hints: OfflineMetadataHints): OfflineMetadataResult {
  const headText = hints.headText ?? '';
  const pdfInfo = hints.pdfInfo ?? null;
  const searchable = [
    headText,
    typeof pdfInfo?.Subject === 'string' ? pdfInfo.Subject : '',
    typeof pdfInfo?.Keywords === 'string' ? pdfInfo.Keywords : '',
  ].filter(Boolean).join('\n');
  const matchedRules: OfflineMetadataResult['matchedRules'] = {};

  let doi = '';
  const doiMatch = searchable.match(DOI);
  if (doiMatch) {
    doi = normalizeDoi(doiMatch[0]);
    if (doi) matchedRules.doi = '正文中的 DOI';
  }

  let arxivId = '';
  let arxivDate = '';
  const arxivMatch = searchable.match(ARXIV_NEW) ?? searchable.match(ARXIV_URL);
  if (arxivMatch) {
    arxivId = arxivMatch[1] ?? '';
    arxivDate = dateFromArxiv(arxivMatch[2] ?? '', arxivMatch[3] ?? '');
    if (arxivId) matchedRules.documentUrl = '正文中的 arXiv 编号';
  } else {
    const legacy = searchable.match(ARXIV_OLD);
    if (legacy) {
      arxivId = legacy[1] ?? '';
      arxivDate = dateFromArxiv(legacy[2] ?? '', legacy[3] ?? '');
      if (arxivId) matchedRules.documentUrl = '正文中的 arXiv 编号';
    }
  }

  let documentUrl = '';
  if (arxivId) documentUrl = `https://arxiv.org/abs/${arxivId}`;
  else if (doi) {
    documentUrl = `https://doi.org/${doi}`;
    matchedRules.documentUrl = '由 DOI 推出';
  }

  let publishDate = arxivDate;
  if (publishDate) matchedRules.publishDate = 'arXiv 编号推出的年月';
  if (!publishDate) {
    const chinese = searchable.match(CHINESE_DATE);
    if (chinese) {
      const [, year, month, day] = chinese;
      publishDate = [year, month?.padStart(2, '0'), day?.padStart(2, '0')].filter(Boolean).join('-');
      matchedRules.publishDate = '正文中的日期行';
    }
  }
  if (!publishDate) {
    const copyright = searchable.match(COPYRIGHT);
    if (copyright?.[1]) {
      publishDate = copyright[1];
      matchedRules.publishDate = '版权行中的年份';
    }
  }
  if (!publishDate) {
    const received = searchable.match(ENGLISH_RECEIVED);
    if (received) {
      const [, year, month, day] = received;
      publishDate = [year, month?.padStart(2, '0'), day?.padStart(2, '0')].filter(Boolean).join('-');
      matchedRules.publishDate = '投稿/接收日期（不是出版日期，仅供参考）';
    }
  }
  if (!publishDate) {
    const fromName = hints.documentName.match(FILENAME_YEAR);
    if (fromName?.[1]) {
      publishDate = fromName[1];
      matchedRules.publishDate = '文件名中的年份（不可靠）';
    }
  }

  const authors = typeof pdfInfo?.Author === 'string' ? plausibleAuthors(pdfInfo.Author) : [];
  if (authors.length) matchedRules.authors = 'PDF 文档属性中的作者';

  // PDF 的 Title 属性常常是真正的大标题，但也常常是文件名或生成软件写的「Microsoft Word - 文稿1」。只接受看起来像标题的。
  const title = plausiblePdfTitle(
    typeof pdfInfo?.Title === 'string' ? pdfInfo.Title : '',
    hints.documentName,
  );
  if (title) matchedRules.title = 'PDF 文档属性中的标题';

  const language = detectLanguage(headText);
  if (language) matchedRules.language = '正文语言（启发式）';

  return {
    fromPdf: normalizeDocumentMetadata({ title, authors }),
    fromText: normalizeDocumentMetadata({
      publishDate,
      language,
      documentUrl,
      doi,
    }),
    matchedRules,
  };
}
