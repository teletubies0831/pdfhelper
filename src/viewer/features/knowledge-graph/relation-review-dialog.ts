import {
  describeBridgeDrops,
  describeEdgeType,
  ENTITY_TYPES,
  normalizeEntityName,
  totalBridgeDrops,
  type BridgeDropStats,
  type EntityType,
  type JudgementReviewRow,
  type ManualBridgeInput,
  type RelationBridgeSuggestion,
  type RelationReviewAcceptance,
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
 * Three things happen here, and they are deliberately in one screen because they are one decision:
 *
 * - **Relations** are accepted per pair, positively, with their evidence.
 * - **Bridge concepts** are accepted per concept: the user can keep "A extends B" and refuse the
 *   concept offered to illustrate it. Unticking means the concept is discarded outright — not
 *   demoted to the pending list, because the user is looking straight at it now.
 * - **Refused negatives** can be replaced by a node the user types. Accepting "no relation" and
 *   writing a node are mutually exclusive for the same pair, so typing one unticks the other.
 */

export interface RelationReviewDialogInput {
  rows: JudgementReviewRow[];
  /** Titles by paper id, so a pair reads as two papers rather than two ids. */
  paperTitles: ReadonlyMap<string, string>;
  model?: string;
  /** Verdicts the parser could not read, reported so the count adds up. */
  rejectedCount?: number;
  /** Bridge suggestions the local checks refused, so the report is not silently dropped. */
  bridgeDrops?: BridgeDropStats;
  /** Normalized names already in the graph, so a bridge can say it will reuse one. */
  existingEntityNames?: ReadonlySet<string>;
}

let rows: JudgementReviewRow[] = [];
let acceptedPairs = new Set<string>();
let acceptedBridges = new Set<string>();
let manualBridges: ManualBridgeInput[] = [];
let paperTitles: ReadonlyMap<string, string> = new Map();
let existingEntityNames: ReadonlySet<string> = new Set();
let negativesExpanded = false;
let pendingResolve: ((accepted: RelationReviewAcceptance | null) => void) | null = null;

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

function allBridgeKeys(): string[] {
  return rows.flatMap((row) => row.bridges.map((bridge) => bridge.bridgeKey));
}

function bridgeCount(): number {
  return allBridgeKeys().length;
}

function updateSelection(): void {
  const total = rows.length;
  const bridgeTotal = bridgeCount();
  knowledgeGraphRelationSelectionElement.textContent = total
    ? `已选 ${acceptedPairs.size} / ${total} 对`
      + (bridgeTotal ? ` · 桥接实体 ${acceptedBridges.size} / ${bridgeTotal}` : '')
      + (manualBridges.length ? ` · 手写节点 ${manualBridges.length}` : '')
    : '';
  const anything = acceptedPairs.size > 0 || manualBridges.length > 0;
  knowledgeGraphRelationWriteButton.disabled = !anything;
  knowledgeGraphRelationWriteButton.textContent = acceptedPairs.size
    ? `写入所选（${acceptedPairs.size}）`
    : manualBridges.length ? `写入手写节点（${manualBridges.length}）` : '写入所选';
}

/** Bridge rows: one checkbox each, because each is a separate suggestion. */
function buildBridgeList(row: JudgementReviewRow): HTMLElement | null {
  if (!row.bridges.length) return null;
  const list = document.createElement('ul');
  list.className = 'knowledge-graph-bridge-list';
  for (const bridge of row.bridges) {
    list.append(buildBridgeRow(row, bridge));
  }
  return list;
}

function buildBridgeRow(
  row: JudgementReviewRow,
  bridge: RelationBridgeSuggestion,
): HTMLElement {
  const item = document.createElement('li');
  item.className = 'knowledge-graph-bridge-row';

  const label = document.createElement('label');
  label.className = 'knowledge-graph-bridge-label';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = acceptedBridges.has(bridge.bridgeKey);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) acceptedBridges.add(bridge.bridgeKey);
    else acceptedBridges.delete(bridge.bridgeKey);
    updateSelection();
  });

  const name = document.createElement('span');
  name.className = 'knowledge-graph-bridge-name';
  name.textContent = bridge.name;

  const type = document.createElement('span');
  type.className = 'knowledge-graph-bridge-type';
  type.textContent = bridge.type;

  const state = document.createElement('span');
  state.className = 'knowledge-graph-bridge-state';
  const reuses = existingEntityNames.has(normalizeEntityName(bridge.name));
  state.textContent = reuses ? '复用已有实体' : '新增实体';
  state.toggleAttribute('data-reuse', reuses);

  label.append(checkbox, name, type, state);
  item.append(label);

  if (bridge.reason) {
    const reason = document.createElement('p');
    reason.className = 'knowledge-graph-review-row-meta';
    reason.textContent = bridge.reason;
    item.append(reason);
  }
  // The two quotes are the whole reason this suggestion is trustworthy, so they are shown — as a
  // title attribute rather than a paragraph: the row already has a relation's evidence to display.
  item.title = bridge.evidence
    .map((entry: { paperId: string; quote: string }) => `${paperLabel(entry.paperId)}：${entry.quote}`)
    .join('\n');
  return item;
}

/** The form a user fills in to replace a refused "no relation". */
function buildManualForm(row: JudgementReviewRow): HTMLElement {
  const form = document.createElement('div');
  form.className = 'knowledge-graph-manual-form';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '节点名称，例如 Booth 乘法器';
  nameInput.className = 'knowledge-graph-manual-name';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'knowledge-graph-manual-type';
  for (const type of ENTITY_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    typeSelect.append(option);
  }

  const descriptionInput = document.createElement('input');
  descriptionInput.type = 'text';
  descriptionInput.placeholder = '一句话含义（可选）';
  descriptionInput.className = 'knowledge-graph-manual-description';

  const note = document.createElement('p');
  note.className = 'knowledge-graph-manual-note';
  note.textContent = '你填的节点会用「用户标注」连到这两篇文献，并作废这一对的「无关」结论。';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'knowledge-graph-action';
  save.textContent = '保存节点';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'knowledge-graph-action';
  cancel.textContent = '取消';

  const error = document.createElement('p');
  error.className = 'knowledge-graph-manual-error';
  error.hidden = true;

  save.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      error.hidden = false;
      error.textContent = '请填写节点名称。';
      return;
    }
    manualBridges = [
      ...manualBridges.filter((entry) => entry.pairKey !== row.pairKey),
      {
        pairKey: row.pairKey,
        name,
        type: typeSelect.value as EntityType,
        ...(descriptionInput.value.trim() ? { description: descriptionInput.value.trim() } : {}),
      },
    ];
    // Writing a node and accepting "no relation" would be two contradictory claims about the same pair.
    acceptedPairs.delete(row.pairKey);
    render();
  });
  cancel.addEventListener('click', () => {
    form.remove();
  });

  const actions = document.createElement('div');
  actions.className = 'knowledge-graph-manual-actions';
  actions.append(save, cancel);

  form.append(nameInput, typeSelect, descriptionInput, note, actions, error);
  return form;
}

function buildRow(row: JudgementReviewRow): HTMLElement {
  const item = document.createElement('li');
  item.className = 'knowledge-graph-review-row';
  item.toggleAttribute('data-negative', row.verdict === 'NONE');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = acceptedPairs.has(row.pairKey);
  checkbox.setAttribute(
    'aria-label',
    `写入 ${paperLabel(row.leftPaperId)} 与 ${paperLabel(row.rightPaperId)} 的结论`,
  );
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) acceptedPairs.add(row.pairKey);
    else acceptedPairs.delete(row.pairKey);
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

  const bridges = buildBridgeList(row);
  if (bridges) body.append(bridges);

  if (row.verdict === 'NONE') {
    const manual = manualBridges.find((entry) => entry.pairKey === row.pairKey);
    if (manual) {
      const chip = document.createElement('p');
      chip.className = 'knowledge-graph-manual-chip';
      chip.textContent = `你将写入自己的节点：${manual.name}（${manual.type}）`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'knowledge-graph-action';
      remove.textContent = '撤销';
      remove.addEventListener('click', () => {
        manualBridges = manualBridges.filter((entry) => entry.pairKey !== row.pairKey);
        acceptedPairs.add(row.pairKey);
        render();
      });
      chip.append(remove);
      body.append(chip);
    } else {
      const write = document.createElement('button');
      write.type = 'button';
      write.className = 'knowledge-graph-action knowledge-graph-manual-open';
      write.textContent = '不认可，自己写一个节点';
      write.addEventListener('click', () => {
        item.append(buildManualForm(row));
        write.disabled = true;
      });
      body.append(write);
    }
  }

  item.append(checkbox, body);
  return item;
}

function render(): void {
  const positives = rows.filter((row) => row.verdict !== 'NONE');
  const negatives = rows.filter((row) => row.verdict === 'NONE');
  const nodes: HTMLElement[] = [];

  const sectionTitle = (text: string): HTMLElement => {
    const heading = document.createElement('h3');
    heading.className = 'knowledge-graph-review-section';
    heading.textContent = text;
    return heading;
  };

  if (positives.length) {
    nodes.push(sectionTitle(`有关系的论文对（${positives.length}）`));
    nodes.push(...positives.map((row) => buildRow(row)));
  }

  if (negatives.length) {
    // Folded by default: the user came here looking for connections, and a wall of "no relation" rows
    // pushed the answer below the fold. The count stays visible so nothing is hidden silently.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'knowledge-graph-action knowledge-graph-negatives-toggle';
    toggle.textContent = negativesExpanded
      ? `收起无关的 ${negatives.length} 对`
      : `展开无关的 ${negatives.length} 对（可自己写节点）`;
    toggle.addEventListener('click', () => {
      negativesExpanded = !negativesExpanded;
      render();
    });
    nodes.push(toggle);
    if (negativesExpanded) nodes.push(...negatives.map((row) => buildRow(row)));
  }

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = '模型没有给出任何可写入的结论。';
    nodes.push(empty);
  }

  knowledgeGraphRelationGroupsElement.replaceChildren(...nodes);
  updateSelection();
}

function finish(result: RelationReviewAcceptance | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  rows = [];
  acceptedPairs = new Set();
  acceptedBridges = new Set();
  manualBridges = [];
  paperTitles = new Map();
  existingEntityNames = new Set();
  negativesExpanded = false;
  resolve?.(result);
}

function close(result: RelationReviewAcceptance | null): void {
  finish(result);
  dismissAnimatedDialog(knowledgeGraphRelationDialog);
}

/**
 * Shows the verdicts and resolves with what the user kept, or `null` when the
 * dialog was dismissed.
 *
 * `null` is not an empty selection: both mean "write nothing", but the caller reports them
 * differently, and collapsing them would lose the fact that the user dismissed the
 * review rather than deciding about every pair.
 */
export function openRelationReviewDialog(
  input: RelationReviewDialogInput,
): Promise<RelationReviewAcceptance | null> {
  return new Promise<RelationReviewAcceptance | null>((resolve) => {
    pendingResolve = resolve;
    rows = [...input.rows];
    // Everything is accepted up front: the model's output is what the user paid for,
    // and a review that starts at "write nothing" would make the common case the
    // slow one.
    acceptedPairs = new Set(rows.map((row) => row.pairKey));
    acceptedBridges = new Set(allBridgeKeys());
    manualBridges = [];
    negativesExpanded = false;
    paperTitles = input.paperTitles;
    existingEntityNames = input.existingEntityNames ?? new Set();
    const model = input.model ? `，模型 ${input.model}` : '';
    const rejected = input.rejectedCount
      ? `，另有 ${input.rejectedCount} 条无法解析（不会写入）`
      : '';
    const relations = rows.filter((row) => row.verdict !== 'NONE').length;
    const dropped = input.bridgeDrops && totalBridgeDrops(input.bridgeDrops)
      ? describeBridgeDrops(input.bridgeDrops)
      : '';
    knowledgeGraphRelationSummaryElement.textContent =
      `${rows.length} 条结论待确认（${relations} 条关系、${rows.length - relations} 对无关）`
      + `${bridgeCount() ? `，另有 ${bridgeCount()} 个桥接实体` : ''}${model}${rejected}。${dropped}`;
    render();
    showAnimatedDialog(knowledgeGraphRelationDialog);
  });
}

export function registerRelationReviewEvents(): void {
  knowledgeGraphRelationSelectAllButton.addEventListener('click', () => {
    acceptedPairs = new Set(rows.map((row) => row.pairKey));
    acceptedBridges = new Set(allBridgeKeys());
    render();
  });
  knowledgeGraphRelationSelectNoneButton.addEventListener('click', () => {
    acceptedPairs = new Set();
    acceptedBridges = new Set();
    manualBridges = [];
    render();
  });
  knowledgeGraphRelationWriteButton.addEventListener('click', () => {
    // A copy: the dialog's state is reset before the caller reads it.
    close({
      acceptedPairKeys: new Set(acceptedPairs),
      acceptedBridgeKeys: new Set(acceptedBridges),
      manualBridges: [...manualBridges],
    });
  });
  knowledgeGraphRelationDiscardButton.addEventListener('click', () => close(null));
  knowledgeGraphRelationCloseButton.addEventListener('click', () => close(null));

  knowledgeGraphRelationDialog.addEventListener('cancel', (event) => {
    // Escape declines the write rather than accepting on the user's behalf.
    event.preventDefault();
    close(null);
  });
}
