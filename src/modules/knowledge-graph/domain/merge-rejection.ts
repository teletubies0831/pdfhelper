/**
 * Entity pairs the user has judged to be different things.
 *
 * The merge scorer compares strings, so `s-XOR` and `b-XOR` score 0.70 on shared letters — no
 * threshold separates that from a genuine misspelling without losing real ones. A dialog that keeps
 * re-offering a rejected pair after the tenth open is a dialog people stop opening, so the rejection
 * has to be remembered.
 *
 * Import-free so it can be tested directly, and so the settings normalizer can use it without
 * pulling in the domain.
 */

/** Cap on remembered rejections, so a corrupted record cannot grow without bound. */
export const MAX_MERGE_REJECTIONS = 500;

/**
 * Stable, order-independent key for a pair.
 *
 * `keep`/`merge` are directional, but "these two are different things" is not — using a directional
 * key would let the same pair come back with the sides swapped.
 */
export function mergePairKey(leftId: string, rightId: string): string {
  const left = leftId.trim();
  const right = rightId.trim();
  if (!left || !right || left === right) return '';
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

/** Validates a stored list: pair-shaped strings only, de-duplicated, capped. */
export function normalizeMergeRejections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const [left, right] = entry.split('|');
    const key = mergePairKey(left ?? '', right ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
    if (normalized.length >= MAX_MERGE_REJECTIONS) break;
  }
  return normalized;
}
