import {
  PAPER_PAPER_EDGE_TYPES,
  type GraphEdge,
  type GraphPaper,
  type PaperPaperEdgeType,
} from '../contracts.ts';
import { buildAdjacency } from '../domain/graph-query.ts';
import { isPaperPaperConclusion } from './relation-judgement.ts';

/**
 * Zero-cost candidate recall for paper-to-paper relationship judgement.
 *
 * This is the funnel that keeps the feature from being O(N²) in LLM calls. It
 * ranks every plausible pair using signals that cost nothing — shared confirmed
 * entities, filing, year proximity, and optionally cached embeddings — then
 * truncates hard before anything reaches a model.
 *
 * Three properties are load-bearing and were the reason for writing this as a
 * separate, pure function:
 *
 * 1. **Bounded.** `maxCandidates` truncates before ranking is returned, so the
 *    cost of the later LLM stage cannot depend on how many papers the user has.
 * 2. **Cache-aware.** A pair that already carries a judged `Paper -> Paper` edge
 *    is dropped, which is what makes re-clicking "analyse relations" free.
 * 3. **Deterministic.** Ties break on the pair key, so re-running produces the
 *    same order and the same Top-K — otherwise the cache would be consulted for
 *    a different set than the previous run judged.
 */

export interface RecallOptions {
  /** Hard cap on pairs returned. Defaults to the user's setting. */
  maxCandidates?: number;
  /** Minimum recall score for a pair to be considered at all. */
  minScore?: number;
  /** Cached embeddings by paper id; enables the vector signal when present. */
  vectors?: ReadonlyMap<string, readonly number[]>;
  /** Cosine threshold above which the vector signal contributes. */
  vectorThreshold?: number;
  /** Character budget for each paper's summary handed to the model. */
  summaryCharacters?: number;
  /**
   * Display names by entity id.
   *
   * Injected because the graph stores keyword nodes as synthesised entities whose
   * display label lives outside the edge list. Without it, recall reasons fall
   * back to ids, and an id in a user-facing reason explains nothing.
   */
  entityNames?: ReadonlyMap<string, string>;
  /**
   * Pairs the user explicitly asked to judge again.
   *
   * A stored conclusion is also the cache, so these pairs are otherwise skipped forever. Forcing
   * one bypasses both the cache and the score floor: the user pointed at this pair, so it is not a
   * recall question any more.
   */
  forcePairs?: ReadonlySet<string>;
}

export const DEFAULT_MAX_CANDIDATES = 40;
/**
 * Minimum recall score for a pair to reach the paid stage.
 *
 * Set at 1.5 so that **year proximity alone cannot buy a model call.** Equal
 * publication years are extremely common and carry almost no evidence of a
 * relationship; on a corpus of same-year papers it would drown the budget in
 * noise. Every other signal (shared entity, vector, same folder, same venue)
 * clears this on its own, and combinations of the weaker ones still clear it.
 */
export const DEFAULT_MIN_RECALL_SCORE = 1.5;
export const DEFAULT_VECTOR_THRESHOLD = 0.72;
export const DEFAULT_SUMMARY_CHARACTERS = 600;

/** Weights per signal. Shared entities dominate because they are the strongest. */
export const RECALL_WEIGHTS = {
  sharedEntity: 3,
  vector: 2.5,
  sameFolder: 1.5,
  sameVenue: 1,
  yearProximity: 1,
} as const;

export interface RelationCandidatePair {
  /** Deterministic key; the same convention the edge `originKey` uses. */
  pairKey: string;
  leftPaperId: string;
  rightPaperId: string;
  leftTitle: string;
  rightTitle: string;
  /** Truncated abstracts/summaries, ready to place in a prompt. */
  leftSummary: string;
  rightSummary: string;
  /** Names of confirmed entities both papers share. */
  sharedEntityNames: string[];
  /** Human-readable reasons this pair was recalled, shown to the user. */
  recallReasons: string[];
  recallScore: number;
  yearGap: number | null;
}

/** Deterministic pair key, mirroring the edge idempotency key convention. */
export function relationPairKey(leftPaperId: string, rightPaperId: string): string {
  const [first, second] = leftPaperId <= rightPaperId
    ? [leftPaperId, rightPaperId]
    : [rightPaperId, leftPaperId];
  return `${first}|${second}`;
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function truncate(value: string, limit: number): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

/**
 * Which pairs already have a recorded relationship conclusion.
 *
 * Includes `NO_RELATION`: a recorded negative is a conclusion too, and omitting
 * it would make the pair look unjudged forever, so the user would pay for the
 * same "nothing here" answer on every run.
 *
 * Everything else is excluded on purpose. A shared-entity link is not a judged
 * relationship — it is the very signal that motivates asking — and personal or
 * keyword edges belong to other layers entirely.
 *
 * One exception, and it is deliberate: a `CITES` / `EXTENDS` / `IMPROVES` conclusion recorded **without a direction**
 * predates `relation-judgement-3`. Its endpoints were the pair's database ordering, so its arrow was right about half the
 * time — asking again once is the only way to fix it, and the re-ask is bounded to those pairs (a re-judged pair drops
 * its old edge, so it cannot be asked twice).
 */
export function collectJudgedPairKeys(edges: readonly GraphEdge[]): Set<string> {
  const judged = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceKind !== 'paper' || edge.targetKind !== 'paper') continue;
    if (!isPaperPaperConclusion(edge.type)) continue;
    if (isDirectionalVerdict(edge.type) && !edge.direction) continue;
    judged.add(relationPairKey(edge.source, edge.target));
  }
  return judged;
}

/** Paper-paper conclusion types whose meaning depends on which way the arrow points. */
export function isDirectionalVerdict(type: string): boolean {
  return type === 'CITES' || type === 'EXTENDS' || type === 'IMPROVES';
}

/**
 * Entity ids shared by each paper pair, from the confirmed entity graph.
 *
 * Walks paper -> entity -> paper directly rather than going through
 * `findIndirectlyConnectedPapers`: that helper answers the same question but
 * returns only ids and discards the per-pair grouping this needs, so reusing it
 * would mean walking the graph twice for the same answer.
 */
function sharedEntityIdsByPair(
  papers: readonly GraphPaper[],
  edges: readonly GraphEdge[],
): Map<string, string[]> {
  const papersByIdentity = new Set(papers.map((paper) => paper.paperId));
  const adjacency = buildAdjacency([...edges]);
  // Papers indexed by the entity they are linked to.
  const papersByEntity = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.sourceKind === 'paper' && edge.targetKind === 'entity') {
      const bucket = papersByEntity.get(edge.target);
      if (bucket) bucket.add(edge.source);
      else papersByEntity.set(edge.target, new Set([edge.source]));
    } else if (edge.targetKind === 'paper' && edge.sourceKind === 'entity') {
      const bucket = papersByEntity.get(edge.source);
      if (bucket) bucket.add(edge.target);
      else papersByEntity.set(edge.source, new Set([edge.target]));
    }
  }

  const sharedByPair = new Map<string, Set<string>>();
  for (const paper of papers) {
    for (const edge of adjacency.get(`paper:${paper.paperId}`) ?? []) {
      const entityId = edge.sourceKind === 'entity' ? edge.source : edge.target;
      if (edge.sourceKind !== 'entity' && edge.targetKind !== 'entity') continue;
      for (const otherPaperId of papersByEntity.get(entityId) ?? []) {
        if (otherPaperId === paper.paperId || !papersByIdentity.has(otherPaperId)) continue;
        const key = relationPairKey(paper.paperId, otherPaperId);
        const bucket = sharedByPair.get(key);
        if (bucket) bucket.add(entityId);
        else sharedByPair.set(key, new Set([entityId]));
      }
    }
  }

  return new Map(
    [...sharedByPair.entries()].map(([key, ids]) => [key, [...ids].sort()]),
  );
}

export function recallCandidatePairs(
  papers: readonly GraphPaper[],
  edges: readonly GraphEdge[],
  options: RecallOptions = {},
): RelationCandidatePair[] {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minScore = options.minScore ?? DEFAULT_MIN_RECALL_SCORE;
  const vectorThreshold = options.vectorThreshold ?? DEFAULT_VECTOR_THRESHOLD;
  const summaryCharacters = options.summaryCharacters ?? DEFAULT_SUMMARY_CHARACTERS;

  const judged = collectJudgedPairKeys(edges);
  const forcePairs = options.forcePairs ?? new Set<string>();
  // The shared-entity signal comes from the confirmed entity graph, so it is
  // computed from edges rather than re-deriving entity membership.
  const sharedByPair = sharedEntityIdsByPair(papers, edges);
  const entityNameById = options.entityNames ?? new Map<string, string>();
  const nameOf = (entityId: string): string => entityNameById.get(entityId) ?? entityId;

  const scored: RelationCandidatePair[] = [];

  for (let leftIndex = 0; leftIndex < papers.length; leftIndex += 1) {
    const left = papers[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < papers.length; rightIndex += 1) {
      const right = papers[rightIndex]!;
      const pairKey = relationPairKey(left.paperId, right.paperId);
      // The token saving: a pair whose relationship is already known is never
      // re-sent to a model — unless the user asked for exactly this pair to be judged again.
      const forced = forcePairs.has(pairKey);
      if (judged.has(pairKey) && !forced) continue;

      let score = 0;
      const reasons: string[] = [];

      const sharedIds = sharedByPair.get(pairKey) ?? [];
      const sharedNames = sharedIds.map(nameOf);
      if (sharedIds.length) {
        score += RECALL_WEIGHTS.sharedEntity * sharedIds.length;
        reasons.push(`共享 ${sharedIds.length} 个已确认实体`);
      }

      const vectors = options.vectors;
      if (vectors) {
        const leftVector = vectors.get(left.paperId);
        const rightVector = vectors.get(right.paperId);
        if (leftVector && rightVector) {
          const similarity = cosineSimilarity(leftVector, rightVector);
          if (similarity >= vectorThreshold) {
            score += RECALL_WEIGHTS.vector * similarity;
            reasons.push(`向量相似 ${similarity.toFixed(2)}`);
          }
        }
      }

      if (left.folderId && left.folderId === right.folderId) {
        score += RECALL_WEIGHTS.sameFolder;
        reasons.push('同一文件夹');
      }

      if (left.venue && left.venue === right.venue) {
        score += RECALL_WEIGHTS.sameVenue;
        reasons.push('同一来源');
      }

      const yearGap = left.year !== null && right.year !== null
        ? Math.abs(left.year - right.year)
        : null;
      if (yearGap !== null && yearGap <= 2) {
        score += RECALL_WEIGHTS.yearProximity;
        reasons.push(`年份接近（相差 ${yearGap} 年）`);
      }

      // A pair with no signal at all is not worth a model call, and including it
      // would just crowd the budget with noise. A pair the user explicitly asked
      // to re-judge is exempt: the floor saves tokens on pairs nobody asked
      // about, it must not override a direct request.
      if (forced) {
        reasons.push('你要求重新判断');
      } else if (score < minScore) {
        continue;
      }

      scored.push({
        pairKey,
        leftPaperId: left.paperId,
        rightPaperId: right.paperId,
        leftTitle: left.title,
        rightTitle: right.title,
        leftSummary: truncate(left.abstract, summaryCharacters),
        rightSummary: truncate(right.abstract, summaryCharacters),
        sharedEntityNames: sharedNames,
        recallReasons: reasons,
        recallScore: score,
        yearGap,
      });
    }
  }

  // Ties break on the pair key so the same input yields the same Top-K across
  // runs; without that, a later run could judge a different set than the cache
  // holds and the "already analysed" claim would be false. Forced pairs sort
  // ahead of everything so the candidate cap can never drop a direct request.
  const isForced = (pairKey: string): number => (forcePairs.has(pairKey) ? 1 : 0);
  return scored
    .sort((left, right) => (
      isForced(right.pairKey) - isForced(left.pairKey)
      || right.recallScore - left.recallScore
      || left.pairKey.localeCompare(right.pairKey)
    ))
    .slice(0, maxCandidates);
}

/**
 * How many papers the user may put in one explicit analysis.
 *
 * The reason is arithmetic, not taste: pairs grow as n(n-1)/2, so 6 papers is 15 judgements — three
 * provider calls at five pairs each, a few thousand tokens after the excerpts. Seven papers would be
 * 21 pairs, and the number the user agreed to pay for would stop matching what they ticked.
 */
export const MAX_SELECTED_PAPERS = 6;

/**
 * Candidate pairs for papers the user picked by hand.
 *
 * The recall funnel exists for "the user asked for an analysis, not for specific papers": its score
 * floor and Top-K decide *what* to judge. An explicit selection already answers that, so the floor is
 * skipped — a pair the user ticked with no other signal at all is exactly the pair they want judged
 * (they believe the papers are related; that belief is the input).
 *
 * The context signals are still computed, because the model is given them: "same folder", "shares one
 * confirmed entity" are reasons it can use, not filters that decide membership.
 */
export function buildSelectedCandidatePairs(
  papers: readonly GraphPaper[],
  edges: readonly GraphEdge[],
  paperIds: readonly string[],
  options: {
    entityNames?: ReadonlyMap<string, string>;
    summaryCharacters?: number;
    /** Default true: a pair with a recorded conclusion is not paid for twice. */
    skipJudged?: boolean;
  } = {},
): RelationCandidatePair[] {
  const wanted = [...new Set(paperIds)].slice(0, MAX_SELECTED_PAPERS);
  const selected = wanted
    .map((paperId) => papers.find((paper) => paper.paperId === paperId))
    .filter((paper): paper is GraphPaper => Boolean(paper));
  if (selected.length < 2) return [];

  const summaryCharacters = options.summaryCharacters ?? DEFAULT_SUMMARY_CHARACTERS;
  const sharedByPair = sharedEntityIdsByPair(selected, edges);
  const entityNameById = options.entityNames ?? new Map<string, string>();
  const nameOf = (entityId: string): string => entityNameById.get(entityId) ?? entityId;
  const judged = options.skipJudged === false ? new Set<string>() : collectJudgedPairKeys(edges);

  const pairs: RelationCandidatePair[] = [];
  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    const left = selected[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const right = selected[rightIndex]!;
      const pairKey = relationPairKey(left.paperId, right.paperId);
      if (judged.has(pairKey)) continue;

      let score = 0;
      const reasons: string[] = ['你在清单里选中了这两篇'];
      const sharedIds = sharedByPair.get(pairKey) ?? [];
      if (sharedIds.length) {
        score += RECALL_WEIGHTS.sharedEntity * sharedIds.length;
        reasons.push(`共享 ${sharedIds.length} 个已确认实体`);
      }
      if (left.folderId && left.folderId === right.folderId) {
        score += RECALL_WEIGHTS.sameFolder;
        reasons.push('同一文件夹');
      }
      if (left.venue && left.venue === right.venue) {
        score += RECALL_WEIGHTS.sameVenue;
        reasons.push('同一来源');
      }
      const yearGap = left.year !== null && right.year !== null
        ? Math.abs(left.year - right.year)
        : null;
      if (yearGap !== null && yearGap <= 2) {
        score += RECALL_WEIGHTS.yearProximity;
        reasons.push(`年份接近（相差 ${yearGap} 年）`);
      }

      pairs.push({
        pairKey,
        leftPaperId: left.paperId,
        rightPaperId: right.paperId,
        leftTitle: left.title,
        rightTitle: right.title,
        leftSummary: truncate(left.abstract, summaryCharacters),
        rightSummary: truncate(right.abstract, summaryCharacters),
        sharedEntityNames: sharedIds.map(nameOf),
        recallReasons: reasons,
        recallScore: score,
        yearGap,
      });
    }
  }
  return pairs;
}

/**
 * Splits recalled pairs into the set worth asking a model about and the rest.
 *
 * `topK` is the user's explicit cost ceiling, so it is applied last and
 * separately from `maxCandidates`: recall can be generous (it is free) while the
 * paid stage stays small.
 */
export function selectTopKForJudgement(
  candidates: readonly RelationCandidatePair[],
  topK: number,
): RelationCandidatePair[] {
  return [...candidates]
    .sort((left, right) => (
      right.recallScore - left.recallScore || left.pairKey.localeCompare(right.pairKey)
    ))
    .slice(0, Math.max(0, Math.floor(topK)));
}

/** Rough token estimate, shown to the user before they spend anything. */
export function estimateJudgementTokens(
  pairs: readonly RelationCandidatePair[],
  promptOverheadTokens = 220,
): { promptTokens: number; completionTokens: number; total: number; pairCount: number } {
  // ~2 characters per token for mixed Chinese/English is the conservative side.
  const bodyCharacters = pairs.reduce(
    (sum, pair) => sum + pair.leftTitle.length + pair.rightTitle.length
      + pair.leftSummary.length + pair.rightSummary.length
      + pair.sharedEntityNames.join(',').length
      + pair.recallReasons.join(',').length,
    0,
  );
  const promptTokens = Math.round(bodyCharacters / 2) + promptOverheadTokens + pairs.length * 24;
  // Each judgement is one short JSON object.
  const completionTokens = pairs.length * 90;
  return {
    promptTokens,
    completionTokens,
    total: promptTokens + completionTokens,
    pairCount: pairs.length,
  };
}

/** Allowed edge types for a judgement, as a prompt fragment. */
export const PAPER_RELATION_EDGE_TYPES: readonly PaperPaperEdgeType[] = PAPER_PAPER_EDGE_TYPES;
