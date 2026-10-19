import {
  getKnowledgeDocument,
  updateKnowledgeDocument,
  type KnowledgeDocumentReadingStatus,
  type KnowledgeLibraryDocument,
} from '../adapters/browser-document-corpus';

/**
 * 阅读状态：待读 / 在读 / 已读.
 *
 * Kept in its own file because two entry points write it for different reasons: the user picking a state (list chip,
 * inspector dropdown, context menu) and merely **opening** a document, which counts as starting to read it. The second
 * one is the only place that touches a document's field without the user asking, so it lives here with its rule stated
 * rather than sprinkled through the view code.
 */

export const READING_STATUS_LABELS: Record<KnowledgeDocumentReadingStatus, string> = {
  todo: '待读',
  reading: '在读',
  done: '已读',
};

/** The order the chip cycles through when clicked. */
export const READING_STATUS_ORDER: KnowledgeDocumentReadingStatus[] = ['todo', 'reading', 'done'];

export function normalizeReadingStatus(value: unknown): KnowledgeDocumentReadingStatus {
  return value === 'reading' || value === 'done' || value === 'todo' ? value : 'todo';
}

export function readReadingStatus(item: KnowledgeLibraryDocument): KnowledgeDocumentReadingStatus {
  return normalizeReadingStatus(item.readingStatus);
}

/** The next state in the cycle, so one click on the chip means "further along". */
export function nextReadingStatus(
  status: KnowledgeDocumentReadingStatus,
): KnowledgeDocumentReadingStatus {
  const index = READING_STATUS_ORDER.indexOf(status);
  return READING_STATUS_ORDER[(index + 1) % READING_STATUS_ORDER.length] ?? 'todo';
}

/** Records the user's own choice. */
export function setDocumentReadingStatus(
  documentId: string,
  status: KnowledgeDocumentReadingStatus,
): void {
  if (!getKnowledgeDocument(documentId)) return;
  updateKnowledgeDocument(documentId, { readingStatus: normalizeReadingStatus(status) });
}

/**
 * Marks a document as being read, because it was just opened.
 *
 * Deliberately one-way: `done` is not downgraded (a reader who finished a paper and opens it again to check a number has
 * not un-read it), and `todo`/`reading` both become `reading`. Reading a document's status is never worth a prompt, and
 * an unnoticed automatic change is worse when it can undo something the user said on purpose.
 */
export function markDocumentOpened(documentId: string): void {
  const item = getKnowledgeDocument(documentId);
  if (!item) return;
  if (readReadingStatus(item) === 'done') return;
  if (readReadingStatus(item) === 'reading') return;
  updateKnowledgeDocument(documentId, { readingStatus: 'reading' });
}

/** Counts per state, for the sidebar's three filters. */
export function countReadingStatuses(
  documents: readonly KnowledgeLibraryDocument[],
): Record<KnowledgeDocumentReadingStatus, number> {
  const counts: Record<KnowledgeDocumentReadingStatus, number> = { todo: 0, reading: 0, done: 0 };
  for (const item of documents) counts[readReadingStatus(item)] += 1;
  return counts;
}
