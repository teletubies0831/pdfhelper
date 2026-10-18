import type { GraphNoteRecord } from '../../../modules/knowledge-graph/public';

/**
 * Converts saved knowledge notes into the graph's note record shape.
 *
 * Extracted from the repository adapter into its own dependency-free module for
 * one reason: the date handling here is the kind of thing that fails silently.
 * `Date.parse` returns `NaN` for an unparseable value, and a `NaN` timestamp
 * poisons every sort that touches it — the note would drift to an arbitrary
 * position in time and never match a recency filter. Being import-free means
 * Node's contract tests can execute it directly.
 */

export interface SavedKnowledgeNoteLike {
  id: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  /** Closest thing a knowledge note has to a section label. */
  category?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Parses a stored ISO date, falling back to `fallback` rather than `NaN`. */
export function parseStoredTimestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function notesToGraphRecords(
  notes: readonly SavedKnowledgeNoteLike[],
  now = Date.now(),
): GraphNoteRecord[] {
  return notes
    // A blank note would be a node with nothing in it: no label, no evidence.
    .filter((note) => note.content.trim().length > 0)
    .map((note) => ({
      noteId: note.id,
      // Notes are keyed by document name; the caller resolves it to a paper id.
      paperId: note.documentName,
      content: note.content,
      sectionTitle: note.category?.trim() || null,
      createdAt: parseStoredTimestamp(note.createdAt, now),
      updatedAt: parseStoredTimestamp(note.updatedAt ?? note.createdAt, now),
    }));
}
