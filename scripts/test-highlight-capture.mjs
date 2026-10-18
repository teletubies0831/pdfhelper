import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  describeHighlightCapture,
  planHighlightCapture,
} from '../src/modules/knowledge-graph/application/highlight-capture.ts';
import {
  projectPersonalGraph,
} from '../src/modules/knowledge-graph/application/personal-graph.ts';

/**
 * Highlight capture.
 *
 * Highlights have no store of their own — they live inside the annotated PDF — so the
 * graph keeps a copy. These tests cover the rules that make maintaining a copy safe:
 * capture is idempotent (it runs on every graph page load) and it is never
 * destructive (a capture of a document whose annotations have not restored yet is
 * empty, and acting on that would wipe what the user built).
 */

const DOC = 'Attention Is All You Need.pdf';

function record(highlightId, overrides = {}) {
  return {
    highlightId,
    paperId: DOC,
    text: 'we extend the encoder',
    position: `key-${highlightId}`,
    pageNumber: 3,
    createdAt: 1000,
    ...overrides,
  };
}

function captured(highlightId, overrides = {}) {
  return {
    highlightId,
    text: 'we extend the encoder',
    note: '',
    pageNumber: 3,
    position: `key-${highlightId}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// First capture: everything is new, and `createdAt` is the capture time.
// ---------------------------------------------------------------------------
const first = planHighlightCapture({
  documentName: DOC,
  existing: [],
  captured: [captured('h1'), captured('h2', { text: 'a second sentence' })],
  now: 5000,
});
assert.equal(first.created, 2);
assert.equal(first.updated, 0);
assert.equal(first.unchanged, 0);
assert.deepEqual(first.records.map((item) => item.highlightId), ['h1', 'h2']);
assert.equal(first.records[0].createdAt, 5000);
// The document name goes in `paperId` because that is what the personal graph
// resolves into a graph paper id; a graph id here would resolve to nothing and the
// HIGHLIGHTED edge would be silently dropped.
assert.equal(first.records[0].paperId, DOC);
assert.equal(first.records[0].text, 'we extend the encoder');
assert.deepEqual(first.missingIds, []);
assert.match(describeHighlightCapture(first), /新增 2 条高亮/);

// ---------------------------------------------------------------------------
// Idempotency: capture runs on every load, so re-capturing unchanged highlights must
// write nothing at all.
// ---------------------------------------------------------------------------
const stored = first.records;
const again = planHighlightCapture({
  documentName: DOC,
  existing: stored,
  captured: [captured('h1'), captured('h2', { text: 'a second sentence' })],
  now: 9000,
});
assert.equal(again.created, 0);
assert.equal(again.updated, 0);
assert.equal(again.unchanged, 2);
assert.deepEqual(again.records, [], 'an unchanged capture is a no-op write');
assert.equal(describeHighlightCapture(again), null, 'and it says nothing rather than "0 new"');

// Whitespace-only differences are not changes: the record is built from trimmed
// values, and the comparison is against that record rather than the raw capture, so
// the two can never disagree about what "the same" means.
const padded = planHighlightCapture({
  documentName: DOC,
  existing: stored,
  captured: [captured('h1', { text: '  we extend the encoder  ' })],
  now: 9000,
});
assert.equal(padded.unchanged, 1);
assert.deepEqual(padded.records, []);

// ---------------------------------------------------------------------------
// An update keeps the original creation time: the node must not drift in
// time-ordered views because its text was edited in the PDF.
// ---------------------------------------------------------------------------
const edited = planHighlightCapture({
  documentName: DOC,
  existing: stored,
  captured: [captured('h1', { text: 'we extend the encoder twice' })],
  now: 9000,
});
assert.equal(edited.updated, 1);
assert.equal(edited.created, 0);
assert.equal(
  edited.records[0].createdAt,
  first.records[0].createdAt,
  'the original creation time survives an update',
);
assert.equal(edited.records[0].text, 'we extend the encoder twice');
assert.match(describeHighlightCapture(edited), /更新 1 条/);

// A note-only edit is an edit: the user's remark is part of their material.
const noted = planHighlightCapture({
  documentName: DOC,
  existing: stored,
  captured: [captured('h1', { note: '和 BERT 的对比这里' })],
  now: 9000,
});
assert.equal(noted.updated, 1);
assert.equal(noted.records[0].note, '和 BERT 的对比这里');

// Clearing a note is also an edit, and it removes the field rather than storing an
// empty string that the projection would then have to special-case.
const clearedNote = planHighlightCapture({
  documentName: DOC,
  existing: [{ ...record('h1'), note: 'old remark' }],
  captured: [captured('h1', { note: '' })],
  now: 9000,
});
assert.equal(clearedNote.updated, 1);
assert.equal(
  Object.hasOwn(clearedNote.records[0], 'note'),
  false,
  'a removed note is removed, not blanked',
);

// A page move (the same text re-anchored) is an edit too.
const moved = planHighlightCapture({
  documentName: DOC,
  existing: stored,
  captured: [captured('h1', { pageNumber: 4, position: 'key-h1-moved' })],
  now: 9000,
});
assert.equal(moved.updated, 1);
assert.equal(moved.records[0].pageNumber, 4);
assert.equal(moved.records[0].position, 'key-h1-moved');

// ---------------------------------------------------------------------------
// Never destructive.
// ---------------------------------------------------------------------------
// A capture that mentions only one of two stored highlights must NOT delete the
// other: a document whose annotation storage has not finished restoring reports
// nothing, and deleting on that basis would wipe the graph copy.
const partial = planHighlightCapture({
  documentName: DOC,
  existing: [record('h1'), record('h2')],
  captured: [captured('h1')],
  now: 9000,
});
assert.deepEqual(partial.records, []);
assert.deepEqual(
  partial.missingIds,
  ['h2'],
  'the unmentioned highlight is reported for a future reconciliation, not deleted',
);
assert.equal(partial.unchanged, 1);
// Nothing in the plan can remove records: there is no field for it.
assert.deepEqual(Object.keys(partial).sort(), [
  'created', 'missingIds', 'records', 'skippedEmpty', 'skippedInvalid', 'unchanged', 'updated',
]);

// An empty capture — nothing restored yet — reports every stored highlight as missing
// and still writes nothing. This is the case the report exists for, and it is why the
// document name is stated by the caller instead of derived from the entries.
const empty = planHighlightCapture({
  documentName: DOC,
  existing: [record('h1'), record('h2')],
  captured: [],
});
assert.deepEqual(empty.records, []);
assert.deepEqual(empty.missingIds.sort(), ['h1', 'h2']);
assert.equal(describeHighlightCapture(empty), null);

// Missing ids are scoped to the document being captured: another document's records
// are not this capture's business.
const otherDocument = planHighlightCapture({
  documentName: DOC,
  existing: [record('h1'), record('h9', { paperId: 'BERT.pdf' })],
  captured: [captured('h1')],
});
assert.deepEqual(otherDocument.missingIds, []);

// A capture with no document name stores nothing: every record would be an orphan no
// join could resolve, so the whole batch is rejected and reported.
const unnamed = planHighlightCapture({
  documentName: '   ',
  existing: [],
  captured: [captured('h1'), captured('h2')],
});
assert.deepEqual(unnamed.records, []);
assert.equal(unnamed.skippedInvalid, 2);

// ---------------------------------------------------------------------------
// Malformed captures are skipped and counted, never guessed.
// ---------------------------------------------------------------------------
const malformed = planHighlightCapture({
  documentName: DOC,
  existing: [],
  captured: [
    captured('h1'),
    // No text: the node could not be labelled or quoted, and its evidence would be
    // empty, so it is dropped rather than rendered as a placeholder.
    captured('h2', { text: '   ' }),
    captured('   ', {}),
  ],
  now: 7000,
});
assert.equal(malformed.created, 1);
assert.equal(malformed.skippedEmpty, 1);
assert.equal(malformed.skippedInvalid, 1);
assert.match(describeHighlightCapture(malformed), /1 条没有文本/);

// ---------------------------------------------------------------------------
// The projection consumes the records, which is the point of capturing them.
// ---------------------------------------------------------------------------
const highlighted = projectPersonalGraph({
  notes: [],
  highlights: [
    { ...record('h1'), note: '和 BERT 的对比这里' },
    { ...record('h2'), text: 'a second sentence' },
  ],
  folders: [],
  tags: [],
  resolvePaperId: (name) => (name === DOC ? 'p1' : undefined),
  now: 20_000,
});
const highlightNodes = highlighted.nodes.filter((node) => node.kind === 'highlight');
assert.equal(highlightNodes.length, 2);
// The user's own remark labels the node when there is one, and the highlighted text
// remains the evidence: "why I marked this" is more useful on a dense canvas than the
// sentence itself, but the sentence is what makes the claim traceable.
assert.equal(
  highlightNodes.find((node) => node.id.endsWith('h1')).label,
  '和 BERT 的对比这里',
);
assert.equal(
  highlightNodes.find((node) => node.id.endsWith('h2')).label,
  'a second sentence',
);
const paperEdge = highlighted.edges.find(
  (edge) => edge.type === 'HIGHLIGHTED' && edge.targetKind === 'paper',
);
assert.ok(paperEdge, 'a highlight links to its paper');
assert.equal(paperEdge.evidence[0].quote, 'we extend the encoder');
assert.equal(paperEdge.evidence[0].pageNumber, 3);
assert.equal(paperEdge.origin, 'user');
assert.equal(paperEdge.confidence, 1, 'the user selected this text: it is not a probability');

// ---------------------------------------------------------------------------
// The wiring the bridge depends on.
//
// The graph reaches the reader through a *dynamic* import of the annotations barrel,
// which is what keeps the two features from depending on each other at load time. The
// cost of that indirection is that a missing re-export fails only at runtime, in the
// one code path that cannot be exercised without an open PDF — so the barrel is
// checked here. This is a source-level assertion because the annotations barrel cannot
// be imported by a Node test (it pulls in DOM element handles).
// ---------------------------------------------------------------------------
const annotationsBarrel = await readFile(
  new URL('../src/viewer/features/annotations/annotations.ts', import.meta.url),
  'utf8',
);
assert.match(
  annotationsBarrel,
  /export \* from '\.\/annotation-highlight-list';/,
  'the annotations barrel must re-export the highlight list the graph imports',
);
assert.doesNotMatch(
  annotationsBarrel,
  /knowledge-graph/,
  'and it must not import the graph back: that would be a cross-feature cycle',
);

console.log('Highlight capture contract tests passed.');
