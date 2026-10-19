import {
  MAX_SELECTED_PAPERS,
  type GraphPaper,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import {
  knowledgeGraphRelationPickerCancelButton,
  knowledgeGraphRelationPickerCloseButton,
  knowledgeGraphRelationPickerDialog,
  knowledgeGraphRelationPickerGroupsElement,
  knowledgeGraphRelationPickerRunButton,
  knowledgeGraphRelationPickerSelectionElement,
  knowledgeGraphRelationPickerSummaryElement,
} from '../../app/viewer-elements';

/**
 * Picks the papers to analyse.
 *
 * The old entry point decided *what* to analyse with a recall funnel, which answers a question the
 * user had not been asked. Here the user answers it: they tick the papers they believe are related,
 * and the run judges every pair among them. That is also why this dialog ranks rather than filters —
 * papers that share no confirmed entity are the ones a bridge most needs to be found for, so they come
 * first and start ticked.
 */

export interface RelationPickerPaper {
  paper: GraphPaper;
  /** Confirmed entities this paper shares with another paper currently in the graph. */
  sharedEntityCount: number;
  /** Pairs with an already-recorded conclusion, so "already judged" is visible before paying. */
  judgedPairCount: number;
}

export interface RelationPickerResult {
  paperIds: string[];
}

let entries: RelationPickerPaper[] = [];
let selected = new Set<string>();
let currentPaperId: string | undefined;
let pendingResolve: ((result: RelationPickerResult | null) => void) | null = null;

export function isRelationPickerOpen(): boolean {
  return knowledgeGraphRelationPickerDialog.open;
}

function pairCount(count: number): number {
  return (count * (count - 1)) / 2;
}

/** Order: no shared entity first (the bridge candidates), then the rest; newest-looking last. */
function sortedEntries(): RelationPickerPaper[] {
  return [...entries].sort((left, right) => (
    left.sharedEntityCount - right.sharedEntityCount
    || (right.paper.year ?? 0) - (left.paper.year ?? 0)
    || left.paper.title.localeCompare(right.paper.title)
  ));
}

function describeEntry(entry: RelationPickerPaper): string {
  const parts: string[] = [];
  if (entry.paper.year) parts.push(String(entry.paper.year));
  parts.push(entry.sharedEntityCount
    ? `已共享 ${entry.sharedEntityCount} 个确认实体`
    : '尚无共享实体（最需要 AI 找桥）');
  if (entry.judgedPairCount) parts.push(`${entry.judgedPairCount} 对已有结论，不会重复计费`);
  return parts.join(' · ');
}

function updateSelection(): void {
  const count = selected.size;
  knowledgeGraphRelationPickerSelectionElement.textContent = count
    ? `已选 ${count} / ${MAX_SELECTED_PAPERS} 篇 · 将分析 ${pairCount(count)} 对`
    : `最多选 ${MAX_SELECTED_PAPERS} 篇`;
  knowledgeGraphRelationPickerRunButton.disabled = count < 2;
  knowledgeGraphRelationPickerRunButton.textContent = count >= 2
    ? `分析 ${pairCount(count)} 对关系`
    : '开始分析';
}

function buildRow(entry: RelationPickerPaper): HTMLElement {
  const row = document.createElement('li');
  row.className = 'knowledge-graph-review-row knowledge-graph-paper-row';
  const isCurrent = entry.paper.paperId === currentPaperId;
  if (!entry.sharedEntityCount) row.toggleAttribute('data-highlight', true);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selected.has(entry.paper.paperId);
  checkbox.setAttribute('aria-label', `选择 ${entry.paper.title}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      if (selected.size >= MAX_SELECTED_PAPERS) {
        // Refusing is the honest option: silently dropping another paper would make the count in the
        // footer disagree with what the user ticked.
        checkbox.checked = false;
        knowledgeGraphRelationPickerSelectionElement.textContent =
          `最多只能选 ${MAX_SELECTED_PAPERS} 篇（两两分析，${pairCount(MAX_SELECTED_PAPERS)} 对封顶）`;
        return;
      }
      selected.add(entry.paper.paperId);
    } else {
      selected.delete(entry.paper.paperId);
    }
    updateSelection();
  });

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body';
  const title = document.createElement('div');
  title.className = 'knowledge-graph-papers-text';
  title.textContent = isCurrent ? `${entry.paper.title}（当前论文）` : entry.paper.title;
  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-review-row-meta';
  meta.textContent = describeEntry(entry);
  body.append(title, meta);

  row.append(checkbox, body);
  return row;
}

function render(): void {
  const nodes = sortedEntries().map((entry) => buildRow(entry));
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = '图谱里还没有文献，先到知识库添加 PDF。';
    nodes.push(empty);
  }
  knowledgeGraphRelationPickerGroupsElement.replaceChildren(...nodes);
  updateSelection();
}

function finish(result: RelationPickerResult | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  entries = [];
  selected = new Set();
  currentPaperId = undefined;
  resolve?.(result);
}

function close(result: RelationPickerResult | null): void {
  finish(result);
  dismissAnimatedDialog(knowledgeGraphRelationPickerDialog);
}

/**
 * Shows the picker and resolves with the chosen paper ids, or `null` when dismissed.
 *
 * The paper the user was looking at is preselected: they opened this from a paper they already had in
 * mind, and making them find it again in a list is the kind of small cost that makes a feature feel
 * unfinished.
 */
export function openRelationPaperPicker(
  input: {
    entries: readonly RelationPickerPaper[];
    currentPaperId?: string;
  },
): Promise<RelationPickerResult | null> {
  return new Promise<RelationPickerResult | null>((resolve) => {
    pendingResolve = resolve;
    entries = [...input.entries];
    currentPaperId = input.currentPaperId;
    // Default: the current paper plus the "no shared entity" ones, newest first, up to the cap.
    const defaults = sortedEntries()
      .filter((entry) => !entry.sharedEntityCount)
      .map((entry) => entry.paper.paperId);
    if (input.currentPaperId) defaults.unshift(input.currentPaperId);
    selected = new Set(defaults.filter(Boolean).slice(0, MAX_SELECTED_PAPERS));
    knowledgeGraphRelationPickerSummaryElement.textContent =
      `${entries.length} 篇文献 · 最多选 ${MAX_SELECTED_PAPERS} 篇（${pairCount(MAX_SELECTED_PAPERS)} 对）`;
    render();
    showAnimatedDialog(knowledgeGraphRelationPickerDialog);
  });
}

export function registerRelationPickerEvents(): void {
  knowledgeGraphRelationPickerRunButton.addEventListener('click', () => {
    if (selected.size < 2) return;
    close({ paperIds: [...selected] });
  });
  knowledgeGraphRelationPickerCancelButton.addEventListener('click', () => close(null));
  knowledgeGraphRelationPickerCloseButton.addEventListener('click', () => close(null));
  knowledgeGraphRelationPickerDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(null);
  });
}
