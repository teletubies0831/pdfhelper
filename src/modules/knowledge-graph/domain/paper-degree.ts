/**
 * Which nodes belong to one paper, and which ones bridge several.
 *
 * This is the single classification the whole canvas is built on, and it is deliberately about
 * **how many distinct papers** a node reaches — not about its raw degree:
 *
 * - a node that reaches exactly one paper is that paper's **private** detail (a method, a dataset, a
 *   metric), even if it also hangs a couple of sub-entities off itself;
 * - a node that reaches two or more papers is a **bridge** (a shared method, a shared benchmark):
 *   its whole reason for existing is to connect documents, so it has to be drawn between them;
 * - papers are the anchors and have no role of their own here.
 *
 * Both the force layout (which sizes springs from it) and the render model (which dims bridge edges)
 * consume this one index, so the physics and the picture cannot disagree about what is shared.
 */

/** How many distinct papers a node must reach to count as a bridge. */
export const SHARED_PAPER_DEGREE = 2;

export interface NodeRoleIndex {
  /** Distinct paper neighbours per node. Papers themselves map to 0 unless linked to a paper. */
  paperDegree: Map<string, number>;
  /** Non-paper nodes reaching `SHARED_PAPER_DEGREE` or more papers. */
  bridgeNodeIds: Set<string>;
  /** Non-paper nodes reaching exactly one paper: satellites of that paper. */
  privateNodeIds: Set<string>;
}

/**
 * Indexes the paper membership of every node.
 *
 * Only `paper ↔ non-paper` links count, in either direction, because that link is what makes a node
 * "belong" to a document. Paper-to-paper conclusions (including derived bridges) never make either
 * document private to the other.
 */
export function buildNodeRoleIndex(
  edges: ReadonlyArray<{ source: string; target: string }>,
  paperIds: ReadonlySet<string>,
): NodeRoleIndex {
  const paperNeighbours = new Map<string, Set<string>>();
  const add = (nodeId: string, paperId: string): void => {
    const bucket = paperNeighbours.get(nodeId);
    if (bucket) bucket.add(paperId);
    else paperNeighbours.set(nodeId, new Set([paperId]));
  };
  for (const edge of edges) {
    const sourceIsPaper = paperIds.has(edge.source);
    const targetIsPaper = paperIds.has(edge.target);
    if (sourceIsPaper === targetIsPaper) continue;
    if (sourceIsPaper) add(edge.target, edge.source);
    else add(edge.source, edge.target);
  }

  const paperDegree = new Map<string, number>();
  const bridgeNodeIds = new Set<string>();
  const privateNodeIds = new Set<string>();
  for (const [nodeId, papers] of paperNeighbours) {
    const count = papers.size;
    paperDegree.set(nodeId, count);
    if (paperIds.has(nodeId)) continue;
    if (count >= SHARED_PAPER_DEGREE) bridgeNodeIds.add(nodeId);
    else if (count === 1) privateNodeIds.add(nodeId);
  }
  return { paperDegree, bridgeNodeIds, privateNodeIds };
}

/** Paper degree of one node, defaulting to 0 (unknown and unlinked are the same here). */
export function paperDegreeOf(index: NodeRoleIndex, nodeId: string): number {
  return index.paperDegree.get(nodeId) ?? 0;
}
