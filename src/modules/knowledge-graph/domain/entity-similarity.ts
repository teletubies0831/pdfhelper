import {
  normalizeEntityName,
  tokenizeEntityName,
} from './entity-normalization.ts';

/**
 * Entity alignment scoring.
 *
 * The browser-side, zero-cost half of entity alignment: string normalization,
 * edit distance and token overlap. A small local embedding may be added later
 * through `options.embeddingCosine`, but alignment must work with the embedding
 * mode set to `off`, which is the default.
 *
 * Division of labour, measured rather than assumed:
 * - Descriptor variants ("Transformer" vs "Transformer Model" / "…Networks" /
 *   "…Architecture") are handled by the suffix rules in entity-normalization and
 *   come out as *exact* normalized matches. They never reach this scorer.
 * - This scorer therefore only fires on genuine phrasing differences — word
 *   order, hyphenation as separate words, near-identical strings.
 *
 * Everything here produces *suggestions*. The only operation allowed to merge
 * without asking the user is exact normalized equality, and that decision lives
 * in `areSameEntityName`, not in the score. The score is deliberately
 * conservative in the other direction too: "BERT" vs "BERT-base" and "BERT" vs
 * "BERTScore" are textually indistinguishable to these signals, so neither is
 * promoted; the suffix list is what decides "base" is a variant, and anything it
 * does not recognise waits for the user rather than guessing.
 */

/** Fuzzy scores at or above this are treated as "worth suggesting to the user". */
export const DEFAULT_ENTITY_MERGE_THRESHOLD = 0.86;

/**
 * Lower bound of the *review band*.
 *
 * Samples scoring between `ENTITY_SIMILARITY_REVIEW_FLOOR` and the merge
 * threshold are surfaced but never pre-selected. Measured behaviour of the
 * current scoring: real variants score 0.88–0.98 and genuinely distinct entities
 * top out around 0.79 ("ResNet" vs "ResNeXt"), so this floor keeps the confirm
 * list useful without letting the UI recommend a merge it cannot justify.
 */
export const ENTITY_SIMILARITY_REVIEW_FLOOR = 0.7;

export interface EntitySimilaritySignals {
  /** Equal after normalization — the only score that is a fact, not a guess. */
  exactNormalizedMatch: boolean;
  /** One normalized name fully contains the other ("bert" in "bert base"). */
  containment: boolean;
  /** Levenshtein similarity over normalized names, 0..1. */
  editSimilarity: number;
  /** Jaccard overlap of token sets, 0..1. */
  tokenJaccard: number;
  /** Character 3-gram Dice coefficient, 0..1. */
  charDice: number;
  /** Optional caller-supplied embedding cosine, 0..1. */
  embeddingCosine?: number;
}

export interface EntitySimilarityResult {
  score: number;
  signals: EntitySimilaritySignals;
  /** Short human-readable reasons, suitable for the merge confirmation UI. */
  reasons: string[];
}

/** Iterative Levenshtein with two rows; no recursion, no library. */
export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) previous[column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + substitutionCost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

/** 1 when identical, 0 when maximally different. */
export function editSimilarity(left: string, right: string): number {
  if (!left.length && !right.length) return 1;
  const longest = Math.max(left.length, right.length);
  if (!longest) return 1;
  return 1 - levenshteinDistance(left, right) / longest;
}

export function tokenJaccard(left: readonly string[], right: readonly string[]): number {
  if (!left.length && !right.length) return 1;
  const common = fuzzyTokenOverlap(left, right);
  const union = Math.max(left.length, right.length);
  return union === 0 ? 1 : common / union;
}

/** Two tokens count as the same token above this edit similarity. */
export const TOKEN_MATCH_SIMILARITY = 0.8;

/**
 * Counts tokens that match, allowing near-miss tokens to match too.
 *
 * Exact set overlap is the wrong measure for entity names: one typo
 * ("Self Supervised Learing") collapses an exact-overlap score from 1.0 to 0.5
 * and would push a near-identical name below any sane merge threshold. Pairing
 * the closest unmatched token and comparing them keeps a misspelling a
 * misspelling instead of turning it into a different entity.
 */
export function fuzzyTokenOverlap(
  left: readonly string[],
  right: readonly string[],
): number {
  const used = new Set<number>();
  let matched = 0;
  for (const leftToken of left) {
    let bestIndex = -1;
    let bestScore = TOKEN_MATCH_SIMILARITY;
    for (let index = 0; index < right.length; index += 1) {
      if (used.has(index)) continue;
      const score = editSimilarity(leftToken, right[index] ?? '');
      if (score >= bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += 1;
    }
  }
  return matched;
}

function charNGrams(value: string, size = 3): Set<string> {
  if (!value) return new Set();
  if (value.length <= size) return new Set([value]);
  const grams = new Set<string>();
  for (let index = 0; index + size <= value.length; index += 1) {
    grams.add(value.slice(index, index + size));
  }
  return grams;
}

/** Sørensen–Dice over character n-grams. Tolerates word order and inflections. */
export function characterDice(left: string, right: string, size = 3): number {
  if (left === right) return 1;
  const leftGrams = charNGrams(left, size);
  const rightGrams = charNGrams(right, size);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let intersection = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) intersection += 1;
  return (2 * intersection) / (leftGrams.size + rightGrams.size);
}

function clamp01(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

export interface SimilarityOptions {
  /** Embedding cosine similarity, when the caller has vectors available. */
  embeddingCosine?: number;
  /** Left-side aliases; a match against an alias counts as a match. */
  leftAliases?: readonly string[];
  rightAliases?: readonly string[];
}

interface NameVariant {
  original: string;
  normalized: string;
  tokens: string[];
}

function variantsOf(name: string, aliases: readonly string[] = []): NameVariant[] {
  return [name, ...aliases]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({
      original: value,
      normalized: normalizeEntityName(value),
      tokens: tokenizeEntityName(value),
    }))
    .filter((variant) => variant.normalized.length > 0);
}

/** Signals for a single pair of concrete strings. */
function signalsForPair(
  left: NameVariant,
  right: NameVariant,
  embeddingCosine: number | undefined,
): EntitySimilaritySignals {
  const exactNormalizedMatch = left.normalized === right.normalized;
  const containment = !exactNormalizedMatch && (
    left.normalized.includes(right.normalized)
    || right.normalized.includes(left.normalized)
  );
  return {
    exactNormalizedMatch,
    containment,
    editSimilarity: editSimilarity(left.normalized, right.normalized),
    tokenJaccard: tokenJaccard(left.tokens, right.tokens),
    charDice: characterDice(left.normalized, right.normalized),
    ...(embeddingCosine === undefined ? {} : { embeddingCosine }),
  };
}

/**
 * Weighting rationale.
 *
 * Character-level agreement (edit + n-gram Dice) carries most of the weight:
 * entities are short strings where a typo or an inflection is a
 * single-character event, and both of those signals stay high for such pairs.
 * Token overlap is only a tie-breaker because it is the least forgiving measure
 * on short strings — one misspelled token halves it.
 */
function scoreOf(signals: EntitySimilaritySignals): number {
  if (signals.exactNormalizedMatch) return 1;
  const base =
    0.42 * signals.editSimilarity
    + 0.13 * signals.tokenJaccard
    + 0.45 * signals.charDice;
  // Containment is meaningful only alongside strong textual agreement: it must
  // not promote "bert" against "bertscore" to a merge suggestion.
  const containmentBonus = signals.containment && base >= 0.62 ? 0.06 : 0;
  const withBonus = base + containmentBonus;
  return signals.embeddingCosine === undefined
    ? Math.min(1, withBonus)
    : Math.min(1, withBonus * 0.6 + signals.embeddingCosine * 0.4);
}

function reasonsFor(signals: EntitySimilaritySignals): string[] {
  const reasons: string[] = [];
  if (signals.exactNormalizedMatch) reasons.push('归一化后完全相同');
  if (signals.containment) reasons.push('一个名称包含另一个');
  if (signals.editSimilarity >= 0.85) reasons.push('拼写高度接近');
  if (signals.tokenJaccard >= 0.6) reasons.push('词元高度重叠');
  if (signals.charDice >= 0.8) reasons.push('字符组合高度重叠');
  if ((signals.embeddingCosine ?? 0) >= 0.88) reasons.push('向量语义接近');
  if (!reasons.length) reasons.push('文本相似度中等');
  return reasons;
}

/**
 * Best score across the primary names and any aliases.
 *
 * Aliases are scored as separate name variants rather than being concatenated:
 * merging "BERT" with "(BERT) Pre-training" through an alias is legitimate,
 * whereas concatenating would let a long alias list inflate the overlap of two
 * unrelated names.
 */
export function entitySimilarity(
  leftName: string,
  rightName: string,
  options: SimilarityOptions = {},
): EntitySimilarityResult {
  const embeddingCosine = clamp01(options.embeddingCosine);
  const leftVariants = variantsOf(leftName, options.leftAliases);
  const rightVariants = variantsOf(rightName, options.rightAliases);

  if (!leftVariants.length || !rightVariants.length) {
    const empty: EntitySimilaritySignals = {
      exactNormalizedMatch: false,
      containment: false,
      editSimilarity: 0,
      tokenJaccard: 0,
      charDice: 0,
      ...(embeddingCosine === undefined ? {} : { embeddingCosine }),
    };
    return { score: 0, signals: empty, reasons: ['名称为空，无法比较'] };
  }

  let best: EntitySimilaritySignals | null = null;
  let bestScore = -1;
  for (const left of leftVariants) {
    for (const right of rightVariants) {
      const signals = signalsForPair(left, right, embeddingCosine);
      const score = scoreOf(signals);
      if (score > bestScore) {
        bestScore = score;
        best = signals;
      }
    }
  }

  const signals = best ?? signalsForPair(leftVariants[0]!, rightVariants[0]!, embeddingCosine);
  return { score: bestScore, signals, reasons: reasonsFor(signals) };
}

export interface MergeSuggestion {
  /** Surviving entity id (the one with more evidence / earlier creation). */
  keepEntityId: string;
  /** Entity id that would be folded into `keepEntityId`. */
  mergeEntityId: string;
  score: number;
  reasons: string[];
  /**
   * True when the score clears the merge threshold, i.e. the UI may pre-select
   * this row. False means "possible duplicate, user judgement required" — the
   * band that catches longer typos, which score below the threshold because a
   * single-character error is a larger share of a longer string.
   */
  autoSelectable: boolean;
}

export interface MergeCandidateInput {
  entityId: string;
  name: string;
  aliases?: readonly string[];
  /** Used to pick which side survives when scores tie. */
  evidenceCount?: number;
  createdAt?: number;
}

/**
 * Suggests merges among a set of entities.
 *
 * O(n^2) string comparison, which is affordable precisely because it is *string*
 * comparison: no network call, no token spend. It is capped by `maxEntities` so a
 * pathological store cannot stall the UI thread, and pairs already sharing a
 * normalized name are excluded here because those are merged silently instead.
 */
export function suggestEntityMerges(
  entities: readonly MergeCandidateInput[],
  options: {
    threshold?: number;
    reviewFloor?: number;
    maxEntities?: number;
    embeddingCosineByPair?: (leftId: string, rightId: string) => number | undefined;
  } = {},
): MergeSuggestion[] {
  const threshold = options.threshold ?? DEFAULT_ENTITY_MERGE_THRESHOLD;
  const reviewFloor = options.reviewFloor ?? ENTITY_SIMILARITY_REVIEW_FLOOR;
  const maxEntities = options.maxEntities ?? 400;
  const candidates = entities.slice(0, maxEntities);
  const suggestions: MergeSuggestion[] = [];

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      if (normalizeEntityName(left.name) === normalizeEntityName(right.name)) continue;

      const result = entitySimilarity(left.name, right.name, {
        leftAliases: left.aliases,
        rightAliases: right.aliases,
        embeddingCosine: options.embeddingCosineByPair?.(left.entityId, right.entityId),
      });
      if (result.score < reviewFloor) continue;

      // The better-evidenced entity survives; ties break on the older record,
      // then on id, so the outcome is deterministic across reloads.
      const leftWeight = left.evidenceCount ?? 0;
      const rightWeight = right.evidenceCount ?? 0;
      let keep = left;
      let merge = right;
      if (rightWeight > leftWeight) {
        keep = right;
        merge = left;
      } else if (rightWeight === leftWeight) {
        const leftCreated = left.createdAt ?? Number.MAX_SAFE_INTEGER;
        const rightCreated = right.createdAt ?? Number.MAX_SAFE_INTEGER;
        if (rightCreated < leftCreated || (rightCreated === leftCreated && right.entityId < left.entityId)) {
          keep = right;
          merge = left;
        }
      }

      suggestions.push({
        keepEntityId: keep.entityId,
        mergeEntityId: merge.entityId,
        score: result.score,
        reasons: result.reasons,
        autoSelectable: result.score >= threshold,
      });
    }
  }

  return suggestions.sort((left, right) => right.score - left.score);
}
