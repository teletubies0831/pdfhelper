import type { AiJudgeRelationsRequest, AiRuntimeResponse } from '../../ai/public';
import type { GraphEdge, GraphEntity, GraphPaper } from '../contracts.ts';
import { estimateJudgementTokens } from './relation-recall.ts';
import {
  buildSelectedCandidatePairs,
  recallCandidatePairs,
  selectTopKForJudgement,
} from './relation-recall.ts';
import type { RelationCandidatePair } from './relation-recall.ts';
import {
  planBridgeEntityWrites,
  planManualBridgeWrites,
  type ManualBridgeInput,
} from './bridge-entities.ts';
import {
  buildJudgementReviewRows,
  filterAcceptedJudgements,
  parseRelationJudgementBatches,
  parseRelationJudgements,
  planRelationJudgementWrites,
  RELATION_PROMPT_VERSION,
  type JudgementReviewRow,
  type RelationParseResult,
} from './relation-judgement.ts';
import {
  emptyBridgeDrops,
  type BridgeDropStats,
} from './relation-bridges.ts';

/**
 * Relation judgement orchestration.
 *
 * Lives in the module rather than the viewer feature because it is pure
 * coordination over module primitives plus an injected transport — nothing here
 * touches the DOM, the reader, or IndexedDB. That placement is also what makes it
 * testable: files under `src/viewer/features/` import the module barrel, which
 * Node cannot resolve, so contract tests can never execute them.
 *
 * The sequence is recall (free) -> quote a price -> ask -> persist. The quote step
 * is not decoration: this is the only feature in the plugin that spends tokens on
 * the user's behalf without them typing a message, so the cost is shown and
 * confirmed *before* anything is sent, and a run with nothing to do reports that
 * for free rather than making a pointless call.
 */

export interface RelationAnalysisPorts {
  /** Sends the batched judgement request to the background. */
  requestJudgement(message: AiJudgeRelationsRequest): Promise<AiRuntimeResponse>;
  listEdges(): Promise<GraphEdge[]>;
  /** Writes the conclusions and retires superseded ones. */
  applyRelationPlan(plan: { edges: GraphEdge[]; dropOriginKeys: string[] }): Promise<number>;
  /**
   * Entities, edges and retirements in one transaction.
   *
   * Used when the run also writes bridge concepts: a bridge entity, its `MENTIONS` edges and the
   * relation edges must land together, or a half-applied run shows a node with one edge.
   */
  applyEntityPlan?(plan: {
    entities: GraphEntity[];
    edges: GraphEdge[];
    dropOriginKeys: string[];
  }): Promise<number>;
  listEntities?(): Promise<GraphEntity[]>;
  /**
   * Verbatim excerpt per paper (bibliographic abstract, else the knowledge base overview lead).
   *
   * Required for bridges: the quotes the model returns are checked against exactly this text, so
   * "the concept is real" is a verified fact rather than a claim. Without it the run still judges
   * relations; it just cannot accept bridges.
   */
  loadExcerpts?(paperIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Optional cached embeddings, keyed by paper id. */
  loadVectors?(): Promise<ReadonlyMap<string, readonly number[]> | null>;
}

export interface RelationPreview {
  candidates: RelationCandidatePair[];
  /** What the model will actually be asked about, after Top-K. */
  selected: RelationCandidatePair[];
  estimatedTokens: number;
  /** True when the funnel surfaced nothing because the cache already answers. */
  skippedAlreadyJudged: boolean;
}

export interface RelationAnalysisResult {
  status: 'done' | 'nothing-to-do' | 'cancelled' | 'discarded' | 'failed';
  reason?: string;
  judgedPairs: number;
  relationsFound: number;
  negativeVerdicts: number;
  /** Pairs the model never answered; not cached, so a retry re-asks them. */
  unansweredPairs: number;
  edgesWritten: number;
  failedBatches: number;
  /** Verdicts the model produced that the user declined to write. */
  discardedPairs: number;
  /** Bridge concepts the user accepted and that were newly created. */
  bridgesCreated: number;
  /** Accepted bridge concepts that landed on an entity that already existed. */
  bridgesReused: number;
  /** Nodes the user typed in place of a `NONE` verdict. */
  manualNodes: number;
  /** Bridge suggestions refused by the local checks, by reason. */
  bridgeDrops: BridgeDropStats;
}

/** What `onJudged` is shown before anything is written. */
export interface RelationJudgementReview {
  rows: JudgementReviewRow[];
  /** Model that produced the verdicts, when the provider reported one. */
  model?: string;
  /** Verdicts that could not be parsed, for honesty about what was dropped. */
  rejectedCount: number;
  /** Why they were dropped, in the parser's words (`未知的关系类型：CONTRASTS`). */
  rejectedReasons?: string[];
  /** Bridge suggestions the local checks refused, so the dialog can say how many. */
  bridgeDrops: BridgeDropStats;
}

/**
 * What the review decided.
 *
 * `'accept-all'` keeps every verdict and every bridge; the object form is the per-row decision the
 * dialog actually produces; `null` means the review was dismissed without a decision, which is treated
 * as **declining to write** (see the note on `onJudged`).
 *
 * Bridges are keyed separately because they are separately tickable: the user can accept "A extends B"
 * and still refuse the concept the model proposed to illustrate it.
 */
export interface RelationReviewAcceptance {
  acceptedPairKeys: ReadonlySet<string>;
  /** Bridge keys the user kept; absent means every bridge of an accepted pair. */
  acceptedBridgeKeys?: ReadonlySet<string>;
  /** Nodes the user typed in place of a refused `NONE`. Always written. */
  manualBridges?: readonly ManualBridgeInput[];
}

export type RelationJudgementDecision =
  | 'accept-all'
  | RelationReviewAcceptance
  | null;

/**
 * True only when the cache is genuinely the reason nothing was recalled.
 *
 * A barren corpus and a fully judged one both produce zero candidates, but they
 * are different situations and telling the user "already cached, no tokens spent"
 * when the real cause is "these papers share no signal" is simply wrong — it
 * would suggest the analysis had been done when it never ran. The discriminator:
 * with no paper-to-paper conclusions recorded at all, nothing can be cached.
 */
export function isFullyJudged(
  papers: readonly GraphPaper[],
  edges: readonly GraphEdge[],
  candidateCount: number,
): boolean {
  if (papers.length < 2 || candidateCount > 0) return false;
  return edges.some((edge) => edge.sourceKind === 'paper' && edge.targetKind === 'paper');
}

/**
 * Builds the preview shown before spending anything.
 *
 * The caller distinguishes "already judged" from "no signal at all" using
 * `skippedAlreadyJudged`, so a run with nothing to do can say *why* — which is
 * the difference between a trustworthy no-op and an unexplained one.
 */
/**
 * Shown when recall came up empty while the graph still holds unconfirmed
 * entities.
 *
 * The most common real cause of an empty recall is exactly this: shared entities
 * are the strongest recall signal, and only *confirmed* entities count, so a
 * corpus full of pending candidates recalls nothing. Saying only "no signal"
 * would leave the user with no next step.
 */
export const PENDING_ENTITY_HINT = '提示：图谱中有未确认的实体，确认它们可以提升关系召回率。';

function withPendingEntityHint(reason: string, pendingEntityCount: number | undefined): string {
  return pendingEntityCount && pendingEntityCount > 0 ? `${reason}${PENDING_ENTITY_HINT}` : reason;
}

export async function previewRelationAnalysis(
  papers: readonly GraphPaper[],
  ports: RelationAnalysisPorts,
  options: {
    topK: number;
    maxCandidates: number;
    entityNames?: ReadonlyMap<string, string>;
    /** Pairs the user asked to judge again, even though a conclusion is cached. */
    forcePairs?: ReadonlySet<string>;
    /**
     * Papers the user picked by hand.
     *
     * Present means "judge exactly these": every pair among them is a candidate, the score floor and
     * Top-K are skipped (the selection *is* the decision), and only the already-judged cache still
     * applies — a pair with a recorded conclusion is not paid for twice.
     */
    paperIds?: readonly string[];
    /** Count the pairs of already-judged papers as skipped instead of dropping them silently. */
    forceJudged?: boolean;
  },
): Promise<RelationPreview> {
  const [edges, vectors] = await Promise.all([
    ports.listEdges(),
    ports.loadVectors ? ports.loadVectors() : Promise.resolve(null),
  ]);
  const explicitSelection = Boolean(options.paperIds && options.paperIds.length >= 2);
  if (explicitSelection) {
    const selected = buildSelectedCandidatePairs(papers, edges, options.paperIds!, {
      entityNames: options.entityNames,
      skipJudged: options.forceJudged !== true,
    });
    const estimate = estimateJudgementTokens(selected);
    return {
      candidates: selected,
      selected,
      estimatedTokens: estimate.total,
      // An explicit selection that came back empty was answered by the cache, not by a lack of signal.
      skippedAlreadyJudged: selected.length === 0,
    };
  }
  const candidates = recallCandidatePairs(papers, edges, {
    maxCandidates: options.maxCandidates,
    entityNames: options.entityNames,
    ...(options.forcePairs ? { forcePairs: options.forcePairs } : {}),
    ...(vectors ? { vectors } : {}),
  });
  // A forced pair is an explicit request for that one pair, so the Top-K cost
  // ceiling — which governs *unrequested* recall — must not trim it away.
  const selected = options.forcePairs?.size
    ? candidates.filter((pair) => options.forcePairs!.has(pair.pairKey))
    : selectTopKForJudgement(candidates, options.topK);
  const estimate = estimateJudgementTokens(selected);
  return {
    candidates,
    selected,
    estimatedTokens: estimate.total,
    skippedAlreadyJudged: isFullyJudged(papers, edges, candidates.length),
  };
}

export interface RunRelationAnalysisOptions {
  papers: readonly GraphPaper[];
  topK: number;
  maxCandidates: number;
  entityNames?: ReadonlyMap<string, string>;
  /**
   * Pairs to judge despite a cached conclusion.
   *
   * Set by the 「重新判断」 action in the edge inspector: a stored conclusion is
   * also the cache, so without this the same pair could never be asked about
   * again and a wrong verdict would be permanent. When present the run judges
   * exactly these pairs and nothing else.
   */
  forcePairs?: ReadonlySet<string>;
  /**
   * Papers the user ticked in the picker.
   *
   * Replaces the recall funnel entirely: every pair among the selected papers is judged, up to
   * `MAX_SELECTED_PAPERS`. The selection is the user's decision about *what* to analyse, which is the
   * question the score floor and Top-K exist to answer.
   */
  paperIds?: readonly string[];
  /** Judge selected pairs again even when a conclusion is cached. */
  forceJudged?: boolean;
  /** Unconfirmed entity count, used only to explain an empty recall. */
  pendingEntityCount?: number;
  signal?: AbortSignal;
  /** Returns false to decline after seeing the estimate. */
  onPreview?: (preview: RelationPreview) => Promise<boolean>;
  /**
   * Sees the parsed verdicts before they are written, and decides what to keep.
   *
   * Writing is the irreversible half: a stored conclusion is also the *cache*, so a
   * verdict the user never saw can never be re-asked about. The hook therefore runs
   * between parsing and planning, and a dismissal (`null`) declines to write rather
   * than accepting on the user's behalf — the tokens are spent either way, but an
   * un-reviewed claim is not something to make permanent by default.
   */
  onJudged?: (review: RelationJudgementReview) => Promise<RelationJudgementDecision>;
  onProgress?: (message: string) => void;
  model?: string;
  requestId?: string;
}

export async function runRelationAnalysis(
  ports: RelationAnalysisPorts,
  options: RunRelationAnalysisOptions,
): Promise<RelationAnalysisResult> {
  const empty: RelationAnalysisResult = {
    status: 'nothing-to-do',
    judgedPairs: 0,
    relationsFound: 0,
    negativeVerdicts: 0,
    unansweredPairs: 0,
    edgesWritten: 0,
    failedBatches: 0,
    discardedPairs: 0,
    bridgesCreated: 0,
    bridgesReused: 0,
    manualNodes: 0,
    bridgeDrops: emptyBridgeDrops(),
  };

  if (options.papers.length < 2) {
    return { ...empty, reason: '至少需要两篇文献才能判断关系。' };
  }

  const preview = await previewRelationAnalysis(options.papers, ports, {
    topK: options.topK,
    maxCandidates: options.maxCandidates,
    entityNames: options.entityNames,
    ...(options.forcePairs ? { forcePairs: options.forcePairs } : {}),
    ...(options.paperIds ? { paperIds: options.paperIds } : {}),
    ...(options.forceJudged ? { forceJudged: true } : {}),
  });

  if (!preview.selected.length) {
    return {
      ...empty,
      reason: withPendingEntityHint(
        preview.skippedAlreadyJudged
          ? options.paperIds
            ? '选中的文献之间都已经有结论了，本次不消耗 Token。可在边上用「重新判断」单独重判。'
            : '没有新的可判断论文对：已有结论都已缓存，本次不消耗 Token。'
          : '没有召回任何值得判断的论文对（缺少共享实体、同文件夹或向量相似等线索）。',
        options.pendingEntityCount,
      ),
    };
  }

  // The price is quoted before the request is built, so a user who declines has
  // spent nothing at all.
  if (options.onPreview) {
    const proceed = await options.onPreview(preview);
    if (!proceed) {
      return { ...empty, status: 'cancelled', reason: '已取消，未发送任何请求。' };
    }
  }

  options.signal?.throwIfAborted();
  options.onProgress?.(`正在判断 ${preview.selected.length} 对论文的关系…`);

  // The excerpts are fetched *before* the request because they are part of it: the model is asked to
  // quote from them, and the quotes are verified against the same text afterwards.
  const paperIds = [...new Set(
    preview.selected.flatMap((pair) => [pair.leftPaperId, pair.rightPaperId]),
  )];
  const excerpts = await loadExcerpts(options.papers, ports, paperIds);

  const response = await ports.requestJudgement({
    type: 'pdf-helper:ai-judge-relations',
    requestId: options.requestId ?? `relations:${Date.now()}`,
    papers: paperIds.map((paperId) => {
      const paper = options.papers.find((candidate) => candidate.paperId === paperId);
      return {
        paperId,
        title: paper?.title ?? paperId,
        excerpt: excerpts.get(paperId) ?? '',
      };
    }),
    pairs: preview.selected.map((pair) => ({
      pairKey: pair.pairKey,
      leftPaperId: pair.leftPaperId,
      rightPaperId: pair.rightPaperId,
      leftTitle: pair.leftTitle,
      rightTitle: pair.rightTitle,
      sharedEntities: pair.sharedEntityNames,
      recallReasons: pair.recallReasons,
    })),
  });

  if (!response.ok) {
    return {
      ...empty,
      status: 'failed',
      reason: response.error ?? '关系判断请求失败。',
    };
  }

  // One answer per batch: parsing the concatenation of two JSON documents fails, which made every selection above five
  // pairs look like an unreadable model answer. `content` remains the fallback for a single-answer transport.
  const contents = response.relationJudgement?.contents?.length
    ? response.relationJudgement.contents
    : [response.content ?? ''];
  const parsedRaw = parseRelationJudgementBatches(contents, preview.selected, {
    model: options.model ?? response.model,
    excerpts,
  });

  const reviewed = options.onJudged
    ? await reviewJudgements(parsedRaw, options.onJudged, options.model ?? response.model)
    : {
      parsed: parsedRaw,
      discardedPairKeys: [] as string[],
      manualBridges: [] as readonly ManualBridgeInput[],
    };

  const keptNothing = !reviewed.parsed.relations.length && !reviewed.parsed.explicitNone.length;
  // Only a review that actually *dropped* something may report a declined write.
  // When the model produced no usable verdict at all (every batch failed, or the
  // answer was unreadable), the run must fall through and report that instead —
  // telling the user they declined a batch they never saw would blame them for a
  // provider failure. Manual nodes are the user's own writing, so they are written
  // even when every verdict was dropped.
  if (keptNothing && reviewed.discardedPairKeys.length && !reviewed.manualBridges.length) {
    return {
      ...empty,
      status: 'discarded',
      judgedPairs: 0,
      // The model's verdicts were dropped, so nothing is cached and a later run
      // will ask about these pairs again — which is why the copy says so.
      unansweredPairs: parsedRaw.unansweredPairKeys.length,
      failedBatches: response.relationJudgement?.failedBatches.length ?? 0,
      discardedPairs: reviewed.discardedPairKeys.length,
      bridgeDrops: parsedRaw.bridgeDrops,
      reason: '已放弃写入本次全部结论：图谱未改动，这些论文对下次会重新判断（会再次消耗 Token）。',
    };
  }

  options.onProgress?.('正在保存关系结论…');
  const edges = await ports.listEdges();
  const relationPlan = planRelationJudgementWrites(reviewed.parsed, edges);

  // Bridges and manual nodes are entities, so they need the entity side of the graph.
  const entities = ports.listEntities ? await ports.listEntities() : [];
  const bridgePlan = planBridgeEntityWrites(reviewed.parsed.bridges, entities, {
    promptVersion: RELATION_PROMPT_VERSION,
  });
  const manualPlans = reviewed.manualBridges.map((input) => (
    planManualBridgeWrites(input, [...entities, ...bridgePlan.entities], edges)
  ));
  const manualNodes = manualPlans.filter((plan) => plan.entities.length).length;
  const rejectedManual = manualPlans.find((plan) => plan.rejectedReason)?.rejectedReason;

  const entityWrites = {
    entities: [...bridgePlan.entities, ...manualPlans.flatMap((plan) => plan.entities)],
    edges: [...bridgePlan.edges, ...manualPlans.flatMap((plan) => plan.edges)],
    dropOriginKeys: [
      ...relationPlan.dropOriginKeys,
      ...manualPlans.flatMap((plan) => plan.dropOriginKeys),
    ],
  };
  const hasEntityWrites = entityWrites.entities.length > 0 || entityWrites.edges.length > 0;

  let edgesWritten: number;
  if (hasEntityWrites && ports.applyEntityPlan) {
    // One transaction for both halves: a bridge entity whose edges did not land would be an orphan
    // node on the canvas, and a retired `NO_RELATION` without its replacement would lose a decision.
    edgesWritten = await ports.applyEntityPlan({
      ...entityWrites,
      edges: [...relationPlan.edges, ...entityWrites.edges],
      dropOriginKeys: [...new Set(entityWrites.dropOriginKeys)],
    });
  } else {
    edgesWritten = await ports.applyRelationPlan(relationPlan);
  }

  return {
    status: 'done',
    judgedPairs: reviewed.parsed.relations.length + reviewed.parsed.explicitNone.length,
    relationsFound: reviewed.parsed.relations.length,
    negativeVerdicts: reviewed.parsed.explicitNone.length,
    // Reported rather than hidden: these pairs are NOT cached, so a retry will
    // legitimately ask about them again.
    unansweredPairs: reviewed.parsed.unansweredPairKeys.length,
    edgesWritten,
    failedBatches: response.relationJudgement?.failedBatches.length ?? 0,
    discardedPairs: reviewed.discardedPairKeys.length,
    bridgesCreated: bridgePlan.createdEntityIds.length,
    bridgesReused: bridgePlan.reusedEntityIds.length,
    manualNodes,
    bridgeDrops: parsedRaw.bridgeDrops,
    ...(rejectedManual ? { reason: rejectedManual } : {}),
  };
}

/**
 * Excerpt per paper: the bibliographic abstract, else the knowledge base's overview lead.
 *
 * Only the port knows how to reach the knowledge base, so it is asked first; the paper projection is
 * the fallback that always exists. A paper with neither simply has an empty excerpt, and then no bridge
 * quote can be verified against it — which is the honest outcome, not a reason to skip judging.
 */
async function loadExcerpts(
  papers: readonly GraphPaper[],
  ports: RelationAnalysisPorts,
  paperIds: readonly string[],
): Promise<Map<string, string>> {
  const loaded = ports.loadExcerpts
    ? await ports.loadExcerpts(paperIds).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const excerpts = new Map<string, string>();
  for (const paperId of paperIds) {
    const fromPort = (loaded.get(paperId) ?? '').trim();
    const paper = papers.find((candidate) => candidate.paperId === paperId);
    const fallback = (paper?.abstract ?? '').trim();
    const excerpt = fromPort || fallback;
    if (excerpt) excerpts.set(paperId, excerpt);
  }
  return excerpts;
}

/**
 * Applies the review decision to the parsed verdicts.
 *
 * Kept separate from the runner body so the three outcomes (accept all, accept a
 * subset, decline) are one readable unit — this is the branch where a mistake
 * silently persists a claim the user rejected.
 */
async function reviewJudgements(
  parsed: RelationParseResult,
  onJudged: NonNullable<RunRelationAnalysisOptions['onJudged']>,
  model: string | undefined,
): Promise<{
  parsed: RelationParseResult;
  discardedPairKeys: string[];
  manualBridges: readonly ManualBridgeInput[];
}> {
  const rows = buildJudgementReviewRows(parsed);
  const decision = await onJudged({
    rows,
    ...(model ? { model } : {}),
    rejectedCount: parsed.rejected.length,
    // The parser's reasons travel with the count: a bare number is unactionable.
    rejectedReasons: parsed.rejected.map((entry) => entry.reason).filter(Boolean),
    bridgeDrops: parsed.bridgeDrops,
  });
  if (decision === 'accept-all') {
    return { parsed, discardedPairKeys: [], manualBridges: [] };
  }
  if (decision === null) {
    // Dismissed: decline everything, including the negative verdicts — caching a
    // "no relationship" the user never saw is still making a claim on their behalf.
    // Manual nodes go with it: they were typed inside a dialog that was then thrown away.
    const filtered = filterAcceptedJudgements(parsed, new Set());
    return { ...filtered, manualBridges: [] };
  }
  const filtered = filterAcceptedJudgements(
    parsed,
    decision.acceptedPairKeys,
    decision.acceptedBridgeKeys,
  );
  return { ...filtered, manualBridges: decision.manualBridges ?? [] };
}

/** One-line summary for the status bar. */
export function describeRelationResult(result: RelationAnalysisResult): string {
  if (result.status === 'nothing-to-do') return result.reason ?? '没有可判断的论文对。';
  if (result.status === 'cancelled') return result.reason ?? '已取消。';
  if (result.status === 'discarded') return result.reason ?? '已放弃写入本次结论。';
  if (result.status === 'failed') return result.reason ?? '关系判断失败。';

  const parts = [
    `已判断 ${result.judgedPairs} 对`,
    result.relationsFound ? `发现 ${result.relationsFound} 条关系` : '',
    result.negativeVerdicts ? `${result.negativeVerdicts} 对确认无关系（已缓存）` : '',
    // Bridges and manual nodes are the visible outcome of the run, so they belong in the same line.
    result.bridgesCreated ? `新增 ${result.bridgesCreated} 个桥接实体` : '',
    result.bridgesReused ? `复用 ${result.bridgesReused} 个已有实体` : '',
    result.manualNodes ? `手填 ${result.manualNodes} 个节点` : '',
    // Declining a verdict is a real outcome the user chose, so it is stated rather
    // than looking like the model found nothing.
    result.discardedPairs ? `${result.discardedPairs} 对未写入（下次会重新判断）` : '',
    result.unansweredPairs ? `${result.unansweredPairs} 对未作答（下次会重试）` : '',
    result.failedBatches ? `${result.failedBatches} 批失败` : '',
  ];
  return `${parts.filter(Boolean).join('，')}。`;
}

/** What the bridge checks refused, phrased for the review header. */
export function describeBridgeDrops(drops: BridgeDropStats): string {
  const parts = [
    drops.quoteMismatch ? `${drops.quoteMismatch} 条因引文对不上原文被丢弃` : '',
    drops.lowQuality ? `${drops.lowQuality} 条不是实体名被丢弃` : '',
    drops.badType ? `${drops.badType} 条类型无效被丢弃` : '',
    drops.overLimit ? `${drops.overLimit} 条超过每对上限被丢弃` : '',
    drops.duplicate ? `${drops.duplicate} 条重复被丢弃` : '',
  ].filter(Boolean);
  return parts.length ? `AI 还给出了一些超出规则的桥接建议：${parts.join('，')}。` : '';
}
