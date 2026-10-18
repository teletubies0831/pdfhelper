import assert from 'node:assert/strict';

import {
  buildFolderEdges,
  buildTagEdges,
  collectFolderAncestors,
  findStalePersonalOriginKeys,
  folderNodeId,
  highlightNodeId,
  noteNodeId,
  projectPersonalGraph,
  tagNodeId,
  USER_NODE_ID,
} from '../src/modules/knowledge-graph/application/personal-graph.ts';

const folders = [
  { folderId: 'f-root', name: 'Research', parentId: null, createdAt: 1 },
  { folderId: 'f-mid', name: 'Methods', parentId: 'f-root', createdAt: 2 },
  { folderId: 'f-leaf', name: 'Chapter 2', parentId: 'f-mid', createdAt: 3 },
];
const tags = [
  { tagId: 't-1', name: 'to-read' },
  { tagId: 't-2', name: 'important' },
];

const notes = [
  { noteId: 'n1', paperId: 'Paper A.pdf', content: 'The key insight is sparse attention.', sectionTitle: 'Method', createdAt: 10, updatedAt: 10 },
  { noteId: 'n2', paperId: 'Unknown Paper.pdf', content: 'A thought with no matching document.', sectionTitle: null, createdAt: 11, updatedAt: 11 },
];
const highlights = [
  { highlightId: 'h1', paperId: 'Paper A.pdf', text: 'attention is all you need', position: '{}', pageNumber: 4, createdAt: 12 },
];

/** Only "Paper A.pdf" resolves, mirroring a document that is actually in the graph. */
const resolvePaperId = (documentName) => (documentName === 'Paper A.pdf' ? 'doc:A' : undefined);

const projection = projectPersonalGraph({
  notes,
  highlights,
  folders,
  tags,
  resolvePaperId,
  now: 100,
});

// ---------------------------------------------------------------------------
// Nodes. Personal material becomes real nodes, so the user's own structure is
// visible rather than flattened into the papers.
// ---------------------------------------------------------------------------
const nodeIds = projection.nodes.map((node) => node.id);
assert.ok(nodeIds.includes(USER_NODE_ID), 'a user anchor node is created');
assert.ok(nodeIds.includes(noteNodeId('n1')));
assert.ok(nodeIds.includes(noteNodeId('n2')), 'an unattachable note still becomes a node');
assert.ok(nodeIds.includes(highlightNodeId('h1')));
assert.ok(nodeIds.includes(folderNodeId('f-root')));
assert.ok(nodeIds.includes(folderNodeId('f-leaf')));
assert.ok(nodeIds.includes(tagNodeId('t-1')));

const userNode = projection.nodes.find((node) => node.id === USER_NODE_ID);
assert.equal(userNode.kind, 'user');
assert.equal(nodeIds.filter((id) => id === USER_NODE_ID).length, 1, 'exactly one anchor');

// Node kinds are set so the renderer can style and group them.
assert.equal(projection.nodes.find((n) => n.id === noteNodeId('n1')).kind, 'note');
assert.equal(projection.nodes.find((n) => n.id === highlightNodeId('h1')).kind, 'highlight');
assert.equal(projection.nodes.find((n) => n.id === folderNodeId('f-leaf')).kind, 'folder');
assert.equal(projection.nodes.find((n) => n.id === tagNodeId('t-1')).kind, 'tag');

// A note is labelled by its section when known — that is more useful in a graph
// than the first line of its body.
assert.equal(projection.nodes.find((n) => n.id === noteNodeId('n1')).label, 'Method');

// ---------------------------------------------------------------------------
// Edges. Every personal edge is `origin: 'user'` with confidence 1: the user
// asserted it, so it is not a probability.
// ---------------------------------------------------------------------------
for (const edge of projection.edges) {
  assert.equal(edge.origin, 'user', 'personal edges must be marked as the user\'s own');
  assert.equal(edge.confidence, 1);
  assert.ok(edge.originKey.length > 0, 'every edge needs an idempotency key');
}
assert.equal(new Set(projection.edges.map((edge) => edge.originKey)).size, projection.edges.length);

const edgeFrom = (source, target, type) => projection.edges.find(
  (edge) => edge.source === source && edge.target === target && edge.type === type,
);

// The anchor groups everything the user made: that is what makes a "personal
// graph" a view rather than a filter.
assert.ok(edgeFrom(USER_NODE_ID, noteNodeId('n1'), 'ANNOTATED_AS'));
assert.ok(edgeFrom(USER_NODE_ID, noteNodeId('n2'), 'ANNOTATED_AS'));
assert.ok(edgeFrom(USER_NODE_ID, highlightNodeId('h1'), 'HIGHLIGHTED'));

// A note attaches to its paper, and carries the note text as evidence.
const noteToPaper = edgeFrom(noteNodeId('n1'), 'doc:A', 'ANNOTATED_AS');
assert.ok(noteToPaper, 'a resolvable note attaches to its paper');
assert.equal(noteToPaper.sourcePaperId, 'doc:A');
assert.equal(noteToPaper.evidence.length, 1);
assert.match(noteToPaper.evidence[0].quote, /sparse attention/);
assert.equal(noteToPaper.evidence[0].chunkHeading, 'Method');

// A highlight is the strongest provenance available: the user selected this text.
const highlightToPaper = edgeFrom(highlightNodeId('h1'), 'doc:A', 'HIGHLIGHTED');
assert.ok(highlightToPaper);
assert.equal(highlightToPaper.evidence[0].pageNumber, 4, 'the highlight page is preserved');
assert.equal(highlightToPaper.evidence[0].quote, 'attention is all you need');

// An unresolvable document is reported, not silently dropped: the note exists and
// says what it is about, it simply has no document in the graph to hang from.
assert.equal(projection.unresolvedPaperCount, 1);
assert.equal(
  projection.edges.filter((edge) => edge.target === noteNodeId('n2')).length,
  1,
  'the unattachable note keeps only its anchor edge',
);

// Determinism: re-projecting unchanged data must produce the same edge set, so
// the unique origin key makes the write a no-op.
const again = projectPersonalGraph({ notes, highlights, folders, tags, resolvePaperId, now: 999 });
assert.deepEqual(
  again.edges.map((edge) => edge.originKey).sort(),
  projection.edges.map((edge) => edge.originKey).sort(),
  'origin keys are stable across projections',
);

// Empty input produces nothing at all — not an orphan anchor node.
const empty = projectPersonalGraph({ resolvePaperId });
assert.deepEqual(empty.nodes, []);
assert.deepEqual(empty.edges, []);

// A user with only folders still gets their anchor.
const foldersOnly = projectPersonalGraph({ folders, resolvePaperId });
assert.equal(foldersOnly.nodes[0].id, USER_NODE_ID);

// ---------------------------------------------------------------------------
// Folder hierarchy. Filing a paper in Chapter 2 must also file it in Methods and
// Research, which is what a user expects from a tree.
// ---------------------------------------------------------------------------
const chain = collectFolderAncestors('f-leaf', new Map(folders.map((f) => [f.folderId, f])));
assert.deepEqual(chain.map((folder) => folder.folderId), ['f-leaf', 'f-mid', 'f-root']);

// A cyclic parentId must terminate rather than hang the graph.
const cyclic = [
  { folderId: 'a', name: 'A', parentId: 'b', createdAt: 1 },
  { folderId: 'b', name: 'B', parentId: 'a', createdAt: 2 },
];
assert.equal(collectFolderAncestors('a', new Map(cyclic.map((f) => [f.folderId, f]))).length, 2);

// A missing parent id stops the walk instead of throwing.
assert.deepEqual(
  collectFolderAncestors('gone', new Map(folders.map((f) => [f.folderId, f]))),
  [],
);

const folderEdges = buildFolderEdges('doc:A', 'f-leaf', folders, 500);
assert.deepEqual(
  folderEdges.map((edge) => edge.target),
  [folderNodeId('f-leaf'), folderNodeId('f-mid'), folderNodeId('f-root')],
  'one IN_FOLDER edge per level of the tree',
);
assert.ok(folderEdges.every((edge) => edge.type === 'IN_FOLDER' && edge.origin === 'user'));
assert.ok(folderEdges.every((edge) => edge.source === 'doc:A' && edge.sourceKind === 'paper'));

// An unfiled paper has no folder edges.
assert.deepEqual(buildFolderEdges('doc:A', null, folders), []);
assert.deepEqual(buildFolderEdges('doc:A', undefined, folders), []);
// A folderId pointing at a deleted folder yields nothing rather than a broken edge.
assert.deepEqual(buildFolderEdges('doc:A', 'deleted', folders), []);

// ---------------------------------------------------------------------------
// Tags.
// ---------------------------------------------------------------------------
const tagEdges = buildTagEdges('doc:A', ['t-1', 't-2'], tags, 600);
assert.deepEqual(tagEdges.map((edge) => edge.target), [tagNodeId('t-1'), tagNodeId('t-2')]);
assert.ok(tagEdges.every((edge) => edge.type === 'TAGGED' && edge.origin === 'user'));

// Unknown tag ids and duplicates are dropped rather than producing broken or
// duplicated edges.
assert.deepEqual(buildTagEdges('doc:A', ['t-1', 't-1', 'ghost'], tags).length, 1);
assert.deepEqual(buildTagEdges('doc:A', [], tags), []);

// ---------------------------------------------------------------------------
// Staleness: removing a note must remove its edges.
// ---------------------------------------------------------------------------
const stale = findStalePersonalOriginKeys(
  [...projection.edges, {
    ...projection.edges[0],
    originKey: 'removed|edge',
    origin: 'user',
  }],
  projection.edges,
);
assert.deepEqual(stale, ['removed|edge']);

// An AI or rule edge is not this function's business, even when it disappears.
const aiEdge = { ...projection.edges[0], originKey: 'ai|edge', origin: 'ai' };
assert.deepEqual(findStalePersonalOriginKeys([aiEdge], []), []);

// ---------------------------------------------------------------------------
// Note conversion. Date handling is the part that fails silently: a NaN
// timestamp poisons every sort that touches it.
// ---------------------------------------------------------------------------
const { notesToGraphRecords, parseStoredTimestamp } = await import(
  '../src/viewer/features/knowledge-graph/graph-note-records.ts'
);

const graphNotes = notesToGraphRecords([
  {
    id: 'n1', content: '  Some note text  ', documentName: 'Paper A.pdf',
    category: 'Methods', createdAt: '2026-01-02T03:04:05Z',
  },
  // A blank note would be a node with nothing in it: no label, no evidence.
  { id: 'n2', content: '   ', documentName: 'Paper A.pdf', createdAt: '2026-01-02T03:04:05Z' },
]);
assert.equal(graphNotes.length, 1);
assert.equal(graphNotes[0].noteId, 'n1');
assert.equal(graphNotes[0].sectionTitle, 'Methods');
assert.equal(graphNotes[0].paperId, 'Paper A.pdf', 'the document name is kept for the join');
assert.ok(graphNotes[0].createdAt > 0, 'the ISO date is parsed to a timestamp');

// An unparseable date must not become NaN.
assert.equal(parseStoredTimestamp('not a date', 42), 42);
assert.equal(parseStoredTimestamp(undefined, 42), 42);
assert.equal(parseStoredTimestamp('', 42), 42);
const badDate = notesToGraphRecords(
  [{ id: 'n3', content: 'x', documentName: 'P.pdf', createdAt: 'nonsense' }],
  1234,
);
assert.equal(badDate[0].createdAt, 1234, 'a bad date falls back rather than yielding NaN');
assert.ok(Number.isFinite(badDate[0].updatedAt));

// ---------------------------------------------------------------------------
// Folder wiring through the projector, using the shape the repository builds from
// the knowledge corpus. The join is by documentId, which is the same identifier
// the graph uses as paperId, so it is exact rather than a name match.
// ---------------------------------------------------------------------------
const corpusFolders = [
  { folderId: 'root', name: 'Research', parentId: null, createdAt: 1 },
  { folderId: 'leaf', name: 'Chapter 2', parentId: 'root', createdAt: 2 },
];
const wired = projectPersonalGraph({ folders: corpusFolders, resolvePaperId: () => 'doc:A' });
assert.deepEqual(
  wired.nodes.filter((node) => node.kind === 'folder').map((node) => node.label).sort(),
  ['Chapter 2', 'Research'],
  'a folder becomes a node even with no notes attached',
);

// One filing edge per level of the tree, all attributed to the user.
const filing = buildFolderEdges('doc:A', 'leaf', corpusFolders, 700);
assert.equal(filing.length, 2, 'Chapter 2 and its parent both apply');
assert.ok(filing.every((edge) => edge.origin === 'user' && edge.type === 'IN_FOLDER'));

console.log('Personal graph contract tests passed.');
