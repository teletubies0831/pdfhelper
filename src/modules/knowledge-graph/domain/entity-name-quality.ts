import { normalizeEntityName, tokenizeEntityName } from './entity-normalization.ts';

/**
 * Whether a candidate name is worth putting in front of the user at all.
 *
 * Real runs produced names like `XOR2`, `# XOR2`, `b l cost` and `XOR2:2:1` — fragments of gate
 * tables and figure labels rather than knowledge. The prompt can be told to avoid this (and is), but
 * an extraction is a model output, so the ones that arrive anyway have to be filtered somewhere with
 * a rule that can be read and tested.
 *
 * Two different things happen here, and the difference matters:
 *
 * - **Rejection** is for text that is not a concept in any reading: a bare number, a two-letter
 *   fragment, a table label. Nothing is lost, because there was nothing there.
 * - **Variant collapse** is for names that *are* meaningful but are numbered copies of a name we
 *   already have (`XOR2` next to `XOR`). Those are turned into aliases of the base instead of being
 *   dropped: the information survives, the list does not grow.
 */

export interface EntityNameVerdict {
  /** False when the name should never reach the review list. */
  usable: boolean;
  /** Why it was refused, for reporting. Absent when usable. */
  reason?: string;
  /** The name with leading markers and stray quoting removed. */
  cleaned: string;
  /**
   * Kept in the pipeline but demoted out of the review list, with a reason.
   *
   * This is the middle judgement between "not a concept" (`usable: false`) and "fine as it is": the
   * name is *readable* but describes an action or is mostly numbering (`XOR3 (b2) Support for …`,
   * `b 15 x 15`). Drop-testing those against a hard rule risks losing a real entity, so they are
   * refused for review and counted separately — a demotion, not a verdict about meaning.
   */
  suspect?: string;
}

/** Marker characters that models emit in front of extracted labels ("# XOR2"). */
const LEADING_MARKERS = /^[#@§¶•·*\-–—\s]+/u;

/**
 * Names this short carry no meaning in a knowledge graph: `b`, `63`, `d1`.
 *
 * Three letters is the shortest real acronym in this domain (`CNN`, `GNN`, `XOR`).
 */
export const MIN_ENTITY_NAME_LENGTH = 3;

/** Longest name kept: past this it is a sentence, not a name. */
export const MAX_ENTITY_NAME_WORDS = 10;
export const MAX_ENTITY_NAME_CHARACTERS = 80;

/**
 * Word count past which a name is treated as a clause.
 *
 * Six tokens is where real entity names in these papers stop: five-token
 * names are everywhere (`Bidirectional Encoder Representations from Transformers`,
 * `Graph Convolutional Network with Attention`), six-token ones read as descriptions
 * (`two-step process for combinational logic optimization`). Such names were demoted on request
 * after a real canvas, where they were the longest labels and the least useful ones — the trade-off
 * is documented in the plan so the threshold is a decision, not a guess.
 */
export const DESCRIPTIVE_NAME_WORD_LIMIT = 6;

/** Back-reference to a table or figure ("XOR2:2:1", "Table 3", "Fig. 2"). */
const TABLE_LABEL = /\d+\s*[:：]\s*\d+|\b(?:table|fig\.?|figure|eq\.?|equation|section|§)\s*\d+/iu;

/**
 * Verbs and connectives that turn a name into a description of what was done with it.
 *
 * `XOR3 (b2) Support for Boyar-Peralta Algorithm` is the shape: the real entity is inside it, and
 * the wrapper says "support for". Matching is anchored on word boundaries and deliberately narrow —
 * `based on` (not `based`), because `SAT-Based Optimization` is a legitimate method name; `proposed`
 * (not `propose` alone inside another word).
 */
const DESCRIPTIVE_PHRASES: RegExp[] = [
  /\bsupports?\s+for\b/iu,
  /\bsupported\s+by\b/iu,
  /\bsupporting\b/iu,
  /\bbased\s+on\b/iu,
  /\bpropos(?:e|es|ed|ing)\b/iu,
  /\bachiev(?:e|es|ed|ing)\b/iu,
  /\bimprov(?:e|es|ed|ing)\b/iu,
  /\benabl(?:e|es|ed|ing)\b/iu,
  /\ballow(?:s|ed|ing)?\b/iu,
  /\boutperform(?:s|ed|ing)?\b/iu,
  /\bimplement(?:s|ed|ing)?\s+(?:in|with|by|using)\b/iu,
  /\busing\b/iu,
];

/**
 * Share of digits and symbols above which a name is numbering rather than naming.
 *
 * Measured against the real names that must survive: `GPT-3`, `BLEU-4` and `WMT14` sit at exactly
 * 0.40, `ResNet-50` at 0.33, while `b 15 x 15` is 0.67. The line is above the legitimate cluster on
 * purpose — a wrongly demoted dataset name is worse than one table fragment that slips through.
 */
export const MAX_DIGIT_SYMBOL_RATIO = 0.45;

function digitSymbolRatio(value: string): number {
  const compact = value.replace(/\s+/gu, '');
  if (!compact) return 0;
  const marked = (compact.match(/[\d\p{S}\p{P}]/gu) ?? []).length;
  return marked / compact.length;
}

function cleanName(name: string): string {
  return name
    .trim()
    .replace(LEADING_MARKERS, '')
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Judges one raw name.
 *
 * Every rule below is here because a specific kind of junk got through: the length and
 * single-letter rules cover table fragments, the table-label rule covers `XOR2:2:1`, and the length
 * ceilings cover descriptive sentences that are not entities.
 */
export function assessEntityName(rawName: string): EntityNameVerdict {
  const cleaned = cleanName(rawName);
  if (!cleaned) return { usable: false, reason: '名称为空。', cleaned };

  const key = normalizeEntityName(cleaned);
  if (!key) return { usable: false, reason: '没有可用的文字。', cleaned };
  if (key.length < MIN_ENTITY_NAME_LENGTH) {
    return { usable: false, reason: `名称过短（少于 ${MIN_ENTITY_NAME_LENGTH} 个字符）。`, cleaned };
  }
  // A number is not an entity; `15` and `63` are quantities from the text.
  if (!/\p{L}/u.test(key)) return { usable: false, reason: '没有文字，只有数字或符号。', cleaned };

  const tokens = tokenizeEntityName(cleaned);
  const singleLetterTokens = tokens.filter((token) => token.length === 1).length;
  if (tokens.length >= 2 && singleLetterTokens === tokens.length) {
    return { usable: false, reason: '只有单字母，像是公式或表格碎片。', cleaned };
  }
  // `b l cost` — mostly single letters with one word attached. Half is the line: a legitimate name
  // like "F 1 score" would be borderline, and it is better to keep a doubtful name than to drop a
  // real one, so the rule needs a *majority*.
  if (tokens.length >= 3 && singleLetterTokens * 2 >= tokens.length) {
    return { usable: false, reason: '大部分是单字母，像是表格碎片。', cleaned };
  }
  if (TABLE_LABEL.test(cleaned)) {
    return { usable: false, reason: '像是表格或图号引用。', cleaned };
  }
  if (tokens.length > MAX_ENTITY_NAME_WORDS || cleaned.length > MAX_ENTITY_NAME_CHARACTERS) {
    return { usable: false, reason: '过长，像是句子而不是名称。', cleaned };
  }

  // Suspicion, not rejection: readable names that describe an action or are mostly numbering.
  for (const pattern of DESCRIPTIVE_PHRASES) {
    const match = pattern.exec(cleaned);
    if (!match) continue;
    return {
      usable: true,
      cleaned,
      suspect: `名称里带有动作或用途短语（“${match[0]}”），像是描述而不是名字。`,
    };
  }
  // Six or more words reads as a clause rather than a name. Kept as a demotion: such a thing may
  // still be worth knowing about, it just should not be the longest label on the canvas.
  if (tokens.length >= DESCRIPTIVE_NAME_WORD_LIMIT) {
    return {
      usable: true,
      cleaned,
      suspect: `名称有 ${tokens.length} 个词，读起来像是一句话而不是名字。`,
    };
  }
  const ratio = digitSymbolRatio(cleaned);
  if (ratio > MAX_DIGIT_SYMBOL_RATIO) {
    return {
      usable: true,
      cleaned,
      suspect: `数字与符号占比 ${Math.round(ratio * 100)}%，像是编号或表格标签。`,
    };
  }

  return { usable: true, cleaned };
}

/**
 * A numbered copy of a known acronym, for example `XOR2` when `XOR` exists.
 *
 * The pattern is deliberately narrow — an all-caps acronym of at least two letters followed by
 * exactly **one** digit and nothing else — because the neighbouring cases are legitimate entities:
 * `WMT14` has a two-digit year, `GPT-3` and `ResNet-50` are hyphenated model versions, and both must
 * stay separate. What is left is the label-like `XOR2` / `XOR3`, which are indices in a gate table.
 */
const NUMBERED_ACRONYM = /^([A-Z]{2,})(\d)$/u;

/**
 * The base name this candidate is a numbered copy of, when one is known.
 *
 * `knownNames` holds the display names already in play (existing entities plus this batch's earlier
 * candidates). Matching is on the normalized key so `XOR` and `xor` are the same base.
 */
export function variantBaseOf(
  cleanedName: string,
  knownNames: Iterable<string>,
): string | null {
  const match = NUMBERED_ACRONYM.exec(cleanedName);
  if (!match) return null;
  const base = match[1]!;
  const baseKey = normalizeEntityName(base);
  if (!baseKey) return null;
  for (const known of knownNames) {
    if (normalizeEntityName(known) === baseKey) return known;
  }
  return null;
}
