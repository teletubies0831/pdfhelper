import assert from 'node:assert/strict';

import {
  computeGraphMetrics,
  formatGraphMetrics,
  isKeywordNodeId,
  suggestGraphImprovements,
} from '../src/modules/knowledge-graph/application/graph-metrics.ts';
import { keywordSlug } from '../src/modules/knowledge-graph/application/keyword-layer.ts';
import { tagIdForName } from '../src/modules/knowledge-graph/domain/tag-identity.ts';
import { aggregateNodeId } from '../src/modules/knowledge-graph/domain/graph-condensation.ts';

function paper(paperId) {
  return {
    paperId, documentAgentId: paperId, fingerprint: `fp-${paperId}`, title: paperId,
    year: 2020, authors: [], venue: '', doi: '', abstract: '', folderId: null, keywords: [],
    extractionStatus: 'ready', extractionError: null, extractedAt: null,
    projectionVersion: 1, createdAt: 1, updatedAt: 1,
  };
}

function entity(entityId, status = 'confirmed', sourcePaperId = 'p1') {
  return {
    entityId, name: entityId, normalizedName: entityId, aliases: [], type: 'Method',
    status, confidence: 0.8, sourcePaperId, evidence: [], mergedInto: null,
    userEdited: false, createdAt: 1, updatedAt: 1,
  };
}

function keywordEntity(slug) {
  return entity(`keyword:${keywordSlug(slug)}`);
}

function paperEntityEdge(paperId, entityId, overrides = {}) {
  return {
    edgeId: `pe-${paperId}-${entityId}`, source: paperId, sourceKind: 'paper',
    target: entityId, targetKind: 'entity', type: 'MENTIONS', confidence: 0.9,
    evidence: [], sourcePaperId: paperId, origin: 'ai',
    originKey: `MENTIONS|${paperId}|${entityId}`, provenance: {},
    createdAt: 1, updatedAt: 1, ...overrides,
  };
}

function paperPaperEdge(id, source, target, overrides = {}) {
  return {
    edgeId: id, source, sourceKind: 'paper', target, targetKind: 'paper',
    type: 'EXTENDS', confidence: 0.8, evidence: [], sourcePaperId: source,
    origin: 'ai', originKey: `EXTENDS|${source}|${target}`, provenance: {},
    createdAt: 1, updatedAt: 1, ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Keyword detection: the funnel's denominator depends on it.
// ---------------------------------------------------------------------------
assert.equal(isKeywordNodeId('keyword:attention'), true);
assert.equal(isKeywordNodeId('entity:abc'), false);
assert.equal(isKeywordNodeId('tag:x'), false);

// ---------------------------------------------------------------------------
// An empty graph reports undefined rates, NOT zero. Zero reads as a measured
// failure, and "nothing has happened yet" is a different thing.
// ---------------------------------------------------------------------------
const empty = computeGraphMetrics([], [], []);
assert.equal(empty.funnel.adoptionRate, null);
assert.equal(empty.reuse.reuseRate, null);
assert.equal(empty.edges.evidenceRate, null);
assert.equal(empty.scale.entitiesPerPaper, null);
assert.equal(empty.scale.edgesPerPaper, null);
assert.equal(empty.funnel.extractionCandidates, 0);
assert.equal(empty.edges.total, 0);
// The formatted report says so rather than printing 0%.
assert.ok(formatGraphMetrics(empty).some((line) => line.includes('—')));
assert.ok(!formatGraphMetrics(empty).join('\n').includes('0%'));

// ---------------------------------------------------------------------------
// Adoption: only decided candidates count, and a merge is not a rejection.
// ---------------------------------------------------------------------------
const entities = [
  entity('k1', 'confirmed'),
  entity('k2', 'confirmed'),
  entity('k3', 'rejected'),
  entity('k4', 'pending'),
  // A merge is the user consolidating two accepted candidates, so counting it as
  // a rejection would understate adoption.
  entity('k5', 'merged'),
  keywordEntity('Attention'),
  keywordEntity('Transformer'),
];
const adopted = computeGraphMetrics([paper('p1')], entities, []);
assert.equal(adopted.funnel.confirmed, 2);
assert.equal(adopted.funnel.rejected, 1);
assert.equal(adopted.funnel.pending, 1);
assert.equal(adopted.funnel.merged, 1);
assert.equal(adopted.funnel.keywordNodes, 2, 'keyword nodes are counted separately');
assert.equal(
  adopted.funnel.extractionCandidates,
  4,
  'extraction candidates exclude merges and keyword nodes',
);
// 2 confirmed / (2 confirmed + 1 rejected)
assert.equal(Number(adopted.funnel.adoptionRate.toFixed(4)), Number((2 / 3).toFixed(4)));
// Keyword nodes are excluded from the entity total: they are rule-derived, so
// including them would make every rate look healthier than it is.
assert.equal(adopted.scale.entities, 5);

// Nothing decided yet: the rate is undefined, not 0%.
const undecided = computeGraphMetrics(
  [paper('p1')],
  [entity('a', 'pending'), entity('b', 'pending')],
  [],
);
assert.equal(undecided.funnel.adoptionRate, null);
assert.equal(undecided.funnel.extractionCandidates, 2);

// ---------------------------------------------------------------------------
// Reuse: the headline number for "is this a graph or a pile of documents".
// ---------------------------------------------------------------------------
const papers = [paper('p1'), paper('p2'), paper('p3')];
const reuseEntities = [
  entity('shared', 'confirmed', 'p1'),
  entity('only-p1', 'confirmed', 'p1'),
  entity('only-p2', 'confirmed', 'p2'),
];
const reuseEdges = [
  // `shared` is attached to both p1 and p2 — the mechanism that connects papers
  // for free.
  paperEntityEdge('p1', 'shared'),
  paperEntityEdge('p2', 'shared'),
  paperEntityEdge('p1', 'only-p1'),
  paperEntityEdge('p2', 'only-p2'),
];
const reuse = computeGraphMetrics(papers, reuseEntities, reuseEdges);
assert.equal(reuse.reuse.sharedEntities, 1);
assert.equal(reuse.reuse.singleUseEntities, 2);
assert.equal(reuse.reuse.connectedPapers, 2);
assert.equal(Number(reuse.reuse.reuseRate.toFixed(4)), Number((1 / 3).toFixed(4)));

// An entity attached to one paper twice is still single-use: counting edges rather
// than distinct papers would overstate reuse.
const duplicateAttach = computeGraphMetrics(
  [paper('p1')],
  [entity('e', 'confirmed')],
  [paperEntityEdge('p1', 'e'), paperEntityEdge('p1', 'e', { edgeId: 'second' })],
);
assert.equal(duplicateAttach.reuse.sharedEntities, 0);
assert.equal(duplicateAttach.reuse.singleUseEntities, 1);

// An entity linked only to another entity does not count as reaching a document.
const entityEntityOnly = computeGraphMetrics(
  [paper('p1')],
  [entity('a', 'confirmed'), entity('b', 'confirmed')],
  [{
    edgeId: 'ee', source: 'a', sourceKind: 'entity', target: 'b', targetKind: 'entity',
    type: 'PART_OF', confidence: 0.9, evidence: [], sourcePaperId: 'p1',
    origin: 'ai', originKey: 'PART_OF|a|b', provenance: {}, createdAt: 1, updatedAt: 1,
  }],
);
assert.equal(entityEntityOnly.reuse.sharedEntities, 0);
assert.equal(entityEntityOnly.reuse.singleUseEntities, 2);

// Keyword nodes are excluded from reuse: a keyword appearing in two papers is
// expected and does not mean the *user's* extraction connected anything.
const keywordReuse = computeGraphMetrics(
  [paper('p1'), paper('p2')],
  [keywordEntity('Attention')],
  [
    paperEntityEdge('p1', `keyword:${keywordSlug('Attention')}`),
    paperEntityEdge('p2', `keyword:${keywordSlug('Attention')}`),
  ],
);
assert.equal(keywordReuse.reuse.sharedEntities, 0, 'rule-derived sharing is not adoption');

// ---------------------------------------------------------------------------
// Edge composition and evidence.
// ---------------------------------------------------------------------------
const composition = computeGraphMetrics(
  [paper('p1'), paper('p2')],
  [entity('e', 'confirmed')],
  [
    paperEntityEdge('p1', 'e'),
    paperEntityEdge('p1', 'e', {
      edgeId: 'with-evidence', originKey: 'MENTIONS|p1|e2',
      evidence: [{ paperId: 'p1', pageNumber: 1, quote: 'a real quote' }],
    }),
    paperEntityEdge('p1', 'e', {
      edgeId: 'rule-edge', origin: 'rule', originKey: 'HAS_KEYWORD|p1|keyword:x',
    }),
    paperEntityEdge('p1', 'e', {
      edgeId: 'user-edge', origin: 'user', originKey: 'TAGGED|p1|tag:x',
    }),
    paperPaperEdge('pp', 'p1', 'p2', {
      evidence: [{ paperId: 'p1', pageNumber: 2, quote: 'q' }],
    }),
    paperPaperEdge('negative', 'p1', 'p2', {
      type: 'NO_RELATION', confidence: 0, originKey: 'NO_RELATION|p1|p2',
    }),
  ],
);
assert.equal(composition.edges.total, 6);
assert.equal(composition.edges.ai, 4);
assert.equal(composition.edges.rule, 1);
assert.equal(composition.edges.user, 1);
assert.equal(composition.edges.paperPaper, 2);
assert.equal(composition.edges.negative, 1);
// Edges with a non-empty quote, so an evidence array holding only a page marker
// does not count as evidence.
assert.equal(composition.edges.withEvidence, 2);
assert.equal(Number(composition.edges.evidenceRate.toFixed(4)), Number((2 / 6).toFixed(4)));

// An evidence entry with a blank quote is not evidence.
const blankEvidence = computeGraphMetrics(
  [paper('p1')],
  [entity('e', 'confirmed')],
  [paperEntityEdge('p1', 'e', {
    evidence: [{ paperId: 'p1', pageNumber: 1, quote: '   ' }],
  })],
);
assert.equal(blankEvidence.edges.withEvidence, 0);

// ---------------------------------------------------------------------------
// Aggregates are view artefacts: counting them would inflate every total as soon
// as the graph got large enough to fold.
// ---------------------------------------------------------------------------
const withAggregate = computeGraphMetrics(
  [paper('p1')],
  [
    entity('e', 'confirmed'),
    entity(aggregateNodeId('paper', 'p1'), 'confirmed'),
    entity(tagIdForName('to-read'), 'confirmed'),
  ],
  [
    paperEntityEdge('p1', 'e'),
    {
      edgeId: 'agg-edge', source: 'p1', sourceKind: 'paper',
      target: aggregateNodeId('paper', 'p1'), targetKind: 'entity',
      type: 'RELATED_TO', confidence: 0, evidence: [], sourcePaperId: 'p1',
      origin: 'rule', originKey: 'RELATED_TO|p1|agg', provenance: {},
      createdAt: 1, updatedAt: 1,
    },
  ],
);
assert.equal(withAggregate.scale.entities, 2, 'the aggregate node is not an entity');
assert.equal(withAggregate.edges.total, 1, 'nor is its edge counted');
// A tag node id does not start with the keyword prefix, so it counts as a real
// node — tags are user-created, not rule-derived vocabulary.
assert.equal(withAggregate.funnel.keywordNodes, 0);

// ---------------------------------------------------------------------------
// Papers without entities: the signal that extraction never ran.
// ---------------------------------------------------------------------------
const coverage = computeGraphMetrics(
  [paper('p1'), paper('p2'), paper('p3')],
  [entity('e', 'confirmed', 'p1')],
  [paperEntityEdge('p1', 'e')],
);
assert.equal(coverage.scale.papersWithoutEntities, 2);
assert.equal(coverage.scale.papers, 3);
assert.equal(Number(coverage.scale.entitiesPerPaper.toFixed(4)), Number((1 / 3).toFixed(4)));
assert.equal(Number(coverage.scale.edgesPerPaper.toFixed(4)), Number((1 / 3).toFixed(4)));

// An entity whose sourcePaperId names a paper that is not in the graph does not
// count as covering anything.
const staleSource = computeGraphMetrics(
  [paper('p1')],
  [entity('e', 'confirmed', 'deleted-paper')],
  [],
);
assert.equal(staleSource.scale.papersWithoutEntities, 1);

// ---------------------------------------------------------------------------
// Suggestions are tied to specific measurements, so the user can see why.
// ---------------------------------------------------------------------------
assert.deepEqual(suggestGraphImprovements(empty), [], 'nothing to advise on an empty graph');

// A collapsing adoption rate is the signal that the prompt is producing noise.
const poorAdoption = computeGraphMetrics(
  [paper('p1')],
  [
    entity('a', 'confirmed'),
    ...Array.from({ length: 12 }, (_, index) => entity(`r${index}`, 'rejected')),
  ],
  [],
);
const adoptionAdvice = suggestGraphImprovements(poorAdoption);
assert.ok(adoptionAdvice.some((line) => line.includes('采纳率')));
assert.ok(adoptionAdvice.some((line) => line.includes('候选上限')), 'the advice names a concrete lever');

// A high adoption rate produces no such advice.
const goodAdoption = computeGraphMetrics(
  [paper('p1')],
  [...Array.from({ length: 12 }, (_, index) => entity(`c${index}`, 'confirmed'))],
  [],
);
assert.ok(!suggestGraphImprovements(goodAdoption).some((line) => line.includes('采纳率')));

// A graph with papers but no shared entity gets the reuse hint.
const noReuse = computeGraphMetrics(
  [paper('p1'), paper('p2'), paper('p3'), paper('p4')],
  [entity('only', 'confirmed', 'p1')],
  [paperEntityEdge('p1', 'only')],
);
assert.ok(suggestGraphImprovements(noReuse).some((line) => line.includes('共享实体')));

// A large pending backlog is called out.
const backlog = computeGraphMetrics(
  [paper('p1')],
  Array.from({ length: 60 }, (_, index) => entity(`p${index}`, 'pending')),
  [],
);
assert.ok(suggestGraphImprovements(backlog).some((line) => line.includes('待确认')));

// Papers without an index are named as the likely cause.
assert.ok(
  suggestGraphImprovements(noReuse).some((line) => line.includes('全文索引')),
);

// ---------------------------------------------------------------------------
// The report is a list of lines meant to be read together.
// ---------------------------------------------------------------------------
const report = formatGraphMetrics(composition);
assert.ok(report.length >= 4);
assert.ok(report.every((line) => line.length > 0), 'no empty lines are emitted');
assert.ok(report.some((line) => line.includes('边构成')));
assert.ok(report.some((line) => line.includes('采纳率')));
assert.ok(report.some((line) => line.includes('复用率')));

console.log('Graph metrics contract tests passed.');
