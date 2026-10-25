import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  describeDataHealth,
  planDataHealth,
} from '../src/modules/knowledge/application/data-health.ts';
import { decideIndexPrecheck } from '../src/viewer/features/knowledge-base/index-precheck.ts';
import { paperNameKey } from '../src/modules/knowledge/application/document-identity-match.ts';

/**
 * 数据体检的判定规则.
 *
 * The point of these tests is the *distinctions*, because collapsing any pair of them is what makes the app lie:
 * 「读不到分块」 vs 「没有分块」, 「记录说 5 段」 vs 「实际 3 段」, 「抽取标记完成但没有知识点」 vs 「还没抽取」.
 * Every case below is one of those distinctions.
 */

function document(id, overrides = {}) {
  return {
    documentId: id,
    documentName: `${id}.pdf`,
    pageCount: 10,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    indexStatus: 'ready',
    chunkCount: 5,
    // Healthy by default: the metadata test below clears these deliberately, so a missing-metadata finding never shows up
    // as a side effect of an unrelated case.
    authors: ['Ada Lovelace'],
    publishDate: '2010',
    doi: '10.1000/x',
    metadataStatus: 'ready',
    ...overrides,
  };
}

const noGraph = [];
const allLinked = (documents) => new Set(documents.map((item) => item.documentId));
const plan = (documents, options = {}) => planDataHealth({
  documents,
  chunkCounts: options.chunkCounts ?? new Map(documents.map((item) => [item.documentId, 5])),
  graphPapers: options.graphPapers ?? noGraph,
  linkedFileIds: options.linkedFileIds ?? allLinked(documents),
  paperNameKey,
});

// ---------------------------------------------------------------------------
// A healthy library says nothing at all.
// ---------------------------------------------------------------------------
{
  const documents = [document('a'), document('b', { documentName: 'b-paper.pdf' })];
  const report = plan(documents, {
    chunkCounts: new Map([['a', 5], ['b', 5]]),
    graphPapers: [],
  });
  assert.deepEqual(report.findings, []);
  assert.equal(report.total, 0);
  assert.equal(describeDataHealth(report), '没有发现数据问题。');
}

// ---------------------------------------------------------------------------
// 记录说已索引 N 段、实际 0 段：最严重的一类，而且不能再重复报「图谱里没有知识」。
// ---------------------------------------------------------------------------
{
  const documents = [document('lost')];
  const report = plan(documents, {
    chunkCounts: new Map([['lost', 0]]),
    graphPapers: [{ paperId: 'lost', title: 'lost', extractionStatus: 'ready', hasEdges: false }],
  });
  const kinds = report.findings.map((finding) => finding.kind);
  assert.deepEqual(kinds, ['chunks-missing'], 'a lost index is one finding, not two symptoms');
  assert.equal(report.findings[0].severity, 'broken');
  assert.equal(report.findings[0].fix, 'rebuild-index');
  assert.equal(report.broken, 1);
  assert.match(describeDataHealth(report), /1 处问题.*1 处会让功能不可用/);
}

// ---------------------------------------------------------------------------
// 读不到 ≠ 没有：读取失败只能是「人工检查」，绝不能建议去重建索引。
// ---------------------------------------------------------------------------
{
  const documents = [document('unreadable')];
  const report = plan(documents, { chunkCounts: new Map([['unreadable', null]]) });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].fix, 'manual');
  assert.equal(report.findings[0].costsMoney, false);
  assert.match(report.findings[0].message, /读取本地索引失败/);
}

// ---------------------------------------------------------------------------
// 数量不符：数据在，只是记录过时 —— 修复只是把数字改对，不重跑任何东西。
// ---------------------------------------------------------------------------
{
  const documents = [document('drift', { chunkCount: 5 })];
  const report = plan(documents, { chunkCounts: new Map([['drift', 3]]) });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].kind, 'chunks-mismatch');
  assert.equal(report.findings[0].severity, 'warn');
  assert.equal(report.findings[0].fix, 'sync-chunk-count');
  assert.match(report.findings[0].fixLabel, /3 段/, 'the button says what the number will become');
}

// ---------------------------------------------------------------------------
// 「已索引」但既没有计数也没有数据。
// ---------------------------------------------------------------------------
{
  const documents = [document('hollow', { chunkCount: 0 })];
  const report = plan(documents, { chunkCounts: new Map([['hollow', 0]]) });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].kind, 'index-untrusted');
  assert.equal(report.findings[0].fix, 'mark-unindexed');
}

// ---------------------------------------------------------------------------
// 分块丢了，不等于元数据和文件关联也丢了：三件事各算一条，修好索引后不该再冒出两条新问题。
// ---------------------------------------------------------------------------
{
  const documents = [document('multi', { authors: [], publishDate: '', doi: '' })];
  const report = plan(documents, { chunkCounts: new Map([['multi', 0]]), linkedFileIds: new Set() });
  assert.deepEqual(
    report.findings.map((finding) => finding.kind).sort(),
    ['chunks-missing', 'file-link-missing', 'metadata-missing'],
  );
}

// ---------------------------------------------------------------------------
// 读不到分块时也一样：元数据与文件关联照报，依赖分块的图谱判断不报。
// ---------------------------------------------------------------------------
{
  const documents = [document('unreadable-meta', { authors: [], publishDate: '', doi: '' })];
  const report = plan(documents, {
    chunkCounts: new Map([['unreadable-meta', null]]),
    linkedFileIds: new Set(),
    graphPapers: [{ paperId: 'unreadable-meta', title: 'x', extractionStatus: 'ready', hasEdges: false }],
  });
  assert.deepEqual(
    report.findings.map((finding) => finding.kind).sort(),
    ['chunks-missing', 'file-link-missing', 'metadata-missing'],
    'no graph finding while the chunks cannot be read',
  );
}

// ---------------------------------------------------------------------------
// 图谱侧：状态卡住 vs 有索引却没知识点。
// ---------------------------------------------------------------------------
{
  const documents = [document('stuck')];
  const stuck = plan(documents, {
    graphPapers: [{ paperId: 'stuck', title: 'stuck', extractionStatus: 'extracting', hasEdges: false }],
  });
  assert.deepEqual(stuck.findings.map((finding) => finding.kind), ['extraction-stuck']);
  assert.equal(stuck.findings[0].fix, 'reset-extraction');
  assert.equal(stuck.findings[0].costsMoney, false);

  const empty = plan(documents, {
    graphPapers: [{ paperId: 'stuck', title: 'stuck', extractionStatus: 'ready', hasEdges: false }],
  });
  assert.deepEqual(empty.findings.map((finding) => finding.kind), ['graph-empty']);
  assert.equal(empty.findings[0].costsMoney, true, 're-extraction spends tokens, and the button has to say so');

  const fine = plan(documents, {
    graphPapers: [{ paperId: 'stuck', title: 'stuck', extractionStatus: 'ready', hasEdges: true }],
  });
  assert.deepEqual(fine.findings, [], 'a paper with edges is healthy');
}

// ---------------------------------------------------------------------------
// 元数据 / 文件关联 / 重复。
// ---------------------------------------------------------------------------
{
  const documents = [
    document('meta', { authors: [], publishDate: '', doi: '' }),
    document('skipped', { metadataStatus: 'skipped' }),
  ];
  const report = plan(documents);
  const byDocument = (id) => report.findings.filter((finding) => finding.documentId === id);
  assert.deepEqual(byDocument('meta').map((finding) => finding.kind), ['metadata-missing']);
  assert.equal(byDocument('meta')[0].costsMoney, true);
  assert.deepEqual(byDocument('skipped'), [], '「无需补全」is a decision, not a problem');
}

{
  const documents = [document('unlinked')];
  const report = plan(documents, { linkedFileIds: new Set() });
  assert.deepEqual(report.findings.map((finding) => finding.kind), ['file-link-missing']);
  assert.equal(report.findings[0].fix, 'relink-file');
}

{
  const documents = [
    document('one', { documentName: 'Paper.pdf', pageCount: 12 }),
    document('two', { documentName: 'Paper (1).pdf', pageCount: 12 }),
    document('three', { documentName: 'Paper.pdf', pageCount: 7, documentId: 'three' }),
  ];
  const report = plan(documents);
  const duplicates = report.findings.filter((finding) => finding.kind === 'duplicate');
  // `paperNameKey` strips the ` (1)` copy marker, so `one` and `two` are the same paper; `three` has a different page
  // count and must not be flagged — that is the same rule 「同一篇文献」 uses.
  assert.deepEqual(duplicates.map((finding) => finding.documentId).sort(), ['one', 'two']);
  assert.ok(duplicates.every((finding) => finding.fix === 'manual'), 'merging is not automated in v1');
}

// ---------------------------------------------------------------------------
// 排序：严重在前，同级按文献名 —— 界面上就按这个顺序分组。
// ---------------------------------------------------------------------------
{
  const documents = [
    document('z', { documentName: 'z.pdf' }),
    document('b', { documentName: 'b.pdf', authors: [], publishDate: '', doi: '' }),
  ];
  const report = plan(documents, { chunkCounts: new Map([['z', 0], ['b', 5]]) });
  assert.equal(report.findings[0].severity, 'broken');
  assert.equal(report.findings[0].documentId, 'z');
  assert.equal(report.findings[1].documentId, 'b', 'a warning sorts after a broken finding');
}

// ---------------------------------------------------------------------------
// A2 索引前置校验：打开文献时该不该顺手重建。
// ---------------------------------------------------------------------------
{
  const ready = { documentId: 'd', documentName: 'd.pdf', indexStatus: 'ready' };
  const decide = (overrides = {}) => decideIndexPrecheck({
    record: ready,
    chunkCount: 0,
    isIndexRunning: false,
    alreadyAttempted: false,
    ...overrides,
  });

  assert.equal(decide().action, 'rebuild', 'a record that claims to be indexed but has no chunks is repaired');
  assert.equal(decide({ record: { ...ready, indexStatus: 'error' } }).action, 'rebuild', 'a failed index is retried');

  // Every reason *not* to rebuild. Each one is a case where doing it would be surprising work or a second worker.
  assert.equal(decide({ record: null }).action, 'skip', 'a PDF outside the library has nothing to repair');
  assert.equal(decide({ record: { ...ready, indexStatus: 'indexing' } }).action, 'skip');
  assert.equal(decide({ record: { ...ready, indexStatus: 'pending' } }).action, 'skip');
  assert.equal(decide({ isIndexRunning: true }).action, 'skip', 'never start a second index run');
  assert.equal(decide({ alreadyAttempted: true }).action, 'skip', 'once per session');
  assert.equal(decide({ chunkCount: 12 }).action, 'skip', 'healthy records are left alone');
  // A failed storage read must not look like "missing data" — that is exactly the confusion 数据体检 exists to avoid.
  assert.equal(decide({ chunkCount: null }).action, 'skip');
}

// ---------------------------------------------------------------------------
// 修复不许花钱：修补路径必须显式关掉计费的元数据抽取。
// ---------------------------------------------------------------------------
{
  const source = await readFile(
    new URL('../src/viewer/features/knowledge-base/current-pdf-add-to-library.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export async function ensureKnowledgeIndexForOpenDocument');
  assert.ok(start > 0, 'the repair entry point exists');
  const body = source.slice(start, source.indexOf('\nexport ', start + 10));
  assert.match(
    body,
    /extractMetadata: false/,
    'a silent index repair must not spend a metadata model call',
  );
}

console.log('Data health contract tests passed.');

