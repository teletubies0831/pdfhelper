import type { SentenceKeyword, SentenceLearningResult } from '../../app/public';

/**
 * The two halves of a sentence card, merged outside the DOM.
 *
 * The card is produced by two independent streams, and they finish in whatever order the provider happens to produce:
 * the vocabulary is one small JSON object, the translation is a text stream. Keeping the merge in a plain object rather
 * than in the rendered elements is what makes the two invariants testable — and both of them were real bugs first:
 *
 * - **A sentence result requires a translation.** An earlier version stored a history entry as soon as the keyword half
 *   landed, which could be before any translation existed. That entry then came back as a cache hit on the next
 *   selection of the same sentence and painted an empty 「原句翻译」, with no request made, because the cache
 *   short-circuits it.
 * - **Keywords are not replaced by the translation.** The same order-dependence wiped a completed keyword list when
 *   the translation arrived afterwards.
 */

export interface SentenceStreamState {
  /** Accumulated translation text; empty until the first chunk arrives. */
  translation: string;
  /** The English the card is about; the keyword half may refine it with a LaTeX rebuild. */
  sourceText: string;
  keywords: SentenceKeyword[];
}

export function createSentenceStreamState(sourceText: string): SentenceStreamState {
  return { translation: '', sourceText, keywords: [] };
}

/** Appends one streamed chunk. */
export function appendTranslation(state: SentenceStreamState, delta: string): SentenceStreamState {
  if (!delta) return state;
  return { ...state, translation: state.translation + delta };
}

/** Settles the translation with the provider's final text, falling back to what was already streamed. */
export function settleTranslation(state: SentenceStreamState, final: string): SentenceStreamState {
  const settled = final.trim() || state.translation.trim();
  return { ...state, translation: settled };
}

export function setStreamKeywords(
  state: SentenceStreamState,
  keywords: readonly SentenceKeyword[],
  sourceText?: string,
): SentenceStreamState {
  return {
    ...state,
    keywords: [...keywords],
    sourceText: sourceText?.trim() || state.sourceText,
  };
}

/**
 * The result a reader could be shown, or `null` while there is nothing to show.
 *
 * `null` is the whole point: it is what stops an empty translation from being persisted, cached, or copied out.
 */
export function toSentenceLearningResult(state: SentenceStreamState): SentenceLearningResult | null {
  const translation = state.translation.trim();
  if (!translation) return null;
  return {
    kind: 'sentence',
    sourceText: state.sourceText,
    translation,
    keywords: state.keywords,
  };
}
