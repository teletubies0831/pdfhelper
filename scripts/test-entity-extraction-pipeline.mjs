import assert from 'node:assert/strict';

import {
  canResumeJob,
  createJobRecord,
  cursorFromProgress,
  extractionInputFingerprint,
  isJobComplete,
  isTerminalJobStatus,
  jobProgressOf,
  jobRetryDelayMs,
  markJobCancelled,
  markJobDone,
  markJobFailed,
  markJobProgress,
  markJobRunning,
  remainingBatches,
  shouldRetryJob,
  MAX_JOB_ATTEMPTS,
} from '../src/modules/knowledge-graph/application/job-policy.ts';
import {
  buildEntityExtractionPrompt,
  buildExtractionUserMessage,
  overviewLeadAsAbstract,
  EXTRACTION_CHUNKS_PER_CALL,
  EXTRACTION_ENTITY_TYPES,
  EXTRACTION_MAX_INPUT_CHARACTERS,
  EXTRACTION_PROMPT_VERSION,
  planExtractionBatches,
} from '../src/modules/knowledge-graph/application/extraction-plan.ts';
import { parseEntityCandidates } from '../src/modules/knowledge-graph/application/candidate-parsing.ts';
import { normalizeEntityName } from '../src/modules/knowledge-graph/domain/entity-normalization.ts';

// ---------------------------------------------------------------------------
// Batching. The service worker can die between messages, so a batch must be
// bounded in time and re-derivable: same input, same grouping, every run.
// ---------------------------------------------------------------------------
function chunk(index, characters, startPage = index + 1) {
  return {
    chunkId: `doc:1:chunk:${index}`,
    heading: index === 0 ? 'Introduction' : undefined,
    startPage,
    endPage: startPage,
    text: 'x'.repeat(characters),
  };
}

const small = [chunk(0, 100), chunk(1, 100), chunk(2, 100), chunk(3, 100)];
const batches = planExtractionBatches(small);
assert.equal(batches.length, 2, '4 chunks at 3 per call should produce 2 batches');
assert.deepEqual(batches[0].chunkIds, ['doc:1:chunk:0', 'doc:1:chunk:1', 'doc:1:chunk:2']);
assert.deepEqual(batches[1].chunkIds, ['doc:1:chunk:3']);

// Determinism: identical input must give identical grouping, or a retry after a
// reload would re-send a different set than the cursor assumes.
assert.deepEqual(planExtractionBatches(small), batches);

// The character budget is the real limit when chunks are large.
const large = [chunk(0, 9000), chunk(1, 9000), chunk(2, 9000), chunk(3, 9000)];
const largeBatches = planExtractionBatches(large);
assert.ok(largeBatches.length >= 2, '30k character budget must split 36k of chunks');
for (const batch of largeBatches) {
  const total = batch.prompt.length;
  assert.ok(
    total <= EXTRACTION_MAX_INPUT_CHARACTERS + 2000,
    `a batch of ${total} characters exceeded the input budget`,
  );
}
// Chunk ids are preserved exactly once across the whole plan: no loss, no dupes.
const allIds = largeBatches.flatMap((batch) => batch.chunkIds);
assert.equal(allIds.length, large.length);
assert.equal(new Set(allIds).size, large.length);

// A single chunk larger than the budget must still be sent, not silently dropped.
const oversized = [chunk(0, EXTRACTION_MAX_INPUT_CHARACTERS * 2)];
assert.equal(planExtractionBatches(oversized).length, 1, 'an oversized chunk must not vanish');

// Empty input is not a batch.
assert.deepEqual(planExtractionBatches([]), []);

// Page labels reach the prompt so the model can attribute evidence.
assert.ok(batches[0].prompt.includes('第 1 页'), 'the page label must be in the prompt');
assert.ok(batches[0].prompt.includes('Introduction'), 'the heading must be in the prompt');

// The chunks-per-call cap is honoured independently of the character budget.
assert.equal(planExtractionBatches(small, EXTRACTION_MAX_INPUT_CHARACTERS, 1).length, 4);

// ---------------------------------------------------------------------------
// The prompt must constrain the model in the ways the parser relies on.
//
// The prompt deliberately states **no numeric quota**: "at most N candidates" is read as "produce
// N", and that is how a paper's Introduction turns into filler. The ceiling is enforced in code
// (see the truncation assertions below), so the prompt is checked for the *absence* of a quota and
// for the wording that makes an empty answer legal.
// ---------------------------------------------------------------------------
const prompt = buildEntityExtractionPrompt();
assert.doesNotMatch(prompt, /最多\s*\d+\s*个/, 'a numeric quota in the prompt is read as a target');
assert.match(prompt, /宁缺毋滥/, 'the prompt must allow "fewer is better"');
assert.match(prompt, /返回空数组/, 'an empty answer has to be a legal answer');
assert.ok(prompt.includes('只输出 JSON'), 'the prompt must demand bare JSON');
for (const type of EXTRACTION_ENTITY_TYPES) {
  assert.ok(prompt.includes(type), `the prompt must define the ${type} type`);
}
// The instructions that exist because of observed failure modes.
assert.match(prompt, /正例/, 'the prompt must show positive examples');
assert.match(prompt, /反例/, 'the prompt must show what not to extract');
for (const generic of ['Deep Learning', 'Neural Network', 'Model', 'Method', 'Data']) {
  assert.ok(prompt.includes(generic), `the negative examples must name the generic word ${generic}`);
}
// The two shapes that survived the previous rewrite, named explicitly.
assert.match(prompt, /图表碎片/, 'table/figure fragments are called out');
assert.match(prompt, /Table 3/, 'with an example of the shape');
assert.match(prompt, /描述性长句/, 'descriptive clauses are called out');
assert.match(prompt, /Support for/, 'with the example the user actually saw');
// The closing line used to invite padding: "给低分也不要省略" reads as "output it anyway".
assert.match(prompt, /不确定的候选请不要输出/, 'uncertain candidates must not be output at all');
assert.doesNotMatch(prompt, /宁可给低分也不要省略/, 'that instruction invited filler candidates');
assert.ok(
  prompt.includes('逐字摘录'),
  'the prompt must require a verbatim evidence quote',
);
assert.ok(prompt.includes('aliases'), 'the prompt must define the aliases field');
assert.ok(prompt.includes('confidence'), 'the prompt must define the confidence field');
assert.equal(EXTRACTION_PROMPT_VERSION.length > 0, true);
assert.ok(EXTRACTION_CHUNKS_PER_CALL >= 1);

// The ceiling that used to be a prompt sentence is now a truncation in the parser, which keeps the
// most confident candidates and reports the rest instead of silently shrinking the answer.
const capped = parseEntityCandidates(
  JSON.stringify({
    entities: [
      { name: 'Alpha', type: 'Method', confidence: 0.95, evidence: [] },
      { name: 'Beta', type: 'Method', confidence: 0.5, evidence: [] },
      { name: 'Gamma', type: 'Method', confidence: 0.9, evidence: [] },
    ],
  }),
  { paperId: 'p1', defaultPageNumber: 1, maxCandidates: 2 },
  (name) => String(name ?? '').toLowerCase(),
);
assert.deepEqual(capped.candidates.map((candidate) => candidate.name), ['Alpha', 'Gamma']);
assert.equal(capped.rejected.length, 1, 'the trimmed candidate is reported, not silently dropped');
assert.match(capped.rejected[0].reason, /超过上限 2/);

// ---------------------------------------------------------------------------
// The user message: the abstract leads, because a call only sees three chunks.
//
// Without it, a background method mentioned in the Introduction is indistinguishable from this
// paper's own contribution — the exact misclassification the prompt rewrite is meant to fix.
// ---------------------------------------------------------------------------
const withAbstract = buildExtractionUserMessage({
  paperTitle: 'An IAGR paper',
  documentName: 'paper.pdf',
  abstract: 'We propose a SAT-based heuristic for cancellation.',
  batch: '[第 1 页（Introduction）]\nbody text',
});
assert.ok(
  withAbstract.startsWith('论文标题：An IAGR paper'),
  'the title still leads the message',
);
assert.match(withAbstract, /论文摘要：We propose a SAT-based heuristic for cancellation\./);
assert.ok(
  withAbstract.indexOf('论文摘要') < withAbstract.indexOf('文档：'),
  'the abstract precedes the chunk text, so it frames what follows',
);
assert.ok(withAbstract.indexOf('正文片段：') < withAbstract.indexOf('body text'));
assert.ok(withAbstract.endsWith('body text'), 'the batch text is last');

const withoutAbstract = buildExtractionUserMessage({
  paperTitle: 'An IAGR paper',
  documentName: 'paper.pdf',
  batch: 'body text',
});
assert.doesNotMatch(withoutAbstract, /论文摘要/, 'no abstract means no block, not an empty one');
assert.match(buildExtractionUserMessage({
  paperTitle: 't',
  documentName: 'd',
  abstract: '   ',
  batch: 'b',
}), /^论文标题：t\n\n文档：d/, 'a whitespace-only abstract is treated as missing');

// Most local PDFs have no bibliographic abstract, so the knowledge base's generated overview is what
// actually reaches the model. It has to be flattened out of Markdown and cut to a lead paragraph.
const overviewLead = overviewLeadAsAbstract(
  '## 概要\n\n- **问题**：本文研究低温逻辑综合。\n- 方法：提出 SAT 求解流程。\n\n## 结论\n\n流程缩短了 20%。',
  40,
);
assert.doesNotMatch(overviewLead, /^#/m, 'heading markers are stripped');
assert.doesNotMatch(overviewLead, /\*\*/, 'emphasis markers are stripped');
assert.doesNotMatch(overviewLead, /\n/, 'the lead is one paragraph');
assert.ok(overviewLead.length <= 41, `the lead respects the limit: ${overviewLead.length}`);
assert.ok(overviewLead.endsWith('…'), 'a truncated lead is marked as truncated');
assert.equal(overviewLeadAsAbstract('  short overview  '), 'short overview', 'a short overview is kept whole');

// ---------------------------------------------------------------------------
// Job lifecycle. These rules decide when to stop asking the model, which is
// precisely where a mistake costs money.
// ---------------------------------------------------------------------------
const base = createJobRecord({
  jobId: 'job:1',
  paperId: 'doc:1',
  kind: 'entity-extraction',
  inputFingerprint: 'fp-1',
  now: 1000,
});
assert.equal(base.status, 'queued');
assert.equal(base.attempts, 0);
assert.equal(base.cursor, null);

const running = markJobRunning(base, 1100);
assert.equal(running.status, 'running');
assert.equal(running.attempts, 1);

const progressed = markJobProgress(running, { batchIndex: 2 }, 1200);
assert.equal(progressed.cursor.batchIndex, 2);
assert.equal(progressed.status, 'running');
assert.equal(progressed.lastError, null);

// A retryable failure returns to `queued`, not `running`: a later resume must not
// mistake a dead attempt for live work.
const failedOnce = markJobFailed(progressed, 'network down', 1300);
assert.equal(failedOnce.status, 'queued');
assert.equal(failedOnce.lastError, 'network down');
// Progress survives the failure — that is the whole point of the cursor.
assert.equal(failedOnce.cursor.batchIndex, 2, 'a failure must not reset progress');

// Exhausting the attempt budget parks the job as failed.
let exhausted = base;
for (let attempt = 0; attempt < MAX_JOB_ATTEMPTS; attempt += 1) {
  exhausted = markJobFailed(markJobRunning(exhausted), `error ${attempt}`);
}
assert.equal(exhausted.status, 'failed');
assert.equal(exhausted.attempts, MAX_JOB_ATTEMPTS);
assert.equal(shouldRetryJob(exhausted), false, 'a parked job must not be retried');

// Backoff grows but stays bounded, so it cannot stack into a multi-minute wait.
assert.equal(jobRetryDelayMs(1), 1000);
assert.equal(jobRetryDelayMs(2), 2000);
assert.ok(jobRetryDelayMs(99) <= 30_000);
assert.equal(jobRetryDelayMs(0), 1000, 'attempt 0 is clamped to the first step');
assert.equal(jobRetryDelayMs(1.7), 1000);

const finished = markJobDone(markJobRunning(base, 1400), 1500);
assert.equal(finished.status, 'done');
assert.equal(isTerminalJobStatus('done'), true);
assert.equal(isTerminalJobStatus('cancelled'), true);
assert.equal(isTerminalJobStatus('failed'), true);
assert.equal(isTerminalJobStatus('running'), false);
assert.equal(isTerminalJobStatus('queued'), false);
assert.equal(shouldRetryJob(finished), false, 'a finished job is never retried');
assert.equal(shouldRetryJob(markJobCancelled(base)), false, 'a cancelled job is never retried');

// ---------------------------------------------------------------------------
// Fingerprints: the token-saving rule and the correctness rule in one function.
// ---------------------------------------------------------------------------
const fingerprintArgs = {
  paperId: 'doc:1',
  chunkIds: ['a', 'b'],
  chunkCharacterCounts: [100, 200],
  promptVersion: EXTRACTION_PROMPT_VERSION,
  maxCandidatesPerChunk: 12,
};
const fingerprint = extractionInputFingerprint(fingerprintArgs);
assert.equal(fingerprint, extractionInputFingerprint(fingerprintArgs), 'must be stable');

// Same paper, unchanged chunks: no re-extraction.
const sameJob = { ...base, inputFingerprint: fingerprint, status: 'done' };
assert.equal(isJobComplete(sameJob, fingerprint), true, 'unchanged input must skip extraction');
assert.equal(canResumeJob({ ...sameJob, status: 'done' }, fingerprint), false);

// Re-indexed paper (chunk count changed) must invalidate the cache.
const reindexed = extractionInputFingerprint({
  ...fingerprintArgs,
  chunkIds: ['a', 'b', 'c'],
  chunkCharacterCounts: [100, 200, 300],
});
assert.notEqual(reindexed, fingerprint, 'a re-indexed paper must invalidate');
assert.equal(isJobComplete(sameJob, reindexed), false);

// A changed prompt version must invalidate, because the extracted schema differs.
const newPrompt = extractionInputFingerprint({
  ...fingerprintArgs,
  promptVersion: `${EXTRACTION_PROMPT_VERSION}-next`,
});
assert.notEqual(newPrompt, fingerprint, 'a prompt change must invalidate');

// A changed candidate cap must invalidate: it changes what the run would produce.
const newCap = extractionInputFingerprint({ ...fingerprintArgs, maxCandidatesPerChunk: 20 });
assert.notEqual(newCap, fingerprint, 'a cap change must invalidate');

// Editing a chunk (same ids, different lengths) must invalidate.
const edited = extractionInputFingerprint({
  ...fingerprintArgs,
  chunkCharacterCounts: [100, 260],
});
assert.notEqual(edited, fingerprint, 'edited text must invalidate');

// Interrupted work is resumable, and a stale fingerprint is not.
assert.equal(
  canResumeJob({ ...base, inputFingerprint: fingerprint }, fingerprint),
  true,
  'a queued job with matching input resumes',
);
// `base` carries fingerprint 'fp-1', so it must NOT resume for a different input.
assert.equal(
  canResumeJob(base, fingerprint),
  false,
  'a job recorded against other input must not be reused',
);
assert.equal(canResumeJob({ ...base, inputFingerprint: 'stale' }, fingerprint), false);
assert.equal(canResumeJob(null, fingerprint), false);
assert.equal(canResumeJob(undefined, fingerprint), false);

// ---------------------------------------------------------------------------
// Cursor arithmetic. The cursor is in BATCH units so it maps 1:1 onto the plan.
// ---------------------------------------------------------------------------
assert.deepEqual(cursorFromProgress('entity-extraction', { index: 3 }), { batchIndex: 3 });
assert.deepEqual(cursorFromProgress('relation-judgement', { index: 2 }), { pairIndex: 2 });
assert.deepEqual(cursorFromProgress('entity-alignment', { index: 1 }), { alignmentIndex: 1 });
assert.deepEqual(cursorFromProgress('entity-extraction', { index: -5 }), { batchIndex: 0 });
assert.deepEqual(cursorFromProgress('entity-extraction', { index: 2.7 }), { batchIndex: 2 });

assert.equal(jobProgressOf({ cursor: { batchIndex: 4 } }, 'entity-extraction'), 4);
assert.equal(jobProgressOf({ cursor: null }, 'entity-extraction'), 0);
assert.equal(jobProgressOf({ cursor: { pairIndex: 7 } }, 'relation-judgement'), 7);
assert.equal(jobProgressOf({ cursor: { alignmentIndex: 2 } }, 'entity-alignment'), 2);

// Resuming from batch 2 of 5 leaves 3 to go; never negative.
assert.equal(remainingBatches(0, 5), 5);
assert.equal(remainingBatches(2, 5), 3);
assert.equal(remainingBatches(5, 5), 0);
assert.equal(remainingBatches(9, 5), 0, 'an over-run cursor must not go negative');

console.log('Entity extraction pipeline contract tests passed.');
