/**
 * Entity name normalization.
 *
 * Two separate concerns, deliberately kept apart:
 *
 * - `normalizeEntityName` is the *equality* key. Two names that normalize to the
 *   same string are the same entity and may be merged silently.
 * - `tokenizeEntityName` feeds the *similarity* score, which may only ever
 *   produce a suggestion for the user to confirm.
 *
 * Being conservative here is what keeps "BERT" and "ERNIE" apart; being liberal
 * is what merges "Transformer" and "Transformer模型". The line between the two
 * is the whole point of this module, so every rule below is spelled out rather
 * than folded into one regex.
 */

/**
 * Unicode sub/superscript characters used in method names, mapped to their
 * plain forms so `BERTₗᵢₙₖ` and `BERTlink` share an equality key. Covers the
 * subscript digits plus the subscript Latin letters that actually appear in
 * paper titles.
 */
const SUBSCRIPT_CHARACTERS: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  'ₐ': 'a',
  'ₑ': 'e',
  'ₕ': 'h',
  'ᵢ': 'i',
  'ⱼ': 'j',
  'ₖ': 'k',
  'ₗ': 'l',
  'ₘ': 'm',
  'ₙ': 'n',
  'ₒ': 'o',
  'ₚ': 'p',
  'ᵣ': 'r',
  'ₛ': 's',
  'ₜ': 't',
  'ᵤ': 'u',
  'ᵥ': 'v',
  'ₓ': 'x',
};

const SUBSCRIPT_PATTERN = /[₀-₉₊₋ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/gu;

/**
 * Suffixes that carry no distinguishing information in a literature graph.
 *
 * Both Chinese and English forms are listed because papers mix them freely
 * ("Transformer模型" and "Transformer Model" appear in the same corpus). The
 * English list is restricted to words that are genuinely generic descriptors —
 * "Net" is deliberately absent, because "ResNet" vs "ResNet-Net" is not a thing,
 * whereas "Network" vs "Net" is a real ambiguity better left to the similarity
 * pass, which asks the user instead of deciding silently.
 */
const NOISE_SUFFIXES: RegExp[] = [
  /模型$/u,
  /算法$/u,
  /方法$/u,
  /网络$/u,
  /框架$/u,
  /机制$/u,
  /技术$/u,
  /model$/u,
  /models$/u,
  /algorithm$/u,
  /algorithms$/u,
  /method$/u,
  /methods$/u,
  /approach$/u,
  /approaches$/u,
  /framework$/u,
  /frameworks$/u,
  /architecture$/u,
  /architectures$/u,
  /network$/u,
  /networks$/u,
  /technique$/u,
  /techniques$/u,
  /mechanism$/u,
  /mechanisms$/u,
  /scheme$/u,
  /strategy$/u,
  /pipeline$/u,
];

/** Version-ish tails: "v1", "v2.1", "ver 3". */
const VERSION_TAIL = /(?:[\s._-]*(?:v|ver|version)\s*\d+(?:\.\d+)*)$/iu;
/** Trailing bracketed qualifiers: "(2017)", "[preprint]", "（预印本）". */
const BRACKETED_TAIL = /[\s]*[(（[【][^)）\]】]*[)）\]】][\s]*$/u;

/** Full-width ASCII (！ to ～) maps to its half-width counterpart. */
function toHalfWidth(value: string): string {
  return value.replace(/[\uFF01-\uFF5E]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}

function mapSubscriptCharacters(value: string): string {
  return value.replace(
    SUBSCRIPT_PATTERN,
    (character) => SUBSCRIPT_CHARACTERS[character] ?? character,
  );
}

function stripDiacritics(value: string): string {
  // NFD splits "é" into "e" + combining acute; the combining marks then drop.
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Crude but deterministic singularization.
 *
 * Only applied to a trailing token and only for shapes where dropping the "s"
 * is safe. It deliberately does not handle "ies" → "y" (which would turn an
 * acronym into a different word) nor irregular forms: a wrong merge is worse
 * than a missed one.
 */
function singularizeToken(token: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(token)) return token;
  if (token.length <= 3) return token;
  if (/(?:ss|us|is|as|os)$/u.test(token)) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/**
 * Equality key for an entity name.
 *
 * `normalizeEntityName("Transformer模型") === normalizeEntityName("Transformer")`
 * is the property that makes silent merging safe.
 */
export function normalizeEntityName(name: string): string {
  if (!name) return '';
  let value = String(name).normalize('NFC');
  value = toHalfWidth(value);
  value = mapSubscriptCharacters(value);
  value = stripDiacritics(value);
  value = value.toLocaleLowerCase();

  // Order matters: version and bracketed tails must be stripped while the
  // brackets are still present, because flattening punctuation first would turn
  // "Attention (2017)" into "attention 2017" and leave the year in the key.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = value;
    value = value.replace(VERSION_TAIL, '').replace(BRACKETED_TAIL, '');
    // Separators become spaces so the suffix rules can anchor on word ends.
    value = value.replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim();
    for (const suffix of NOISE_SUFFIXES) value = value.replace(suffix, '');
    value = value.trim();
    if (value === before) break;
  }

  // Punctuation and separators collapse away entirely: "3D-CNN" == "3dcnn".
  value = value.replace(/[^\p{L}\p{N}+#]/gu, '');
  return value;
}

/**
 * Tokens used for similarity. Punctuation is kept as a token boundary so
 * "multi-label" and "multilabel" can be compared through their joint key.
 */
export function tokenizeEntityName(name: string): string[] {
  if (!name) return [];
  let value = toHalfWidth(String(name).normalize('NFC'));
  value = mapSubscriptCharacters(value);
  value = stripDiacritics(value);
  value = value.replace(/[^\p{L}\p{N}+#]+/gu, ' ').toLocaleLowerCase();
  return value
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map(singularizeToken);
}

export function normalizeEntityAliases(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    const key = normalizeEntityName(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** True when two names differ only in punctuation/casing/suffix noise. */
export function areSameEntityName(left: string, right: string): boolean {
  const leftKey = normalizeEntityName(left);
  const rightKey = normalizeEntityName(right);
  return leftKey.length > 0 && leftKey === rightKey;
}
