import {
  describeConflicts,
  describeEdgeType,
  type ConflictApplyResult,
  type RelationConflict,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import { describeEdgeOrigin } from './graph-theme';
import {
  knowledgeGraphConflictApplyButton,
  knowledgeGraphConflictCloseButton,
  knowledgeGraphConflictDialog,
  knowledgeGraphConflictGroupsElement,
  knowledgeGraphConflictLaterButton,
  knowledgeGraphConflictSelectionElement,
  knowledgeGraphConflictSummaryElement,
} from '../../app/viewer-elements';

/**
 * Conflict resolution dialog.
 *
 * Detection and ranking are pure functions in the module; this is the surface
 * where the user approves (or overrides) the outcome. It is presentational on
 * purpose: the write path — building the batch plan and applying it — is injected
 * by the action layer, so the dialog never touches the repository.
 *
 * Two behavioural rules encode decisions from the module layer:
 *
 * - **Only overridden pairs are sent as selections.** The recommended survivor is
 *   not a user choice, and passing it as one would record `resolvedBy: 'user'` for
 *   a decision the ranking made. Doing nothing must stay distinguishable from
 *   deciding.
 * - **Every pair is decidable.** There is no "needs you" state and no unselected
 *   row: a conflict needs two distinct verdicts, every rank is unique, so a
 *   survivor always exists. The radios exist so the user can disagree with the
 *   ranking, not so they can leave the question open.
 */



export interface ConflictDialogInput {
  conflicts: RelationConflict[];
  /** Titles by paper id, so a pair reads as two papers rather than two ids. */
  paperTitles: ReadonlyMap<string, string>;
  /**
   * Applies the user's overridden pairs.
   *
   * Owned by the action layer, which holds the repository: `selections` maps
   * `pairKey -> edgeId` and contains **only** pairs whose survivor the user
   * changed away from the recommendation.
   */
  apply(selections: ReadonlyMap<string, string>): Promise<ConflictApplyResult>;
}

/** The edge each pair will keep: the recommendation unless the user changed it. */
let selections = new Map<string, string>();
let conflicts: RelationConflict[] = [];
let paperTitles: ReadonlyMap<string, string> = new Map();
let applySelection: ConflictDialogInput['apply'] | null = null;
let pendingResolve: ((result: ConflictApplyResult | null) => void) | null = null;

export function isConflictDialogOpen(): boolean {
  return knowledgeGraphConflictDialog.open;
}

function verdictLabel(type: string): string {
  return describeEdgeType(type);
}

function paperLabel(paperId: string, titles: ReadonlyMap<string, string>): string {
  return titles.get(paperId) ?? paperId;
}

/** Pairs where the user picked something other than the ranked survivor. */
function overriddenSelections(): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const conflict of conflicts) {
    const selected = selections.get(conflict.pairKey) ?? conflict.survivor.edgeId;
    if (selected !== conflict.survivor.edgeId) overrides.set(conflict.pairKey, selected);
  }
  return overrides;
}

function updateSelection(): void {
  const overrides = overriddenSelections().size;
  knowledgeGraphConflictSelectionElement.textContent = conflicts.length
    ? `共 ${conflicts.length} 组，其中 ${overrides} 组改为你的选择`
    : '';
  knowledgeGraphConflictApplyButton.disabled = conflicts.length === 0;
}

function buildVerdictRow(
  conflict: RelationConflict,
  edge: RelationConflict['edges'][number],
  titles: ReadonlyMap<string, string>,
): HTMLElement {
  const selected = selections.get(conflict.pairKey) ?? conflict.survivor.edgeId;
  const keeps = edge.edgeId === selected;

  const row = document.createElement('label');
  row.className = 'knowledge-graph-conflict-row';
  // The retiring row is visually distinct: it is about to be deleted, and that
  // has to be visible before the click, not only in the summary afterwards.
  row.toggleAttribute('data-keeps', keeps);
  row.toggleAttribute('data-retires', !keeps);

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = `knowledge-graph-conflict-${conflict.pairKey}`;
  radio.value = edge.edgeId;
  radio.checked = keeps;
  radio.setAttribute(
    'aria-label',
    `保留 ${verdictLabel(edge.type)} 的结论：${paperLabel(edge.source, titles)} 与 ${paperLabel(edge.target, titles)}`,
  );
  radio.addEventListener('change', () => {
    selections.set(conflict.pairKey, edge.edgeId);
    render();
  });

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body';

  const heading = document.createElement('div');
  heading.className = 'knowledge-graph-conflict-verdict';
  const label = document.createElement('span');
  label.className = 'knowledge-graph-conflict-type';
  label.textContent = verdictLabel(edge.type);
  heading.append(label);

  const badge = document.createElement('span');
  badge.className = keeps
    ? 'knowledge-graph-conflict-badge knowledge-graph-conflict-badge-keep'
    : 'knowledge-graph-conflict-badge knowledge-graph-conflict-badge-drop';
  badge.textContent = keeps ? '保留' : '将退役';
  heading.append(badge);

  if (edge.edgeId === conflict.survivor.edgeId) {
    const recommended = document.createElement('span');
    recommended.className = 'knowledge-graph-conflict-recommended';
    recommended.textContent = '建议';
    recommended.title = conflict.explanation;
    heading.append(recommended);
  }
  body.append(heading);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-review-row-meta';
  const origin = document.createElement('span');
  origin.textContent = `${describeEdgeOrigin(edge.origin)} · 置信度 ${edge.confidence.toFixed(2)}`;
  meta.append(origin);

  if (edge.provenance.model) {
    const model = document.createElement('span');
    model.textContent = `模型 ${edge.provenance.model}`;
    meta.append(model);
  }
  if (edge.provenance.judgedAt) {
    const judged = document.createElement('span');
    judged.textContent = `判断于 ${new Date(edge.provenance.judgedAt).toLocaleDateString()}`;
    meta.append(judged);
  }
  if (edge.provenance.resolvedBy) {
    const resolved = document.createElement('span');
    // A conclusion that already survived a conflict says so; otherwise the user
    // cannot tell a fresh verdict from one that has been adjudicated before.
    resolved.textContent = edge.provenance.resolvedBy === 'user'
      ? `已由你裁决（放弃 ${edge.provenance.resolvedAgainst ?? '—'}）`
      : `已按强度裁决（放弃 ${edge.provenance.resolvedAgainst ?? '—'}）`;
    meta.append(resolved);
  }
  body.append(meta);

  const quote = edge.evidence.find((item) => item.quote.trim().length > 0);
  if (quote) {
    const evidence = document.createElement('p');
    evidence.className = 'knowledge-graph-review-quote';
    evidence.textContent = `第 ${quote.pageNumber} 页：${quote.quote}`;
    body.append(evidence);
  }

  row.append(radio, body);
  return row;
}

function buildConflictSection(
  conflict: RelationConflict,
  titles: ReadonlyMap<string, string>,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'knowledge-graph-review-group knowledge-graph-conflict-group';

  const heading = document.createElement('header');
  heading.className = 'knowledge-graph-review-group-heading';
  const pair = document.createElement('h3');
  pair.textContent =
    `${paperLabel(conflict.paperIds[0], titles)} ↔ ${paperLabel(conflict.paperIds[1], titles)}`;
  heading.append(pair);
  section.append(heading);

  const explanation = document.createElement('p');
  explanation.className = 'knowledge-graph-conflict-explanation';
  explanation.textContent = conflict.explanation;
  section.append(explanation);

  const list = document.createElement('div');
  list.className = 'knowledge-graph-conflict-rows';
  // Strongest verdict first, which is the order the detection already produced:
  // the recommendation sits on top and reads as the default.
  for (const edge of conflict.edges) list.append(buildVerdictRow(conflict, edge, titles));
  section.append(list);
  return section;
}

function render(): void {
  const nodes = conflicts.map((conflict) => buildConflictSection(conflict, paperTitles));
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = '没有发现互相矛盾的结论。';
    nodes.push(empty);
  }
  knowledgeGraphConflictGroupsElement.replaceChildren(...nodes);
  updateSelection();
}

async function applyChosen(): Promise<void> {
  const apply = applySelection;
  if (!apply || !conflicts.length) return;
  knowledgeGraphConflictApplyButton.disabled = true;
  knowledgeGraphConflictSelectionElement.classList.remove('error');
  try {
    // Only overridden pairs are sent: see the note at the top of the file.
    const result = await apply(overriddenSelections());
    dismissAnimatedDialog(knowledgeGraphConflictDialog);
    finish(result);
  } catch (error) {
    // Reported in place rather than thrown: a failed write must leave the dialog
    // open with the user's choices intact, not close it as if it had worked.
    knowledgeGraphConflictApplyButton.disabled = false;
    knowledgeGraphConflictSelectionElement.classList.add('error');
    knowledgeGraphConflictSelectionElement.textContent =
      `消解失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function finish(result: ConflictApplyResult | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  conflicts = [];
  selections = new Map();
  paperTitles = new Map();
  applySelection = null;
  knowledgeGraphConflictSelectionElement.classList.remove('error');
  resolve?.(result);
}

function close(result: ConflictApplyResult | null): void {
  finish(result);
  dismissAnimatedDialog(knowledgeGraphConflictDialog);
}

export function openConflictDialog(
  input: ConflictDialogInput,
): Promise<ConflictApplyResult | null> {
  return new Promise<ConflictApplyResult | null>((resolve) => {
    pendingResolve = resolve;
    conflicts = [...input.conflicts];
    paperTitles = input.paperTitles;
    applySelection = input.apply;
    // Defaults come from the ranking, so "apply" is meaningful without any input.
    selections = new Map(
      conflicts.map((conflict) => [conflict.pairKey, conflict.survivor.edgeId]),
    );
    knowledgeGraphConflictSummaryElement.textContent = describeConflicts(conflicts);
    render();
    showAnimatedDialog(knowledgeGraphConflictDialog);
  });
}

export function registerConflictEvents(): void {
  knowledgeGraphConflictApplyButton.addEventListener('click', () => {
    void applyChosen();
  });
  knowledgeGraphConflictLaterButton.addEventListener('click', () => close(null));
  knowledgeGraphConflictCloseButton.addEventListener('click', () => close(null));

  knowledgeGraphConflictDialog.addEventListener('cancel', (event) => {
    // Escape must resolve the caller: the action awaits this promise to decide
    // whether to reload the graph.
    event.preventDefault();
    close(null);
  });
}
