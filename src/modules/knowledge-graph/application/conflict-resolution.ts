import type {
  EdgeOrigin,
  GraphEdge,
  PaperPaperEdgeType,
} from '../contracts.ts';
import { relationPairKey } from './relation-recall.ts';

/**
 * Contradictory paper-to-paper conclusions.
 *
 * These arise from ordinary use, not from a bug: the same pair gets judged twice
 * with a different verdict, or a model judges `EXTENDS` in one run and `CITES` in
 * another because the prompt or the model changed. Today each verdict gets its own
 * `originKey`, so **both are stored and the graph presents both as current** —
 * which is worse than showing either, because the user cannot tell which to
 * believe.
 *
 * This module detects those cases and decides which conclusion survives, using a
 * rank that reflects how strong a claim each verdict makes. The ranking is the
 * whole design: `CITES` is a fact about the bibliography, `EXTENDS` is a claim
 * about lineage, `SIMILAR_TO` is the weakest useful statement, and `NO_RELATION`
 * asserts absence — so it contradicts every positive verdict.
 */

/**
 * Claim strength. Higher wins.
 *
 * `SIMILAR_TO` is deliberately lowest among the positives: it is the vaguest claim
 * the model can make, so any specific verdict supersedes it. `NO_RELATION` is
 * ranked above the positives because it is produced by an explicit negative
 * judgement, and the act of judging "nothing here" is itself evidence that the
 * positive verdict was wrong — but a *user* verdict still outranks it (see
 * `resolveRelationConflicts`).
 */
export const RELATION_RANK: Record<PaperPaperEdgeType | 'NO_RELATION', number> = {
  SIMILAR_TO: 1,
  COMPARES_WITH: 2,
  CITES: 3,
  IMPROVES: 4,
  EXTENDS: 5,
  NO_RELATION: 6,
};

export type ConflictResolution = 'keep' | 'drop' | 'user';

export interface RelationConflict {
  /** Unordered pair key, matching the edge idempotency convention. */
  pairKey: string;
  paperIds: [string, string];
  /** Every paper-to-paper conclusion currently stored for this pair. */
  edges: GraphEdge[];
  /** Distinct verdicts present. */
  verdicts: string[];
  /** Edge ids that should be retired, with the reason. */
  drop: Array<{ edgeId: string; originKey: string; reason: string }>;
  /** The edge that survives. Always resolvable — see the note on ranks below. */
  survivor: GraphEdge;
  /** Human-readable explanation, shown in the resolution UI. */
  explanation: string;
}

/**
 * Detects pairs holding more than one verdict.
 *
 * Only `Paper -> Paper` conclusions are considered, and only edges above the
 * caller's confidence floor: a 0.4-confidence guess contradicting a 0.9 verdict is
 * noise, and surfacing it as a conflict would train the user to dismiss the
 * conflict list without reading it.
 */
export function findRelationConflicts(
  edges: readonly GraphEdge[],
  options: { minConfidence?: number } = {},
): RelationConflict[] {
  const minConfidence = options.minConfidence ?? 0;
  const byPair = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    if (edge.sourceKind !== 'paper' || edge.targetKind !== 'paper') continue;
    if (!isRelationVerdict(edge.type)) continue;
    if (edge.confidence < minConfidence) continue;
    const key = relationPairKey(edge.source, edge.target);
    const bucket = byPair.get(key);
    if (bucket) bucket.push(edge);
    else byPair.set(key, [edge]);
  }

  const conflicts: RelationConflict[] = [];
  for (const [pairKey, pairEdges] of byPair) {
    if (pairEdges.length < 2) continue;
    const verdicts = [...new Set(pairEdges.map((edge) => edge.type))];
    if (verdicts.length < 2) continue;

    const resolution = resolveByRank(pairEdges);
    conflicts.push({
      pairKey,
      paperIds: [pairEdges[0]!.source, pairEdges[0]!.target],
      edges: [...pairEdges].sort((left, right) => (
        (RELATION_RANK[right.type as keyof typeof RELATION_RANK] ?? 0)
        - (RELATION_RANK[left.type as keyof typeof RELATION_RANK] ?? 0)
        || left.edgeId.localeCompare(right.edgeId)
      )),
      verdicts,
      drop: resolution.drop,
      survivor: resolution.survivor,
      explanation: resolution.explanation,
    });
  }

  // Deterministic order so the list does not reshuffle between openings.
  return conflicts.sort((left, right) => left.pairKey.localeCompare(right.pairKey));
}

/**
 * Picks the survivor.
 *
 * A user decision always wins outright: the user is the highest authority on
 * their own graph, and no automatic rank should override a deliberate decision.
 * Otherwise the highest-ranked verdict wins.
 *
 * **Every conflict is mechanically resolvable.** A tie would require two verdicts
 * of equal rank, but a conflict requires two *distinct* verdicts and every rank in
 * `RELATION_RANK` is unique — so the "hand it to the user" branch a reasonable
 * design would have here is unreachable, and was removed rather than kept as
 * decoration. Two edges of the *same* verdict are not a conflict at all: they are
 * duplicate conclusions, which the per-verdict `originKey` prevents from being
 * written in the first place.
 *
 * `resolveByRank` is still exported separately so the ranking can be tested on its
 * own, and so a future verdict added with a duplicate rank fails a test rather
 * than silently producing an undecidable conflict.
 */
export function resolveByRank(pairEdges: readonly GraphEdge[]): {
  survivor: GraphEdge;
  drop: Array<{ edgeId: string; originKey: string; reason: string }>;
  explanation: string;
} {
  const decided = pairEdges.filter(isUserDecided);
  if (decided.length) {
    const survivor = pickNewest(decided);
    // Two different reasons to privilege an edge, and the copy has to say which
    // one applies — "you annotated this" and "you already adjudicated this pair"
    // are different claims about who decided.
    const asserted = survivor.origin === 'user';
    return {
      survivor,
      drop: pairEdges
        .filter((edge) => edge.edgeId !== survivor.edgeId)
        .map((edge) => ({
          edgeId: edge.edgeId,
          originKey: edge.originKey,
          reason: asserted ? '用户手动标注优先' : '该结论已由你裁决',
        })),
      explanation: asserted
        ? '用户手动标注的结论优先于模型判断。'
        : '这一对你此前已经裁决过，新出现的结论不会覆盖它。',
    };
  }

  const ranked = pairEdges.map((edge) => ({
    edge: edge,
    rank: RELATION_RANK[edge.type as keyof typeof RELATION_RANK] ?? 0,
  }));
  const topRank = Math.max(...ranked.map((item) => item.rank));
  // Ties are impossible given distinct verdicts and distinct ranks; the newest
  // wins if a future change ever breaks that invariant, rather than crashing.
  const survivor = pickNewest(
    ranked.filter((item) => item.rank === topRank).map((item) => item.edge),
  );
  const losers = pairEdges.filter((edge) => edge.edgeId !== survivor.edgeId);
  return {
    survivor,
    drop: losers.map((edge) => ({
      edgeId: edge.edgeId,
      originKey: edge.originKey,
      reason: `${edge.type} 的结论强度低于 ${survivor.type}`,
    })),
    explanation:
      `${survivor.type} 的结论强度高于其余（${losers.map((edge) => edge.type).join('、')}），保留前者。`,
  };
}

function pickNewest(edges: readonly GraphEdge[]): GraphEdge {
  return [...edges].sort((left, right) => (
    right.updatedAt - left.updatedAt || left.edgeId.localeCompare(right.edgeId)
  ))[0]!;
}

/**
 * True when the user is the authority for this edge.
 *
 * Two distinct ways that happens: the user asserted the verdict themselves, or the
 * user already adjudicated this pair once and this edge is the survivor they chose.
 *
 * The second case is not decoration. Without it, a judgement that arrives *after* a
 * user resolution adds a third verdict to the pair, and the rank comparison would
 * quietly overturn a decision the user already made — the worst possible outcome,
 * because it looks like the graph reconsidering rather than the app forgetting.
 */
function isUserDecided(edge: GraphEdge): boolean {
  return edge.origin === 'user' || edge.provenance.resolvedBy === 'user';
}

function isRelationVerdict(type: string): boolean {
  return type in RELATION_RANK;
}

export interface ConflictResolutionPlan {
  /** Origin keys to retire. */
  dropOriginKeys: string[];
  /** Edges to write, carrying the resolution provenance. */
  edges: GraphEdge[];
}

/**
 * Plans the write for a resolved conflict.
 *
 * The survivor is re-written with `resolvedBy` provenance rather than left alone,
 * because "this conclusion won a conflict" is information the user should be able
 * to see later — otherwise the next run looks at the same two edges and reports
 * the same conflict again.
 */
export function planConflictResolution(
  conflict: RelationConflict,
  options: { selectedEdgeId?: string; now?: number } = {},
): ConflictResolutionPlan {
  const now = options.now ?? Date.now();
  // A selection only counts as the user's if it names an edge that is actually in
  // this conflict. A stale UI can send an id that no longer exists, and the write
  // then falls back to the ranked survivor — which is a *rule* decision, so
  // recording it as the user's would attribute a choice they never made.
  const selected = options.selectedEdgeId
    ? conflict.edges.find((edge) => edge.edgeId === options.selectedEdgeId)
    : undefined;
  const survivor = selected ?? conflict.survivor;

  const losers = conflict.edges.filter((edge) => edge.edgeId !== survivor.edgeId);
  // The audit trail accumulates rather than resets: a pair can be re-contested
  // later, and the fact that the user decided it once must survive a later
  // automatic re-resolution. The list is bounded by the verdict types, so it
  // cannot grow without limit.
  const previously = (survivor.provenance.resolvedAgainst ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    dropOriginKeys: losers.map((edge) => edge.originKey),
    edges: [{
      ...survivor,
      provenance: {
        ...survivor.provenance,
        resolvedAt: now,
        // A user resolution is sticky: once the user has ruled on this pair, no
        // later automatic pass may downgrade the record to "a rule decided this".
        resolvedBy: selected || survivor.provenance.resolvedBy === 'user' ? 'user' : 'rule',
        // The superseded verdicts are recorded so the decision is auditable
        // after the losing edges are gone.
        resolvedAgainst: [...new Set([...previously, ...losers.map((edge) => edge.type)])].join(','),
      },
      updatedAt: now,
    }],
  };
}

/**
 * Sums up conflicts for the status line.
 *
 * Every detected conflict is resolvable, so this reports one number rather than
 * splitting "automatic" from "needs the user" — a distinction that would describe
 * a branch this module does not have.
 */
export function describeConflicts(conflicts: readonly RelationConflict[]): string {
  if (!conflicts.length) return '没有发现互相矛盾的关系结论。';
  const userDecided = conflicts.filter(
    (conflict) => conflict.survivor.origin === 'user',
  ).length;
  const parts = [
    `发现 ${conflicts.length} 组矛盾结论`,
    userDecided ? `其中 ${userDecided} 组由你的标注胜出` : '',
    `${conflicts.length - userDecided} 组按结论强度自动保留`,
  ];
  return `${parts.filter(Boolean).join('，')}。`;
}

export type { EdgeOrigin };
