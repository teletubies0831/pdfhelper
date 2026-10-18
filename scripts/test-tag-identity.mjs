import assert from 'node:assert/strict';

import {
  deriveTagRecords,
  hashTagName,
  normalizeTagName,
  planTagAssignments,
  tagIdForName,
} from '../src/modules/knowledge-graph/domain/tag-identity.ts';
import { buildTagEdges, tagNodeId } from '../src/modules/knowledge-graph/application/personal-graph.ts';

// ---------------------------------------------------------------------------
// Identity from the name. Tags have no store of their own, so an id that is not
// perfectly stable across sessions would make the same tag a different node on
// every run — and the graph would accumulate duplicates the user never created.
// ---------------------------------------------------------------------------
assert.equal(tagIdForName('Transformer'), tagIdForName('Transformer'), 'stable');
assert.equal(
  tagIdForName('Transformer'),
  tagIdForName('  transformer  '),
  'case and surrounding whitespace do not create a second tag',
);
assert.equal(tagIdForName('a  b'), tagIdForName('a b'), 'internal whitespace collapses');
assert.notEqual(tagIdForName('Transformer'), tagIdForName('RNN'));
assert.equal(tagIdForName(''), tagIdForName(''));
assert.match(tagIdForName('x'), /^tag:[a-z0-9]+$/, 'ids are readable, not opaque hashes');

// normalizeTagName is conservative on purpose: a tag is a label the user typed,
// so punctuation is NOT stripped the way entity names are.
assert.equal(normalizeTagName('  To Read  '), 'to read');
assert.equal(normalizeTagName('to-read'), 'to-read');
assert.notEqual(
  normalizeTagName('important'),
  normalizeTagName('#important'),
  'the user may have meant the hash deliberately',
);

// The hash is deterministic and spreads across a small vocabulary.
const ids = new Set(
  Array.from({ length: 200 }, (_, index) => hashTagName(`tag-${index}`)),
);
assert.equal(ids.size, 200, 'no collisions across a realistic personal vocabulary');

// ---------------------------------------------------------------------------
// Vocabulary derivation.
// ---------------------------------------------------------------------------
const records = deriveTagRecords(['Transformer', 'RNN', 'transformer', '  RNN  ', '  ', '']);
assert.deepEqual(
  records.map((tag) => tag.name),
  ['RNN', 'Transformer'],
  'duplicates collapse and the list is sorted for stable output',
);
// First spelling wins as the display label, so re-deriving is idempotent.
assert.deepEqual(deriveTagRecords(['Transformer', 'RNN', 'transformer']).map((t) => t.name),
  ['RNN', 'Transformer']);
assert.deepEqual(deriveTagRecords([...records.map((tag) => tag.name), 'transformer'])
  .map((tag) => tag.tagId), records.map((tag) => tag.tagId), 're-deriving yields the same ids');
assert.deepEqual(deriveTagRecords([]), []);

// ---------------------------------------------------------------------------
// Assignment planning: one vocabulary, per-paper ids.
// ---------------------------------------------------------------------------
const plan = planTagAssignments([
  { paperId: 'p1', tags: ['Transformer', 'RNN', 'transformer'] },
  { paperId: 'p2', tags: ['RNN'] },
  { paperId: 'p3', tags: ['   '] },
  { paperId: 'p4', tags: [] },
]);
assert.deepEqual(plan.tags.map((tag) => tag.name), ['RNN', 'Transformer']);
assert.deepEqual(plan.tagsByPaperId.get('p1'), [
  tagIdForName('RNN'),
  tagIdForName('Transformer'),
].sort(), 'a repeated case variant is one tag');
assert.deepEqual(plan.tagsByPaperId.get('p2'), [tagIdForName('RNN')]);
// Papers with no usable tags are absent rather than mapped to an empty list.
assert.equal(plan.tagsByPaperId.has('p3'), false);
assert.equal(plan.tagsByPaperId.has('p4'), false);
assert.equal(plan.tagsByPaperId.size, 2);

// ---------------------------------------------------------------------------
// The plan feeds buildTagEdges without translation: a tag id the vocabulary does
// not know is rejected there, so the two must agree.
// ---------------------------------------------------------------------------
const edges = buildTagEdges('p1', plan.tagsByPaperId.get('p1'), plan.tags);
assert.equal(edges.length, 2);
assert.deepEqual(
  edges.map((edge) => edge.target).sort(),
  [tagNodeId(tagIdForName('RNN')), tagNodeId(tagIdForName('Transformer'))].sort(),
);
assert.ok(edges.every((edge) => edge.origin === 'user' && edge.type === 'TAGGED'));
// Every id the planner produced is accepted, which is the property that would
// break if the two modules derived ids differently.
assert.equal(
  buildTagEdges('p2', plan.tagsByPaperId.get('p2'), plan.tags).length,
  1,
);

// An empty vocabulary yields nothing, and a paper with no tags produces no edges.
assert.deepEqual(buildTagEdges('p1', [], plan.tags), []);
assert.deepEqual(planTagAssignments([]).tags, []);
assert.equal(planTagAssignments([]).tagsByPaperId.size, 0);

console.log('Tag identity contract tests passed.');
