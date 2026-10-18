import type { GraphEntity } from '../contracts.ts';
import {
  DEFAULT_ENTITY_MERGE_THRESHOLD,
  ENTITY_SIMILARITY_REVIEW_FLOOR,
  entitySimilarity,
  suggestEntityMerges,
  type MergeSuggestion,
} from '../domain/entity-similarity.ts';
import { suggestAbbreviationMerges } from '../domain/entity-abbreviations.ts';
import { mergePairKey } from '../domain/merge-rejection.ts';

/**
 * Entity-alignment review.
 *
 * Splits the alignment work in two, matching the design principle that the model
 * does the coarse work and the user does the fine work:
 *
 * - **Silent merges** are the ones normalization already decided (equal
 *   normalized name). Those are applied for the user, because asking them to
 *   confirm "Transformer" = "Transformer模型" is asking them to confirm a fact.
 * - **Suggested merges** are every other candidate, ranked, and always confirmed
 *   by the user. Within those, `autoSelectable` separates "pre-tick this" from
 *   "here is a possibility" — the second band exists because a one-character typo
 *   in a long name scores below the merge threshold, and hiding it entirely would
 *   be worse than showing it unticked.
 */

export interface MergeSuggestionRow extends MergeSuggestion {
  keepName: string;
  mergeName: string;
  keepAliases: string[];
  mergeAliases: string[];
  /** Evidence count on each side, shown so the user can judge which is canonical. */
  keepEvidenceCount: number;
  mergeEvidenceCount: number;
}

export interface MergeReviewSummary {
  rows: MergeSuggestionRow[];
  /** Rows at or above the merge threshold; these may start ticked. */
  autoSelectableCount: number;
  /** Entities that can never be merged (tombstones) and were excluded. */
  excludedCount: number;
}

/**
 * Elements eligible to be merged.
 *
 * `merged` tombstones are excluded outright: folding into one would orphan the
 * whole alias chain, and `planEntityMerge` refuses it anyway. Filtering here as
 * well means the dialog never offers an action that would silently do nothing.
 */
export function selectMergeCandidates(entities: readonly GraphEntity[]): GraphEntity[] {
  return entities.filter((entity) => entity.status !== 'merged');
}

export function buildMergeReview(
  entities: readonly GraphEntity[],
  options: {
    threshold?: number;
    reviewFloor?: number;
    maxEntities?: number;
    embeddingCosineByPair?: (leftId: string, rightId: string) => number | undefined;
    /** Pair keys the user already judged to be different things; never suggested again. */
    rejectedPairs?: Iterable<string>;
  } = {},
): MergeReviewSummary {
  const threshold = options.threshold ?? DEFAULT_ENTITY_MERGE_THRESHOLD;
  const candidates = selectMergeCandidates(entities);
  const excludedCount = entities.length - candidates.length;
  const rejected = new Set(options.rejectedPairs ?? []);

  const suggestions = withAbbreviationSuggestions(
    suggestEntityMerges(
      candidates.map((entity) => ({
        entityId: entity.entityId,
        name: entity.name,
        aliases: entity.aliases,
        evidenceCount: entity.evidence.length,
        createdAt: entity.createdAt,
      })),
      {
        threshold,
        reviewFloor: options.reviewFloor ?? ENTITY_SIMILARITY_REVIEW_FLOOR,
        maxEntities: options.maxEntities,
        embeddingCosineByPair: options.embeddingCosineByPair,
      },
    ),
    candidates,
    { threshold, reviewFloor: options.reviewFloor ?? ENTITY_SIMILARITY_REVIEW_FLOOR },
  );

  const byId = new Map(candidates.map((entity) => [entity.entityId, entity]));
  const namesById = new Map(candidates.map((entity) => [entity.entityId, entity.name]));
  const rows: MergeSuggestionRow[] = [];
  for (const suggestion of suggestions) {
    const keep = byId.get(suggestion.keepEntityId);
    const merge = byId.get(suggestion.mergeEntityId);
    // Both sides must still be present: a suggestion naming a filtered record
    // would render a merge button that cannot work.
    if (!keep || !merge) continue;
    rows.push({
      ...suggestion,
      keepName: keep.name,
      mergeName: merge.name,
      keepAliases: keep.aliases,
      mergeAliases: merge.aliases,
      keepEvidenceCount: keep.evidence.length,
      mergeEvidenceCount: merge.evidence.length,
    });
  }

  // Collapse the pairwise graph before returning: leaving it as raw pairs would
  // let a batch action tombstone one misspelling and then refuse the sibling
  // merge, so one obvious piece of work would need two passes.
  const collapsed = collapseMergeComponents(rows, namesById);
  // Rejections are applied after collapsing: a cluster is presented against its canonical member,
  // so the pair the user rejected is the *collapsed* pair, not whichever raw edge it came from.
  const kept = rejected.size
    ? collapsed.filter((row) => !rejected.has(mergePairKey(row.keepEntityId, row.mergeEntityId)))
    : collapsed;
  return {
    rows: kept,
    autoSelectableCount: kept.filter((row) => row.autoSelectable).length,
    excludedCount,
  };
}

/**
 * Adds abbreviation suggestions to the textual ones.
 *
 * The two scorers answer different questions and disagree on purpose: the string scorer cannot see
 * that `BP heuristic` abbreviates `Boyar-Peralta heuristic` (measured 0.49, below any safe
 * threshold), and the abbreviation scorer says nothing about typos. Each pair appears once, keeping
 * the stronger claim — and when the abbreviation claim wins, so does its orientation, because the
 * expansion should be the name that survives.
 *
 * Order of `reasons` is preserved so the dialog can show why a row is being suggested at all.
 */
function withAbbreviationSuggestions(
  suggestions: readonly MergeSuggestion[],
  candidates: readonly GraphEntity[],
  options: { threshold: number; reviewFloor: number },
): MergeSuggestion[] {
  const byPair = new Map<string, MergeSuggestion>();
  const pairKey = (leftId: string, rightId: string): string => (
    leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`
  );

  for (const suggestion of suggestions) {
    byPair.set(pairKey(suggestion.keepEntityId, suggestion.mergeEntityId), suggestion);
  }

  const abbreviations = suggestAbbreviationMerges(
    candidates.map((entity) => ({
      entityId: entity.entityId,
      name: entity.name,
      aliases: entity.aliases,
      quotes: entity.evidence.map((item) => item.quote).filter(Boolean),
    })),
  );
  for (const suggestion of abbreviations) {
    if (suggestion.score < options.reviewFloor) continue;
    const key = pairKey(suggestion.keepEntityId, suggestion.mergeEntityId);
    const existing = byPair.get(key);
    if (existing && existing.score >= suggestion.score) {
      // Keep the stronger row but never lose the abbreviation explanation.
      byPair.set(key, {
        ...existing,
        reasons: [...existing.reasons, ...suggestion.reasons.filter(
          (reason) => !existing.reasons.includes(reason),
        )],
        autoSelectable: existing.autoSelectable
          || (suggestion.autoSelectable && suggestion.score >= options.threshold),
      });
      continue;
    }
    byPair.set(key, {
      keepEntityId: suggestion.keepEntityId,
      mergeEntityId: suggestion.mergeEntityId,
      score: suggestion.score,
      reasons: suggestion.reasons,
      autoSelectable: suggestion.autoSelectable && suggestion.score >= options.threshold,
    });
  }

  return [...byPair.values()].sort((left, right) => (
    right.score - left.score
    || left.keepEntityId.localeCompare(right.keepEntityId)
    || left.mergeEntityId.localeCompare(right.mergeEntityId)
  ));
}
/**
 * Recomputes a pair's similarity when it has no stored suggestion.
 *
 * Only reached for pairs linked through a third entity, so the cost is bounded by component size
 * rather than by the full entity count.
 */
function measurePair(
  leftId: string,
  rightId: string,
  namesById: ReadonlyMap<string, string>,
): { score: number; reasons: string[] } {
  const leftName = namesById.get(leftId);
  const rightName = namesById.get(rightId);
  if (!leftName || !rightName) return { score: 0, reasons: [] };
  const result = entitySimilarity(leftName, rightName);
  return { score: result.score, reasons: result.reasons };
}

export interface MergeReviewSummarySource {
  listEntities(): Promise<GraphEntity[]>;
  /** Optional: when present, pairs the user rejected are filtered out of the review. */
  readSettings?(): Promise<{ mergeRejections?: string[] }>;
}

export async function loadMergeReview(
  repository: MergeReviewSummarySource,
  options: {
    threshold?: number;
    reviewFloor?: number;
    maxEntities?: number;
  } = {},
): Promise<MergeReviewSummary> {
  const [entities, settings] = await Promise.all([
    repository.listEntities(),
    repository.readSettings
      ? repository.readSettings()
      : Promise.resolve<{ mergeRejections?: string[] }>({}),
  ]);
  return buildMergeReview(entities, {
    ...options,
    rejectedPairs: settings.mergeRejections ?? [],
  });
}

/**
 * Collapses the pairwise suggestion graph into one canonical target per cluster.
 *
 * `suggestEntityMerges` is pairwise, so a cluster of misspellings produces a
 * clique: with "Graph Convolutional Network", "…Networks" and "Graph
 * Convolutional Networks", the two misspellings also score above threshold
 * against *each other*. Taking that graph literally is actively harmful for a
 * batch action — merging the highest-scoring pair tombstones one of the
 * misspellings, and the other merge is then refused, so the user has to run the
 * dialog a second time to finish one obvious piece of work.
 *
 * So: find connected components over the suggestions, pick the best canonical
 * member of each, and point every other member at it. The score reported for a
 * derived row is the pair's real score against the chosen target (or the best
 * score seen in the component when no direct edge exists), so the number shown
 * stays truthful.
 */
export function collapseMergeComponents(
  rows: readonly MergeSuggestionRow[],
  namesById: ReadonlyMap<string, string> = new Map(),
): MergeSuggestionRow[] {
  if (rows.length <= 1) return [...rows];

  const adjacency = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const [from, to] of [
      [row.keepEntityId, row.mergeEntityId],
      [row.mergeEntityId, row.keepEntityId],
    ] as const) {
      const bucket = adjacency.get(from);
      if (bucket) bucket.add(to);
      else adjacency.set(from, new Set([to]));
    }
  }

  // Deterministic traversal: seed from sorted ids so component membership and
  // the resulting output order do not depend on the suggestion array order.
  const visited = new Set<string>();
  const canonicalByEntityId = new Map<string, string>();
  const memberOf = new Map<string, string[]>();

  for (const seed of [...adjacency.keys()].sort()) {
    if (visited.has(seed)) continue;
    const component: string[] = [];
    const queue = [seed];
    visited.add(seed);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbour of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
    const nameOf = new Map<string, string>();
    for (const row of rows) {
      nameOf.set(row.keepEntityId, row.keepName);
      nameOf.set(row.mergeEntityId, row.mergeName);
    }

    // Canonical = the row's own "keep" side whenever any row names it, else the
    // best-supported member. This preserves `suggestEntityMerges`' survivor rule,
    // which already weighs evidence count, creation time and id.
    const namedAsKeep = new Map<string, number>();
    for (const row of rows) {
      if (!component.includes(row.keepEntityId)) continue;
      namedAsKeep.set(row.keepEntityId, (namedAsKeep.get(row.keepEntityId) ?? 0) + 1);
    }
    const canonical = [...component].sort((left, right) => (
      (namedAsKeep.get(right) ?? 0) - (namedAsKeep.get(left) ?? 0)
      || left.localeCompare(right)
    ))[0]!;

    memberOf.set(canonical, component);
    for (const member of component) canonicalByEntityId.set(member, canonical);
  }

  const scoreBetween = new Map<string, { score: number; reasons: string[]; autoSelectable: boolean }>();
  for (const row of rows) {
    const key = `${row.keepEntityId}|${row.mergeEntityId}`;
    const existing = scoreBetween.get(key);
    if (!existing || row.score > existing.score) {
      scoreBetween.set(key, {
        score: row.score,
        reasons: row.reasons,
        autoSelectable: row.autoSelectable,
      });
    }
  }

  const collapsed: MergeSuggestionRow[] = [];
  for (const [canonical, members] of memberOf) {
    for (const member of members) {
      if (member === canonical) continue;
      const direct = scoreBetween.get(`${canonical}|${member}`)
        ?? scoreBetween.get(`${member}|${canonical}`);
      // No stored pair means the two are related only *through* a third entity,
      // so the score is recomputed rather than defaulted. Reporting 0 would be a
      // lie in the UI: "Graph Convolutional Network" vs "Graph Convolutional
      // Networks" scores 1.0 but is absent from the pair list because an equal
      // normalized name is a silent merge, not a suggestion.
      const measured = direct ?? measurePair(canonical, member, namesById);
      collapsed.push({
        keepEntityId: canonical,
        mergeEntityId: member,
        score: measured.score,
        reasons: measured.reasons,
        // Pre-tick only on a stored, directly-scored pair above threshold. A
        // derived row is the user's call even when the number looks high.
        autoSelectable: Boolean(direct) && direct!.autoSelectable,
        keepName: namesById.get(canonical) ?? canonical,
        mergeName: namesById.get(member) ?? member,
        keepAliases: [],
        mergeAliases: [],
        keepEvidenceCount: 0,
        mergeEvidenceCount: 0,
      });
    }
  }

  return collapsed.sort((left, right) => (
    right.score - left.score
    || left.keepEntityId.localeCompare(right.keepEntityId)
    || left.mergeEntityId.localeCompare(right.mergeEntityId)
  ));
}

/**
 * Groups rows by the entity they would merge into.
 *
 * A single canonical entity often has several misspellings pointing at it, and
 * presenting them as one decision is less work and less error-prone than several
 * separate confirmations.
 */
export function groupMergeRowsByKeep(
  rows: readonly MergeSuggestionRow[],
): Array<{ keepEntityId: string; keepName: string; rows: MergeSuggestionRow[] }> {
  const byKeep = new Map<string, MergeSuggestionRow[]>();
  for (const row of rows) {
    const bucket = byKeep.get(row.keepEntityId);
    if (bucket) bucket.push(row);
    else byKeep.set(row.keepEntityId, [row]);
  }
  return [...byKeep.entries()].map(([keepEntityId, grouped]) => ({
    keepEntityId,
    keepName: grouped[0]?.keepName ?? keepEntityId,
    rows: grouped,
  }));
}

/**
 * Ordered merge pairs for a batch action.
 *
 * Merges are applied one at a time and each one tombstones its absorbed entity,
 * so a chain (`A -> B`, then `B -> C`) must be ordered so that the survivor of an
 * earlier merge is never the absorbed side of a later one. Sorting by descending
 * score and skipping any pair whose absorbed entity has already been absorbed
 * keeps the batch safe — which is why this returns pairs, not a plan.
 */
export function orderMergePairsForBatch(
  rows: readonly MergeSuggestionRow[],
): Array<{ keepEntityId: string; mergeEntityId: string }> {
  const ordered = [...rows].sort((left, right) => (
    right.score - left.score
    || left.mergeEntityId.localeCompare(right.mergeEntityId)
  ));
  const absorbed = new Set<string>();
  const pairs: Array<{ keepEntityId: string; mergeEntityId: string }> = [];
  for (const row of ordered) {
    if (absorbed.has(row.keepEntityId) || absorbed.has(row.mergeEntityId)) continue;
    absorbed.add(row.mergeEntityId);
    pairs.push({ keepEntityId: row.keepEntityId, mergeEntityId: row.mergeEntityId });
  }
  return pairs;
}
