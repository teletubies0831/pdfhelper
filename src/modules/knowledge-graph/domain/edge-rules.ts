import { UNDIRECTED_EDGE_TYPES, type EdgeType } from '../contracts.ts';

/**
 * Small shared predicates for the planning layer.
 *
 * Kept in the domain next to `graph-identity` so the application layer can
 * import them at runtime without reaching into the contract barrel.
 */

export function isUndirected(type: EdgeType): boolean {
  return UNDIRECTED_EDGE_TYPES.includes(type);
}

export function clampConfidence(value: number | undefined, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, Number(value)));
}
