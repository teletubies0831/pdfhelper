/**
 * 引文输出：BibTeX / RIS / GB/T 7714 / Markdown.
 *
 * 这个模块只做「把记录变成字符串」，不读写存储，所以每一种格式都能被测试到字符级。
 *
 * The rule that shapes it: **never invent a field**. A citation is copied into a paper, so a guessed venue or a made-up
 * year is worse than a missing one — a missing `year` is visible and fixable, a wrong one is not. Two consequences:
 * entry types are the generic ones (`@misc` / `TY  - GEN` / `[Z]`/`[EB/OL]`) because this app does not know whether a
 * document is a journal article or a tech report, and every field that is unknown is omitted rather than emitted empty.
 *
 * The one fallback that is allowed is the title: a paper with no extracted title is cited under its file name, and
 * `titleFromFileName` says so, because otherwise the file name would silently become a bibliography entry.
 */

export type CitationStyle = 'bibtex' | 'ris' | 'gbt7714' | 'markdown';

/**
 * DOI → 可点链接.
 *
 * Inlined rather than imported from `document-metadata`: this module is imported directly by a Node test (type stripping
 * runs it without a bundler), and a runtime import of a sibling `.ts` file would need an extension that the bundler
 * resolution in this project does not use. The rule itself is the same one `doiUrl` applies.
 */
function doiResolverUrl(doi: string): string {
  return `https://doi.org/${doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}`;
}

export const CITATION_STYLES: ReadonlyArray<{ id: CitationStyle; label: string; hint: string }> = [
  { id: 'bibtex', label: 'BibTeX', hint: '@misc · LaTeX / 文献管理软件' },
  { id: 'ris', label: 'RIS', hint: 'TY  - GEN · EndNote / Zotero' },
  { id: 'gbt7714', label: 'GB/T 7714', hint: '中文期刊常用格式' },
  { id: 'markdown', label: 'Markdown', hint: '链接形式，适合笔记与草稿' },
];

export interface CitationRecord {
  title: string;
  /** 标题来自文件名而不是文献本身：引用能生成，但要在界面上说明。 */
  titleFromFileName: boolean;
  authors: string[];
  /** 四位年份；认不出就留空，不猜。 */
  year: string;
  doi: string;
  /** 最终可点的链接：`documentUrl`，没有就用 DOI 解析地址。 */
  url: string;
  language: string;
  /** 期刊名或会议论文集名（GB/T 里 `[J]`/`[C]` 之后的那一段）。 */
  containerTitle: string;
  volume: string;
  issue: string;
  page: string;
  publisher: string;
  publisherPlace: string;
  issn: string;
  isbn: string;
  /** Crossref 的类型原值，决定 `[J]` / `[C]` / `[M]` / `[EB]`。 */
  publicationKind: string;
}

/** 从出版日期里取年份：`2021`、`2021-05`、`May 2021` 都能取，取不到就空。 */
export function citationYear(publishDate: string): string {
  const match = publishDate.match(/(\d{4})/);
  return match ? match[1] ?? '' : '';
}

/**
 * 解析标题：优先元数据里的真标题，其次概览的第一行标题，最后才退到文件名。
 *
 * 概览那一步不是多余的：很多文献在元数据抽取失败、但用户让它生成过概览，而概览的标题通常就是论文标题。
 * 只有最后一步会产生「标题其实是文件名」的情况，调用方据此给出提示。
 */
export function resolveCitationTitle(input: {
  metadataTitle: string;
  overviewMarkdown?: string;
  documentName: string;
}): { title: string; fromFileName: boolean } {
  const metadataTitle = input.metadataTitle.trim();
  if (metadataTitle) return { title: metadataTitle, fromFileName: false };
  const heading = input.overviewMarkdown?.match(/^\s{0,3}#{1,2}\s+(.+)$/m)?.[1]?.trim() ?? '';
  // 概览的第一行常常是「PDF 概览」这类固定标题，不能当文献标题用。
  const generic = /^(?:pdf\s*概览|概览|摘要|overview)$/i;
  if (heading && !generic.test(heading)) return { title: heading, fromFileName: false };
  return {
    title: input.documentName.replace(/\.pdf$/i, '').trim(),
    fromFileName: true,
  };
}

/** 组装一条可用于引用的记录。 */
export function buildCitationRecord(input: {
  metadataTitle: string;
  overviewMarkdown?: string;
  documentName: string;
  authors: readonly string[];
  publishDate: string;
  doi: string;
  documentUrl: string;
  language: string;
  containerTitle?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  publisherPlace?: string;
  issn?: string;
  isbn?: string;
  publicationKind?: string;
}): CitationRecord {
  const { title, fromFileName } = resolveCitationTitle(input);
  const doi = input.doi.trim();
  return {
    title,
    titleFromFileName: fromFileName,
    authors: [...input.authors].map((author) => author.trim()).filter(Boolean),
    year: citationYear(input.publishDate),
    doi,
    url: input.documentUrl.trim() || (doi ? doiResolverUrl(doi) : ''),
    language: input.language.trim(),
    containerTitle: (input.containerTitle ?? '').trim(),
    volume: (input.volume ?? '').trim(),
    issue: (input.issue ?? '').trim(),
    page: (input.page ?? '').trim(),
    publisher: (input.publisher ?? '').trim(),
    publisherPlace: (input.publisherPlace ?? '').trim(),
    issn: (input.issn ?? '').trim(),
    isbn: (input.isbn ?? '').trim(),
    publicationKind: (input.publicationKind ?? '').trim().toLowerCase(),
  };
}

/** LaTeX 里有特殊含义的字符；不转义会让整份 .bib 编译失败。 */
function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%$#&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * 引用键：`姓 + 年份`，只保留 ASCII 字母数字。
 *
 * CJK 作者名没有拉丁姓氏可拆，直接整名保留（去掉分隔符）。重名同年时 LaTeX 会自己加 a/b，这里不预判。
 */
export function citationKey(record: CitationRecord): string {
  const firstAuthor = record.authors[0] ?? '';
  // `Last, First` → the part before the comma; `Given Last` → the last word; a single token (a CJK name) stays whole.
  const surname = firstAuthor.includes(',')
    ? (firstAuthor.split(',')[0] ?? '').trim()
    : (firstAuthor.trim().split(/\s+/).at(-1) ?? '');
  const base = `${surname || 'pdfpal'}${record.year}`.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
  return base || `pdfpal${record.year}`;
}

export function formatBibtex(record: CitationRecord): string {
  const lines = [`  title = {${escapeLatex(record.title)}}`];
  if (record.authors.length) lines.push(`  author = {${record.authors.map(escapeLatex).join(' and ')}}`);
  if (record.year) lines.push(`  year = {${record.year}}`);
  // `doi` and `url` stay verbatim: they are identifiers, and a LaTeX-escaped DOI (`10.1007/…\_6`) no longer resolves.
  if (record.doi) lines.push(`  doi = {${record.doi}}`);
  if (record.url) lines.push(`  url = {${record.url}}`);
  // 没有期刊/会议信息，所以不写 journal/booktitle —— 编一个比空着更糟。
  return `@misc{${citationKey(record)},\n${lines.join(',\n')}\n}`;
}

export function formatRis(record: CitationRecord): string {
  // `GEN` 是 RIS 里的「通用/未指定类型」，与 BibTeX 的 `@misc` 对应；`JOUR` 会声称这是一篇期刊论文。
  const lines = ['TY  - GEN', `TI  - ${record.title}`];
  for (const author of record.authors) lines.push(`AU  - ${author}`);
  if (record.year) lines.push(`PY  - ${record.year}`);
  if (record.doi) lines.push(`DO  - ${record.doi}`);
  if (record.url) lines.push(`UR  - ${record.url}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

/**
 * GB/T 7714-2015 的文献类型标识.
 *
 * 依据的是来源给的 `publicationKind`（Crossref 的 `type`），不是从刊名里猜：会议论文集和期刊在文字上几乎无法区分，而
 * 差别正好决定引文写 `[C]` 还是 `[J]`。没有类型信息时的兜底顺序是——有刊名、没有出版者 → 期刊；有刊名和出版者 →
 * 会议；其余 → `[EB]`（电子资源，这是唯一不需要额外知识的判断）。
 *
 * 带 DOI 或链接的文献按标准加 `/OL`（`[J/OL]`、`[C/OL]`）。
 */
export type GbtDocumentType = 'J' | 'C' | 'M' | 'D' | 'EB';

const KIND_TO_TYPE: ReadonlyArray<[RegExp, GbtDocumentType]> = [
  [/journal-?article|journal|article-journal/, 'J'],
  [/proceedings-?article|proceedings|conference|paper-conference/, 'C'],
  [/book-?chapter|book|monograph|edited-book/, 'M'],
  [/dissertation|thesis/, 'D'],
  [/posted-content|preprint|dataset|report|standard|web|dataset-/, 'EB'],
];

export function getDocType(metadata: Pick<CitationRecord, 'publicationKind' | 'containerTitle' | 'publisher' | 'url' | 'doi'>): {
  code: GbtDocumentType;
  /** 是否带 `/OL`：有 DOI 或可访问链接的线上版本才加。 */
  online: boolean;
  /** 完整标识，如 `[J/OL]`。 */
  label: string;
} {
  const kind = metadata.publicationKind.toLowerCase();
  let code: GbtDocumentType | null = null;
  for (const [pattern, type] of KIND_TO_TYPE) {
    if (pattern.test(kind)) {
      code = type;
      break;
    }
  }
  if (!code) {
    if (metadata.containerTitle && metadata.publisher) code = 'C';
    else if (metadata.containerTitle) code = 'J';
    else code = 'EB';
  }
  const online = Boolean(metadata.doi || metadata.url);
  // `[EB/OL]` 就是电子资源的标准写法；其它类型加上 `/OL` 表示这是线上版（`[J/OL]`、`[C/OL]`）。
  const label = online ? `[${code}/OL]` : `[${code}]`;
  return { code, online, label };
}

/**
 * 作者名按 GB/T 7714 的写法.
 *
 * 西文：姓全大写、名缩写为首字母且不带缩写点（`BOYAR J`）；中文：姓名原样保留，不转大写、不缩写。
 * 超过 3 位时只列前 3 位，后接「, 等」（中文文献）或「, et al.」（外文文献）——标准对两种语言的要求不同，
 * 这里按记录的语言决定，而不是一律用「等」。
 */
export function formatAuthors(authors: readonly string[], language = ''): string {
  const chinese = /^zh\b/i.test(language) || authors.some((author) => /[\u4e00-\u9fff]/.test(author));
  const names = authors
    .map((author) => author.trim())
    .filter(Boolean)
    .map((author) => (chinese ? author : latinAuthorInitials(author)));
  if (!names.length) return '';
  const shown = names.slice(0, 3);
  const suffix = names.length > 3 ? (chinese ? ', 等' : ', et al') : '';
  return `${shown.join(', ')}${suffix}`;
}

/** `Joan Boyar` → `BOYAR J`；`Boyar, Joan` → `BOYAR J`；已经是 `BOYAR J` 的保持原样。 */
function latinAuthorInitials(author: string): string {
  const trimmed = author.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const [family, given] = trimmed.includes(',')
    ? [trimmed.slice(0, trimmed.indexOf(',')), trimmed.slice(trimmed.indexOf(',') + 1)]
    : splitGivenAndFamily(trimmed);
  const surname = family.trim().toUpperCase();
  // 每个名取首个字母，保留连字符名的两个首字母（`Jean-Paul` → `J P`），中间用空格分隔，不加点。
  const initials = given
    .split(/[\s.-]+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  return initials ? `${surname} ${initials}` : surname;
}

/**
 * 没有逗号的名字怎么拆姓与名.
 *
 * `Joan Boyar` → 名在前、姓在后；但 `de la Cruz`、`van der Waals` 这类姓氏本身带小写前缀，最后一个词不是全姓。
 * 规则：从后往前收，直到遇到一个以大写开头的词为止——`Boyar` 停；`de la Cruz` 会连成 `DE LA CRUZ`。
 */
function splitGivenAndFamily(author: string): [string, string] {
  const words = author.split(/\s+/);
  if (words.length === 1) return [author, ''];
  let start = words.length - 1;
  while (start > 0 && /^[a-z\u00e0-\u00ff]/.test(words[start - 1] ?? '')) start -= 1;
  return [words.slice(start).join(' '), words.slice(0, start).join(' ')];
}

/** 引用日期：`[YYYY-MM-DD]`，默认取当前日期（前端时间），测试可注入固定值。 */
export function citationAccessDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 起止页码：GB/T 用连字符，`45-56`；单个页码原样；`e1234` 这类电子页码也原样。 */
function pageRange(page: string): string {
  return page.replace(/\s*[-–—~]\s*/g, '-').trim();
}

/**
 * GB/T 7714-2015 引文.
 *
 * 期刊：`作者. 题名[J/OL]. 刊名, 年, 卷(期): 页码[引用日期]. 访问路径.`
 * 会议：`作者. 题名[C/OL]//论文集名. 出版地: 出版者, 出版年: 页码[引用日期]. 访问路径.`
 *
 * 组装顺序严格按标准，但**缺的字段整段省略**：没有卷期就不写 `, 2020, ():` 这种空壳。标准的标点本身是有含义的，所以
 * 每个分隔符只在它连接的两段都存在时才出现。
 */
export function formatGbT7714(
  record: CitationRecord,
  options: { citedAt?: string } = {},
): string {
  const type = getDocType(record);
  const citedAt = options.citedAt ?? citationAccessDate();
  const authors = formatAuthors(record.authors, record.language);
  const head = authors ? `${authors}. ` : '';
  const title = `${head}${record.title}${type.label}`;

  let body: string;
  if (type.code === 'C') {
    // 会议：//论文集名. 出版地: 出版者, 出版年: 页码
    const publication = [record.publisherPlace, record.publisher].filter(Boolean).join(': ');
    const imprint = [publication, record.year].filter(Boolean).join(', ');
    const tail = [imprint, record.page].filter(Boolean).join(': ');
    body = record.containerTitle
      ? [`//${record.containerTitle}`, tail].filter(Boolean).join('. ')
      : tail;
  } else if (type.code === 'J') {
    // 期刊：刊名, 年, 卷(期): 页码
    const volumeIssue = record.volume && record.issue
      ? `${record.volume}(${record.issue})`
      : record.volume || (record.issue ? `(${record.issue})` : '');
    const serial = [record.containerTitle, record.year, volumeIssue].filter(Boolean).join(', ');
    body = [serial, pageRange(record.page)].filter(Boolean).join(': ');
  } else {
    // 电子资源/专著/学位论文：出版者与年份排在前面即可，没有刊名可写。
    const imprint = [record.publisherPlace, record.publisher].filter(Boolean).join(': ');
    body = [imprint, record.year, pageRange(record.page)].filter(Boolean).join('. ');
  }

  // 访问日期紧跟在页码（或出版信息）后面，中间没有点：`…: 45-56[2026-10-21]. https://…`
  const path = record.url || (record.doi ? doiResolverUrl(record.doi) : '');
  const access = path ? `${body ? '' : '.'}[${citedAt}]. ${path}` : '';

  // 会议文献的 `//` 紧跟在类型标识后面，中间没有点：`题名[C/OL]//论文集名. …`
  const separator = type.code === 'C' && record.containerTitle ? '' : '. ';
  const headPart = [title, body].filter(Boolean).join(separator);
  return `${headPart}${access}.`.replace(/\.\s*\./g, '.');
}

export function formatMarkdown(record: CitationRecord): string {
  return record.url ? `[${record.title}](${record.url})` : record.title;
}

export function formatCitation(
  record: CitationRecord,
  style: CitationStyle,
  options: { citedAt?: string } = {},
): string {
  switch (style) {
    case 'ris': return formatRis(record);
    case 'gbt7714': return formatGbT7714(record, options);
    case 'markdown': return formatMarkdown(record);
    default: return formatBibtex(record);
  }
}

/**
 * 这条引文缺了什么.
 *
 * 给用户看的，不是给解析器看的：复制到论文里之前，最需要知道的是「这条引文不完整在哪」。缺项按影响排：没有作者和年份
 * 的引文基本不能用，标题来自文件名则要补全标题。
 */
export function citationWarnings(record: CitationRecord): string[] {
  const warnings: string[] = [];
  if (!record.authors.length) warnings.push('没有作者信息，引文里会缺作者。');
  if (!record.year) warnings.push('没有出版年份，引文里会缺年份。');
  if (record.titleFromFileName) warnings.push('标题取自文件名，建议在「编辑文献信息」里补上真实标题。');
  if (!record.doi && !record.url) warnings.push('没有 DOI，也没有链接。');
  return warnings;
}