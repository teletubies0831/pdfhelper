import { getSerializableAnnotationEntries } from "./embedded-helper-payload";
import { getStoredHighlightText } from "./annotation-highlight-content";
import {
  getAnnotationGeometrySignature,
  isStoredHighlightValue,
  normalizeStorageKey,
} from "./annotation-value-codec";

/**
 * Read-only listing of the open document's highlights.
 *
 * Other features need to know what the user highlighted, and the honest answer is
 * "this is what the PDF itself records": the entries come from the same serializable
 * annotation storage that the embedded payload writes into the PDF, so the text and
 * note a graph node shows are exactly what the file carries — not a second,
 * independently maintained copy that can drift.
 *
 * Two deliberate limits, both reported rather than hidden by the callers:
 *
 * - **Only the document that is currently open.** Highlights live inside the
 *   annotated PDF; nothing in the extension stores them for closed documents.
 * - **Nothing here mutates.** This is a query: it does not restore, save or repair
 *   annotations, so calling it cannot change what the reader shows.
 */

export interface DocumentHighlight {
  /**
   * Stable identity across save/reopen.
   *
   * Geometry is preferred over the storage key because the codec notes that PDF.js
   * editor ids can be reassigned; a consumer keying records by them would
   * accumulate duplicates.
   */
  highlightId: string;
  /** 1-based page number. */
  pageNumber: number;
  /** The highlighted text, exactly as stored (may be empty for legacy marks). */
  text: string;
  /** The user's note on the highlight, if any. */
  note: string;
  /** Storage key, so a consumer can point back at the annotation. */
  position: string;
}

export function listDocumentHighlights(): DocumentHighlight[] {
  const byId = new Map<string, DocumentHighlight>();

  for (const [key, value] of getSerializableAnnotationEntries()) {
    if (!isStoredHighlightValue(value)) continue;
    const record = value as Record<string, unknown>;
    const normalizedKey = normalizeStorageKey(String(key));
    const signature = getAnnotationGeometrySignature(value);
    const highlightId = signature ? `g:${signature}` : `k:${normalizedKey}`;
    const pageIndex = Number.isInteger(record.pageIndex) ? Number(record.pageIndex) : 0;
    const note = typeof record.pdfHelperNote === "string" ? record.pdfHelperNote.trim() : "";
    const text = getStoredHighlightText(value);

    const existing = byId.get(highlightId);
    if (existing) {
      // The same mark can be reachable under more than one key (a session editor
      // plus its stored value). Merge rather than emit it twice: the consumer keys
      // records by id, and two entries with one id would make the second overwrite
      // the first.
      byId.set(highlightId, {
        ...existing,
        text: existing.text || text,
        note: existing.note || note,
      });
      continue;
    }

    byId.set(highlightId, {
      highlightId,
      pageNumber: pageIndex + 1,
      text,
      note,
      position: normalizedKey,
    });
  }

  return [...byId.values()];
}
