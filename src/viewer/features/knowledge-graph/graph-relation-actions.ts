import {
  collectJudgedPairKeys,
  describeRelationResult,
  loadPendingReview,
  knowledgeGraphRepository,
  normalizeEntityName,
  relationPairKey,
  runRelationAnalysis,
  type GraphEdge,
  type GraphEntity,
  type GraphPaper,
  type RelationPreview,
} from '../../../modules/knowledge-graph/public';
import { knowledgeGraphRelationButton } from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';
import { startTask } from '../../shared-ui/tasks/task-center';
import { createRelationAnalysisPorts } from './graph-extraction-repository';
import { openRelationPaperPicker, type RelationPickerPaper } from './relation-paper-picker';
import { openRelationReviewDialog } from './relation-review-dialog';

/**
 * Relation analysis actions: pick papers, judge them, review, write.
 *
 * Split out of `graph-entity-actions.ts` because it is the one action that spends tokens on a *set*
 * the user chose, and it owns three dialogs of its own (picker, review, confirm). The entity actions
 * are about changing the graph locally; this is about paying a model to say something about it.
 *
 * It receives the page capabilities through `configureRelationActions` — the same shape as the other
 * action modules, so no action file has to import the controller.
 */

export interface RelationActionContext {
  /** Full paper records: recall and the picker both need them. */
  getPapers(): GraphPaper[];
  /** Display names by entity id, so recall reasons read as words. */
  getEntityNames(): ReadonlyMap<string, string>;
  /** The paper the user is reading, preselected in the picker. */
  currentPaperId(): string | undefined;
  reload(): Promise<void>;
  ensureReady(): void;
  /** Header progress line, shared with extraction. */
  setProgress(progress: { message: string; done: boolean }): void;
  /** Re-reads whether the extract buttons can work — they are disabled during a run. */
  refreshAvailability(): Promise<void>;
}

let context: RelationActionContext | null = null;

export function configureRelationActions(next: RelationActionContext): void {
  context = next;
}

function requireContext(): RelationActionContext {
  if (!context) throw new Error('关系分析动作尚未装配（configureRelationActions 未调用）。');
  return context;
}

/**
 * Above this many estimated tokens, the user is asked before anything is sent.
 *
 * A threshold rather than a prompt every time: this is the only feature that
 * spends tokens without the user typing a message, but a confirmation dialog for
 * every small run would be noise the user learns to dismiss without reading —
 * which is worse than no prompt at all.
 */
export const RELATION_CONFIRM_TOKEN_THRESHOLD = 2_000;

/**
 * Runs on-demand paper-to-paper relation judgement.
 *
 * The user picks the papers first. That is the whole point of this entry point: the recall funnel
 * decides *what* to analyse, but a user who believes two papers are related wants those two judged,
 * not whatever the funnel considers promising. The picker lists papers with no shared entity first,
 * because a relation that the entity layer missed is exactly what they are here to find.
 *
 * One more step sits between the request and the write: the **review**. A stored conclusion is also
 * the cache — the pair is never asked about again — so writing verdicts the user has not seen would
 * make the model's mistakes permanent, and the negative ones would not even be visible on the canvas.
 */
export async function analyzePaperRelations(): Promise<void> {
  const { getPapers, currentPaperId, reload, ensureReady } = requireContext();
  ensureReady();
  await reload();

  const papers = getPapers();
  if (papers.length < 2) {
    setStatus('至少需要两篇文献才能判断关系。', true);
    return;
  }

  const [entities, edges] = await Promise.all([
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const current = currentPaperId();
  const picked = await openRelationPaperPicker({
    entries: buildPickerEntries(papers, entities, edges),
    ...(current ? { currentPaperId: current } : {}),
  });
  if (!picked) return;
  await runRelationPass({ paperIds: picked.paperIds });
}

/**
 * What the picker shows per paper: how much it already shares, and how much of it is already judged.
 *
 * Both numbers exist to make the run's outcome predictable *before* paying: a paper that already
 * shares two entities probably does not need a bridge, and a pair with a recorded conclusion is not
 * going to be re-asked.
 */
function buildPickerEntries(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
): RelationPickerPaper[] {
  const confirmed = new Set(
    entities.filter((entity) => entity.status === 'confirmed').map((entity) => entity.entityId),
  );
  const papersByEntity = new Map<string, Set<string>>();
  for (const edge of edges) {
    const isMention = (edge.sourceKind === 'paper' && edge.targetKind === 'entity')
      || (edge.sourceKind === 'entity' && edge.targetKind === 'paper');
    if (!isMention) continue;
    const entityId = edge.sourceKind === 'entity' ? edge.source : edge.target;
    const paperId = edge.sourceKind === 'paper' ? edge.source : edge.target;
    if (!confirmed.has(entityId)) continue;
    const bucket = papersByEntity.get(entityId);
    if (bucket) bucket.add(paperId);
    else papersByEntity.set(entityId, new Set([paperId]));
  }
  const sharedCount = new Map<string, number>();
  for (const paperIds of papersByEntity.values()) {
    if (paperIds.size < 2) continue;
    for (const paperId of paperIds) {
      sharedCount.set(paperId, (sharedCount.get(paperId) ?? 0) + 1);
    }
  }

  const judgedPairs = collectJudgedPairKeys(edges);
  return papers.map((paper) => ({
    paper,
    sharedEntityCount: sharedCount.get(paper.paperId) ?? 0,
    judgedPairCount: [...judgedPairs].filter((pairKey) => (
      pairKey.split('|').includes(paper.paperId)
    )).length,
  }));
}

/**
 * Re-judges one existing paper pair, from the 「重新判断」 action in the edge inspector.
 *
 * A stored conclusion is also the cache, so without an explicit request the pair
 * could never be re-asked and a wrong verdict would be permanent. Recall is
 * narrowed to the two papers involved: the user asked about *this* pair, not for
 * another batch of candidates, and the reply replaces the old conclusion through
 * the same retire-then-write plan a normal run uses.
 */
export async function rejudgePaperRelation(
  leftPaperId: string,
  rightPaperId: string,
): Promise<void> {
  const { getPapers } = requireContext();
  const papers = getPapers();
  const left = papers.find((paper) => paper.paperId === leftPaperId);
  const right = papers.find((paper) => paper.paperId === rightPaperId);
  if (!left || !right) {
    setStatus('这两篇文献已不在文献库中，无法重新判断。', true);
    return;
  }
  await runRelationPass({
    papers: [left, right],
    forcePairs: new Set([relationPairKey(left.paperId, right.paperId)]),
  });
}

function relationPassConfirmText(preview: RelationPreview, scope: 'rejudge' | 'selection'): string {
  if (scope === 'rejudge') {
    return `即将重新判断这 1 对文献的关系，预计消耗约 ${preview.estimatedTokens} tokens。\n\n`
      + '新的结论会替换这对文献原有的结论。\n\n继续吗？';
  }
  return `即将判断 ${preview.selected.length} 对论文的关系，预计消耗约 ${preview.estimatedTokens} tokens。\n\n`
    + '模型还会尝试找出能连接这些文献的概念实体（需要两篇原文的引文作证）。\n'
    + '已判断过的论文对会被跳过，不重复消耗。\n\n继续吗？';
}

async function runRelationPass(target?: {
  papers?: GraphPaper[];
  forcePairs?: ReadonlySet<string>;
  paperIds?: readonly string[];
}): Promise<void> {
  const { getPapers, getEntityNames, reload, ensureReady, setProgress, refreshAvailability } =
    requireContext();
  ensureReady();
  await reload();

  const papers = target?.papers ?? getPapers();
  if (papers.length < 2) {
    setStatus('至少需要两篇文献才能判断关系。', true);
    return;
  }

  knowledgeGraphRelationButton.disabled = true;
  // 全局任务栏：关系判定同样会跑几分钟，切到阅读页后仍然要能看到进度。
  const relationTask = startTask({
    title: '判断论文关系',
    detail: '正在准备候选论文对…',
    cancelable: false,
  });
  try {
    const settings = await knowledgeGraphRepository.readSettings();
    const paperTitles = new Map(getPapers().map((paper) => [paper.paperId, paper.title]));
    // Only used to explain an empty recall: pending entities are invisible to recall
    // because shared entities count only once confirmed, which is the usual reason a
    // corpus with plenty of candidates recalls nothing.
    const pendingEntityCount = (await loadPendingReview(knowledgeGraphRepository)).total;
    const result = await runRelationAnalysis(createRelationAnalysisPorts(), {
      papers,
      topK: settings.relationTopK,
      maxCandidates: settings.maximalRecallCandidates,
      entityNames: getEntityNames(),
      pendingEntityCount,
      ...(target?.forcePairs ? { forcePairs: target.forcePairs } : {}),
      ...(target?.paperIds ? { paperIds: target.paperIds } : {}),
      onPreview: async (preview) => {
        if (preview.estimatedTokens < RELATION_CONFIRM_TOKEN_THRESHOLD) return true;
        return window.confirm(
          relationPassConfirmText(preview, target?.forcePairs ? 'rejudge' : 'selection'),
        );
      },
      onJudged: async (review) => {
        // Existing names, so a bridge that lands on a known entity can say "复用已有实体" before the
        // user decides — the difference between growing the graph and growing a duplicate farm.
        const existing = new Set(
          (await knowledgeGraphRepository.listEntities())
            .map((entity) => entity.normalizedName || normalizeEntityName(entity.name))
            .filter(Boolean),
        );
        const accepted = await openRelationReviewDialog({
          rows: review.rows,
          paperTitles,
          bridgeDrops: review.bridgeDrops,
          existingEntityNames: existing,
          ...(review.model ? { model: review.model } : {}),
          rejectedCount: review.rejectedCount,
          ...(review.rejectedReasons?.length ? { rejectedReasons: review.rejectedReasons } : {}),
        });
        // `null` means the review was dismissed: decline to write rather than accepting claims on the
        // user's behalf.
        return accepted ?? null;
      },
      onProgress: (message) => {
        // 关系判定也是长任务：和抽取一样进全局任务栏，切页也能看见。它目前没有中止能力（runner 不接受 signal），所以不显示停止按钮。
        relationTask?.update({ detail: message });
        setProgress({ message, done: false });
      },
    });

    setStatus(describeRelationResult(result), result.status === 'failed');
    relationTask?.finish(result.status === 'failed' ? 'failed' : 'done', describeRelationResult(result));
    if (result.edgesWritten) {
      await reload();
      // Bridge entities are new nodes in the graph, so the pending badge and the conflict badge are
      // both stale after a run that wrote any.
      if (result.bridgesCreated || result.manualNodes) await refreshAvailability();
    }
  } catch (error) {
    // The runner reports an unusable provider answer by returning `status: 'failed'`, but a *thrown* error (network,
    // provider 5xx, aborted request) used to escape as an unhandled rejection: no message, no way to tell what happened.
    relationTask.finish('failed', `关系分析失败：${error instanceof Error ? error.message : String(error)}`);
    setStatus(`关系分析失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    // This button has no availability refresh of its own (unlike the extract buttons, whose enabled state is decided by
    // whether an index exists). Without this line it stayed disabled for the rest of the session after one run — which is
    // exactly the 「点一次就不能再点了」 report.
    knowledgeGraphRelationButton.disabled = false;
    await refreshAvailability();
  }
}
