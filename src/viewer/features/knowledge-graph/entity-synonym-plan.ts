/**
 * Synonym detection among one paper's extracted candidates — the parts that need no browser.
 *
 * The third and most informed signal, after normalization (`entity-normalization.ts`) and the
 * abbreviation rules (`entity-abbreviations.ts`):
 *
 * - Normalization catches `Transformer` / `Transformer模型`.
 * - Initials and the paper's own `(ABBR)` declarations catch `Boyar-Peralta heuristic` / `BP`.
 * - This asks the model, which has read the whole paper, which of *these* names mean the same thing
 *   — the case neither rule can reach, such as `two-step process for combinational logic
 *   optimization` / `synthesis flow`.
 *
 * Two constraints shape it, both copied from the gloss feature next door:
 *
 * - **One request, on demand.** It costs tokens, so the user ticks a box; when they do, every name
 *   on screen goes into a single request.
 * - **A suggestion, never a merge.** The answer renames nothing by itself: the dialog offers
 *   「合并为它」 per row, and the rename is what makes the two candidates land on one entity. The
 *   only silent merges in this feature are exact normalization matches.
 *
 * Import-free on purpose: the request lives in `entity-synonym.ts`, which pulls in the AI layer.
 */

/** Names per request. A review screen rarely shows more, and one call keeps the cost predictable. */
export const MAX_TERMS_PER_SYNONYM_REQUEST = 60;

/** Distinct name-sets remembered, so re-ticking the box does not re-ask the same question. */
export const SYNONYM_CACHE_LIMIT = 12;

export function buildEntitySynonymPrompt(terms: readonly string[]): string {
  return [
    '下面是一篇论文里抽取出的术语列表。请找出其中指向**同一个概念**的不同写法。',
    '要求：',
    '1. 只合并你确定是同一概念的项；不确定就不要合并。宁可漏，也不要错。',
    '2. 每个分组给出一个 canonical：选最完整、最能说明含义的那个写法。',
    '3. 缩写与全称（如 Boyar-Peralta heuristic 与 BP heuristic）、中英文对照、同义改写都算同一概念。',
    '4. 已知不是同一概念的要分开，例如 JPEG-LS 与 JPEG 2000。',
    '5. 严格只输出 JSON，不要 Markdown、代码块或任何额外说明。',
    'JSON 格式：{"groups":[{"canonical":"原文写法","variants":["另一种写法","第三种写法"]}]}',
    '',
    '术语列表（每行一个）：',
    ...terms.map((term) => `- ${term}`),
  ].join('\n');
}

function readJsonObject(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效 JSON。');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * Reads the model's answer into `name → canonical name`.
 *
 * Only names that were actually asked about survive, and a group whose members are all the same
 * string is dropped: echoing a name back is not a synonym. The canonical spelling returned is the
 * caller's own spelling of that name when it matches (so the row keeps its wording), otherwise the
 * model's.
 */
export function parseEntitySynonyms(
  content: string,
  requested: readonly string[],
): Map<string, string> {
  const parsed = readJsonObject(content);
  const requestedByKey = new Map(
    requested
      .map((term) => term.trim())
      .filter(Boolean)
      .map((term) => [term.toLocaleLowerCase(), term] as const),
  );
  const remember = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    return requestedByKey.get(value.trim().toLocaleLowerCase()) ?? null;
  };

  const mapping = new Map<string, string>();
  const groups = Array.isArray(parsed.groups)
    ? parsed.groups
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];

  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const record = group as { canonical?: unknown; variants?: unknown; members?: unknown; same?: unknown };
    const canonical = remember(record.canonical);
    const variants = [record.variants, record.members, record.same]
      .find((value) => Array.isArray(value)) as unknown[] | undefined;
    if (!variants?.length) continue;
    const members = variants
      .map((value) => remember(value))
      .filter((value): value is string => Boolean(value));
    if (!members.length) continue;

    // Without a canonical the model recognised, the first member is the best available anchor.
    const anchor = canonical ?? members[0]!;
    for (const member of members) {
      if (member === anchor) continue;
      // A name may only be mapped once; the first group wins so the result is deterministic.
      if (mapping.has(member)) continue;
      mapping.set(member, anchor);
    }
  }
  return mapping;
}

export interface EntitySynonymChecker {
  /** Suggested `name → canonical name` pairs for the given names. */
  find(terms: readonly string[]): Promise<Map<string, string>>;
}

/**
 * Builds a checker around a request function.
 *
 * Answers are cached per *set of names*, because that is the question that was asked: a review
 * screen that gains one more candidate is a different question, and serving the old answer would
 * silently omit the new name.
 */
export function createEntitySynonymChecker(
  request: (prompt: string, terms: readonly string[]) => Promise<string>,
): EntitySynonymChecker {
  const cache = new Map<string, Map<string, string>>();

  return {
    async find(terms) {
      const wanted: string[] = [];
      const seen = new Set<string>();
      for (const term of terms) {
        const trimmed = term.trim();
        if (!trimmed) continue;
        const key = trimmed.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        wanted.push(trimmed);
        if (wanted.length >= MAX_TERMS_PER_SYNONYM_REQUEST) break;
      }
      if (wanted.length < 2) return new Map();

      const signature = [...wanted].sort().join('\u0000');
      const cached = cache.get(signature);
      // A copy, so a caller mutating the result cannot poison the cache.
      if (cached) return new Map(cached);

      const content = await request(buildEntitySynonymPrompt(wanted), wanted);
      const answer = parseEntitySynonyms(content, wanted);
      cache.set(signature, answer);
      while (cache.size > SYNONYM_CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return new Map(answer);
    },
  };
}
