import assert from 'node:assert/strict';

import {
  groupCandidatesByType,
  parseEntityCandidates,
  shouldPreCheckCandidate,
} from '../src/modules/knowledge-graph/application/candidate-parsing.ts';
import {
  mergeEvidence,
  pickCanonicalEntity,
  planEntityConfirmation,
  planEntityMerge,
} from '../src/modules/knowledge-graph/application/entity-planning.ts';
import {
  confirmEntityCandidates,
  ignoreEntityName,
  mergeGraphEntities,
} from '../src/modules/knowledge-graph/application/entity-service.ts';
import { buildPendingReview } from '../src/modules/knowledge-graph/application/entity-service.ts';
import { normalizeEntityName } from '../src/modules/knowledge-graph/domain/entity-normalization.ts';
import { DEFAULT_KNOWLEDGE_GRAPH_SETTINGS } from '../src/modules/knowledge-graph/contracts.ts';

const context = { paperId: 'p1', defaultPageNumber: 3, chunkId: 'c1', chunkHeading: 'Method' };

// ---------------------------------------------------------------------------
// Parsing model output. There is no provider JSON mode in this repo, so this is
// the most likely place for a silent data bug: it must degrade, never throw.
// ---------------------------------------------------------------------------
const clean = JSON.stringify({
  entities: [
    { name: 'Transformer', type: 'Method', confidence: 0.95,
      evidence: [{ quote: 'we propose the Transformer', pageNumber: 3 }] },
    { name: 'BLEU', type: 'Metric', confidence: 0.8, evidence: [{ quote: 'BLEU of 28.4' }] },
  ],
});
const parsedClean = parseEntityCandidates(clean, context, normalizeEntityName);
assert.equal(parsedClean.candidates.length, 2);
assert.equal(parsedClean.rejected.length, 0);
assert.equal(parsedClean.candidates[0].type, 'Method');
// A missing page number falls back to the chunk's page rather than 0/NaN.
assert.equal(parsedClean.candidates[1].evidence[0].pageNumber, 3);

// ---------------------------------------------------------------------------
// The key normalizer must never become the display name.
//
// The third argument is the *equality key* normalizer (`normalizeEntityName` strips
// separators so spellings match). Its output decides whether two candidates are the
// same entity — using it as the name turned "frequency-first heuristic" into
// "frequencyfirstheuristic" in the confirm dialog and in every graph label.
// ---------------------------------------------------------------------------
const spaced = JSON.stringify({
  entities: [
    { name: 'frequency-first heuristic', type: 'Method', confidence: 0.9 },
    { name: 'frequencyfirstheuristic', type: 'Method', confidence: 0.8 },
  ],
});
const parsedSpaced = parseEntityCandidates(spaced, context, normalizeEntityName);
assert.equal(
  parsedSpaced.candidates.length,
  1,
  'two spellings of one entity still merge inside the batch',
);
assert.equal(
  parsedSpaced.candidates[0].name,
  'frequency-first heuristic',
  'the display name keeps the model wording, spaces and hyphens included',
);
assert.equal(parsedSpaced.candidates[0].confidence, 0.9, 'merging keeps the higher confidence');

// Casing and internal whitespace runs are preserved (runs collapse to one space).
const casing = JSON.stringify({
  entities: [{ name: '  Paar’s   Heuristic  ', type: 'Method', confidence: 0.7 }],
});
assert.equal(
  parseEntityCandidates(casing, context, normalizeEntityName).candidates[0].name,
  'Paar’s Heuristic',
);

// The key does the merging, not the trimmed display string.
const keyOnlyMatch = parseEntityCandidates(
  JSON.stringify({
    entities: [
      { name: 'MITM search', type: 'Method' },
      { name: 'mitm-search', type: 'Method' },
    ],
  }),
  context,
  normalizeEntityName,
);
assert.equal(keyOnlyMatch.candidates.length, 1);
assert.equal(keyOnlyMatch.candidates[0].name, 'MITM search', 'the first spelling is kept');

// Fenced JSON, which is what models most often emit.
const fenced = '```json\n{"entities":[{"name":"BERT","type":"Method","confidence":0.9}]}\n```';
assert.equal(parseEntityCandidates(fenced, context, normalizeEntityName).candidates.length, 1);

// Prose around the JSON.
const withProse = 'Sure! Here are the entities:\n{"entities":[{"name":"BERT","type":"Method"}]}\nHope that helps.';
assert.equal(parseEntityCandidates(withProse, context, normalizeEntityName).candidates.length, 1);

// A bare array payload.
assert.equal(
  parseEntityCandidates('[{"name":"BERT","type":"Method"}]', context, normalizeEntityName)
    .candidates.length,
  1,
);

// Chinese type labels echoed back by the prompt.
assert.equal(
  parseEntityCandidates('{"entities":[{"name":"注意力","type":"方法"}]}', context, normalizeEntityName)
    .candidates[0].type,
  'Method',
);

// Percentages are normalized to 0..1, and out-of-range values are clamped.
//
// The percentage rule is deliberately narrow (`1 < value <= 100`) so a value the
// model expressed on some other scale is clamped to certainty rather than being
// silently divided by 100 into a near-zero. Confidence only affects pre-checking
// and visual weight, never correctness, so erring towards "certain" is safe;
// under-reporting would hide real entities behind the auto-check threshold.
const confidenceCases = [
  ['95', 0.95],
  ['50', 0.5],
  ['1', 1],
  ['1.5', 1],
  ['-3', 0],
  ['"0.7"', 0.7],
  ['"abc"', 0.5],
];
for (const [raw, expected] of confidenceCases) {
  const payload = `{"entities":[{"name":"X","type":"Method","confidence":${raw}}]}`;
  assert.equal(
    parseEntityCandidates(payload, context, normalizeEntityName).candidates[0].confidence,
    expected,
    `confidence ${raw} should become ${expected}`,
  );
}

// Malformed input must not throw, and must explain itself.
for (const garbage of ['', 'not json at all', '{', 'null', '{"entities":"nope"}', '[1,2,3]']) {
  const result = parseEntityCandidates(garbage, context, normalizeEntityName);
  assert.equal(result.candidates.length, 0, `"${garbage}" must yield no candidates`);
  assert.ok(result.rejected.length > 0, `"${garbage}" must be reported as rejected`);
}

// Invalid entries are dropped individually while valid siblings survive.
const mixed = JSON.stringify({
  entities: [
    { name: 'Good', type: 'Method' },
    { name: '', type: 'Method' },
    { name: 'NoType', type: 'Nonsense' },
    'a bare string',
    { name: 'AlsoGood', type: 'Dataset' },
  ],
});
const parsedMixed = parseEntityCandidates(mixed, context, normalizeEntityName);
assert.equal(parsedMixed.candidates.length, 2, 'valid siblings must survive invalid entries');
assert.equal(parsedMixed.rejected.length, 3);

// The same entity across chunks is merged, keeping the best confidence and all
// distinct quotes rather than producing duplicate candidates.
const repeated = JSON.stringify({
  entities: [
    { name: 'Transformer', type: 'Method', confidence: 0.6,
      evidence: [{ quote: 'quote A', pageNumber: 1 }] },
    { name: 'Transformer模型', type: 'Method', confidence: 0.9,
      evidence: [{ quote: 'quote B', pageNumber: 5 }, { quote: 'quote A', pageNumber: 1 }] },
  ],
});
const parsedRepeated = parseEntityCandidates(repeated, context, normalizeEntityName);
assert.equal(parsedRepeated.candidates.length, 1, 'normalized duplicates must collapse');
assert.equal(parsedRepeated.candidates[0].confidence, 0.9, 'highest confidence wins');
assert.equal(parsedRepeated.candidates[0].evidence.length, 2, 'distinct quotes accumulate');

// Evidence is capped and truncated so a chatty model cannot bloat the store.
const verbose = JSON.stringify({
  entities: [{
    name: 'Verbose', type: 'Method',
    evidence: Array.from({ length: 10 }, (_, i) => ({ quote: `q${i}`, pageNumber: i + 1 })),
  }],
});
const parsedVerbose = parseEntityCandidates(
  verbose,
  { ...context, maxEvidence: 2, maxQuoteLength: 3 },
  normalizeEntityName,
);
assert.equal(parsedVerbose.candidates[0].evidence.length, 2);
assert.ok(parsedVerbose.candidates[0].evidence[0].quote.length <= 3);

// A candidate with no evidence still points at a real page rather than claiming
// provenance it does not have.
const noEvidence = parseEntityCandidates(
  '{"entities":[{"name":"Bare","type":"Method"}]}',
  context,
  normalizeEntityName,
);
assert.equal(noEvidence.candidates[0].evidence.length, 1);
assert.equal(noEvidence.candidates[0].evidence[0].pageNumber, 3);

// Grouping and pre-check thresholds.
const groups = groupCandidatesByType(parsedClean.candidates);
assert.deepEqual(groups.map((group) => group.type), ['Method', 'Metric']);
assert.equal(shouldPreCheckCandidate({ confidence: 0.9 }, 0.75), true);
assert.equal(shouldPreCheckCandidate({ confidence: 0.5 }, 0.75), false);

// ---------------------------------------------------------------------------
// Evidence merging must be deterministic: a re-confirmation after a reload has
// to produce identical arrays, or every write looks like a change.
// ---------------------------------------------------------------------------
const evidenceA = { paperId: 'p1', pageNumber: 2, quote: 'second' };
const evidenceB = { paperId: 'p1', pageNumber: 1, quote: 'first' };
const mergedEvidence = mergeEvidence([evidenceA], [evidenceB, evidenceA]);
assert.deepEqual(mergedEvidence.map((item) => item.pageNumber), [1, 2]);
assert.equal(mergedEvidence.length, 2, 'duplicates collapse');
assert.deepEqual(mergeEvidence([], []), []);

// ---------------------------------------------------------------------------
// The core requirement: sharing an entity connects papers WITHOUT any LLM call.
// Two papers confirming the same normalized name must end up on ONE entity.
// ---------------------------------------------------------------------------
const paper1 = planEntityConfirmation(
  [{ name: 'Transformer', type: 'Method', confidence: 0.9,
    evidence: [{ paperId: 'p1', pageNumber: 3, quote: 'q1' }] }],
  [],
  { paperId: 'p1', now: 100 },
);
assert.equal(paper1.entities.length, 1);
assert.equal(paper1.entities[0].status, 'confirmed');
assert.equal(paper1.edges.length, 1);
assert.equal(paper1.edges[0].source, 'p1');
assert.equal(paper1.edges[0].target, paper1.entities[0].entityId);
assert.equal(paper1.edges[0].sourceKind, 'paper');
assert.equal(paper1.edges[0].targetKind, 'entity');
assert.equal(paper1.edges[0].origin, 'ai');

// Paper 2 uses a different surface form of the same entity.
const paper2 = planEntityConfirmation(
  [{ name: 'Transformer模型', type: 'Method', confidence: 0.7,
    evidence: [{ paperId: 'p2', pageNumber: 9, quote: 'q2' }] }],
  paper1.entities,
  { paperId: 'p2', now: 200 },
);
assert.equal(paper2.entities.length, 1);
assert.equal(
  paper2.entities[0].entityId,
  paper1.entities[0].entityId,
  'the same entity must be reused across papers, not duplicated',
);
assert.equal(paper2.entities[0].evidence.length, 2, 'evidence from both papers accumulates');
assert.ok(
  paper2.entities[0].aliases.includes('Transformer模型'),
  'the differing surface form is kept as an alias',
);
assert.equal(paper2.edges[0].source, 'p2');
assert.notEqual(
  paper2.edges[0].originKey,
  paper1.edges[0].originKey,
  'the two papers need distinct edges to the shared entity',
);

// The pair of edges is what makes the papers two hops apart.
assert.equal(paper1.edges[0].target, paper2.edges[0].target);

// Confirming the same candidate twice must not create a second entity or edge.
const reconfirmed = planEntityConfirmation(
  [{ name: 'Transformer', type: 'Method', confidence: 0.9,
    evidence: [{ paperId: 'p1', pageNumber: 3, quote: 'q1' }] }],
  paper1.entities,
  { paperId: 'p1', now: 300 },
);
assert.equal(reconfirmed.entities[0].entityId, paper1.entities[0].entityId);
assert.equal(
  reconfirmed.edges[0].originKey,
  paper1.edges[0].originKey,
  're-confirmation must hit the same unique originKey instead of duplicating',
);

// A confirmed entity always beats a pending one as the landing point.
const canonical = pickCanonicalEntity([
  { entityId: 'z-pending', status: 'pending', evidence: [], createdAt: 1 },
  { entityId: 'a-confirmed', status: 'confirmed', evidence: [], createdAt: 9 },
]);
assert.equal(canonical.entityId, 'a-confirmed');
// Merged tombstones are never a landing point.
assert.equal(
  pickCanonicalEntity([{ entityId: 'tomb', status: 'merged', evidence: [], createdAt: 1 }]),
  undefined,
);

// Multiple candidates in one batch that normalize the same way collapse onto one
// entity instead of racing to create twins.
const sameBatch = planEntityConfirmation(
  [
    { name: 'BERT', type: 'Method', confidence: 0.8, evidence: [] },
    { name: 'bert', type: 'Method', confidence: 0.6, evidence: [] },
  ],
  [],
  { paperId: 'p1', now: 400 },
);
assert.equal(sameBatch.entities.length, 1);
assert.equal(sameBatch.edges.length, 1);

// Unnamed candidates are skipped rather than creating an empty-named entity.
assert.equal(
  planEntityConfirmation([{ name: '   ', type: 'Method', confidence: 1, evidence: [] }], [], {})
    .entities.length,
  0,
);

// ---------------------------------------------------------------------------
// Merging: re-hang edges, keep aliases, tombstone the absorbed record.
// ---------------------------------------------------------------------------
const keepEntity = {
  entityId: 'e-keep', name: 'Transformer', normalizedName: 'transformer',
  aliases: [], type: 'Method', status: 'confirmed', confidence: 0.9,
  sourcePaperId: 'p1', evidence: [{ paperId: 'p1', pageNumber: 1, quote: 'a' }],
  mergedInto: null, userEdited: false, createdAt: 1, updatedAt: 1,
};
const mergeEntity = {
  entityId: 'e-merge', name: 'Transformer Model', normalizedName: 'transformermodel',
  aliases: ['TF'], type: 'Method', status: 'pending', confidence: 0.6,
  sourcePaperId: 'p2', evidence: [{ paperId: 'p2', pageNumber: 4, quote: 'b' }],
  mergedInto: null, userEdited: false, createdAt: 2, updatedAt: 2,
};
const keepEdges = [
  { edgeId: 'edge1', source: 'p1', sourceKind: 'paper', target: 'e-keep',
    targetKind: 'entity', type: 'USES', confidence: 0.9, evidence: [],
    sourcePaperId: 'p1', origin: 'ai', originKey: 'USES|e-keep|p1',
    provenance: {}, createdAt: 1, updatedAt: 1 },
  { edgeId: 'edge2', source: 'p2', sourceKind: 'paper', target: 'e-merge',
    targetKind: 'entity', type: 'USES', confidence: 0.6, evidence: [],
    sourcePaperId: 'p2', origin: 'ai', originKey: 'USES|e-merge|p2',
    provenance: {}, createdAt: 2, updatedAt: 2 },
];

const mergePlan = planEntityMerge('e-keep', 'e-merge', [keepEntity, mergeEntity], keepEdges, 500);
assert.ok(mergePlan);
assert.equal(mergePlan.absorbed.status, 'merged');
assert.equal(mergePlan.absorbed.mergedInto, 'e-keep');
assert.ok(mergePlan.keep.aliases.includes('Transformer Model'), 'absorbed name becomes an alias');
assert.ok(mergePlan.keep.aliases.includes('TF'), 'existing aliases are preserved');
assert.equal(mergePlan.keep.evidence.length, 2, 'evidence from both sides is kept');
assert.equal(mergePlan.keep.status, 'confirmed', 'confirmed never downgrades to pending');
// The redirected edge now points at the survivor, and its key was freed first.
assert.equal(mergePlan.edges.length, 1);
assert.equal(mergePlan.edges[0].target, 'e-keep');
assert.ok(mergePlan.dropOriginKeys.includes('USES|e-merge|p2'));
// USES is directed, so the key keeps endpoint order (`p2` first) rather than
// sorting them; only undirected types normalise their pair order.
assert.equal(mergePlan.edges[0].originKey, 'USES|p2|e-keep');

// A collision is dropped, not written: e-keep already has an edge from p2.
// The existing edge's key must be the real directed form (`p2` first), otherwise
// this fixture would not actually collide and the test would pass vacuously.
const collidingEdges = [
  ...keepEdges,
  { edgeId: 'edge3', source: 'p2', sourceKind: 'paper', target: 'e-keep',
    targetKind: 'entity', type: 'USES', confidence: 0.5, evidence: [],
    sourcePaperId: 'p2', origin: 'ai', originKey: 'USES|p2|e-keep',
    provenance: {}, createdAt: 3, updatedAt: 3 },
];
const collisionPlan = planEntityMerge(
  'e-keep', 'e-merge', [keepEntity, mergeEntity], collidingEdges, 600,
);
assert.equal(
  collisionPlan.edges.length,
  0,
  'redirecting onto an occupied originKey must be dropped, not written',
);
assert.ok(collisionPlan.dropOriginKeys.includes('USES|e-merge|p2'));

// Folding an entity into itself, or into a tombstone, is refused.
assert.equal(planEntityMerge('e-keep', 'e-keep', [keepEntity], [], 1), null);
assert.equal(
  planEntityMerge('e-keep', 'e-merge', [keepEntity, { ...mergeEntity, status: 'merged' }], [], 1),
  null,
);
assert.equal(planEntityMerge('missing', 'e-merge', [mergeEntity], [], 1), null);

// ---------------------------------------------------------------------------
// Service layer against an in-memory repository double.
// ---------------------------------------------------------------------------
function createRepositoryDouble(seed = {}) {
  const state = {
    entities: seed.entities ?? [],
    edges: seed.edges ?? [],
    settings: seed.settings ?? { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS },
  };
  return {
    state,
    listEntities: async () => [...state.entities],
    listEdges: async () => [...state.edges],
    readSettings: async () => ({ ...state.settings }),
    async writeSettings(next) { state.settings = next; },
    async applyEntityPlan(plan) {
      const dropped = new Set(plan.dropOriginKeys ?? []);
      state.edges = state.edges.filter((edge) => !dropped.has(edge.originKey));
      const entityById = new Map(state.entities.map((entity) => [entity.entityId, entity]));
      for (const entity of plan.entities) entityById.set(entity.entityId, entity);
      state.entities = [...entityById.values()];
      let written = 0;
      const edgeById = new Map(state.edges.map((edge) => [edge.edgeId, edge]));
      for (const edge of plan.edges) {
        if ([...edgeById.values()].some(
          (existing) => existing.originKey === edge.originKey && existing.edgeId !== edge.edgeId,
        )) continue;
        edgeById.set(edge.edgeId, edge);
        written += 1;
      }
      state.edges = [...edgeById.values()];
      return written;
    },
  };
}

const repository = createRepositoryDouble();
const firstConfirm = await confirmEntityCandidates(
  [{ name: 'Transformer', type: 'Method', confidence: 0.9, evidence: [] }],
  'p1',
  repository,
  { now: 100 },
);
assert.equal(firstConfirm.createdEntityIds.length, 1);
assert.equal(firstConfirm.reusedEntityIds.length, 0);
assert.equal(firstConfirm.edgesWritten, 1);

// Second paper, same entity: reused, and a second edge appears.
const secondConfirm = await confirmEntityCandidates(
  [{ name: 'Transformer模型', type: 'Method', confidence: 0.8, evidence: [] }],
  'p2',
  repository,
  { now: 200 },
);
assert.equal(secondConfirm.createdEntityIds.length, 0);
assert.equal(secondConfirm.reusedEntityIds.length, 1);
assert.equal(secondConfirm.createdEntityIds.length + secondConfirm.reusedEntityIds.length, 1);
assert.equal(repository.state.entities.length, 1, 'no twin entity was created');
assert.equal(repository.state.edges.length, 2, 'both papers link to the shared entity');

// Confirming the same paper again is idempotent — the unique key absorbs it.
const idempotent = await confirmEntityCandidates(
  [{ name: 'Transformer', type: 'Method', confidence: 0.9, evidence: [] }],
  'p2',
  repository,
  { now: 300 },
);
assert.equal(idempotent.edgesWritten, 0, 'a repeated confirmation writes no new edge');
assert.equal(repository.state.edges.length, 2);

// "Never suggest again" is keyed by normalized name, so it also suppresses the
// Chinese surface form.
await ignoreEntityName('Transformer', repository);
const ignored = await confirmEntityCandidates(
  [{ name: 'Transformer模型', type: 'Method', confidence: 0.9, evidence: [] }],
  'p3',
  repository,
  { now: 400 },
);
assert.equal(ignored.skippedIgnoredNames.length, 1);
assert.equal(ignored.edgesWritten, 0);
assert.equal(repository.state.edges.length, 2, 'nothing was written for an ignored entity');

// Merge through the service, then verify the graph is consistent.
const beforeMerge = repository.state.entities.length;
const missingMerge = await mergeGraphEntities(
  repository.state.entities[0].entityId,
  'no-such-entity',
  repository,
);
assert.equal(missingMerge, null, 'merging a missing entity is a no-op');
assert.equal(repository.state.entities.length, beforeMerge, 'a refused merge changes nothing');

const second = createRepositoryDouble();
const confirmA = await confirmEntityCandidates(
  [{ name: 'Graph Convolutional Network', type: 'Method', confidence: 0.9, evidence: [] }],
  'p1', second, { now: 10 },
);
// A deliberately unrelated name: this test exercises the *merge mechanism*, not
// the alignment heuristic. Same-normalized-name duplicates cannot occur here at
// all, because exact matches are reused rather than created.
const confirmB = await confirmEntityCandidates(
  [{ name: 'Masked Language Modeling', type: 'Task', confidence: 0.7, evidence: [] }],
  'p2', second, { now: 20 },
);
assert.equal(second.state.entities.length, 2, 'two distinct names produce two entities');
assert.equal(second.state.edges.length, 2);
const absorbedId = confirmB.createdEntityIds[0];
const merged = await mergeGraphEntities(confirmA.createdEntityIds[0], absorbedId, second, 30);
assert.ok(merged, 'the merge must succeed');
assert.equal(merged.edgesRewritten, 1, 'the absorbed paper edge is redirected');

const survivor = second.state.entities.find((e) => e.entityId === confirmA.createdEntityIds[0]);
const tombstone = second.state.entities.find((e) => e.entityId === absorbedId);
assert.equal(second.state.entities.length, 2, 'the absorbed record is kept as a tombstone');
assert.equal(tombstone.status, 'merged');
assert.equal(tombstone.mergedInto, survivor.entityId);
assert.ok(survivor.aliases.includes('Masked Language Modeling'));
// Both papers now hang off the survivor, and the absorbed entity has no edges.
assert.equal(second.state.edges.filter((e) => e.target === survivor.entityId).length, 2);
assert.equal(second.state.edges.filter((e) => e.target === absorbedId).length, 0);

// ---------------------------------------------------------------------------
// Pending review projection: what the confirmation dialog actually receives.
// Pre-checking is decided here, not in the dialog, so it is testable.
// ---------------------------------------------------------------------------
function pendingEntity(id, name, type, confidence, paperId = 'p1') {
  return {
    entityId: id,
    name,
    normalizedName: normalizeEntityName(name),
    aliases: [],
    type,
    status: 'pending',
    confidence,
    sourcePaperId: paperId,
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const review = buildPendingReview([
  pendingEntity('e-low', 'Obscure Thing', 'Concept', 0.4),
  pendingEntity('e-high', 'Transformer', 'Method', 0.95),
  pendingEntity('e-mid', 'BLEU', 'Metric', 0.8),
  pendingEntity('e-also', 'GLUE', 'Dataset', 0.9),
], { minConfidenceToAutoCheck: 0.75 });

// Canonical `ENTITY_TYPES` order (Method, Task, Dataset, Metric, Concept, Claim),
// so the dialog does not reshuffle between openings. Types with no candidates are
// omitted rather than rendered empty.
assert.deepEqual(
  review.map((group) => group.type),
  ['Method', 'Dataset', 'Metric', 'Concept'],
);
// Highest confidence first within a type, and pre-check follows the threshold.
assert.equal(review[0].candidates[0].entityId, 'e-high');
assert.equal(review[0].candidates[0].preChecked, true);
assert.equal(
  review.at(-1).candidates[0].entityId,
  'e-low',
  'the low-confidence candidate is listed, not dropped',
);
assert.equal(review.at(-1).candidates[0].preChecked, false, 'low confidence must not pre-check');
// Exactly the candidates at or above the threshold start ticked.
const allCandidates = review.flatMap((group) => group.candidates);
assert.equal(allCandidates.filter((candidate) => candidate.preChecked).length, 3);
assert.equal(allCandidates.length, 4);

// An empty pending set produces no groups rather than an empty group.
assert.deepEqual(buildPendingReview([], { minConfidenceToAutoCheck: 0.75 }), []);
// A nameless candidate cannot be confirmed, so it must not reach the dialog.
assert.deepEqual(
  buildPendingReview([pendingEntity('e-blank', '   ', 'Method', 0.9)], {
    minConfidenceToAutoCheck: 0.75,
  }),
  [],
);
// Determinism: the same input must produce the same order.
const stableInput = [
  pendingEntity('b', 'Beta', 'Method', 0.8),
  pendingEntity('a', 'Alpha', 'Method', 0.8),
];
assert.deepEqual(buildPendingReview(stableInput, { minConfidenceToAutoCheck: 0.5 }),
  buildPendingReview(stableInput, { minConfidenceToAutoCheck: 0.5 }));

console.log('Entity extraction and confirmation contract tests passed.');