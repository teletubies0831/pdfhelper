import {
  describeHighlightCapture,
  knowledgeGraphRepository,
  planHighlightCapture,
  type CapturedHighlight,
  type HighlightCapturePlan,
} from '../../../modules/knowledge-graph/public';

/**
 * Captures the open document's highlights into the graph.
 *
 * Highlights are the one piece of the user's material the graph cannot read from a
 * store: they live inside the annotated PDF, and the only read-only way to see them
 * is the annotation storage of the document that is currently open. So the graph
 * keeps its own copy, refreshed by this capture whenever the graph page loads with a
 * document open.
 *
 * Three structural decisions:
 *
 * - **The reading feature is reached by dynamic `import()`.** A static import would
 *   be a cross-feature dependency at initialization time (the architecture check
 *   rejects it, and rightly: the graph must not be loadable *because of* the
 *   annotation editor). The dependency only exists while a capture runs.
 * - **The highlight shape is declared locally.** A type-only import would still be a
 *   static cross-feature edge as far as the module graph is concerned, so the few
 *   fields this file needs are spelled out; the reader is injected, which also makes
 *   the whole path testable without PDF.js.
 * - **It never throws.** A capture failure must not break a page load, and the graph
 *   is still correct without highlights — it simply shows fewer of the user's marks.
 */

/** Structurally matches the annotations feature's `DocumentHighlight`. */
export interface CapturedDocumentHighlight {
  highlightId: string;
  pageNumber: number;
  text: string;
  note: string;
  position: string;
}

export interface HighlightCaptureOutcome {
  plan: HighlightCapturePlan;
  written: number;
  /** Status-line copy, or null when nothing changed. */
  summary: string | null;
}

export interface HighlightCaptureOptions {
  /** Reads the open document's highlights; defaults to the annotations feature. */
  read?: () => Promise<CapturedDocumentHighlight[]>;
  now?: number;
}

/** The real reader: dynamically imported so the graph has no static dependency. */
async function readOpenDocumentHighlights(): Promise<CapturedDocumentHighlight[]> {
  const annotations = await import('../annotations/annotations');
  return annotations.listDocumentHighlights();
}

/**
 * Captures highlights for one document.
 *
 * `documentName` must be a name the personal graph can resolve to a paper — the
 * page passes the paper's title, which is what its own join indexes.
 */
export async function captureDocumentHighlights(
  documentName: string,
  options: HighlightCaptureOptions = {},
): Promise<HighlightCaptureOutcome | null> {
  const name = documentName.trim();
  if (!name) return null;

  try {
    const read = options.read ?? readOpenDocumentHighlights;
    const captured = await read();
    if (!captured.length) return null;

    const existing = await knowledgeGraphRepository.listHighlights();
    const plan = planHighlightCapture({
      documentName: name,
      existing,
      captured: captured.map((highlight): CapturedHighlight => ({
        highlightId: highlight.highlightId,
        text: highlight.text,
        note: highlight.note,
        pageNumber: Number.isFinite(highlight.pageNumber) ? highlight.pageNumber : null,
        position: highlight.position,
      })),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const written = plan.records.length
      ? await knowledgeGraphRepository.putHighlights(plan.records)
      : 0;
    return { plan, written, summary: describeHighlightCapture(plan) };
  } catch {
    // Deliberately silent: the graph page is still usable, and a capture that
    // fails because a PDF is mid-load must not surface as an error to the user.
    return null;
  }
}
