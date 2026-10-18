import type { AiExplainEntitiesRequest, AiRuntimeResponse } from '../../ai/public';
import type { GraphEntity, GraphPaper } from '../contracts.ts';
import { extractJsonObject } from './candidate-parsing.ts';
import { normalizeEntityName } from '../domain/entity-normalization.ts';

/**
 * One-line meaning for a knowledge-graph entity, generated when the user puts it in the graph.
 *
 * The node label is a *name* — `Boyar-Peralta`, `ΔE >> 5%`, `GPT-3` — and a name alone does not tell
 * a reader what the node is doing in this corpus. The right panel is where a reader asks "what is
 * this?", so the answer belongs there, stored on the entity rather than recomputed per view: the
 * model's answer has to survive a reload and has to be the same answer every time it is read.
 *
 * Three constraints keep it cheap and honest:
 *
 * - **Only on the user's selection.** Confirmation is the moment a suggestion becomes part of the
 *   graph, and it is a deliberate per-entity act. Batch extraction stays silent: it proposes dozens
 *   of names the user may never accept, and paying to explain all of them would be paying for text
 *   nobody asked to read.
 * - **Grounded in the paper.** The prompt gets the abstract lead and the evidence quotes already
 *   stored on the entity (the sentence the extractor took the name from), and is told to explain the
 *   entity *as this paper uses it*, not as a dictionary would.
 * - **Failure is silent.** An explanation is a reading aid, never a correctness requirement: no API
 *   key, a timeout or a provider error must leave the confirmed entity exactly as it is.
 */

/** Version of the explanation contract, stored nowhere but useful when comparing runs. */
export const EXPLANATION_PROMPT_VERSION = 'entity-explanation-1';

/**
 * Entities per provider call.
 *
 * Each item is a name plus a quote or two, so a dozen is a small prompt; the cap exists because the
 * answer is JSON and a long list invites truncation, and a truncated answer loses *every* item.
 */
export const EXPLANATIONS_PER_CALL = 12;

/** Hard cap applied in code, not in the prompt: a stated quota reads as a target to fill. */
export const MAX_EXPLANATION_CHARACTERS = 60;

/** Quotes sent per entity. Two is enough to see how the paper uses the name. */
const MAX_QUOTES_PER_ENTITY = 2;

/** How much of the abstract each item carries; the panel text is short, so must be the input. */
const MAX_ABSTRACT_LEAD_CHARACTERS = 400;

/** Everything the message needs about one entity; the target adds the record id on top. */
export interface ExplanationMessageItem {
  name: string;
  type: string;
  aliases?: readonly string[];
  paperTitle: string;
  abstract?: string;
  quotes: readonly string[];
}

export interface ExplanationTarget extends ExplanationMessageItem {
  entityId: string;
  aliases: string[];
  abstract: string;
  quotes: string[];
}

/**
 * The system prompt.
 *
 * Asks for a *gloss*, not a definition: "what does this name refer to in this paper". A dictionary
 * definition of `BLEU` is useless in a reading aid; "本文用来对比的机器翻译评测指标" is the thing the
 * reader wanted, and only the paper can supply it.
 */
export function buildEntityExplanationPrompt(): string {
  return [
    '你是学术论文知识图谱的实体释义器。用户已经把这些实体确认进了图谱，请为每个实体写一句简短的中文解释。',
    '',
    '【写作要求】',
    '1. 一句话说明「它在这篇论文里指什么」：是什么、做什么用的。不要写百科式定义，不要重复名字本身。',
    '2. 必须依据给出的原文片段与摘要。原文里看不出它是什么时，宁可写得朴素，也不要编造年份、作者、数值或结论。',
    '3. 不超过 40 个字，不分点、不换行、不加引号、不用 Markdown。',
    '4. 保留原文里的英文术语与符号（如 "Boyar-Peralta"、"ΔE"），不要翻译成中文臆造词。',
    '',
    '【例子】',
    '- 名字 "Boyar-Peralta"，原文 "we compare against the Boyar-Peralta heuristic" → "本文用来对比的启发式电路优化方法"',
    '- 名字 "ΔE >> 5%"，原文 "the energy saving ΔE >> 5% is required" → "论文要求达到的节能幅度门槛"',
    '- 名字 "WMT 2014 English-to-German" → "论文评测翻译质量用的标准数据集"',
    '',
    '【输出格式】',
    '只输出 JSON，不要输出解释文字或代码块标记。',
    '格式：{"explanations":[{"name":"实体名字","explain":"一句中文解释"}]}',
    'name 必须与输入完全一致；不确定的实体请不要输出。',
  ].join('\n');
}

/** The user message: one compact block per entity. */
export function buildExplanationUserMessage(
  targets: readonly ExplanationMessageItem[],
): string {
  const items = targets.map((target) => {
    const lines = [`名字：${target.name}`, `类型：${target.type}`];
    const aliases = target.aliases ?? [];
    if (aliases.length) lines.push(`别名：${aliases.join('、')}`);
    if (target.paperTitle) lines.push(`论文：${target.paperTitle}`);
    if (target.abstract) lines.push(`摘要：${target.abstract}`);
    if (target.quotes.length) {
      lines.push('原文片段：');
      for (const quote of target.quotes) lines.push(`- ${quote}`);
    }
    return lines.join('\n');
  });
  return ['需要解释的实体：', items.join('\n\n')].join('\n\n');
}

/**
 * The system prompt for the **streaming, single-entity** path.
 *
 * A different contract from the batch prompt above, and deliberately so: streaming output is shown
 * in the panel as it arrives, and `{"explanations":[{"name":…` is not something a reader can watch.
 * So this one asks for the sentence and nothing else — no JSON, no label, no quotes — which is both
 * nicer to watch and cheaper: there is exactly one entity, so there is nothing to key.
 */
export function buildStreamingExplanationPrompt(): string {
  return [
    '你为学术论文知识图谱补写节点含义。用户只问一个实体。',
    '',
    '【要求】',
    '1. 只输出这一句中文解释本身：不要 JSON、不要引号、不要 Markdown、不要「解释：」这类前缀、不要换行。',
    '2. 一句话说明「它在这篇论文里指什么」，不超过 40 个字。不要写百科式定义，也不要重复名字本身。',
    '3. 依据给出的原文片段与摘要。原文看不出它是什么时，写得朴素一些，不要编造年份、作者、数值或结论。',
    '4. 保留原文里的英文术语与符号（如 "Boyar-Peralta"、"ΔE"），不要翻译成臆造的中文词。',
    '',
    '【例子】',
    '输入 "Boyar-Peralta" + 原文 "we compare against the Boyar-Peralta heuristic"',
    '输出：本文用来对比的启发式电路优化方法',
  ].join('\n');
}

/**
 * Turns a streamed answer into the one line that gets stored.
 *
 * Takes the first meaningful line, because a model told not to add a prefix still sometimes answers
 * with a heading or a "好的，"; and if it answers with JSON anyway (the batch prompt is a strong habit
 * for the same model), the explanation field is recovered instead of showing braces in the panel.
 */
export function normalizeStreamingExplanation(raw: string): string {
  // Fences first: a model that has been told "no Markdown" still sometimes wraps the line in one, and
  // the first non-empty line would then be the fence itself.
  const text = raw
    .trim()
    .replace(/^```(?:json|text|plaintext)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    const payload = extractJsonObject(text);
    if (payload) {
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { explanations?: unknown }).explanations)
          ? (payload as { explanations: unknown[] }).explanations
          : [payload];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        const recovered = normalizeExplanation(
          record.explain ?? record.explanation ?? record.description,
        );
        if (recovered) return recovered;
      }
      return '';
    }
  }
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find((line) => line.length > 0) ?? '';
  // A leading label like 「解释：」 is scaffolding, not content.
  return normalizeExplanation(firstLine.replace(/^(解释|含义|释义|说明)\s*[：:]\s*/, ''));
}

/**
 * Which entities need an explanation, and with what context.
 *
 * Read from the *entities themselves* wherever possible: the evidence quotes are already stored, so
 * the only extra input is the paper's abstract, which the caller supplies. Entities that already
 * carry an explanation are skipped — this runs on every confirmation, and re-asking for a name the
 * model already explained is spending tokens to get a differently-worded duplicate.
 */
export function planExplanationTargets(
  entities: readonly GraphEntity[],
  papers: readonly GraphPaper[],
  options: { names?: readonly string[]; force?: boolean; limit?: number } = {},
): ExplanationTarget[] {
  const wantedNames = options.names
    ? new Set(options.names.map((name) => normalizeEntityName(name)).filter(Boolean))
    : null;
  const papersById = new Map(papers.map((paper) => [paper.paperId, paper]));
  const limit = Math.max(1, options.limit ?? EXPLANATIONS_PER_CALL);

  const targets: ExplanationTarget[] = [];
  for (const entity of entities) {
    if (targets.length >= limit) break;
    if (entity.status !== 'confirmed') continue;
    if (wantedNames && !wantedNames.has(entity.normalizedName || normalizeEntityName(entity.name))) {
      continue;
    }
    if (!options.force && (entity.description ?? '').trim()) continue;

    const paper = papersById.get(entity.sourcePaperId);
    const quotes = dedupeQuotes(
      entity.evidence
        .filter((item) => item.paperId === entity.sourcePaperId || !item.paperId)
        .map((item) => item.quote),
    ).slice(0, MAX_QUOTES_PER_ENTITY);

    targets.push({
      entityId: entity.entityId,
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases,
      paperTitle: paper?.title ?? '',
      abstract: (paper?.abstract ?? '').trim().slice(0, MAX_ABSTRACT_LEAD_CHARACTERS),
      quotes,
    });
  }
  return targets;
}

function dedupeQuotes(quotes: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const quote of quotes) {
    const trimmed = quote.trim().replace(/\s+/g, ' ');
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

/** Trims a model answer to a single short line. */
export function normalizeExplanation(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Collapse and trim *before* stripping quotes: `  "文字" ` would otherwise keep both quotes,
  // because the anchored quote patterns only match at the very first and last character.
  const text = value
    .replace(/^```[\s\S]*?```$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'「『“”]+/, '')
    .replace(/["'」』“”]+$/, '')
    .trim();
  if (!text) return '';
  return text.length <= MAX_EXPLANATION_CHARACTERS
    ? text
    : `${text.slice(0, MAX_EXPLANATION_CHARACTERS - 1).trimEnd()}…`;
}

/**
 * Parses the model's answer into `entityId -> explanation`.
 *
 * Matching is by normalized name (the model is asked to echo the name verbatim, and the graph's own
 * normalization is what decides identity anyway). Anything unreadable is dropped rather than thrown:
 * a half-usable answer still explains some nodes, and an explanation is never load-bearing.
 */
export function parseEntityExplanations(
  content: string,
  targets: readonly ExplanationTarget[],
): Map<string, string> {
  const byNormalizedName = new Map(
    targets.map((target) => [normalizeEntityName(target.name), target] as const),
  );
  const result = new Map<string, string>();
  const payload = extractJsonObject(content);
  if (!payload) return result;

  // Three shapes reach here, all of them produced by real models: a bare array, `{explanations:[…]}`
  // (or `{entities:[…]}`), and a single bare row — the shared JSON extractor prefers the brace slice,
  // so `[{…}]` written inside prose arrives as one object.
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { explanations?: unknown }).explanations)
      ? (payload as { explanations: unknown[] }).explanations
      : Array.isArray((payload as { entities?: unknown }).entities)
        ? (payload as { entities: unknown[] }).entities
        : [payload];
  if (!Array.isArray(rows)) return result;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const rawName = typeof record.name === 'string'
      ? record.name
      : typeof record.entity === 'string' ? record.entity : '';
    const target = byNormalizedName.get(normalizeEntityName(rawName));
    if (!target) continue;
    const explanation = normalizeExplanation(
      record.explain ?? record.explanation ?? record.description,
    );
    if (!explanation) continue;
    result.set(target.entityId, explanation);
  }
  return result;
}

/**
 * Writes explanations onto the entity records.
 *
 * Returns only the records that actually changed, because they are written with `putEntities`: a
 * no-op rewrite of every entity in the graph would touch hundreds of rows to change none.
 */
export function attachEntityDescriptions(
  entities: readonly GraphEntity[],
  explanations: ReadonlyMap<string, string>,
  now = Date.now(),
): GraphEntity[] {
  if (!explanations.size) return [];
  const updated: GraphEntity[] = [];
  for (const entity of entities) {
    const description = explanations.get(entity.entityId);
    if (!description) continue;
    if ((entity.description ?? '') === description) continue;
    updated.push({ ...entity, description, descriptionUpdatedAt: now, updatedAt: now });
  }
  return updated;
}

export interface EntityExplanationPorts {
  requestExplanations(message: AiExplainEntitiesRequest): Promise<AiRuntimeResponse>;
}

export interface EntityExplanationRepository {
  listEntities(): Promise<GraphEntity[]>;
  putEntities(entities: GraphEntity[]): Promise<void>;
}

export interface EntityExplanationResult {
  /** Entities that received a new explanation in this run. */
  described: number;
  /** Entities the model did not answer for (or answered unusably). */
  missed: number;
  error?: string;
}

/**
 * Asks the model for explanations and writes them onto the entities.
 *
 * Never throws: the caller runs it right after a confirmation the user has already completed, so a
 * provider failure must not surface as if the confirmation had failed. The error is returned instead,
 * and the caller decides how quiet to be about it.
 */
export async function explainEntityDescriptions(
  options: {
    papers: readonly GraphPaper[];
    /** Restrict to these names (e.g. exactly the entities just confirmed). */
    names?: readonly string[];
    /** Re-ask even when an explanation already exists (the 「重新生成」 action). */
    force?: boolean;
    limit?: number;
    requestId?: string;
    signal?: AbortSignal;
  },
  ports: EntityExplanationPorts,
  repository: EntityExplanationRepository,
): Promise<EntityExplanationResult> {
  try {
    const entities = await repository.listEntities();
    const targets = planExplanationTargets(entities, options.papers, {
      ...(options.names ? { names: options.names } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    });
    if (!targets.length) return { described: 0, missed: 0 };

    options.signal?.throwIfAborted();
    const response = await ports.requestExplanations({
      type: 'pdf-helper:ai-explain-entities',
      requestId: options.requestId ?? `explanations:${Date.now()}`,
      items: targets.map((target) => ({
        name: target.name,
        type: target.type,
        ...(target.aliases.length ? { aliases: target.aliases } : {}),
        paperTitle: target.paperTitle,
        ...(target.abstract ? { abstract: target.abstract } : {}),
        quotes: target.quotes,
      })),
    });
    if (!response.ok) {
      return { described: 0, missed: targets.length, error: response.error ?? '解释生成请求失败。' };
    }

    const explanations = parseEntityExplanations(response.content ?? '', targets);
    const updated = attachEntityDescriptions(entities, explanations);
    if (updated.length) await repository.putEntities(updated);
    return { described: updated.length, missed: targets.length - updated.length };
  } catch (error) {
    return {
      described: 0,
      missed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One-line summary for the status bar. */
export function describeExplanationResult(result: EntityExplanationResult): string {
  if (result.error) return `实体解释没有生成（${result.error}）`;
  if (!result.described) return '';
  return `已为 ${result.described} 个实体生成解释，右侧面板可查看。`;
}
