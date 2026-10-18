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

/** True when a term is worth translating: it carries Latin letters, so it is not Chinese already. */
export function needsTranslation(term: string): boolean {
  return /[A-Za-z]/.test(term);
}

/**
 * The request prompt.
 *
 * Asks for a flat JSON object rather than prose, because the answer is looked up by term and a
 * model that also explains will be asked to keep the explanation out.
 */
export function buildEntityTranslationPrompt(terms: readonly string[]): string {
  return [
    '你在帮我审阅从学术论文中抽取出的术语列表。请为每个术语给出简洁的简体中文译名。',
    '要求：',
    '1. 译文要短，能直接读懂的术语就译成通行中文术语（例如 “heuristic” → “启发式”），不要解释、不要造句。',
    '2. 人名、算法名、模型名等专有名词保留原文，可以在括号里补充中文说明，例如 “Boyar-Peralta 算法”。',
    '3. 不确定的术语保留原文，不要猜测。',
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
 */
export function parseEntityTranslations(
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
  const found = new Map<string, string>();

  const record = (rawTerm: unknown, rawGloss: unknown): void => {
    if (typeof rawTerm !== 'string' || typeof rawGloss !== 'string') return;
    const key = rawTerm.trim().toLocaleLowerCase();
    const original = requestedByKey.get(key);
    if (!original) return;
    const gloss = rawGloss.trim();
    // Identical text means the model echoed the input; that is not a translation.
    if (!gloss || gloss.toLocaleLowerCase() === key) return;
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
 * The cache also remembers *refusals* (a name the model declined to translate) as an empty string,
 * so a term it will not translate is not asked about on every opening.
 */
export function createEntityTranslator(
  request: (prompt: string, terms: readonly string[]) => Promise<string>,
): EntityTranslator {
  const cache = new Map<string, string>();

  return {
    async translate(terms) {
      const wanted: string[] = [];
      const seen = new Set<string>();
      for (const term of terms) {
        const trimmed = term.trim();
        if (!trimmed || !needsTranslation(trimmed)) continue;
        const key = trimmed.toLocaleLowerCase();
        if (seen.has(key) || cache.has(key)) continue;
        seen.add(key);
        wanted.push(trimmed);
        if (wanted.length >= MAX_TERMS_PER_REQUEST) break;
      }

      // Everything asked for is already known: no request, no tokens.
      if (wanted.length) {
        const content = await request(buildEntityTranslationPrompt(wanted), wanted);
        for (const [term, gloss] of parseEntityTranslations(content, wanted)) {
          cache.set(term.toLocaleLowerCase(), gloss);
        }
        for (const term of wanted) {
          if (!cache.has(term.toLocaleLowerCase())) cache.set(term.toLocaleLowerCase(), '');
        }
        while (cache.size > TRANSLATION_CACHE_LIMIT) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
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
