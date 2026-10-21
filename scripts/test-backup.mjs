import assert from 'node:assert/strict';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  buildBackupPayload,
  describeRestorePlan,
  parseBackup,
  planRestore,
  serializeBackup,
} from '../src/modules/knowledge/application/backup.ts';

/**
 * 备份与恢复的契约.
 *
 * Two properties matter more than the field list: a backup must survive a round trip through a file unchanged, and a
 * restore must never overwrite something that already exists. The second one is why `planRestore` is a pure plan instead
 * of an "apply" function — it can be checked without touching storage.
 */

const document = (id, overrides = {}) => ({
  documentId: id,
  documentName: `${id}.pdf`,
  pageCount: 10,
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  indexStatus: 'ready',
  chunkCount: 2,
  authors: ['Ada Lovelace'],
  publishDate: '2010',
  doi: '10.1000/x',
  folderId: null,
  ...overrides,
});

const chunk = (documentId, order, text) => ({
  id: `${documentId}#${order}`,
  documentId,
  order,
  startPage: order,
  endPage: order,
  text,
});

const emptyExisting = {
  documentIds: new Set(),
  folderIds: new Set(),
  chunkDocumentIds: new Set(),
  paperIds: new Set(),
  entityIds: new Set(),
  edgeIds: new Set(),
  noteIds: new Set(),
};

// ---------------------------------------------------------------------------
// 组装与序列化
// ---------------------------------------------------------------------------
{
  const payload = buildBackupPayload({
    documents: [document('a')],
    folders: [{ id: 'f1', name: 'GF2', parentId: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    chunks: new Map([
      ['a', [chunk('a', 1, '正文一'), chunk('a', 2, '正文二')]],
      // An empty list must not become a key: a backup full of empty arrays is noise, and the restore plan counts keys.
      ['b', []],
    ]),
    graph: {
      papers: [{ paperId: 'a', title: 'a', extractionStatus: 'ready' }],
      entities: [{ entityId: 'e1', name: 'LowMC' }],
      edges: [{ edgeId: 'a->e1', source: 'a', target: 'e1' }],
    },
    notes: [{ id: 'n1', text: '一条笔记' }],
    exportedAt: '2026-10-21T08:00:00.000Z',
  });

  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.version, BACKUP_VERSION);
  assert.deepEqual(Object.keys(payload.chunks), ['a'], 'empty chunk lists are dropped');
  assert.equal(backupFileName(payload.exportedAt), 'pdfpal-backup-20261021.json');

  const parsed = parseBackup(serializeBackup(payload));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload.documents, payload.documents);
  assert.deepEqual(parsed.payload.folders, payload.folders);
  assert.deepEqual(parsed.payload.chunks, payload.chunks);
  assert.deepEqual(parsed.payload.graph, payload.graph);
  assert.deepEqual(parsed.payload.notes, payload.notes);
}

// ---------------------------------------------------------------------------
// 拒绝坏文件，但别对无关的扩展字段小题大做
// ---------------------------------------------------------------------------
{
  assert.equal(parseBackup('{').ok, false);
  assert.equal(parseBackup('[]').ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: 'something-else' })).ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 0, documents: [] })).ok, false);
  const tooNew = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, documents: [] }));
  assert.equal(tooNew.ok, false);
  assert.match(tooNew.error, /更新的版本/);
  assert.equal(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 })).ok, false, 'no documents at all');

  // Unknown keys and missing optional sections are tolerated: refusing a file over a field this build does not know about
  // is worse than importing what is understood.
  const tolerated = parseBackup(JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    documents: [document('a')],
    somethingFromTheFuture: { nested: true },
  }));
  assert.equal(tolerated.ok, true);
  assert.deepEqual(tolerated.payload.folders, []);
  assert.deepEqual(tolerated.payload.chunks, {});
  assert.deepEqual(tolerated.payload.graph, { papers: [], entities: [], edges: [] });
}

// ---------------------------------------------------------------------------
// 恢复只补缺失
// ---------------------------------------------------------------------------
{
  const payload = buildBackupPayload({
    documents: [document('new-1'), document('old-1')],
    folders: [{ id: 'f-new', name: '新文件夹', parentId: null, createdAt: '' }],
    chunks: new Map([
      ['new-1', [chunk('new-1', 1, '新文献正文')]],
      ['old-1', [chunk('old-1', 1, '旧文献正文')]],
    ]),
    graph: {
      papers: [{ paperId: 'new-1' }, { paperId: 'old-1' }],
      entities: [{ entityId: 'e-new' }, { entityId: 'e-old' }],
      edges: [{ edgeId: 'edge-new' }, { edgeId: 'edge-old' }],
    },
    notes: [{ id: 'n-new', text: 'x' }, { id: 'n-old', text: 'y' }],
    exportedAt: '2026-10-21T08:00:00.000Z',
  });

  const plan = planRestore(payload, {
    ...emptyExisting,
    documentIds: new Set(['old-1']),
    // `old-1` exists but its index is missing: the chunks *should* be restored.
    chunkDocumentIds: new Set(),
    paperIds: new Set(['old-1']),
    entityIds: new Set(['e-old']),
    edgeIds: new Set(['edge-old']),
    noteIds: new Set(['n-old']),
  });

  assert.deepEqual(plan.documents.map((item) => item.documentId), ['new-1'], 'existing documents are never overwritten');
  assert.equal(plan.skipped.documents, 1);
  assert.deepEqual(plan.folders.map((folder) => folder.id), ['f-new']);
  assert.deepEqual(plan.chunks.map((entry) => entry.documentId).sort(), ['new-1', 'old-1'],
    'a document whose index is missing gets its chunks back even though the record exists');
  assert.deepEqual(plan.papers.map((paper) => paper.paperId), ['new-1']);
  assert.deepEqual(plan.entities.map((entity) => entity.entityId), ['e-new']);
  assert.deepEqual(plan.edges.map((edge) => edge.edgeId), ['edge-new']);
  assert.deepEqual(plan.notes.map((note) => note.id), ['n-new']);
  assert.equal(plan.skipped.notes, 1);
}

// ---------------------------------------------------------------------------
// 一个已经完整的库：什么都不导入，并且说清楚
// ---------------------------------------------------------------------------
{
  const payload = buildBackupPayload({
    documents: [document('a')],
    folders: [],
    chunks: new Map([['a', [chunk('a', 1, '正文')]]]),
    graph: { papers: [{ paperId: 'a' }], entities: [], edges: [] },
    notes: [],
    exportedAt: '2026-10-21T08:00:00.000Z',
  });
  const plan = planRestore(payload, {
    ...emptyExisting,
    documentIds: new Set(['a']),
    chunkDocumentIds: new Set(['a']),
    paperIds: new Set(['a']),
  });
  assert.equal(plan.documents.length, 0);
  assert.equal(plan.chunks.length, 0);
  assert.equal(plan.papers.length, 0);
  assert.equal(describeRestorePlan(plan), '备份里的内容都已经存在，没有需要导入的东西。');
}

// ---------------------------------------------------------------------------
// 说明文字要把「导入」和「跳过」都摆出来
// ---------------------------------------------------------------------------
{
  const payload = buildBackupPayload({
    documents: [document('new-1'), document('old-1')],
    folders: [],
    chunks: new Map(),
    graph: { papers: [], entities: [], edges: [] },
    notes: [],
    exportedAt: '2026-10-21T08:00:00.000Z',
  });
  const plan = planRestore(payload, { ...emptyExisting, documentIds: new Set(['old-1']) });
  const text = describeRestorePlan(plan);
  assert.match(text, /1 篇文献/);
  assert.match(text, /已存在而跳过的有 1 篇文献/);
}

console.log('Backup contract tests passed.');
