import assert from 'node:assert/strict';

import {
  buildSelectedCandidatePairs,
  collectJudgedPairKeys,
  cosineSimilarity,
  estimateJudgementTokens,
  recallCandidatePairs,
  relationPairKey,
  selectTopKForJudgement,
  MAX_SELECTED_PAPERS,
} from '../src/modules/knowledge-graph/application/relation-recall.ts';
import {
  buildJudgementReviewRows,
  buildRelationJudgementPrompt,
  filterAcceptedJudgements,
  parseRelationJudgements,
  planRelationJudgementWrites,
  RELATION_PROMPT_VERSION,
} from '../src/modules/knowledge-graph/application/relation-judgement.ts';
import {
  nameSupportedByQuotes,
  parseBridgeSuggestions,
  quoteAppearsIn,
  MAX_BRIDGES_PER_PAIR,
} from '../src/modules/knowledge-graph/application/relation-bridges.ts';
import {
  planBridgeEntityWrites,
  planManualBridgeWrites,
} from '../src/modules/knowledge-graph/application/bridge-entities.ts';
import { normalizeEntityName } from '../src/modules/knowledge-graph/domain/entity-normalization.ts';

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

function paperEntityEdge(paperId, entityId, overrides = {}) {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The funnel. Its whole purpose is to bound cost, so the bound is what is tested
// first.
// ---------------------------------------------------------------------------
const papers = [
  paper('p1', { abstract: 'Sparse attention for long sequences.' }),
  paper('p2', { abstract: 'Sparse attention revisited.' }),
  paper('p3', { abstract: 'A survey of databases.' }),
  paper('p4', { abstract: 'Attention for vision.' }),
];
const edges = [
  // p1 and p2 share a confirmed entity.
  paperEntityEdge('p1', 'entity:attention'),
  paperEntityEdge('p2', 'entity:attention'),
  paperEntityEdge('p4', 'entity:attention'),
];

const recalled = recallCandidatePairs(papers, edges, {
  entityNames: new Map([['entity:attention', 'Attention']]),
});
// Every pair sharing the entity should be recalled; the unrelated pair should not.
const recalledKeys = recalled.map((pair) => pair.pairKey);
assert.ok(recalledKeys.includes(relationPairKey('p1', 'p2')));
assert.ok(recalledKeys.includes(relationPairKey('p1', 'p4')));
assert.ok(recalledKeys.includes(relationPairKey('p2', 'p4')));
assert.ok(
  !recalledKeys.includes(relationPairKey('p1', 'p3')),
  'a pair with no signal is not worth a model call',
);

// Shared-entity pairs outrank everything else.
assert.ok(recalled[0].recallScore >= 3);
const sharedPair = recalled.find((pair) => pair.pairKey === relationPairKey('p1', 'p2'));
assert.deepEqual(sharedPair.sharedEntityNames, ['Attention']);
assert.ok(sharedPair.recallReasons.some((reason) => reason.includes('共享')));

// The hard cap: this is what makes the LLM stage independent of corpus size.
const capped = recallCandidatePairs(papers, edges, { maxCandidates: 1 });
assert.equal(capped.length, 1);
assert.equal(
  recallCandidatePairs(papers, edges, { maxCandidates: 0 }).length,
  0,
  'a zero budget recalls nothing',
);

// ---------------------------------------------------------------------------
// Cache awareness: an already-judged pair must never be re-sent. This is the
// token-saving guarantee.
// ---------------------------------------------------------------------------
const judgedEdge = {
  edgeId: 'judged', source: 'p1', sourceKind: 'paper', target: 'p2', targetKind: 'paper',
  type: 'EXTENDS', confidence: 0.8, evidence: [], sourcePaperId: 'p1',
  origin: 'ai', originKey: 'EXTENDS|p1|p2', provenance: {}, createdAt: 1, updatedAt: 1,
};
assert.ok(collectJudgedPairKeys([judgedEdge]).has(relationPairKey('p1', 'p2')));

const afterJudgement = recallCandidatePairs(papers, [...edges, judgedEdge], {
  entityNames: new Map([['entity:attention', 'Attention']]),
});
assert.ok(
  !afterJudgement.some((pair) => pair.pairKey === relationPairKey('p1', 'p2')),
  'a judged pair must be skipped',
);

// A shared-entity link is NOT a judged relationship: it is the very signal that
// motivates asking, so treating it as judged would suppress the useful pairs.
assert.equal(collectJudgedPairKeys(edges).size, 0, 'shared-entity edges are not judgements');
// Personal and rule edges are not judgements either.
assert.equal(
  collectJudgedPairKeys([
    { ...judgedEdge, type: 'HAS_KEYWORD', origin: 'rule' },
    { ...judgedEdge, type: 'SIMILAR_TO', origin: 'user', targetKind: 'paper' },
  ]).size,
  1,
  'SIMILAR_TO is a paper-paper type, so it counts; HAS_KEYWORD does not',
);

// ---------------------------------------------------------------------------
// Secondary signals.
// ---------------------------------------------------------------------------
const filed = [
  // Explicitly different years so this exercises the folder signal alone.
  paper('p1', { folderId: 'f1', year: 2010 }),
  paper('p2', { folderId: 'f1', year: 2020 }),
];
const filedPairs = recallCandidatePairs(filed, []);
assert.equal(filedPairs.length, 1);
assert.equal(filedPairs[0].recallScore, 1.5, 'folder alone scores 1.5');
assert.ok(filedPairs[0].recallReasons.includes('同一文件夹'));
assert.equal(filedPairs[0].yearGap, 10);

// Year proximity: within two years contributes, further apart does not. Note that
// a year-only match (score 1) is still below the default threshold, because equal
// publication years are far too common to justify a paid call on their own.
assert.equal(
  recallCandidatePairs([paper('a', { year: 2020 }), paper('b', { year: 2021 })], [], {
    minScore: 1,
  }).length,
  1,
  'the signal exists when the threshold is lowered',
);
assert.equal(
  recallCandidatePairs([paper('a', { year: 2020 }), paper('b', { year: 2021 })], []).length,
  0,
  'year proximity alone must not clear the default threshold',
);
assert.equal(
  recallCandidatePairs([paper('a', { year: 2000 }), paper('b', { year: 2020 })], []).length,
  0,
);
// An unknown year on either side must not be treated as "same year".
assert.equal(
  recallCandidatePairs([paper('a', { year: null }), paper('b', { year: null })], []).length,
  0,
);
// A weaker signal combined with year proximity does clear it.
assert.equal(
  recallCandidatePairs([
    paper('a', { year: 2020, venue: 'NeurIPS' }),
    paper('b', { year: 2021, venue: 'NeurIPS' }),
  ], []).length,
  1,
  'same venue plus year proximity is worth asking about',
);

// Vectors are optional: recall must work with embeddings off, which is the default.
const vectors = new Map([
  ['p1', [1, 0, 0]],
  ['p2', [1, 0, 0]],
  ['p3', [0, 1, 0]],
]);
const vectorPairs = recallCandidatePairs(
  [paper('p1'), paper('p2'), paper('p3')],
  [],
  { vectors, vectorThreshold: 0.9 },
);
assert.equal(vectorPairs.length, 1, 'only the near-identical vectors pass the threshold');
assert.equal(vectorPairs[0].pairKey, relationPairKey('p1', 'p2'));
assert.ok(vectorPairs[0].recallReasons.some((reason) => reason.includes('向量')));

// Cosine sanity, including the degenerate cases.
assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
assert.equal(cosineSimilarity([0, 0], [1, 0]), 0, 'a zero vector has no direction');
assert.equal(cosineSimilarity([], []), 0);
// Mismatched lengths compare the common prefix rather than throwing.
assert.equal(cosineSimilarity([1, 0, 5], [1, 0]), 1);

// ---------------------------------------------------------------------------
// Top-K is the paid stage, applied separately from the free recall budget.
// ---------------------------------------------------------------------------
const topTwo = selectTopKForJudgement(recalled, 2);
assert.equal(topTwo.length, 2);
assert.ok(topTwo[0].recallScore >= topTwo[1].recallScore, 'highest score first');
assert.deepEqual(selectTopKForJudgement(recalled, 0), []);
assert.deepEqual(selectTopKForJudgement([], 5), []);

// Determinism: same input, same Top-K. Otherwise a later run would consult the
// cache for a different set than the previous run judged.
const reordered = recallCandidatePairs([...papers].reverse(), edges, {
  entityNames: new Map([['entity:attention', 'Attention']]),
});
assert.deepEqual(
  selectTopKForJudgement(reordered, 3).map((pair) => pair.pairKey).sort(),
  selectTopKForJudgement(recalled, 3).map((pair) => pair.pairKey).sort(),
);

// Token estimate scales with the paid stage, and is reported before spending.
const estimate = estimateJudgementTokens(topTwo);
assert.equal(estimate.pairCount, 2);
assert.ok(estimate.total > 0);
assert.ok(estimate.total < estimateJudgementTokens(recalled).total);

// ---------------------------------------------------------------------------
// Parsing judgements. There is no JSON mode here, so this is the piece most
// likely to corrupt the graph silently.
// ---------------------------------------------------------------------------
const candidatePairs = selectTopKForJudgement(recalled, 2);
const pairA = candidatePairs[0].pairKey;
const pairB = candidatePairs[1].pairKey;

const clean = JSON.stringify({
  relations: [
    { pairKey: pairA, relation: 'EXTENDS', confidence: 0.85, evidence: 'Sparse attention revisited', rationale: '同一方法的后续工作' },
    { pairKey: pairB, relation: 'NONE', evidence: '', rationale: '无实质关系' },
  ],
});
const parsed = parseRelationJudgements(clean, candidatePairs, { now: 500, model: 'test-model' });
assert.equal(parsed.relations.length, 1);
assert.equal(parsed.explicitNone.length, 1);
assert.equal(parsed.unansweredPairKeys.length, 0);
assert.equal(parsed.rejected.length, 0);

const relation = parsed.relations[0];
assert.equal(relation.verdict, 'EXTENDS');
assert.equal(relation.leftPaperId, 'p1');
assert.equal(relation.rightPaperId, 'p2');
assert.ok(relation.edge, 'a real relation produces an edge');
assert.equal(relation.edge.type, 'EXTENDS');
assert.equal(relation.edge.origin, 'ai', 'a judged relation is model output, not a rule');
assert.equal(relation.edge.sourceKind, 'paper');
assert.equal(relation.edge.targetKind, 'paper');
assert.equal(relation.edge.evidence.length, 1);
assert.equal(relation.edge.evidence[0].quote, 'Sparse attention revisited');
assert.equal(relation.edge.provenance.model, 'test-model');
assert.equal(relation.edge.provenance.promptVersion, RELATION_PROMPT_VERSION);
assert.equal(relation.edge.originKey, `EXTENDS|${pairA}`);

// 'NONE' now produces a caching edge rather than nothing: without a record, the
// same pair would be re-sent to the model on every run and the user would keep
// paying for the same negative answer.
assert.ok(parsed.explicitNone[0].edge, 'a negative verdict is recorded, not discarded');
assert.equal(parsed.explicitNone[0].edge.type, 'NO_RELATION');
assert.equal(
  parsed.explicitNone[0].edge.confidence,
  0,
  'a negative verdict carries no confidence, so it stays out of confidence filters',
);
assert.equal(
  parsed.explicitNone[0].edge.evidence.length,
  0,
  'a negative verdict has no quote to cite',
);
assert.equal(parsed.explicitNone[0].edge.originKey, `NO_RELATION|${pairB}`);

// The negative record makes the pair cache-aware, so recall skips it next time.
assert.ok(
  collectJudgedPairKeys([parsed.explicitNone[0].edge]).has(pairB),
  'a recorded negative judgement must count as judged',
);

// ---------------------------------------------------------------------------
// Re-judgement replaces a previous conclusion rather than accumulating
// contradictions between the same two papers.
// ---------------------------------------------------------------------------
// The previous conclusion must be a *different* verdict; an edge with the same
// origin key is the current verdict and must survive unchanged.
const previousEdge = {
  edgeId: 'old', source: 'p1', sourceKind: 'paper', target: 'p2', targetKind: 'paper',
  type: 'COMPARES_WITH', confidence: 0.7, evidence: [], sourcePaperId: 'p1',
  origin: 'ai', originKey: `COMPARES_WITH|${pairA}`, provenance: {}, createdAt: 1, updatedAt: 1,
};
const plan = planRelationJudgementWrites(parsed, [previousEdge]);
assert.ok(
  plan.dropOriginKeys.includes(`COMPARES_WITH|${pairA}`),
  'a superseded conclusion must be retired',
);
assert.equal(
  plan.dropOriginKeys.filter((key) => key === relation.edge.originKey).length,
  0,
  'the edge being written must not be dropped',
);
assert.equal(plan.edges.length, 2, 'one positive verdict plus one negative record');

// Re-judging the SAME verdict must be a no-op for that pair: the idempotency key
// is unchanged, so nothing is retired and the edge keeps its identity.
const sameVerdictPlan = planRelationJudgementWrites(parsed, [{
  ...previousEdge,
  type: 'EXTENDS',
  originKey: relation.edge.originKey,
}]);
assert.deepEqual(
  sameVerdictPlan.dropOriginKeys,
  [],
  'an unchanged verdict has nothing to retire',
);

// Unanswered pairs are absent from the plan, so a truncated response cannot
// overwrite a good conclusion with silence. Verified after `partial` is parsed.

// With nothing previously recorded there is nothing to retire.
const freshPlan = planRelationJudgementWrites(parsed, []);
assert.deepEqual(freshPlan.dropOriginKeys, []);
assert.equal(freshPlan.edges.length, 2);

// Non-conclusion edges are never retired by a judgement: a shared entity or the
// user's own filing is not a conclusion this stage owns.
assert.deepEqual(
  planRelationJudgementWrites(parsed, [
    { ...previousEdge, type: 'MENTIONS', originKey: 'MENTIONS|x' },
    { ...previousEdge, type: 'HAS_KEYWORD', originKey: 'HAS_KEYWORD|x' },
    { ...previousEdge, type: 'IN_FOLDER', originKey: 'IN_FOLDER|x' },
  ]).dropOriginKeys,
  [],
  'entity, keyword and user edges are out of scope for relation judgement',
);

// ---------------------------------------------------------------------------
// THE critical rule: an omitted pair is NOT cached as judged. Treating silence as
// "no relationship" would write a permanent false negative — a truncated response
// would make those pairs un-analysable forever.
// ---------------------------------------------------------------------------
const partial = parseRelationJudgements(
  JSON.stringify({ relations: [{ pairKey: pairA, relation: 'EXTENDS', confidence: 0.8 }] }),
  candidatePairs,
);
assert.equal(partial.relations.length, 1);
assert.deepEqual(
  partial.unansweredPairKeys,
  [pairB],
  'a pair the model never mentioned must be reported as unanswered',
);
assert.equal(partial.explicitNone.length, 0, 'omission is not an explicit NONE');

// The plan for a truncated response touches only the answered pair, so silence
// cannot retire a previously good conclusion.
const partialPlan = planRelationJudgementWrites(partial, [previousEdge]);
assert.equal(partialPlan.edges.length, 1);
assert.deepEqual(
  partialPlan.dropOriginKeys,
  [`COMPARES_WITH|${pairA}`],
  'only the answered pair is touched by a partial response',
);

// An unreadable response leaves every pair unanswered, so nothing is cached.
for (const garbage of ['', 'not json', '{', 'null', '{"relations":"nope"}']) {
  const result = parseRelationJudgements(garbage, candidatePairs);
  assert.equal(result.relations.length, 0);
  assert.equal(result.explicitNone.length, 0, `"${garbage}" must cache nothing`);
  assert.equal(result.unansweredPairKeys.length, candidatePairs.length);
}

// ---------------------------------------------------------------------------
// Hostile output: invented pairs, unknown types, duplicates, bad numbers.
// ---------------------------------------------------------------------------
const hostile = JSON.stringify({
  relations: [
    { pairKey: 'p9|p8', relation: 'EXTENDS', confidence: 0.9 },
    { pairKey: pairA, relation: 'INVENTED', confidence: 0.9 },
    { pairKey: pairA, relation: 'IMPROVES', confidence: 0.7 },
    { pairKey: pairA, relation: 'IMPROVES', confidence: 0.6 },
    'a bare string',
    { pairKey: pairB, relation: 'CITES', confidence: 95, evidence: 'q' },
  ],
});
const hostileResult = parseRelationJudgements(hostile, candidatePairs);
assert.equal(
  hostileResult.relations.length,
  2,
  'the invented-pair row, the unknown type, and the duplicate are all rejected',
);
assert.equal(hostileResult.relations[0].edge.type, 'IMPROVES');
assert.equal(hostileResult.relations[1].confidence, 0.95, 'a percentage is normalised');
assert.ok(
  hostileResult.rejected.some((entry) => entry.reason.includes('未知的 pairKey')),
  'an invented pair must be rejected with a reason',
);
assert.ok(hostileResult.rejected.some((entry) => entry.reason.includes('未知的关系类型')));
assert.ok(hostileResult.rejected.some((entry) => entry.reason.includes('重复')));
// Every pair still gets an answer, so nothing is silently dropped from the run.
assert.deepEqual(hostileResult.unansweredPairKeys, []);

// Fenced JSON and prose around it, both of which models emit routinely.
assert.equal(
  parseRelationJudgements(
    `\`\`\`json\n${JSON.stringify({ relations: [{ pairKey: pairA, relation: 'CITES' }] })}\n\`\`\``,
    candidatePairs,
  ).relations.length,
  1,
);
assert.equal(
  parseRelationJudgements(
    `Sure!\n${JSON.stringify({ relations: [{ pairKey: pairA, relation: 'CITES' }] })}\nDone.`,
    candidatePairs,
  ).relations.length,
  1,
);

// A bare array payload is accepted too.
assert.equal(
  parseRelationJudgements(
    JSON.stringify([{ pairKey: pairA, relation: 'CITES' }]),
    candidatePairs,
  ).relations.length,
  1,
);

// Evidence is capped and truncated so a chatty model cannot bloat the store.
const verbose = parseRelationJudgements(
  JSON.stringify({
    relations: [{
      pairKey: pairA, relation: 'EXTENDS', confidence: 0.8,
      evidence: 'x'.repeat(500), rationale: 'y'.repeat(200),
    }],
  }),
  candidatePairs,
);
assert.ok(verbose.relations[0].edge.evidence[0].quote.length <= 200);
assert.ok(verbose.relations[0].rationale.length <= 60);

// An empty candidate list yields an empty result rather than throwing.
const emptyParse = parseRelationJudgements('{"relations":[]}', []);
assert.deepEqual(emptyParse.relations, []);
assert.deepEqual(emptyParse.unansweredPairKeys, []);

// The prompt must constrain the model in the ways the parser relies on.
const prompt = buildRelationJudgementPrompt();
assert.ok(prompt.includes('NONE'), 'the prompt must offer an explicit NONE verdict');
assert.ok(prompt.includes('只输出 JSON'));
assert.ok(prompt.includes('pairKey'), 'the prompt must define the key the parser matches on');
for (const type of ['CITES', 'EXTENDS', 'IMPROVES', 'COMPARES_WITH', 'SIMILAR_TO']) {
  assert.ok(prompt.includes(type), `the prompt must define ${type}`);
}

// ---------------------------------------------------------------------------
// The review step's pure half.
//
// Accepting a subset is the branch where a mistake quietly persists a claim the
// user rejected, so the filtering rules are pinned here rather than only through
// the runner.
// ---------------------------------------------------------------------------
const reviewSource = parseRelationJudgements(
  JSON.stringify({
    relations: [
      { pairKey: pairB, relation: 'CITES', confidence: 0.7, evidence: 'q-b', rationale: 'r-b' },
      { pairKey: pairA, relation: 'EXTENDS', confidence: 0.9, evidence: 'q-a', rationale: 'r-a' },
    ],
  }),
  candidatePairs,
);
const reviewRows = buildJudgementReviewRows(reviewSource);
assert.deepEqual(
  reviewRows.map((row) => row.pairKey),
  [pairA, pairB],
  'rows are ordered by confidence, not by the order the model happened to answer',
);
assert.equal(reviewRows[0].evidenceQuote, 'q-a');
assert.equal(reviewRows[0].rationale, 'r-a');
assert.equal(reviewRows[0].verdict, 'EXTENDS');
assert.equal(reviewRows[0].confidence, 0.9);
// The row carries the endpoints, so a UI can name the papers rather than the key.
assert.ok(reviewRows[0].leftPaperId && reviewRows[0].rightPaperId);

// Deterministic order matters: a review list that reshuffles between openings makes
// the user re-read it every time.
assert.deepEqual(
  buildJudgementReviewRows(reviewSource).map((row) => row.pairKey),
  reviewRows.map((row) => row.pairKey),
);

const accepted = filterAcceptedJudgements(reviewSource, new Set([pairA]));
assert.deepEqual(accepted.parsed.relations.map((row) => row.pairKey), [pairA]);
assert.deepEqual(accepted.discardedPairKeys, [pairB]);
// The plan built from a filtered result must not touch the rejected pair, so its
// previous conclusion survives and it stays un-cached for a later run. The edge has
// to sit on the *rejected* pair's endpoints for that to mean anything.
const filteredPlan = planRelationJudgementWrites(accepted.parsed, [{
  ...previousEdge,
  source: candidatePairs[1].leftPaperId,
  target: candidatePairs[1].rightPaperId,
  originKey: `COMPARES_WITH|${pairB}`,
}]);
assert.equal(filteredPlan.edges.length, 1);
assert.deepEqual(
  filteredPlan.dropOriginKeys,
  [],
  'a rejected pair keeps whatever conclusion it already had',
);
// And the counter-case, so the assertion above is not vacuous: the same edge on the
// accepted pair *is* retired.
assert.deepEqual(
  planRelationJudgementWrites(accepted.parsed, [previousEdge]).dropOriginKeys,
  [`COMPARES_WITH|${pairA}`],
  'an accepted pair replaces its previous conclusion',
);

// Rejecting everything is an empty write plan rather than a deletion.
const rejectedAll = filterAcceptedJudgements(reviewSource, new Set());
assert.equal(rejectedAll.parsed.relations.length, 0);
assert.equal(rejectedAll.discardedPairKeys.length, 2);
assert.deepEqual(planRelationJudgementWrites(rejectedAll.parsed, [previousEdge]).edges, []);

// Unanswered pairs are not reviewable and are passed through untouched: they were
// never judged, so there is nothing for the user to accept or reject.
const withUnanswered = parseRelationJudgements(
  JSON.stringify({ relations: [{ pairKey: pairA, relation: 'EXTENDS', confidence: 0.8 }] }),
  candidatePairs,
);
const passedThrough = filterAcceptedJudgements(withUnanswered, new Set([pairA]));
assert.deepEqual(passedThrough.parsed.unansweredPairKeys, [pairB]);
assert.deepEqual(passedThrough.discardedPairKeys, []);

// ---------------------------------------------------------------------------
// Explicit selection: the user ticked papers, so the funnel's opinions are moot.
//
// The score floor and Top-K exist to answer "what should be judged". A selection already answers it —
// including the case the funnel would reject: two papers with no shared entity, no shared folder and
// a decade apart, which is exactly the pair a user asks about when the entity layer found nothing.
// ---------------------------------------------------------------------------
const distantPapers = [
  paper('d1', { year: 2005, abstract: 'A circuit minimisation heuristic.' }),
  paper('d2', { year: 2019, abstract: 'A multiplication algorithm survey.' }),
  paper('d3', { year: 1999, abstract: 'Unrelated database work.' }),
];
const selectedPairs = buildSelectedCandidatePairs(distantPapers, [], ['d1', 'd2']);
assert.equal(selectedPairs.length, 1, 'a selected pair is judged even with no recall signal at all');
assert.equal(selectedPairs[0].recallScore, 0, 'and its score stays honest: zero signal');
assert.ok(
  selectedPairs[0].recallReasons.some((reason) => reason.includes('清单')),
  'the model is told why the pair is being judged',
);

// Every pair among six papers is 15; the cap is what keeps the price predictable.
const sixPapers = Array.from({ length: 8 }, (_, index) => paper(`s${index + 1}`));
assert.equal(MAX_SELECTED_PAPERS, 6);
assert.equal(
  buildSelectedCandidatePairs(sixPapers, [], sixPapers.map((item) => item.paperId)).length,
  15,
  'six selected papers is exactly 15 pairs, whatever the ordering',
);

// A pair with a recorded conclusion is not paid for twice unless the caller insists.
const judgedEdges = [{
  edgeId: 'j1', source: 'd1', sourceKind: 'paper', target: 'd2', targetKind: 'paper',
  type: 'EXTENDS', confidence: 0.9, evidence: [], sourcePaperId: 'd1', origin: 'ai',
  originKey: 'EXTENDS|d1|d2', provenance: {}, createdAt: 1, updatedAt: 1,
}];
assert.equal(
  buildSelectedCandidatePairs(distantPapers, judgedEdges, ['d1', 'd2']).length,
  0,
  'an already-judged selected pair is skipped',
);
assert.equal(
  buildSelectedCandidatePairs(distantPapers, judgedEdges, ['d1', 'd2'], { skipJudged: false }).length,
  1,
  'and can be forced when the user asked for a re-judge',
);

// ---------------------------------------------------------------------------
// Bridge validation: the part that makes "the model may not invent entities" true.
// ---------------------------------------------------------------------------
const excerptLeft = 'We compare against the Boyar-Peralta heuristic on a 15-bit multiplier.';
const excerptRight = 'The Boyar-Peralta heuristic is used as a baseline in Table 2.';
const bridgePair = selectedPairs[0];

assert.ok(quoteAppearsIn('compare against the Boyar-Peralta heuristic', excerptLeft));
assert.ok(
  !quoteAppearsIn('compare against the Booth heuristic', excerptLeft),
  'a quote that is not in the excerpt is refused',
);
assert.ok(
  !quoteAppearsIn('the', excerptLeft),
  'and so is a fragment too short to prove anything',
);
assert.ok(nameSupportedByQuotes('Boyar-Peralta', [excerptLeft]), 'the name appears in the quote');
assert.ok(
  !nameSupportedByQuotes('Wallace tree', [excerptLeft]),
  'an invented name supported by an unrelated sentence is refused',
);

const bridgeExcerpts = new Map([['d1', excerptLeft], ['d2', excerptRight]]);
const rawBridges = [
  {
    name: 'Boyar-Peralta heuristic', type: 'Method',
    leftQuote: 'compare against the Boyar-Peralta heuristic',
    rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
    reason: '两篇都把它作为对比基线', confidence: 0.8,
  },
  // Rewritten quote: refused, and counted as such.
  {
    name: 'Boyar-Peralta heuristic', type: 'Method',
    leftQuote: 'we compare to the BP heuristic',
    rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
  },
  // Description, not a name.
  {
    name: '一种优化方法', type: 'Method',
    leftQuote: 'compare against the Boyar-Peralta heuristic',
    rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
  },
  // Invalid type.
  {
    name: 'Boyar-Peralta heuristic', type: 'Algorithm',
    leftQuote: 'compare against the Boyar-Peralta heuristic',
    rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
  },
  // Not a name at all: a table fragment. Caught by the name-quality rules before any quote check.
  {
    name: '63', type: 'Metric',
    leftQuote: 'compare against the Boyar-Peralta heuristic',
    rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
  },
];
const parsedBridges = parseBridgeSuggestions(rawBridges, bridgePair, { excerpts: bridgeExcerpts });
assert.equal(parsedBridges.bridges.length, 1, 'only the fully supported suggestion survives');
assert.equal(parsedBridges.bridges[0].name, 'Boyar-Peralta heuristic');
assert.deepEqual(
  parsedBridges.bridges[0].evidence.map((entry) => entry.paperId),
  ['d1', 'd2'],
  'both papers must be quoted',
);
// Two refusals are quote/name-support failures: the rewritten quote, and a description whose words
// appear in neither quote (the prompt asks for names, and a phrase cannot be pinned to the text).
assert.equal(parsedBridges.drops.quoteMismatch, 2);
assert.equal(parsedBridges.drops.lowQuality, 1, 'the table fragment never even reaches the quote check');
assert.equal(parsedBridges.drops.badType, 1);

// The cap is applied in code, never stated in the prompt: a number in a prompt is read as a target.
const manyBridges = Array.from({ length: 5 }, (_, index) => ({
  name: `Boyar-Peralta variant ${index}`, type: 'Method',
  leftQuote: 'compare against the Boyar-Peralta heuristic',
  rightQuote: 'The Boyar-Peralta heuristic is used as a baseline',
  confidence: 0.5 + index * 0.05,
}));
const cappedBridges = parseBridgeSuggestions(manyBridges, bridgePair, { excerpts: bridgeExcerpts });
assert.equal(cappedBridges.bridges.length, MAX_BRIDGES_PER_PAIR);
assert.equal(cappedBridges.drops.overLimit, 3, 'and the review is told how many were dropped');
assert.ok(
  cappedBridges.bridges[0].confidence > cappedBridges.bridges[1].confidence,
  'the most confident suggestions are the ones kept',
);
assert.doesNotMatch(
  buildRelationJudgementPrompt(),
  /最多\\s*\\d+\\s*个桥接/,
  'the prompt must not advertise a quota for bridges',
);
assert.match(buildRelationJudgementPrompt(), /引文必须逐字摘自/, 'the prompt states the quote rule');

// ---------------------------------------------------------------------------
// Bridge writes: one entity per concept, however many pairs proposed it.
// ---------------------------------------------------------------------------
const bridgeWrite = planBridgeEntityWrites(
  [
    ...parsedBridges.bridges,
    {
      ...parsedBridges.bridges[0],
      bridgeKey: 'd1|d3#boyar-peralta heuristic',
      pairKey: 'd1|d3',
      evidence: [
        { paperId: 'd1', quote: 'compare against the Boyar-Peralta heuristic' },
        { paperId: 'd3', quote: 'The Boyar-Peralta heuristic is used as a baseline' },
      ],
    },
  ],
  [],
  { now: 5 },
);
assert.equal(bridgeWrite.entities.length, 1, 'the same concept from two pairs is one entity');
assert.equal(bridgeWrite.entities[0].status, 'confirmed', 'the user ticked it, so it is confirmed');
assert.equal(bridgeWrite.edges.length, 3, 'and it is linked to every paper that quoted it');
assert.deepEqual(
  bridgeWrite.edges.map((edge) => [edge.source, edge.targetKind, edge.type]),
  [['d1', 'entity', 'MENTIONS'], ['d2', 'entity', 'MENTIONS'], ['d3', 'entity', 'MENTIONS']],
  'each edge is a paper → entity MENTIONS edge, deduplicated across the two pairs',
);
assert.equal(
  bridgeWrite.entities[0].evidence[0].pageNumber,
  0,
  'evidence from an abstract carries page 0, which the inspector renders as 「摘要」',
);

// An existing entity is reused and confirmed rather than duplicated.
const reused = planBridgeEntityWrites(
  [parsedBridges.bridges[0]],
  [{
    entityId: 'entity:existing', name: 'Boyar-Peralta heuristic',
    // The real normalized form: entity identity is decided by this key, so the fixture must use it.
    normalizedName: normalizeEntityName('Boyar-Peralta heuristic'), aliases: [], type: 'Method',
    status: 'pending', confidence: 0.4, sourcePaperId: 'd1', evidence: [],
    mergedInto: null, userEdited: false, createdAt: 1, updatedAt: 1,
  }],
  { now: 6 },
);
assert.equal(reused.entities.length, 1);
assert.equal(reused.entities[0].entityId, 'entity:existing', 'no duplicate node');
assert.equal(reused.entities[0].status, 'confirmed');
assert.deepEqual(reused.reusedEntityIds, ['entity:existing']);

// ---------------------------------------------------------------------------
// The node the user types in place of a refused "no relation".
// ---------------------------------------------------------------------------
const noRelationEdge = {
  edgeId: 'nr', source: 'd1', sourceKind: 'paper', target: 'd2', targetKind: 'paper',
  type: 'NO_RELATION', confidence: 0, evidence: [], sourcePaperId: 'd1', origin: 'ai',
  originKey: 'NO_RELATION|d1|d2', provenance: {}, createdAt: 1, updatedAt: 1,
};
const manual = planManualBridgeWrites(
  { pairKey: 'd1|d2', name: 'Booth 乘法器', type: 'Method', description: '我加的概念' },
  [],
  [noRelationEdge],
  { now: 7 },
);
assert.equal(manual.entities.length, 1);
assert.equal(manual.entities[0].userEdited, true, 'a hand-typed node is marked as the user’s');
assert.equal(manual.entities[0].confidence, 1, 'it is an assertion, not an estimate');
assert.equal(manual.entities[0].description, '我加的概念');
assert.equal(manual.edges.length, 2, 'linked to both papers');
assert.ok(
  manual.edges.every((edge) => edge.origin === 'user'),
  'and marked as user-originated, so the origin filter can find it',
);
assert.deepEqual(
  manual.dropOriginKeys,
  ['NO_RELATION|d1|d2'],
  'the refused "no relation" is retired: the canvas must not contradict the node the user just added',
);

// An empty name is refused; a name that already exists is reused instead of duplicated.
assert.equal(
  planManualBridgeWrites({ pairKey: 'd1|d2', name: '   ', type: 'Method' }, [], []).rejectedReason,
  '请填写节点名称。',
);
const manualReuse = planManualBridgeWrites(
  { pairKey: 'd1|d2', name: 'boyar-peralta HEURISTIC', type: 'Method' },
  bridgeWrite.entities,
  [],
);
assert.equal(manualReuse.entities[0].entityId, bridgeWrite.entities[0].entityId);
assert.equal(manualReuse.createdEntityIds.length, 0, 'typing an existing name connects, not duplicates');

console.log('Relation recall and judgement contract tests passed.');