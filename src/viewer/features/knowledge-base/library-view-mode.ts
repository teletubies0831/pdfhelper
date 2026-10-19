import { knowledgeTableWrapElement, knowledgeListElement, knowledgeViewGridButton, knowledgeViewListButton } from '../../app/viewer-elements';
import { readJsonValue, writeJsonValue } from '../../../infrastructure/storage/browser-json-repository';

/**
 * Which way the library is laid out: a dense table or the card grid.
 *
 * Both exist because they answer different questions — the table answers "what have I not done yet" across many papers,
 * the grid is easier to scan when there are only four — and keeping them side by side means the choice can be settled by
 * using them rather than by arguing. The choice is remembered, because a layout that resets on every visit is worse than
 * either layout.
 */

export type LibraryViewMode = 'list' | 'grid';

const STORAGE_KEY = 'pdf-helper-knowledge-view-mode-v1';

export function readLibraryViewMode(): LibraryViewMode {
  return readJsonValue<unknown>(STORAGE_KEY, 'list') === 'grid' ? 'grid' : 'list';
}

/** Shows one view, hides the other, and syncs the two toolbar buttons. */
export function applyLibraryViewMode(mode: LibraryViewMode): void {
  const list = mode === 'list';
  knowledgeListElement.hidden = list;
  knowledgeTableWrapElement.hidden = !list;
  knowledgeViewListButton.classList.toggle('active', list);
  knowledgeViewGridButton.classList.toggle('active', !list);
  knowledgeViewListButton.setAttribute('aria-pressed', String(list));
  knowledgeViewGridButton.setAttribute('aria-pressed', String(!list));
}

export function persistLibraryViewMode(mode: LibraryViewMode): void {
  try {
    writeJsonValue(STORAGE_KEY, mode);
  } catch {
    // The view is still usable when extension storage is unavailable; it just will not be remembered.
  }
}
