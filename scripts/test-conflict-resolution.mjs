import assert from 'node:assert/strict';

import {
  describeConflicts,
  findRelationConflicts,
  planConflictResolution,
  RELATION_RANK,
  resolveByRank,
} from '../src/modules/knowledge-graph/application/conflict-resolution.ts';
import {
  describeResolutionResult,
  planConflictBatch,
  resolveRelationConflicts,
  scanRelationConflicts,
} from '../src/modules/knowledge-graph/application/conflict-service.ts';

function edge(id, type, overrides = {}) {
  return {
    edgeId: id,
    source: 'p1',
    sourceKind: 'paper',
    target: 'p2',
    targetKind: 'paper',
    type,
    confidence: 0.8,
    evidence: [],
    sourcePaperId: 'p1',
    origin: 'ai',
    originKey: `${type}|p1|p2`,
    provenance: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The ranking is the design. It encodes how strong a claim each verdict makes,
// and every auto-resolution below follows from it.
// ---------------------------------------------------------------------------
assert.ok(RELATION_RANK.SIMILAR_TO < RELATION_RANK.COMPARES_WITH);
assert.ok(RELATION_RANK.COMPARES_WITH < RELATION_RANK.CITES);
assert.ok(RELATION_RANK.CITES < RELATION_RANK.IMPROVES);
assert.ok(RELATION_RANK.IMPROVES < RELATION_RANK.EXTENDS);
// NO_RELATION asserts absence, so it outranks every positive verdict: the act of
// judging "nothing here" is itself evidence the positive was wrong.
assert.ok(RELATION_RANK.EXTENDS < RELATION_RANK.NO_RELATION);

// A single verdict is not a conflict.
assert.deepEqual(findRelationConflicts([edge('a', 'EXTENDS')]), []);

// Two edges with the same verdict are not a conflict either — the conflict is
// about contradictory *claims*, not about duplicate records.
assert.deepEqual(findRelationConflicts([edge('a', 'EXTENDS'), edge('b', 'EXTENDS')]), []);

// Non-paper-paper edges never participate.
assert.deepEqual(
  findRelationConflicts([
    edge('a', 'MENTIONS', { targetKind: 'entity', target: 'entity:x' }),
    edge('b', 'EXTENDS'),
  ]),
  [],
  'a Paper->Entity edge cannot contradict a Paper->Paper verdict',
);

// ---------------------------------------------------------------------------
// The case this module exists for: two contradictory verdicts stored for the same
// pair, both presented as current.
// ---------------------------------------------------------------------------
const basic = findRelationConflicts([edge('a', 'EXTENDS'), edge('b', 'SIMILAR_TO')]);
assert.equal(basic.length, 1);
assert.equal(basic[0].pairKey, 'p1|p2');
assert.deepEqual(basic[0].verdicts.sort(), ['EXTENDS', 'SIMILAR_TO']);
assert.equal(basic[0].survivor.edgeId, 'a', 'the stronger claim survives');
assert.deepEqual(
  basic[0].drop.map((item) => item.edgeId),
  ['b'],
);
assert.match(basic[0].explanation, /EXTENDS/);
// The edges are presented strongest-first, so a UI can show the survivor on top.
assert.deepEqual(basic[0].edges.map((item) => item.edgeId), ['a', 'b']);

// NO_RELATION beats a positive verdict: a recorded negative outranks a claim.
const negative = findRelationConflicts([edge('a', 'EXTENDS'), edge('b', 'NO_RELATION')]);
assert.equal(negative[0].survivor.edgeId, 'b');
assert.deepEqual(negative[0].drop.map((item) => item.edgeId), ['a']);

// The pair key is unordered, so the conflict is found regardless of direction.
assert.equal(
  findRelationConflicts([
    edge('a', 'EXTENDS'),
    edge('b', 'CITES', { source: 'p2', target: 'p1', originKey: 'CITES|p1|p2' }),
  ]).length,
  1,
);

// ---------------------------------------------------------------------------
// A user assertion wins outright. No automatic rank may override a deliberate
// decision.
// ---------------------------------------------------------------------------
const userWins = findRelationConflicts([
  edge('ai-strong', 'EXTENDS', { origin: 'ai' }),
  edge('user-weak', 'SIMILAR_TO', { origin: 'user', originKey: 'SIMILAR_TO|p1|p2' }),
]);
assert.equal(userWins[0].survivor.edgeId, 'user-weak', 'the user verdict wins despite ranking lower');
assert.match(userWins[0].explanation, /用户/);
assert.deepEqual(userWins[0].drop.map((item) => item.edgeId), ['ai-strong']);

// Two user verdicts is still a conflict, and the newest local decision wins.
const twoUser = resolveByRank([
  edge('older', 'EXTENDS', { origin: 'user', updatedAt: 100 }),
  edge('newer', 'CITES', { origin: 'user', updatedAt: 500 }),
]);
assert.equal(twoUser.survivor.edgeId, 'newer');

// ---------------------------------------------------------------------------
// Every conflict is mechanically resolvable, and that is a property of the design
// rather than an accident: a conflict needs two *distinct* verdicts, and every
// rank is unique. The "hand it to the user" branch a reasonable design would have
// here is therefore unreachable and was removed rather than kept as decoration.
// ---------------------------------------------------------------------------
const ranks = Object.values(RELATION_RANK);
assert.equal(new Set(ranks).size, ranks.length, 'every verdict has a distinct rank');
// Two edges with the same verdict are not a conflict at all — they are duplicate
// conclusions, which the per-verdict originKey prevents from being written.
assert.deepEqual(findRelationConflicts([edge('a', 'CITES'), edge('b', 'CITES')]), []);
assert.deepEqual(findRelationConflicts([edge('a', 'EXTENDS'), edge('b', 'EXTENDS')]), []);

// A user verdict outranks a nominally stronger AI verdict, which is the only way
// the ranking is deliberately overridden.
const userBeatsRank = findRelationConflicts([
  edge('ai', 'EXTENDS', { origin: 'ai' }),
  edge('mine', 'SIMILAR_TO', { origin: 'user', originKey: 'SIMILAR_TO|p1|p2' }),
]);
assert.equal(userBeatsRank[0].survivor.edgeId, 'mine');

// ---------------------------------------------------------------------------
// Confidence floor: a low-confidence guess contradicting a strong verdict is
// noise, and surfacing noise as a conflict trains the user to ignore the list.
// ---------------------------------------------------------------------------
const noisy = [edge('strong', 'EXTENDS', { confidence: 0.9 }), edge('weak', 'CITES', { confidence: 0.2 })];
assert.equal(findRelationConflicts(noisy).length, 1, 'it is seen without a floor');
assert.equal(
  findRelationConflicts(noisy, { minConfidence: 0.5 }).length,
  0,
  'a confidence floor suppresses the noise',
);

// ---------------------------------------------------------------------------
// Resolution planning.
// ---------------------------------------------------------------------------
const conflict = basic[0];
const plan = planConflictResolution(conflict, { now: 900 });
assert.deepEqual(plan.dropOriginKeys, ['SIMILAR_TO|p1|p2']);
assert.equal(plan.edges.length, 1);
const resolved = plan.edges[0];
assert.equal(resolved.edgeId, 'a', 'the survivor keeps its identity');
assert.equal(resolved.provenance.resolvedAt, 900);
assert.equal(resolved.provenance.resolvedBy, 'rule');
// The superseded verdicts are recorded, because after the write the losers are
// gone and only this field explains what happened.
assert.equal(resolved.provenance.resolvedAgainst, 'SIMILAR_TO');
assert.equal(resolved.updatedAt, 900);

// An unresolved conflict cannot be planned... which cannot occur, so the planner
// is exercised with a conflict whose survivor is overridden instead.
const userChoice = planConflictResolution(conflict, { selectedEdgeId: 'b', now: 950 });
assert.equal(userChoice.edges[0].edgeId, 'b');
assert.equal(userChoice.edges[0].provenance.resolvedBy, 'user');
// The edge the user rejected is retired.
assert.deepEqual(userChoice.dropOriginKeys, ['EXTENDS|p1|p2']);
assert.equal(userChoice.edges[0].provenance.resolvedAgainst, 'EXTENDS');

// A selection naming an edge outside the conflict is ignored rather than obeyed,
// so a stale UI cannot delete an unrelated conclusion — and the resolution is
// attributed to the rule, not to the user, because the user's click did not decide
// anything here.
const staleSelection = planConflictResolution(conflict, { selectedEdgeId: 'not-in-here' });
assert.equal(staleSelection.edges[0].edgeId, 'a', 'falls back to the ranked survivor');
assert.equal(
  staleSelection.edges[0].provenance.resolvedBy,
  'rule',
  'a click that decided nothing must not be recorded as the user deciding',
);
assert.deepEqual(staleSelection.dropOriginKeys, ['SIMILAR_TO|p1|p2']);

// A selection picking the already-ranked survivor must not drop it.
const sameSelection = planConflictResolution(conflict, { selectedEdgeId: 'a' });
assert.deepEqual(sameSelection.dropOriginKeys, ['SIMILAR_TO|p1|p2']);

// ---------------------------------------------------------------------------
// Detection is deterministic, so the conflict list does not reshuffle.
const many = findRelationConflicts([
  edge('x1', 'EXTENDS', { target: 'p3', originKey: 'EXTENDS|p1|p3' }),
  edge('x2', 'CITES', { target: 'p3', originKey: 'CITES|p1|p3' }),
  edge('y1', 'IMPROVES', { target: 'p5', originKey: 'IMPROVES|p1|p5' }),
  edge('y2', 'SIMILAR_TO', { target: 'p5', originKey: 'SIMILAR_TO|p1|p5' }),
]);
assert.equal(many.length, 2);
assert.deepEqual(many.map((item) => item.pairKey), ['p1|p3', 'p1|p5']);
assert.deepEqual(findRelationConflicts([...many.flatMap((item) => item.edges)].reverse()).map((i) => i.pairKey),
  ['p1|p3', 'p1|p5']);

// ---------------------------------------------------------------------------
// Summary copy.
// ---------------------------------------------------------------------------
assert.equal(describeConflicts([]), '没有发现互相矛盾的关系结论。');
assert.match(describeConflicts(basic), /1 组矛盾结论/);
assert.match(describeConflicts(basic), /按结论强度自动保留/);
assert.match(describeConflicts(userWins), /由你的标注胜出/);
assert.match(describeConflicts(many), /2 组矛盾结论/);

// ---------------------------------------------------------------------------
// A user *resolution* is as authoritative as a user assertion.
//
// This is the case that made the previous version wrong: the user resolves a pair,
// then a later judgement run adds a third verdict. Without recognising the survivor
// as the user's decision, the rank comparison would quietly overturn it — and the
// user would see a decision they made being undone with no indication why.
// ---------------------------------------------------------------------------
const resolvedByUser = edge('mine', 'SIMILAR_TO', {
  originKey: 'SIMILAR_TO|p1|p2',
  updatedAt: 100,
  provenance: { resolvedAt: 90, resolvedBy: 'user', resolvedAgainst: 'EXTENDS' },
});
const recontested = findRelationConflicts([
  resolvedByUser,
  edge('late-ai', 'EXTENDS', { originKey: 'EXTENDS|p1|p2', updatedAt: 900 }),
]);
assert.equal(recontested.length, 1);
assert.equal(
  recontested[0].survivor.edgeId,
  'mine',
  'a later judgement must not overturn a pair the user already adjudicated',
);
assert.deepEqual(recontested[0].drop.map((item) => item.edgeId), ['late-ai']);
assert.equal(recontested[0].drop[0].reason, '该结论已由你裁决');
assert.match(recontested[0].explanation, /此前已经裁决/);
// The distinction has to show in the copy: "you annotated this" and "you already
// ruled on this pair" are different claims about who decided.
assert.doesNotMatch(recontested[0].explanation, /手动标注/);

// Re-resolving an already user-resolved pair keeps the user as the author, and the
// audit trail accumulates instead of being overwritten by whoever ran last.
const reResolved = planConflictResolution(recontested[0], { now: 1000 });
assert.equal(
  reResolved.edges[0].provenance.resolvedBy,
  'user',
  'an automatic pass must not downgrade a user resolution to a rule',
);
assert.equal(
  reResolved.edges[0].provenance.resolvedAgainst,
  'EXTENDS',
  'the newly superseded verdict joins the record rather than replacing it',
);
assert.equal(reResolved.edges[0].provenance.resolvedAt, 1000);
assert.equal(reResolved.edges[0].provenance.resolvedAt, 1000, 'the newest resolution is the one dated');
assert.deepEqual(reResolved.dropOriginKeys, ['EXTENDS|p1|p2']);

// A pair re-contested twice records both superseded verdicts, de-duplicated.
const twiceContested = planConflictResolution(
  findRelationConflicts([
    edge('mine', 'SIMILAR_TO', {
      originKey: 'SIMILAR_TO|p1|p2',
      provenance: { resolvedBy: 'user', resolvedAgainst: 'EXTENDS' },
    }),
    edge('later-cites', 'CITES', { originKey: 'CITES|p1|p2', updatedAt: 900 }),
  ])[0],
  { now: 1100 },
);
assert.equal(twiceContested.edges[0].provenance.resolvedAgainst, 'EXTENDS,CITES');

// ---------------------------------------------------------------------------
// Batch planning: one plan, one transaction.
// ---------------------------------------------------------------------------
const batch = planConflictBatch(many, { now: 5000 });
assert.deepEqual(batch.pairKeys, ['p1|p3', 'p1|p5']);
assert.equal(batch.edges.length, 2, 'one survivor per conflict');
assert.deepEqual(batch.edges.map((item) => item.edgeId), ['x1', 'y1']);
assert.deepEqual(
  batch.dropOriginKeys.sort(),
  ['CITES|p1|p3', 'SIMILAR_TO|p1|p5'],
  'every losing verdict is retired',
);
assert.deepEqual(batch.staleSelections, []);
assert.ok(batch.edges.every((item) => item.provenance.resolvedAt === 5000));

// An empty conflict list plans nothing, and applying it must not open a write
// transaction at all.
assert.deepEqual(planConflictBatch([]), {
  pairKeys: [],
  edges: [],
  dropOriginKeys: [],
  staleSelections: [],
});

// A stale selection — a pair or an edge the current list does not contain — is
// reported, and the write falls back to the ranked survivor rather than obeying it.
const staleBatch = planConflictBatch(many, {
  selections: new Map([['p1|p3', 'no-such-edge'], ['p9|p9', 'x1']]),
});
assert.deepEqual(staleBatch.staleSelections.sort(), ['p1|p3', 'p9|p9']);
assert.equal(staleBatch.edges[0].edgeId, 'x1', 'falls back to the ranked survivor');
assert.equal(staleBatch.edges[0].provenance.resolvedBy, 'rule');
// A stale selection must never delete the edge it names on another pair.
assert.ok(!staleBatch.dropOriginKeys.includes('IMPROVES|p1|p5'));

// The user's own choice in the list is honoured, and marks the resolution as theirs.
const chosenBatch = planConflictBatch(many, { selections: new Map([['p1|p3', 'x2']]) });
assert.equal(chosenBatch.edges.find((item) => item.source === 'p1' && item.target === 'p3').edgeId, 'x2');
assert.equal(
  chosenBatch.edges.find((item) => item.target === 'p3').provenance.resolvedBy,
  'user',
);
assert.ok(chosenBatch.dropOriginKeys.includes('EXTENDS|p1|p3'));

// A plan never retires the key it is writing: that would turn a resolution into a
// deletion of the survivor.
const selfDrop = planConflictBatch([{
  ...many[0],
  // Pathological input: the loser shares the survivor's origin key.
  edges: [
    many[0].edges[0],
    { ...many[0].edges[1], originKey: many[0].edges[0].originKey },
  ],
  drop: [{ edgeId: many[0].edges[1].edgeId, originKey: many[0].edges[0].originKey, reason: 'test' }],
}]);
assert.deepEqual(selfDrop.dropOriginKeys, [], 'the written key is never retired');
assert.equal(selfDrop.edges.length, 1);

// ---------------------------------------------------------------------------
// Scanning and applying.
// ---------------------------------------------------------------------------
const applied = [];
const ports = {
  listEdges: async () => [...many.flatMap((item) => item.edges)],
  applyRelationPlan: async (plan) => {
    applied.push(plan);
    return plan.edges.length;
  },
};

const scan = await scanRelationConflicts(ports);
assert.equal(scan.conflicts.length, 2);
assert.match(scan.summary, /2 组矛盾结论/);

// The confidence floor travels through the scan, so noise never reaches the list.
const noisyScan = await scanRelationConflicts({ listEdges: async () => noisy }, { minConfidence: 0.5 });
assert.equal(noisyScan.conflicts.length, 0);
assert.equal(noisyScan.summary, '没有发现互相矛盾的关系结论。');

const resolution = await resolveRelationConflicts(ports, planConflictBatch(scan.conflicts, { now: 7000 }));
assert.deepEqual(applied.length, 1, 'the whole batch is one call, so it is one transaction');
assert.deepEqual(
  [...applied[0].dropOriginKeys].sort(),
  ['CITES|p1|p3', 'SIMILAR_TO|p1|p5'],
);
assert.equal(applied[0].edges.length, 2);
assert.equal(resolution.pairs, 2);
assert.equal(resolution.edgesWritten, 2);
assert.equal(resolution.retiredKeys, 2);
assert.match(describeResolutionResult(resolution), /已消解 2 组/);

// An empty plan must not touch the store.
const untouched = [];
const emptyResult = await resolveRelationConflicts(
  { applyRelationPlan: async (plan) => { untouched.push(plan); return 0; } },
  planConflictBatch([]),
);
assert.deepEqual(untouched, [], 'no write transaction for an empty plan');
assert.equal(emptyResult.pairs, 0);
assert.equal(describeResolutionResult(emptyResult), '没有需要处理的矛盾结论。');

// ---------------------------------------------------------------------------
// Idempotency: resolving is not a loop. Applying the plan to a store leaves a
// graph whose pairs carry one verdict each, so a second scan finds nothing.
// ---------------------------------------------------------------------------
const stored = [...many.flatMap((item) => item.edges)];
const store = {
  listEdges: async () => stored,
  applyRelationPlan: async (plan) => {
    const dropped = new Set(plan.dropOriginKeys);
    for (let index = stored.length - 1; index >= 0; index -= 1) {
      if (dropped.has(stored[index].originKey)) stored.splice(index, 1);
    }
    for (const edge of plan.edges) {
      const at = stored.findIndex((item) => item.edgeId === edge.edgeId);
      if (at >= 0) stored[at] = edge;
      else stored.push(edge);
    }
    return plan.edges.length;
  },
};
const first = await scanRelationConflicts(store);
assert.equal(first.conflicts.length, 2);
await resolveRelationConflicts(store, planConflictBatch(first.conflicts, { now: 1 }));
const second = await scanRelationConflicts(store);
assert.equal(second.conflicts.length, 0, 'a resolved graph reports no conflicts');
assert.equal(stored.length, 2, 'exactly one verdict per pair remains');
// The surviving records still carry the audit trail, which is the only place the
// superseded verdicts exist after the losers are deleted.
assert.ok(stored.every((edge) => edge.provenance.resolvedBy === 'rule'));
assert.deepEqual(
  stored.map((edge) => edge.provenance.resolvedAgainst).sort(),
  ['CITES', 'SIMILAR_TO'],
);

console.log('Conflict resolution contract tests passed.');
