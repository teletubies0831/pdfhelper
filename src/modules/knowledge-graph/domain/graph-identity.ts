import type { GraphEdge } from '../contracts';

const ID_FALLBACK_SOURCE = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function createGraphId(prefix: 'entity' | 'edge'): string {
  const suffix = typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : ID_FALLBACK_SOURCE();
  return `${prefix}:${suffix}`;
}

/** Deterministic idempotency key for an edge. */
export function createEdgeOriginKey(
  source: string,
  target: string,
  type: string,
  undirected: boolean,
): string {
  const [left, right] = undirected && target < source
    ? [target, source]
    : [source, target];
  return `${type}|${left}|${right}`;
}

/** Normalises edge endpoints for storage, ordering undirected pairs. */
export function normalizeEdgeEndpoints(
  source: string,
  target: string,
  undirected: boolean,
): [string, string] {
  if (!undirected || source <= target) return [source, target];
  return [target, source];
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'ConstraintError';
}

export function clampConfidence(value: number | undefined, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, Number(value)));
}

/** Drops edges whose endpoints are no longer present, keeping the graph closed. */
export function pruneDanglingEdges(
  edges: GraphEdge[],
  paperIds: Set<string>,
  entityIds: Set<string>,
): GraphEdge[] {
  return edges.filter((edge) => {
    const sourceExists = edge.sourceKind === 'paper'
      ? paperIds.has(edge.source)
      : entityIds.has(edge.source);
    const targetExists = edge.targetKind === 'paper'
      ? paperIds.has(edge.target)
      : entityIds.has(edge.target);
    return sourceExists && targetExists;
  });
}
