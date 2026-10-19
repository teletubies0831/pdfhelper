import { graphSelectedNodeId } from '../../app/public';
import { openKnowledgeGraphPage } from '../knowledge-graph/public';

/**
 * 「在图谱中查看」, on the other side of a dynamic import.
 *
 * The graph feature imports back into this one (its overview dialog lives here), so importing it statically from the
 * library would make the two modules a cycle — the architecture check rejects that, and it is right to: the cycle would
 * mean the graph page and the library could not be loaded independently. The same pattern as `graph-removal-bridge`.
 *
 * The graph's paper id *is* the knowledge-base document id, so selecting the node is exactly the identification.
 */
export function openGraphForDocument(documentId: string): void {
  graphSelectedNodeId.value = documentId;
  void openKnowledgeGraphPage();
}
