import {
  knowledgeGraphRepository,
  type GraphEdge,
  type GraphPaper,
  type GraphUserNode,
} from '../../../modules/knowledge-graph/public';
import { collectKnowledgeItems } from '../knowledge-base/public';
import { getPdfFingerprint } from '../../app/document-identity';
import { captureDocumentHighlights } from './graph-highlight-bridge';
import { readPersonalGraph } from './graph-personal-repository';

/**
 * The personal layer the graph snapshot loader calls.
 *
 * Lives beside the page rather than inside it because it is a different reason to
 * change: the page renders the graph, while this file decides *what the user's own
 * material contributes to it* — which sources exist, how their identifiers join, and
 * what has to be read from storage (or, for highlights, captured from the open
 * document) before the projection can run.
 */

export type PersonalGraphProvider = (
  papers: readonly GraphPaper[]
) => Promise<{ nodes: GraphUserNode[]; edges: GraphEdge[] }>;

/**
 * Builds the provider.
 *
 * Document names in notes and highlights are matched to graph papers by title.
 * `paperId` for a projected paper *is* its document id, and the projection's title is
 * the library title, so an exact match is the correct join; a name that does not
 * match is reported rather than guessed, and its material still appears attached to
 * the user anchor.
 *
 * The provider also **captures the open document's highlights before projecting
 * them**. Highlights have no store of their own — they live inside the annotated PDF
 * — so the graph keeps a copy that has to be refreshed while a document is open;
 * capturing here means a highlight made a minute ago is in the graph on this load
 * rather than the next one, and the capture is idempotent so a reload writes nothing.
 */
export function buildPersonalProvider(): PersonalGraphProvider {
  return async (papers) => {
    const byTitle = new Map<string, string>();
    for (const paper of papers) {
      byTitle.set(paper.title.trim().toLocaleLowerCase(), paper.paperId);
      // Also index by the file name without extension: notes store the document
      // name, which is normally the PDF file name.
      byTitle.set(
        paper.title.trim().replace(/\.pdf$/i, '').toLocaleLowerCase(),
        paper.paperId,
      );
    }
    const resolve = (documentName: string): string | undefined => {
      const key = documentName.trim().toLocaleLowerCase();
      return byTitle.get(key) ?? byTitle.get(key.replace(/\.pdf$/i, ''));
    };

    // The open document, resolved against the papers being projected rather than
    // against the previous snapshot: the capture must describe *this* load.
    const fingerprint = getPdfFingerprint();
    const openTitle = fingerprint
      ? papers.find((paper) => paper.fingerprint === fingerprint)?.title
      : undefined;
    if (openTitle) await captureDocumentHighlights(openTitle);

    // Collected once per load, not per render: `collectKnowledgeItems` runs the
    // knowledge synchronisation pass and is far too heavy for a redraw.
    const tagAssignments = collectKnowledgeItems()
      .filter((item) => item.tags.length > 0)
      .map((item) => ({ documentName: item.documentName, tags: item.tags }));
    const resolvedTagAssignments = tagAssignments
      .map((assignment) => ({
        paperId: resolve(assignment.documentName),
        tags: assignment.tags,
      }))
      // A tag on a document the graph does not have would produce a `TAGGED` edge the
      // renderer drops, so it is filtered here rather than counted.
      .filter((assignment): assignment is { paperId: string; tags: string[] } =>
        Boolean(assignment.paperId))
      .map((assignment) => ({ paperId: assignment.paperId, tags: assignment.tags }));

    const personal = readPersonalGraph({
      paperIds: papers.map((paper) => paper.paperId),
      tagAssignments: resolvedTagAssignments,
      resolvePaperId: resolve,
      highlights: await knowledgeGraphRepository.listHighlights(),
    });
    return { nodes: personal.nodes, edges: personal.edges };
  };
}
