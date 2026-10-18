import assert from 'node:assert/strict';

import {
  aggregateNodeId,
  computeDegree,
  condenseGraph,
  describeCondensation,
  isAggregateNodeId,
} from '../src/modules/knowledge-graph/domain/graph-condensation.ts';

function paper(paperId) {
  return {
    paperId, documentAgentId: paperId, fingerprint: `fp-${paperId}`, title: paperId,
    year: 2020, authors: [], venue: '', doi: '', abstract: '', folderId: null, keywords: [],
    extractionStatus: 'ready', extractionError: null, extractedAt: null,
    projectionVersion: 1, createdAt: 1, updatedAt: 1,
  };
}

function entity(entityId) {
  return {
    entityId, name: entityId, normalizedName: entityId, aliases: [], type: 'Concept',
    status: 'confirmed', confidence: 0.8, sourcePaperId: 'p1', evidence: [],
    mergedInto: null, userEdited: false, createdAt: 1, updatedAt: 1,
  };
}

function edge(id, source, target, overrides = {}) {
  return {
    edgeId: id, source, sourceKind: 'paper', target, targetKind: 'entity',
    type: 'HAS_KEYWORD', confidence: 1, evidence: [], sourcePaperId: source,
    origin: 'rule', originKey: `${source}|${target}`, provenance: {},
    createdAt: 1, updatedAt: 1, ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Degree counting.
// ---------------------------------------------------------------------------
const degrees = computeDegree([
  edge('a', 'p1', 'x'),
  edge('b', 'p2', 'x'),
  edge('c', 'p2', 'y'),
]);
assert.equal(degrees.get('x'), 2, 'two incident edges');
assert.equal(degrees.get('p2'), 2);
assert.equal(degrees.get('y'), 1);
assert.equal(degrees.get('missing'), undefined);
// Parallel relations both count: two reasons the node is not a leaf.
assert.equal(computeDegree([edge('a', 'p1', 'x'), edge('b', 'p1', 'x')]).get('x'), 2);

// ---------------------------------------------------------------------------
// Small graphs are left completely alone. Folding when the user has room to see
// everything would hide information for no benefit.
// ---------------------------------------------------------------------------
const fewPapers = [paper('p1'), paper('p2')];
const fewEntities = Array.from({ length: 10 }, (_, index) => entity(`e${index}`));
const fewEdges = [
  edge('e0-edge', 'p1', 'e0'),
  edge('e1-edge', 'p1', 'e1'),
  edge('e2-edge', 'p2', 'e2'),
];
const small = condenseGraph(fewPapers, fewEntities, fewEdges, { threshold: 100 });
assert.equal(small.condensed, false);
assert.equal(small.entities.length, fewEntities.length, 'nothing is folded below the threshold');
assert.equal(small.foldedEntityCount, 0);
assert.equal(describeCondensation(small), '', 'an untouched graph says nothing');

// ---------------------------------------------------------------------------
// Above the threshold, leaves fold and hubs stay.
// ---------------------------------------------------------------------------
// p1 and p2 are joined by a shared hub, which must survive: degree 2 is where the
// structure lives.
const hubEdges = [edge('h1', 'p1', 'hub'), edge('h2', 'p2', 'hub')];
const leaves = Array.from({ length: 60 }, (_, index) => edge(`l${index}`, 'p1', `leaf${index}`));
const entities = [
  entity('hub'),
  ...Array.from({ length: 60 }, (_, index) => entity(`leaf${index}`)),
];
const condensed = condenseGraph([paper('p1'), paper('p2')], entities, [...hubEdges, ...leaves], {
  threshold: 10,
});
assert.equal(condensed.condensed, true);
assert.ok(
  condensed.entities.some((item) => item.entityId === 'hub'),
  'a degree-2 hub is the structure, so it is never folded',
);
assert.equal(
  condensed.entities.filter((item) => isAggregateNodeId(item.entityId)).length,
  1,
  'the leaves fold into one aggregate for their owner',
);
assert.equal(condensed.aggregateCount, 1);
assert.equal(condensed.foldedEntityCount, 60);

// The aggregate is honest about what it is: a count, not a claim.
const aggregate = condensed.entities.find((item) => isAggregateNodeId(item.entityId));
assert.equal(aggregate.entityId, aggregateNodeId('paper', 'p1'));
assert.match(aggregate.name, /折叠 60 项/);
assert.match(aggregate.name, /p1/, 'the label names the owner');
assert.equal(aggregate.confidence, 0, 'a container makes no claim about the world');
assert.equal(aggregate.status, 'confirmed', 'it is structure, not a pending suggestion');

// Edges to folded leaves are gone; the hub edges and one aggregate edge remain.
assert.equal(condensed.edges.filter((item) => item.type === 'HAS_KEYWORD').length, 2);
const aggregateEdges = condensed.edges.filter(
  (item) => item.target === aggregate.entityId,
);
assert.equal(aggregateEdges.length, 1);
assert.equal(aggregateEdges[0].source, 'p1');
assert.equal(aggregateEdges[0].origin, 'rule', 'a view artefact is not a model conclusion');

// No edge is left pointing at a folded node, which is the renderer's one hard
// invariant.
const survivingIds = new Set(condensed.entities.map((item) => item.entityId));
for (const item of condensed.edges) {
  assert.ok(survivingIds.has(item.target), `edge ${item.edgeId} has a missing target`);
  if (item.sourceKind === 'entity') {
    assert.ok(survivingIds.has(item.source), `edge ${item.edgeId} has a missing source`);
  }
}

// Papers are never folded, even at degree 1: the graph is *about* documents.
assert.equal(condensed.papers.length, 2);

// ---------------------------------------------------------------------------
// Ownership and caps.
// ---------------------------------------------------------------------------
// Leaves group under their paper, not under a hub, so the label describes where
// they came from.
const perPaper = condenseGraph(
  [paper('p1'), paper('p2')],
  [
    ...Array.from({ length: 5 }, (_, index) => entity(`a${index}`)),
    ...Array.from({ length: 3 }, (_, index) => entity(`b${index}`)),
  ],
  [
    ...Array.from({ length: 5 }, (_, index) => edge(`ae${index}`, 'p1', `a${index}`)),
    ...Array.from({ length: 3 }, (_, index) => edge(`be${index}`, 'p2', `b${index}`)),
  ],
  { threshold: 4 },
);
assert.equal(perPaper.aggregateCount, 2, 'one aggregate per owner');
assert.equal(perPaper.foldedEntityCount, 8);

// Every leaf is folded and the label reports the true count: there is deliberately
// no hidden per-aggregate cap. An earlier version had one and it silently truncated
// 60 leaves to 40 while still presenting the aggregate as complete.
const bigger = condenseGraph(
  [paper('p1')],
  Array.from({ length: 100 }, (_, index) => entity(`c${index}`)),
  Array.from({ length: 100 }, (_, index) => edge(`ce${index}`, 'p1', `c${index}`)),
  { threshold: 10 },
);
assert.equal(bigger.foldedEntityCount, 100, 'no leaf is silently left behind');
assert.match(
  bigger.entities.find((item) => isAggregateNodeId(item.entityId)).name,
  /折叠 100 项/,
  'the label states the true count',
);

// An isolated entity has no owner and is dropped: it connects to nothing the graph
// is showing, so folding it would create an aggregate with no source.
const orphan = condenseGraph(
  [paper('p1')],
  [entity('alone'), ...Array.from({ length: 20 }, (_, index) => entity(`d${index}`))],
  Array.from({ length: 20 }, (_, index) => edge(`de${index}`, 'p1', `d${index}`)),
  { threshold: 5 },
);
assert.equal(
  orphan.entities.some((item) => item.entityId === 'alone'),
  false,
  'an orphan leaf is dropped rather than given a nameless container',
);

// ---------------------------------------------------------------------------
// Stability: condensing an already-condensed graph must not fold aggregates into
// aggregates, or repeated renders would keep collapsing the view.
// ---------------------------------------------------------------------------
const twice = condenseGraph(condensed.papers, condensed.entities, condensed.edges, {
  threshold: 10,
});
assert.equal(twice.condensed, false, 'aggregate nodes are not leaves');
assert.equal(twice.entities.length, condensed.entities.length);
assert.deepEqual(
  twice.entities.map((item) => item.entityId).sort(),
  condensed.entities.map((item) => item.entityId).sort(),
);

// With no entities at all there is nothing to fold, and the result is unchanged
// rather than empty.
const noEntities = condenseGraph([paper('p1')], [], [], { threshold: 0 });
assert.equal(noEntities.condensed, false);
assert.equal(noEntities.papers.length, 1);

// A graph of only papers above the threshold is also left alone: papers are never
// folded, so there is nothing to do.
const onlyPapers = condenseGraph(
  Array.from({ length: 30 }, (_, index) => paper(`p${index}`)),
  [],
  [],
  { threshold: 5 },
);
assert.equal(onlyPapers.condensed, false);
assert.equal(onlyPapers.papers.length, 30);

assert.match(describeCondensation(condensed), /已折叠 60 个低连接节点为 1 组/);

console.log('Graph condensation contract tests passed.');
