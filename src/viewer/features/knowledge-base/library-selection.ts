/**
 * 多选：which documents a batch is about.
 *
 * Its own module because the selection is the one piece of library state that outlives a render but must not outlive a
 * filter: selecting four papers and then narrowing the list must not leave two invisible ones in the batch. The
 * functions here are pure so the rules ("select all means the visible list", "a filtered-out document drops out") can be
 * tested without a browser.
 */

export type DocumentSelection = ReadonlySet<string>;

export const EMPTY_SELECTION: DocumentSelection = new Set<string>();

/** Adds or removes one document; returns a new set, so callers can compare. */
export function toggleDocumentSelection(
  selection: DocumentSelection,
  documentId: string,
): Set<string> {
  const next = new Set(selection);
  if (next.has(documentId)) next.delete(documentId);
  else next.add(documentId);
  return next;
}

/**
 * 全选 currently visible rows.
 *
 * Deliberately scoped to what is on screen: "select all 40" when the filter shows 6 would act on documents the user
 * cannot see, which is the one thing a batch button must never do.
 */
export function selectVisibleDocuments(documentIds: readonly string[]): Set<string> {
  return new Set(documentIds);
}

/** Drops ids that are no longer in the library or no longer match the filter. */
export function pruneDocumentSelection(
  selection: DocumentSelection,
  visibleDocumentIds: readonly string[],
): Set<string> {
  const visible = new Set(visibleDocumentIds);
  return new Set([...selection].filter((id) => visible.has(id)));
}

export function sameSelection(left: DocumentSelection, right: DocumentSelection): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/** 「已选 3 篇」 — the count is the only thing the batch bar needs to say about the selection itself. */
export function describeSelection(selection: DocumentSelection): string {
  return selection.size ? `已选 ${selection.size} 篇` : '未选择文献';
}
