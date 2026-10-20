/**
 * 在线元数据匹配：把「查回来的候选」变成「能不能拿来填」。
 *
 * 这一层没有网络、没有模型，只有判定规则。它是整条在线链路里唯一可能造成**错误数据**的地方——把 A 论文的 DOI 挂到
 * B 上，此后引用、相关论文、图谱全都跟着错，而且没人会去核对——所以规则必须可测、可解释，并且**宁可不填**：
 *
 * 1. 标题必须几乎一样（归一化后相同，或一方完整包含另一方，或字符二元组相似度 ≥ 0.9）；
 * 2. 并且要有一个独立佐证：年份相差 ≤ 1，或至少一位作者姓氏相同；
 * 3. 过不了就只是候选，不是建议；界面里绝不能把候选当成「找到了」。
 *
 * 判定的结果带上理由，面板据此显示「为什么没填」，用户也能自己判断该不该手填。
 */

/** One bibliographic record as a reference database returned it. */
export interface MetadataCandidate {
  source: 'crossref' | 'openalex';
  title: string;
  authors: string[];
  /** `2024` / `2024-01` / `2024-01-18`, already normalised by the caller. */
  publishDate: string;
  doi: string;
  documentUrl: string;
  /** Journal / proceedings name when the source knows it. */
  containerTitle: string;
  /** The source's own type (`journal-article`, `posted-content`, …), for the small print. */
  kind: string;
}

/** A candidate plus the gate's verdict. */
export interface MetadataSuggestion {
  candidate: MetadataCandidate;
  /** 0–1; see `titleSimilarity`. */
  titleSimilarity: number;
  /**
   * True only when the record may be offered as 「确认填入」.
   *
   * False candidates are still returned (capped) so the panel can say what it found and why it refused it.
   */
  accepted: boolean;
  /** Human-readable reason, shown in the panel; empty for an accepted suggestion. */
  reason: string;
}

/** The minimum similarity for a title match. Deliberately high: a near miss is a wrong paper. */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

/**
 * How long a title has to be before "this one is contained in that one" (or before it may be trusted at all).
 *
 * Chinese is why this cannot be one number: a full Chinese title is often ten characters, while eighteen *characters* of
 * English is barely three words. Counting each CJK character as a word-ish unit keeps the rule meaningful in both.
 */
const MIN_TRUSTED_TITLE_LENGTH = 18;
const MIN_TRUSTED_CJK_LENGTH = 9;

/** The effective length of a normalised title, with CJK characters counted per character (see above). */
export function titleWeight(value: string): number {
  const cjk = (value.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = value.replace(/[\u4e00-\u9fff]/g, '').replace(/\s+/g, '').length;
  return cjk + latin;
}

/** True when a title is long enough to be matched on. Exported so the gate and the containment rule agree. */
export function isTrustedTitle(value: string): boolean {
  const normalized = normalizeMatchTitle(value).replace(/\s+/g, '');
  if (!normalized) return false;
  const threshold = /[\u4e00-\u9fff]/.test(normalized)
    ? MIN_TRUSTED_CJK_LENGTH
    : MIN_TRUSTED_TITLE_LENGTH;
  return titleWeight(normalized) >= threshold;
}

/** Normalises a title for comparison: case, punctuation, spacing and full-width forms all go. */
export function normalizeMatchTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function charBigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, '');
  const bigrams = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }
  return bigrams;
}

/**
 * Sørensen–Dice similarity over character bigrams, 0–1.
 *
 * Character bigrams rather than words because titles are short and often hyphenated, and because this has to work for
 * Chinese titles too (where "words" are not separated). Near-identical titles score ≈1, a shared topic scores ≈0.3.
 */
export function titleSimilarity(left: string, right: string): number {
  const a = normalizeMatchTitle(left);
  const b = normalizeMatchTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // One title nested in the other is the common publisher-vs-preprint case ("… for Image Recognition" vs the subtitle).
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (longer.includes(shorter) && isTrustedTitle(shorter)) return 0.95;
  const leftGrams = charBigrams(a);
  const rightGrams = charBigrams(b);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of leftGrams) {
    total += count;
    shared += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  for (const count of rightGrams.values()) total += count;
  return total === 0 ? 0 : (2 * shared) / total;
}

/** A surname as it appears in the two databases: the last token of `Given Family`, or the whole CJK name. */
export function surnameKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.normalize('NFKC').slice(0, 2);
  const tokens = trimmed.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  return (tokens[tokens.length - 1] ?? '').toLocaleLowerCase();
}

/** The year a date string starts with, or 0 when it has none. */
export function yearOf(value: string): number {
  const match = value.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

function authorsAgree(left: readonly string[], right: readonly string[]): boolean {
  const rightSurnames = new Set(right.map(surnameKey).filter(Boolean));
  return left.some((name) => {
    const key = surnameKey(name);
    return Boolean(key) && rightSurnames.has(key);
  });
}

/**
 * Builds the query title from what we actually know.
 *
 * The overview's own title is the best input (it is the paper's real title, read by the model); the file name is the
 * fallback, cleaned of the parts that are file-system noise rather than title — extension, a leading year
 * (`2010-Boyar & Peralta-…`), and separator runs.
 */
export function buildLookupTitle(input: {
  overviewTitle?: string;
  documentName: string;
}): string {
  const fromOverview = (input.overviewTitle ?? '').trim();
  if (fromOverview.length >= MIN_TRUSTED_TITLE_LENGTH) return fromOverview;
  const base = input.documentName
    .replace(/\.pdf$/i, '')
    .replace(/^((?:19|20)\d{2})[-_.\s]+/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return fromOverview.length > base.length ? fromOverview : base;
}

/**
 * Decides, for each candidate, whether it may be offered as 「确认填入」.
 *
 * The two independent signals are deliberate: a title alone is not enough (two papers can share a title across
 * versions, and a near-identical title is exactly how a wrong DOI gets attached), and a year alone is meaningless
 * (thousands of papers share 2019). Requiring both means a candidate has to agree with us twice.
 */
export function evaluateMetadataCandidates(
  query: { title: string; authors?: readonly string[]; year?: number },
  candidates: readonly MetadataCandidate[],
): MetadataSuggestion[] {
  const seen = new Set<string>();
  const suggestions: MetadataSuggestion[] = [];
  const queryTitle = query.title.trim();
  const queryIsStrong = isTrustedTitle(queryTitle);
  const queryYear = query.year ?? 0;

  for (const candidate of candidates) {
    const similarity = titleSimilarity(queryTitle, candidate.title);
    // The same work can come back twice (Crossref and OpenAlex), so dedupe by DOI and by normalised title+year.
    const dedupeKey = candidate.doi
      ? `doi:${candidate.doi.toLocaleLowerCase()}`
      : `title:${normalizeMatchTitle(candidate.title)}|${yearOf(candidate.publishDate)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const reasons: string[] = [];
    const titleMatches = similarity >= TITLE_SIMILARITY_THRESHOLD;
    if (!titleMatches) {
      reasons.push(`标题相似度只有 ${(similarity * 100).toFixed(0)}%，不是同一篇`);
    } else if (!queryIsStrong) {
      // A three-word query matches too many papers to be trusted on its own; require an exact title instead.
      reasons.push('标题太短，无法据此确认是同一篇');
    }

    const candidateYear = yearOf(candidate.publishDate);
    const yearAgrees = queryYear > 0 && candidateYear > 0 && Math.abs(queryYear - candidateYear) <= 1;
    const authorAgrees = authorsAgree(query.authors ?? [], candidate.authors);
    if (!yearAgrees && !authorAgrees) {
      reasons.push(queryYear > 0 || (query.authors ?? []).length
        ? '年份和作者都对不上，无法确认是同一篇'
        : '没有年份或作者可以核对');
    }

    suggestions.push({
      candidate,
      titleSimilarity: similarity,
      accepted: reasons.length === 0,
      reason: reasons.join('；'),
    });
  }

  // Accepted first (highest similarity), then the rejected ones, best first — the panel shows at most three.
  return suggestions.sort((left, right) => (
    Number(right.accepted) - Number(left.accepted)
    || right.titleSimilarity - left.titleSimilarity
  ));
}
