import type { GraphEdge } from '../contracts.ts';
import {
  describeConflicts,
  findRelationConflicts,
  planConflictResolution,
  type RelationConflict,
} from './conflict-resolution.ts';

/**
 * Scanning and applying conflict resolutions.
 *
 * The detection and ranking rules live in `conflict-resolution.ts` as pure
 * functions. This file is the thin layer that reads the stored edges, turns a set
 * of user choices into **one** write plan, and hands it to the repository.
 *
 * Two decisions are worth stating up front:
 *
 * - **Resolution is never automatic.** Retiring an edge destroys a conclusion
 *   someone paid tokens for, and the ranking that picks the survivor is a
 *   judgement call about claim strength — so the user sees the list and approves
 *   it. The badge exists so they know the list is non-empty.
 * - **The whole batch is one plan and one transaction.** A partially applied
 *   resolution leaves pairs with a survivor marked "resolved" and a loser still
 *   stored, which is exactly the contradictory state this feature removes; the
 *   user would then see the same conflict again with no explanation.
 */

export interface ConflictScanPorts {
  listEdges(): Promise<GraphEdge[]>;
}

export interface ConflictScanOptions {
  /** Edges below this confidence are not treated as verdicts (noise floor). */
  minConfidence?: number;
}

export interface ConflictScan {
  conflicts: RelationConflict[];
  /** Status-line copy; see `describeConflicts`. */
  summary: string;
}

/** Reads every stored conclusion and reports the contradictory pairs. */
export async function scanRelationConflicts(
  ports: ConflictScanPorts,
  options: ConflictScanOptions = {},
): Promise<ConflictScan> {
  const edges = await ports.listEdges();
  const conflicts = findRelationConflicts(edges, {
    ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
  });
  return { conflicts, summary: describeConflicts(conflicts) };
}

export interface ConflictBatchPlan {
  /** Pairs covered by this plan, in list order. */
  pairKeys: string[];
  /** Survivors to re-write with resolution provenance. */
  edges: GraphEdge[];
  /** Origin keys of the losing verdicts. */
  dropOriginKeys: string[];
  /**
   * Selections that named a pair or an edge the conflict list does not contain.
   *
   * Reported rather than silently ignored: it means the UI's list is stale
   * relative to the store, and the user's click did not do what they think it did.
   */
  staleSelections: string[];
}

/**
 * Turns a set of per-pair choices into a single write plan.
 *
 * `selections` maps `pairKey -> edgeId`; a pair with no entry uses the ranked
 * survivor.
 */
export function planConflictBatch(
  conflicts: readonly RelationConflict[],
  options: { selections?: ReadonlyMap<string, string>; now?: number } = {},
): ConflictBatchPlan {
  const selections = options.selections ?? new Map<string, string>();
  const edges: GraphEdge[] = [];
  const dropOriginKeys: string[] = [];
  const pairKeys: string[] = [];
  const staleSelections: string[] = [];

  for (const conflict of conflicts) {
    const selectedEdgeId = selections.get(conflict.pairKey);
    // A selection naming an edge this conflict does not contain is a stale list,
    // not a choice. `planConflictResolution` falls back to the ranked survivor, so
    // the write stays safe; reporting it is what makes that fallback visible
    // instead of a click that silently did nothing.
    if (selectedEdgeId && !conflict.edges.some((edge) => edge.edgeId === selectedEdgeId)) {
      staleSelections.push(conflict.pairKey);
    }
    const plan = planConflictResolution(conflict, {
      ...(selectedEdgeId === undefined ? {} : { selectedEdgeId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    edges.push(...plan.edges);
    dropOriginKeys.push(...plan.dropOriginKeys);
    pairKeys.push(conflict.pairKey);
  }

  // Selections for pairs that are not in the list at all: the same staleness,
  // caught where the first check cannot see it.
  const listed = new Set(pairKeys);
  for (const pairKey of selections.keys()) {
    if (!listed.has(pairKey)) staleSelections.push(pairKey);
  }

  // Never retire the key we are about to write: the survivor keeps its identity,
  // and deleting its own key first would turn a resolution into a deletion.
  const written = new Set(edges.map((edge) => edge.originKey));
  return {
    pairKeys,
    edges,
    dropOriginKeys: [...new Set(dropOriginKeys)].filter((key) => !written.has(key)),
    staleSelections,
  };
}

export interface ConflictApplyPorts {
  applyRelationPlan(plan: { edges: GraphEdge[]; dropOriginKeys: string[] }): Promise<number>;
}

export interface ConflictApplyResult {
  /** Pairs written in this batch. */
  pairs: number;
  /** Survivor records the store confirmed writing. */
  edgesWritten: number;
  /**
   * Origin keys the plan asked to retire.
   *
   * Planned rather than observed: the store reports writes, not deletions, and
   * inventing a number here would be worse than naming the field for what it is.
   */
  retiredKeys: number;
  staleSelections: string[];
}

/**
 * Applies a plan.
 *
 * An empty plan short-circuits before touching the store: opening a write
 * transaction to do nothing is a lock taken on every scan.
 */
export async function resolveRelationConflicts(
  ports: ConflictApplyPorts,
  plan: ConflictBatchPlan,
): Promise<ConflictApplyResult> {
  if (!plan.edges.length && !plan.dropOriginKeys.length) {
    return { pairs: 0, edgesWritten: 0, retiredKeys: 0, staleSelections: plan.staleSelections };
  }
  const edgesWritten = await ports.applyRelationPlan({
    edges: plan.edges,
    dropOriginKeys: plan.dropOriginKeys,
  });
  return {
    pairs: plan.pairKeys.length,
    edgesWritten,
    retiredKeys: plan.dropOriginKeys.length,
    staleSelections: plan.staleSelections,
  };
}

/** Status-line copy after a batch, naming what changed. */
export function describeResolutionResult(result: ConflictApplyResult): string {
  if (!result.pairs) return '没有需要处理的矛盾结论。';
  const stale = result.staleSelections.length
    ? `（${result.staleSelections.length} 项选择已过期，按建议结论处理）`
    : '';
  return `已消解 ${result.pairs} 组矛盾结论，保留 ${result.edgesWritten} 条结论，退役 ${result.retiredKeys} 条${stale}。`;
}
