import assert from 'node:assert/strict';

import {
  describeRelationResult,
  previewRelationAnalysis,
  runRelationAnalysis,
} from '../src/modules/knowledge-graph/application/relation-runner.ts';

function paper(paperId, overrides = {}) {
  return {
    paperId,
    documentAgentId: paperId,
    fingerprint: `fp-${paperId}`,
    title: `Paper ${paperId}`,
    year: 2020,
    authors: [],
    venue: '',
    doi: '',
    abstract: `Abstract of ${paperId}`,
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

function paperEntityEdge(paperId, entityId) {
  return {
    edgeId: `e-${paperId}-${entityId}`,
    source: paperId,
    sourceKind: 'paper',
    target: entityId,
    targetKind: 'entity',
    type: 'MENTIONS',
    confidence: 0.9,
    evidence: [],
    sourcePaperId: paperId,
    origin: 'ai',
    originKey: `MENTIONS|${paperId}|${entityId}`,
    provenance: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function createPorts(seed = {}) {
  const state = {
    edges: seed.edges ?? [],
    requests: [],
    applied: [],
    response: seed.response ?? { ok: true, content: '{"relations":[]}' },
  };
  return {
    state,
    async requestJudgement(message) {
      state.requests.push(message);
      return typeof state.response === 'function' ? state.response(message) : state.response;
    },
    async listEdges() {
      return [...state.edges];
    },
    async applyRelationPlan(plan) {
      state.applied.push(plan);
      const dropped = new Set(plan.dropOriginKeys);
      state.edges = state.edges.filter((edge) => !dropped.has(edge.originKey));
      for (const edge of plan.edges) {
        if (!state.edges.some((existing) => existing.originKey === edge.originKey)) {
          state.edges.push(edge);
        }
      }
      return plan.edges.length;
    },
  };
}

const papers = [paper('p1'), paper('p2'), paper('p3')];
const sharedEntityEdges = [
  paperEntityEdge('p1', 'entity:x'),
  paperEntityEdge('p2', 'entity:x'),
];

// ---------------------------------------------------------------------------
// The price is quoted before anything is sent. This is the only feature that
// spends tokens without the user typing a message.
// ---------------------------------------------------------------------------
const previewPorts = createPorts({ edges: sharedEntityEdges });
const preview = await previewRelationAnalysis(papers, previewPorts, {
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.ok(preview.candidates.length >= 1);
assert.ok(preview.selected.length >= 1);
assert.ok(preview.estimatedTokens > 0, 'a non-empty selection must quote a price');
assert.equal(previewPorts.state.requests.length, 0, 'previewing must not send anything');

// Top-K caps the paid selection independently of the free recall budget.
const manyRecall = await previewRelationAnalysis(
  [paper('a'), paper('b'), paper('c'), paper('d')],
  createPorts({
    edges: [
      paperEntityEdge('a', 'entity:x'), paperEntityEdge('b', 'entity:x'),
      paperEntityEdge('c', 'entity:x'), paperEntityEdge('d', 'entity:x'),
    ],
  }),
  { topK: 2, maxCandidates: 40, entityNames: new Map([['entity:x', 'X']]) },
);
assert.equal(manyRecall.selected.length, 2, 'Top-K bounds the paid stage');
assert.ok(manyRecall.candidates.length > manyRecall.selected.length);
assert.ok(
  manyRecall.estimatedTokens <
    (await previewRelationAnalysis(
      [paper('a'), paper('b'), paper('c'), paper('d')],
      createPorts({
        edges: [
          paperEntityEdge('a', 'entity:x'), paperEntityEdge('b', 'entity:x'),
          paperEntityEdge('c', 'entity:x'), paperEntityEdge('d', 'entity:x'),
        ],
      }),
      { topK: 6, maxCandidates: 40, entityNames: new Map([['entity:x', 'X']]) },
    )).estimatedTokens,
  'a smaller Top-K must quote a smaller price',
);

// ---------------------------------------------------------------------------
// Refusing at the preview stage must spend nothing.
// ---------------------------------------------------------------------------
const declinedPorts = createPorts({ edges: sharedEntityEdges });
const declined = await runRelationAnalysis(declinedPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
  onPreview: async () => false,
});
assert.equal(declined.status, 'cancelled');
assert.equal(declinedPorts.state.requests.length, 0, 'declining must send nothing');
assert.equal(declined.edgesWritten, 0);
assert.match(describeRelationResult(declined), /取消/);

// ---------------------------------------------------------------------------
// A happy run: recall -> judge -> persist, with the plan applied rather than the
// edges written directly.
// ---------------------------------------------------------------------------
const happyPorts = createPorts({
  edges: sharedEntityEdges,
  response: {
    ok: true,
    content: JSON.stringify({
      relations: [
        { pairKey: 'p1|p2', relation: 'EXTENDS', confidence: 0.9, evidence: 'q' },
      ],
    }),
  },
});
const previews = [];
const happy = await runRelationAnalysis(happyPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
  onPreview: async (value) => {
    previews.push(value);
    return true;
  },
});
assert.equal(happy.status, 'done');
assert.equal(previews.length, 1, 'the caller sees the estimate exactly once');
assert.equal(happyPorts.state.requests.length, 1);
assert.equal(happy.relationsFound, 1);
assert.equal(happy.edgesWritten, 1);
assert.equal(happyPorts.state.applied.length, 1, 'writes go through the plan, not direct stores');

const request = happyPorts.state.requests[0];
assert.equal(request.type, 'pdf-helper:ai-judge-relations');
assert.ok(request.pairs.length >= 1);
assert.equal(request.pairs[0].pairKey, 'p1|p2');
// The model gets the recall context, so it can justify its verdict.
assert.ok(Array.isArray(request.pairs[0].sharedEntities));

// ---------------------------------------------------------------------------
// The token-saving path: when the cache already answers everything, the run
// reports that for free instead of making a pointless call.
// ---------------------------------------------------------------------------
const cachedEdge = {
  edgeId: 'cached', source: 'p1', sourceKind: 'paper', target: 'p2', targetKind: 'paper',
  type: 'EXTENDS', confidence: 0.9, evidence: [], sourcePaperId: 'p1',
  origin: 'ai', originKey: 'EXTENDS|p1|p2', provenance: {}, createdAt: 1, updatedAt: 1,
};
const cachedPorts = createPorts({ edges: [...sharedEntityEdges, cachedEdge] });
const cached = await runRelationAnalysis(cachedPorts, {
  papers: [paper('p1'), paper('p2')],
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(cached.status, 'nothing-to-do');
assert.equal(cachedPorts.state.requests.length, 0, 'a fully cached corpus must send nothing');
assert.match(cached.reason, /缓存/, 'and must say the cache is why');

// A recorded NEGATIVE verdict is also a cache hit: otherwise the user pays for
// the same "nothing here" answer on every run.
const negativeCached = createPorts({
  edges: [
    ...sharedEntityEdges,
    { ...cachedEdge, type: 'NO_RELATION', originKey: 'NO_RELATION|p1|p2', confidence: 0 },
  ],
});
const negativeResult = await runRelationAnalysis(negativeCached, {
  papers: [paper('p1'), paper('p2')],
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(negativeResult.status, 'nothing-to-do');
assert.equal(negativeCached.state.requests.length, 0);

// A corpus with no recall signal at all is also free, but the reason is different
// and the message must distinguish them.
const barren = await runRelationAnalysis(createPorts(), {
  papers: [paper('p1', { year: 2000 }), paper('p2', { year: 2020 })],
  topK: 5,
  maxCandidates: 40,
});
assert.equal(barren.status, 'nothing-to-do');
assert.match(barren.reason, /召回/, 'no-signal and all-cached are different situations');

// One paper cannot have a relationship with itself.
const single = await runRelationAnalysis(createPorts(), { papers: [paper('p1')], topK: 5, maxCandidates: 40 });
assert.equal(single.status, 'nothing-to-do');
assert.match(single.reason, /两篇/);

// ---------------------------------------------------------------------------
// Partial responses: answered pairs are kept, unanswered ones are reported and
// NOT cached.
// ---------------------------------------------------------------------------
const partialPorts = createPorts({
  edges: [
    paperEntityEdge('p1', 'entity:x'),
    paperEntityEdge('p2', 'entity:x'),
    paperEntityEdge('p3', 'entity:x'),
  ],
  response: {
    ok: true,
    content: JSON.stringify({
      relations: [{ pairKey: 'p1|p2', relation: 'EXTENDS', confidence: 0.8 }],
    }),
  },
});
const partialResult = await runRelationAnalysis(partialPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(partialResult.status, 'done');
assert.equal(partialResult.relationsFound, 1);
assert.ok(partialResult.unansweredPairs > 0, 'unanswered pairs must be reported');
assert.match(
  describeRelationResult(partialResult),
  /未作答/,
  'the status line must say that some pairs will be retried',
);
// Only the answered pair produced an edge; the unanswered ones wrote nothing, so
// a retry will legitimately ask again.
assert.equal(partialPorts.state.applied[0].edges.length, 1);

// ---------------------------------------------------------------------------
// Failures are reported, not swallowed.
// ---------------------------------------------------------------------------
const failingPorts = createPorts({
  edges: sharedEntityEdges,
  response: { ok: false, error: 'provider exploded' },
});
const failed = await runRelationAnalysis(failingPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(failed.status, 'failed');
assert.equal(failed.reason, 'provider exploded');
assert.equal(failingPorts.state.applied.length, 0, 'a failed request writes nothing');

// A batch-level failure inside an otherwise ok response is surfaced in the count.
const batchFailPorts = createPorts({
  edges: sharedEntityEdges,
  response: {
    ok: true,
    content: '{"relations":[]}',
    relationJudgement: { batchCount: 2, failedBatches: [{ pairKeys: ['p1|p3'], error: 'timeout' }] },
  },
});
const batchFailed = await runRelationAnalysis(batchFailPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(batchFailed.failedBatches, 1);
assert.match(describeRelationResult(batchFailed), /批失败/);

// An unreadable answer must not be treated as "no relationships": nothing is
// cached, and every pair is reported unanswered so a retry re-asks.
const garbagePorts = createPorts({
  edges: sharedEntityEdges,
  response: { ok: true, content: 'not json at all' },
});
const garbage = await runRelationAnalysis(garbagePorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(garbage.judgedPairs, 0);
assert.ok(garbage.unansweredPairs > 0);
assert.equal(garbagePorts.state.applied[0].edges.length, 0, 'garbage caches nothing');

// ---------------------------------------------------------------------------
// The review step. A written conclusion is also the cache — the pair is never
// asked about again — so a verdict the user has not seen would make the model's
// mistakes permanent, and the negative verdicts do not even draw on the canvas.
// ---------------------------------------------------------------------------
const threeWayEdges = [
  paperEntityEdge('p1', 'entity:x'),
  paperEntityEdge('p2', 'entity:x'),
  paperEntityEdge('p3', 'entity:x'),
];
const threeWayResponse = {
  ok: true,
  content: JSON.stringify({
    relations: [
      { pairKey: 'p1|p2', relation: 'EXTENDS', confidence: 0.9, evidence: 'q12', rationale: 'r12' },
      { pairKey: 'p1|p3', relation: 'CITES', confidence: 0.7, evidence: 'q13', rationale: 'r13' },
      { pairKey: 'p2|p3', relation: 'NONE', confidence: 0.2, rationale: 'r23' },
    ],
  }),
};
const runWithReview = (decision, seed = threeWayResponse) => {
  const ports = createPorts({ edges: threeWayEdges, response: seed });
  const reviews = [];
  return {
    ports,
    reviews,
    run: (options = {}) => runRelationAnalysis(ports, {
      papers,
      topK: 5,
      maxCandidates: 40,
      entityNames: new Map([['entity:x', 'X']]),
      onJudged: async (review) => {
        reviews.push(review);
        return typeof decision === 'function' ? decision(review) : decision;
      },
      ...options,
    }),
  };
};

// The review sees every verdict with the material needed to judge it, positives
// first (the user is looking for relationships, not for confirmations of absence).
const subset = runWithReview(new Set(['p1|p2']));
const subsetResult = await subset.run();
assert.equal(subset.reviews.length, 1, 'the review happens exactly once, before writing');
const rows = subset.reviews[0].rows;
assert.deepEqual(
  rows.map((row) => row.pairKey),
  ['p1|p2', 'p1|p3', 'p2|p3'],
  'positives are ordered by confidence, then the negative verdicts',
);
assert.deepEqual(rows.map((row) => row.verdict), ['EXTENDS', 'CITES', 'NONE']);
assert.equal(rows[0].evidenceQuote, 'q12', 'the evidence travels with the verdict');
assert.equal(rows[0].rationale, 'r12');
assert.equal(subset.reviews[0].rejectedCount, 0);

assert.equal(subsetResult.status, 'done');
assert.equal(subsetResult.judgedPairs, 1, 'only the accepted verdict counts as judged');
assert.equal(subsetResult.relationsFound, 1);
assert.equal(subsetResult.negativeVerdicts, 0);
assert.equal(subsetResult.discardedPairs, 2);
assert.equal(subsetResult.edgesWritten, 1);
assert.equal(subset.ports.state.applied.length, 1);
assert.equal(subset.ports.state.applied[0].edges.length, 1);
// The declining half is the point: a rejected pair keeps whatever conclusion it
// already had and is left out of the plan entirely, so it is not cached and will be
// asked about again.
assert.ok(
  !subset.ports.state.applied[0].dropOriginKeys.some(
    (key) => key.includes('p1|p3') || key.includes('p2|p3'),
  ),
  'a discarded pair must not have its previous conclusion retired',
);
assert.match(describeRelationResult(subsetResult), /未写入/);

// Accepting everything writes every verdict, including the negative one that
// exists only to make the next run free.
const acceptAll = runWithReview('accept-all');
const acceptAllResult = await acceptAll.run();
assert.equal(acceptAllResult.judgedPairs, 3);
assert.equal(acceptAllResult.relationsFound, 2);
assert.equal(acceptAllResult.negativeVerdicts, 1);
assert.equal(acceptAllResult.discardedPairs, 0);
assert.equal(acceptAll.ports.state.applied[0].edges.length, 3);
assert.equal(
  acceptAll.ports.state.applied[0].edges.find((edge) => edge.type === 'NO_RELATION').confidence,
  0,
  'a negative verdict is cached with confidence 0 so it stays out of the drawn graph',
);

// Dismissing the review declines the whole batch — including the negatives, because
// caching "no relationship" the user never saw is still claiming something on their
// behalf. Nothing is written and no write call is even made.
const dismissed = runWithReview(null);
const dismissedResult = await dismissed.run();
assert.equal(dismissedResult.status, 'discarded');
assert.equal(dismissedResult.edgesWritten, 0);
assert.equal(dismissedResult.discardedPairs, 3);
assert.equal(dismissed.ports.state.applied.length, 0, 'declining must not touch the store');
assert.match(describeRelationResult(dismissedResult), /放弃写入/);
assert.match(describeRelationResult(dismissedResult), /会重新判断/);

// A run whose verdicts were never produced — every batch failed — must NOT be
// reported as a declined write. The distinction is who is responsible: "you chose
// not to write these" and "the provider returned nothing" are different messages,
// and the wrong one sends the user looking for a decision they never made.
const allBatchesFailed = runWithReview('accept-all', {
  ok: true,
  content: '{"relations":[]}',
  relationJudgement: { batchCount: 2, failedBatches: [{ pairKeys: ['p1|p2'], error: 'timeout' }] },
});
const allBatchesFailedResult = await allBatchesFailed.run();
assert.equal(allBatchesFailedResult.status, 'done');
assert.equal(allBatchesFailedResult.discardedPairs, 0);
assert.equal(allBatchesFailedResult.failedBatches, 1);
assert.match(describeRelationResult(allBatchesFailedResult), /批失败/);
assert.doesNotMatch(describeRelationResult(allBatchesFailedResult), /放弃写入/);

// An empty selection is the same outcome as dismissing, reached by unticking
// everything rather than by closing the dialog.
const emptySelection = runWithReview(new Set());
const emptySelectionResult = await emptySelection.run();
assert.equal(emptySelectionResult.status, 'discarded');
assert.equal(emptySelection.ports.state.applied.length, 0);

// A hook is offered the model name (so the review can name what produced the
// verdicts) and the count of unreadable verdicts (so the numbers add up).
const withRejects = runWithReview('accept-all', {
  ok: true,
  content: JSON.stringify({
    relations: [
      { pairKey: 'p1|p2', relation: 'EXTENDS', confidence: 0.9, evidence: 'q' },
      { pairKey: 'p1|p3', relation: 'NOT_A_RELATION', confidence: 0.5 },
    ],
  }),
  model: 'deepseek-chat',
});
await withRejects.run();
assert.equal(withRejects.reviews[0].rejectedCount, 1, 'unparseable verdicts are reported to the review');
assert.equal(
  withRejects.reviews[0].model,
  'deepseek-chat',
  'the review can say which model produced the verdicts',
);

// The review must not change how unanswered pairs are treated: they were never
// judged, so they are neither shown nor cached, and a retry re-asks them.
const partialReview = runWithReview('accept-all', {
  ok: true,
  content: JSON.stringify({
    relations: [{ pairKey: 'p1|p2', relation: 'EXTENDS', confidence: 0.9 }],
  }),
});
const partialReviewResult = await partialReview.run();
assert.equal(partialReview.reviews[0].rows.length, 1, 'only answered pairs are reviewable');
assert.ok(partialReviewResult.unansweredPairs > 0);
assert.equal(partialReview.ports.state.applied[0].edges.length, 1);

// Without the hook the run behaves exactly as before: parsing is the decision.
// (This is what keeps the hook from silently becoming a gate on every caller.)
const noHookPorts = createPorts({ edges: threeWayEdges, response: threeWayResponse });
const noHook = await runRelationAnalysis(noHookPorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  entityNames: new Map([['entity:x', 'X']]),
});
assert.equal(noHook.status, 'done');
assert.equal(noHook.judgedPairs, 3);
assert.equal(noHook.discardedPairs, 0);

// ---------------------------------------------------------------------------
// 重新判断: an explicit per-pair request must beat the cache.
//
// A stored conclusion is also the cache, so without this the same pair could never
// be asked about again and a wrong verdict would be permanent. The forced run must
// judge exactly the requested pair — not the whole candidate set the user did not
// ask for — and must replace the old conclusion rather than adding to it.
// ---------------------------------------------------------------------------
const forcedPorts = createPorts({
  edges: [
    ...threeWayEdges,
    { ...cachedEdge, type: 'EXTENDS', originKey: 'EXTENDS|p1|p2', confidence: 0.9 },
  ],
  response: {
    ok: true,
    content: JSON.stringify({
      relations: [{ pairKey: 'p1|p2', relation: 'COMPARES_WITH', confidence: 0.8 }],
    }),
  },
});
const forcedPreview = await previewRelationAnalysis(
  [paper('p1'), paper('p2')],
  forcedPorts,
  { topK: 5, maxCandidates: 40, forcePairs: new Set(['p1|p2']) },
);
assert.deepEqual(
  forcedPreview.selected.map((pair) => pair.pairKey),
  ['p1|p2'],
  'a cached pair is selected again only because it was explicitly forced',
);
assert.ok(
  forcedPreview.selected[0].recallReasons.includes('你要求重新判断'),
  'the request tells the model why a judged pair is being asked about again',
);
assert.equal(forcedPreview.skippedAlreadyJudged, false);

const forcedResult = await runRelationAnalysis(forcedPorts, {
  papers: [paper('p1'), paper('p2')],
  topK: 5,
  maxCandidates: 40,
  forcePairs: new Set(['p1|p2']),
});
assert.equal(forcedResult.status, 'done');
assert.equal(forcedPorts.state.requests.length, 1, 'the forced pair is actually asked about');
assert.equal(forcedPorts.state.requests[0].pairs.length, 1);
assert.ok(
  forcedPorts.state.applied[0].dropOriginKeys.includes('EXTENDS|p1|p2'),
  'the previous conclusion is retired, not kept beside the new one',
);
assert.equal(forcedPorts.state.applied[0].edges[0].type, 'COMPARES_WITH');

// Forcing one pair must not open the gate for the rest: the other pairs in the
// corpus stay cached and are never sent.
const forcedScopePorts = createPorts({
  edges: [
    ...threeWayEdges,
    { ...cachedEdge, type: 'CITES', originKey: 'CITES|p1|p3', confidence: 0.7 },
  ],
  response: { ok: true, content: JSON.stringify({ relations: [] }) },
});
await runRelationAnalysis(forcedScopePorts, {
  papers,
  topK: 5,
  maxCandidates: 40,
  forcePairs: new Set(['p1|p2']),
});
assert.deepEqual(
  forcedScopePorts.state.requests[0].pairs.map((pair) => pair.pairKey),
  ['p1|p2'],
  'only the forced pair is sent, even when other pairs are recallable',
);

// ---------------------------------------------------------------------------
// An empty recall explains itself when the graph still holds unconfirmed entities.
//
// Shared entities are the strongest recall signal and only confirmed ones count, so
// a corpus full of pending candidates recalls nothing. Without the hint the user has
// no next step, and the message reads as if the papers were simply unrelated.
// ---------------------------------------------------------------------------
const pendingHint = await runRelationAnalysis(createPorts(), {
  papers: [paper('p1', { year: 2000 }), paper('p2', { year: 2020 })],
  topK: 5,
  maxCandidates: 40,
  pendingEntityCount: 7,
});
assert.equal(pendingHint.status, 'nothing-to-do');
assert.match(pendingHint.reason, /召回/, 'the original cause is still stated');
assert.match(pendingHint.reason, /未确认的实体/, 'and the next step is named');

const noPendingHint = await runRelationAnalysis(createPorts(), {
  papers: [paper('p1', { year: 2000 }), paper('p2', { year: 2020 })],
  topK: 5,
  maxCandidates: 40,
  pendingEntityCount: 0,
});
assert.doesNotMatch(
  noPendingHint.reason,
  /未确认的实体/,
  'with nothing pending there is no advice to give',
);

console.log('Relation runner contract tests passed.');
