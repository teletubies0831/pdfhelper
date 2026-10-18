import {
  NEGATIVE_EDGE_TYPES,
  PAPER_PAPER_EDGE_TYPES,
  type EdgeType,
  type GraphEdge,
  type GraphEvidence,
  type PaperPaperEdgeType,
} from '../contracts.ts';
import { createGraphId } from '../domain/graph-identity.ts';
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

export const RELATION_PROMPT_VERSION = 'relation-judgement-1';

/** Evidence quotes kept per edge, and their maximum length. */
export const MAX_RELATION_EVIDENCE = 2;
export const MAX_RELATION_QUOTE_LENGTH = 200;

export function buildRelationJudgementPrompt(): string {
  return [
    '你判断两篇论文之间的关系，用于构建知识图谱。只输出 JSON，不要解释。',
    '',
    '关系类型（只能用这些英文枚举值，或 NONE）：',
    ...PAPER_PAPER_EDGE_TYPES.map((type) => `- ${type}`),
    '- NONE：两篇论文之间没有可判断的实质关系。',
    '',
    '要求：',
    '1. 对输入的每一对论文都给出一个结论，包括 NONE。',
    '2. 只依据给出的标题、摘要与共享实体判断，不要引入外部知识。',
    '3. evidence 必须是给定摘要中的逐字片段；没有依据就判 NONE。',
    '4. 不确定时判 NONE，不要猜测。',
    '',
    '输出格式：{"relations":[{"pairKey":"...","relation":"EXTENDS",'
      + '"confidence":0.8,"evidence":"逐字片段","rationale":"不超过30字"}]}',
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
  options: { now?: number; model?: string; promptVersion?: string } = {},
): RelationParseResult {
  const now = options.now ?? Date.now();
  const byPairKey = new Map(pairs.map((pair) => [pair.pairKey, pair]));
  const payload = extractJson(content);
  const rows = relationRows(payload);

  if (!rows) {
    return {
      relations: [],
      explicitNone: [],
      // Every pair is unanswered: a response we could not read tells us nothing,
      // so nothing may be cached.
      unansweredPairKeys: pairs.map((pair) => pair.pairKey),
      rejected: [{ reason: '模型没有返回可解析的关系判断 JSON。', raw: content.slice(0, 200) }],
    };
  }

  const relations: ParsedRelation[] = [];
  const explicitNone: ParsedRelation[] = [];
  const answered = new Set<string>();
  const rejected: RelationParseResult['rejected'] = [];

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
        promptVersion: options.promptVersion ?? RELATION_PROMPT_VERSION,
      }),
    };
    if (verdict === RELATION_NONE) explicitNone.push(parsed);
    else relations.push(parsed);
  }

  return {
    relations,
    explicitNone,
    unansweredPairKeys: pairs
      .filter((pair) => !answered.has(pair.pairKey))
      .map((pair) => pair.pairKey),
    rejected,
  };
}

export interface RelationJudgementPlan {
  /** Edges to write, including negative verdicts. */
  edges: GraphEdge[];
  /**
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
): { parsed: RelationParseResult; discardedPairKeys: string[] } {
  const keep = (relation: ParsedRelation): boolean => acceptedPairKeys.has(relation.pairKey);
  const relations = parsed.relations.filter(keep);
  const explicitNone = parsed.explicitNone.filter(keep);
  return {
    parsed: {
      relations,
      explicitNone,
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
  options: { now?: number; model?: string; promptVersion?: string } = {},
): GraphEdge {
  const now = options.now ?? Date.now();
  const type: EdgeType = verdict === RELATION_NONE ? 'NO_RELATION' : verdict;
  const originKey = `${type}|${relationPairKey(pair.leftPaperId, pair.rightPaperId)}`;
  const evidence: GraphEvidence[] = evidenceQuote && verdict !== RELATION_NONE
    ? [{ paperId: pair.leftPaperId, pageNumber: 1, quote: evidenceQuote }]
    : [];
  return {
    edgeId: createGraphId('edge'),
    source: pair.leftPaperId,
    sourceKind: 'paper',
    target: pair.rightPaperId,
    targetKind: 'paper',
    type,
    // A negative verdict is certain about being negative, but drawing it as a
    // confident line would misrepresent it; confidence 0 keeps it out of any
    // confidence filter by default.
    confidence: verdict === RELATION_NONE ? 0 : Math.min(1, Math.max(0, confidence)),
    evidence,
    sourcePaperId: pair.leftPaperId,
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
