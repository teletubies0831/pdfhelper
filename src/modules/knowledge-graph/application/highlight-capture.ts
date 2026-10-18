import type { GraphHighlightRecord } from '../contracts-user-graph.ts';

/**
 * Captures the reader's highlights into the graph's own copy.
 *
 * The reading features remain the authority for what a highlight *is*; this module
 * only decides which graph records follow from a snapshot of them. Highlights cannot
 * be read back from a store (they live inside the annotated PDF), so the graph keeps
 * a copy to render, search and export offline — which means the copy has to be
 * maintained by explicit capture, and the rules for doing that are worth their own
 * tests.
 *
 * Two of those rules are load-bearing:
 *
 * - **Idempotent.** Capturing the same highlights twice must write nothing the
 *   second time, because capture runs on every graph page load. `createdAt` is
 *   preserved on update for the same reason a note keeps its creation time: the
 *   node must not drift in time-ordered views.
 * - **Never destructive.** Highlights the capture does not mention are *reported*,
 *   not deleted. A capture can legitimately be partial — the annotation storage of a
 *   document that has not finished restoring is empty — and deleting records on that
 *   basis would wipe a graph the user built by opening a PDF too quickly.
 */

export interface CapturedHighlight {
  /** Identity from the reading feature; stable across save/reopen. */
  highlightId: string;
  text: string;
  note: string;
  pageNumber: number | null;
  /** Serialized reader position; opaque to the graph. */
  position: string;
}

export interface HighlightCaptureInput {
  /**
   * The document every captured highlight belongs to.
   *
   * Stated once, by the caller, rather than taken from the captured entries: an
   * empty capture is the case that matters most here, and deriving the document from
   * its own (absent) contents would silently disable the `missingIds` report exactly
   * when something may have gone wrong.
   *
   * `GraphHighlightRecord.paperId` holds this document name because the personal
   * graph resolves names to papers through a join (as it does for notes). Storing a
   * graph id would resolve to nothing and silently drop the `HIGHLIGHTED` edge.
   */
  documentName: string;
  /** The graph's stored copy. */
  existing: readonly GraphHighlightRecord[];
  /** What the reading feature reports right now. */
  captured: readonly CapturedHighlight[];
  now?: number;
}

export interface HighlightCapturePlan {
  /** Records to upsert. Unchanged highlights are absent, so a re-capture writes nothing. */
  records: GraphHighlightRecord[];
  created: number;
  updated: number;
  unchanged: number;
  /**
   * Stored ids for the same document that this capture did not mention.
   *
   * Reported for a future reconciliation pass — see the note on partial captures in
   * the module comment: acting on this list would delete records whenever a capture
   * happened to be incomplete.
   */
  missingIds: string[];
  /** Captured highlights dropped for having no text — a node with no evidence. */
  skippedEmpty: number;
  /** Captured highlights dropped for having no id or document name. */
  skippedInvalid: number;
}

/**
 * Whether the record that would be written is already what is stored.
 *
 * Compared after normalisation and against the **candidate record**, not against the
 * raw capture: comparing raw input against stored output means the two sides disagree
 * wherever a value is normalised on the way in, and a whitespace-only difference then
 * looks like an edit — which would rewrite every highlight on every page load.
 */
function sameRecord(stored: GraphHighlightRecord, candidate: GraphHighlightRecord): boolean {
  return stored.paperId === candidate.paperId
    && stored.text === candidate.text
    && stored.pageNumber === candidate.pageNumber
    && stored.position === candidate.position
    && (stored.note ?? '') === (candidate.note ?? '');
}

export function planHighlightCapture(input: HighlightCaptureInput): HighlightCapturePlan {
  const now = input.now ?? Date.now();
  const documentName = input.documentName.trim();
  const storedById = new Map(input.existing.map((record) => [record.highlightId, record]));
  const records: GraphHighlightRecord[] = [];
  const seenIds = new Set<string>();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedEmpty = 0;
  // Without a document name nothing can be stored — every record would be
  // unresolvable — so the whole capture is rejected rather than written as orphans.
  let skippedInvalid = documentName ? 0 : input.captured.length;

  for (const captured of documentName ? input.captured : []) {
    const highlightId = captured.highlightId.trim();
    if (!highlightId) {
      skippedInvalid += 1;
      continue;
    }
    const text = captured.text.trim();
    if (!text) {
      // A highlight with no stored text cannot be labelled or quoted, so it would
      // become an anonymous node whose evidence is empty. Skipped and counted
      // rather than rendered as a placeholder.
      skippedEmpty += 1;
      continue;
    }

    const note = captured.note.trim();
    const stored = storedById.get(highlightId);
    const candidate: GraphHighlightRecord = {
      highlightId,
      paperId: documentName,
      text,
      position: captured.position,
      pageNumber: captured.pageNumber,
      // `createdAt` is when the highlight entered the graph, and it survives an
      // update so the record keeps its place in time-ordered views.
      createdAt: stored?.createdAt ?? now,
      ...(note ? { note } : {}),
    };

    seenIds.add(highlightId);
    if (!stored) {
      created += 1;
      records.push(candidate);
      continue;
    }
    if (sameRecord(stored, candidate)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    records.push(candidate);
  }

  // Reported for a future reconciliation pass. Deleting them here would be a guess:
  // a capture of a document whose annotations have not finished restoring is empty,
  // and acting on that would wipe the user's graph copy.
  const missingIds = documentName
    ? input.existing
      .filter((record) => record.paperId === documentName && !seenIds.has(record.highlightId))
      .map((record) => record.highlightId)
    : [];

  return { records, created, updated, unchanged, missingIds, skippedEmpty, skippedInvalid };
}

/** One-line summary for the status bar, or null when the capture changed nothing. */
export function describeHighlightCapture(plan: HighlightCapturePlan): string | null {
  const parts = [
    plan.created ? `新增 ${plan.created} 条高亮` : '',
    plan.updated ? `更新 ${plan.updated} 条` : '',
    plan.skippedEmpty ? `${plan.skippedEmpty} 条没有文本，已跳过` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join('，')}。` : null;
}
