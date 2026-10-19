/**
 * Chinese glosses for extracted entity names — the parts that need no browser.
 *
 * The names a model extracts from a paper are whatever the paper called them —
 * `Boyar-Perralta heuristic`, `two-step process for combinational logic optimization` — and the
 * user is being asked to judge whether they belong in a knowledge graph. A one-line Chinese gloss
 * under the name turns that from a language test into a judgement about the concept.
 *
 * Three rules shape this:
 *
 * - **Display only.** A gloss is never written back to the entity: the name is the identity the
 *   graph links on, and silently renaming an entity into Chinese would break matching against the
 *   next extraction of the same paper.
 * - **One request, on demand.** Translating is opt-in (a checkbox) because it spends tokens; when
 *   it runs it asks for every visible name at once instead of one request per row.
 * - **Cached by name.** Reopening the dialog answers from the cache, so the same names are never
 *   paid for twice.
 *
 * Deliberately import-free: the request itself lives in `entity-translation.ts`, which pulls in the
 * AI layer, and keeping these rules separate is what lets them be tested without a browser.
 */

/** Names per request. Long enough for a full screen of candidates, short enough to stay one call. */
export const MAX_TERMS_PER_REQUEST = 60;

/** Distinct terms remembered across dialog openings. */
export const TRANSLATION_CACHE_LIMIT = 400;

/**
 * How many times one name may be sent before the translator gives up on it.
 *
 * It used to be one. A single reply that left a name out — an omitted line, an answer echoing the
 * original because the prompt allowed it — was remembered as "no gloss" for the rest of the session, so
 * turning 中文释义 off and on again could never fix it: the reader saw one row that "cannot be
 * translated" while its neighbours were fine, with nothing they could do about it.
 */
export const GLOSS_ATTEMPT_LIMIT = 3;

/** At most one batch plus one re-ask per call: a partial reply is worth finishing, not a loop. */
const MAX_ROUNDS_PER_CALL = 2;

/** True when a term is worth translating: it carries Latin letters, so it is not Chinese already. */
export function needsTranslation(term: string): boolean {
  return /[A-Za-z]/.test(term);
}

/**
 * Comparison key for a term: case, punctuation and spacing are noise.
 *
 * A model echoes the term it was given, but not always byte for byte: it straightens a typographic
 * apostrophe (`Paar’s` → `Paar's`), drops a trailing period, or turns a hyphen into a space. Keyed on
 * the raw string those answers matched nothing and were silently dropped — which is why a name with an
 * apostrophe in it was exactly the row that never got a gloss.
 */
export function normalizeGlossTerm(term: string): string {
  return term
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The request prompt.
 *
 * Asks for a flat JSON object rather than prose, because the answer is looked up by term and a
 * model that also explains will be asked to keep the explanation out.
 *
 * Rule 2 is where this prompt used to leak: "专有名词保留原文，可以补充中文说明" invited the model to echo
 * `Paar's heuristic` back unchanged, and the parser — correctly — refuses to show a name as its own
 * translation. So the one kind of name a reader most needs help with was the one that never got a
 * gloss. The prompt now demands Chinese in every answer, and coverage of every term.
 */
export function buildEntityTranslationPrompt(terms: readonly string[]): string {
  return [
    '你在帮我审阅从学术论文中抽取出的术语列表。请为每个术语给出简洁的简体中文译名。',
    '要求：',
    '1. 译文要短，能直接读懂的术语就译成通行中文术语（例如 “heuristic” → “启发式”），不要解释、不要造句。',
    '2. 专有名词（人名、算法名、模型名）保留原文，但后面必须跟一个中文类别词，例如 “Paar\'s heuristic” → “Paar 启发式”，“DPLL” → “DPLL 算法”。',
    '3. 每个术语都必须在 items 里出现且只出现一次，不能遗漏；zh 里必须有中文，不能把原文照抄回来。',
    '4. 严格只输出 JSON，不要 Markdown、代码块或任何额外说明。',
    'JSON 格式：{"items":[{"term":"原文术语","zh":"中文译名"}]}',
    '',
    '待译术语（每行一个）：',
    ...terms.map((term) => `- ${term}`),
  ].join('\n');
}

/**
 * Pulls the JSON object out of a model reply.
 *
 * A local copy of the shared reader instead of an import: `parseAiJson` lives in
 * `shared-ui/markdown/markdown-renderer.ts`, which touches app state and the DOM at module scope,
 * and importing it would make these rules untestable outside a browser.
 */
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
 * Reads the model's answer.
 *
 * Tolerant on purpose: `{"items":[{term, zh}]}` is what the prompt asks for, a flat
 * `{"term":"译名"}` object is accepted too, and anything that was not asked for is dropped. A term
 * the model chose not to translate simply has no gloss — echoing the original back as its own
 * translation would be noise dressed up as an answer.
 *
 * Matching is exact first (case aside), then by `normalizeGlossTerm` when that leaves one candidate:
 * an answer about a name that differs from the request only in punctuation is an answer about that
 * name, not an unknown term.
 */
export function parseEntityTranslations(
  content: string,
  requested: readonly string[],
): Map<string, string> {
  const parsed = readJsonObject(content);
  const requestedByKey = new Map<string, string>();
  const requestedByLooseKey = new Map<string, Set<string>>();
  for (const raw of requested) {
    const term = raw.trim();
    if (!term) continue;
    requestedByKey.set(term.toLocaleLowerCase(), term);
    const loose = normalizeGlossTerm(term);
    const bucket = requestedByLooseKey.get(loose) ?? new Set<string>();
    bucket.add(term);
    requestedByLooseKey.set(loose, bucket);
  }

  const resolve = (rawTerm: string): string | undefined => {
    const exact = requestedByKey.get(rawTerm.toLocaleLowerCase());
    if (exact) return exact;
    const bucket = requestedByLooseKey.get(normalizeGlossTerm(rawTerm));
    // Ambiguous (two requested names differ only in punctuation): refuse rather than guess, because
    // the gloss would land on the wrong row.
    return bucket && bucket.size === 1 ? [...bucket][0] : undefined;
  };

  const found = new Map<string, string>();

  const record = (rawTerm: unknown, rawGloss: unknown): void => {
    if (typeof rawTerm !== 'string' || typeof rawGloss !== 'string') return;
    if (!rawTerm.trim()) return;
    const original = resolve(rawTerm);
    if (!original) return;
    const gloss = rawGloss.trim();
    if (!gloss) return;
    // The same name, punctuation aside, means the model echoed the input; that is not a translation.
    if (normalizeGlossTerm(gloss) === normalizeGlossTerm(original)) return;
    found.set(original, gloss);
  };

  const items = parsed.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as { term?: unknown; zh?: unknown; name?: unknown; translation?: unknown };
      record(entry.term ?? entry.name, entry.zh ?? entry.translation);
    }
  }
  for (const [rawTerm, rawGloss] of Object.entries(parsed)) {
    if (rawTerm === 'items') continue;
    record(rawTerm, rawGloss);
  }
  return found;
}

export interface EntityTranslator {
  /** Glosses for the given names; names already known are answered from the cache. */
  translate(terms: readonly string[]): Promise<Map<string, string>>;
}

/**
 * Builds a translator around a request function.
 *
 * Two kinds of memory, deliberately different:
 *
 * - a **gloss**, keyed by name, answered for free on every later opening;
 * - an **attempt count** for names that came back without one. A single silent omission is not a
 *   verdict — it is usually a model that skipped a line — so the name is asked for again next time,
 *   up to `GLOSS_ATTEMPT_LIMIT` tries.
 */
export function createEntityTranslator(
  request: (prompt: string, terms: readonly string[]) => Promise<string>,
): EntityTranslator {
  const cache = new Map<string, string>();
  const attempts = new Map<string, number>();

  return {
    async translate(terms) {
      const wanted: string[] = [];
      const seen = new Set<string>();
      for (const term of terms) {
        const trimmed = term.trim();
        if (!trimmed || !needsTranslation(trimmed)) continue;
        const key = trimmed.toLocaleLowerCase();
        if (seen.has(key) || cache.has(key)) continue;
        if ((attempts.get(key) ?? 0) >= GLOSS_ATTEMPT_LIMIT) continue;
        seen.add(key);
        wanted.push(trimmed);
        if (wanted.length >= MAX_TERMS_PER_REQUEST) break;
      }

      // The batch, then one re-ask for whatever it left out. A reply that named three of ten terms used
      // to leave seven names permanently unglossed; a reply that named none is a refusal, and re-asking
      // it immediately would only spend the same tokens again.
      let pending = wanted;
      for (let round = 0; round < MAX_ROUNDS_PER_CALL && pending.length; round += 1) {
        const content = await request(buildEntityTranslationPrompt(pending), pending);
        for (const [term, gloss] of parseEntityTranslations(content, pending)) {
          cache.set(term.toLocaleLowerCase(), gloss);
        }
        const missing = pending.filter((term) => !cache.has(term.toLocaleLowerCase()));
        if (!missing.length || missing.length === pending.length) break;
        pending = missing;
      }

      for (const term of pending) {
        const key = term.toLocaleLowerCase();
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
      }
      while (attempts.size > TRANSLATION_CACHE_LIMIT) {
        const oldest = attempts.keys().next();
        if (oldest.done) break;
        attempts.delete(oldest.value);
      }

      while (cache.size > TRANSLATION_CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }

      const answers = new Map<string, string>();
      for (const term of terms) {
        const trimmed = term.trim();
        const gloss = cache.get(trimmed.toLocaleLowerCase());
        if (gloss) answers.set(trimmed, gloss);
      }
      return answers;
    },
  };
}
