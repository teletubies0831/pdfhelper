import assert from 'node:assert/strict';

import {
  buildMergeReview,
  groupMergeRowsByKeep,
  orderMergePairsForBatch,
  selectMergeCandidates,
} from '../src/modules/knowledge-graph/application/merge-review.ts';

function entity(id, name, overrides = {}) {
  return {
    entityId: id,
    name,
    normalizedName: name.toLocaleLowerCase().replace(/[^a-z0-9]/g, ''),
    aliases: [],
    type: 'Method',
    status: 'confirmed',
    confidence: 0.8,
    sourcePaperId: 'p1',
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Merge candidates never include tombstones.
//
// `planEntityMerge` refuses to fold into a `merged` record, so offering one in
// the dialog would render a merge button that silently does nothing.
// ---------------------------------------------------------------------------
assert.deepEqual(
  selectMergeCandidates([
    entity('keep', 'Transformer'),
    entity('tomb', 'Transformer Model', { status: 'merged', mergedInto: 'keep' }),
    entity('pending-one', 'BERT', { status: 'pending' }),
  ]).map((item) => item.entityId),
  ['keep', 'pending-one'],
);

const review = buildMergeReview([
  entity('e1', 'Graph Convolutional Network', { evidence: [1, 2, 3] }),
  entity('e2', 'Graph Convolution Networks', { evidence: [1] }),
  entity('e3', 'BERT'),
  entity('e4', 'ERNIE'),
  entity('tomb', 'Old Name', { status: 'merged', mergedInto: 'e1' }),
]);

// Only the genuine variant pair is suggested; BERT/ERNIE stays apart.
assert.equal(review.rows.length, 1, 'only the variant pair may be suggested');
assert.equal(review.rows[0].mergeName, 'Graph Convolution Networks');
assert.equal(review.rows[0].keepName, 'Graph Convolutional Network');
assert.equal(review.autoSelectableCount, 1);
// The tombstone is reported as excluded rather than silently ignored.
assert.equal(review.excludedCount, 1);

// The better-evidenced side survives, and the dialog is told enough to explain
// what merging will do to the evidence count.
assert.equal(review.rows[0].keepEntityId, 'e1', 'more evidence must survive');
assert.equal(review.rows[0].keepEvidenceCount, 3);
assert.equal(review.rows[0].mergeEvidenceCount, 1);

// Equal evidence falls back to the older record, then to the id: deterministic
// across reloads so the survivor does not flip between openings.
const tie = buildMergeReview([
  entity('zeta', 'Graph Convolutional Network', { createdAt: 5 }),
  entity('alpha', 'Graph Convolution Networks', { createdAt: 5 }),
]);
assert.equal(tie.rows[0].keepEntityId, 'alpha');

// A typo in a longer name lands in the review band: offered, not pre-ticked.
const tentative = buildMergeReview([
  entity('a', 'Transformer Encoder'),
  entity('b', 'Transformer Enocder'),
]);
assert.equal(tentative.rows.length, 1, 'a typo pair must still be offered');
assert.equal(tentative.rows[0].autoSelectable, false, 'a typo pair must not be pre-ticked');
assert.equal(tentative.autoSelectableCount, 0);

// Nothing to merge is an empty result, not an error.
assert.deepEqual(buildMergeReview([]).rows, []);
assert.deepEqual(buildMergeReview([entity('only', 'Solo')]).rows, []);

// Identical normalized names are a silent merge upstream, so they must never
// appear here asking the user to confirm a fact.
assert.equal(
  buildMergeReview([
    entity('a', 'Transformer'),
    entity('b', 'Transformer模型'),
  ]).rows.length,
  0,
  'equal normalized names are not a suggestion',
);

// ---------------------------------------------------------------------------
// Clustering. `suggestEntityMerges` is pairwise, so a cluster of misspellings
// forms a clique and taking it literally breaks a batch action: merging the
// top pair tombstones one misspelling, and the sibling merge is then refused.
// ---------------------------------------------------------------------------
const multi = buildMergeReview([
  entity('keep', 'Graph Convolutional Network', { evidence: [1, 2, 3, 4] }),
  entity('m1', 'Graph Convolution Networks', { evidence: [1] }),
  entity('m2', 'Graph Convolutional Networks', { evidence: [1] }),
]);
assert.equal(multi.rows.length, 2, 'the whole cluster is presented, not just one pair');
const grouped = groupMergeRowsByKeep(multi.rows);
assert.equal(grouped.length, 1, 'both misspellings point at the same survivor');
assert.equal(grouped[0].keepEntityId, 'keep');
assert.equal(grouped[0].rows.length, 2);
assert.equal(grouped[0].keepName, 'Graph Convolutional Network');
assert.ok(
  multi.rows.every((row) => row.mergeEntityId !== 'keep'),
  'the survivor must never be the absorbed side',
);

// A pair linked only through a third entity is still scored honestly. Reporting
// 0 would be a lie: "Graph Convolutional Network" vs "Graph Convolutional
// Networks" is an exact normalized match (score 1.0) but is absent from the pair
// list because an equal normalized name is a silent merge, not a suggestion.
const derived = multi.rows.find((row) => row.mergeEntityId === 'm2');
assert.ok(derived, 'the transitively-linked member is offered');
assert.ok(
  derived.score > 0.95,
  `a derived row must report its real score, got ${derived.score}`,
);
// Derived rows are never pre-ticked: the score is real but the pair was not
// directly evaluated, so it stays the user's call.
assert.equal(derived.autoSelectable, false, 'a derived row must not be pre-ticked');
assert.equal(
  multi.rows.find((row) => row.mergeEntityId === 'm1').autoSelectable,
  true,
  'a directly-scored pair above threshold is pre-ticked',
);
assert.equal(multi.autoSelectableCount, 1);

// The batch action must be able to finish the whole cluster in one pass.
const clusterBatch = orderMergePairsForBatch(multi.rows);
assert.equal(clusterBatch.length, 2, 'both merges are applicable in one pass');
assert.equal(new Set(clusterBatch.map((pair) => pair.keepEntityId)).size, 1);
assert.equal(new Set(clusterBatch.map((pair) => pair.mergeEntityId)).size, 2);

// A two-member cluster keeps the pairwise survivor rule (more evidence wins).
const pairOnly = buildMergeReview([
  entity('rich', 'Graph Convolutional Network', { evidence: [1, 2, 3] }),
  entity('poor', 'Graph Convolution Networks', { evidence: [1] }),
]);
assert.equal(pairOnly.rows.length, 1);
assert.equal(pairOnly.rows[0].keepEntityId, 'rich');
assert.equal(pairOnly.rows[0].keepEvidenceCount, 3);

// ---------------------------------------------------------------------------
// Batch ordering. Each merge tombstones the absorbed entity, so pairs are
// applied survivor-first and any pair left referencing an already-absorbed
// entity is dropped rather than attempted against a tombstone.
// ---------------------------------------------------------------------------
const chainRows = [
  { keepEntityId: 'B', mergeEntityId: 'C', score: 0.99, reasons: [], autoSelectable: true,
    keepName: 'B', mergeName: 'C', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
  { keepEntityId: 'A', mergeEntityId: 'B', score: 0.90, reasons: [], autoSelectable: true,
    keepName: 'A', mergeName: 'B', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
];
// This chain is valid: C folds into B, then B folds into A. Highest score first
// means C->B is applied before A->B, and neither step targets a tombstone.
assert.deepEqual(orderMergePairsForBatch(chainRows), [
  { keepEntityId: 'B', mergeEntityId: 'C' },
  { keepEntityId: 'A', mergeEntityId: 'B' },
]);

// A genuinely conflicting pair IS dropped: once B has been absorbed into A, a
// later pair trying to absorb B somewhere else cannot be applied.
const conflicting = orderMergePairsForBatch([
  { keepEntityId: 'A', mergeEntityId: 'B', score: 0.99, reasons: [], autoSelectable: true,
    keepName: 'A', mergeName: 'B', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
  { keepEntityId: 'C', mergeEntityId: 'B', score: 0.90, reasons: [], autoSelectable: true,
    keepName: 'C', mergeName: 'B', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
]);
assert.deepEqual(
  conflicting,
  [{ keepEntityId: 'A', mergeEntityId: 'B' }],
  'the second attempt to absorb the same entity must be dropped',
);

// Independent pairs are all kept and ordered by descending score.
const independent = orderMergePairsForBatch([
  { keepEntityId: 'a', mergeEntityId: 'b', score: 0.9, reasons: [], autoSelectable: true,
    keepName: 'a', mergeName: 'b', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
  { keepEntityId: 'c', mergeEntityId: 'd', score: 0.95, reasons: [], autoSelectable: true,
    keepName: 'c', mergeName: 'd', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
]);
assert.deepEqual(independent.map((pair) => `${pair.keepEntityId}<-${pair.mergeEntityId}`), [
  'c<-d', 'a<-b',
]);

assert.deepEqual(orderMergePairsForBatch([]), []);

// Determinism: identical input yields identical ordering.
const deterministicInput = [
  { keepEntityId: 'a', mergeEntityId: 'b', score: 0.8, reasons: [], autoSelectable: true,
    keepName: 'a', mergeName: 'b', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
  { keepEntityId: 'c', mergeEntityId: 'd', score: 0.8, reasons: [], autoSelectable: true,
    keepName: 'c', mergeName: 'd', keepAliases: [], mergeAliases: [],
    keepEvidenceCount: 0, mergeEvidenceCount: 0 },
];
assert.deepEqual(
  orderMergePairsForBatch(deterministicInput),
  orderMergePairsForBatch(deterministicInput),
);

console.log('Entity merge review contract tests passed.');
