import {
  clearMergeRejections,
  groupMergeRowsByKeep,
  knowledgeGraphRepository,
  loadMergeReview,
  mergeGraphEntities,
  mergePairKey,
  orderMergePairsForBatch,
  rejectMergeSuggestion,
  type MergeSuggestionRow,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import {
  knowledgeGraphMergeApplyButton,
  knowledgeGraphMergeCloseButton,
  knowledgeGraphMergeDialog,
  knowledgeGraphMergeGroupsElement,
  knowledgeGraphMergeLaterButton,
  knowledgeGraphMergeRestoreButton,
  knowledgeGraphMergeSelectionElement,
  knowledgeGraphMergeSummaryElement,
} from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';

/**
 * Entity merge dialog.
 *
 * Rows are grouped by the entity they would merge *into*, because one canonical
 * entity usually has several misspellings pointing at it. Presenting them as one
 * decision is both less work and less error-prone than three separate
 * confirmations, each of which could otherwise pick a different survivor.
 *
 * Pre-ticking follows `autoSelectable` from the alignment scorer, never the
 * similarity number directly, so the threshold lives in one place.
 */

interface MergeRowState {
  row: MergeSuggestionRow;
  selected: boolean;
}

let rows: MergeRowState[] = [];
let pendingResolve: ((applied: number) => void) | null = null;
let appliedCount = 0;
/** Rejections remembered from earlier sessions, shown so the count is not invisible. */
let rejectedCount = 0;
/** Tombstones left out of the comparison; only meaningful for the summary line. */
let excludedCount = 0;

export function isMergeDialogOpen(): boolean {
  return knowledgeGraphMergeDialog.open;
}

/**
 * The header line, recomputed whenever the list changes.
 *
 * Rejecting a row changes what is on offer, so a summary written only at open time started claiming
 * "2 suggestions" while one row was left.
 */
function renderSummary(): void {
  const autoSelected = rows.filter((item) => item.selected).length;
  knowledgeGraphMergeSummaryElement.textContent = rows.length
    ? `发现 ${rows.length} 组可能的同义实体，其中 ${autoSelected} 组已默认勾选。`
      + (excludedCount ? `（${excludedCount} 个已合并实体不参与）` : '')
      + (rejectedCount ? `（已按你的判断排除 ${rejectedCount} 条）` : '')
    : rejectedCount
      ? `没有需要合并的实体（已按你的判断排除 ${rejectedCount} 条建议）。`
      : '没有发现需要合并的实体。';
}

function updateSelection(): void {
  const selected = rows.filter((item) => item.selected).length;
  knowledgeGraphMergeSelectionElement.textContent = [
    `已选 ${selected} / ${rows.length} 组`,
    rejectedCount ? `已拒绝 ${rejectedCount} 条建议` : '',
  ].filter(Boolean).join(' · ');
  knowledgeGraphMergeApplyButton.disabled = selected === 0;
  // The only way back from a rejection. Without it a mis-click would be permanent and invisible.
  knowledgeGraphMergeRestoreButton.hidden = rejectedCount === 0;
  knowledgeGraphMergeRestoreButton.textContent = `恢复 ${rejectedCount} 条已拒绝`;
  knowledgeGraphMergeRestoreButton.title = '让被拒绝的合并建议重新参与比对';
  renderSummary();
}

/**
 * Records that a suggested pair is *not* the same thing, and drops it from this review.
 *
 * The suggestions are string guesses — `s-XOR` / `b-XOR` share three letters — so "no" has to be
 * rememberable, otherwise the same wrong row returns on every open and the dialog becomes noise.
 */
async function rejectRow(state: MergeRowState): Promise<void> {
  const { row } = state;
  try {
    rejectedCount = await rejectMergeSuggestion(
      row.keepEntityId,
      row.mergeEntityId,
      knowledgeGraphRepository,
    );
    rows = rows.filter((item) => item !== state);
    renderGroups();
    setStatus(`已记录：${row.mergeName} 与 ${row.keepName} 不是同一实体，以后不再建议。`);
  } catch (error) {
    setStatus(
      `无法记录这条判断：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

function renderGroups(): void {
  const grouped = groupMergeRowsByKeep(
    rows.filter((item) => item.selected).map((item) => item.row),
  );
  const selectedIds = new Set(
    grouped.flatMap((group) => group.rows.map((row) => row.mergeEntityId)),
  );

  const allRows = rows.map((item) => item.row);
  const allGroups = groupMergeRowsByKeep(allRows);
  const nodes: HTMLElement[] = [];

  for (const group of allGroups) {
    const section = document.createElement('section');
    section.className = 'knowledge-graph-review-group';

    const baseLabel = group.rows[0]?.keepName ?? group.keepEntityId;
    const heading = document.createElement('header');
    heading.className = 'knowledge-graph-review-group-heading';
    const headingText = document.createElement('h3');
    headingText.textContent = `保留「${baseLabel}」（${group.rows.length} 项建议）`;
    heading.append(headingText);
    section.append(heading);

    const list = document.createElement('ul');
    list.className = 'knowledge-graph-review-list';
    for (const row of group.rows) {
      const state = rows.find((item) => item.row.mergeEntityId === row.mergeEntityId);
      if (!state) continue;
      list.append(buildRowElement(state, selectedIds.has(row.mergeEntityId)));
    }
    section.append(list);
    nodes.push(section);
  }

  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = '当前没有需要合并的实体。';
    nodes.push(empty);
  }

  knowledgeGraphMergeGroupsElement.replaceChildren(...nodes);
  updateSelection();
}

function buildRowElement(state: MergeRowState, isSelected: boolean): HTMLElement {
  const { row } = state;
  const item = document.createElement('li');
  item.className = 'knowledge-graph-review-row';
  // The review band ("possible duplicate") is styled distinctly from the
  // auto-selectable band, so a pre-ticked row never hides that it was a guess.
  item.toggleAttribute('data-tentative', !row.autoSelectable);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isSelected;
  checkbox.setAttribute('aria-label', `合并 ${row.mergeName} 到 ${row.keepName}`);
  checkbox.addEventListener('change', () => {
    state.selected = checkbox.checked;
    updateSelection();
  });

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body';

  const title = document.createElement('div');
  title.className = 'knowledge-graph-merge-pair';
  const mergeName = document.createElement('span');
  mergeName.className = 'knowledge-graph-merge-from';
  mergeName.textContent = row.mergeName;
  const arrow = document.createElement('span');
  arrow.className = 'knowledge-graph-merge-arrow';
  arrow.textContent = '→';
  const keepName = document.createElement('span');
  keepName.className = 'knowledge-graph-merge-to';
  keepName.textContent = row.keepName;
  title.append(mergeName, arrow, keepName);
  body.append(title);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-review-row-meta';
  const score = document.createElement('span');
  score.className = 'knowledge-graph-review-confidence';
  score.textContent = `相似度 ${row.score.toFixed(2)}`;
  meta.append(score);

  const evidence = document.createElement('span');
  evidence.className = 'knowledge-graph-review-source';
  evidence.textContent = `证据 ${row.keepEvidenceCount} → 合并后 ${row.keepEvidenceCount + row.mergeEvidenceCount}`;
  meta.append(evidence);

  if (!row.autoSelectable) {
    const tentative = document.createElement('span');
    tentative.className = 'knowledge-graph-merge-tentative';
    tentative.textContent = '待你判断';
    tentative.title = '相似度低于自动建议阈值，默认不勾选';
    meta.append(tentative);
  }
  body.append(meta);

  if (row.reasons.length) {
    const reasons = document.createElement('div');
    reasons.className = 'knowledge-graph-review-row-meta';
    reasons.textContent = row.reasons.join(' · ');
    body.append(reasons);
  }

  const actions = document.createElement('div');
  actions.className = 'knowledge-graph-review-row-actions';
  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'knowledge-graph-action';
  rejectButton.textContent = '不是同一实体';
  rejectButton.title = '记下这条判断，之后不再建议把两者合并';
  rejectButton.addEventListener('click', () => { void rejectRow(state); });
  actions.append(rejectButton);

  item.append(checkbox, body, actions);
  return item;
}

async function applySelection(): Promise<void> {
  const selectedRows = rows.filter((item) => item.selected).map((item) => item.row);
  // Order matters: a merge tombstones the absorbed entity, so a chain must be
  // applied survivor-first or a later step would target a tombstone and be
  // refused.
  const pairs = orderMergePairsForBatch(selectedRows);
  if (!pairs.length) {
    setStatus('没有可执行的合并。', true);
    return;
  }

  knowledgeGraphMergeApplyButton.disabled = true;
  let applied = 0;
  const failures: string[] = [];
  try {
    for (const pair of pairs) {
      // Applied one at a time on purpose: each merge reads the current graph, and
      // a batched write would plan against stale edges.
      const result = await mergeGraphEntities(pair.keepEntityId, pair.mergeEntityId, knowledgeGraphRepository);
      if (result) applied += 1;
      else failures.push(pair.mergeEntityId);
    }
  } finally {
    knowledgeGraphMergeApplyButton.disabled = false;
  }

  appliedCount = applied;
  if (failures.length) {
    setStatus(`已合并 ${applied} 组，${failures.length} 组未能合并。`, true);
  } else {
    setStatus(`已合并 ${applied} 组实体。`);
  }
  dismissAnimatedDialog(knowledgeGraphMergeDialog);
}

function closeWithResult(applied: number): void {
  appliedCount = applied;
  dismissAnimatedDialog(knowledgeGraphMergeDialog);
}

export function openEntityMergeDialog(): Promise<number> {
  return new Promise<number>((resolve) => {
    pendingResolve = resolve;
    void (async () => {
      try {
        const review = await loadMergeReview(knowledgeGraphRepository);
        rows = review.rows.map((row) => ({ row, selected: row.autoSelectable }));
        const settings = await knowledgeGraphRepository.readSettings();
        rejectedCount = settings.mergeRejections.length;
        excludedCount = review.excludedCount;
        renderGroups();
        showAnimatedDialog(knowledgeGraphMergeDialog);
      } catch (error) {
        // This promise only settles on close, so a throw here would leave the caller waiting forever
        // with no dialog on screen — the failure has to be reported and the caller released.
        pendingResolve = null;
        rows = [];
        setStatus(
          `无法打开合并建议：${error instanceof Error ? error.message : String(error)}`,
          true,
        );
        resolve(0);
      }
    })();
  });
}

export function registerEntityMergeEvents(): void {
  knowledgeGraphMergeCloseButton.addEventListener('click', () => closeWithResult(0));
  knowledgeGraphMergeLaterButton.addEventListener('click', () => closeWithResult(0));
  knowledgeGraphMergeApplyButton.addEventListener('click', () => {
    void applySelection();
  });
  knowledgeGraphMergeRestoreButton.addEventListener('click', () => {
    void (async () => {
      try {
        const restored = await clearMergeRejections(knowledgeGraphRepository);
        rejectedCount = 0;
        const review = await loadMergeReview(knowledgeGraphRepository);
        rows = review.rows.map((row) => ({ row, selected: row.autoSelectable }));
        excludedCount = review.excludedCount;
        renderGroups();
        setStatus(`已恢复 ${restored} 条被拒绝的合并建议。`);
      } catch (error) {
        setStatus(
          `无法恢复：${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    })();
  });

  knowledgeGraphMergeDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeWithResult(0);
  });
  knowledgeGraphMergeDialog.addEventListener('close', () => {
    const applied = appliedCount;
    appliedCount = 0;
    rows = [];
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(applied);
  });
}
