import { ENTITY_TYPES, type EntityType, type GraphEvidence } from '../contracts.ts';
import type { ExtractedEntityCandidate } from '../contracts-jobs.ts';

/**
 * Parser for model-produced entity candidates.
 *
 * This repository has no provider JSON mode — a whole-repo grep for
 * `response_format` / `json_object` comes back empty — so every structured AI
 * result is "prompt for JSON, then parse defensively". That makes this file the
 * single most likely place for a silent data bug, so the rules are:
 *
 * - Never throw on malformed input. A bad batch must discard candidates, not
 *   abort a job that already spent tokens.
 * - Never invent a candidate. A missing name or an unknown type drops the entry.
 * - Never trust a number. Confidence is clamped into 0..1.
 * - Report what was dropped, so the UI can say "12 of 15 candidates were usable"
 *   instead of silently showing fewer.
 */

/** Fenced code blocks are the most common wrapper the model adds. */
function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? trimmed;
}

/**
 * Extracts the outermost JSON object, tolerating prose before/after it.
 *
 * Same strategy as the existing `parseProfile` in document-agent: slice from the
 * first `{` to the last `}`. It is deliberately not a brace-balancing parser —
 * the model's output is either one object or unusable.
 */
export function extractJsonObject(content: string): unknown {
  const text = stripCodeFence(content);
  const candidates: string[] = [text];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  // A bare array is also acceptable for candidate lists.
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  // Models sometimes emit percentages. The window is deliberately narrow
  // (`2..100`): a value just above 1 (e.g. 1.5) is treated as an out-of-range
  // score and clamped to certainty, not silently divided into a near-zero that
  // would hide a real entity behind the auto-check threshold. Confidence only
  // affects pre-checking and visual weight, never correctness, so erring towards
  // "certain" is the safe direction.
  if (parsed > 2 && parsed <= 100) return Math.min(1, parsed / 100);
  return Math.min(1, Math.max(0, parsed));
}

function normalizeType(value: unknown): EntityType | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const direct = ENTITY_TYPES.find(
    (type) => type.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  if (direct) return direct;
  // Tolerate the Chinese labels the prompt may echo back.
  const byLabel: Record<string, EntityType> = {
    '方法': 'Method',
    '任务': 'Task',
    '数据集': 'Dataset',
    '指标': 'Metric',
    '概念': 'Concept',
    '主张': 'Claim',
    '结论': 'Claim',
  };
  return byLabel[trimmed] ?? null;
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Collapse internal whitespace but keep the original casing for display.
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeQuote(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

/** Cap on alternative spellings kept per candidate: the model lists the paper's own variants. */
const MAX_ALIASES = 6;

/**
 * Reads the optional `aliases` field.
 *
 * Accepts an array, a single string, or a comma/slash separated string, because "one field with a
 * list in it" is exactly where models improvise. Blank entries and the candidate's own name are
 * dropped — an alias equal to the name carries no information and would only inflate the record.
 */
function parseAliases(value: unknown, nameKey: string): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，;；/、|]/)
      : [];
  const seen = new Set<string>([nameKey]);
  const aliases: string[] = [];
  for (const item of items) {
    const alias = normalizeName(item);
    if (!alias) continue;
    const key = alias.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
    if (aliases.length >= MAX_ALIASES) break;
  }
  return aliases;
}

export interface CandidateParseContext {
  paperId: string;
  /** Page the analysed chunk started on, used when the model omits a page. */
  defaultPageNumber: number;
  chunkId?: string;
  chunkHeading?: string;
  /** Maximum evidence quotes kept per candidate. */
  maxEvidence?: number;
  /** Longest quote retained; longer quotes are truncated. */
  maxQuoteLength?: number;
  /**
   * Hard cap on candidates kept from one model response.
   *
   * The prompt deliberately states no quota — an "at most N" instruction is read as "give me N",
   * which is how a background-only section turns into filler entities. The ceiling therefore lives
   * here, where it is a truncation rather than an invitation: the most confident candidates are
   * kept and the rest are reported as trimmed, so the loss is visible instead of silent.
   */
  maxCandidates?: number;
}

export interface CandidateParseResult {
  candidates: ExtractedEntityCandidate[];
  /** Entries the parser refused, with the reason, for user-facing reporting. */
  rejected: Array<{ reason: string; raw: unknown }>;
}

function parseEvidence(
  value: unknown,
  context: CandidateParseContext,
): GraphEvidence[] {
  // A missing or non-array `evidence` field is treated as "the model gave no
  // quotes", NOT as "skip the fallback". Returning early here would leave the
  // candidate with an empty evidence array, and the graph's provenance promise
  // is that every edge points at a real page.
  const items = Array.isArray(value) ? value : [];
  const maxEvidence = context.maxEvidence ?? 3;
  const maxQuoteLength = context.maxQuoteLength ?? 200;
  const evidence: GraphEvidence[] = [];

  for (const item of items) {
    if (evidence.length >= maxEvidence) break;
    // Accept both {quote, pageNumber} objects and bare strings. The record is
    // annotated rather than inferred so the index signature is preserved for the
    // property lookups below.
    const record: Record<string, unknown> = isRecord(item)
      ? item
      : { quote: item };
    const quote = normalizeQuote(record.quote ?? record.text ?? record.evidence);
    if (!quote) continue;
    const pageValue = Number(record.pageNumber ?? record.page);
    const pageNumber = Number.isFinite(pageValue) && pageValue >= 1
      ? Math.round(pageValue)
      : context.defaultPageNumber;
    evidence.push({
      paperId: context.paperId,
      pageNumber,
      quote: quote.length > maxQuoteLength
        ? `${quote.slice(0, maxQuoteLength - 1)}…`
        : quote,
      ...(context.chunkId ? { chunkId: context.chunkId } : {}),
      ...(context.chunkHeading ? { chunkHeading: context.chunkHeading } : {}),
    });
  }

  // Quotes are the graph's provenance. If the model produced none, fall back to
  // the chunk's own location so the edge still points at a real page rather than
  // claiming evidence it does not have.
  if (!evidence.length) {
    evidence.push({
      paperId: context.paperId,
      pageNumber: context.defaultPageNumber,
      quote: '',
      ...(context.chunkId ? { chunkId: context.chunkId } : {}),
      ...(context.chunkHeading ? { chunkHeading: context.chunkHeading } : {}),
    });
  }

  return evidence;
}

/** Candidate array may be the payload itself or nested under a known key. */
function candidateArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  for (const key of ['entities', 'candidates', 'items', 'results', 'data']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/**
 * Parses a model response into candidates, deduplicating by normalized name.
 *
 * Duplicates are merged rather than dropped: the same method often appears in
 * several chunks, and the confirmed entity should carry all of those evidence
 * quotes plus the highest confidence seen.
 */
export function parseEntityCandidates(
  content: string,
  context: CandidateParseContext,
  /**
   * The **equality key** normalizer, injected so this module does not depend on the
   * normalization domain directly.
   *
   * Only ever used to decide whether two candidates are the same entity — never to
   * name one. Callers pass `normalizeEntityName`, which strips separators so that
   * `frequency-first heuristic` and `frequencyfirstheuristic` match; using its output
   * as the display name turned every extracted name into an unreadable
   * `frequencyfirstheuristic`. The displayed name is the model's own wording, with
   * whitespace collapsed (`displayName` below).
   */
  entityKeyOf: (name: unknown) => string,
): CandidateParseResult {
  const payload = extractJsonObject(content);
  const raw = candidateArray(payload);
  if (!raw) {
    return {
      candidates: [],
      rejected: [{ reason: '模型没有返回可解析的候选实体 JSON。', raw: content.slice(0, 200) }],
    };
  }

  const rejected: CandidateParseResult['rejected'] = [];
  const byKey = new Map<string, ExtractedEntityCandidate>();

  for (const entry of raw) {
    if (!isRecord(entry)) {
      rejected.push({ reason: '候选不是对象。', raw: entry });
      continue;
    }
    // Display name: the model's wording with runs of whitespace collapsed. Casing,
    // spaces and hyphens stay — they are what makes a name readable. (The parameter
    // above is deliberately *not* named `normalizeName`: it used to shadow this
    // function, which is how the key normalizer ended up in the display name.)
    const name = normalizeName(entry.name ?? entry.entity ?? entry.label);
    if (!name) {
      rejected.push({ reason: '候选缺少名称。', raw: entry });
      continue;
    }
    const type = normalizeType(entry.type ?? entry.category);
    if (!type) {
      rejected.push({ reason: `未知的实体类型：${String(entry.type ?? entry.category)}`, raw: entry });
      continue;
    }
    const confidence = clampConfidence(entry.confidence ?? entry.score);
    const evidence = parseEvidence(entry.evidence ?? entry.quotes, context);
    // Equality key only: two spellings of one entity must merge inside this batch.
    const key = entityKeyOf(name) || name.toLocaleLowerCase();
    const aliases = parseAliases(
      entry.aliases ?? entry.alias ?? entry.abbreviations ?? entry.otherNames,
      key,
    );

    const existing = byKey.get(key);
    if (existing) {
      // Keep the higher confidence and append only genuinely new quotes.
      existing.confidence = Math.max(existing.confidence, confidence);
      const seenQuotes = new Set(existing.evidence.map((item) => item.quote));
      for (const item of evidence) {
        if (item.quote && !seenQuotes.has(item.quote)) {
          existing.evidence.push(item);
          seenQuotes.add(item.quote);
        }
      }
      // Two chunks may each name a different abbreviation of the same entity.
      const known = new Set((existing.aliases ?? []).map((alias) => alias.toLocaleLowerCase()));
      for (const alias of aliases) {
        if (known.has(alias.toLocaleLowerCase())) continue;
        known.add(alias.toLocaleLowerCase());
        existing.aliases = [...(existing.aliases ?? []), alias].slice(0, MAX_ALIASES);
      }
      continue;
    }

    byKey.set(key, { name, type, confidence, evidence, ...(aliases.length ? { aliases } : {}) });
  }

  const parsed = [...byKey.values()];
  const cap = context.maxCandidates;
  if (cap && cap > 0 && parsed.length > cap) {
    const kept = [...parsed]
      .sort((left, right) => right.confidence - left.confidence
        || left.name.localeCompare(right.name))
      .slice(0, cap);
    const keptNames = new Set(kept.map((candidate) => candidate.name));
    const trimmed = parsed.filter((candidate) => !keptNames.has(candidate.name));
    for (const candidate of trimmed) {
      rejected.push({ reason: `候选数超过上限 ${cap}，已按置信度截断。`, raw: candidate.name });
    }
    return { candidates: kept, rejected };
  }

  return { candidates: parsed, rejected };
}

/** Candidate grouping for the confirmation UI, in a stable display order. */
export function groupCandidatesByType(
  candidates: readonly ExtractedEntityCandidate[],
): Array<{ type: EntityType; candidates: ExtractedEntityCandidate[] }> {
  const byType = new Map<EntityType, ExtractedEntityCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byType.get(candidate.type);
    if (bucket) bucket.push(candidate);
    else byType.set(candidate.type, [candidate]);
  }
  return ENTITY_TYPES
    .filter((type) => byType.has(type))
    .map((type) => ({
      type,
      candidates: [...(byType.get(type) ?? [])].sort(
        (left, right) => right.confidence - left.confidence
        || left.name.localeCompare(right.name),
      ),
    }));
}

/**
 * Whether a candidate should start checked in the confirmation dialog.
 *
 * High confidence is pre-checked; everything else is listed but unchecked, which
 * is the same conservative posture as the entity-alignment review band.
 */
export function shouldPreCheckCandidate(
  candidate: ExtractedEntityCandidate,
  minConfidenceToAutoCheck: number,
): boolean {
  return candidate.confidence >= minConfidenceToAutoCheck;
}
