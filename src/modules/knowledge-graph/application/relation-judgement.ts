import {
  ENTITY_TYPES,
  NEGATIVE_EDGE_TYPES,
  PAPER_PAPER_EDGE_TYPES,
  type EdgeType,
  type GraphEdge,
  type GraphEvidence,
  type PaperPaperEdgeType,
} from '../contracts.ts';

/** The paper-paper verdicts whose meaning depends on which way the arrow points. */
export const DIRECTED_PAPER_VERDICTS: readonly PaperPaperEdgeType[] = ['CITES', 'EXTENDS', 'IMPROVES'];
import { createGraphId } from '../domain/graph-identity.ts';
import {
  emptyBridgeDrops,
  parseBridgeSuggestions,
  type BridgeDropStats,
  type RelationBridgeSuggestion,
} from './relation-bridges.ts';
import type { RelationCandidatePair } from './relation-recall.ts';
import { relationPairKey } from './relation-recall.ts';

/**
 * Turns a model's relationship judgements into graph edges.
 *
 * The model has no JSON mode here (a whole-repo grep for `response_format` comes
 * back empty), so this is "prompt for JSON, parse defensively". Three rules
 * matter more than the parsing mechanics:
 *
 * 1. **A pair the model never answered is NOT cached as judged.** If a response is
 *    truncated, treating silence as "no relationship" would write a permanent
 *    false negative into the cache and the pair would never be asked about again.
 *    Only an explicit `NONE` is cacheable.
 * 2. **A pair that was not sent is rejected.** The model gets a bounded candidate
 *    list; inventing a pair outside it would create an edge between two papers
 *    nobody asked about, with evidence that cannot be traced.
 * 3. **Never throw on malformed input.** A bad batch must yield no edges rather
 *    than abort a run whose tokens are already spent, and `rejected` reports why.
 */

export type RelationVerdict = PaperPaperEdgeType | 'NONE';

export const RELATION_NONE = 'NONE';

/** Which way a directed paper-paper verdict points, or `none` when the model could not tell. */
export type RelationDirection = 'leftToRight' | 'rightToLeft' | 'none';

/**
 * - `relation-judgement-1` judged only the relation type.
 * - `relation-judgement-2` adds the second task: bridge concepts, with a verbatim quote required from
 *   **each** paper. The quotes are checked locally against the excerpts that were sent
 *   (`quoteAppearsIn`), which is what turns "the model should not invent entities" from a wish into a
 *   rule: an invented concept has no quote to point at, so it never reaches the graph.
 * - `relation-judgement-3` asks which way the relation points. Until then the edge's `source`/`target`
 *   came from the candidate pair's ordering (a database primary-key order), so half of all `CITES`
 *   arrows pointed the wrong way and the evidence quote was filed under the wrong paper.
 */
export const RELATION_PROMPT_VERSION = 'relation-judgement-3';

/** Evidence quotes kept per edge, and their maximum length. */
export const MAX_RELATION_EVIDENCE = 2;
export const MAX_RELATION_QUOTE_LENGTH = 200;

export function buildRelationJudgementPrompt(): string {
  return [
    '你是学术文献关系判定器，同时负责为知识图谱找出"能把两篇论文真正连起来"的概念实体。',
    '',
    '输入包含两部分：',
    '1. 论文清单：每篇的标题与原文摘录（摘录是原文片段，不是概括）。',
    '2. 待判断的论文对。',
    '',
    '【任务一：判断关系类型】',
    '每对只给一个结论：',
    '- CITES：一篇引用或依赖另一篇',
    '- EXTENDS：在一篇的基础上扩展/改进',
    '- IMPROVES：针对同一问题给出更好的结果',
    '- COMPARES_WITH：明确相互比较或评测',
    '- SIMILAR_TO：做同一件事、方法高度相似，但无直接引用或继承',
    '- NONE：在方法、任务、数据、结论上都没有实质联系',
    '',
    '只看摘录里的实际内容。标题相似、年份接近、同属一个领域，都不构成关系。',
    '',
    '【方向】CITES / EXTENDS / IMPROVES 是有方向的，必须用 direction 字段说明：',
    '- leftToRight：左篇（leftPaperId）引用、扩展或改进了右篇；',
    '- rightToLeft：反过来，右篇引用、扩展或改进了左篇；',
    '- none：摘录里看不出方向（例如只知道两篇同期工作相关）。',
    '方向只能依据摘录判断。leftPaperId/rightPaperId 的先后顺序没有任何含义，不要拿它当方向。',
    'COMPARES_WITH / SIMILAR_TO / NONE 没有方向，direction 一律填 none。',
    'evidence 必须摘自**被引用/被扩展的那一篇之外**的、也就是方向上游那篇的摘录；看不出方向时可以用任一方的摘录。',
    '',
    '【任务二：寻找桥接概念】',
    '若两篇论文确实共享某个具体的概念、方法、数据集、指标或问题设定，把它整理成一个可入图的知识实体，'
      + '并给出**两篇论文各自的原文引文**：',
    '- 引文必须逐字摘自对应论文的摘录：不能改写、不能翻译、不能拼接两句。',
    '- 若某篇摘录里找不到支撑它的句子，这个桥接实体就不成立，不要给出。',
    '- 名字必须是具体的"名字"，例如 "Booth 乘法器"、"Wallace 树"、"ΔE >> 5%"；'
      + '不要给描述性短语，例如 "一种优化方法"、"两者的共同点"、"该论文提出的框架"。',
    '- 宁缺毋滥。没有就返回空数组 []，绝对不要为了凑数而编造。',
    '',
    '【输出格式】',
    '只输出 JSON，不要解释文字，不要 Markdown 代码块：',
    '{"pairs":[{"pairKey":"a|b","relation":"EXTENDS","confidence":0.82,'
      + '"direction":"leftToRight",'
      + '"rationale":"不超过50字","evidence":"支持该判定的原文片段",'
      + '"bridges":[{"name":"Booth 乘法器","type":"Method",'
      + '"leftQuote":"逐字摘自左篇摘录的句子","rightQuote":"逐字摘自右篇摘录的句子",'
      + '"reason":"不超过30字","confidence":0.7}]}]}',
    '',
    `type 只能是 ${ENTITY_TYPES.join(' / ')}。`,
    'relation 为 NONE 时 bridges 一般为空数组。',
  ].join('\n');
}

export interface ParsedRelation {
  pairKey: string;
  leftPaperId: string;
  rightPaperId: string;
  verdict: RelationVerdict;
  confidence: number;
  evidenceQuote: string;
  rationale: string;
  /** Edge to write, or null for `NONE`. */
  edge: GraphEdge | null;
  /** Bridge concepts accepted for this pair (already validated against the excerpts). */
  bridges: RelationBridgeSuggestion[];
}

export interface RelationParseResult {
  /** Pairs with a real relationship, carrying edges ready to persist. */
  relations: ParsedRelation[];
  /**
   * Pairs the model explicitly judged to have no relationship.
   *
   * These are cacheable: recording them is what stops the same pair being sent
   * again. Pairs the model simply omitted are NOT included — see the module note.
   */
  explicitNone: ParsedRelation[];
  /** Every accepted bridge, flattened across pairs, in pair order. */
  bridges: RelationBridgeSuggestion[];
  /** Bridges refused by the local checks, by reason. */
  bridgeDrops: BridgeDropStats;
  /** Pairs that were sent but never mentioned. Not cacheable. */
  unansweredPairKeys: string[];
  rejected: Array<{ reason: string; raw: unknown }>;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? trimmed;
}

/**
 * Extracts the payload from a model response.
 *
 * Candidate order matters. A bare array must be tried **before** the object
 * slice: for `[{"pairKey":…}]` the object slice is the inner element, and
 * returning that would hide the envelope — the caller would then see a single
 * judgement-shaped object instead of a list of them.
 */
function extractJson(text: string): unknown {
  const stripped = stripCodeFence(text);
  const candidates: string[] = [];

  const firstBracket = stripped.indexOf('[');
  const lastBracket = stripped.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(stripped.slice(firstBracket, lastBracket + 1));
  }
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(stripped.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(stripped);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeVerdict(value: unknown): RelationVerdict | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper === RELATION_NONE) return RELATION_NONE;
  return (PAPER_PAPER_EDGE_TYPES as readonly string[]).includes(upper)
    ? upper as PaperPaperEdgeType
    : null;
}

/** Which way the model said a directed verdict points. Unknown input reads as `none`, never as a guess. */
export function normalizeRelationDirection(value: unknown): RelationDirection {
  if (typeof value !== 'string') return 'none';
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'lefttoright' || key === 'left' || key === 'l2r' || key === 'source2target') return 'leftToRight';
  if (key === 'righttoleft' || key === 'right' || key === 'r2l' || key === 'target2source') return 'rightToLeft';
  return 'none';
}

function clampUnit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = parsed > 2 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

function relationRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  for (const key of ['relations', 'results', 'pairs', 'items', 'data']) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  // A single judgement object is accepted as a one-row payload: a model asked
  // about one pair may reasonably answer with just that object, and rejecting it
  // would discard a usable answer.
  if (typeof payload.pairKey === 'string') return [payload];
  return null;
}

/**
 * Parses judgements for a known set of candidate pairs.
 *
 * `pairs` is required rather than optional: it is the allow-list that makes
 * "the model answered about pairs we sent" verifiable instead of assumed.
 */
export function parseRelationJudgements(
  content: string,
  pairs: readonly RelationCandidatePair[],
  options: {
    now?: number;
    model?: string;
    promptVersion?: string;
    /** Verbatim excerpts by paper id, required for bridge validation. */
    excerpts?: ReadonlyMap<string, string>;
  } = {},
): RelationParseResult {
  const now = options.now ?? Date.now();
  const byPairKey = new Map(pairs.map((pair) => [pair.pairKey, pair]));
  const payload = extractJson(content);
  const rows = relationRows(payload);
  const bridgeDrops = emptyBridgeDrops();
  const excerpts = options.excerpts ?? new Map<string, string>();

  if (!rows) {
    return {
      relations: [],
      explicitNone: [],
      bridges: [],
      bridgeDrops,
      // Every pair is unanswered: a response we could not read tells us nothing,
      // so nothing may be cached.
      unansweredPairKeys: pairs.map((pair) => pair.pairKey),
      rejected: [{ reason: '模型没有返回可解析的关系判断 JSON。', raw: content.slice(0, 200) }],
    };
  }

  const relations: ParsedRelation[] = [];
  const explicitNone: ParsedRelation[] = [];
  const bridges: RelationBridgeSuggestion[] = [];
  const answered = new Set<string>();
  const rejected: RelationParseResult['rejected'] = [];

  const accumulate = (drops: BridgeDropStats): void => {
    bridgeDrops.quoteMismatch += drops.quoteMismatch;
    bridgeDrops.lowQuality += drops.lowQuality;
    bridgeDrops.badType += drops.badType;
    bridgeDrops.overLimit += drops.overLimit;
    bridgeDrops.duplicate += drops.duplicate;
  };

  for (const row of rows) {
    if (!isRecord(row)) {
      rejected.push({ reason: '条目不是对象。', raw: row });
      continue;
    }
    const pairKey = typeof row.pairKey === 'string' ? row.pairKey.trim() : '';
    const pair = byPairKey.get(pairKey);
    if (!pair) {
      // Either invented or referring to a pair outside the budget. Writing it
      // would create an edge nobody asked for.
      rejected.push({ reason: `未知的 pairKey：${pairKey || '(空)'}`, raw: row });
      continue;
    }
    if (answered.has(pairKey)) {
      rejected.push({ reason: `重复的 pairKey：${pairKey}`, raw: row });
      continue;
    }
    const verdict = normalizeVerdict(row.relation ?? row.type ?? row.verdict);
    if (!verdict) {
      rejected.push({ reason: `未知的关系类型：${String(row.relation ?? row.type)}`, raw: row });
      continue;
    }
    answered.add(pairKey);
    const direction = normalizeRelationDirection(
      row.direction ?? row.relationDirection ?? row.directionOfRelation,
    );

    const parsedBridges = parseBridgeSuggestions(row.bridges, pair, { excerpts });
    accumulate(parsedBridges.drops);
    bridges.push(...parsedBridges.bridges);

    const evidenceQuote = normalizeText(row.evidence ?? row.quote, MAX_RELATION_QUOTE_LENGTH);
    const rationale = normalizeText(row.rationale ?? row.reason, 60);
    const confidence = verdict === RELATION_NONE ? 1 : clampUnit(row.confidence, 0.5);

    const parsed: ParsedRelation = {
      pairKey,
      leftPaperId: pair.leftPaperId,
      rightPaperId: pair.rightPaperId,
      verdict,
      confidence,
      evidenceQuote,
      rationale,
      // A `NONE` verdict still produces an edge. Caching the negative is what
      // stops the same pair being sent to the model on every run.
      edge: buildVerdictEdge(pair, verdict, confidence, evidenceQuote, {
        now,
        model: options.model,
        direction,
        promptVersion: options.promptVersion ?? RELATION_PROMPT_VERSION,
      }),
      bridges: parsedBridges.bridges,
    };
    if (verdict === RELATION_NONE) explicitNone.push(parsed);
    else relations.push(parsed);
  }

  return {
    relations,
    explicitNone,
    bridges,
    bridgeDrops,
    unansweredPairKeys: pairs
      .filter((pair) => !answered.has(pair.pairKey))
      .map((pair) => pair.pairKey),
    rejected,
  };
}

/**
 * Parses one response *per batch* and merges the results.
 *
 * Judgement is split into batches of five pairs (`RELATION_PAIRS_PER_CALL`), and each batch is a separate completion. The
 * transport used to concatenate them into one string, which no JSON reader can parse — so any selection with more than
 * five pairs (four papers is already six) came back as 「模型没有返回可解析的关系判断 JSON」 while a two-paper run
 * worked. That looked like a model problem and was a plumbing problem.
 *
 * Merging is per batch because each batch is an independent answer over its own pairs: a pair counts as answered if any
 * batch answered it, and a pair is only "unanswered" when no batch mentioned it.
 */
export function parseRelationJudgementBatches(
  contents: readonly string[],
  pairs: readonly RelationCandidatePair[],
  options: {
    now?: number;
    model?: string;
    promptVersion?: string;
    excerpts?: ReadonlyMap<string, string>;
  } = {},
): RelationParseResult {
  const usable = contents.filter((content) => content.trim());
  if (!usable.length) return parseRelationJudgements('', pairs, options);
  if (usable.length === 1) return parseRelationJudgements(usable[0] ?? '', pairs, options);

  const merged: RelationParseResult = {
    relations: [],
    explicitNone: [],
    bridges: [],
    bridgeDrops: emptyBridgeDrops(),
    unansweredPairKeys: [],
    rejected: [],
  };
  const answered = new Set<string>();
  for (const content of usable) {
    const parsed = parseRelationJudgements(content, pairs, options);
    merged.relations.push(...parsed.relations);
    merged.explicitNone.push(...parsed.explicitNone);
    merged.bridges.push(...parsed.bridges);
    merged.rejected.push(...parsed.rejected);
    merged.bridgeDrops.quoteMismatch += parsed.bridgeDrops.quoteMismatch;
    merged.bridgeDrops.lowQuality += parsed.bridgeDrops.lowQuality;
    merged.bridgeDrops.badType += parsed.bridgeDrops.badType;
    merged.bridgeDrops.overLimit += parsed.bridgeDrops.overLimit;
    merged.bridgeDrops.duplicate += parsed.bridgeDrops.duplicate;
    for (const relation of [...parsed.relations, ...parsed.explicitNone]) answered.add(relation.pairKey);
  }
  merged.unansweredPairKeys = pairs
    .filter((pair) => !answered.has(pair.pairKey))
    .map((pair) => pair.pairKey);
  return merged;
}

export interface RelationJudgementPlan {
  /** Edges to write, including negative verdicts. */
  edges: GraphEdge[];  /**
   * Origin keys to retire before writing.
   *
   * Clearing these is what makes a re-judgement a *replacement*: if a pair was
   * `EXTENDS` and is now `COMPARES_WITH`, writing the new edge without dropping
   * the old would leave two contradictory conclusions between the same two
   * papers, and the graph would present both as current.
   */
  dropOriginKeys: string[];
}

/**
 * Plans the writes for one judgement batch.
 *
 * Every judged pair — including `NONE` — retires its previously recorded
 * paper-to-paper conclusions first, then writes the current verdict. Pairs the
 * model left unanswered are absent from the plan entirely, so a truncated
 * response cannot overwrite a good conclusion with silence.
 */
export function planRelationJudgementWrites(
  result: { relations: readonly ParsedRelation[]; explicitNone: readonly ParsedRelation[] },
  edges: readonly GraphEdge[],
): RelationJudgementPlan {
  const edgesByPair = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (edge.sourceKind !== 'paper' || edge.targetKind !== 'paper') continue;
    if (!isPaperPaperConclusion(edge.type)) continue;
    const key = relationPairKey(edge.source, edge.target);
    const bucket = edgesByPair.get(key);
    if (bucket) bucket.push(edge);
    else edgesByPair.set(key, [edge]);
  }

  const judged = [...result.relations, ...result.explicitNone];
  const dropOriginKeys: string[] = [];
  const edgesToWrite: GraphEdge[] = [];

  for (const relation of judged) {
    for (const previous of edgesByPair.get(relation.pairKey) ?? []) {
      // Do not drop the edge we are about to write: its id is reused so the
      // record's identity and creation time stay stable across re-judgements.
      if (relation.edge && previous.originKey === relation.edge.originKey) continue;
      dropOriginKeys.push(previous.originKey);
    }
    if (relation.edge) edgesToWrite.push(relation.edge);
  }

  return { edges: edgesToWrite, dropOriginKeys };
}

/** True for an edge that represents a judged paper-to-paper conclusion. */
export function isPaperPaperConclusion(type: string): boolean {
  return (PAPER_PAPER_EDGE_TYPES as readonly string[]).includes(type)
    || (NEGATIVE_EDGE_TYPES as readonly string[]).includes(type);
}

/**
 * One verdict as the review step presents it.
 *
 * Deliberately a flat, display-shaped record: the review is the user's only chance
 * to see what will be written, and a row that hides the evidence or the rationale
 * gives them nothing to judge with.
 */
export interface JudgementReviewRow {
  pairKey: string;
  leftPaperId: string;
  rightPaperId: string;
  verdict: RelationVerdict;
  confidence: number;
  evidenceQuote: string;
  rationale: string;
  /** Bridge concepts proposed for this pair, each already validated against the excerpts. */
  bridges: RelationBridgeSuggestion[];
}

/**
 * Builds the review rows in a deterministic order.
 *
 * Real relationships come first (they are what the user is looking for), ordered by
 * confidence; the negative verdicts follow. Nothing is hidden: a negative verdict
 * looks like "nothing happened" but is in fact the record that stops the same pair
 * being paid for again, so it needs to be visible in the same list.
 */
export function buildJudgementReviewRows(
  parsed: RelationParseResult,
): JudgementReviewRow[] {
  const toRow = (relation: ParsedRelation): JudgementReviewRow => ({
    pairKey: relation.pairKey,
    leftPaperId: relation.leftPaperId,
    rightPaperId: relation.rightPaperId,
    verdict: relation.verdict,
    confidence: relation.confidence,
    evidenceQuote: relation.evidenceQuote,
    rationale: relation.rationale,
    bridges: relation.bridges,
  });

  const relations = [...parsed.relations]
    .sort((left, right) => (
      right.confidence - left.confidence || left.pairKey.localeCompare(right.pairKey)
    ))
    .map(toRow);
  const negatives = [...parsed.explicitNone]
    .sort((left, right) => left.pairKey.localeCompare(right.pairKey))
    .map(toRow);

  return [...relations, ...negatives];
}

/**
 * Keeps only the pairs the user accepted.
 *
 * Pairs left out are **not** retired from the graph and **not** cached: their
 * previous conclusion (if any) stays exactly as it was, and a later run will ask
 * about them again. That is the honest consequence of declining a paid result —
 * the model is not asked to remember a verdict the user refused.
 *
 * `unansweredPairKeys` is passed through untouched: those pairs were never judged,
 * so there is nothing for the user to accept or reject.
 */
export function filterAcceptedJudgements(
  parsed: RelationParseResult,
  acceptedPairKeys: ReadonlySet<string>,
  acceptedBridgeKeys?: ReadonlySet<string>,
): { parsed: RelationParseResult; discardedPairKeys: string[] } {
  const keep = (relation: ParsedRelation): boolean => acceptedPairKeys.has(relation.pairKey);
  const relations = parsed.relations.filter(keep);
  const explicitNone = parsed.explicitNone.filter(keep);
  // A bridge survives only when its pair survived *and* the user ticked it: unticking a pair row means
  // "do not write this conclusion", and a bridge under a refused conclusion would contradict that.
  const bridges = parsed.bridges.filter((bridge) => (
    acceptedPairKeys.has(bridge.pairKey)
    && (acceptedBridgeKeys ? acceptedBridgeKeys.has(bridge.bridgeKey) : true)
  ));
  return {
    parsed: {
      relations,
      explicitNone,
      bridges,
      bridgeDrops: parsed.bridgeDrops,
      unansweredPairKeys: parsed.unansweredPairKeys,
      rejected: parsed.rejected,
    },
    discardedPairKeys: [...parsed.relations, ...parsed.explicitNone]
      .filter((relation) => !acceptedPairKeys.has(relation.pairKey))
      .map((relation) => relation.pairKey),
  };
}

/**
 * Builds the edge for any verdict, including `NO_RELATION`.
 *
 * One function for both directions keeps the idempotency key, provenance and
 * endpoint rules in a single place — a negative verdict that skipped the
 * provenance fields would be indistinguishable from stale data.
 */
export function buildVerdictEdge(
  pair: RelationCandidatePair,
  verdict: RelationVerdict,
  confidence: number,
  evidenceQuote: string,
  options: {
    now?: number;
    model?: string;
    promptVersion?: string;
    /** Which way the model said it points; `none` (or absent) leaves the arrow undecided. */
    direction?: RelationDirection;
  } = {},
): GraphEdge {
  const now = options.now ?? Date.now();
  const type: EdgeType = verdict === RELATION_NONE ? 'NO_RELATION' : verdict;
  const originKey = `${type}|${relationPairKey(pair.leftPaperId, pair.rightPaperId)}`;
  // The pair's ordering is a database artefact, so a directed verdict is only oriented when the model said which way it
  // points. Without that, the endpoints keep their arbitrary order and the edge carries no `direction` — the canvas then
  // draws a plain line instead of an arrow that is right half the time.
  const directed = DIRECTED_PAPER_VERDICTS.includes(type as PaperPaperEdgeType);
  const direction = directed && options.direction && options.direction !== 'none'
    ? options.direction
    : undefined;
  const fromRight = direction === 'rightToLeft';
  const sourceId = fromRight ? pair.rightPaperId : pair.leftPaperId;
  const targetId = fromRight ? pair.leftPaperId : pair.rightPaperId;
  // The quote is filed under the paper it was taken from — the one upstream of the relation (the citing/extending side),
  // which is the source endpoint when the direction is known.
  const evidence: GraphEvidence[] = evidenceQuote && verdict !== RELATION_NONE
    ? [{ paperId: sourceId, pageNumber: 1, quote: evidenceQuote }]
    : [];
  return {
    edgeId: createGraphId('edge'),
    source: sourceId,
    sourceKind: 'paper',
    target: targetId,
    targetKind: 'paper',
    type,
    // A negative verdict is certain about being negative, but drawing it as a
    // confident line would misrepresent it; confidence 0 keeps it out of any
    // confidence filter by default.
    confidence: verdict === RELATION_NONE ? 0 : Math.min(1, Math.max(0, confidence)),
    evidence,
    sourcePaperId: sourceId,
    ...(direction ? { direction } : {}),
    origin: 'ai',
    originKey,
    provenance: {
      ...(options.model ? { model: options.model } : {}),
      promptVersion: options.promptVersion ?? RELATION_PROMPT_VERSION,
      judgedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Builds a judged `Paper -> Paper` edge for a positive verdict.
 *
 * Kept as a thin alias so existing callers and tests keep a positive-verdict
 * entry point, while the negative case goes through the same builder.
 */
export function buildRelationEdge(
  pair: RelationCandidatePair,
  type: PaperPaperEdgeType,
  confidence: number,
  evidenceQuote: string,
  options: { now?: number; model?: string; promptVersion?: string } = {},
): GraphEdge {
  return buildVerdictEdge(pair, type, confidence, evidenceQuote, options);
}
