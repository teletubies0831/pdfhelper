import {
  describeEdgeType,
  type JudgementReviewRow,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import {
  knowledgeGraphRelationDialog,
  knowledgeGraphRelationGroupsElement,
  knowledgeGraphRelationSelectAllButton,
  knowledgeGraphRelationSelectNoneButton,
  knowledgeGraphRelationSelectionElement,
  knowledgeGraphRelationSummaryElement,
  knowledgeGraphRelationWriteButton,
  knowledgeGraphRelationDiscardButton,
  knowledgeGraphRelationCloseButton,
} from '../../app/viewer-elements';

/**
 * Relation judgement review dialog.
 *
 * Why this step exists at all: a written conclusion is also the *cache*. Once
 * `EXTENDS` or `NO_RELATION` is stored for a pair, the funnel treats the pair as
 * answered and it is never asked again. So persisting a verdict the user has not
 * seen makes the model's mistake permanent — and invisible, because the negative
 * ones do not even draw on the canvas.
 *
 * The dialog therefore shows every verdict with its evidence and rationale, and
 * lets the user drop individual pairs. Dropping is not free and the copy says so:
 * the tokens are already spent, and the pair will be judged again next run.
 */



export interface RelationReviewDialogInput {
  rows: JudgementReviewRow[];
  /** Titles by paper id, so a pair reads as two papers rather than two ids. */
  paperTitles: ReadonlyMap<string, string>;
  model?: string;
  /** Verdicts the parser could not read, reported so the count adds up. */
  rejectedCount?: number;
}

let rows: JudgementReviewRow[] = [];
let accepted = new Set<string>();
let paperTitles: ReadonlyMap<string, string> = new Map();
let pendingResolve: ((accepted: Set<string> | null) => void) | null = null;

export function isRelationReviewOpen(): boolean {
  return knowledgeGraphRelationDialog.open;
}

function paperLabel(paperId: string): string {
  return paperTitles.get(paperId) ?? paperId;
}

function verdictLabel(row: JudgementReviewRow): string {
  // `NONE` is a recorded negative verdict rather than a relation, so it also says what accepting it
  // means: nothing is drawn on the canvas, but the pair is not paid for again.
  return row.verdict === 'NONE' ? '无关（不建立关系）' : describeEdgeType(row.verdict);
}

function updateSelection(): void {
  knowledgeGraphRelationSelectionElement.textContent = rows.length
    ? `已选 ${accepted.size} / ${rows.length} 对`
    : '';
  knowledgeGraphRelationWriteButton.disabled = accepted.size === 0;
  knowledgeGraphRelationWriteButton.textContent = accepted.size
    ? `写入所选（${accepted.size}）`
    : '写入所选';
}

function buildRow(row: JudgementReviewRow): HTMLElement {
  const item = document.createElement('li');
  item.className = 'knowledge-graph-review-row';
  item.toggleAttribute('data-negative', row.verdict === 'NONE');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = accepted.has(row.pairKey);
  checkbox.setAttribute(
    'aria-label',
    `写入 ${paperLabel(row.leftPaperId)} 与 ${paperLabel(row.rightPaperId)} 的结论`,
  );
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) accepted.add(row.pairKey);
    else accepted.delete(row.pairKey);
    updateSelection();
  });

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body';

  const title = document.createElement('div');
  title.className = 'knowledge-graph-relation-pair';
  const pair = document.createElement('span');
  pair.textContent = `${paperLabel(row.leftPaperId)} ↔ ${paperLabel(row.rightPaperId)}`;
  const verdict = document.createElement('span');
  verdict.className = row.verdict === 'NONE'
    ? 'knowledge-graph-relation-verdict knowledge-graph-relation-verdict-none'
    : 'knowledge-graph-relation-verdict';
  verdict.textContent = verdictLabel(row);
  title.append(pair, verdict);
  body.append(title);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-review-row-meta';
  // A negative verdict is certain about being negative (confidence 0 by design), so
  // showing "置信度 0.00" alone would read as "the model was unsure".
  const confidence = document.createElement('span');
  confidence.className = 'knowledge-graph-review-confidence';
  confidence.textContent = row.verdict === 'NONE'
    ? '模型明确判断无实质关系'
    : `置信度 ${row.confidence.toFixed(2)}`;
  meta.append(confidence);
  if (row.rationale) {
    const rationale = document.createElement('span');
    rationale.textContent = row.rationale;
    meta.append(rationale);
  }
  body.append(meta);

  if (row.verdict === 'NONE') {
    const note = document.createElement('p');
    note.className = 'knowledge-graph-relation-none-note';
    note.textContent = '这条结论不会显示在画布上，它的作用是记录"已经判断过"，避免下次重复消耗 Token。';
    body.append(note);
  } else if (row.evidenceQuote) {
    const quote = document.createElement('p');
    quote.className = 'knowledge-graph-review-quote';
    quote.textContent = row.evidenceQuote;
    body.append(quote);
  } else {
    // Said explicitly: a verdict with no quoted evidence cannot be traced back to
    // the paper, and the user is the one who has to weigh that.
    const missing = document.createElement('p');
    missing.className = 'knowledge-graph-relation-none-note';
    missing.textContent = '模型没有给出原文引文，这条结论无法回溯到具体句子。';
    body.append(missing);
  }

  item.append(checkbox, body);
  return item;
}

function render(): void {
  const nodes = rows.map((row) => buildRow(row));
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = '模型没有给出任何可写入的结论。';
    nodes.push(empty);
  }
  knowledgeGraphRelationGroupsElement.replaceChildren(...nodes);
  updateSelection();
}

function finish(result: Set<string> | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  rows = [];
  accepted = new Set();
  paperTitles = new Map();
  resolve?.(result);
}

function close(result: Set<string> | null): void {
  finish(result);
  dismissAnimatedDialog(knowledgeGraphRelationDialog);
}

/**
 * Shows the verdicts and resolves with the accepted pair keys, or `null` when the
 * dialog was dismissed.
 *
 * `null` is not an empty set: both mean "write nothing", but the caller reports them
 * differently, and collapsing them would lose the fact that the user dismissed the
 * review rather than deciding about every pair.
 */
export function openRelationReviewDialog(
  input: RelationReviewDialogInput,
): Promise<Set<string> | null> {
  return new Promise<Set<string> | null>((resolve) => {
    pendingResolve = resolve;
    rows = [...input.rows];
    // Everything is accepted up front: the model's output is what the user paid for,
    // and a review that starts at "write nothing" would make the common case the
    // slow one.
    accepted = new Set(rows.map((row) => row.pairKey));
    paperTitles = input.paperTitles;
    const model = input.model ? `，模型 ${input.model}` : '';
    const rejected = input.rejectedCount
      ? `，另有 ${input.rejectedCount} 条无法解析（不会写入）`
      : '';
    knowledgeGraphRelationSummaryElement.textContent =
      `${rows.length} 条结论待确认${model}${rejected}。`;
    render();
    showAnimatedDialog(knowledgeGraphRelationDialog);
  });
}

export function registerRelationReviewEvents(): void {
  knowledgeGraphRelationSelectAllButton.addEventListener('click', () => {
    accepted = new Set(rows.map((row) => row.pairKey));
    render();
  });
  knowledgeGraphRelationSelectNoneButton.addEventListener('click', () => {
    accepted = new Set();
    render();
  });
  knowledgeGraphRelationWriteButton.addEventListener('click', () => {
    // A copy: the dialog's state is reset before the caller reads it.
    close(new Set(accepted));
  });
  knowledgeGraphRelationDiscardButton.addEventListener('click', () => close(null));
  knowledgeGraphRelationCloseButton.addEventListener('click', () => close(null));

  knowledgeGraphRelationDialog.addEventListener('cancel', (event) => {
    // Escape declines the write rather than accepting on the user's behalf.
    event.preventDefault();
    close(null);
  });
}
