/**
 * Bridge from the knowledge base to the knowledge graph.
 *
 * Exists for two reasons, both structural:
 *
 * 1. The graph feature imports the knowledge base (for notes and folders), so a
 *    static import in this direction would be a cross-feature cycle. A dynamic
 *    import inside a handler is not an initialisation-time edge, which is the
 *    same device the knowledge-base worker already uses.
 * 2. The knowledge base must not grow a dependency on the graph's storage layer
 *    just to clean up after itself — it asks for one operation by name.
 */

export interface GraphRemovalOutcome {
  deletedEntityIds: number;
  deletedEdgeIds: number;
  deletedJobCount: number;
}

/**
 * Removes a document's knowledge from the graph.
 *
 * Never throws: the caller has already removed the document, and a graph cleanup
 * failure must not make a completed action look like it failed. A stale graph
 * entry is a much smaller problem than a misleading error.
 */
export async function removeDocumentFromGraph(
  documentId: string,
): Promise<GraphRemovalOutcome | null> {
  try {
    const { removeGraphPaper } = await import(
      '../knowledge-graph/graph-extraction-repository'
    );
    const result = await removeGraphPaper(documentId);
    return {
      deletedEntityIds: result.deletedEntityIds.length,
      deletedEdgeIds: result.deletedEdgeIds.length,
      deletedJobCount: result.deletedJobCount,
    };
  } catch {
    return null;
  }
}
