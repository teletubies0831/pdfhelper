import assert from 'node:assert/strict';

import {
  buildCitationRecord,
  citationKey,
  citationWarnings,
  citationYear,
  formatAuthors,
  formatBibtex,
  formatCitation,
  formatGbT7714,
  formatMarkdown,
  formatRis,
  getDocType,
  resolveCitationTitle,
} from '../src/modules/knowledge/application/citation-format.ts';

/**
 * 引文格式的契约.
 *
 * The tests are character-level on purpose: a citation is copied into a paper, so a stray brace breaks a `.bib` build and
 * a made-up field becomes a wrong bibliography entry. Two properties get checked over and over below: **unknown fields
 * are omitted**, and **nothing is invented** — no `@article` for a document whose type we do not know, no publisher, no
 * venue, no placeholder year.
 */

const full = buildCitationRecord({
  metadataTitle: 'A new combinational logic minimization technique with applications to cryptology',
  documentName: '2010-Boyar-…-technique.pdf',
  authors: ['Joan Boyar', 'René Peralta'],
  publishDate: '2010',
  doi: '10.1007/978-3-642-16342-5_6',
  documentUrl: 'https://doi.org/10.1007/978-3-642-16342-5_6',
  language: 'en',
});

// ---------------------------------------------------------------------------
// 标题解析：先元数据，再概览标题，最后才文件名（并且要标出来）
// ---------------------------------------------------------------------------
{
  assert.deepEqual(
    resolveCitationTitle({ metadataTitle: 'Real Title', documentName: 'file.pdf' }),
    { title: 'Real Title', fromFileName: false },
  );
  assert.deepEqual(
    resolveCitationTitle({ metadataTitle: '', overviewMarkdown: '# 论文标题\n\n正文', documentName: 'file.pdf' }),
    { title: '论文标题', fromFileName: false },
    'a generated overview usually starts with the paper title',
  );
  // 「PDF 概览」 is this app's own heading, not the paper's.
  assert.deepEqual(
    resolveCitationTitle({ metadataTitle: '', overviewMarkdown: '# PDF 概览\n\n正文', documentName: 'My Paper.pdf' }),
    { title: 'My Paper', fromFileName: true },
  );
  assert.deepEqual(
    resolveCitationTitle({ metadataTitle: '', documentName: 'My Paper.pdf' }),
    { title: 'My Paper', fromFileName: true },
    'the file name is a last resort, and it is flagged',
  );
}

// ---------------------------------------------------------------------------
// 年份：只从出版日期里取四位数字，取不到就空
// ---------------------------------------------------------------------------
{
  assert.equal(citationYear('2010'), '2010');
  assert.equal(citationYear('2010-05'), '2010');
  assert.equal(citationYear('May 2010'), '2010');
  assert.equal(citationYear(''), '');
  assert.equal(citationYear('n.d.'), '');
}

// ---------------------------------------------------------------------------
// BibTeX：通用条目类型、未知字段整行省略、特殊字符转义
// ---------------------------------------------------------------------------
{
  const bibtex = formatBibtex(full);
  assert.match(bibtex, /^@misc\{Boyar2010,$/m, 'generic entry type: this app does not know the publication type');
  assert.match(bibtex, /title = \{A new combinational logic minimization technique/);
  assert.match(bibtex, /author = \{Joan Boyar and René Peralta\}/);
  assert.match(bibtex, /year = \{2010\}/);
  assert.match(bibtex, /doi = \{10\.1007\/978-3-642-16342-5_6\}/, 'a DOI is an identifier: underscores stay unescaped');
  assert.doesNotMatch(bibtex, /journal|booktitle|publisher/, 'no venue is invented');

  // Missing fields are omitted, never emitted as `year = {}`.
  const sparse = buildCitationRecord({
    metadataTitle: 'Untitled work', documentName: 'x.pdf', authors: [], publishDate: '', doi: '', documentUrl: '', language: '',
  });
  const sparseBibtex = formatBibtex(sparse);
  assert.doesNotMatch(sparseBibtex, /year = /);
  assert.doesNotMatch(sparseBibtex, /author = /);
  assert.doesNotMatch(sparseBibtex, /doi = /);
  assert.match(sparseBibtex, /^@misc\{pdfpal,/);

  // LaTeX specials would break the build without escaping.
  const special = buildCitationRecord({
    metadataTitle: 'Costs & risks of 100% coverage: a_b test #2',
    documentName: 'x.pdf', authors: ['A & B'], publishDate: '2020', doi: '', documentUrl: '', language: '',
  });
  const specialBibtex = formatBibtex(special);
  assert.match(specialBibtex, /Costs \\& risks of 100\\% coverage: a\\_b test \\#2/);
  assert.match(specialBibtex, /author = \{A \\& B\}/);
}

// ---------------------------------------------------------------------------
// 引用键：ASCII 安全，CJK 名字原样保留
// ---------------------------------------------------------------------------
{
  assert.equal(citationKey(full), 'Boyar2010', 'the surname, not the given name');
  assert.equal(citationKey({ ...full, authors: ['张三'], year: '' }), '张三', 'a CJK surname is kept as is');
  assert.equal(citationKey({ ...full, authors: [], year: '' }), 'pdfpal');
  assert.equal(citationKey({ ...full, authors: ['Cruz, Ana de la'], year: '2019' }), 'Cruz2019', 'Last, First form');
  assert.equal(citationKey({ ...full, authors: ['Ana de la Cruz'], year: '2019' }), 'Cruz2019', 'Given Last form');
}

// ---------------------------------------------------------------------------
// RIS：通用类型、一个作者一行、以 ER 收尾
// ---------------------------------------------------------------------------
{
  const ris = formatRis(full);
  const lines = ris.split('\n');
  assert.equal(lines[0], 'TY  - GEN');
  assert.ok(lines.includes('TI  - A new combinational logic minimization technique with applications to cryptology'));
  assert.equal(lines.filter((line) => line.startsWith('AU  - ')).length, 2);
  assert.ok(lines.includes('PY  - 2010'));
  assert.ok(lines.includes('DO  - 10.1007/978-3-642-16342-5_6'));
  assert.equal(lines.at(-1), 'ER  - ');

  const sparseRis = formatRis(buildCitationRecord({
    metadataTitle: 'T', documentName: 'x.pdf', authors: [], publishDate: '', doi: '', documentUrl: '', language: '',
  }));
  assert.doesNotMatch(sparseRis, /^PY/m);
  assert.doesNotMatch(sparseRis, /^AU/m);
}

// ---------------------------------------------------------------------------
// GB/T 7714-2015：类型标识、作者写法、期刊与会议模板逐字符对齐
// ---------------------------------------------------------------------------
{
  const journal = buildCitationRecord({
    metadataTitle: 'A new combinational logic minimization technique with applications to cryptology',
    documentName: '2010-Boyar.pdf',
    authors: ['Joan Boyar', 'René Peralta'],
    publishDate: '2010-06',
    doi: '10.1007/978-3-642-16342-5_6',
    documentUrl: '',
    language: 'en',
    containerTitle: 'Theory of Cryptography',
    volume: '5978',
    issue: '3',
    page: '45-57',
    publisher: 'Springer',
    publisherPlace: 'Berlin, Heidelberg',
    issn: '0302-9743',
    isbn: '978-3-642-16342-5',
    publicationKind: 'journal-article',
  });
  // 期刊模板：作者. 题名[J/OL]. 刊名, 年, 卷(期): 页码[引用日期]. 访问路径.
  assert.equal(
    formatGbT7714(journal, { citedAt: '2026-10-21' }),
    'BOYAR J, PERALTA R. A new combinational logic minimization technique with applications to cryptology[J/OL]. '
      + 'Theory of Cryptography, 2010, 5978(3): 45-57[2026-10-21]. https://doi.org/10.1007/978-3-642-16342-5_6.',
  );

  const proceedings = buildCitationRecord({
    metadataTitle: 'Fast correlation attacks on stream ciphers',
    documentName: '2008-proceedings.pdf',
    authors: ['Anne Canteaut', 'M. Trabbia'],
    publishDate: '2008',
    doi: '10.1007/3-540-45539-6_7',
    documentUrl: '',
    language: 'en',
    containerTitle: 'Advances in Cryptology — EUROCRYPT 2008',
    volume: '',
    issue: '',
    page: '31-46',
    publisher: 'Springer',
    publisherPlace: 'Berlin, Heidelberg',
    publicationKind: 'proceedings-article',
  });
  // 会议模板：作者. 题名[C/OL]//论文集名. 出版地: 出版者, 出版年: 页码[引用日期]. 访问路径.
  assert.equal(
    formatGbT7714(proceedings, { citedAt: '2026-10-21' }),
    'CANTEAUT A, TRABBIA M. Fast correlation attacks on stream ciphers[C/OL]//Advances in Cryptology — EUROCRYPT 2008. '
      + 'Berlin, Heidelberg: Springer, 2008: 31-46[2026-10-21]. https://doi.org/10.1007/3-540-45539-6_7.',
  );

  // 中文：姓名原样，超过三位用「, 等」，[J] 不带 /OL（没有 DOI 也没有链接）。
  const chinese = buildCitationRecord({
    metadataTitle: '面向图神经网络的高效推理方法',
    documentName: 'gnn.pdf',
    authors: ['张一', '李二', '王三', '赵四'],
    publishDate: '2021',
    doi: '',
    documentUrl: '',
    language: 'zh',
    containerTitle: '计算机学报',
    volume: '44',
    issue: '6',
    page: '1203-1215',
    publicationKind: 'journal-article',
  });
  assert.equal(
    formatGbT7714(chinese, { citedAt: '2026-10-21' }),
    '张一, 李二, 王三, 等. 面向图神经网络的高效推理方法[J]. 计算机学报, 2021, 44(6): 1203-1215.',
    'a print journal has no /OL and no access date',
  );

  // 网页/电子资源：没有刊名与卷期，[EB/OL] 后面直接跟引用日期。
  const webpage = buildCitationRecord({
    metadataTitle: 'GB/T 7714-2015 信息与文献 参考文献著录规则',
    documentName: 'gbt.pdf',
    authors: [],
    publishDate: '2015',
    doi: '',
    documentUrl: 'https://openstd.samr.gov.cn/bzgk/gb/',
    language: 'zh',
  });
  assert.equal(
    formatGbT7714(webpage, { citedAt: '2026-10-21' }),
    'GB/T 7714-2015 信息与文献 参考文献著录规则[EB/OL]. 2015[2026-10-21]. https://openstd.samr.gov.cn/bzgk/gb/.',
    'a web resource has no venue, so the year takes the imprint slot',
  );
}

// ---------------------------------------------------------------------------
// getDocType：认定类型，并决定要不要 /OL
// ---------------------------------------------------------------------------
{
  const type = (publicationKind, extra = {}) => getDocType({
    publicationKind, containerTitle: '', publisher: '', url: '', doi: '', ...extra,
  });

  assert.deepEqual(type('journal-article', { doi: '10.1/x' }), { code: 'J', online: true, label: '[J/OL]' });
  assert.deepEqual(type('journal-article'), { code: 'J', online: false, label: '[J]' });
  assert.equal(type('proceedings-article', { doi: '10.1/x' }).label, '[C/OL]');
  assert.equal(type('proceedings-article').code, 'C');
  assert.equal(type('book-chapter').code, 'M');
  assert.equal(type('dissertation').code, 'D');
  assert.equal(type('posted-content', { url: 'https://arxiv.org/abs/1' }).label, '[EB/OL]');
  // `[EB/OL]` 已经表示线上电子资源，不能再叠加成 `[EB/OL/OL]`。
  assert.equal(type('', { url: 'https://example.org' }).label, '[EB/OL]');

  // 没有类型时的兜底：有刊名、没有出版者 → 期刊；有刊名和出版者 → 会议；什么都没有 → 电子资源。
  assert.equal(type('', { containerTitle: 'Journal of Cryptology' }).code, 'J');
  assert.equal(type('', { containerTitle: 'Proc. of X', publisher: 'ACM' }).code, 'C');
  assert.equal(type('').code, 'EB');
}

// ---------------------------------------------------------------------------
// formatAuthors：姓大写、名首字母无点、超过三位收敛
// ---------------------------------------------------------------------------
{
  assert.equal(formatAuthors(['Joan Boyar']), 'BOYAR J');
  assert.equal(formatAuthors(['Boyar, Joan']), 'BOYAR J');
  assert.equal(formatAuthors(['Jean-Paul Peralta']), 'PERALTA J P', 'a hyphenated given name keeps both initials');
  assert.equal(
    formatAuthors(['Joan Boyar', 'René Peralta']),
    'BOYAR J, PERALTA R',
    'authors are separated by commas',
  );
  assert.equal(
    formatAuthors(['A One', 'B Two', 'C Three', 'D Four']),
    'ONE A, TWO B, THREE C, et al',
    'more than three: first three plus et al (western record)',
  );
  assert.equal(
    formatAuthors(['张一', '李二', '王三', '赵四'], 'zh'),
    '张一, 李二, 王三, 等',
    'CJK names are kept whole and the suffix is 等',
  );
  assert.equal(formatAuthors([]), '');
  // 小写姓氏前缀属于姓的一部分。
  assert.equal(formatAuthors(['Ana de la Cruz']), 'DE LA CRUZ A');
}

// ---------------------------------------------------------------------------
// Markdown 与分派
// ---------------------------------------------------------------------------
{
  assert.equal(formatMarkdown(full), `[${full.title}](${full.url})`);
  assert.equal(
    formatMarkdown({ ...full, url: '' }),
    full.title,
    'without a link the title is the right thing to paste',
  );
  assert.equal(formatCitation(full, 'ris'), formatRis(full));
  assert.equal(formatCitation(full, 'gbt7714'), formatGbT7714(full));
  assert.equal(formatCitation(full, 'markdown'), formatMarkdown(full));
  assert.equal(formatCitation(full, 'bibtex'), formatBibtex(full));
}

// ---------------------------------------------------------------------------
// 缺项提示：按影响排序，齐全时为空
// ---------------------------------------------------------------------------
{
  assert.deepEqual(citationWarnings(full), []);
  const sparse = buildCitationRecord({
    metadataTitle: '', documentName: 'Paper.pdf', authors: [], publishDate: '', doi: '', documentUrl: '', language: '',
  });
  const warnings = citationWarnings(sparse);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /作者/);
  assert.match(warnings[1], /年份/);
  assert.match(warnings[2], /标题取自文件名/);
  assert.match(warnings[3], /DOI/);
}

// ---------------------------------------------------------------------------
// 链接的兜底：没有 documentUrl 时用 DOI 解析地址
// ---------------------------------------------------------------------------
{
  const doiOnly = buildCitationRecord({
    metadataTitle: 'T', documentName: 'x.pdf', authors: [], publishDate: '', doi: '10.1000/xyz', documentUrl: '', language: '',
  });
  assert.equal(doiOnly.url, 'https://doi.org/10.1000/xyz');
  assert.match(formatBibtex(doiOnly), /url = \{https:\/\/doi\.org\/10\.1000\/xyz\}/);
}

console.log('Citation contract tests passed.');
