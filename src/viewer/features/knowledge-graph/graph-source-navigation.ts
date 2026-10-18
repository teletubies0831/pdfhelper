import type { GraphPaper } from '../../../modules/knowledge-graph/public';
import { pdfDocument } from '../../app/viewer-state';
import { ensureSourcePdfOpen } from '../../shared-ui/navigation/source-pdf-navigation';
import { navigateToPdfPageWhenVisible } from '../../core/pdf-reader/public';
import { jumpToPdfCitations } from '../translation/public';

/**
 * Opens a graph paper's source PDF and lands on the requested page.
 *
 * Graph papers are keyed by the document-agent id, while the recent-files list
 * (which is what can actually be opened) is keyed by file name. The projection's
 * title is the document name, so that is what we match on — the same matching
 * rule the knowledge base uses to jump back to a source document.
 *
 * When a quote is supplied the jump highlights the actual sentence rather than
 * just the page. That distinction is the point of storing evidence at all: landing
 * on page 7 of a 12-page paper and having to find the sentence yourself is barely
 * better than not having the link.
 */
export async function openGraphSourcePdf(
  paper: GraphPaper,
  pageNumber = 1,
  quote?: string,
): Promise<boolean> {
  const opened = await ensureSourcePdfOpen(paper.title);
  if (!opened || !pdfDocument.value) return false;

  // Normalised rather than merely clamped: a non-finite page number reaches the
  // reader as `NaN`, which asks for a page that cannot exist and leaves the user
  // looking at nothing. Page numbers arrive from stored evidence, so a malformed
  // record must degrade to page 1 instead of breaking the jump.
  const requested = Number.isFinite(pageNumber) ? Math.round(pageNumber) : 1;
  const totalPages = pdfDocument.value.numPages;
  const lastPage = Number.isFinite(totalPages) && totalPages >= 1 ? Math.floor(totalPages) : 1;
  const target = Math.min(lastPage, Math.max(1, requested));
  // Dynamic import: the page controller imports this module for its inspector
  // action, so a static import back would create a file-level cycle.
  const { closeKnowledgeGraphPage } = await import('./knowledge-graph-page');
  closeKnowledgeGraphPage();

  const trimmedQuote = quote?.trim();
  if (trimmedQuote && trimmedQuote.length >= 8) {
    try {
      // `jumpToPdfCitations` takes care of preserving the reading position before
      // it moves, so the citation return button can bring the reader back.
      await jumpToPdfCitations(target, [trimmedQuote]);
      return true;
    } catch {
      // A quote that cannot be located on the page must still navigate rather
      // than leaving the user on the graph page wondering what happened. The
      // usual cause is a re-flowed text layer, not a missing paper.
    }
  }

  await navigateToPdfPageWhenVisible(target);
  return true;
}
