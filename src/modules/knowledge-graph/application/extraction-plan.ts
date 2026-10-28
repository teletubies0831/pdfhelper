import type { AiEntityExtractionChunk } from '../../ai/public';

/**
 * Pure half of entity extraction: the prompt and the batching plan.
 *
 * Lives in the knowledge-graph module rather than next to the provider adapter
 * because these are graph concerns (what an entity is, how much text one call
 * may carry), and because the background service worker cannot be unit tested
 * here — anything that lives there is verified only by a real browser run.
 */

/** Entity types the graph stores, with the hints that disambiguate them. */
export const EXTRACTION_ENTITY_TYPES = [
  'Method',
  'Task',
  'Dataset',
  'Metric',
  'Concept',
  'Claim',
] as const;

/**
 * Character budget for one provider call.
 *
 * Paper chunks are ~9000 characters (`document-chunker` paper strategy), so this
 * fits three of them plus the prompt while staying well inside the 120 s provider
 * timeout. A large batch is also a large blast radius when the worker is killed.
 */
export const EXTRACTION_MAX_INPUT_CHARACTERS = 30_000;

/** Chunks per provider call. */
export const EXTRACTION_CHUNKS_PER_CALL = 3;

/** Default hard cap on candidates kept per model response; the main token-cost lever. */
export const DEFAULT_MAX_CANDIDATES_PER_CHUNK = 12;

/**
 * Version of the extraction contract.
 *
 * - `entity-extraction-2` added `aliases`.
 * - `entity-extraction-3` rewrote the prompt around "宁缺毋滥" with positive/negative examples,
 *   after real runs produced generic words and padding candidates: a numeric quota in the prompt
 *   ("每个片段最多 12 个") invited the model to fill it. The cap now lives in code as a hard
 *   truncation instead of an instruction, which removes the incentive without losing the ceiling.
 * - `entity-extraction-4` names two failure shapes that survived the rewrite — table fragments
 *   (`b l cost`, `Table 3`) and descriptive noun phrases (`XOR3 (b2) Support for …`) — and stops
 *   inviting low-confidence output: the closing line now says "do not output it at all" instead of
 *   "give it a low score but do not omit it", which had been an instruction to pad the list.
 */
export const EXTRACTION_PROMPT_VERSION = 'entity-extraction-4';

/**
 * The extraction system prompt.
 *
 * Deliberately states **no numeric quota**: a "at most N" instruction is read as "produce N", and
 * that is how a paper's Introduction turns into filler entities. The ceiling is enforced in
 * `parseEntityCandidates` (top-N by confidence) where it cannot be mistaken for a target, and
 * "宁缺毋滥 / return []" is stated explicitly because an empty answer has to be a legal answer.
 */
export function buildEntityExtractionPrompt(): string {
  return [
    '你是一个专业的学术文献信息抽取引擎。你的任务是从给定的论文片段中，抽取构建知识图谱所需的核心知识实体。',
    '',
    '【实体类型】（只能用以下六个英文枚举值）：',
    '- Method：具体的方法、模型、算法、架构（不要抽取“深度学习”、“模型”这种泛词）',
    '- Task：具体的研究任务或问题设定（如“关系抽取”、“分子性质预测”）',
    '- Dataset：具体的数据集、语料库、基准集合（如“ImageNet”、“WMT14”）',
    '- Metric：具体的评价指标（如“BLEU”、“F1-score”）',
    '- Concept：抽象的概念、理论、机制（不是具体的方法，如“注意力机制”、“小样本学习”）',
    '- Claim：论文明确给出的、包含具体发现的结论性主张（必须有具体的对象和结果，不要抽取“本文提出了一个框架”这种废话）',
    '',
    '【抽取规则】',
    '1. 宁缺毋滥：只抽取在这段文本中真正具有区分度的实体。如果某个片段全是废话或背景介绍，请返回空数组 []，绝对不要为了凑数而抽取。',
    '2. 证据支撑：每个实体必须附带原文中逐字摘录的证据（quote），quote 必须包含该实体名称，且不超过 60 字。',
    '3. 标准命名：使用论文中的标准全称。如果在同一片段中出现了缩写或别名，请填入 aliases 数组。',
    '4. 去重：同一实体只出现一次。',
    '5. 名称必须是“名字”，不是“描述”：只填实体本身的名称，不要把一个动作或用途拼进去。',
    '',
    '【正例参考】',
    '- 好的 Method："Transformer"（证据："we propose the Transformer, based solely on attention mechanisms"）',
    '- 好的 Dataset："WMT 2014 English-to-German"（证据："on the WMT 2014 English-to-German translation task"）',
    '- 好的 Claim："Transformer achieves 28.4 BLEU on WMT 2014"（证据："Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task"）',
    '- 好的 Concept："Self-Attention"（证据："Self-attention, sometimes called intra-attention"）',
    '',
    '【反例参考】（绝对不要抽取这些）',
    '- 泛词："Deep Learning", "Neural Network", "Model", "Method", "Data"',
    '- 描述性短语："The experimental results show that", "In this paper, we"',
    '- 图表碎片：表格或图注里的碎片标签，如 "b l cost"、"Table 3"、"Fig. 2"、"XOR2:2:1"，'
      + '以及只有字母加数字的编号（"XOR2"、"d1"）；这些是排版残留，不是概念。',
    '- 描述性长句：把用途或动作拼进名字的短语，如 "XOR3 (b2) Support for Boyar-Peralta Algorithm"、'
      + '"a method based on X"、"the proposed flow achieves …"；'
      + '若某实体只以这种形式出现，请只抽它真正的名字（如 "Boyar-Peralta Algorithm"），抽不到合适的名字就不要抽。',
    '',
    '【输出格式】',
    '只输出 JSON，不要输出任何解释或 Markdown 代码块标记。',
    '格式：{"entities":[{"name":"...","type":"Method","confidence":0.9,"aliases":["另一种写法"],'
      + '"evidence":[{"quote":"...","pageNumber":3}]}]}',
    'confidence 取 0 到 1；不确定的候选请不要输出，绝对不要为了凑数而输出低分项。',
  ].join('\n');
}

export interface ExtractionBatch {
  chunkIds: string[];
  /** Pre-rendered chunk text, including page and heading labels. */
  prompt: string;
}

function pageLabel(chunk: AiEntityExtractionChunk): string {
  return chunk.startPage === chunk.endPage
    ? `第 ${chunk.startPage} 页`
    : `第 ${chunk.startPage}-${chunk.endPage} 页`;
}

export interface ExtractionUserMessageInput {
  paperTitle: string;
  documentName: string;
  /** The paper's abstract, when one is known; empty or missing means "omit the block". */
  abstract?: string;
  /** The pre-rendered chunk text for this batch. */
  batch: string;
}

/**
 * How much of a document overview is sent when no abstract exists.
 *
 * Enough to state what the paper does and how; short enough that it cannot crowd out the chunks
 * being extracted, and that it stays a single cheap paragraph on every batch.
 */
export const MAX_OVERVIEW_LEAD_CHARACTERS = 600;

/**
 * Turns a generated document overview into something shaped like an abstract.
 *
 * Most local PDFs have no bibliographic abstract — the reading-history record only ever carried a
 * title — so "inject the abstract" would silently do nothing for exactly the papers being extracted.
 * The knowledge base's overview is the fallback: it is generated from the full text for the papers
 * that were indexed, and its first paragraph is a statement of what the paper does, which is the
 * framing the extraction window is missing.
 */
export function overviewLeadAsAbstract(
  markdown: string,
  limit = MAX_OVERVIEW_LEAD_CHARACTERS,
): string {
  const text = markdown
    // Markdown scaffolding reads as noise inside a prompt: headings, bullets, emphasis.
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  // Prefer a word boundary; a hard cut is still better than dropping the summary entirely.
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The user message for one batch.
 *
 * The abstract leads, because a call only ever sees three chunks: without it a background paragraph
 * in the Introduction is indistinguishable from the paper's own contribution, which is how a
 * reference method ends up recorded as this paper's `Method`. A paper with no abstract simply has no
 * such block — an empty `论文摘要：` line would invite the model to invent one.
 */
export function buildExtractionUserMessage(input: ExtractionUserMessageInput): string {
  const abstract = input.abstract?.trim() ?? '';
  return [
    `论文标题：${input.paperTitle}`,
    ...(abstract ? [`论文摘要：${abstract}`] : []),
    `文档：${input.documentName}`,
    '正文片段：',
    input.batch,
  ].join('\n\n');
}

/**
 * Splits chunks into batches that each fit one provider call.
 *
 * Batching is by chunk identity rather than naive concatenation so a failed batch
 * maps back to specific chunks and a retry re-sends the same grouping. The plan is
 * deterministic for identical input, which the persisted cursor depends on.
 */export function planExtractionBatches(
  chunks: readonly AiEntityExtractionChunk[],
  maxCharacters = EXTRACTION_MAX_INPUT_CHARACTERS,
  chunksPerCall = EXTRACTION_CHUNKS_PER_CALL,
): ExtractionBatch[] {
  const batches: ExtractionBatch[] = [];
  let current: AiEntityExtractionChunk[] = [];
  let currentCharacters = 0;

  const flush = (): void => {
    if (!current.length) return;
    batches.push({
      chunkIds: current.map((chunk) => chunk.chunkId),
      prompt: current
        .map((chunk) => {
          const heading = chunk.heading?.trim() ? `（${chunk.heading.trim()}）` : '';
          return `[${pageLabel(chunk)}${heading}]\n${chunk.text}`;
        })
        .join('\n\n'),
    });
    current = [];
    currentCharacters = 0;
  };

  for (const chunk of chunks) {
    const size = chunk.text.length;
    if (current.length && (current.length >= chunksPerCall
      || currentCharacters + size > maxCharacters)) {
      flush();
    }
    current.push(chunk);
    currentCharacters += size;
  }
  flush();

  return batches;
}

/**
 * 单篇文献参与抽取的分块上限.
 *
 * A 200-page book produces ~70 chunks, i.e. ~23 provider calls for one document — minutes of waiting and a bill to match,
 * for a text whose entity density per page is a fraction of a paper's (trade books, indexes, appendices, bibliographies).
 * The budget keeps a paper (and a chapter-length report) fully covered while turning a book into a representative sample.
 */
export const MAX_EXTRACTION_CHUNKS_PER_PAPER = 96;

/**
 * 首尾保留的块数：开头一定是摘要/引言/方法，抽样不能把它们丢掉.
 *
 * The opening chunks are where a paper states its contribution and its method; sampling evenly across the whole document
 * would leave the extraction with three mid-paper results discussions and no idea what the paper proposes.
 */
export const EXTRACTION_LEAD_CHUNKS = 12;

export interface ExtractionChunkSelection {
  /** 实际送去抽取的分块（顺序不变）。 */
  chunks: AiEntityExtractionChunk[];
  totalChunks: number;
  usedChunks: number;
  /** 是否发生了抽样（`usedChunks < totalChunks`）。 */
  sampled: boolean;
}

/**
 * 选出参与抽取的分块：先保开头，再在其余部分均匀取样.
 *
 * Deterministic on purpose (no randomness): the job fingerprint is built from the selected chunk ids, so the same document
 * must always produce the same selection, or every run would look like a change and re-spend tokens.
 */
export function selectExtractionChunks(
  chunks: readonly AiEntityExtractionChunk[],
  budget = MAX_EXTRACTION_CHUNKS_PER_PAPER,
): ExtractionChunkSelection {
  const totalChunks = chunks.length;
  if (budget <= 0 || totalChunks <= budget) {
    return { chunks: [...chunks], totalChunks, usedChunks: totalChunks, sampled: false };
  }
  const lead = Math.min(EXTRACTION_LEAD_CHUNKS, budget, totalChunks);
  const picked = new Set<number>();
  for (let index = 0; index < lead; index += 1) picked.add(index);
  const remaining = budget - lead;
  const tail = chunks.length - lead;
  for (let step = 0; step < remaining; step += 1) {
    // 均匀落在 (lead, total) 的剩余区间上，四舍五入后去重；剩余量与容量相等时正好全部覆盖。
    const ratio = (step + 0.5) / remaining;
    const index = Math.min(chunks.length - 1, lead + Math.floor(ratio * tail));
    picked.add(index);
  }
  const selected = [...picked].sort((left, right) => left - right).map((index) => chunks[index]!);
  return { chunks: selected, totalChunks, usedChunks: selected.length, sampled: true };
}
