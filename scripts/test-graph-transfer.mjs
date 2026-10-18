import assert from 'node:assert/strict';

import {
  createGraphSnapshot,
  describeImportPlan,
  GRAPH_SNAPSHOT_FORMAT,
  GRAPH_SNAPSHOT_VERSION,
  parseGraphSnapshot,
  planGraphImport,
  suggestSnapshotFileName,
} from '../src/modules/knowledge-graph/application/graph-transfer.ts';
import { DEFAULT_KNOWLEDGE_GRAPH_SETTINGS } from '../src/modules/knowledge-graph/contracts.ts';

function paper(paperId, overrides = {}) {
  return {
    paperId,
    documentAgentId: paperId,
    fingerprint: `fp-${paperId}`,
    title: `Paper ${paperId}`,
    year: 2020,
    authors: ['A'],
    venue: '',
    doi: '',
    abstract: 'a',
    folderId: null,
    keywords: [],
    extractionStatus: 'ready',
    extractionError: null,
    extractedAt: null,
    projectionVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function entity(entityId, overrides = {}) {
  return {
    entityId,
    name: entityId,
    normalizedName: entityId,
    aliases: [],
    type: 'Method',
    status: 'confirmed',
    confidence: 0.9,
    sourcePaperId: 'p1',
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function edge(edgeId, source, target, overrides = {}) {
  return {
    edgeId,
    source,
    sourceKind: 'paper',
    target,
    targetKind: 'entity',
    type: 'MENTIONS',
    confidence: 0.9,
    evidence: [],
    sourcePaperId: source,
    origin: 'ai',
    originKey: `${source}|${target}`,
    provenance: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const sources = {
  papers: [paper('p2'), paper('p1')],
  entities: [entity('entity:b'), entity('entity:a')],
  userNodes: [
    { id: 'note:n1', kind: 'note', label: 'N', createdAt: 5 },
    { id: 'folder:f1', kind: 'folder', label: 'F', createdAt: 3 },
  ],
  edges: [edge('e2', 'p2', 'entity:b'), edge('e1', 'p1', 'entity:a')],
  settings: { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS, relationTopK: 7 },
};

// ---------------------------------------------------------------------------
// Export. Deterministic output means a diff between two exports means something
// actually changed — which is the only reason a user would compare them.
// ---------------------------------------------------------------------------
const json = createGraphSnapshot(sources, { now: new Date('2026-01-02T03:04:05Z') });
const again = createGraphSnapshot(sources, { now: new Date('2026-01-02T03:04:05Z') });
assert.equal(json, again, 'the same graph must export byte-identically');
assert.ok(json.includes('\n'), 'output is pretty-printed so a human can read it');

const parsedJson = JSON.parse(json);
assert.equal(parsedJson.format, GRAPH_SNAPSHOT_FORMAT);
assert.equal(parsedJson.version, GRAPH_SNAPSHOT_VERSION);
assert.equal(parsedJson.exportedAt, '2026-01-02T03:04:05.000Z');
// Arrays are sorted, not insertion-ordered.
assert.deepEqual(parsedJson.papers.map((p) => p.paperId), ['p1', 'p2']);
assert.deepEqual(parsedJson.entities.map((e) => e.entityId), ['entity:a', 'entity:b']);
assert.deepEqual(parsedJson.edges.map((e) => e.edgeId), ['e1', 'e2']);
assert.deepEqual(parsedJson.userNodes.map((n) => n.id), ['folder:f1', 'note:n1']);
// Settings are normalized on the way out, so a corrupt in-memory value cannot be
// exported as a corrupt file.
assert.equal(parsedJson.settings.relationTopK, 7);

const name = suggestSnapshotFileName(new Date('2026-01-02T03:04:05Z'));
assert.match(name, /^pdfpal-knowledge-graph-.*\.json$/);
assert.ok(!name.includes(':'), 'the name must be valid on Windows');

// ---------------------------------------------------------------------------
// Round trip.
// ---------------------------------------------------------------------------
const roundTrip = parseGraphSnapshot(json);
assert.equal(roundTrip.error, null);
assert.ok(roundTrip.document);
assert.equal(roundTrip.document.papers.length, 2);
assert.equal(roundTrip.document.entities.length, 2);
assert.equal(roundTrip.document.edges.length, 2);
assert.equal(roundTrip.document.userNodes.length, 2);
assert.equal(roundTrip.document.settings.relationTopK, 7);
assert.deepEqual(roundTrip.dropped, { papers: 0, entities: 0, edges: 0, userNodes: 0 });
// Re-exporting the parsed document reproduces the file: serialization is lossless
// for everything the format carries.
assert.equal(
  createGraphSnapshot(
    {
      papers: roundTrip.document.papers,
      entities: roundTrip.document.entities,
      userNodes: roundTrip.document.userNodes,
      edges: roundTrip.document.edges,
      settings: roundTrip.document.settings,
    },
    { now: new Date('2026-01-02T03:04:05Z') },
  ),
  json,
  'a round trip must be lossless',
);

// ---------------------------------------------------------------------------
// Rejection: a foreign or future file must not half-load.
// ---------------------------------------------------------------------------
for (const [label, raw, pattern] of [
  ['not JSON', 'nonsense', /JSON/],
  ['not an object', '[1,2,3]', /对象/],
  ['wrong format', JSON.stringify({ format: 'something-else', version: 1, papers: [] }), /不是 PDFPal/],
  ['future version', JSON.stringify({ format: GRAPH_SNAPSHOT_FORMAT, version: 99, papers: [] }), /版本/],
  ['older version', JSON.stringify({ format: GRAPH_SNAPSHOT_FORMAT, version: 0, papers: [] }), /版本/],
  ['missing papers', JSON.stringify({ format: GRAPH_SNAPSHOT_FORMAT, version: 1 }), /papers/],
]) {
  const result = parseGraphSnapshot(raw);
  assert.equal(result.document, null, `${label} must be rejected`);
  assert.match(result.error, pattern, `${label} must explain itself`);
}

// A rejected file must not partially apply: the caller gets no document at all.
assert.equal(parseGraphSnapshot('{"format":"x"}').document, null);

// ---------------------------------------------------------------------------
// Malformed individual records are dropped and counted, rather than failing a
// large export because one edge lost its endpoint.
// ---------------------------------------------------------------------------
const lossy = JSON.stringify({
  format: GRAPH_SNAPSHOT_FORMAT,
  version: 1,
  papers: [paper('p1'), { title: 'no id' }, 'a string'],
  entities: [entity('entity:a'), { name: 'no id' }, { entityId: 'x' }],
  userNodes: [{ id: 'note:n1', kind: 'note', label: 'N' }, { id: 'y', kind: 'bogus' }],
  edges: [
    edge('e1', 'p1', 'entity:a'),
    { edgeId: 'no-origin-key', source: 'p1', target: 'entity:a' },
    { edgeId: 'e3', originKey: 'k', source: 'p1' },
  ],
});
const lossyResult = parseGraphSnapshot(lossy);
assert.equal(lossyResult.error, null, 'a lossy file is still usable');
assert.equal(lossyResult.document.papers.length, 1);
assert.equal(lossyResult.document.entities.length, 1, 'an unnamed entity is dropped');
assert.equal(lossyResult.document.userNodes.length, 1, 'an unknown node kind is dropped');
assert.equal(lossyResult.document.edges.length, 1, 'edges missing a key or endpoint are dropped');
assert.ok(lossyResult.dropped.papers >= 2, 'the losses are reported so they can be surfaced');

// Duplicate ids would abort a bulk write on the primary key, so the first wins.
const duplicated = JSON.stringify({
  format: GRAPH_SNAPSHOT_FORMAT,
  version: 1,
  papers: [paper('p1', { title: 'First' }), paper('p1', { title: 'Second' })],
  entities: [],
  userNodes: [],
  edges: [],
});
const dupedResult = parseGraphSnapshot(duplicated);
assert.equal(dupedResult.document.papers.length, 1);
assert.equal(dupedResult.document.papers[0].title, 'First');
assert.equal(dupedResult.dropped.papers, 1, 'a duplicate is reported as a loss');

// Coercion: a hand-edited file must not inject bad values.
const handEdited = parseGraphSnapshot(JSON.stringify({
  format: GRAPH_SNAPSHOT_FORMAT,
  version: 1,
  papers: [{ paperId: 'p1', year: 'not a year', createdAt: 'nope', extractionStatus: 'bogus' }],
  entities: [{ entityId: 'e1', name: 'E', type: 'NotAType', status: 'bogus', confidence: 5 }],
  userNodes: [],
  edges: [edge('x', 'p1', 'e1', { confidence: -3, sourceKind: 'bogus' })],
}));
assert.ok(handEdited.document);
assert.equal(handEdited.document.papers[0].year, null, 'an unparseable year becomes null');
assert.equal(
  handEdited.document.papers[0].extractionStatus,
  'none',
  'an unknown status falls back rather than being trusted',
);
assert.equal(handEdited.document.entities[0].type, 'Concept');
assert.equal(handEdited.document.entities[0].status, 'pending');
assert.equal(handEdited.document.entities[0].confidence, 1, 'confidence is clamped');
assert.equal(handEdited.document.edges[0].confidence, 0);
assert.equal(handEdited.document.edges[0].sourceKind, 'paper');

// A missing settings block falls back to defaults rather than failing the file.
assert.equal(
  parseGraphSnapshot(JSON.stringify({
    format: GRAPH_SNAPSHOT_FORMAT, version: 1, papers: [], entities: [], userNodes: [], edges: [],
  })).document.settings.relationTopK,
  DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.relationTopK,
);

// ---------------------------------------------------------------------------
// Import planning.
// ---------------------------------------------------------------------------
const document = parseGraphSnapshot(json).document;

// `replace` takes everything, including settings: that is what restoring a
// backup means.
const replacePlan = planGraphImport(document, 'replace');
assert.equal(replacePlan.papers.length, 2);
assert.equal(replacePlan.entities.length, 2);
assert.equal(replacePlan.userNodes.length, 2);
assert.equal(replacePlan.edges.length, 2);
assert.equal(replacePlan.settings.relationTopK, 7);
assert.equal(replacePlan.droppedDanglingEdges, 0);

// The plan is ordered so papers land before the edges that reference them.
assert.ok(replacePlan.papers.length && replacePlan.entities.length && replacePlan.edges.length);

// `merge` fills gaps without overwriting: a local record wins, because a local
// confirmation or edit is newer information than a file of unknown age.
const mergePlan = planGraphImport(document, 'merge', {
  papers: [paper('p1')],
  entities: [entity('entity:a')],
  userNodes: [{ id: 'note:n1', kind: 'note', label: 'Local', createdAt: 9 }],
});
assert.deepEqual(mergePlan.papers.map((p) => p.paperId), ['p2']);
assert.deepEqual(mergePlan.entities.map((e) => e.entityId), ['entity:b']);
assert.deepEqual(mergePlan.userNodes.map((n) => n.id), ['folder:f1']);
// Settings are never merged: half of one file's thresholds and half of another's
// is a configuration nobody chose.
assert.equal(mergePlan.settings, null, 'merge must not silently change settings');
// Edges are all offered either way; the unique key decides what actually sticks.
assert.equal(mergePlan.edges.length, 2);

// An edge whose endpoint the snapshot does not define is dropped, because the
// renderer's one invariant is that every edge endpoint exists.
const dangling = {
  ...document,
  edges: [
    ...document.edges,
    edge('orphan', 'p1', 'entity:missing'),
    edge('orphan2', 'p9', 'entity:a', { sourceKind: 'paper' }),
  ],
};
const danglingPlan = planGraphImport(dangling, 'replace');
assert.equal(danglingPlan.edges.length, 2);
assert.equal(danglingPlan.droppedDanglingEdges, 2);
assert.match(describeImportPlan(danglingPlan), /丢弃 2 条边/);

// A merge against a graph that already holds the entity makes the dangling edge
// resolvable, so it is kept. This is the difference between `replace` and
// `merge` that matters: merge can resolve references the file alone cannot.
const rescuedPlan = planGraphImport(dangling, 'merge', { entities: [entity('entity:missing')] });
assert.equal(rescuedPlan.edges.length, 3, 'an entity held locally rescues the edge');
assert.equal(rescuedPlan.droppedDanglingEdges, 1, 'only the truly unresolvable edge is dropped');

// An edge to an entity neither side defines is dropped and reported — and there
// is deliberately no separate "missing entity" count, because it would only ever
// repeat this same number.
const orphanPlan = planGraphImport(
  { ...document, entities: [], edges: [edge('e', 'p1', 'entity:ghost')] },
  'replace',
);
assert.equal(orphanPlan.edges.length, 0);
assert.equal(orphanPlan.droppedDanglingEdges, 1);
assert.match(describeImportPlan(orphanPlan), /端点不存在/);

assert.match(describeImportPlan(replacePlan), /将替换现有图谱/);
assert.match(describeImportPlan(mergePlan), /将合并进现有图谱/);

console.log('Graph transfer contract tests passed.');
