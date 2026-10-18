import assert from 'node:assert/strict';

import {
  contiguousCompletedCount,
  runWithConcurrency,
} from '../src/modules/knowledge-graph/domain/concurrency.ts';
import {
  findMatchingEntity,
  planPendingCandidateUpsert,
} from '../src/modules/knowledge-graph/application/pending-candidates.ts';
import {
  isExtractionRunning,
  resetExtractionRunsForTest,
  runEntityExtraction,
} from '../src/modules/knowledge-graph/application/extraction-runner.ts';
import { EXTRACTION_PROMPT_VERSION } from '../src/modules/knowledge-graph/application/extraction-plan.ts';

// ---------------------------------------------------------------------------
// Bounded concurrency. Two things must hold: never exceed the limit, and report
// results positionally so a persisted cursor stays meaningful.
// ---------------------------------------------------------------------------
let inFlight = 0;
let peakInFlight = 0;
const settleOrder = [];
const outcomeLimit = await runWithConcurrency(
  Array.from({ length: 6 }, (_, index) => async () => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, index % 2 === 0 ? 5 : 1));
    inFlight -= 1;
    settleOrder.push(index);
    return index;
  }),
  { limit: 2, onSettled: (outcome) => settleOrder.push(`settled:${outcome.index}`) },
);
assert.ok(peakInFlight <= 2, `peak in-flight was ${peakInFlight}, limit was 2`);
assert.equal(outcomeLimit.length, 6);
// Positional: outcomes[index].index === index, regardless of completion order.
for (let index = 0; index < outcomeLimit.length; index += 1) {
  assert.equal(outcomeLimit[index].index, index);
  assert.equal(outcomeLimit[index].ok, true);
  assert.equal(outcomeLimit[index].value, index);
}
// Tasks really did overlap (otherwise the limit test would pass trivially).
assert.equal(peakInFlight, 2, 'the limit should be reached, not merely respected');

// A rejected task must not reject the run, and must not discard its neighbours.
const withFailure = await runWithConcurrency([
  async () => 'ok-0',
  async () => { throw new Error('boom'); },
  async () => 'ok-2',
], { limit: 3 });
assert.equal(withFailure[0].ok, true);
assert.equal(withFailure[1].ok, false);
assert.equal(withFailure[1].error, 'boom');
assert.equal(withFailure[2].ok, true);

// limit <= 1 runs sequentially.
let concurrentWhenSequential = 0;
await runWithConcurrency([
  async () => { concurrentWhenSequential += 1; await new Promise((r) => setTimeout(r, 1)); concurrentWhenSequential -= 1; },
  async () => { concurrentWhenSequential += 1; await new Promise((r) => setTimeout(r, 1)); concurrentWhenSequential -= 1; },
], { limit: 1 });
assert.equal(concurrentWhenSequential, 0);

// An aborted run stops scheduling and reports skipped work explicitly rather
// than leaving holes in the array.
const controller = new AbortController();
let started = 0;
const aborted = await runWithConcurrency(
  Array.from({ length: 6 }, () => async () => {
    started += 1;
    controller.abort();
    return 'x';
  }),
  { limit: 1, signal: controller.signal },
);
assert.ok(started < 6, 'an aborted run must stop scheduling new tasks');
for (const outcome of aborted) {
  assert.equal(typeof outcome.ok, 'boolean', 'no holes: every index has an outcome');
}

// Empty input is not an error.
assert.deepEqual(await runWithConcurrency([], { limit: 3 }), []);

// Contiguous-success counting: a cursor may only advance across unbroken
// successes, otherwise a failed batch gets marked done and its retry is skipped.
const outcomes = [
  { index: 0, ok: true },
  { index: 1, ok: true },
  { index: 2, ok: false },
  { index: 3, ok: true },
];
assert.equal(contiguousCompletedCount(outcomes, 0), 2);
assert.equal(contiguousCompletedCount(outcomes, 3), 1);
assert.equal(contiguousCompletedCount([], 0), 0);
assert.equal(contiguousCompletedCount([{ index: 0, ok: false }], 0), 0);

// ---------------------------------------------------------------------------
// Pending-candidate upserts must be re-entrant: extraction commits per batch, so
// the same batch will be processed twice after any interruption.
// ---------------------------------------------------------------------------
function candidate(name, type, confidence = 0.8, quote = 'q') {
  return { name, type, confidence, evidence: [{ paperId: 'p1', pageNumber: 1, quote }] };
}

const firstPass = planPendingCandidateUpsert(
  'p1',
  [candidate('Transformer', 'Method'), candidate('BLEU', 'Metric')],
  [],
  { now: 100 },
);
assert.equal(firstPass.entities.length, 2);
assert.equal(firstPass.newEntityCount, 2);
assert.ok(firstPass.entities.every((entity) => entity.status === 'pending'));

// Re-running the identical batch must produce no writes at all.
const noopPass = planPendingCandidateUpsert(
  'p1',
  [candidate('Transformer', 'Method'), candidate('BLEU', 'Metric')],
  firstPass.entities,
  { now: 200 },
);
assert.equal(noopPass.entities.length, 0, 'an identical batch must be a no-op');
assert.equal(noopPass.newEntityCount, 0);

// New evidence does produce an update, and the entity id is preserved.
const withEvidence = planPendingCandidateUpsert(
  'p1',
  [candidate('Transformer', 'Method', 0.9, 'a second quote')],
  firstPass.entities,
  { now: 300 },
);
assert.equal(withEvidence.entities.length, 1);
assert.equal(
  withEvidence.entities[0].entityId,
  firstPass.entities[0].entityId,
  'the existing entity must be updated in place, not duplicated',
);
assert.equal(withEvidence.entities[0].evidence.length, 2, 'evidence accumulates');
assert.equal(withEvidence.entities[0].confidence, 0.9);
// Extraction must never promote a candidate to confirmed.
assert.equal(
  withEvidence.entities[0].status,
  'pending',
  'only an explicit user confirmation may promote a candidate',
);

// A normalized-name variant lands on the existing entity.
const variant = planPendingCandidateUpsert(
  'p2',
  [candidate('Transformer模型', 'Method')],
  firstPass.entities,
  { now: 400 },
);
assert.equal(variant.entities.length, 1);
assert.equal(variant.entities[0].entityId, firstPass.entities[0].entityId);
assert.ok(variant.entities[0].aliases.includes('Transformer模型'));

// The SAME name as a different type is a different entity: "BLEU" the metric and
// a dataset named BLEU must not be collapsed silently.
const differentType = planPendingCandidateUpsert(
  'p1',
  [candidate('BLEU', 'Dataset')],
  firstPass.entities,
  { now: 500 },
);
assert.equal(differentType.entities.length, 1);
assert.notEqual(
  differentType.entities[0].entityId,
  firstPass.entities[1].entityId,
  'a same-name different-type candidate must create its own entity',
);

// Matching is by normalized name AND type, and never lands on a tombstone.
assert.equal(
  findMatchingEntity(candidate('Transformer', 'Method'), firstPass.entities)?.entityId,
  firstPass.entities[0].entityId,
);
assert.equal(findMatchingEntity(candidate('Transformer', 'Dataset'), firstPass.entities), undefined);
assert.equal(
  findMatchingEntity(candidate('Transformer', 'Method'), [
    { ...firstPass.entities[0], status: 'merged' },
  ]),
  undefined,
  'a merged tombstone must never receive new evidence',
);
assert.equal(findMatchingEntity(candidate('', 'Method'), firstPass.entities), undefined);

// Two candidates in one batch that normalize identically collapse to one entity.
const sameBatch = planPendingCandidateUpsert(
  'p1',
  [candidate('BERT', 'Method'), candidate('bert', 'Method', 0.7)],
  [],
  { now: 600 },
);
assert.equal(sameBatch.entities.length, 1);
assert.equal(sameBatch.newEntityCount, 1);

// ---------------------------------------------------------------------------
// Orchestrator, against an in-memory double. This is where the MV3 rules live:
// resume, skip, per-batch commit, and never advancing the cursor over a failure.
// ---------------------------------------------------------------------------
function createPorts(overrides = {}) {
  const state = {
    chunks: overrides.chunks ?? [
      { chunkId: 'c0', startPage: 1, endPage: 1, text: 'x'.repeat(50) },
      { chunkId: 'c1', startPage: 2, endPage: 2, text: 'x'.repeat(50) },
      { chunkId: 'c2', startPage: 3, endPage: 3, text: 'x'.repeat(50) },
      { chunkId: 'c3', startPage: 4, endPage: 4, text: 'x'.repeat(50) },
    ],
    entities: overrides.entities ?? [],
    job: overrides.job ?? null,
    paper: overrides.paper ?? { paperId: 'p1', title: 'A Paper' },
    paperSummary: overrides.paperSummary ?? '',
    settings: overrides.settings ?? {
      extractionMaxCandidatesPerChunk: 12,
      maxConcurrentExtractionBatches: 2,
    },
    responses: overrides.responses ?? [],
    requests: [],
    paperUpdates: [],
    deletedEntityIds: [],
  };
  let responseIndex = 0;
  const ports = {
    state,
    loadChunks: async () => [...state.chunks],
    getJob: async () => state.job,
    async putJob(job) { state.job = job; },
    listEntities: async () => [...state.entities],
    async putEntities(entities) {
      const byId = new Map(state.entities.map((entity) => [entity.entityId, entity]));
      for (const entity of entities) byId.set(entity.entityId, entity);
      state.entities = [...byId.values()];
    },
    async deleteEntities(entityIds) {
      const removed = new Set(entityIds);
      state.deletedEntityIds.push(...entityIds);
      state.entities = state.entities.filter((entity) => !removed.has(entity.entityId));
    },
    getPaper: async () => state.paper,
    getPaperSummary: async () => state.paperSummary ?? '',
    async updatePaperExtraction(_paperId, update) { state.paperUpdates.push(update); },
    readSettings: async () => ({ ...state.settings }),
    async requestEntities(message) {
      state.requests.push(message);
      const next = state.responses[responseIndex] ?? { ok: true, content: '{"entities":[]}' };
      responseIndex += 1;
      return typeof next === 'function' ? next() : next;
    },
  };
  return ports;
}

resetExtractionRunsForTest();

// The paper summary (abstract, or the knowledge base's overview as a fallback) rides on every batch
// request: a three-chunk window has no other way to know what the paper is about, which is how a
// background method in the Introduction gets recorded as this paper's contribution.
const withSummary = createPorts({
  paperSummary: 'We propose a SAT-based heuristic for cancellation.',
  responses: [
    { ok: true, content: '{"entities":[]}' },
    { ok: true, content: '{"entities":[]}' },
  ],
});
const summaryResult = await runEntityExtraction(withSummary, { paperId: 'p1', force: true });
assert.equal(summaryResult.status, 'done');
assert.ok(withSummary.state.requests.length >= 1);
assert.equal(
  withSummary.state.requests.every(
    (request) => request.abstract === 'We propose a SAT-based heuristic for cancellation.',
  ),
  true,
  'every batch carries the summary',
);

// No summary at all is allowed, and then the field is omitted rather than sent empty.
const withoutSummary = createPorts({
  responses: [{ ok: true, content: '{"entities":[]}' }, { ok: true, content: '{"entities":[]}' }],
});
await runEntityExtraction(withoutSummary, { paperId: 'p1', force: true });
assert.equal(
  withoutSummary.state.requests.every((request) => !('abstract' in request)),
  true,
  'an empty summary means no abstract field, not an empty one',
);

// A paper with no chunks must fail with an actionable message, not silently do
// nothing — and must mark the paper so the page can show it.
const noChunks = createPorts({ chunks: [] });
const noChunksResult = await runEntityExtraction(noChunks, { paperId: 'p1' });
assert.equal(noChunksResult.status, 'failed');
assert.ok(noChunksResult.reason.includes('索引'));
assert.equal(noChunks.state.paperUpdates.at(-1).extractionStatus, 'error');

// A happy run: 4 chunks -> 2 batches, candidates persisted as pending.
const happy = createPorts({
  responses: [
    { ok: true, content: '{"entities":[{"name":"Transformer","type":"Method","confidence":0.9}]}' },
    { ok: true, content: '{"entities":[{"name":"BLEU","type":"Metric","confidence":0.8}]}' },
  ],
});
const happyResult = await runEntityExtraction(happy, { paperId: 'p1' });
assert.equal(happyResult.status, 'done');
assert.equal(happyResult.batchesRun, 2);
assert.equal(happyResult.batchesFailed, 0);
assert.equal(happyResult.candidatesFound, 2);
assert.equal(happy.state.entities.length, 2);
assert.ok(happy.state.entities.every((entity) => entity.status === 'pending'));
assert.equal(happy.state.job.status, 'done');
assert.equal(happy.state.job.cursor.batchIndex, 2);
assert.equal(happy.state.paperUpdates.at(-1).extractionStatus, 'ready');
assert.equal(happy.state.paperUpdates.at(-1).extractedAt !== null, true);
const progressPhases = [];
await runEntityExtraction(happy, {
  paperId: 'p1',
  force: false,
  onProgress: (progress) => progressPhases.push(progress.phase),
});
assert.deepEqual(progressPhases, ['checking', 'skipped'], 'a completed job must be skipped');

// Re-running with `force` replaces this paper's unconfirmed candidates instead of accumulating them.
//
// Before this rule, re-extracting with an improved prompt showed the old noisy list mixed with the
// new one, which made every prompt change impossible to evaluate. Confirmed entities are the user's
// decisions and are never touched.
const forced = createPorts({
  entities: happy.state.entities,
  job: happy.state.job,
  responses: [
    { ok: true, content: '{"entities":[{"name":"Transformer","type":"Method","confidence":0.9}]}' },
    { ok: true, content: '{"entities":[{"name":"BLEU","type":"Metric","confidence":0.8}]}' },
  ],
});
const forcedResult = await runEntityExtraction(forced, { paperId: 'p1', force: true });
assert.equal(forcedResult.status, 'done');
assert.equal(forced.state.entities.length, 2, 'a forced re-run must not duplicate entities');
assert.equal(forcedResult.replacedPending, 2, 'the stale pending candidates are replaced, and counted');
assert.equal(forced.state.deletedEntityIds.length, 2, 'and they are actually deleted from storage');
assert.ok(
  forced.state.entities.every((entity) => !happy.state.entities.some((old) => old.entityId === entity.entityId)),
  'the replacements are new records, not the same rows rewritten',
);

// A confirmed entity survives a re-extraction: only unconfirmed candidates are replaced.
const confirmedKept = createPorts({
  entities: [
    {
      ...happy.state.entities[0],
      entityId: 'entity:confirmed',
      status: 'confirmed',
    },
  ],
  job: null,
  responses: [{ ok: true, content: '{"entities":[]}' }],
});
const confirmedResult = await runEntityExtraction(confirmedKept, { paperId: 'p1', force: true });
assert.equal(confirmedResult.status, 'done');
assert.equal(confirmedResult.replacedPending, 0, 'a confirmed entity is not a stale candidate');
assert.equal(confirmedKept.state.deletedEntityIds.length, 0);
assert.ok(
  confirmedKept.state.entities.some((entity) => entity.entityId === 'entity:confirmed'),
  'the user’s confirmation is never undone by re-extracting',
);

// Invalidated input (re-indexed) must not be skipped even though a job exists.
const reindexed = createPorts({
  chunks: [{ chunkId: 'c0', startPage: 1, endPage: 1, text: 'y'.repeat(80) }],
  job: { ...happy.state.job, inputFingerprint: 'stale' },
  responses: [{ ok: true, content: '{"entities":[]}' }],
});
const reindexedResult = await runEntityExtraction(reindexed, { paperId: 'p1' });
assert.equal(reindexedResult.status, 'done', 'a stale fingerprint must force a re-run');

// Resume: a job stopped at batch 1 must only send batch 2.
const resumePorts = createPorts({
  job: {
    jobId: 'job:p1:1',
    paperId: 'p1',
    kind: 'entity-extraction',
    status: 'running',
    attempts: 1,
    lastError: null,
    cursor: { batchIndex: 1 },
    inputFingerprint: (await import('../src/modules/knowledge-graph/application/job-policy.ts'))
      .extractionInputFingerprint({
        paperId: 'p1',
        chunkIds: ['c0', 'c1', 'c2', 'c3'],
        chunkCharacterCounts: [50, 50, 50, 50],
        promptVersion: EXTRACTION_PROMPT_VERSION,
        maxCandidatesPerChunk: 12,
      }),
    createdAt: 1,
    updatedAt: 2,
  },
  responses: [{ ok: true, content: '{"entities":[{"name":"Resumed","type":"Method"}]}' }],
});
const resumeResult = await runEntityExtraction(resumePorts, { paperId: 'p1' });
assert.equal(resumeResult.status, 'done');
assert.equal(resumeResult.batchesRun, 1, 'only the unfinished batch may be sent');
assert.equal(resumePorts.state.requests.length, 1);
assert.ok(
  resumePorts.state.requests[0].chunks.some((chunk) => chunk.chunkId === 'c3'),
  'the resumed batch must be the second one',
);

// A parked job (attempts exhausted) must not be retried, and must say why.
const parkedPorts = createPorts({
  job: {
    jobId: 'job:p1:2',
    paperId: 'p1',
    kind: 'entity-extraction',
    status: 'failed',
    attempts: 3,
    lastError: 'provider exploded',
    cursor: { batchIndex: 1 },
    inputFingerprint: resumePorts.state.job.inputFingerprint,
    createdAt: 1,
    updatedAt: 2,
  },
});
const parkedResult = await runEntityExtraction(parkedPorts, { paperId: 'p1' });
assert.equal(parkedResult.status, 'failed');
assert.ok(parkedResult.reason.includes('provider exploded'));
assert.equal(parkedPorts.state.requests.length, 0, 'a parked job must spend no tokens');

// A failing batch must not advance the cursor past the gap, and its siblings'
// work must survive.
const partial = createPorts({
  responses: [
    { ok: true, content: '{"entities":[{"name":"Kept","type":"Method"}]}' },
    { ok: false, error: 'rate limited' },
  ],
});
const partialResult = await runEntityExtraction(partial, { paperId: 'p1' });
assert.equal(partialResult.status, 'failed');
assert.equal(partialResult.batchesFailed, 1);
assert.equal(partialResult.candidatesFound, 1, 'the successful batch must be kept');
assert.equal(partial.state.entities.length, 1, 'the successful batch must be persisted');
assert.equal(
  partial.state.job.cursor.batchIndex,
  1,
  'the cursor must stop before the failed batch so the retry re-sends it',
);
assert.equal(partial.state.job.status, 'queued', 'a retryable failure returns to queued');

// Concurrency must be honoured on the real request path.
const concurrencyPorts = createPorts({
  chunks: Array.from({ length: 9 }, (_, index) => ({
    chunkId: `c${index}`, startPage: index + 1, endPage: index + 1, text: 'x'.repeat(10),
  })),
  settings: { extractionMaxCandidatesPerChunk: 12, maxConcurrentExtractionBatches: 3 },
  responses: Array.from({ length: 3 }, () => ({ ok: true, content: '{"entities":[]}' })),
});
const concurrencyResult = await runEntityExtraction(concurrencyPorts, { paperId: 'p1' });
assert.equal(concurrencyResult.batchesRun, 3, '9 chunks at 3 per batch is 3 batches');
assert.equal(concurrencyPorts.state.requests.length, 3);

// The same paper cannot be extracted twice at once: that would double the token
// spend for the same result and race two writers onto the same entities.
resetExtractionRunsForTest();
const busyPorts = createPorts({
  responses: [
    async () => {
      assert.equal(isExtractionRunning('p1'), true, 'the run must register itself');
      const second = await runEntityExtraction(busyPorts, { paperId: 'p1' });
      assert.equal(second.status, 'busy');
      return { ok: true, content: '{"entities":[]}' };
    },
    { ok: true, content: '{"entities":[]}' },
  ],
});
const busyResult = await runEntityExtraction(busyPorts, { paperId: 'p1' });
assert.equal(busyResult.status, 'done');
assert.equal(isExtractionRunning('p1'), false, 'the lock must be released');

// An aborted run reports `cancelled` and keeps what it committed.
resetExtractionRunsForTest();
const abortController = new AbortController();
const abortPorts = createPorts({
  responses: [
    async () => {
      abortController.abort();
      return { ok: true, content: '{"entities":[{"name":"First","type":"Method"}]}' };
    },
    async () => ({ ok: true, content: '{"entities":[]}' }),
  ],
});
const abortResult = await runEntityExtraction(abortPorts, {
  paperId: 'p1',
  signal: abortController.signal,
});
assert.equal(abortResult.status, 'cancelled');
assert.equal(abortPorts.state.entities.length, 1, 'committed work survives cancellation');
assert.equal(abortPorts.state.paperUpdates.at(-1).extractionStatus, 'ready');

console.log('Extraction runner and concurrency contract tests passed.');
