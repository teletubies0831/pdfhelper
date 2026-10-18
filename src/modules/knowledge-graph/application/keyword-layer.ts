import {
  KEYWORD_EDGE_TYPES,
  type GraphEdge,
  type GraphEntity,
  type GraphPaper,
} from '../contracts.ts';
import { createEdgeOriginKey, createGraphId } from '../domain/graph-identity.ts';

export const KEYWORD_NODE_PREFIX = 'keyword:';

/** Stable slug for a keyword so re-syncing the same paper is idempotent. */
export function keywordSlug(keyword: string): string {
  return keyword
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}+#./ -]+/gu, '')
    .trim();
}

/**
 * Creates (or refreshes) the paper -> keyword -> paper layer.
 *
 * This is the stage-1 fallback that keeps the graph useful before any AI
 * extraction has run, and the only layer that works with no API key at all.
 * Keywords are modelled as `entity` nodes so that two papers sharing a keyword
 * are automatically two hops apart — the same mechanism that will later link
 * papers through real extracted entities.
 */
export function buildKeywordEdges(
  paper: GraphPaper,
  existing: GraphEdge[],
  now = Date.now(),
): GraphEdge[] {
  const kept = existing.filter(
    (edge) => edge.sourcePaperId === paper.paperId
      && KEYWORD_EDGE_TYPES.includes(edge.type as (typeof KEYWORD_EDGE_TYPES)[number]),
  );
  const keptByKey = new Map(kept.map((edge) => [edge.originKey, edge]));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const keyword of paper.keywords) {
    const slug = keywordSlug(keyword);
    if (!slug) continue;
    const target = `${KEYWORD_NODE_PREFIX}${slug}`;
    const originKey = createEdgeOriginKey(paper.paperId, target, 'HAS_KEYWORD', false);
    if (seen.has(originKey)) continue;
    seen.add(originKey);
    const previous = keptByKey.get(originKey);
    edges.push({
      edgeId: previous?.edgeId ?? createGraphId('edge'),
      source: paper.paperId,
      sourceKind: 'paper',
      target,
      targetKind: 'entity',
      type: 'HAS_KEYWORD',
      confidence: 1,
      evidence: [],
      sourcePaperId: paper.paperId,
      origin: 'rule',
      originKey,
      provenance: {},
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }

  return edges;
}

/** Origin keys of keyword edges that the current keyword list no longer implies. */
export function findStaleKeywordOriginKeys(
  paper: GraphPaper,
  existing: GraphEdge[],
): string[] {
  const live = new Set(
    buildKeywordEdges(paper, []).map((edge) => edge.originKey),
  );
  return existing
    .filter((edge) => edge.sourcePaperId === paper.paperId
      && KEYWORD_EDGE_TYPES.includes(edge.type as (typeof KEYWORD_EDGE_TYPES)[number])
      && !live.has(edge.originKey))
    .map((edge) => edge.originKey);
}

/** Display name for a keyword node id, with original casing restored. */
export function keywordNodeLabel(nodeId: string, papers: GraphPaper[]): string {
  const slug = nodeId.startsWith(KEYWORD_NODE_PREFIX)
    ? nodeId.slice(KEYWORD_NODE_PREFIX.length)
    : nodeId;
  for (const paper of papers) {
    for (const keyword of paper.keywords) {
      if (keywordSlug(keyword) === slug) return keyword;
    }
  }
  return slug;
}

/**
 * Materialises keyword nodes as entities so the graph has a single node model.
 *
 * Keyword entities are rule-derived and `confidence: 1` only means "the paper
 * literally lists this keyword" — `origin` on the edge carries the trust signal,
 * and the inspector renders rule edges differently from AI ones.
 */
export function buildKeywordEntities(
  edges: GraphEdge[],
  papers: GraphPaper[],
  now = Date.now(),
): GraphEntity[] {
  const entityIds = new Set(
    edges
      .filter((edge) => edge.type === 'HAS_KEYWORD')
      .map((edge) => edge.target),
  );
  const firstSeenByEntityId = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type !== 'HAS_KEYWORD' || !edge.sourcePaperId) continue;
    if (!firstSeenByEntityId.has(edge.target)) {
      firstSeenByEntityId.set(edge.target, edge.sourcePaperId);
    }
  }

  return [...entityIds].map((entityId) => ({
    entityId,
    name: keywordNodeLabel(entityId, papers),
    normalizedName: entityId,
    aliases: [],
    type: 'Concept' as const,
    status: 'confirmed' as const,
    confidence: 1,
    sourcePaperId: firstSeenByEntityId.get(entityId) ?? '',
    evidence: [],
    mergedInto: null,
    userEdited: false,
    createdAt: now,
    updatedAt: now,
  }));
}

