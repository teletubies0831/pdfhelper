import {
  ENTITY_TYPES,
  type EntityType,
} from '../contracts.ts';
import { assessEntityName } from '../domain/entity-name-quality.ts';
import { normalizeEntityName } from '../domain/entity-normalization.ts';
import type { RelationCandidatePair } from './relation-recall.ts';

/**
 * The bridge half of a relation judgement: the concepts that can connect two papers.
 *
 * Split from `relation-judgement.ts` because it answers a different question — *what do these two
 * papers share* rather than *how do they relate* — and because its central rule is a verification,
 * not a parse: every quote the model returns is checked against the excerpt that was sent, so an
 * invented concept has nothing to point at and never reaches the graph.
 */

/** Bridge concepts kept per pair. Enforced in code, never stated in the prompt. */
export const MAX_BRIDGES_PER_PAIR = 2;

/**
 * Shortest quote accepted as evidence.
 *
 * Below this a "quote" is a coincidence: `the model` appears in almost any abstract, so matching it
 * proves nothing about the paper.
 */
export const MIN_BRIDGE_QUOTE_LENGTH = 8;

/** Longest quote kept; the same ceiling the relation evidence uses. */
export const MAX_BRIDGE_QUOTE_LENGTH = 200;

/**
 * One bridge concept the model proposed, already checked against the excerpts it was given.
 *
 * `bridgeKey` is what the review toggles: `pairKey#normalizedName`, so the same concept proposed for
 * two different pairs stays two decisions until the writes fold them into one entity.
 */
export interface RelationBridgeSuggestion {
  bridgeKey: string;
  pairKey: string;
  name: string;
  type: EntityType;
  /** One quote per paper, each verified verbatim against that paper's excerpt. */
  evidence: Array<{ paperId: string; quote: string }>;
  reason: string;
  confidence: number;
}

/** Why proposed bridges were refused, so the review can report it instead of hiding it. */
export interface BridgeDropStats {
  /** The quote could not be found in that paper's excerpt. */
  quoteMismatch: number;
  /** The name was a description, a table fragment or a generic word. */
  lowQuality: number;
  /** Not one of the six entity types. */
  badType: number;
  /** Beyond `MAX_BRIDGES_PER_PAIR` for the pair. */
  overLimit: number;
  /** The same concept twice for the same pair. */
  duplicate: number;
}

export function emptyBridgeDrops(): BridgeDropStats {
  return { quoteMismatch: 0, lowQuality: 0, badType: 0, overLimit: 0, duplicate: 0 };
}

export function totalBridgeDrops(stats: BridgeDropStats): number {
  return stats.quoteMismatch + stats.lowQuality + stats.badType + stats.overLimit + stats.duplicate;
}

/**
 * Comparison form for "is this quote inside that excerpt".
 *
 * Case-folded, whitespace-collapsed, punctuation and quote marks removed: a model that reproduces the
 * sentence with different quotes or spacing is still quoting, while a model that paraphrases is not —
 * and after this normalization a paraphrase cannot accidentally match.
 */
function comparisonForm(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/["'`«»“”‘’「」『』()（）[\]{}<>]/g, '')
    .replace(/[.,;:!?，。；：！？、…—–-]/g, '');
}

/** True when the quote really appears in the excerpt we sent for that paper. */
export function quoteAppearsIn(quote: string, excerpt: string): boolean {
  const needle = comparisonForm(quote);
  if (needle.length < MIN_BRIDGE_QUOTE_LENGTH) return false;
  return comparisonForm(excerpt).includes(needle);
}

/**
 * True when at least one meaningful token of the name appears in the quotes.
 *
 * The quotes prove the *sentence* exists; this proves the sentence is about *this* name. Without it a
 * model could pair an invented name with two real sentences about something else entirely — the one
 * failure mode the substring check alone cannot catch.
 */
export function nameSupportedByQuotes(name: string, quotes: readonly string[]): boolean {
  const haystack = quotes.map(comparisonForm).join('\n');
  if (!haystack) return false;
  const normalizedName = comparisonForm(name);
  if (normalizedName && haystack.includes(normalizedName)) return true;
  // Tokens come from the *display* name, not from `comparisonForm`: that form removes spaces, so
  // tokenizing it would yield one giant token and no name with more than one word could ever match.
  const tokens = name
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((token) => (/\p{Script=Han}/u.test(token) ? token.length >= 2 : token.length >= 3))
    .map((token) => comparisonForm(token));
  return tokens.some((token) => haystack.includes(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampUnit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = parsed > 2 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

export interface BridgeParseOptions {
  /** Verbatim excerpt per paper id, i.e. exactly what the model was shown. */
  excerpts: ReadonlyMap<string, string>;
  limitPerPair?: number;
}

/**
 * Turns the model's `bridges` arrays into validated suggestions.
 *
 * Four refusals, in the order they are cheapest to check: the name has to look like a name, the type
 * has to be one of the six, each quote has to be a verbatim slice of *its own* paper's excerpt, and at
 * least one token of the name has to appear in those quotes. Anything that survives is capped per pair.
 * Every refusal is counted, because silently dropping half of the model's suggestions would make the
 * feature look like it simply found nothing.
 */
export function parseBridgeSuggestions(
  raw: unknown,
  pair: RelationCandidatePair,
  options: BridgeParseOptions,
): { bridges: RelationBridgeSuggestion[]; drops: BridgeDropStats } {
  const drops = emptyBridgeDrops();
  const limit = Math.max(1, options.limitPerPair ?? MAX_BRIDGES_PER_PAIR);
  if (!Array.isArray(raw) || !raw.length) return { bridges: [], drops };

  const accepted: RelationBridgeSuggestion[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!isRecord(entry)) {
      drops.badType += 1;
      continue;
    }
    const name = normalizeText(entry.name ?? entry.entity ?? entry.concept, 80);
    const verdict = assessEntityName(name);
    if (!verdict.usable || verdict.suspect) {
      drops.lowQuality += 1;
      continue;
    }
    const rawType = typeof entry.type === 'string' ? entry.type.trim().toLocaleLowerCase() : '';
    const type = ENTITY_TYPES.find((item) => item.toLocaleLowerCase() === rawType) as
      | EntityType
      | undefined;
    if (!type) {
      drops.badType += 1;
      continue;
    }

    const leftQuote = normalizeText(
      entry.leftQuote ?? entry.left_quote,
      MAX_BRIDGE_QUOTE_LENGTH,
    );
    const rightQuote = normalizeText(
      entry.rightQuote ?? entry.right_quote,
      MAX_BRIDGE_QUOTE_LENGTH,
    );
    const leftExcerpt = options.excerpts.get(pair.leftPaperId) ?? '';
    const rightExcerpt = options.excerpts.get(pair.rightPaperId) ?? '';
    // Both sides are required: a concept supported by only one paper is that paper's entity, not a
    // bridge, and writing it here would draw a line the evidence does not support.
    if (!leftQuote || !rightQuote
      || !quoteAppearsIn(leftQuote, leftExcerpt)
      || !quoteAppearsIn(rightQuote, rightExcerpt)) {
      drops.quoteMismatch += 1;
      continue;
    }
    if (!nameSupportedByQuotes(name, [leftQuote, rightQuote])) {
      drops.quoteMismatch += 1;
      continue;
    }

    const key = `${pair.pairKey}#${normalizeEntityName(name)}`;
    if (seen.has(key)) {
      drops.duplicate += 1;
      continue;
    }
    seen.add(key);
    accepted.push({
      bridgeKey: key,
      pairKey: pair.pairKey,
      name: verdict.cleaned || name,
      type,
      evidence: [
        { paperId: pair.leftPaperId, quote: leftQuote },
        { paperId: pair.rightPaperId, quote: rightQuote },
      ],
      reason: normalizeText(entry.reason ?? entry.rationale, 60),
      confidence: clampUnit(entry.confidence, 0.6),
    });
  }

  // The cap is applied after sorting so which suggestions survive is deterministic and the most
  // confident ones are the ones kept.
  accepted.sort((left, right) => (
    right.confidence - left.confidence || left.name.localeCompare(right.name)
  ));
  if (accepted.length > limit) {
    drops.overLimit += accepted.length - limit;
    accepted.length = limit;
  }
  return { bridges: accepted, drops };
}
