import assert from 'node:assert/strict';

import {
  attachEntityDescriptions,
  buildEntityExplanationPrompt,
  buildExplanationUserMessage,
  buildStreamingExplanationPrompt,
  countEntitiesMissingExplanation,
  describeBulkExplanationResult,
  describeExplanationResult,
  explainEntityDescriptions,
  explainMissingDescriptions,
  normalizeExplanation,
  normalizeStreamingExplanation,
  parseEntityExplanations,
  planExplanationTargets,
  EXPLANATIONS_PER_CALL,
  MAX_EXPLANATION_CHARACTERS,
} from '../src/modules/knowledge-graph/application/entity-explanations.ts';
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
    abstract: '',
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

function entity(entityId, name, overrides = {}) {
  return {
    entityId,
    name,
    // The real normalized form, not a lowercase stand-in: name matching is what decides identity in
    // the graph, so the fixture has to use the same function the store does.
    normalizedName: normalizeEntityName(name),
    aliases: [],
    type: 'Method',
    status: 'confirmed',
    confidence: 0.9,
    sourcePaperId: 'P1',
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The prompt: explanations are glosses grounded in the paper, not dictionary entries.
// ---------------------------------------------------------------------------
const prompt = buildEntityExplanationPrompt();
assert.match(prompt, /这一篇论文|这篇论文/, 'the prompt must anchor the gloss in the paper');
assert.match(prompt, /原文/, 'and must point at the source text');
assert.match(prompt, /explanations/, 'the answer format is named');
assert.doesNotMatch(
  prompt,
  /最多\s*\d+\s*个实体/,
  'no numeric quota: a stated quota reads as a target to fill',
);
assert.match(prompt, /不要编造/, 'inventing facts is forbidden explicitly');

// ---------------------------------------------------------------------------
// The user message: every piece of grounding that exists is sent, and absent
// pieces are omitted rather than sent empty (an empty 摘要 invites invention).
// ---------------------------------------------------------------------------
const message = buildExplanationUserMessage([
  {
    name: 'Boyar-Peralta',
    type: 'Method',
    aliases: ['BP heuristic'],
    paperTitle: 'Low Power Heuristics',
    abstract: 'We compare against the Boyar-Peralta heuristic.',
    quotes: ['we compare against the Boyar-Peralta heuristic'],
  },
  { name: 'GPT-3', type: 'Method', paperTitle: 'Scaling', quotes: [] },
]);
assert.match(message, /名字：Boyar-Peralta/);
assert.match(message, /类型：Method/);
assert.match(message, /别名：BP heuristic/);
assert.match(message, /论文：Low Power Heuristics/);
assert.match(message, /摘要：We compare against/);
assert.match(message, /原文片段：[\s\S]*- we compare against/);
assert.match(message, /名字：GPT-3/);
assert.equal(
  (message.match(/摘要：/g) ?? []).length,
  1,
  'only the entity with an abstract gets the block',
);

// ---------------------------------------------------------------------------
// Which entities get explained: confirmed ones that do not have a meaning yet.
// ---------------------------------------------------------------------------
const papers = [
  paper('P1', { title: 'Low Power Heuristics', abstract: 'We compare against BP.' }),
  paper('P2', { title: 'Other Paper' }),
];
const entities = [
  entity('e1', 'Boyar-Peralta', {
    sourcePaperId: 'P1',
    aliases: ['BP heuristic'],
    evidence: [
      { paperId: 'P1', pageNumber: 3, quote: 'we compare against the Boyar-Peralta heuristic' },
      { paperId: 'P1', pageNumber: 3, quote: 'we compare against the Boyar-Peralta heuristic' },
      { paperId: 'P1', pageNumber: 4, quote: 'the Boyar-Peralta flow is slower' },
      { paperId: 'P2', pageNumber: 1, quote: 'a quote from another paper' },
    ],
  }),
  entity('e2', 'Already Explained', { description: '这句已经有了。' }),
  entity('e3', 'Still Pending', { status: 'pending' }),
];

const targets = planExplanationTargets(entities, papers);
assert.equal(targets.length, 1, 'already-explained, pending and rejected entities are skipped');
assert.equal(targets[0].entityId, 'e1');
assert.equal(targets[0].paperTitle, 'Low Power Heuristics');
assert.equal(targets[0].abstract, 'We compare against BP.');
assert.deepEqual(targets[0].aliases, ['BP heuristic']);
assert.equal(targets[0].quotes.length, 2, 'quotes are deduplicated and capped');
assert.ok(
  !targets[0].quotes.includes('a quote from another paper'),
  'only the source paper counts as grounding for this entity',
);

// `force` is what the inspector's 「重新生成」 uses: the entity already has a meaning, so the
// "already explained" filter is waived — and only that filter, so pending entities are still skipped.
assert.equal(
  planExplanationTargets(entities, papers, { force: true }).length,
  2,
  'force ignores the existing description but never the status',
);
assert.equal(
  planExplanationTargets(entities, papers, { force: true, names: ['already explained'] }).length,
  1,
  'names are matched on the normalized form, like everywhere else in the graph',
);
assert.equal(
  planExplanationTargets(entities, papers, { names: ['nobody'] }).length,
  0,
  'an unknown name selects nothing rather than everything',
);
assert.ok(
  planExplanationTargets(
    Array.from({ length: 30 }, (_, index) => entity(`many-${index}`, `Name ${index}`)),
    papers,
  ).length <= EXPLANATIONS_PER_CALL,
  'one call carries a bounded number of entities',
);

// ---------------------------------------------------------------------------
// Parsing: the answer is JSON from a provider without a JSON mode.
// ---------------------------------------------------------------------------
const targetsFor = planExplanationTargets(
  [
    entity('e1', 'Boyar-Peralta'),
    entity('e2', 'ΔE >> 5%', { type: 'Metric' }),
  ],
  papers,
);
const parsed = parseEntityExplanations(
  '```json\n{"explanations":[{"name":"boyar-peralta","explain":"本文用来对比的启发式优化方法"},'
  + '{"name":"ΔE >> 5%","explain":"论文要求达到的节能幅度门槛"},'
  + '{"name":"不存在的实体","explain":"应被丢弃"}]}\n```',
  targetsFor,
);
assert.equal(parsed.get('e1'), '本文用来对比的启发式优化方法', 'name matching is case-insensitive');
assert.equal(parsed.get('e2'), '论文要求达到的节能幅度门槛', 'symbols survive verbatim');
assert.equal(parsed.size, 2, 'an entity that was never asked about is dropped');

// Tolerates prose around the JSON and a bare array, both of which models produce.
assert.equal(
  parseEntityExplanations(
    '好的，结果如下：\n[{"name":"Boyar-Peralta","explain":"一句解释"}]\n希望有帮助。',
    targetsFor,
  ).get('e1'),
  '一句解释',
);
// An unreadable answer is "no explanations", never a thrown error: this runs after a confirmation the
// user already completed.
assert.equal(parseEntityExplanations('not json at all', targetsFor).size, 0);
assert.equal(parseEntityExplanations('', targetsFor).size, 0);
// A long answer is cut to one short line, because the panel has room for one line.
const long = normalizeExplanation(`x${'很'.repeat(200)}`);
assert.ok(long.length <= MAX_EXPLANATION_CHARACTERS);
assert.ok(long.endsWith('…'));
assert.equal(normalizeExplanation('  "  一句  解释 " '), '一句 解释', 'quotes and spacing are cleaned');

// ---------------------------------------------------------------------------
// Writing: only records that actually changed are handed to `putEntities`.
// ---------------------------------------------------------------------------
const attached = attachEntityDescriptions(
  [
    entity('e1', 'A'),
    entity('e2', 'B', { description: '旧的' }),
    entity('e3', 'C'),
  ],
  new Map([['e1', '新的解释'], ['e2', '旧的'], ['e3', '']]),
  1234,
);
assert.equal(attached.length, 1, 'an unchanged or empty explanation rewrites nothing');
assert.equal(attached[0].entityId, 'e1');
assert.equal(attached[0].description, '新的解释');
assert.equal(attached[0].descriptionUpdatedAt, 1234);
assert.equal(attachEntityDescriptions([entity('e1', 'A')], new Map()).length, 0);

// ---------------------------------------------------------------------------
// The runner: one request, then a write; and never a thrown error.
// ---------------------------------------------------------------------------
function createRepository(seed) {
  const state = { entities: seed, writes: [] };
  return {
    state,
    async listEntities() {
      return [...state.entities];
    },
    async putEntities(updated) {
      state.writes.push(updated);
      const byId = new Map(state.entities.map((item) => [item.entityId, item]));
      for (const item of updated) byId.set(item.entityId, item);
      state.entities = [...byId.values()];
    },
  };
}

function createPorts(response) {
  const state = { requests: [] };
  return {
    state,
    async requestExplanations(request) {
      state.requests.push(request);
      return typeof response === 'function' ? response(request) : response;
    },
  };
}

const happyRepository = createRepository([entity('e1', 'Boyar-Peralta')]);
const happyPorts = createPorts({
  ok: true,
  content: JSON.stringify({ explanations: [{ name: 'Boyar-Peralta', explain: '对比用的启发式方法' }] }),
});
const happy = await explainEntityDescriptions(
  { papers, names: ['Boyar-Peralta'] },
  happyPorts,
  happyRepository,
);
assert.equal(happy.described, 1);
assert.equal(happy.missed, 0);
assert.equal(happyRepository.state.entities[0].description, '对比用的启发式方法');
assert.equal(happyPorts.state.requests.length, 1, 'one request for the whole confirmation');
assert.equal(happyPorts.state.requests[0].type, 'pdf-helper:ai-explain-entities');
assert.equal(happyPorts.state.requests[0].items.length, 1);
assert.deepEqual(happyPorts.state.requests[0].items[0].quotes, []);
assert.match(describeExplanationResult(happy), /1 个实体生成解释/);

// Partial answers are honest about what is missing.
const partialRepository = createRepository([entity('e1', 'A'), entity('e2', 'B')]);
const partial = await explainEntityDescriptions(
  { papers },
  createPorts({ ok: true, content: '{"explanations":[{"name":"A","explain":"A 的解释"}]}' }),
  partialRepository,
);
assert.equal(partial.described, 1);
assert.equal(partial.missed, 1);
assert.equal(partialRepository.state.entities.length, 2, 'nothing is deleted when an answer is missing');

// A provider failure leaves every record untouched and reports instead of throwing.
const failedRepository = createRepository([entity('e1', 'A')]);
const failed = await explainEntityDescriptions(
  { papers },
  createPorts({ ok: false, error: '没有配置 API Key' }),
  failedRepository,
);
assert.equal(failed.described, 0);
assert.match(failed.error, /API Key/);
assert.equal(failedRepository.state.writes.length, 0, 'a failed explanation must not touch the store');
assert.match(describeExplanationResult(failed), /没有生成/);

// A transport that throws is caught the same way: this runs after a completed confirmation.
const thrown = await explainEntityDescriptions(
  { papers },
  createPorts(() => {
    throw new Error('runtime disconnected');
  }),
  createRepository([entity('e1', 'A')]),
);
assert.match(thrown.error, /runtime disconnected/);

// Nothing to explain means no request at all, which is what keeps batch extraction free.
const emptyPorts = createPorts({ ok: true, content: '{}' });
const nothing = await explainEntityDescriptions(
  { papers, names: ['Already Explained'] },
  emptyPorts,
  createRepository([entity('e9', 'Already Explained', { description: '已有解释' })]),
);
assert.equal(emptyPorts.state.requests.length, 0, 'an explained entity is never re-asked');
assert.equal(nothing.described, 0);
assert.equal(describeExplanationResult(nothing), '', 'nothing to say when nothing was asked');

// ---------------------------------------------------------------------------
// The streaming path (the inspector's 「生成解释」): one entity, plain text, shown as it arrives.
//
// A different contract on purpose. The batch prompt above asks for JSON, which is fine when nobody
// is watching; the panel streams the answer, and `{"explanations":[{"name":…` is not something a
// reader can watch. So this prompt asks for the sentence alone, and the normalizer has to survive a
// model that answers with JSON, a fence or a 「解释：」 label anyway.
// ---------------------------------------------------------------------------
const streamPrompt = buildStreamingExplanationPrompt();
assert.match(streamPrompt, /只输出这一句/, 'the streaming prompt asks for the sentence only');
assert.match(streamPrompt, /不要 JSON/i, 'and says so explicitly, because the batch prompt is a habit');
assert.match(streamPrompt, /40/, 'the length ceiling is stated');
assert.match(streamPrompt, /不要编造/, 'grounding is required here too');
assert.doesNotMatch(streamPrompt, /explanations/, 'no JSON schema: it is not a JSON answer');

assert.equal(
  normalizeStreamingExplanation('  本文用来对比的启发式电路优化方法  '),
  '本文用来对比的启发式电路优化方法',
  'a plain sentence is stored as-is',
);
assert.equal(
  normalizeStreamingExplanation('解释：本文用来对比的启发式方法'),
  '本文用来对比的启发式方法',
  'a leading label is scaffolding, not content',
);
assert.equal(
  normalizeStreamingExplanation('```text\n本文用来对比的启发式方法\n```'),
  '本文用来对比的启发式方法',
  'a fence that was asked not to appear is stripped rather than stored',
);
assert.equal(
  normalizeStreamingExplanation('{"explanations":[{"name":"X","explain":"JSON 里的解释"}]}'),
  'JSON 里的解释',
  'a JSON answer is recovered instead of showing braces in the panel',
);
assert.equal(
  normalizeStreamingExplanation('好的，\n本文用来对比的启发式方法'),
  '好的，',
  'the first meaningful line wins — streaming ends up storing one line, not a transcript',
);
assert.ok(
  normalizeStreamingExplanation('很'.repeat(200)).length <= MAX_EXPLANATION_CHARACTERS,
  'the stored text is bounded by the same cap as the batch path',
);
assert.equal(normalizeStreamingExplanation('   '), '', 'an empty stream stores nothing');

// ---------------------------------------------------------------------------
// The bulk run behind 「补全解释」: every confirmed entity without a meaning, in rounds.
//
// It is a loop, so the loop's stop conditions are the interesting part: no missing entities, a round
// that produced nothing (the model is refusing — asking again buys the same silence), and the round
// ceiling. Plus the one thing a bulk action must never do: re-ask for an entity that already has a
// meaning.
// ---------------------------------------------------------------------------
assert.equal(
  countEntitiesMissingExplanation([
    entity('a', 'A'),
    entity('b', 'B', { description: '已有' }),
    entity('c', 'C', { status: 'pending' }),
  ]),
  1,
  'only confirmed entities without a meaning count',
);

const bulkRepository = createRepository(
  Array.from({ length: 5 }, (_, index) => entity(`bulk-${index}`, `Bulk ${index}`)),
);
const bulkPorts = createPorts((request) => ({
  ok: true,
  content: JSON.stringify({
    explanations: request.items.map((item) => ({ name: item.name, explain: `${item.name} 的解释` })),
  }),
}));
const bulkProgress = [];
const bulk = await explainMissingDescriptions(
  { papers, onProgress: (progress) => bulkProgress.push(progress) },
  bulkPorts,
  bulkRepository,
);
assert.equal(bulk.described, 5);
assert.equal(bulk.missed, 0);
assert.equal(bulkPorts.state.requests.length, 1, 'five entities fit in one round');
assert.equal(bulkRepository.state.entities.every((item) => item.description), true);
assert.equal(bulkProgress.length, 1);
assert.match(bulkProgress[0].message, /还剩 0 个/);
assert.match(describeBulkExplanationResult(bulk), /已为 5 个实体生成解释/);

// More entities than one call holds: further rounds, and the described ones are never re-asked.
const manyRepository = createRepository(
  Array.from({ length: 20 }, (_, index) => entity(`many-${index}`, `Many ${index}`)),
);
const manyPorts = createPorts((request) => ({
  ok: true,
  content: JSON.stringify({
    explanations: request.items.map((item) => ({ name: item.name, explain: `${item.name} 的解释` })),
  }),
}));
const many = await explainMissingDescriptions({ papers }, manyPorts, manyRepository);
assert.equal(many.described, 20);
assert.equal(manyPorts.state.requests.length, 2, '20 entities is two rounds of the per-call cap');
assert.equal(manyPorts.state.requests[0].items.length, EXPLANATIONS_PER_CALL);
assert.equal(
  manyPorts.state.requests[1].items.length,
  20 - EXPLANATIONS_PER_CALL,
  'the second round only asks for what is left',
);
const secondRoundNames = manyPorts.state.requests[1].items.map((item) => item.name);
assert.ok(
  !secondRoundNames.includes('Many 0'),
  'an entity explained in round one is not asked about again',
);

// A round that describes nothing ends the run: asking the same question again would spend tokens to
// receive the same silence.
const stubbornRepository = createRepository([
  entity('s1', 'Stubborn One'),
  entity('s2', 'Stubborn Two'),
]);
const stubbornPorts = createPorts({ ok: true, content: '{"explanations":[]}' });
const stubborn = await explainMissingDescriptions({ papers }, stubbornPorts, stubbornRepository);
assert.equal(stubborn.described, 0);
assert.equal(stubborn.missed, 2);
assert.equal(stubbornPorts.state.requests.length, 1, 'one unanswered round is enough to stop');
assert.match(describeBulkExplanationResult(stubborn), /模型没有给出可用的解释/);

// Nothing missing: no request is made at all.
const allDonePorts = createPorts({ ok: true, content: '{}' });
const allDone = await explainMissingDescriptions(
  { papers },
  allDonePorts,
  createRepository([entity('done', 'Done', { description: '已经有了' })]),
);
assert.equal(allDonePorts.state.requests.length, 0);
assert.match(describeBulkExplanationResult(allDone), /所有实体都已有解释/);

// The round ceiling stops a corpus that keeps failing partway, and says so instead of looping.
const ceilingPorts = createPorts((request) => ({
  ok: true,
  content: JSON.stringify({ explanations: [{ name: request.items[0]?.name, explain: '只解释第一个' }] }),
}));
const ceiling = await explainMissingDescriptions(
  { papers, maxRounds: 2 },
  ceilingPorts,
  createRepository(Array.from({ length: 6 }, (_, index) => entity(`ceil-${index}`, `Ceil ${index}`))),
);
assert.equal(ceilingPorts.state.requests.length, 2);
assert.equal(ceiling.truncated, true, 'a capped run is reported as truncated, not as finished');
assert.ok(ceiling.missed > 0);
assert.match(describeBulkExplanationResult(ceiling), /已达单次上限/);

// A provider error stops the run but keeps whatever already landed: partial success is reported, not
// thrown away.
const failingRepository = createRepository(
  Array.from({ length: 14 }, (_, index) => entity(`fail-${index}`, `Fail ${index}`)),
);
const failingPorts = createPorts((request) => (
  request.requestId?.endsWith(':1')
    ? { ok: false, error: 'provider exploded' }
    : {
      ok: true,
      content: JSON.stringify({
        explanations: request.items.map((item) => ({ name: item.name, explain: '一句解释' })),
      }),
    }
));
const failingBulk = await explainMissingDescriptions({ papers }, failingPorts, failingRepository);
assert.equal(failingBulk.described, EXPLANATIONS_PER_CALL, 'round one is kept');
assert.match(failingBulk.error, /provider exploded/);
assert.match(describeBulkExplanationResult(failingBulk), /随后失败/);

console.log('Entity explanation contract tests passed.');
