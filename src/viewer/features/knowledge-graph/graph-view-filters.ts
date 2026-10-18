import type { GraphEdge, GraphEntity, GraphPaper } from '../../../modules/knowledge-graph/public';

/**
 * Which nodes and edges the current filter state lets through.
 *
 * Pure and parameterised by an explicit filter state so the rules can be tested without
 * the page: "hide rule-derived edges" and "search matches a paper title or an entity
 * name" are small, and getting either wrong is invisible until someone cannot find a
 * document they know exists.
 */

export interface GraphFilterState {
  showPapers: boolean;
  showEntities: boolean;
  showOriginAi: boolean;
  showOriginRule: boolean;
  showOriginUser: boolean;
  /** Raw search text; matched case-insensitively as a substring. */
  searchQuery: string;
  /**
   * Entities below this confidence are hidden.
   *
   * Applied to *entities*, not only to edges. The control says 置信度下限 and used to cull edges
   * alone, so dragging it barely changed the picture — the nodes it was meant to quiet stayed on
   * screen. Papers are never filtered by confidence: they are documents, not estimates.
   */
  minConfidence?: number;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** True when the node passes the search box (an empty query passes everything). */
export function matchesSearch(value: string, searchQuery: string): boolean {
  const query = normalizeQuery(searchQuery);
  return !query || value.toLocaleLowerCase().includes(query);
}

/** True when an entity clears the confidence floor (an unknown confidence is assumed to clear it). */
export function passesConfidence(
  confidence: number | undefined,
  minConfidence: number | undefined,
): boolean {
  if (typeof minConfidence !== 'number' || minConfidence <= 0) return true;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return true;
  return confidence >= minConfidence;
}

export function filterVisibleNodes(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  filters: GraphFilterState,
): { papers: GraphPaper[]; entities: GraphEntity[] } {
  return {
    papers: filters.showPapers
      ? papers.filter((paper) => matchesSearch(paper.title, filters.searchQuery))
      : [],
    entities: filters.showEntities
      ? entities.filter((entity) => (
        matchesSearch(entity.name, filters.searchQuery)
        && passesConfidence(entity.confidence, filters.minConfidence)
      ))
      : [],
  };
}

/**
 * Filters by provenance.
 *
 * The three origins are separate because they answer different questions: "only what a
 * model judged", "only what a rule derived", "only what I marked".
 */
export function filterVisibleEdges(
  edges: readonly GraphEdge[],
  filters: GraphFilterState,
): GraphEdge[] {
  return edges.filter((edge) => {
    if (edge.origin === 'ai') return filters.showOriginAi;
    if (edge.origin === 'user') return filters.showOriginUser;
    return filters.showOriginRule;
  });
}

/** Ids of every node matching the search, so the renderer can ring them. */
export function collectMatchedNodeIds(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  searchQuery: string,
): Set<string> {
  const matched = new Set<string>();
  if (!normalizeQuery(searchQuery)) return matched;
  for (const paper of papers) {
    if (matchesSearch(paper.title, searchQuery)) matched.add(paper.paperId);
  }
  for (const entity of entities) {
    if (matchesSearch(entity.name, searchQuery)) matched.add(entity.entityId);
  }
  return matched;
}
