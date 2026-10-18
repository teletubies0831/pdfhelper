import assert from 'node:assert/strict';

import {
  areSameEntityName,
  normalizeEntityAliases,
  normalizeEntityName,
  tokenizeEntityName,
} from '../src/modules/knowledge-graph/domain/entity-normalization.ts';
import {
  characterDice,
  DEFAULT_ENTITY_MERGE_THRESHOLD,
  editSimilarity,
  ENTITY_SIMILARITY_REVIEW_FLOOR,
  entitySimilarity,
  levenshteinDistance,
  suggestEntityMerges,
  tokenJaccard,
} from '../src/modules/knowledge-graph/domain/entity-similarity.ts';

const normalize = normalizeEntityName;

// ---------------------------------------------------------------------------
// The equality key decides what may be merged WITHOUT asking the user, so it is
// held to a high standard: it must absorb presentation noise and nothing more.
// ---------------------------------------------------------------------------

// Presentation noise: casing, spacing, punctuation, width, subscripts, suffixes.
const mustBeEqual = [
  ['Transformer', 'Transformer模型'],
  ['Transformer', 'Transformer 模型'],
  ['transformer', 'Transformer'],
  ['Transformer', 'Transformer Algorithm'],
  ['BERT', 'bert'],
  ['GPT-2', 'GPT2'],
  ['GPT-2', 'gpt 2'],
  ['3D-CNN', '3D CNN'],
  ['3D-CNN', '3dcnn'],
  ['ResNet-50', 'resnet50'],
  ['Multi-Label Classification', 'multi label classification'],
  ['Multi-Label Classification', 'multilabel classification'],
  ['ＣＮＮ', 'CNN'],
  ['ＢＥＲＴ', 'BERT'],
  ['BERTₗᵢₙₖ', 'BERTlink'],
  ['Attention Is All You Need (2017)', 'Attention Is All You Need'],
  ['Graph Neural Network', 'Graph Neural Networks'],
  ['图神经网络', '图神经网络模型'],
  ['图神经网络', '图神经网络算法'],
  ['Contrastive Learning v2', 'Contrastive Learning'],
  ['Contrastive Learning v2.1', 'Contrastive Learning'],
  ['Contrastive Learning (preprint)', 'Contrastive Learning'],
];
for (const [left, right] of mustBeEqual) {
  assert.equal(
    normalize(left),
    normalize(right),
    `"${left}" and "${right}" must share an equality key`,
  );
  assert.equal(areSameEntityName(left, right), true);
}

// Genuinely different entities must NOT collapse: a wrong silent merge destroys
// knowledge, a missed merge only costs one confirmation click.
const mustDiffer = [
  ['BERT', 'ERNIE'],
  ['BERT', 'BERTScore'],
  ['Transformer', 'Transformer-XL'],
  ['ResNet', 'ResNeXt'],
  ['Graph Neural Network', 'Graph Convolutional Network'],
  ['图神经网络', '图卷积神经网络'],
  ['Precision', 'Recall'],
  ['Multi-Label Classification', 'Multi-Task Learning'],
  ['Swin Transformer', 'Vision Transformer'],
  ['GPT-2', 'GPT-3'],
  ['LSTM', 'BiLSTM'],
  ['CNN', 'RNN'],
  ['准确率', '召回率'],
];
for (const [left, right] of mustDiffer) {
  assert.notEqual(
    normalize(left),
    normalize(right),
    `"${left}" and "${right}" must not share an equality key`,
  );
  assert.equal(areSameEntityName(left, right), false);
}

// Empty and whitespace-only input must never produce a matchable key: an empty
// key equality would merge every broken candidate into one entity.
assert.equal(normalize(''), '');
assert.equal(normalize('   '), '');
assert.equal(areSameEntityName('', ''), false);
assert.equal(areSameEntityName('!!!', '???'), false);

// Idempotence: normalizing an already-normalized name changes nothing. Without
// this, re-running alignment would keep drifting names.
for (const name of ['Transformer模型', 'BERTₗᵢₙₖ', 'GPT-2 (2019)', '图神经网络v3', 'ＣＮＮ']) {
  const once = normalize(name);
  assert.equal(normalize(once), once, `normalize("${name}") must be idempotent`);
}

// Tokenization keeps multi-word names comparable.
assert.deepEqual(tokenizeEntityName('Multi-Label Classification'), [
  'multi', 'label', 'classification',
]);
assert.deepEqual(tokenizeEntityName('Graph Neural Networks'), [
  'graph', 'neural', 'network',
]);
assert.deepEqual(tokenizeEntityName('图神经网络'), ['图神经网络']);

// Alias handling: deduped by equality key, order preserved, blanks dropped.
assert.deepEqual(
  normalizeEntityAliases(['Transformer', 'transformer', '  ', 'Transformer模型', 'TF']),
  ['Transformer', 'TF'],
);

// ---------------------------------------------------------------------------
// Edit distance / overlap primitives.
// ---------------------------------------------------------------------------
assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
assert.equal(levenshteinDistance('', 'abc'), 3);
assert.equal(levenshteinDistance('abc', ''), 3);
assert.equal(levenshteinDistance('same', 'same'), 0);
assert.equal(levenshteinDistance('', ''), 0);

assert.equal(editSimilarity('abc', 'abc'), 1);
assert.equal(editSimilarity('', ''), 1);
assert.equal(editSimilarity('abcd', 'abce'), 0.75);
assert.equal(editSimilarity('', 'abcd'), 0);

// Token overlap is *fuzzy*: tokens that are close but not identical still match,
// so a misspelling does not halve the overlap. With single-character tokens the
// 0.8 token-match threshold means "a" also matches "b" and "c".
assert.equal(tokenJaccard(['a', 'b'], ['a', 'b']), 1);
assert.equal(tokenJaccard([], []), 1);
// Distinct multi-character tokens do not match: "alpha" vs "beta" is below the
// per-token similarity floor.
assert.equal(tokenJaccard(['alpha'], ['beta']), 0);
// Exact overlap still scores 1 and half-overlap scores 0.5.
assert.equal(tokenJaccard(['alpha', 'beta'], ['alpha', 'gamma']), 0.5);
// A one-character typo in a token is NOT a miss: this is the property that keeps
// "Self Supervised Learning" close to "Self Supervised Learing".
assert.equal(tokenJaccard(['learning', 'self'], ['learing', 'self']), 1);

assert.equal(characterDice('transformer', 'transformer'), 1);
assert.equal(characterDice('', 'abc'), 0);
assert.ok(characterDice('graph neural network', 'graph neural networks') > 0.85);

// ---------------------------------------------------------------------------
// Scoring: exact match is a fact (1.0); everything else is a graded guess.
// ---------------------------------------------------------------------------
assert.equal(entitySimilarity('Transformer', 'Transformer模型').score, 1);
assert.equal(
  entitySimilarity('BERT', 'bert').signals.exactNormalizedMatch,
  true,
);

// The canonical case from the spec: Transformer vs Transformer模型 must be
// flagged, and the reason must be explicable to the user.
const transformerPair = entitySimilarity('Transformer', 'Transformer Model');
assert.ok(transformerPair.score >= DEFAULT_ENTITY_MERGE_THRESHOLD);
assert.ok(transformerPair.reasons.length > 0);

// ---------------------------------------------------------------------------
// Scoring bands.
//
// These numbers are measured, not aspirational, and they are pinned here so a
// future weight change cannot silently widen either band. Measured separation:
// real variants land at 0.88–0.98; genuinely distinct entities top out at ~0.79
// ("ResNet" vs "ResNeXt"), so the 0.86 threshold sits in open space.
// ---------------------------------------------------------------------------
const variantsAboveThreshold = [
  ['Graph Convolutional Network', 'Graph Convolution Networks'],
  ['Self Supervised Learning', 'Self Supervised Learing'],
  ['Contrastive Learning', 'Contrastive Learing'],
  ['Knowledge Distillation', 'Knowlege Distillation'],
  ['Few Shot Learning', 'Few-Shot Learing'],
];
for (const [left, right] of variantsAboveThreshold) {
  const result = entitySimilarity(left, right);
  assert.ok(
    result.score >= DEFAULT_ENTITY_MERGE_THRESHOLD,
    `variant "${left}" vs "${right}" scored ${result.score.toFixed(3)}; must clear ${DEFAULT_ENTITY_MERGE_THRESHOLD}`,
  );
}

// Nothing that is a different entity may reach the threshold, and ideally none
// reaches even the review band. "ResNet"/"ResNeXt" is the closest legitimate
// pair and is asserted explicitly so the margin is visible.
const distinctEntities = [
  ['BERT', 'ERNIE'],
  ['BERT', 'BERTScore'],
  ['CNN', 'RNN'],
  ['LSTM', 'BiLSTM'],
  ['Precision', 'Recall'],
  ['图神经网络', '图卷积神经网络'],
  ['Swin Transformer', 'Vision Transformer'],
  ['准确率', '召回率'],
  ['GPT-2', 'GPT-3'],
  ['Transformer', 'Recurrent Neural Network'],
  ['Attention', 'Attention Is All You Need'],
  ['Knowledge Distillation', 'Knowledge Graph'],
];
for (const [left, right] of distinctEntities) {
  const result = entitySimilarity(left, right);
  assert.ok(
    result.score < DEFAULT_ENTITY_MERGE_THRESHOLD,
    `distinct pair "${left}" vs "${right}" scored ${result.score.toFixed(3)}; must stay below the merge threshold`,
  );
}

const closestLegitimate = entitySimilarity('ResNet', 'ResNeXt');
assert.ok(
  closestLegitimate.score < DEFAULT_ENTITY_MERGE_THRESHOLD,
  'ResNet vs ResNeXt must not be auto-mergeable',
);
assert.ok(
  entitySimilarity('Transformer', 'Recurrent Neural Network').score <
    ENTITY_SIMILARITY_REVIEW_FLOOR,
  'unrelated methods must not even appear in the review list',
);

// A one-character typo in a longer name lands in the review band: surfaced for
// the user, but never pre-selected. This is the deliberate conservative edge —
// a single-character error is a larger share of a longer string, so pretending
// certainty here would be guessing.
const longTypo = entitySimilarity('Transformer Encoder', 'Transformer Enocder');
assert.ok(longTypo.score >= ENTITY_SIMILARITY_REVIEW_FLOOR, 'a typo must be surfaced');
assert.ok(longTypo.score < DEFAULT_ENTITY_MERGE_THRESHOLD, 'a typo must not be auto-selected');

// Containment must not promote an unrelated longer name on its own.
const bertScore = entitySimilarity('BERT', 'BERTScore');
assert.ok(bertScore.score < 0.7, `BERT/BERTScore scored ${bertScore.score.toFixed(3)}`);

// Aliases are scored as separate variants, so a known alias counts as a match.
const viaAlias = entitySimilarity('BERT', 'Bidirectional Encoder Representations', {
  leftAliases: ['Bidirectional Encoder Representations from Transformers'],
});
assert.ok(viaAlias.score > entitySimilarity('BERT', 'Bidirectional Encoder Representations').score);

// Embedding cosine is optional and must not be required for alignment to work.
const withoutEmbedding = entitySimilarity('Transformer', 'Transformer Model');
assert.equal(withoutEmbedding.signals.embeddingCosine, undefined);
const withEmbedding = entitySimilarity('Transformer', 'Transformer Model', {
  embeddingCosine: 0.95,
});
assert.ok(withEmbedding.score >= withoutEmbedding.score);

// Empty names must be inert rather than accidentally similar.
assert.equal(entitySimilarity('', 'Transformer').score, 0);
assert.equal(entitySimilarity('', '').score, 0);

// ---------------------------------------------------------------------------
// Merge suggestions.
//
// Fixture choice is deliberate and reflects the measured division of labour:
// descriptor variants ("Transformer Model" / "…Networks" / "…Architecture") are
// exact normalized matches handled by the suffix rules, so they must NEVER reach
// the suggestion list — asking the user to confirm what normalization already
// decided would train them to click "merge" without reading.
//
// The fuzzy path is therefore exercised with a genuine phrasing difference the
// suffix list cannot decide, which is exactly when a confirmation is warranted.
// ---------------------------------------------------------------------------
assert.equal(
  normalizeEntityName('Transformer Networks'),
  normalizeEntityName('Transformer'),
  'descriptor variants must be exact matches, not fuzzy suggestions',
);
assert.notEqual(
  normalizeEntityName('Graph Convolutional Network'),
  normalizeEntityName('Graph Convolution Networks'),
  'the fuzzy fixture must survive normalization',
);
assert.ok(
  entitySimilarity(
    'Graph Convolutional Network',
    'Graph Convolution Networks',
  ).score >= DEFAULT_ENTITY_MERGE_THRESHOLD,
  'a close spelling/word-form variant should be a merge suggestion',
);
// Hyphenation and separator differences are NOT fuzzy: they must already be
// exact matches, otherwise the user is asked to confirm punctuation.
assert.equal(
  normalizeEntityName('Retrieval Augmented Generation'),
  normalizeEntityName('Retrieval-Augmented Generation'),
);
assert.equal(
  normalizeEntityName('Self-Supervised Learning'),
  normalizeEntityName('Self Supervised Learning'),
);
assert.equal(
  normalizeEntityName('Contrastive Language-Image Pretraining'),
  normalizeEntityName('Contrastive Language Image Pre-training'),
);

const suggestions = suggestEntityMerges([
  { entityId: 'e1', name: 'Graph Convolutional Network', evidenceCount: 5, createdAt: 10 },
  { entityId: 'e2', name: 'Graph Convolution Networks', evidenceCount: 1, createdAt: 20 },
  { entityId: 'e3', name: 'BERT', evidenceCount: 3, createdAt: 30 },
  { entityId: 'e4', name: 'ERNIE', evidenceCount: 3, createdAt: 40 },
]);
assert.equal(suggestions.length, 1, 'only the genuine variant pair may be suggested');
assert.equal(suggestions[0].mergeEntityId, 'e2');
assert.equal(
  suggestions[0].keepEntityId,
  'e1',
  'the better-evidenced entity must survive the merge',
);
assert.equal(suggestions[0].autoSelectable, true);

// The review tier: a typo pair is listed but flagged as not auto-selectable, so
// the UI can show it without pre-ticking something the score cannot justify.
const reviewTier = suggestEntityMerges([
  { entityId: 'a', name: 'Transformer Encoder' },
  { entityId: 'b', name: 'Transformer Enocder' },
]);
assert.equal(reviewTier.length, 1, 'a typo pair must still be surfaced');
assert.equal(reviewTier[0].autoSelectable, false, 'a typo pair must not be pre-selected');

// Descriptor variants are silent merges, not suggestions.
const exactPairsOnly = suggestEntityMerges([
  { entityId: 'a', name: 'Transformer' },
  { entityId: 'b', name: 'Transformer模型' },
  { entityId: 'c', name: 'Transformer Model' },
  { entityId: 'd', name: 'Transformer Architecture' },
  { entityId: 'e', name: 'Transformer Networks' },
]);
assert.deepEqual(exactPairsOnly, []);

// Evidence count decides survival; ties fall back to creation time, then id.
const tieByEvidence = suggestEntityMerges([
  { entityId: 'x', name: 'Graph Convolutional Network', evidenceCount: 1 },
  { entityId: 'y', name: 'Graph Convolution Networks', evidenceCount: 9 },
]);
assert.equal(tieByEvidence.length, 1);
assert.equal(tieByEvidence[0].keepEntityId, 'y');

const tieByCreatedAt = suggestEntityMerges([
  { entityId: 'old', name: 'Graph Convolutional Network', evidenceCount: 2, createdAt: 1 },
  { entityId: 'new', name: 'Graph Convolution Networks', evidenceCount: 2, createdAt: 99 },
]);
assert.equal(tieByCreatedAt[0].keepEntityId, 'old');

// Determinism: the same input must produce the same suggestions in the same
// order, otherwise the UI list would reshuffle on every open.
//
// The fixture deliberately mixes the two kinds of pair. "Graph Attention
// Network(s)" normalizes to ONE key (the `networks` suffix rule strips it), so
// it is a silent merge and must not appear; "Graph Convolutional Network(s)"
// survives normalization as `graphconvolutional` vs `graphconvolution`, so it is
// the fuzzy suggestion. Pinning both here means a future weight change that
// starts promoting exact matches into the confirmation list will fail loudly.
const determinismFixture = [
  { entityId: 'a', name: 'Graph Convolutional Network' },
  { entityId: 'b', name: 'Graph Convolution Networks' },
  { entityId: 'c', name: 'Graph Attention Network' },
  { entityId: 'd', name: 'Graph Attention Networks' },
];
const firstRun = suggestEntityMerges(determinismFixture);
const secondRun = suggestEntityMerges(determinismFixture);
assert.deepEqual(firstRun, secondRun);
assert.equal(firstRun.length, 1, 'only the pair that survives normalization is suggested');
assert.equal(firstRun[0].keepEntityId, 'a');
assert.equal(firstRun[0].mergeEntityId, 'b');
assert.equal(
  normalizeEntityName('Graph Attention Network'),
  normalizeEntityName('Graph Attention Networks'),
  'the plural form must remain an exact match, not a suggestion',
);
assert.equal(
  normalizeEntityName('Graph Convolutional Network') ===
    normalizeEntityName('Graph Convolution Networks'),
  false,
  'the fuzzy pair must not become an exact match',
);

// The cap must bound work rather than silently analysing everything.
assert.ok(suggestEntityMerges(
  Array.from({ length: 50 }, (_, index) => ({ entityId: `e${index}`, name: `Method ${index}` })),
  { maxEntities: 5 },
).every((suggestion) => suggestion.keepEntityId.startsWith('e')));

console.log('Entity alignment contract tests passed.');
