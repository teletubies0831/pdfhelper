import { normalizeEntityName, tokenizeEntityName } from './entity-normalization.ts';

/**
 * Abbreviation-aware entity alignment.
 *
 * The string scorer in `entity-similarity.ts` cannot see the one relationship that papers state
 * constantly: `Boyar-Peralta heuristic` and `BP heuristic` are the same thing. An abbreviation
 * shares almost no characters with its expansion — measured, that pair scores 0.49 against a 0.70
 * display floor — so no threshold adjustment recovers it without also merging genuinely different
 * entities.
 *
 * This module reads the relationship the way a reader does:
 *
 * - **From the text.** Papers introduce abbreviations in parentheses — often *inside* the name, as
 *   in `Boyar-Peralta (BP) heuristic` — and those sentences are already stored as evidence quotes.
 *   That is a stated fact, and it corroborates a merge.
 * - **From initials.** `BP heuristic` is `B`oyar-`P`eralta `heuristic`. Initials alone are only a
 *   *suggestion* — `BP` is also back-propagation — so an initials-only match is never pre-ticked.
 *
 * Nothing here merges anything. Like the similarity scorer, it produces suggestions that the merge
 * dialog asks the user to accept.
 */

/** Tokens ignored while matching initials: acronyms conventionally skip them ("BERT" skips "from"). */
const INITIALS_STOPWORDS = new Set([
  'of', 'and', 'for', 'with', 'from', 'the', 'in', 'on', 'to', 'a', 'an', 'by', 'via', 'using',
]);

/** Longest single token treated as a possible acronym ("gnn", "cnn", "bert"). */
const MAX_ACRONYM_LENGTH = 5;

/** Fewest name tokens an acronym run must cover: one letter is a coincidence, not a mapping. */
const MIN_ACRONYM_RUN = 2;

export interface AbbreviationPair {
  /** The explanatory name, e.g. `Boyar-Peralta heuristic`. */
  long: string;
  /** The abbreviation used in the text, e.g. `BP`. */
  short: string;
}

function usefulTokens(value: string): string[] {
  return tokenizeEntityName(value).filter((token) => !INITIALS_STOPWORDS.has(token));
}

function isAcronymToken(token: string): boolean {
  return token.length >= MIN_ACRONYM_RUN
    && token.length <= MAX_ACRONYM_LENGTH
    && /^[a-z]+$/u.test(token);
}

/**
 * Walks `short` against `long` token by token.
 *
 * `allowLeftover` decides the two questions this module asks:
 * - **Inferred** (no text evidence): nothing may be left over on either side, because "BP" alone
 *   against "Boyar-Peralta heuristic" would otherwise match every name that merely starts with
 *   those two letters.
 * - **Stated** (the paper wrote the pairing down): leftovers are allowed, because papers put the
 *   abbreviation in the middle of the name — `Boyar-Peralta (BP) heuristic` — and the trailing
 *   `heuristic` belongs to the name rather than to the abbreviation.
 */
function matchAcronym(
  shortTokens: readonly string[],
  longTokens: readonly string[],
  allowLeftover: boolean,
): boolean {
  if (!shortTokens.length || !longTokens.length) return false;
  if (shortTokens.length >= longTokens.length) return false;

  let longIndex = 0;
  let acronymRuns = 0;
  for (const shortToken of shortTokens) {
    if (longTokens[longIndex] === shortToken) {
      longIndex += 1;
      continue;
    }
    if (!isAcronymToken(shortToken)) return false;

    // Spell the acronym from the next long tokens. Greedy on purpose: letting a letter match a
    // non-adjacent token is exactly the false positive this function exists to prevent.
    let spelled = '';
    while (longIndex < longTokens.length && spelled.length < shortToken.length) {
      const initial = longTokens[longIndex]!.charAt(0);
      if (!/[a-z]/u.test(initial)) break;
      spelled += initial;
      longIndex += 1;
      if (!shortToken.startsWith(spelled)) return false;
    }
    if (spelled !== shortToken) return false;
    acronymRuns += 1;
  }
  if (!acronymRuns) return false;
  return allowLeftover || longIndex === longTokens.length;
}

/**
 * True when `short` names the same thing as `long` using an acronym.
 *
 * Strict: every token of `short` must either equal a token of `long` in order, or spell the initials
 * of a consecutive run of `long`'s tokens (stopwords skippable), and nothing may be left over on
 * either side. A missed merge is cheap; a wrong one corrupts the graph.
 */
export function isAbbreviationOf(short: string, long: string): boolean {
  const shortTokens = usefulTokens(short);
  const longTokens = usefulTokens(long);
  // Identical names are normalization's business, not this module's.
  if (normalizeEntityName(short) === normalizeEntityName(long)) return false;
  return matchAcronym(shortTokens, longTokens, false);
}

/**
 * True when `short` is an acronym of the *start* of `long`.
 *
 * Only used to validate a pairing the text itself declared, where the remainder of the name is
 * known to be part of the name and not part of the abbreviation.
 */
export function isDeclaredAbbreviationOf(short: string, long: string): boolean {
  const shortTokens = usefulTokens(short);
  const longTokens = usefulTokens(long);
  if (normalizeEntityName(short) === normalizeEntityName(long)) return false;
  return matchAcronym(shortTokens, longTokens, true);
}

/** True when `abbreviation` is the leading part of `name` — `BP` against `BP heuristic`. */
export function abbreviationLeadsName(abbreviation: string, name: string): boolean {
  const abbreviationTokens = usefulTokens(abbreviation);
  const nameTokens = usefulTokens(name);
  if (!abbreviationTokens.length || abbreviationTokens.length > nameTokens.length) return false;
  return abbreviationTokens.every((token, index) => nameTokens[index] === token);
}

/** A parenthesised aside, with enough context on both sides to rebuild the name it interrupts. */
const PARENTHESISED = /([A-Za-z][A-Za-z0-9\-\s]{1,60})[(（]\s*([A-Za-z][A-Za-z0-9\-\s]{0,80}?)\s*[)）]\s*([A-Za-z][A-Za-z0-9\-\s]{0,40})?/gu;

/** Most name/abbreviation pairs kept per text: one sentence rarely declares more. */
const MAX_PAIRS_PER_TEXT = 4;

/** How many of the words before the parenthesis may belong to the name. */
const MAX_LEAD_WORDS = 5;
/** How many of the words after the parenthesis may complete an interrupted name. */
const MAX_TAIL_WORDS = 3;

/** Leading words that belong to the sentence rather than to the name. */
const LEAD_STOPWORDS = new Set([
  ...Array.from(INITIALS_STOPWORDS),
  'is', 'are', 'was', 'were', 'be', 'called', 'named', 'termed', '称为', '叫做',
]);

function words(value: string): string[] {
  return value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

function isPlainWord(word: string): boolean {
  return /^[A-Za-z][A-Za-z0-9\-]*$/u.test(word);
}

/**
 * Reads `Long Name (ABBR)` declarations out of a piece of text.
 *
 * The parenthesis frequently interrupts the name (`Boyar-Peralta (BP) heuristic`), so candidate long
 * names are built from a suffix of the leading words plus a prefix of the trailing words, and only
 * combinations that satisfy `isDeclaredAbbreviationOf` are kept. Parenthesised asides that are not
 * abbreviations — `heuristic (see §3)` — therefore produce nothing.
 */
export function extractAbbreviationPairs(text: string): AbbreviationPair[] {
  if (!text || text.length < 4) return [];
  const pairs: AbbreviationPair[] = [];
  const seen = new Set<string>();
  const record = (long: string, short: string): void => {
    const cleanedLong = long.trim().replace(/\s+/g, ' ');
    const cleanedShort = short.trim();
    if (!cleanedLong || !cleanedShort) return;
    if (cleanedShort.length < 2 || cleanedShort.length > 20) return;
    if (!isPlainWord(cleanedShort)) return;
    if (!isDeclaredAbbreviationOf(cleanedShort, cleanedLong)) return;
    const key = `${normalizeEntityName(cleanedShort)}|${normalizeEntityName(cleanedLong)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ long: cleanedLong, short: cleanedShort });
  };

  for (const match of text.matchAll(PARENTHESISED)) {
    const lead = words(match[1] ?? '');
    const inside = (match[2] ?? '').trim();
    // A stopword after the parenthesis usually starts a new phrase ("… (GNN) for scoring"), so the
    // name ends there; only plain words can continue it (`… (BP) heuristic`).
    const tail: string[] = [];
    for (const word of words(match[3] ?? '')) {
      if (!isPlainWord(word) || LEAD_STOPWORDS.has(word.toLocaleLowerCase())) break;
      tail.push(word);
      if (tail.length >= MAX_TAIL_WORDS) break;
    }
    if (!inside) continue;

    // Longest candidates first: a longer name that still verifies is the more informative one.
    for (let leadLength = Math.min(lead.length, MAX_LEAD_WORDS); leadLength >= 1; leadLength -= 1) {
      let leadWords = lead.slice(lead.length - leadLength);
      // Strip the words that belong to the sentence, not to the name ("by the Boyar-Peralta").
      while (leadWords.length > 1 && LEAD_STOPWORDS.has(leadWords[0]!.toLocaleLowerCase())) {
        leadWords = leadWords.slice(1);
      }
      if (!leadWords.every(isPlainWord)) continue;
      for (let tailLength = 0; tailLength <= tail.length; tailLength += 1) {
        record([...leadWords, ...tail.slice(0, tailLength)].join(' '), inside);
      }
    }

    // The reversed form: `ABBR (Long Name)`, where the parenthesis holds the expansion.
    const lastLead = lead[lead.length - 1];
    if (inside.split(' ').length >= 2 && lastLead) record(inside, lastLead);
  }

  // Longest names first, and only a few: a text that declares one abbreviation should not produce a
  // sliding window of overlapping candidates for the caller to reason about.
  return pairs
    .sort((left, right) => right.long.length - left.long.length)
    .slice(0, MAX_PAIRS_PER_TEXT);
}

export interface AbbreviationCandidate {
  entityId: string;
  name: string;
  aliases?: readonly string[];
  /** Stored evidence quotes; they are where the paper declared the abbreviation. */
  quotes?: readonly string[];
}

export interface AbbreviationSuggestion {
  /** The explanatory name survives: an abbreviation becomes an alias of its expansion. */
  keepEntityId: string;
  mergeEntityId: string;
  score: number;
  reasons: string[];
  /** Pre-tickable only when the paper itself wrote the pairing down. */
  autoSelectable: boolean;
}

/** Score for a pairing the text declares; high, because it is stated rather than inferred. */
export const ABBREVIATION_STATED_SCORE = 0.97;

/** Score for an initials-only match; inside the review band, so it is never pre-ticked. */
export const ABBREVIATION_INITIALS_SCORE = 0.82;

interface DeclaredPair {
  longKey: string;
  short: string;
}

/** Collects every `long (short)` declaration the paper made, across all quotes. */
function collectDeclaredPairs(candidates: readonly AbbreviationCandidate[]): DeclaredPair[] {
  const declared: DeclaredPair[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const quote of candidate.quotes ?? []) {
      for (const pair of extractAbbreviationPairs(quote)) {
        const longKey = normalizeEntityName(pair.long);
        const key = `${normalizeEntityName(pair.short)}|${longKey}`;
        if (!longKey || seen.has(key)) continue;
        seen.add(key);
        declared.push({ longKey, short: pair.short });
      }
    }
  }
  return declared;
}

function nameKeys(candidate: AbbreviationCandidate): string[] {
  return [candidate.name, ...(candidate.aliases ?? [])]
    .map((name) => normalizeEntityName(name))
    .filter(Boolean);
}

/**
 * Whether a declaration found in the text explains this pair of entities.
 *
 * The declared long name has to match one side, and the declared abbreviation has to be that side's
 * abbreviation — either the other entity's whole name, or the leading part of it (`BP` against
 * `BP heuristic`, which is how papers write the short form in running text).
 */
function declarationExplains(
  declaration: DeclaredPair,
  long: AbbreviationCandidate,
  short: AbbreviationCandidate,
): boolean {
  if (!nameKeys(long).includes(declaration.longKey)) return false;
  if (nameKeys(short).includes(normalizeEntityName(declaration.short))) return true;
  if (abbreviationLeadsName(declaration.short, short.name)) return true;
  return (short.aliases ?? []).some((alias) => abbreviationLeadsName(declaration.short, alias));
}

/**
 * Abbreviation suggestions among a set of entities.
 *
 * The expansion always survives: it is the name that explains the other, and after the merge the
 * abbreviation lives on as its alias, so the next extraction of `BP heuristic` lands on the same
 * entity instead of recreating the duplicate.
 */
export function suggestAbbreviationMerges(
  entities: readonly AbbreviationCandidate[],
  options: { maxEntities?: number } = {},
): AbbreviationSuggestion[] {
  const maxEntities = options.maxEntities ?? 400;
  const candidates = entities.slice(0, maxEntities);
  const declared = collectDeclaredPairs(candidates);
  const suggestions: AbbreviationSuggestion[] = [];

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;

      // 1. The paper declared it. This is a fact, and it needs no initials match to be believed:
      //    `BP` against `Boyar-Peralta heuristic` is exactly the case initials alone cannot bridge.
      const statedForwards = declared.some((item) => declarationExplains(item, left, right));
      const statedBackwards = declared.some((item) => declarationExplains(item, right, left));
      if (statedForwards || statedBackwards) {
        suggestions.push({
          keepEntityId: statedForwards ? left.entityId : right.entityId,
          mergeEntityId: statedForwards ? right.entityId : left.entityId,
          score: ABBREVIATION_STATED_SCORE,
          reasons: ['论文里写出了这个缩写', '缩写与全称指向同一概念'],
          autoSelectable: true,
        });
        continue;
      }

      // 2. Initials only: a suggestion the user judges, never a pre-ticked one.
      const leftAbbreviatesRight = isAbbreviationOf(left.name, right.name);
      const rightAbbreviatesLeft = isAbbreviationOf(right.name, left.name);
      if (!leftAbbreviatesRight && !rightAbbreviatesLeft) continue;
      suggestions.push({
        keepEntityId: leftAbbreviatesRight ? right.entityId : left.entityId,
        mergeEntityId: leftAbbreviatesRight ? left.entityId : right.entityId,
        score: ABBREVIATION_INITIALS_SCORE,
        reasons: ['缩写是全称的首字母'],
        autoSelectable: false,
      });
    }
  }

  return suggestions.sort((left, right) => (
    right.score - left.score
    || left.keepEntityId.localeCompare(right.keepEntityId)
    || left.mergeEntityId.localeCompare(right.mergeEntityId)
  ));
}
