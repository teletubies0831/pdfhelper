import {
  attachEntityDescriptions,
  describeExplanationResult,
  explainEntityDescriptions,
  knowledgeGraphRepository,
  normalizeStreamingExplanation,
  planExplanationTargets,
  type GraphEntity,
  type GraphPaper,
} from '../../../modules/knowledge-graph/public';
import { setStatus } from '../../app/status-bar';
import { createEntityExplanationPorts } from './graph-extraction-repository';
import {
  EXPLANATION_PORT_UNAVAILABLE,
  streamEntityExplanation,
} from './graph-explanation-stream';
import { updateExplanationPreview, type ExplanationProgress } from './graph-inspector';

/**
 * Entity meanings: generating them, streaming them into the panel, and storing them.
 *
 * Split out of `graph-entity-actions.ts` because it is a different job from extraction/merge/relations
 * and has its own state machine (one live stream, a button that must be disabled while it runs, a
 * failure that has to stay visible next to the button). It receives the parts of the page it needs
 * through `configureExplanationActions`, the same way the other action layer does.
 *
 * Two entry points, matching the two moments a meaning is wanted:
 *
 * - `explainConfirmedEntities` — right after the user confirms candidates. Batched, quiet, not
 *   awaited: the dialog is already closed and nobody is watching.
 * - `regenerateEntityExplanation` — the inspector's button. Streamed, one entity, visible.
 */

export interface ExplanationActionContext {
  /** Full paper records: the abstract is part of the grounding. */
  getPapers(): GraphPaper[];
  /** Re-reads the snapshot and re-renders the page after a meaning was stored. */
  reload(): Promise<void>;
  /** Re-renders only the right-hand panel, for streaming progress. */
  refreshInspector(): void;
  /** Header progress line, shared with extraction. */
  setProgress(progress: { message: string; done: boolean }): void;
}

let context: ExplanationActionContext | null = null;

export function configureExplanationActions(next: ExplanationActionContext): void {
  context = next;
}

function requireContext(): ExplanationActionContext {
  if (!context) throw new Error('实体解释动作尚未装配（configureExplanationActions 未调用）。');
  return context;
}

/**
 * Live state of the one-entity explanation in the inspector.
 *
 * Module level because exactly one can be in flight: the panel asks for it when it renders and the
 * streaming loop writes into it, so the two cannot disagree about whether a generation is running.
 */
let explanationProgress: ExplanationProgress | null = null;

export function currentExplanationProgress(): ExplanationProgress | null {
  return explanationProgress;
}

/**
 * Generates the meanings of entities the user just put into the graph.
 *
 * Deliberately **not** awaited by the confirmation flow: the dialog closes as soon as the entities are
 * written, and the explanations arrive afterwards (the page reloads itself when they land). An
 * explanation is a reading aid, so it must never make confirming feel slow or, worse, fail the
 * confirmation.
 *
 * Batch extraction is the other half of the rule: it proposes candidates the user has not accepted, so
 * it writes no explanations at all.
 */
export async function explainConfirmedEntities(names: readonly string[]): Promise<void> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!unique.length) return;
  const { getPapers, reload, setProgress } = requireContext();
  setProgress({ message: `正在为 ${unique.length} 个实体生成解释…`, done: false });
  const result = await explainEntityDescriptions(
    { papers: getPapers(), names: unique },
    createEntityExplanationPorts(),
    knowledgeGraphRepository,
  );
  setProgress({ message: '', done: true });
  if (result.error) {
    // Deliberately **not** an error dialog: the confirmation succeeded and only the optional reading
    // aid is missing. A modal here interrupts a flow the user has already completed, and the panel on
    // the node itself is where they will look for the missing text.
    setStatus(`实体已入图，但解释没有生成（${result.error}）`);
    return;
  }
  setStatus(describeExplanationResult(result));
  if (result.described) await reload();
}

/**
 * Streams one entity's meaning into the inspector, then stores it.
 *
 * Why streaming: the first version waited for a one-shot response and left the panel with nothing to
 * show, so a click looked like it had done nothing. Now the button is disabled and relabelled before
 * the first `await`, the sentence appears as it is written, and the panel ends up showing the stored
 * version — which is also the retry path when the confirm-time batch call failed.
 */
export async function regenerateEntityExplanation(entityName: string): Promise<void> {
  const { getPapers, reload, refreshInspector } = requireContext();
  const papers = getPapers();
  const entities = await knowledgeGraphRepository.listEntities();
  const [target] = planExplanationTargets(entities, papers, {
    names: [entityName],
    // The button exists to re-ask, so an existing meaning is not a reason to skip.
    force: true,
    limit: 1,
  });
  if (!target) {
    setStatus('找不到这个实体，它可能已经从图谱移除。');
    return;
  }

  explanationProgress = { entityName: target.name, text: '', busy: true };
  // Rendered before any network call: the click must never look like a no-op.
  refreshInspector();
  try {
    const raw = await streamEntityExplanation(
      {
        name: target.name,
        type: target.type,
        ...(target.aliases.length ? { aliases: target.aliases } : {}),
        paperTitle: target.paperTitle,
        ...(target.abstract ? { abstract: target.abstract } : {}),
        quotes: target.quotes,
      },
      {
        onDelta: (delta) => {
          if (!explanationProgress) return;
          explanationProgress.text += delta;
          if (!updateExplanationPreview(explanationProgress.text)) refreshInspector();
        },
      },
    );
    const cleaned = normalizeStreamingExplanation(raw);
    if (!cleaned) throw new Error('模型没有给出可用的解释，请稍后再试。');

    await storeMeaning(entities, target.entityId, cleaned);
    await reload();
  } catch (error) {
    const unavailable = error instanceof Error
      && error.name === EXPLANATION_PORT_UNAVAILABLE;
    if (unavailable) {
      // The background has no stream port. Try the message channel before giving up: that path is
      // older, so a page that is newer than its service worker can still reach it.
      setStatus('后台没有流式端口，改用普通请求生成解释…');
      const fallback = await explainEntityDescriptions(
        { papers, names: [target.name], force: true, limit: 1 },
        createEntityExplanationPorts(),
        knowledgeGraphRepository,
      );
      if (fallback.described) {
        explanationProgress = null;
        setStatus('解释已更新（后台没有流式端口，本次没有逐字显示）。');
        await reload();
        return;
      }
      reportExplanationFailure(target.name, fallback.error ?? '后台没有响应，请重新加载扩展后重试。');
      return;
    }
    reportExplanationFailure(
      target.name,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (explanationProgress?.busy) explanationProgress = null;
    refreshInspector();
  }
}

/** Writes the meaning onto the entity and reports it. */
async function storeMeaning(
  entities: readonly GraphEntity[],
  entityId: string,
  meaning: string,
): Promise<void> {
  const updated = attachEntityDescriptions(entities, new Map([[entityId, meaning]]));
  if (updated.length) await knowledgeGraphRepository.putEntities(updated);
  // Cleared before the reload, so the panel renders the stored sentence rather than the buffer.
  explanationProgress = null;
  setStatus('解释已更新。');
}

/**
 * Keeps the reason next to the button that failed, which is where the user is looking.
 *
 * No dialog: an explanation is an optional reading aid, and the panel keeps the button, so a retry is
 * one click away. It stays on screen until the next attempt or another node is selected.
 */
function reportExplanationFailure(entityName: string, message: string): void {
  explanationProgress = { entityName, text: '', busy: false, error: message };
  setStatus(`解释没有生成：${message}`);
}
