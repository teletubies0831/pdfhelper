import {
  ENTITY_TYPES,
  confirmEntityCandidates,
  dismissEntityCandidates,
  loadPendingReview,
  knowledgeGraphRepository,
  type AcceptedCandidate,
  type EntityType,
  type PendingReviewCandidate,
  type PendingReviewGroup,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import { createAnnotationController } from './entity-review-annotations';
import {
  knowledgeGraphReviewCloseButton,
  knowledgeGraphReviewConfirmButton,
  knowledgeGraphReviewDialog,
  knowledgeGraphReviewGroupsElement,
  knowledgeGraphReviewLaterButton,
  knowledgeGraphReviewSelectAllButton,
  knowledgeGraphReviewSelectionElement,
  knowledgeGraphReviewSelectNoneButton,
  knowledgeGraphReviewShowLowInput,
  knowledgeGraphReviewSummaryElement,
  knowledgeGraphReviewTitleElement,
  knowledgeGraphReviewTranslateField,
  knowledgeGraphReviewTranslateInput,
  knowledgeGraphReviewSynonymField,
  knowledgeGraphReviewSynonymInput,
} from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';
import { showAppError } from '../../app/error-dialog';

/**
 * Candidate confirmation dialog.
 *
 * This is the "user does the fine work" half of the design: the model proposes,
 * the user decides. Three rules shape the interaction:
 *
 * - Multi-select is the primary affordance (per row, per type, and globally).
 *   Confirming entities one at a time would make the feature unusable at the
 *   scale extraction produces.
 * - High confidence starts ticked, everything else is listed but unticked. The
 *   dialog never pre-selects something the score cannot justify.
 * - Editing a name or type marks the row as hand-corrected, which is surfaced to
 *   the user rather than applied silently, and suppresses the "never ask again"
 *   shortcut on that row.
 */

interface DraftRow {
  entityId: string;
  original: PendingReviewCandidate;
  name: string;
  type: EntityType;
  selected: boolean;
  dirty: boolean;
  /** Other spellings the paper used; carried through on confirm, not edited here. */
  aliases: string[];
}

export interface ReviewDialogResult {
  confirmedCount: number;
  skippedCount: number;
  edgesWritten: number;
}

let rows: DraftRow[] = [];
/** Rows dismissed with 忽略 / 不再提示 during this review; the records themselves are untouched. */
let droppedCount = 0;
/** Resolves the promise returned by `openEntityReviewDialog`. */
let pendingResolve: ((result: ReviewDialogResult | null) => void) | null = null;
/** Reason the dialog closed, so the caller can distinguish confirm from dismiss. */
let lastResult: ReviewDialogResult | null = null;

/**
 * The optional, token-spending annotations on each row: the Chinese gloss and the "same concept as …"
 * suggestion. In its own module because it is a self-contained subsystem (one request per turn of a
 * switch, failures reported in the row) and the dialog's job is what gets confirmed, not this.
 */
const annotations = createAnnotationController({
  onChange: () => { renderGroups(); },
  onApplySynonym: (name, canonical) => { applySynonym(name, canonical); },
});

export const ENTITY_REVIEW_DIALOG_TITLE = '确认候选实体';

/** Accessible name for the dialog, kept next to its behaviour. */
export function getEntityReviewDialogTitle(): string {
  return knowledgeGraphReviewTitleElement.textContent?.trim() || ENTITY_REVIEW_DIALOG_TITLE;
}

export function isEntityReviewOpen(): boolean {
  return knowledgeGraphReviewDialog.open;
}

/** Row counts for diagnostics and tests; never used by the UI itself. */
export function getEntityReviewRowStats(): {
  total: number;
  visible: number;
  selected: number;
  preCheckedFlags: boolean[];
} {
  return {
    total: rows.length,
    visible: visibleRows().length,
    selected: rows.filter((row) => row.selected).length,
    preCheckedFlags: rows.map((row) => row.original.preChecked),
  };
}

function buildRows(groups: readonly PendingReviewGroup[]): DraftRow[] {
  const built: DraftRow[] = [];
  for (const group of groups) {
    for (const candidate of group.candidates) {
      built.push({
        entityId: candidate.entityId,
        original: candidate,
        name: candidate.name,
        type: candidate.type,
        selected: candidate.preChecked,
        dirty: false,
        aliases: [...(candidate.aliases ?? [])],
      });
    }
  }
  return built;
}

function visibleRows(): DraftRow[] {
  if (knowledgeGraphReviewShowLowInput.checked) return rows;
  // "Low confidence" is exactly "did not start ticked", so the same threshold
  // governs both the pre-check and the default visibility.
  return rows.filter((row) => row.original.preChecked);
}

/**
 * Applies a synonym suggestion by renaming the row and keeping the old spelling as an alias.
 *
 * The same two edits the user would have made by hand: the dialog deliberately has no private merge
 * path, because a second way to fold two entities together is a second way to get it wrong.
 */
function applySynonym(name: string, canonical: string): void {
  const row = rows.find((candidate) => candidate.original.name.trim() === name);
  if (!row) return;
  const previous = row.name;
  row.name = canonical;
  row.dirty = row.dirty || canonical !== row.original.name;
  if (previous !== canonical && !row.aliases.includes(previous)) {
    row.aliases = [...row.aliases, previous];
  }
  renderGroups();
}
/**
 * Removes a row from this review **and** from the pending list.
 *
 * The local removal is what the user sees; the write is what makes the badge and the next opening
 * agree with it. Before this, the row vanished but the candidate stayed pending — so the count never
 * moved and the same row was back the next time the dialog opened, which reads as a broken button.
 *
 * `remember` is the difference between the two buttons: 不再提示 also puts the name on the ignore
 * list, so extraction stops proposing it; 忽略 only rejects it for now.
 */
async function dismissRow(row: DraftRow, remember: boolean): Promise<void> {
  try {
    await dismissEntityCandidates([row.entityId], knowledgeGraphRepository, { remember });
    dropRow(row.entityId);
    setStatus(
      remember
        ? `已忽略“${row.original.name}”，之后抽取不再提示。`
        : `已忽略“${row.original.name}”（本次不再列出，重新抽取仍可能出现）。`,
    );
  } catch (error) {
    // Keep the row: the write failed, so the row must not pretend to be gone.
    setStatus(
      `无法忽略该候选：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

function updateSelectionSummary(): void {
  const selected = rows.filter((row) => row.selected).length;
  const dirty = rows.filter((row) => row.dirty).length;
  knowledgeGraphReviewSelectionElement.textContent = [
    `已选 ${selected} / ${rows.length}`,
    dirty ? `人工修正 ${dirty}` : '',
    droppedCount ? `已忽略 ${droppedCount}` : '',
  ].filter(Boolean).join(' · ');
  // Nothing left to confirm: the action must be visibly unavailable rather than clicking into an
  // error message.
  knowledgeGraphReviewConfirmButton.disabled = rows.length === 0;
  updateHeaderSummary();
}

/**
 * Removes a row from this review.
 *
 * The entity record itself is untouched — this is a decision about the current list, not a deletion.
 * Reopening the dialog shows the candidate again (unless it went into the ignore list), which is what
 * "保留记录，之后仍可确认" means.
 */
function dropRow(entityId: string): void {
  rows = rows.filter((row) => row.entityId !== entityId);
  // Counted unconditionally: the summary records what the user dismissed in this session, which is a
  // different fact from how many rows happen to remain.
  droppedCount += 1;
  renderGroups();
}

/** Header line, recomputed after rows are removed so the counts never overstate what is left. */
function updateHeaderSummary(): void {
  if (!rows.length && !droppedCount) {
    knowledgeGraphReviewSummaryElement.textContent = '目前没有待确认的候选实体。';
    return;
  }
  if (!rows.length) {
    knowledgeGraphReviewSummaryElement.textContent =
      `本次的 ${droppedCount} 个候选都已忽略；记录保留，下次抽取仍会出现（加入忽略名单的除外）。`;
    return;
  }
  const preChecked = rows.filter((row) => row.original.preChecked).length;
  knowledgeGraphReviewSummaryElement.textContent = [
    `共 ${rows.length} 个候选`,
    `其中 ${preChecked} 个高置信度已默认勾选`,
    droppedCount ? `已忽略 ${droppedCount} 个` : '',
  ].filter(Boolean).join('，').replace('，已忽略', '；已忽略');
}

function renderGroups(): void {
  const visible = visibleRows();
  const byType = new Map<EntityType, DraftRow[]>();
  for (const row of visible) {
    const bucket = byType.get(row.type);
    if (bucket) bucket.push(row);
    else byType.set(row.type, [row]);
  }

  const nodes: HTMLElement[] = [];
  for (const type of ENTITY_TYPES) {
    const typeRows = byType.get(type);
    if (!typeRows?.length) continue;

    const section = document.createElement('section');
    section.className = 'knowledge-graph-review-group';

    const heading = document.createElement('header');
    heading.className = 'knowledge-graph-review-group-heading';
    const headingText = document.createElement('h3');
    headingText.textContent = `${type}（${typeRows.length}）`;
    const groupActions = document.createElement('div');
    groupActions.className = 'knowledge-graph-review-group-actions';
    for (const [label, value] of [['全选', true], ['清空', false]] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'knowledge-graph-action';
      button.textContent = label;
      button.addEventListener('click', () => {
        for (const row of typeRows) row.selected = value;
        renderGroups();
      });
      groupActions.append(button);
    }
    heading.append(headingText, groupActions);
    section.append(heading);

    const list = document.createElement('ul');
    list.className = 'knowledge-graph-review-list';
    for (const row of typeRows) list.append(buildRowElement(row));
    section.append(list);
    nodes.push(section);
  }

  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = rows.length
      ? '没有符合当前筛选的候选，勾选“显示低置信度候选”可以查看全部。'
      : '目前没有待确认的候选实体。';
    nodes.push(empty);
  }

  knowledgeGraphReviewGroupsElement.replaceChildren(...nodes);
  updateSelectionSummary();
}

function buildRowElement(row: DraftRow): HTMLElement {
  const item = document.createElement('li');
  item.className = 'knowledge-graph-review-row';
  item.toggleAttribute('data-dirty', row.dirty);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = row.selected;
  checkbox.setAttribute('aria-label', `确认 ${row.name}`);
  checkbox.addEventListener('change', () => {
    row.selected = checkbox.checked;
    updateSelectionSummary();
  });

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'knowledge-graph-review-name';
  nameInput.value = row.name;
  nameInput.setAttribute('aria-label', '实体名称');
  nameInput.addEventListener('change', () => {
    const next = nameInput.value.trim();
    if (!next) {
      nameInput.value = row.name;
      return;
    }
    row.name = next;
    row.dirty = row.dirty || next !== row.original.name;
    item.toggleAttribute('data-dirty', row.dirty);
    checkbox.setAttribute('aria-label', `确认 ${row.name}`);
    updateSelectionSummary();
  });

  body.append(nameInput);

  // Other spellings the paper used for the same thing. Shown because they are what makes a later
  // `BP heuristic` land on this entity instead of becoming a twin — and because a name the user is
  // about to confirm should come with the names it will absorb.
  if (row.aliases.length) {
    const aliasLine = document.createElement('div');
    aliasLine.className = 'knowledge-graph-review-aliases';
    aliasLine.textContent = `别名：${row.aliases.join('、')}`;
    aliasLine.title = '论文里对同一概念的其它写法；确认后它们会作为别名保存在该实体上';
    body.append(aliasLine);
  }

  const suggestion = annotations.synonymLine(row.original.name);
  if (suggestion) body.append(suggestion);

  // The Chinese gloss sits directly under the name it translates, and is keyed by the *extracted*
  // name: renaming the row does not invalidate it, because the gloss explains what the paper
  // called the concept, not what the user decided to call it.
  const gloss = annotations.glossLine(row.original.name);
  if (gloss) body.append(gloss);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-review-row-meta';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'knowledge-graph-review-type';
  typeSelect.setAttribute('aria-label', '实体类型');
  for (const type of ENTITY_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    option.selected = type === row.type;
    typeSelect.append(option);
  }
  typeSelect.addEventListener('change', () => {
    const next = typeSelect.value as EntityType;
    row.type = next;
    row.dirty = row.dirty || next !== row.original.type;
    item.toggleAttribute('data-dirty', row.dirty);
    updateSelectionSummary();
  });

  const confidence = document.createElement('span');
  confidence.className = 'knowledge-graph-review-confidence';
  confidence.textContent = row.original.confidence.toFixed(2);
  confidence.title = '模型给出的置信度';

  meta.append(typeSelect, confidence);

  if (row.original.paperId) {
    // A paper *title*, not the graph id: `来源 @816707a` names nothing the user can
    // recognise, while the title is the document they are looking at.
    const label = sourceLabel(row.original.paperId);
    if (label) {
      const source = document.createElement('span');
      source.className = 'knowledge-graph-review-source';
      source.textContent = label;
      source.title = label;
      meta.append(source);
    }
  }

  // First evidence quote only: the dialog is a triage surface, and the full
  // evidence list belongs in the graph inspector after confirmation.
  const quote = row.original.evidence.find((item) => item.quote.trim());
  body.append(meta);
  if (quote) {
    const quoteElement = document.createElement('blockquote');
    quoteElement.className = 'knowledge-graph-review-quote';
    quoteElement.textContent = `第 ${quote.pageNumber} 页：${quote.quote}`;
    body.append(quoteElement);
  }

  const actions = document.createElement('div');
  actions.className = 'knowledge-graph-review-row-actions';

  const ignoreButton = document.createElement('button');
  ignoreButton.type = 'button';
  ignoreButton.className = 'knowledge-graph-action';
  ignoreButton.textContent = '忽略';
  ignoreButton.title = '这次不要：从待确认列表移除（再次抽取仍可能重新提出）';
  ignoreButton.addEventListener('click', () => {
    void dismissRow(row, false);
  });

  const neverButton = document.createElement('button');
  neverButton.type = 'button';
  neverButton.className = 'knowledge-graph-action';
  neverButton.textContent = '不再提示';
  neverButton.title = '永久忽略：写进忽略名单，之后抽取也不再提出';
  neverButton.addEventListener('click', () => {
    void dismissRow(row, true);
  });

  actions.append(ignoreButton, neverButton);
  item.append(checkbox, body, actions);
  return item;
}

async function confirmSelection(): Promise<void> {
  const selected = rows.filter((row) => row.selected);
  if (!selected.length) {
    setStatus('没有勾选任何候选实体。', true);
    return;
  }

  // A confirmation can span several papers when the user reviews a session's
  // worth of candidates, so group by paper and confirm per paper: the plan is
  // built around one paper's `Paper -> Entity` edges.
  const byPaper = new Map<string, AcceptedCandidate[]>();
  for (const row of selected) {
    const paperId = row.original.paperId || 'unknown';
    const bucket = byPaper.get(paperId);
    if (bucket) bucket.push(rowToAccepted(row));
    else byPaper.set(paperId, [rowToAccepted(row)]);
  }

  let edgesWritten = 0;
  let confirmedCount = 0;
  for (const [paperId, candidates] of byPaper) {
    if (paperId === 'unknown') continue;
    const result = await confirmEntityCandidates(
      candidates,
      paperId,
      knowledgeGraphRepository,
      { edgeType: 'MENTIONS' },
    );
    edgesWritten += result.edgesWritten;
    confirmedCount += result.createdEntityIds.length + result.reusedEntityIds.length;
  }

  lastResult = {
    confirmedCount,
    // Rows removed with 忽略 / 不再提示 were decisions too: they are not "selected", and they must
    // not be silently counted as if the dialog never showed them.
    skippedCount: rows.length - selected.length + droppedCount,
    edgesWritten,
  };
  // The names that actually entered the graph, deduplicated by the name the store now holds.
  const confirmedNames = [...new Set(
    selected.map((row) => row.name.trim()).filter(Boolean),
  )];
  if (confirmedNames.length) explainer?.([...confirmedNames]);
  dismissAnimatedDialog(knowledgeGraphReviewDialog);
}

function rowToAccepted(row: DraftRow): AcceptedCandidate {
  return {
    name: row.name,
    type: row.type,
    confidence: row.original.confidence,
    evidence: row.original.evidence,
    // The paper's other names travel with the confirmation: dropping them here would throw away the
    // only signal that can recognise this entity under its abbreviation next time.
    ...(row.aliases.length ? { aliases: row.aliases } : {}),
  };
}

function closeWithResult(result: ReviewDialogResult | null): void {
  lastResult = result;
  dismissAnimatedDialog(knowledgeGraphReviewDialog);
}

/**
 * Opens the dialog and resolves with the outcome, or `null` when dismissed.
 *
 * The promise resolves from the `close` event rather than from each button, so
 * Escape and backdrop dismissal follow the same path as the buttons instead of
 * leaving the caller waiting forever.
 */
/**
 * Paper titles by graph paper id, supplied by the caller.
 *
 * The dialog only knows the ids its candidates carry, and an id is an internal
 * identifier (`来源 @816707a`) that means nothing to the person deciding. Titles live in
 * the graph snapshot, which the action layer already holds.
 */
let paperTitles: ReadonlyMap<string, string> = new Map();

export interface EntityReviewOptions {
  paperTitles?: ReadonlyMap<string, string>;
  /**
   * Fetches Chinese glosses for extracted names.
   *
   * Injected rather than called here so this dialog stays free of network and provider settings,
   * and so the browser test can drive the whole interaction without an API key.
   */
  translate?: (terms: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /**
   * Asks which of these names mean the same thing.
   *
   * Same injection reason as `translate`, plus one of its own: the answer is only ever turned into
   * a *rename* by the user, so the dialog needs a promise of suggestions, not a merge facility.
   */
  findSynonyms?: (terms: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /**
   * Told which names just entered the graph, so a short meaning can be generated for them.
   *
   * Called after the write and never awaited: the user's confirmation is already complete, and an
   * explanation is a reading aid that must not delay the dialog closing or be able to fail it.
   * Injected for the same reason as `translate` — this dialog stays free of the network — and it is
   * what makes the browser test able to assert the call without an API key.
   */
  explain?: (names: readonly string[]) => void;
}

/** Set by each opening, like `paperTitles`; the confirmation calls it and never awaits it. */
let explainer: ((names: readonly string[]) => void) | null = null;

/** Names currently on screen: the annotations only ever pay for what the user can see. */
function visibleNames(): string[] {
  return [...new Set(visibleRows().map((row) => row.original.name.trim()))].filter(Boolean);
}
function sourceLabel(paperId: string): string | null {
  const title = paperTitles.get(paperId)?.trim();
  if (title) return `来源 ${title}`;
  // No title known: say nothing rather than print a truncated id the reader cannot
  // interpret or look up.
  return null;
}

export function openEntityReviewDialog(
  options: EntityReviewOptions = {},
): Promise<ReviewDialogResult | null> {
  paperTitles = options.paperTitles instanceof Map ? options.paperTitles : new Map();
  // A new opening starts with both annotations off: they cost tokens, so it is the user's call, and
  // the translator's own cache is what makes turning one back on cheap rather than free.
  annotations.reset({ translate: options.translate, findSynonyms: options.findSynonyms });
  explainer = options.explain ?? null;
  droppedCount = 0;
  return new Promise<ReviewDialogResult | null>((resolve) => {
    pendingResolve = resolve;
    void (async () => {
      try {
        const review = await loadPendingReview(knowledgeGraphRepository);
        rows = buildRows(review.groups);
        knowledgeGraphReviewShowLowInput.checked = false;
        knowledgeGraphReviewConfirmButton.disabled = review.total === 0;
        // The header counts come from `rows`, so there is one source of truth once rows can be
        // removed.
        renderGroups();
        showAnimatedDialog(knowledgeGraphReviewDialog);
      } catch (error) {
        // Never leave the caller hanging: this promise only settles on close, so an
        // exception on the open path used to keep the awaiting action pending forever.
        pendingResolve = null;
        rows = [];
        showAppError(error instanceof Error ? error.message : String(error), {
          title: '无法打开候选实体列表',
        });
        resolve(null);
      }
    })();
  });
}

/** Refreshes the open dialog after extraction added candidates. */
export async function refreshEntityReviewIfOpen(): Promise<void> {
  if (!knowledgeGraphReviewDialog.open) return;
  const review = await loadPendingReview(knowledgeGraphRepository);
  rows = buildRows(review.groups);
  droppedCount = 0;
  renderGroups();
}

export function registerEntityReviewEvents(): void {
  knowledgeGraphReviewCloseButton.addEventListener('click', () => closeWithResult(null));
  knowledgeGraphReviewLaterButton.addEventListener('click', () => closeWithResult(null));
  knowledgeGraphReviewConfirmButton.addEventListener('click', () => {
    void confirmSelection();
  });
  knowledgeGraphReviewShowLowInput.addEventListener('change', renderGroups);
  knowledgeGraphReviewTranslateInput.addEventListener('change', () => {
    void annotations.setGlossEnabled(knowledgeGraphReviewTranslateInput.checked, visibleNames());
  });
  knowledgeGraphReviewSynonymInput.addEventListener('change', () => {
    void annotations.setSynonymEnabled(knowledgeGraphReviewSynonymInput.checked, visibleNames());
  });
  knowledgeGraphReviewSelectAllButton.addEventListener('click', () => {
    for (const row of rows) row.selected = true;
    renderGroups();
  });
  knowledgeGraphReviewSelectNoneButton.addEventListener('click', () => {
    for (const row of rows) row.selected = false;
    renderGroups();
  });

  // Dismissal paths (Escape, backdrop) must resolve the caller's promise too.
  knowledgeGraphReviewDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeWithResult(null);
  });
  knowledgeGraphReviewDialog.addEventListener('close', () => {
    const result = lastResult;
    lastResult = null;
    rows = [];
    droppedCount = 0;
    annotations.reset({});
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(result);
  });
}
