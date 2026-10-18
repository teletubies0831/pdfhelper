import { listKnowledgeDocuments } from '../../../modules/knowledge/public';
import type { GraphPaper } from '../../../modules/knowledge-graph/public';
import { openKnowledgeBasePage } from '../knowledge-base/public';
import { openPapersDialog, type PapersDialogPaper } from './papers-dialog';

/**
 * Opens the paper list for the graph.
 *
 * Read-only by design: the graph projects the knowledge base, so this list only *reports*.
 * Deleting belongs to the knowledge base page, and the dialog's one action goes there.
 *
 * Kept beside the page rather than inside it so the page stays about rendering. It also joins
 * the knowledge base's indexing state onto each paper, which the graph's own snapshot does not
 * carry: "索引失败" is the reason a paper's extraction is unavailable, and it is stored where
 * the extraction cannot see it.
 */
export function manageGraphPapers(options: {
  papers: readonly GraphPaper[];
  relationCounts: ReadonlyMap<string, number>;
}): void {
  const documentsById = new Map(
    listKnowledgeDocuments().map((document) => [document.documentId, document]),
  );

  const papers: PapersDialogPaper[] = options.papers.map((paper) => {
    const document = documentsById.get(paper.paperId);
    return {
      paperId: paper.paperId,
      title: paper.title,
      indexStatus: document?.indexStatus,
      indexError: document?.indexError,
    };
  });

  openPapersDialog({
    papers,
    relationCounts: options.relationCounts,
    openKnowledgeBase: () => { openKnowledgeBasePage(); },
  });
}
