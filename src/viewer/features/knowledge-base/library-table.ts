import {
  knowledgeTableBodyElement,
  knowledgeTableEmptyElement,
  knowledgeTableSortButtons,
} from '../../app/viewer-elements';
import { readReadingStatus, READING_STATUS_LABELS, readDocumentMetadata } from '../../../modules/knowledge/public';
import type { KnowledgeLibraryDocument } from '../../../modules/knowledge/public';
import { resumePointOf } from './resume-reading';
import {
  DEFAULT_LIBRARY_SORT,
  indexState,
  overviewState,
  relatedState,
  type LibrarySortKey,
  type LibrarySortState,
  type StateRank,
} from './library-table-model';

/**
 * The dense library table.
 *
 * A row answers three questions without opening anything: how far along is this paper, and which of the three AI steps
 * (index / overview / related papers) are done. The card grid could only fit two states in a line of grey text, which
 * is why "what still needs doing" was invisible in a library of more than a handful of documents.
 *
 * State columns show **completion**, not values: `✓` done, `…` running, `!` failed, `·` not started. That is what makes
 * the column worth scanning; a number of chunks is detail for the inspector. The order and the ranking themselves live
 * in `library-table-model.ts`; this file only draws them.
 */

/** Reads the sort encoded on the header buttons (`data-knowledge-sort`), so the DOM is the single source of truth. */
export function readLibrarySort(): LibrarySortState {
  const active = knowledgeTableSortButtons.find(
    (button) => button.dataset.sortDirection !== undefined,
  );
  const key = active?.dataset.knowledgeSort as LibrarySortKey | undefined;
  if (!key) return DEFAULT_LIBRARY_SORT;
  return { key, descending: active?.dataset.sortDirection === 'desc' };
}

/** Marks the active column and its direction, so a second click on the same header reverses it. */
export function renderLibrarySortIndicators(sort: LibrarySortState | null): void {
  for (const button of knowledgeTableSortButtons) {
    // `null` means "no column order is in effect" — the 待读 queue uses its own order, and a highlighted header would claim
    // otherwise.
    const active = Boolean(sort) && button.dataset.knowledgeSort === sort?.key;
    if (!active || !sort) {
      delete button.dataset.sortDirection;
      button.removeAttribute('aria-sort');
      button.classList.remove('is-sorted');
      continue;
    }
    button.dataset.sortDirection = sort.descending ? 'desc' : 'asc';
    button.setAttribute('aria-sort', sort.descending ? 'descending' : 'ascending');
    button.classList.add('is-sorted');
    button.dataset.sortLabel = sort.descending ? '↓' : '↑';
  }
}

export interface LibraryTableHandlers {
  select(documentId: string): void;
  open(documentId: string): void;
  cycleReading(documentId: string): void;
  contextMenu(documentId: string, x: number, y: number): void;
  /** 多选: the checkbox column, which is a different question from "which document is the inspector showing". */
  toggleSelect(documentId: string): void;
}

/** What the table needs to know about the library's two kinds of selection. */
export interface LibraryTableState {
  /** The document the inspector shows. */
  selectedId: string | null;
  /** The documents a batch would act on. */
  selection: ReadonlySet<string>;
}

function stateChip(rank: StateRank, doneLabel: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `knowledge-state-chip is-${rank}`;
  chip.textContent = rank === 'done' ? '✓' : rank === 'running' ? '…' : rank === 'failed' ? '!' : '·';
  chip.title = rank === 'done'
    ? doneLabel
    : rank === 'running'
      ? '处理中'
      : rank === 'failed'
        ? '失败，详情见右侧'
        : '尚未处理';
  return chip;
}

function selectionCell(item: KnowledgeLibraryDocument, state: LibraryTableState, handlers: LibraryTableHandlers): HTMLElement {
  const cell = document.createElement('td');
  cell.className = 'knowledge-col-select';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'knowledge-row-check';
  checkbox.checked = state.selection.has(item.documentId);
  checkbox.setAttribute('aria-label', `选择 ${item.documentName}`);
  // The row's own click selects for the inspector; ticking the box must not also do that, or the two selections
  // would move together and the user could not pre-select a batch while reading one paper.
  checkbox.addEventListener('click', (event) => event.stopPropagation());
  checkbox.addEventListener('change', () => handlers.toggleSelect(item.documentId));
  cell.append(checkbox);
  return cell;
}

/** Renders the table body; returns nothing — the DOM is the output. */
export function renderLibraryTable(
  documents: readonly KnowledgeLibraryDocument[],
  state: LibraryTableState,
  handlers: LibraryTableHandlers,
): void {
  knowledgeTableBodyElement.replaceChildren();
  knowledgeTableEmptyElement.hidden = documents.length > 0;
  for (const item of documents) {
    const row = document.createElement('tr');
    row.className = 'knowledge-table-row';
    row.dataset.documentId = item.documentId;
    row.tabIndex = 0;
    row.classList.toggle('is-selected', item.documentId === state.selectedId);
    row.classList.toggle('is-checked', state.selection.has(item.documentId));

    row.append(selectionCell(item, state, handlers));

    const titleCell = document.createElement('th');
    titleCell.scope = 'row';
    titleCell.className = 'knowledge-col-title';
    const title = document.createElement('span');
    title.className = 'knowledge-table-title';
    title.textContent = item.documentName.replace(/\.pdf$/i, '');
    title.title = item.documentName;
    titleCell.append(title);
    row.append(titleCell);

    const readingCell = document.createElement('td');
    readingCell.className = 'knowledge-col-reading';
    const reading = document.createElement('button');
    const status = readReadingStatus(item);
    reading.type = 'button';
    reading.className = `knowledge-reading-chip is-${status}`;
    reading.textContent = READING_STATUS_LABELS[status];
    reading.title = '点击切换：待读 → 在读 → 已读';
    reading.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.cycleReading(item.documentId);
    });
    readingCell.append(reading);
    row.append(readingCell);

    const pagesCell = document.createElement('td');
    pagesCell.className = 'knowledge-col-pages';
    pagesCell.textContent = String(item.pageCount);
    row.append(pagesCell);

    // 进度：上次读到哪。没读过就是破折号——「还没开始」和「读到第 1 页」不是一回事。
    const progressCell = document.createElement('td');
    progressCell.className = 'knowledge-col-progress';
    const progress = resumePointOf(item);
    progressCell.textContent = progress ? `第 ${progress.pageNumber} 页` : '—';
    if (!progress) progressCell.classList.add('is-empty');
    else progressCell.title = progress.lastReadAt ? `上次阅读：${progress.lastReadAt.slice(0, 10)}` : '上次阅读的位置';
    row.append(progressCell);

    const dateCell = document.createElement('td');
    dateCell.className = 'knowledge-col-date';
    dateCell.textContent = item.addedAt.slice(0, 10);
    row.append(dateCell);

    // 发表日期 comes from the model's first-page reading, so it can legitimately be missing — a dash says "not known",
    // which is the same convention the inspector uses.
    const publishedCell = document.createElement('td');
    publishedCell.className = 'knowledge-col-published';
    const publishDate = readDocumentMetadata(item).publishDate;
    publishedCell.textContent = publishDate || '—';
    if (!publishDate) publishedCell.classList.add('is-empty');
    row.append(publishedCell);

    for (const [rank, label] of [
      [indexState(item), '已索引'],
      [overviewState(item), '概览已生成'],
      [relatedState(item), '已检索相关论文'],
    ] as Array<[StateRank, string]>) {
      const cell = document.createElement('td');
      cell.className = 'knowledge-col-state';
      cell.append(stateChip(rank, label));
      row.append(cell);
    }

    row.addEventListener('click', () => handlers.select(item.documentId));
    row.addEventListener('dblclick', () => handlers.open(item.documentId));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handlers.open(item.documentId);
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        handlers.cycleReading(item.documentId);
      }
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      handlers.select(item.documentId);
      handlers.contextMenu(item.documentId, event.clientX, event.clientY);
    });
    knowledgeTableBodyElement.append(row);
  }
}
