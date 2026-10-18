import assert from 'node:assert/strict';

import {
  buildAdjacency,
  buildSubgraph,
  findIndirectlyConnectedPapers,
  isRenderableEdge,
} from '../src/modules/knowledge-graph/domain/graph-query.ts';
import { buildSharedEntityBridges } from '../src/modules/knowledge-graph/domain/shared-entity-bridges.ts';
import {
  createEdgeOriginKey,
  clampConfidence,
  normalizeEdgeEndpoints,
  pruneDanglingEdges,
} from '../src/modules/knowledge-graph/domain/graph-identity.ts';
import {
  findRemovedPaperIds,
  projectPaperFromSource,
  syncPaperProjections,
} from '../src/modules/knowledge-graph/domain/paper-projection.ts';
import {
  joinKnowledgePaperSources,
  knowledgePaperIds,
} from '../src/modules/knowledge-graph/application/paper-source.ts';
import { shouldWriteProjection } from '../src/modules/knowledge-graph/domain/paper-projection-plan.ts';
import {
  buildEntityTranslationPrompt,
  createEntityTranslator,
  needsTranslation,
  parseEntityTranslations,
  MAX_TERMS_PER_REQUEST,
} from '../src/viewer/features/knowledge-graph/entity-translation-plan.ts';
import {
  abbreviationLeadsName,
  extractAbbreviationPairs,
  isAbbreviationOf,
  suggestAbbreviationMerges,
} from '../src/modules/knowledge-graph/domain/entity-abbreviations.ts';
import {
  buildEntitySynonymPrompt,
  createEntitySynonymChecker,
  parseEntitySynonyms,
} from '../src/viewer/features/knowledge-graph/entity-synonym-plan.ts';
import { buildMergeReview } from '../src/modules/knowledge-graph/application/merge-review.ts';
import { planEntityConfirmation } from '../src/modules/knowledge-graph/application/entity-planning.ts';
import { planPendingCandidateUpsert, MIN_PENDING_CONFIDENCE } from '../src/modules/knowledge-graph/application/pending-candidates.ts';
import {
  dismissEntityCandidates,
  clearMergeRejections,
  loadPendingReview,
  reconcileIgnoredPendingCandidates,
  rejectMergeSuggestion,
} from '../src/modules/knowledge-graph/application/entity-service.ts';
import {
  mergePairKey,
  normalizeMergeRejections,
} from '../src/modules/knowledge-graph/domain/merge-rejection.ts';
import {
  EDGE_TYPE_LABELS,
  describeEdgeType,
  edgeTypeLabel,
} from '../src/modules/knowledge-graph/domain/edge-labels.ts';
import { DERIVED_EDGE_TYPES, EDGE_TYPES, ENTITY_TYPES } from '../src/modules/knowledge-graph/contracts.ts';
import { nodeFill, resolveGraphTheme } from '../src/viewer/features/knowledge-graph/graph-theme.ts';
import { assessEntityName, variantBaseOf } from '../src/modules/knowledge-graph/domain/entity-name-quality.ts';
import { parseEntityCandidates } from '../src/modules/knowledge-graph/application/candidate-parsing.ts';
import { normalizeEntityName } from '../src/modules/knowledge-graph/domain/entity-normalization.ts';
import {
  buildKeywordEdges,
  buildKeywordEntities,
  findStaleKeywordOriginKeys,
} from '../src/modules/knowledge-graph/application/keyword-layer.ts';
import {
  normalizeKnowledgeGraphSettings,
} from '../src/modules/knowledge-graph/domain/graph-settings.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_OPTIONS,
  springForLink,
} from '../src/modules/knowledge-graph/domain/graph-force-layout.ts';
import {
  SHARED_PAPER_DEGREE,
  buildNodeRoleIndex,
} from '../src/modules/knowledge-graph/domain/paper-degree.ts';
import {
  boundsOfPoints,
  clampScale,
  fitViewport,
  zoomAt,
} from '../src/viewer/features/knowledge-graph/graph-viewport.ts';
import {
  buildRenderModel,
  confidenceAlpha,
  dashPatternForOrigin,
  distanceToSegment,
  radiusForDegree,
  truncateLabel,
} from '../src/modules/knowledge-graph/domain/graph-render-model.ts';
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RAW_PAPER = {
  id: 'doc:1',
  documentId: 'doc:1',
  fingerprint: 'fp-1',
  title: 'Attention Is All You Need',
  authors: ['Vaswani', 'Shazeer'],
  year: 2017,
  abstract: 'We propose the Transformer.',
  keywords: ['Transformer', 'Attention', 'Transformer'],
  pageCount: 11,
  currentPage: 1,
  readingCount: 1,
  firstOpenedAt: 1,
  lastOpenedAt: 2,
};

/** A knowledge-base document; the fields the graph's projection actually reads. */
function knowledgeDoc(documentId, documentName, folderId = null) {
  return {
    documentId,
    documentName,
    pageCount: 11,
    folderId,
    addedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    indexStatus: 'ready',
    chunkCount: 12,
  };
}

const KNOWLEDGE_DOC = knowledgeDoc('doc:1', 'Attention Is All You Need', 'f1');
const SOURCE = joinKnowledgePaperSources({
  documents: [KNOWLEDGE_DOC],
  libraryRecords: [RAW_PAPER],
})[0];

function paper(paperId, fingerprint = `fp-${paperId}`) {
  return {
    paperId,
    documentAgentId: paperId,
    fingerprint,
    title: `Paper ${paperId}`,
    year: 2020,
    authors: [],
    venue: '',
    doi: '',
    abstract: '',
    folderId: null,
    keywords: [],
    extractionStatus: 'none',
    extractionError: null,
    extractedAt: null,
    projectionVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function entity(entityId, name = entityId) {
  return {
    entityId,
    name,
    normalizedName: name.toLowerCase(),
    aliases: [],
    type: 'Method',
    status: 'confirmed',
    confidence: 0.9,
    sourcePaperId: 'p1',
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function edge(overrides) {
  return {
    edgeId: `edge:${overrides.originKey}`,
    source: 'p1',
    sourceKind: 'paper',
    target: 'e1',
    targetKind: 'entity',
    type: 'USES',
    confidence: 0.8,
    evidence: [],
    sourcePaperId: 'p1',
    origin: 'ai',
    originKey: overrides.originKey,
    provenance: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Edge identity: the unique originKey index is the token-saving guarantee, so
// its key derivation must be stable and order-insensitive for undirected types.
// ---------------------------------------------------------------------------
assert.equal(
  createEdgeOriginKey('a', 'b', 'CITES', false),
  'CITES|a|b',
);
assert.equal(
  createEdgeOriginKey('b', 'a', 'CITES', false),
  'CITES|b|a',
);
assert.equal(
  createEdgeOriginKey('b', 'a', 'SIMILAR_TO', true),
  createEdgeOriginKey('a', 'b', 'SIMILAR_TO', true),
  'undirected edges must collapse onto one originKey regardless of order',
);
assert.deepEqual(normalizeEdgeEndpoints('b', 'a', true), ['a', 'b']);
assert.deepEqual(normalizeEdgeEndpoints('b', 'a', false), ['b', 'a']);
assert.equal(clampConfidence(undefined), 0.5);
assert.equal(clampConfidence(5), 1);
assert.equal(clampConfidence(-3), 0);

// ---------------------------------------------------------------------------
// Shared entities must connect papers indirectly with no LLM involvement.
// ---------------------------------------------------------------------------
const sharedEdges = [
  edge({ originKey: 'USES|p1|e1', source: 'p1', target: 'e1' }),
  edge({ originKey: 'USES|p2|e1', source: 'p2', target: 'e1' }),
  edge({ originKey: 'USES|p2|e2', source: 'p2', target: 'e2' }),
  edge({ originKey: 'USES|p3|e2', source: 'p3', target: 'e2' }),
];
const indirect = findIndirectlyConnectedPapers('p1', sharedEdges);
assert.equal(indirect.length, 1, 'p1 reaches exactly one other paper through e1');
assert.equal(indirect[0].paperId, 'p2');
assert.deepEqual(indirect[0].viaEntityIds, ['e1']);

const adjacency = buildAdjacency(sharedEdges);
assert.equal(adjacency.get('entity:e1').length, 2, 'e1 is shared by two papers');
assert.equal(adjacency.get('paper:p1').length, 1);

// One-hop focus reaches the entity but not the sibling paper; two hops does.
const papers = [paper('p1'), paper('p2')];
const entities = [entity('e1')];
const oneHop = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 1 },
  papers,
  entities,
  sharedEdges,
);
assert.equal(oneHop.papers.length, 1);
assert.equal(oneHop.entities.length, 1);

const twoHop = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 2 },
  papers,
  entities,
  sharedEdges,
);
assert.equal(twoHop.papers.length, 2, 'two hops must reach the sibling paper');
assert.equal(twoHop.edges.length, 2);

// Confidence filtering.
const filtered = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 2, minConfidence: 0.95 },
  papers,
  entities,
  sharedEdges,
);
assert.equal(filtered.edges.length, 0, 'edges below the confidence floor are dropped');

// Edge-type filtering.
const typed = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 2, edgeTypes: ['CITES'] },
  papers,
  entities,
  sharedEdges,
);
assert.equal(typed.edges.length, 0);

// The whole-graph path must respect the node cap rather than laying out everything.
const wholeGraph = buildSubgraph({ maxNodes: 2 }, papers, entities, sharedEdges);
assert.ok(wholeGraph.truncated, 'exceeding maxNodes must report truncation');

// The renderer must never be handed an edge with a missing endpoint.
assert.deepEqual(
  pruneDanglingEdges(sharedEdges, new Set(['p1']), new Set(['e1'])).length,
  1,
);

// ---------------------------------------------------------------------------
// A recorded "no relation" is a cache entry, not a relationship.
//
// Drawing it made the graph claim things it had explicitly denied — and once edge
// labels were removed from the canvas, a negative looked exactly like a real
// conclusion. It must be invisible at every entry point, not merely styled fainter.
// ---------------------------------------------------------------------------
const negativeRecord = edge({
  originKey: 'NO_RELATION|p1|p2',
  source: 'p1',
  sourceKind: 'paper',
  target: 'p2',
  targetKind: 'paper',
  type: 'NO_RELATION',
  confidence: 0,
  origin: 'ai',
});
assert.equal(isRenderableEdge(negativeRecord), false, 'a negative record must never be drawn');
assert.equal(
  isRenderableEdge(edge({ originKey: 'CITES|p1|p2', source: 'p1', target: 'p2', targetKind: 'paper', type: 'CITES' })),
  true,
  'a real conclusion stays drawable',
);

const withNegative = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 2 },
  papers,
  entities,
  [...sharedEdges, negativeRecord],
);
assert.ok(
  !withNegative.edges.some((item) => item.type === 'NO_RELATION'),
  'buildSubgraph must drop the negative record, not just the UI layer',
);
assert.equal(withNegative.papers.length, 2, 'p2 is still reached, through the shared entity');

// It must not count as a connection either: with only the negative record around,
// the pair is not connected at all.
const negativeOnly = buildSubgraph(
  { focusId: 'p1', focusKind: 'paper', hops: 2 },
  papers,
  entities,
  [negativeRecord],
);
assert.equal(negativeOnly.edges.length, 0);
assert.equal(negativeOnly.papers.length, 1, 'a denied pair must not be walked as an edge');

// The whole-graph path filters the same way, so a corpus of nothing but negatives
// renders an empty canvas rather than a line per denied pair.
const negativeWhole = buildSubgraph({}, papers, entities, [negativeRecord, { ...negativeRecord, edgeId: 'x' }]);
assert.equal(negativeWhole.edges.length, 0);
assert.equal(negativeWhole.papers.length, 0, 'negative-only nodes must not be seeded by it');

// ---------------------------------------------------------------------------
// Derived bridges: two papers sharing ≥2 confirmed entities get one direct line.
//
// The two-hop path exists already, but on a small canvas a hub with spokes does not
// read as "these two documents are about the same thing". The bridge is derived in the
// render pass only — never stored — so it cannot go stale or leak into an export.
// ---------------------------------------------------------------------------
const bridgeEdges = [
  edge({ originKey: 'USES|p1|e1', source: 'p1', target: 'e1' }),
  edge({ originKey: 'USES|p2|e1', source: 'p2', target: 'e1' }),
  edge({ originKey: 'USES|p1|e2', source: 'p1', target: 'e2' }),
  edge({ originKey: 'USES|p2|e2', source: 'p2', target: 'e2' }),
  // A third paper shares only one entity with the others: not enough.
  edge({ originKey: 'USES|p3|e1', source: 'p3', target: 'e1' }),
];
const bridgePapers = [paper('p1'), paper('p2'), paper('p3')];
const bridgeEntities = [entity('e1'), entity('e2')];

const bridges = buildSharedEntityBridges(bridgePapers, bridgeEntities, bridgeEdges, { now: 1 });
assert.equal(bridges.length, 1, 'only the pair sharing two confirmed entities qualifies');
assert.deepEqual(bridges[0].sharedEntityIds, ['e1', 'e2']);
assert.equal(bridges[0].edge.type, 'SHARED_ENTITIES');
assert.equal(bridges[0].edge.origin, 'rule');
assert.equal(bridges[0].edge.sourceKind, 'paper');
assert.equal(bridges[0].edge.targetKind, 'paper');
assert.deepEqual(
  [bridges[0].edge.source, bridges[0].edge.target],
  ['p1', 'p2'],
  'endpoints are sorted so the id is stable',
);
assert.equal(
  bridges[0].edge.originKey,
  createEdgeOriginKey('p2', 'p1', 'SHARED_ENTITIES', true),
  'the originKey collapses onto one record regardless of discovery order',
);
assert.deepEqual(
  buildSharedEntityBridges([...bridgePapers].reverse(), bridgeEntities, [...bridgeEdges].reverse(), { now: 1 })
    .map((bridge) => bridge.edge.edgeId),
  bridges.map((bridge) => bridge.edge.edgeId),
  'the result must not depend on input order',
);

// A pending candidate is a suggestion; drawing structure from suggestions would let
// the model assert relationships the user never accepted.
assert.equal(
  buildSharedEntityBridges(bridgePapers, [{ ...entity('e1'), status: 'pending' }, entity('e2')], bridgeEdges, { now: 1 })
    .length,
  0,
  'pending entities must not create bridges',
);

// Never on top of a judged pair: the stored conclusion is the better answer.
assert.equal(
  buildSharedEntityBridges(bridgePapers, bridgeEntities, bridgeEdges, {
    now: 1,
    judgedPairKeys: new Set(['p1|p2']),
  }).length,
  0,
  'a judged pair must not also get a derived line',
);

// The minimum is a knob (the settings could expose it), but never below 1.
assert.equal(
  buildSharedEntityBridges(bridgePapers, bridgeEntities, bridgeEdges, { now: 1, minShared: 1 }).length,
  3,
  'minShared 1 links every pair that shares anything',
);
assert.equal(
  buildSharedEntityBridges(bridgePapers, bridgeEntities, bridgeEdges, { now: 1, minShared: 0 }).length,
  3,
  'minShared is clamped to at least 1',
);
assert.equal(buildSharedEntityBridges([paper('p1')], bridgeEntities, bridgeEdges, { now: 1 }).length, 0);
assert.equal(buildSharedEntityBridges(bridgePapers, [], bridgeEdges, { now: 1 }).length, 0);

// The bridge is derived, so it must never be offered as a storeable edge type: no
// repository may write one, and the canvas must be able to draw it.
assert.ok(
  DERIVED_EDGE_TYPES.includes('SHARED_ENTITIES'),
  'the type is marked derived so imports and exports can refuse it',
);
assert.equal(edgeTypeLabel('SHARED_ENTITIES'), '共享实体');

// ---------------------------------------------------------------------------
// Paper source: the knowledge base decides membership, the library only enriches.
//
// This is the correction of a modelling error, not a preference: projecting every PDF ever
// opened is what left 10 papers in the graph after the user emptied the knowledge base, and
// what silently undid a knowledge-base removal on the next sync.
// ---------------------------------------------------------------------------
assert.deepEqual(SOURCE, {
  documentId: 'doc:1',
  title: 'Attention Is All You Need',
  folderId: 'f1',
  fingerprint: 'fp-1',
  year: 2017,
  authors: ['Vaswani', 'Shazeer'],
  abstract: 'We propose the Transformer.',
  keywords: ['Transformer', 'Attention', 'Transformer'],
});

// A library record for a document that is not in the knowledge base is not a member.
const membership = joinKnowledgePaperSources({
  documents: [KNOWLEDGE_DOC],
  libraryRecords: [
    RAW_PAPER,
    { ...RAW_PAPER, id: 'doc:9', documentId: 'doc:9', title: 'Never Added To The Knowledge Base' },
  ],
});
assert.deepEqual(
  membership.map((source) => source.documentId),
  ['doc:1'],
  'being opened is not a reason to be in the graph',
);

// A knowledge-base document with no library record is still a paper: the gap is empty
// metadata, not a missing document.
const withoutLibrary = joinKnowledgePaperSources({
  documents: [knowledgeDoc('doc:2', 'BERT', null)],
  libraryRecords: [],
});
assert.deepEqual(withoutLibrary, [{
  documentId: 'doc:2',
  title: 'BERT',
  folderId: null,
  fingerprint: '',
  year: null,
  authors: [],
  abstract: '',
  keywords: [],
}]);
// Missing metadata must not stop the projection from producing a usable paper.
const barePaper = projectPaperFromSource(withoutLibrary[0], {}, 400);
assert.equal(barePaper.paperId, 'doc:2');
assert.equal(barePaper.title, 'BERT');
assert.equal(barePaper.keywords.length, 0);

// The title is the knowledge base's name for the document, not the library's.
const renamed = joinKnowledgePaperSources({
  documents: [knowledgeDoc('doc:3', 'Renamed In Knowledge Base')],
  libraryRecords: [{ ...RAW_PAPER, id: 'doc:3', documentId: 'doc:3', title: 'Stale Library Title' }],
});
assert.equal(renamed[0].title, 'Renamed In Knowledge Base');
// A blank name degrades to the same placeholder the projection always used.
assert.equal(
  projectPaperFromSource(
    joinKnowledgePaperSources({ documents: [knowledgeDoc('doc:4', '   ')], libraryRecords: [] })[0],
    {},
    401,
  ).title,
  '未命名 PDF',
);
// Duplicate ids collapse to one paper; a damaged entry with a blank id is dropped entirely.
assert.deepEqual(
  joinKnowledgePaperSources({
    documents: [knowledgeDoc('doc:5', 'Once'), knowledgeDoc('doc:5', 'Twice'), knowledgeDoc('  ', 'Nameless')],
    libraryRecords: [],
  }).map((source) => source.title),
  ['Once'],
);
// A non-finite year is not a year.
assert.equal(
  joinKnowledgePaperSources({
    documents: [knowledgeDoc('doc:6', 'No Year')],
    libraryRecords: [{ ...RAW_PAPER, documentId: 'doc:6', year: Number.NaN }],
  })[0].year,
  null,
);

// The allowed-id set matches what the projection would produce, so the cleanup pass and the
// sync cannot disagree about which papers may exist.
assert.deepEqual(knowledgePaperIds([KNOWLEDGE_DOC, knowledgeDoc('  ', 'blank')]), new Set(['doc:1']));

// ---------------------------------------------------------------------------
// Paper projection: graph stores a projection, not a second source of truth.
// ---------------------------------------------------------------------------
const projected = projectPaperFromSource(SOURCE, { folderId: 'f1' }, 100);
assert.equal(projected.paperId, 'doc:1');
assert.equal(projected.documentAgentId, 'doc:1');
assert.deepEqual(projected.keywords, ['Transformer', 'Attention', 'Transformer']);
assert.equal(projected.folderId, 'f1');
assert.equal(projected.createdAt, 100);
assert.equal(projected.extractionStatus, 'none');
// The folder is the knowledge base's, so no metadata override is needed for it.
assert.equal(projectPaperFromSource(SOURCE, {}, 101).folderId, 'f1');
// An override with a value still wins (the personal layer uses it); `null` means "no
// override" rather than "clear the folder", because the metadata object is optional.
assert.equal(projectPaperFromSource(SOURCE, { folderId: 'f9' }, 102).folderId, 'f9');
assert.equal(projectPaperFromSource(SOURCE, { folderId: null }, 103).folderId, 'f1');

assert.equal(shouldWriteProjection(undefined, projected), true);
assert.equal(
  shouldWriteProjection(projected, { ...projected, updatedAt: 999 }),
  false,
  'a bumped updatedAt alone must not count as a change',
);
assert.equal(
  shouldWriteProjection(projected, { ...projected, title: 'Renamed' }),
  true,
);

const sync = syncPaperProjections(
  [SOURCE],
  [{ ...projected, title: 'Stale title' }],
  new Map(),
  200,
);
assert.equal(sync.written, 1, 'a real field change must be written');
assert.equal(sync.papers[0].title, SOURCE.title);
assert.equal(sync.papers[0].createdAt, 100, 'createdAt survives re-projection');

const noopSync = syncPaperProjections([SOURCE], sync.papers, new Map(), 300);
assert.equal(noopSync.written, 0, 'an unchanged knowledge base must not rewrite every paper');
// A stored paper whose source is gone is reported, not deleted here: deleting the row alone
// would strand the entities and edges it supported, so the caller runs the cascade cleanup.
assert.deepEqual(findRemovedPaperIds([], sync.papers), ['doc:1']);
assert.deepEqual(findRemovedPaperIds([SOURCE], sync.papers), []);

// ---------------------------------------------------------------------------
// Keyword layer: the zero-cost fallback that works with no API key.
// ---------------------------------------------------------------------------
const keywordEdges = buildKeywordEdges(projected, [], 500);
assert.equal(keywordEdges.length, 2, 'the duplicate keyword must not produce two edges');
assert.ok(keywordEdges.every((item) => item.type === 'HAS_KEYWORD'));
assert.ok(keywordEdges.every((item) => item.origin === 'rule'));
assert.ok(
  keywordEdges.every((item) => item.sourceKind === 'paper' && item.targetKind === 'entity'),
);

// Re-running is idempotent: same origin keys, edge ids reused.
const rerun = buildKeywordEdges(projected, keywordEdges, 600);
assert.deepEqual(
  rerun.map((item) => item.originKey).sort(),
  keywordEdges.map((item) => item.originKey).sort(),
);
assert.deepEqual(
  rerun.map((item) => item.edgeId).sort(),
  keywordEdges.map((item) => item.edgeId).sort(),
  're-syncing must reuse edge ids instead of duplicating',
);

// Removing a keyword makes its edge stale.
const shrunk = { ...projected, keywords: ['Transformer'] };
assert.deepEqual(
  findStaleKeywordOriginKeys(shrunk, keywordEdges),
  ['HAS_KEYWORD|doc:1|keyword:attention'],
);

const keywordEntities = buildKeywordEntities(keywordEdges, [projected], 700);
assert.equal(keywordEntities.length, 2);
assert.ok(keywordEntities.every((item) => item.type === 'Concept'));
assert.ok(
  keywordEntities.some((item) => item.name === 'Transformer'),
  'keyword node label must restore the original casing',
);

// ---------------------------------------------------------------------------
// Settings normalization: bad input must never produce a broken runtime config.
// ---------------------------------------------------------------------------
const settings = normalizeKnowledgeGraphSettings({
  keywordLayerEnabled: false,
  minConfidenceToAutoCheck: 9,
  relationTopK: 0,
  maximalRecallCandidates: 10_000,
  maxConcurrentAiRequests: -4,
  embeddingMode: 'nonsense',
  ignoredEntityNames: ['  ', 'BERT', 7],
});
assert.equal(settings.keywordLayerEnabled, false);
assert.equal(settings.minConfidenceToAutoCheck, 1);
assert.equal(settings.relationTopK, 1);
assert.equal(settings.maximalRecallCandidates, 200);
assert.equal(settings.maxConcurrentAiRequests, 1);
assert.equal(settings.embeddingMode, 'off', 'embedding defaults to off');
assert.deepEqual(settings.ignoredEntityNames, ['BERT']);

const defaulted = normalizeKnowledgeGraphSettings(undefined);
assert.equal(defaulted.embeddingMode, 'off');
assert.equal(defaulted.relationTopK, 5);
assert.equal(defaulted.keywordLayerEnabled, true);
assert.equal(defaulted.keywordLayerEnabled, true, 'the keyword layer stays on by default');

// ---------------------------------------------------------------------------
// Settings carry no removed-paper list any more.
//
// It existed only because the graph projected the reading history, which has no delete path;
// with the knowledge base deciding membership, "not in the graph" is simply "not in the
// knowledge base", and a second record of the same fact would just contradict it. The old
// field is read and dropped rather than preserved, so a stored record from before the switch
// normalizes cleanly instead of throwing.
// ---------------------------------------------------------------------------
const legacySettings = normalizeKnowledgeGraphSettings({
  excludedPapers: [{ paperId: 'doc-1', title: 'Attention Is All You Need' }],
});
assert.equal('excludedPapers' in legacySettings, false, 'the retired field is not carried forward');
assert.equal(legacySettings.relationTopK, 5, 'the rest of a legacy settings record still normalizes');

// ---------------------------------------------------------------------------
// Candidate glosses: a reading aid, never a rename.
// ---------------------------------------------------------------------------
assert.equal(needsTranslation('Boyar-Perralta heuristic'), true);
assert.equal(needsTranslation('基于图神经网络的排序'), false, 'already Chinese: nothing to gloss');
assert.equal(needsTranslation('Transformer 架构'), true, 'mixed terms are worth a gloss');

// The prompt names every term once, one per line, and forbids prose in the reply.
const glossPrompt = buildEntityTranslationPrompt(['Boyar-Perralta heuristic', 'SAT solver']);
assert.match(glossPrompt, /^你在帮我审阅/m);
assert.equal(
  (glossPrompt.match(/^- /gm) ?? []).length,
  2,
  'exactly the requested terms, one per line',
);
assert.match(glossPrompt, /\{"items":\[\{"term":"原文术语","zh":"中文译名"\}\]\}/, 'the reply shape is stated');

// The documented shape is read back.
assert.deepEqual(
  [...parseEntityTranslations(
    '```json\n{"items":[{"term":"SAT solver","zh":"SAT 求解器"}]}\n```',
    ['SAT solver'],
  )],
  [['SAT solver', 'SAT 求解器']],
);
// A flat object is accepted too, and case does not have to match the request.
assert.deepEqual(
  [...parseEntityTranslations('{"boyar-perralta heuristic":"Boyar-Peralta 启发式"}', ['Boyar-Perralta heuristic'])],
  [['Boyar-Perralta heuristic', 'Boyar-Peralta 启发式']],
);
// Nothing that was not asked for survives, and a refusal is not a translation.
assert.equal(
  parseEntityTranslations(
    '{"items":[{"term":"not requested","zh":"不该出现"},{"term":"SAT solver","zh":"  "},{"term":"DPLL","zh":"DPLL"}]}',
    ['SAT solver', 'DPLL'],
  ).size,
  0,
  'unknown terms, blank glosses and echoed originals are all dropped',
);

// One request for the whole batch, and a second call for the same names costs nothing.
{
  const prompts = [];
  const translator = createEntityTranslator(async (prompt) => {
    prompts.push(prompt);
    return '{"items":[{"term":"SAT solver","zh":"SAT 求解器"},{"term":"DPLL","zh":"DPLL 算法"}]}';
  });
  const first = await translator.translate(['SAT solver', 'DPLL', 'SAT solver']);
  assert.deepEqual([...first], [['SAT solver', 'SAT 求解器'], ['DPLL', 'DPLL 算法']]);
  assert.equal(prompts.length, 1, 'three names, one request');
  assert.equal((prompts[0].match(/^- /gm) ?? []).length, 2, 'duplicates are asked about once');

  const second = await translator.translate(['SAT solver', 'DPLL']);
  assert.equal(prompts.length, 1, 'names already known are never paid for twice');
  assert.deepEqual([...second], [...first]);

  // Chinese names never reach the model at all.
  assert.equal((await translator.translate(['图神经网络'])).size, 0);
  assert.equal(prompts.length, 1);

  // A refused term is remembered as "no gloss" so it is not retried on every opening.
  const refuserPrompts = [];
  const refuser = createEntityTranslator(async (prompt) => {
    refuserPrompts.push(prompt);
    return '{"items":[]}';
  });
  assert.equal((await refuser.translate(['mystery term'])).size, 0);
  assert.equal((await refuser.translate(['mystery term'])).size, 0);
  assert.equal(refuserPrompts.length, 1, 'a refusal is cached too');
}

// The batch is capped: a dialog with hundreds of rows must not become one enormous request.
{
  const prompts = [];
  const translator = createEntityTranslator(async (prompt) => {
    prompts.push(prompt);
    return '{"items":[]}';
  });
  const many = Array.from({ length: MAX_TERMS_PER_REQUEST + 25 }, (_, index) => `term ${index}`);
  await translator.translate(many);
  assert.equal((prompts[0].match(/^- /gm) ?? []).length, MAX_TERMS_PER_REQUEST);
}

// ---------------------------------------------------------------------------
// Abbreviations: the pair the string scorer cannot see.
//
// `Boyar-Peralta heuristic` vs `BP heuristic` measures 0.49 — below any safe threshold — because an
// abbreviation shares almost no characters with its expansion. These rules read the relationship the
// way a reader does: initials, and the paper's own `(ABBR)` declarations in the quotes we already
// stored.
// ---------------------------------------------------------------------------
assert.equal(isAbbreviationOf('BP heuristic', 'Boyar-Peralta heuristic'), true);
assert.equal(isAbbreviationOf('GNN', 'graph neural network'), true);
assert.equal(isAbbreviationOf('BERT', 'Bidirectional Encoder Representations from Transformers'), true, 'the stopword "from" is skipped');
// Conservative where it must be: these are different things, and a wrong merge corrupts the graph.
assert.equal(isAbbreviationOf('ResNet', 'ResNeXt'), false);
assert.equal(isAbbreviationOf('JPEG-LS', 'JPEG 2000'), false);
assert.equal(isAbbreviationOf('ResNet', 'ResNet-50'), false);
assert.equal(isAbbreviationOf('BP', 'Boyar-Peralta heuristic'), false, 'leftover tokens: initials alone are not a statement');

// A paper states the pairing in parentheses, frequently *inside* the name.
assert.deepEqual(
  extractAbbreviationPairs('Cancellation is allowed by the Boyar-Peralta ( BP ) heuristic [5,6].')[0],
  { long: 'Boyar-Peralta heuristic', short: 'BP' },
);
assert.deepEqual(
  extractAbbreviationPairs('We use a graph neural network (GNN) for scoring.'),
  [{ long: 'graph neural network', short: 'GNN' }],
  'the trailing phrase is not part of the name',
);
assert.deepEqual(
  extractAbbreviationPairs('the BERT (Bidirectional Encoder Representations from Transformers) model'),
  [{ long: 'Bidirectional Encoder Representations from Transformers', short: 'BERT' }],
  'the reversed form is read too',
);
assert.deepEqual(extractAbbreviationPairs('noise (see §3)'), [], 'a parenthesised aside is not an abbreviation');

// `BP` leads `BP heuristic`, which is how papers write the short form in running text.
assert.equal(abbreviationLeadsName('BP', 'BP heuristic'), true);
assert.equal(abbreviationLeadsName('BP heuristic', 'BP'), false);

const abbreviationSuggestions = suggestAbbreviationMerges([
  { entityId: 'e-long', name: 'Boyar-Peralta heuristic', quotes: ['Cancellation is allowed by the Boyar-Peralta ( BP ) heuristic [5,6].'] },
  { entityId: 'e-short', name: 'BP heuristic', quotes: ['it beats BP on matrices as small as 15 x 15.'] },
  { entityId: 'e-gnn', name: 'GNN' },
  { entityId: 'e-graph', name: 'graph neural network' },
]);
const stated = abbreviationSuggestions.find((item) => item.mergeEntityId === 'e-short');
assert.ok(stated, 'the declared pair is found');
assert.equal(stated.keepEntityId, 'e-long', 'the expansion survives: the abbreviation becomes its alias');
assert.equal(stated.autoSelectable, true, 'a pairing the paper wrote down may start ticked');
assert.match(stated.reasons.join(' '), /论文里写出了这个缩写/);
const inferred = abbreviationSuggestions.find((item) => item.mergeEntityId === 'e-gnn');
assert.ok(inferred, 'initials alone still produce a suggestion');
assert.equal(inferred.autoSelectable, false, 'but never a pre-ticked one: GNN could be anything');
assert.equal(inferred.score < stated.score, true);

// The merge review is where the user meets these: a plain string pair would never be listed at all.
const abbreviationReview = buildMergeReview([
  docEntity('e-long', 'Boyar-Peralta heuristic', ['Cancellation is allowed by the Boyar-Peralta ( BP ) heuristic [5,6].']),
  docEntity('e-short', 'BP heuristic'),
]);
assert.equal(abbreviationReview.rows.length, 1, 'a pair the text declares reaches the merge dialog');
assert.equal(abbreviationReview.rows[0].keepEntityId, 'e-long');
assert.equal(abbreviationReview.rows[0].autoSelectable, true);
assert.match(abbreviationReview.rows[0].reasons.join(' '), /论文里写出了这个缩写/);

// ---------------------------------------------------------------------------
// Aliases from extraction: the paper's other names ride along and make matching work next time.
// ---------------------------------------------------------------------------
function docEntity(entityId, name, quoteTexts = [], aliases = []) {
  return {
    entityId,
    name,
    normalizedName: normalizeEntityName(name),
    aliases,
    type: 'Method',
    status: 'confirmed',
    confidence: 0.9,
    sourcePaperId: 'p1',
    evidence: quoteTexts.map((quote) => ({ paperId: 'p1', pageNumber: 1, quote })),
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const parsedWithAliases = parseEntityCandidates(
  JSON.stringify({
    entities: [
      {
        name: 'Boyar-Peralta heuristic',
        type: 'Method',
        confidence: 0.9,
        aliases: ['BP heuristic', 'boyar-perralta heuristic', 'BP heuristic'],
        evidence: [{ quote: 'the Boyar-Peralta ( BP ) heuristic', pageNumber: 3 }],
      },
      { name: 'Plain', type: 'Method', confidence: 0.8, evidence: [] },
    ],
  }),
  { paperId: 'p1', defaultPageNumber: 1 },
  normalizeEntityName,
);
assert.deepEqual(
  parsedWithAliases.candidates[0].aliases,
  ['BP heuristic', 'boyar-perralta heuristic'],
  'aliases are de-duplicated and never repeat the name itself',
);
assert.equal(parsedWithAliases.candidates[1].aliases, undefined, 'no aliases means no empty array');

// A later chunk naming only the abbreviation lands on the same pending entity.
const aliasUpsert = planPendingCandidateUpsert(
  'p1',
  [
    { name: 'Boyar-Peralta heuristic', type: 'Method', confidence: 0.9, evidence: [], aliases: ['BP heuristic'] },
    { name: 'BP heuristic', type: 'Method', confidence: 0.8, evidence: [] },
  ],
  [],
);
assert.equal(aliasUpsert.entities.length, 1, 'the abbreviation is recognised as the same entity');
assert.equal(aliasUpsert.entities[0].name, 'Boyar-Peralta heuristic', 'and the fuller name stays canonical');
assert.ok(
  aliasUpsert.entities[0].aliases.includes('BP heuristic'),
  `the abbreviation is kept as an alias; got ${JSON.stringify(aliasUpsert.entities[0].aliases)}`,
);

// ---------------------------------------------------------------------------
// The pending list has a confidence floor.
//
// The review dialog already hides unticked low-confidence rows behind a toggle, so a candidate down
// there is one the user would have to hunt for in order to reject. It is filtered at the door, and
// counted, because "found 40, refused 18" is how the prompt's noise level can be measured at all.
// ---------------------------------------------------------------------------
assert.equal(MIN_PENDING_CONFIDENCE, 0.4);
const floorPlan = planPendingCandidateUpsert(
  'p1',
  [
    { name: 'Kept', type: 'Method', confidence: 0.4, evidence: [] },
    { name: 'Also Kept', type: 'Method', confidence: 0.9, evidence: [] },
    { name: 'Too Weak', type: 'Method', confidence: 0.39, evidence: [] },
    { name: 'Very Weak', type: 'Method', confidence: 0, evidence: [] },
  ],
  [],
);
assert.deepEqual(
  floorPlan.entities.map((entity) => entity.name).sort(),
  ['Also Kept', 'Kept'],
  'a candidate at the floor is kept; anything below it never reaches the review list',
);
assert.equal(floorPlan.droppedLowConfidence, 2, 'and the refusal is reported, not swallowed');

// ---------------------------------------------------------------------------
// Name quality: what is not a concept at all, and what is a numbered copy.
//
// Real runs produced `XOR2`, `# XOR2`, `b l cost` and `XOR2:2:1` — fragments of gate tables and
// figure labels. The prompt is told to avoid them; the ones that arrive anyway are filtered here, by
// rules that can be read and tested rather than by hoping.
// ---------------------------------------------------------------------------
for (const usable of [
  'Transformer',
  'XOR',
  'WMT14',
  'ResNet-50',
  'GPT-3',
  'F1-score',
  'BLEU-4',
  'two-step process for combinational logic optimization',
]) {
  assert.equal(assessEntityName(usable).usable, true, `${usable} is a legitimate name`);
}
for (const junk of ['63', 'b', 'b l cost', 'a b c', 'XOR2:2:1', 'Table 3', 'Fig. 2', '#']) {
  const verdict = assessEntityName(junk);
  assert.equal(verdict.usable, false, `${JSON.stringify(junk)} must be refused`);
  assert.ok(verdict.reason, 'and the refusal carries a reason for reporting');
}
// Leading table markers are stripped rather than rejecting an otherwise usable name.
assert.equal(assessEntityName('# XOR2').cleaned, 'XOR2');
assert.equal(assessEntityName('  "XOR gate"  ').cleaned, 'XOR gate');
// A sentence is not an entity.
assert.equal(
  assessEntityName('in this paper we show that the proposed flow reduces the total gate count').usable,
  false,
);

// Demotion, not rejection: readable names that describe an action or are mostly numbering. They leave
// the review list but are counted on their own — "names phrased as clauses" is a different problem
// from "the model invents junk", and only one of them means the prompt needs work.
for (const [name, hint] of [
  ['XOR3 (b2) Support for Boyar-Peralta Algorithm', /Support for/],
  ['a method based on X', /based on/],
  ['the proposed flow achieves 3x speedup', /proposed/],
  ['Graph Convolutional Network using Attention', /using/],
  ['ΔE >> 5%', /符号占比/],
]) {
  const verdict = assessEntityName(name);
  assert.equal(verdict.usable, true, `${name} is readable, so it is demoted rather than deleted`);
  assert.ok(verdict.suspect, `${name} must be flagged`);
  assert.match(verdict.suspect, hint);
}
// The names that must never be demoted — the whole reason the phrases are narrow.
for (const keeper of [
  'Transformer',
  'GPT-3',
  'WMT14',
  'BLEU-4',
  'ResNet-50',
  'F1-score',
  'SAT-Based Optimization',
  'Self-Attention',
  'Bidirectional Encoder Representations from Transformers',
  'Graph Convolutional Network with Attention',
]) {
  const verdict = assessEntityName(keeper);
  assert.equal(verdict.usable, true, `${keeper} stays usable`);
  assert.equal(verdict.suspect, undefined, `${keeper} must not be demoted: ${verdict.suspect}`);
}
// Six words and up reads as a clause. This one was kept until a real canvas showed it as the longest
// label on screen; demoting it is the trade the user asked for.
{
  const verdict = assessEntityName('two-step process for combinational logic optimization');
  assert.equal(verdict.usable, true, 'still readable, so it is demoted rather than deleted');
  assert.match(verdict.suspect ?? '', /7 个词/);
}

// A numbered copy of a known acronym is an alias, not a new entity. The neighbouring shapes are
// legitimate entities and must NOT collapse — that distinction is the whole rule.
assert.equal(variantBaseOf('XOR2', ['XOR']), 'XOR');
assert.equal(variantBaseOf('XOR2', ['Transformer']), null, 'no base, no collapse');
assert.equal(variantBaseOf('WMT14', ['WMT']), null, 'a two-digit year is part of the name');
assert.equal(variantBaseOf('GPT-3', ['GPT']), null, 'a hyphenated version is a different model');
assert.equal(variantBaseOf('ResNet-50', ['ResNet']), null);

// The planner applies all three: junk never enters the list, the numbered copy folds into its base,
// and a descriptive clause is demoted with its own count.
const qualityPlan = planPendingCandidateUpsert(
  'p1',
  [
    { name: 'XOR', type: 'Concept', confidence: 0.9, evidence: [{ paperId: 'p1', pageNumber: 1, quote: 'XOR gate' }] },
    { name: 'XOR2', type: 'Concept', confidence: 0.9, evidence: [{ paperId: 'p1', pageNumber: 1, quote: 'XOR2:2:1 gates' }], aliases: ['# XOR2'] },
    { name: 'b l cost', type: 'Metric', confidence: 0.9, evidence: [] },
    { name: '63', type: 'Metric', confidence: 0.9, evidence: [] },
    { name: 'XOR3 (b2) Support for Boyar-Peralta Algorithm', type: 'Method', confidence: 0.95, evidence: [] },
  ],
  [],
);
assert.equal(qualityPlan.entities.length, 1, 'only the real entity survives');
assert.equal(qualityPlan.entities[0].name, 'XOR');
assert.ok(qualityPlan.entities[0].aliases.includes('XOR2'), `XOR2 becomes an alias; got ${JSON.stringify(qualityPlan.entities[0].aliases)}`);
assert.equal(qualityPlan.demotedSuspect, 1, 'the descriptive clause is demoted, and counted separately');
assert.equal(qualityPlan.droppedLowQuality, 2, 'the table fragment and the bare number are counted');
assert.equal(qualityPlan.collapsedVariants, 1, 'and the numbered copy is counted separately');

// ---------------------------------------------------------------------------
// Dismissal: a refused candidate must leave the pending list, or the badge lies.
//
// Three behaviours that were all wrong in practice: the pending review kept listing ignored names,
// the pending count included them, and 忽略 only removed the row from the screen while the candidate
// stayed pending — so the next open showed it again.
// ---------------------------------------------------------------------------
{
  const repository = {
    state: {
      entities: [
        { ...docEntity('e-pending', 'XOR2', [], []), status: 'pending' },
        docEntity('e-confirmed', 'Transformer', [], []),
        { ...docEntity('e-ignored', 'b l cost', [], []), status: 'pending' },
      ],
      settings: {
        key: 'knowledge-graph-settings',
        ignoredEntityNames: ['b l cost'],
        minConfidenceToAutoCheck: 0.75,
      },
      written: [],
    },
    async listEntities() { return this.state.entities; },
    async readSettings() { return this.state.settings; },
    async writeSettings(next) { this.state.settings = next; this.state.written.push(next); },
    async listPendingEntities() {
      return this.state.entities.filter((entity) => entity.status === 'pending');
    },
    async listEdges() { return []; },
    async applyEntityPlan(plan) {
      const byId = new Map(this.state.entities.map((entity) => [entity.entityId, entity]));
      for (const entity of plan.entities) byId.set(entity.entityId, entity);
      this.state.entities = [...byId.values()];
      return plan.edges.length;
    },
  };

  // The review list already hides ignored names: showing them made 不再提示 look broken.
  const review = await loadPendingReview(repository);
  assert.equal(
    review.groups.flatMap((group) => group.candidates).map((candidate) => candidate.name).join(','),
    'XOR2',
    'a name on the ignore list is not offered again',
  );

  // Hiding is not resolving: a pending record whose name is ignored is still counted by everything
  // that reads pending records — that is how the page showed "待确认 9" with an empty dialog.
  const resolved = await reconcileIgnoredPendingCandidates(repository);
  assert.equal(resolved, 1, 'the ignored pending record is resolved');
  assert.equal(
    repository.state.entities.find((entity) => entity.entityId === 'e-ignored').status,
    'rejected',
    'and stops being pending at all',
  );
  assert.equal(
    await reconcileIgnoredPendingCandidates(repository),
    0,
    'the reconciliation is idempotent',
  );
  assert.equal(
    (await loadPendingReview(repository)).total,
    1,
    'after reconciling, the count and the list agree',
  );

  // 忽略 rejects the candidate: it leaves the pending list but is not remembered.
  const dismissed = await dismissEntityCandidates(['e-pending'], repository, { remember: false });
  assert.deepEqual(dismissed, { dismissed: 1, remembered: 0 });
  assert.equal(
    repository.state.entities.find((entity) => entity.entityId === 'e-pending').status,
    'rejected',
    'a dismissed candidate is no longer pending',
  );
  assert.deepEqual(
    repository.state.settings.ignoredEntityNames,
    ['b l cost'],
    '忽略 does not write the ignore list',
  );

  // 不再提示 also remembers the name, and a confirmed entity is never touched.
  const remembered = await dismissEntityCandidates(
    ['e-ignored', 'e-confirmed'],
    repository,
    { remember: true },
  );
  assert.deepEqual(remembered, { dismissed: 1, remembered: 0 }, 'only a non-confirmed candidate is dismissed');
  assert.equal(
    repository.state.entities.find((entity) => entity.entityId === 'e-confirmed').status,
    'confirmed',
    'the user’s confirmation is not a candidate to reject',
  );
  assert.equal(
    repository.state.entities.find((entity) => entity.entityId === 'e-ignored').status,
    'rejected',
  );
}

// A rejected candidate comes back as pending when a later extraction proposes it again — unless it
// is on the ignore list, which is the difference between the two buttons.
const reproposed = planPendingCandidateUpsert(
  'p1',
  [
    { name: 'Rejected Before', type: 'Method', confidence: 0.9, evidence: [] },
    { name: 'Permanently Ignored', type: 'Method', confidence: 0.9, evidence: [] },
  ],
  [
    { ...docEntity('e-rejected', 'Rejected Before', [], []), status: 'rejected' },
    { ...docEntity('e-ignored', 'Permanently Ignored', [], []), status: 'rejected' },
  ],
  { ignoredNames: ['Permanently Ignored'] },
);
assert.equal(reproposed.reProposed, 1, 'a 忽略-ed candidate can be proposed again');
assert.equal(reproposed.droppedIgnored, 1, 'a 不再提示 name is not proposed again at all');
assert.equal(
  reproposed.entities.find((entity) => entity.entityId === 'e-rejected').status,
  'pending',
  'and the re-proposal actually puts it back in the review list',
);

// Confirmation is alias-aware too, and keeps the paper's names on the survivor.
const aliasPlan = planEntityConfirmation(
  [
    { name: 'BP heuristic', type: 'Method', confidence: 0.9, evidence: [{ paperId: 'p1', pageNumber: 4, quote: 'it beats BP' }] },
  ],
  [docEntity('e-long', 'Boyar-Peralta heuristic', [], ['BP heuristic'])],
  { paperId: 'p1', edgeType: 'MENTIONS', now: 5 },
);
assert.equal(aliasPlan.entities.length, 1);
assert.equal(aliasPlan.entities[0].entityId, 'e-long', 'the candidate lands on the existing entity instead of a twin');
assert.equal(aliasPlan.entities[0].status, 'confirmed');
assert.ok(
  aliasPlan.entities[0].aliases.includes('BP heuristic'),
  'the confirmed spelling stays on the record as an alias',
);
// Without the alias this would have created a second entity — the measured behaviour, not an opinion.
const withoutAliasPlan = planEntityConfirmation(
  [{ name: 'BP heuristic', type: 'Method', confidence: 0.9, evidence: [] }],
  [docEntity('e-long', 'Boyar-Peralta heuristic')],
  { paperId: 'p1', edgeType: 'MENTIONS', now: 6 },
);
assert.equal(withoutAliasPlan.entities[0].entityId === 'e-long', false, 'alias matching is what bridges the two');

// ---------------------------------------------------------------------------
// Synonym detection: one request, a suggestion, never a merge.
// ---------------------------------------------------------------------------
const synonymPrompt = buildEntitySynonymPrompt(['BP heuristic', 'Boyar-Peralta heuristic']);
assert.match(synonymPrompt, /同一个概念/);
assert.equal((synonymPrompt.match(/^- /gm) ?? []).length, 2);
assert.match(synonymPrompt, /\{"groups":\[\{"canonical":"原文写法","variants":\[/);

assert.deepEqual(
  [...parseEntitySynonyms(
    '```json\n{"groups":[{"canonical":"Boyar-Peralta heuristic","variants":["BP heuristic","boyar perralta"]}]}\n```',
    ['Boyar-Peralta heuristic', 'BP heuristic'],
  )],
  [['BP heuristic', 'Boyar-Peralta heuristic']],
  'only names the user can act on, mapped to the canonical one',
);
assert.equal(
  parseEntitySynonyms(
    '{"groups":[{"canonical":"not requested","variants":["also not requested"]},{"canonical":"A","variants":["A"]}]}',
    ['A'],
  ).size,
  0,
  'unknown names are dropped and a group of one proves nothing',
);

{
  const prompts = [];
  const checker = createEntitySynonymChecker(async (prompt) => {
    prompts.push(prompt);
    return '{"groups":[{"canonical":"Boyar-Peralta heuristic","variants":["BP heuristic"]}]}';
  });
  const first = await checker.find(['Boyar-Peralta heuristic', 'BP heuristic']);
  assert.deepEqual([...first], [['BP heuristic', 'Boyar-Peralta heuristic']]);
  assert.equal(prompts.length, 1);
  // The same question is not paid for twice; a different candidate set is a different question.
  await checker.find(['BP heuristic', 'Boyar-Peralta heuristic']);
  assert.equal(prompts.length, 1, 'the same name-set is answered from the cache');
  await checker.find(['BP heuristic', 'Boyar-Peralta heuristic', 'GNN']);
  assert.equal(prompts.length, 2, 'a new name-set is a new question');
  // A single name cannot be a synonym of anything.
  assert.equal((await checker.find(['BP heuristic'])).size, 0);
}

// ---------------------------------------------------------------------------
// Rejecting a merge suggestion: string similarity cannot tell `s-XOR` from a typo.
// ---------------------------------------------------------------------------
assert.equal(mergePairKey('b', 'a'), 'a|b', 'the key is order-independent');
assert.equal(mergePairKey('a', 'a'), '', 'an entity is never a pair with itself');
assert.deepEqual(
  normalizeMergeRejections(['b|a', 'a|b', 'a|a', 'nonsense', 42, ' c | d ']),
  ['a|b', 'c|d'],
  'stored keys are validated, de-duplicated and order-normalised',
);
assert.deepEqual(normalizeMergeRejections('not an array'), []);

// A rejected pair is filtered out of the review, and its orientation does not matter.
// The pair here is a real misspelling (`Learing`), so it scores above the review floor by default.
const mergeEntities = [
  docEntity('e-typo', 'Self Supervised Learing'),
  docEntity('e-clean', 'Self Supervised Learning'),
];
assert.equal(buildMergeReview(mergeEntities).rows.length, 1, 'the pair is suggested by default');
assert.equal(
  buildMergeReview(mergeEntities, { rejectedPairs: [mergePairKey('e-typo', 'e-clean')] }).rows.length,
  0,
  'a rejected pair is not suggested again',
);
assert.equal(
  buildMergeReview(mergeEntities, { rejectedPairs: [mergePairKey('e-clean', 'e-typo')] }).rows.length,
  0,
  'and the order the key was written in does not matter',
);
assert.equal(
  buildMergeReview(mergeEntities, { rejectedPairs: ['someone|else'] }).rows.length,
  1,
  'rejecting one pair must not hide the others',
);

// The module records and clears rejections through the settings record.
{
  const repository = {
    state: {
      settings: {
        key: 'knowledge-graph-settings',
        mergeRejections: [],
      },
    },
    async readSettings() { return this.state.settings; },
    async writeSettings(next) { this.state.settings = next; },
    async listEntities() { return []; },
    async listEdges() { return []; },
    async applyEntityPlan() { return 0; },
  };
  assert.equal(await rejectMergeSuggestion('e-bxor', 'e-sxor', repository), 1);
  assert.equal(await rejectMergeSuggestion('e-sxor', 'e-bxor', repository), 1, 'the same pair is not stored twice');
  assert.deepEqual(repository.state.settings.mergeRejections, ['e-bxor|e-sxor']);
  assert.equal(await clearMergeRejections(repository), 1, 'and it can be forgotten again');
  assert.deepEqual(repository.state.settings.mergeRejections, []);
}

// ---------------------------------------------------------------------------
// Edge labels: the canvas no longer writes the relation, so the inspector is the only place it is
// read. Every stored type must therefore have a label — a missing one would surface as a bare enum
// name in the panel the user opened precisely to find out what the relation means.
// ---------------------------------------------------------------------------
for (const type of EDGE_TYPES) {
  assert.ok(EDGE_TYPE_LABELS[type], `every edge type needs a label: ${type}`);
  assert.equal(describeEdgeType(type), `${EDGE_TYPE_LABELS[type]}（${type}）`);
  assert.equal(edgeTypeLabel(type), EDGE_TYPE_LABELS[type]);
}
assert.equal(describeEdgeType('MENTIONS'), '提及（MENTIONS）');
assert.equal(describeEdgeType('SOMETHING_NEW'), 'SOMETHING_NEW', 'an unknown type still renders');

// ---------------------------------------------------------------------------
// Node colours: every entity type gets its own hue, and papers keep the deep blue anchor.
// ---------------------------------------------------------------------------
{
  const theme = resolveGraphTheme();
  assert.equal(nodeFill('paper', theme), theme.paperNode);
  const seen = new Set();
  for (const type of ENTITY_TYPES) {
    const fill = nodeFill('entity', theme, type);
    assert.equal(fill, theme.entityTypeColors[type], `${type} uses its own colour`);
    assert.equal(seen.has(fill), false, `${type} must not share a colour with another type`);
    seen.add(fill);
  }
  assert.equal(
    nodeFill('entity', theme).includes('#'),
    true,
    'an entity with no type falls back to the generic colour',
  );
  assert.notEqual(theme.entityTypeColors.Method, theme.paperNode, 'a Method is not the same blue as a paper');
  // Personal nodes keep their own family: they are the user's material, not a model's estimate.
  assert.equal(nodeFill('note', theme), theme.noteNode);
}

// ---------------------------------------------------------------------------
// Layout determinism: the same graph must settle into the same picture.
// ---------------------------------------------------------------------------
const layoutNodes = [
  { id: 'a', radius: 14, weight: 1, fixed: false },
  { id: 'b', radius: 8, weight: 0.4, fixed: false },
  { id: 'c', radius: 8, weight: 0.4, fixed: false },
];
const layoutEdges = [
  { source: 'a', target: 'b', strength: 1 },
  { source: 'a', target: 'c', strength: 1 },
];
const layoutOptions = {
  width: 800,
  height: 600,
  iterations: 40,
  linkDistance: 96,
  repulsion: 5200,
  gravity: 0.022,
  damping: 0.82,
};
const first = computeLayout(layoutNodes, layoutEdges, layoutOptions);
const second = computeLayout(layoutNodes, layoutEdges, layoutOptions);
assert.deepEqual([...first.entries()], [...second.entries()], 'layout must be deterministic');

for (const [id, point] of first) {
  const node = layoutNodes.find((candidate) => candidate.id === id);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${id} must stay finite`);
  assert.ok(point.x >= node.radius - 0.001 && point.x <= 800 - node.radius + 0.001);
  assert.ok(point.y >= node.radius - 0.001 && point.y <= 600 - node.radius + 0.001);
}

// Coincident nodes must not produce NaN.
const coincident = computeLayout(
  [
    { id: 'x', radius: 8, weight: 1, fixed: false },
    { id: 'y', radius: 8, weight: 1, fixed: false },
  ],
  [{ source: 'x', target: 'y', strength: 1 }],
  { ...layoutOptions, iterations: 10 },
);
for (const point of coincident.values()) {
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
}

// ---------------------------------------------------------------------------
// Node roles: private vs shared is decided by *how many distinct papers* a node
// reaches, not by its raw degree. A method that also hangs a sub-entity off itself
// is still private to its paper; a dataset in two papers is a bridge even if that
// is its only two connections.
// ---------------------------------------------------------------------------
const roleEdges = [
  { source: 'P1', target: 'PRIV' },
  { source: 'PRIV', target: 'SUB' },
  { source: 'P1', target: 'SHARED2' },
  { source: 'P2', target: 'SHARED2' },
  { source: 'SHARED2', target: 'SHAREDSUB' },
  { source: 'P1', target: 'SHARED4' },
  { source: 'P2', target: 'SHARED4' },
  { source: 'P3', target: 'SHARED4' },
  { source: 'P4', target: 'SHARED4' },
];
const roles = buildNodeRoleIndex(
  roleEdges,
  new Set(['P1', 'P2', 'P3', 'P4']),
);
assert.equal(SHARED_PAPER_DEGREE, 2, 'two papers is the definition of shared');
assert.ok(roles.privateNodeIds.has('PRIV'), 'one paper is private');
assert.ok(!roles.privateNodeIds.has('SUB'), 'a sub-entity has no paper of its own');
assert.ok(!roles.bridgeNodeIds.has('PRIV'), 'one paper must never be a bridge');
assert.ok(roles.bridgeNodeIds.has('SHARED2'), 'two papers make a bridge');
assert.ok(roles.bridgeNodeIds.has('SHARED4'));
assert.equal(roles.paperDegree.get('SHARED4'), 4);
assert.equal(roles.paperDegree.get('SUB'), undefined, 'a sub-entity belongs to no paper');
// A paper is never private to or shared with another paper: paper-to-paper conclusions (including
// the derived SHARED_ENTITIES bridge) must not turn a document into someone's satellite.
const paperOnly = buildNodeRoleIndex([{ source: 'P1', target: 'P2' }], new Set(['P1', 'P2']));
assert.equal(paperOnly.bridgeNodeIds.size, 0);
assert.equal(paperOnly.privateNodeIds.size, 0);

// ---------------------------------------------------------------------------
// Per-link distances: the picture has to say which nodes are *details* and which
// are the subjects. Asserted on the springs themselves — exact, no simulation noise.
// ---------------------------------------------------------------------------
const springs = buildNodeRoleIndex(
  [
    { source: 'P1', target: 'PRIV' },
    { source: 'PRIV', target: 'SUB' },
    { source: 'P1', target: 'SHARED2' },
    { source: 'P2', target: 'SHARED2' },
    { source: 'SHARED2', target: 'SHAREDSUB' },
    { source: 'P1', target: 'SHARED4' },
    { source: 'P2', target: 'SHARED4' },
    { source: 'P3', target: 'SHARED4' },
    { source: 'P4', target: 'SHARED4' },
    { source: 'SUB', target: 'ORPHAN' },
  ],
  new Set(['P1', 'P2', 'P3', 'P4']),
);
const kinds = new Map([
  ['P1', 'paper'], ['P2', 'paper'], ['P3', 'paper'], ['P4', 'paper'],
  ['PRIV', 'entity'], ['SUB', 'entity'], ['SHARED2', 'entity'],
  ['SHARED4', 'entity'], ['SHAREDSUB', 'entity'], ['ORPHAN', 'entity'],
]);
const spring = (source, target, strength = 1) => springForLink(
  { source, target, strength },
  springs,
  kinds,
  DEFAULT_LAYOUT_OPTIONS,
);

// 1. A paper and its private entity: the tightest gap, and a stiffer spring, so the satellites gather
// around the document instead of floating in the middle of the canvas.
assert.equal(spring('P1', 'PRIV').distance, DEFAULT_LAYOUT_OPTIONS.privateLinkDistance);
assert.equal(spring('P1', 'PRIV').distance, spring('PRIV', 'P1').distance, 'direction must not matter');
assert.ok(
  spring('P1', 'PRIV').strength > 1,
  'the private spring must be stiffer than a generic one, or repulsion pushes the satellite away',
);
// 2. Two papers: the widest gap, wide *without* relying on a spring to a shared node.
assert.equal(spring('P1', 'P2').distance, DEFAULT_LAYOUT_OPTIONS.paperLinkDistance);
assert.ok(
  spring('P1', 'P2').distance > spring('P1', 'SHARED2').distance * 0.9,
  'documents must never be drawn closer than the document-to-bridge gap',
);
// 3. A shared entity is pulled away from *everything* it touches — including the papers and its own
// sub-entity — so it parks between the documents instead of beside one of them.
assert.equal(spring('P1', 'SHARED2').distance, DEFAULT_LAYOUT_OPTIONS.sharedLinkDistance);
assert.equal(
  spring('SHARED2', 'SHAREDSUB').distance,
  DEFAULT_LAYOUT_OPTIONS.sharedLinkDistance,
  'a bridge drags its own sub-entity out with it, not just its papers',
);
// A busier bridge needs more room; otherwise four papers squeeze onto one gap.
assert.equal(
  spring('P1', 'SHARED4').distance,
  DEFAULT_LAYOUT_OPTIONS.sharedLinkDistance + DEFAULT_LAYOUT_OPTIONS.sharedDegreeStep * 2,
);
// 4. A private entity and its own sub-entity stay tight, but looser than the paper link.
assert.ok(
  spring('PRIV', 'SUB').distance > spring('P1', 'PRIV').distance
  && spring('PRIV', 'SUB').distance < DEFAULT_LAYOUT_OPTIONS.linkDistance,
  'a paper cluster grows outward from the paper',
);
// 5. Nothing special: the generic distance.
assert.equal(spring('SUB', 'ORPHAN').distance, DEFAULT_LAYOUT_OPTIONS.linkDistance);

// The simulation has to show it, not just the bookkeeping: satellites hug, documents separate.
const tunedNodes = [
  { id: 'P1', radius: 14, weight: 1, fixed: false, kind: 'paper' },
  { id: 'P2', radius: 14, weight: 1, fixed: false, kind: 'paper' },
  { id: 'P3', radius: 14, weight: 1, fixed: false, kind: 'paper' },
  { id: 'PRIV', radius: 8, weight: 0.4, fixed: false, kind: 'entity' },
  { id: 'SUB', radius: 8, weight: 0.4, fixed: false, kind: 'entity' },
  { id: 'SHARED', radius: 12, weight: 0.4, fixed: false, kind: 'entity' },
];
const tunedEdges = [
  { source: 'P1', target: 'PRIV', strength: 1 },
  { source: 'PRIV', target: 'SUB', strength: 1 },
  { source: 'P1', target: 'SHARED', strength: 1 },
  { source: 'P2', target: 'SHARED', strength: 1 },
  { source: 'P3', target: 'SHARED', strength: 1 },
  { source: 'P1', target: 'P2', strength: 1 },
];
const tuned = computeLayout(tunedNodes, tunedEdges, {
  ...DEFAULT_LAYOUT_OPTIONS,
  width: 1600,
  height: 1200,
});
const gap = (left, right) => {
  const a = tuned.get(left);
  const b = tuned.get(right);
  return Math.hypot(a.x - b.x, a.y - b.y);
};
assert.ok(
  gap('P1', 'PRIV') < DEFAULT_LAYOUT_OPTIONS.linkDistance,
  `a private entity must hug its paper (got ${gap('P1', 'PRIV').toFixed(1)})`,
);
assert.ok(
  gap('PRIV', 'SUB') < DEFAULT_LAYOUT_OPTIONS.linkDistance,
  `a private sub-entity stays inside the cluster (got ${gap('PRIV', 'SUB').toFixed(1)})`,
);
assert.ok(
  gap('P1', 'P2') > DEFAULT_LAYOUT_OPTIONS.linkDistance,
  `two papers must sit far apart (got ${gap('P1', 'P2').toFixed(1)})`,
);
assert.ok(
  gap('P1', 'SHARED') > gap('P1', 'PRIV') * 2,
  'the shared entity must be pulled well beyond the private satellites '
    + `(shared ${gap('P1', 'SHARED').toFixed(1)} vs private ${gap('P1', 'PRIV').toFixed(1)})`,
);
// Papers that only share an entity have no spring between them; the paper-paper repulsion is the
// only thing keeping them apart, and without it they drifted to the middle and sat side by side.
assert.ok(
  gap('P2', 'P3') > DEFAULT_LAYOUT_OPTIONS.linkDistance,
  `papers sharing only a bridge must not sit closer than a generic link (got ${gap('P2', 'P3').toFixed(1)})`,
);

// The same options without the kind information must still settle (older call sites pass no `kind`).
const kindless = computeLayout(
  tunedNodes.map(({ kind, ...rest }) => rest),
  tunedEdges,
  { ...DEFAULT_LAYOUT_OPTIONS, width: 1600, height: 1200, iterations: 60 },
);
for (const point of kindless.values()) {
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
}

// Two papers wired only to each other are still two documents, not a paper and its satellite.
const lonePair = computeLayout(
  [
    { id: 'PA', radius: 14, weight: 1, fixed: false, kind: 'paper' },
    { id: 'PB', radius: 14, weight: 1, fixed: false, kind: 'paper' },
  ],
  [{ source: 'PA', target: 'PB', strength: 1 }],
  { ...DEFAULT_LAYOUT_OPTIONS, width: 1200, height: 900 },
);
assert.ok(
  Math.hypot(lonePair.get('PA').x - lonePair.get('PB').x, lonePair.get('PA').y - lonePair.get('PB').y)
    > DEFAULT_LAYOUT_OPTIONS.linkDistance,
  'a two-paper component must not collapse to the private distance',
);

// ---------------------------------------------------------------------------
// The same roles drive the canvas: edges into a shared entity are drawn quieter than
// a paper's own satellites, so the document stays the subject of the picture.
// ---------------------------------------------------------------------------
const bridgeModel = buildRenderModel(
  [paper('P1'), paper('P2')],
  [entity('SHARED'), entity('PRIV')],
  [
    edge({ originKey: 'MENTIONS|P1|SHARED', source: 'P1', target: 'SHARED' }),
    edge({ originKey: 'MENTIONS|P2|SHARED', source: 'P2', target: 'SHARED' }),
    edge({ originKey: 'MENTIONS|P1|PRIV', source: 'P1', target: 'PRIV' }),
  ],
);
assert.ok(bridgeModel.bridgeNodeIds.has('SHARED'), 'an entity in two papers is a bridge');
assert.ok(!bridgeModel.bridgeNodeIds.has('PRIV'), 'an entity in one paper is not');
assert.ok(!bridgeModel.bridgeNodeIds.has('P1'), 'a paper is never its own bridge');

// ---------------------------------------------------------------------------
// Viewport clamping.
// ---------------------------------------------------------------------------
assert.equal(clampScale(0), 0.15);
assert.equal(clampScale(1000), 4);
assert.equal(clampScale(Number.NaN), 1);

const zoomed = zoomAt({ scale: 1, offsetX: 0, offsetY: 0 }, 2, 100, 100);
assert.equal(zoomed.scale, 2);
// The anchor point must stay under the cursor.
assert.equal(100 * zoomed.scale + zoomed.offsetX, 100);
assert.equal(100 * zoomed.scale + zoomed.offsetY, 100);

const bounds = boundsOfPoints([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 100, maxY: 50 });
assert.equal(boundsOfPoints([]), null);

const fitted = fitViewport(bounds, 800, 600);
assert.ok(fitted.scale > 0 && fitted.scale <= 4);
// The fitted content must be centred.
const centerX = (bounds.minX + bounds.maxX) / 2;
assert.ok(Math.abs(centerX * fitted.scale + fitted.offsetX - 400) < 0.001);
assert.deepEqual(fitViewport(null, 800, 600), { scale: 1, offsetX: 0, offsetY: 0 });

// ---------------------------------------------------------------------------
// Renderer model + visual encoding.
// ---------------------------------------------------------------------------
const model = buildRenderModel(papers, entities, sharedEdges);
assert.equal(model.nodes.length, 3);
// sharedEdges also references p3 and e2, which are not in the node lists: those
// edges must be dropped rather than handed to the renderer with a missing end.
assert.equal(model.edges.length, 2);
assert.ok(model.nodeById.has('p1'));

const orphaned = buildRenderModel(papers, entities, [
  ...sharedEdges,
  edge({ originKey: 'USES|p9|e9', source: 'p9', target: 'e9' }),
]);
assert.equal(orphaned.edges.length, 2, 'an edge with a missing endpoint is dropped');

assert.deepEqual(dashPatternForOrigin('ai'), [], 'AI edges are solid');
assert.equal(dashPatternForOrigin('rule').length, 2, 'rule edges are dashed');
assert.equal(dashPatternForOrigin('user').length, 2, 'user edges are dotted');
assert.ok(confidenceAlpha(1) > confidenceAlpha(0.2));
assert.ok(radiusForDegree(8, 20) > radiusForDegree(8, 1));
assert.equal(radiusForDegree(8, 1), 8);
assert.equal(truncateLabel('short'), 'short');
// 12 characters: adjacent long names still collided at 18 on a real canvas. The full name is shown
// on hover and in the inspector, so this only defers it.
assert.ok(truncateLabel('x'.repeat(60)).length <= 12);
assert.equal(truncateLabel('Cancellation-free monotone').length, 12);
assert.match(truncateLabel('Cancellation-free monotone'), /…$/);
assert.equal(truncateLabel('XOR count'), 'XOR count', 'names under the limit are untouched');

// Hit-test geometry.
assert.equal(distanceToSegment(5, 5, 0, 0, 10, 0), 5);
assert.equal(distanceToSegment(5, 0, 0, 0, 10, 0), 0);
assert.equal(distanceToSegment(-3, 0, 0, 0, 10, 0), 3);
// A degenerate segment (both endpoints equal) must not divide by zero.
assert.equal(distanceToSegment(3, 4, 0, 0, 0, 0), 5);

console.log('Knowledge graph contract tests passed.');
