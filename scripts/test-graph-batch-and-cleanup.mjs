import assert from 'node:assert/strict';

import {
  findDanglingEdgeIds,
  planPaperCleanup,
  removePaperFromGraph,
} from '../src/modules/knowledge-graph/application/paper-cleanup.ts';
import {
  runBatchExtraction,
  selectBatchTargets,
  summarizeBatchResult,
} from '../src/modules/knowledge-graph/application/batch-extraction.ts';

function entity(id, overrides = {}) {
  return {
    entityId: id,
    name: id,
    normalizedName: id,
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

function edge(id, source, target, overrides = {}) {
  return {
    edgeId: id,
    source,
    sourceKind: 'paper',
    target,
    targetKind: 'entity',
    type: 'MENTIONS',
    confidence: 0.8,
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

// ---------------------------------------------------------------------------
// Paper cleanup. The rule that matters: removing a paper must remove only the
// knowledge that paper alone supported.
// ---------------------------------------------------------------------------
const entities = [
  entity('only-p1', { sourcePaperId: 'p1' }),
  entity('shared', { sourcePaperId: 'p1' }),      // introduced by p1...
  entity('from-p2', { sourcePaperId: 'p2' }),
  entity('tombstone', { sourcePaperId: 'p1', status: 'merged', mergedInto: 'shared' }),
];
const edges = [
  edge('e-p1-only', 'p1', 'only-p1'),
  edge('e-p1-shared', 'p1', 'shared'),
  // ...but paper 2 also uses it, so it must survive along with this edge.
  edge('e-p2-shared', 'p2', 'shared'),
  edge('e-p2-own', 'p2', 'from-p2'),
];

const cleanup = planPaperCleanup('p1', entities, edges);
assert.deepEqual(cleanup.entityIdsToDelete, ['only-p1'], 'only p1-exclusive entities go');
assert.deepEqual(cleanup.entityIdsRetained, ['shared'], 'a shared entity is retained');
assert.ok(
  cleanup.edgeIdsToDelete.includes('e-p1-only'),
  'edges attached to the removed paper go',
);
assert.ok(cleanup.edgeIdsToDelete.includes('e-p1-shared'));
assert.ok(
  !cleanup.edgeIdsToDelete.includes('e-p2-shared'),
  'an edge into a RETAINED entity survives, because that entity is still in the graph',
);
assert.ok(
  !cleanup.edgeIdsToDelete.includes('e-p2-own'),
  "another paper's own edge is untouched",
);
// A tombstone was already absorbed; deleting it would lose the merge history.
assert.ok(!cleanup.entityIdsToDelete.includes('tombstone'));

// An entity another paper still uses is retained even when this paper introduced
// it, and its edge survives with it. This is the conservative core of the rule.
const cascadeEntities = [
  entity('p1-own', { sourcePaperId: 'p1' }),
  entity('p2-own', { sourcePaperId: 'p2' }),
];
const cascadeEdges = [
  edge('c1', 'p1', 'p1-own'),
  edge('c2', 'p2', 'p1-own', { sourcePaperId: 'p2' }),
  edge('c3', 'p2', 'p2-own', { sourcePaperId: 'p2' }),
];
const cascade = planPaperCleanup('p1', cascadeEntities, cascadeEdges);
assert.deepEqual(
  cascade.entityIdsToDelete,
  [],
  'an entity paper 2 still uses must survive even though paper 1 introduced it',
);
assert.deepEqual(cascade.entityIdsRetained, ['p1-own']);
assert.deepEqual(
  cascade.edgeIdsToDelete,
  ['c1'],
  "only paper 1's own edge goes; paper 2's edge to the retained entity stays",
);

// Removing a paper with nothing of its own is safe and changes nothing else.
const cleanEmpty = planPaperCleanup('p3', entities, edges);
assert.deepEqual(cleanEmpty.entityIdsToDelete, []);
assert.deepEqual(cleanEmpty.edgeIdsToDelete, []);

// The full operation drops the paper and its jobs, so a later re-add re-extracts
// instead of silently reusing stale candidates.
const portState = {
  entities: [...entities],
  edges: [...edges],
  papers: ['p1', 'p2'],
  jobDeletions: [],
};
const port = {
  listEntities: async () => [...portState.entities],
  listEdges: async () => [...portState.edges],
  async deletePaper(paperId) { portState.papers = portState.papers.filter((id) => id !== paperId); },
  async deleteEntities(ids) { portState.entities = portState.entities.filter((e) => !ids.includes(e.entityId)); },
  async deleteEdges(ids) { portState.edges = portState.edges.filter((e) => !ids.includes(e.edgeId)); },
  async deleteJobsForPaper(paperId) { portState.jobDeletions.push(paperId); return 2; },
};
const removal = await removePaperFromGraph('p1', port);
assert.equal(removal.deletedPaper, true);
assert.equal(removal.deletedJobCount, 2);
assert.deepEqual(portState.jobDeletions, ['p1'], 'jobs must be dropped with the paper');
assert.deepEqual(portState.papers, ['p2']);
assert.deepEqual(portState.entities.map((e) => e.entityId).sort(), ['from-p2', 'shared', 'tombstone']);
assert.deepEqual(
  portState.edges.map((e) => e.edgeId).sort(),
  ['e-p2-own', 'e-p2-shared'],
  "paper 2's edges both survive: one to its own entity, one to the shared entity it kept alive",
);

// Dangling-edge detection: the safety net for a cleanup interrupted midway.
assert.deepEqual(
  findDanglingEdgeIds(
    [{ paperId: 'p1' }],
    [entity('e1')],
    [edge('good', 'p1', 'e1'), edge('bad-entity', 'p1', 'gone'), edge('bad-paper', 'p9', 'e1')],
  ),
  ['bad-entity', 'bad-paper'],
);
assert.deepEqual(findDanglingEdgeIds([], [], []), []);

// ---------------------------------------------------------------------------
// Batch extraction: sequential, cancellable between papers, resilient to one
// paper failing.
// ---------------------------------------------------------------------------
const papers = [
  { paperId: 'p1', title: 'Paper One' },
  { paperId: 'p2', title: 'Paper Two' },
  { paperId: 'p3', title: 'Paper Three' },
];

const seen = [];
let concurrent = 0;
let peakConcurrent = 0;
const batchResult = await runBatchExtraction({
  async runPaper(paperId) {
    concurrent += 1;
    peakConcurrent = Math.max(peakConcurrent, concurrent);
    seen.push(paperId);
    await new Promise((resolve) => setTimeout(resolve, 2));
    concurrent -= 1;
    return { status: 'done', candidatesFound: 3, newEntityCount: 2 };
  },
}, { papers });

assert.deepEqual(seen, ['p1', 'p2', 'p3'], 'papers are processed in order');
assert.equal(peakConcurrent, 1, 'papers must be processed one at a time');
assert.equal(batchResult.papersProcessed, 3);
assert.equal(batchResult.totalCandidatesFound, 9);
assert.equal(batchResult.totalNewEntities, 6);
assert.equal(batchResult.cancelled, false);

// One failing paper must not abandon the rest.
const mixedResult = await runBatchExtraction({
  async runPaper(paperId) {
    if (paperId === 'p2') return { status: 'failed', candidatesFound: 0, newEntityCount: 0, reason: 'no index' };
    if (paperId === 'p1') return { status: 'done', candidatesFound: 4, newEntityCount: 1 };
    throw new Error('provider exploded');
  },
}, { papers });
assert.equal(mixedResult.outcomes.length, 3, 'every paper is attempted');
assert.equal(mixedResult.papersFailed, 2);
assert.equal(mixedResult.totalCandidatesFound, 4, 'successful work is retained');
const thrown = mixedResult.outcomes.find((outcome) => outcome.paperId === 'p3');
assert.equal(thrown.status, 'failed');
assert.equal(thrown.reason, 'provider exploded', 'a thrown error is captured, not propagated');

// Skipped papers (unchanged content) are counted separately from failures, so the
// summary can say "no tokens spent" rather than implying something went wrong.
const skipResult = await runBatchExtraction({
  async runPaper(paperId) {
    if (paperId === 'p1') return { status: 'skipped', candidatesFound: 0, newEntityCount: 0, reason: 'unchanged' };
    return { status: 'done', candidatesFound: 1, newEntityCount: 1 };
  },
}, { papers });
assert.equal(skipResult.papersSkipped, 1);
assert.equal(skipResult.papersProcessed, 2);
assert.equal(skipResult.papersFailed, 0);
assert.match(summarizeBatchResult(skipResult), /跳过 1 篇/);

// Cancellation is checked between papers, so the completed ones stay committed.
const controller = new AbortController();
const cancelSeen = [];
const cancelResult = await runBatchExtraction({
  async runPaper(paperId) {
    cancelSeen.push(paperId);
    if (paperId === 'p2') controller.abort();
    return { status: 'done', candidatesFound: 1, newEntityCount: 0 };
  },
}, { papers, signal: controller.signal });
assert.deepEqual(cancelSeen, ['p1', 'p2'], 'the in-flight paper finishes before stopping');
assert.equal(cancelResult.cancelled, true);
assert.equal(cancelResult.outcomes.length, 2);
assert.equal(cancelResult.papersProcessed, 2, 'completed work is reported, not discarded');

// A paper that itself reports `cancelled` stops the batch too.
const innerCancel = await runBatchExtraction({
  async runPaper(paperId) {
    if (paperId === 'p2') return { status: 'cancelled', candidatesFound: 0, newEntityCount: 0 };
    return { status: 'done', candidatesFound: 1, newEntityCount: 0 };
  },
}, { papers });
assert.equal(innerCancel.cancelled, true);
assert.equal(innerCancel.outcomes.length, 2);

// Progress reporting reaches both boundaries of each paper.
const progressEvents = [];
await runBatchExtraction({
  async runPaper() { return { status: 'done', candidatesFound: 0, newEntityCount: 0 }; },
}, {
  papers,
  onProgress: (progress) => progressEvents.push(progress),
});
assert.equal(progressEvents.length, 6, 'two events per paper');
assert.equal(progressEvents.at(-1).completedPapers, 3);
assert.ok(progressEvents.some((event) => event.lastResult), 'a settled paper reports its outcome');

// Empty input is not an error.
const emptyBatch = await runBatchExtraction(
  { async runPaper() { throw new Error('must not be called'); } },
  { papers: [] },
);
assert.equal(emptyBatch.outcomes.length, 0);
assert.equal(emptyBatch.papersProcessed, 0);

// ---------------------------------------------------------------------------
// Target selection: papers without an index are filtered out up front, so the
// batch does not report a wall of identical failures.
// ---------------------------------------------------------------------------
const selection = selectBatchTargets(papers, new Set(['p1', 'p3']));
assert.deepEqual(selection.targets.map((p) => p.paperId), ['p1', 'p3']);
assert.deepEqual(selection.skippedForIndex.map((p) => p.paperId), ['p2']);
assert.deepEqual(selectBatchTargets([], new Set()).targets, []);

console.log('Paper cleanup and batch extraction contract tests passed.');
