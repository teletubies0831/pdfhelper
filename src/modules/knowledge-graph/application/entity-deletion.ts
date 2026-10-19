import type { GraphEdge, GraphEntity, GraphPaper } from '../contracts.ts';
import { isKeywordNodeId } from './graph-metrics.ts';

/**
 * Removing a node the user does not want.
 *
 * Two rules shape this, and both come from where the data lives:
 *
 * - **Only entities can be deleted here.** A paper node is a *projection* of a knowledge-base document;
 *   deleting it in the graph would leave the two disagreeing until the next sync, and the next sync
 *   would put it straight back. Papers leave the graph when they leave the knowledge base, which is the
 *   knowledge base page's job. This file therefore only ever accepts an entity id, and refuses one that
 *   happens to be a paper id anyway rather than trusting the caller.
 * - **The edges go with it.** An edge whose endpoint no longer exists breaks the renderer's one hard
 *   invariant (every endpoint is present) and would surface as a dangling line or a crash in the hit
 *   tester. The cascade is planned here and applied in one transaction by the repository.
 */

export interface EntityDeletionPlan {
  /** False when the target must not be deleted; `reason` says why, in the user's words. */
  allowed: boolean;
  reason?: string;
  entityId: string;
  /** Every edge that has the entity at either end. */
  edgeIds: string[];
  /** True when the node is a rule-derived keyword: it returns on the next projection. */
  keywordNode: boolean;
  /** Attached evidence point, used by the confirmation text. */
  paperCount: number;
}

export interface EntityDeletionRequest {
  entityId: string;
  entities: readonly GraphEntity[];
  edges: readonly GraphEdge[];
  /** Papers in the graph: a paper id is never a deletable entity. */
  papers?: readonly GraphPaper[];
}

/**
 * Decides whether an entity can be deleted, and which edges must go with it.
 *
 * The refusals are deliberately specific: "cannot delete" with no reason is the kind of message that
 * makes a user try the same click three times.
 */
export function planEntityDeletion(request: EntityDeletionRequest): EntityDeletionPlan {
  const entityId = request.entityId;
  const empty: EntityDeletionPlan = {
    allowed: false,
    entityId,
    edgeIds: [],
    keywordNode: false,
    paperCount: 0,
  };

  if (request.papers?.some((paper) => paper.paperId === entityId)) {
    return {
      ...empty,
      reason: '论文节点是知识库的投影，不能在图谱里删除。请到知识库页移出该文献。',
    };
  }

  const entity = request.entities.find((candidate) => candidate.entityId === entityId);
  if (!entity) {
    return { ...empty, reason: '这个节点已经不在图谱里了。' };
  }
  if (entity.status === 'merged') {
    return {
      ...empty,
      reason: '这是一个已被合并的旧记录，图中不显示它；它会在下次合并时被清理。',
    };
  }

  // A survivor is referenced by the tombstones of everything merged into it. Deleting it would leave
  // those pointers aiming at nothing, so the merge chain has to be dealt with first.
  const survivorsOf = request.entities.filter(
    (candidate) => candidate.mergedInto === entityId && candidate.status === 'merged',
  );
  if (survivorsOf.length) {
    return {
      ...empty,
      reason: `有 ${survivorsOf.length} 个已合并的实体指向它，先不要删除这个存留节点。`,
    };
  }

  const edgeIds = request.edges
    .filter((edge) => edge.source === entityId || edge.target === entityId)
    .map((edge) => edge.edgeId);

  const paperIds = new Set<string>([
    ...(request.papers ?? []).map((paper) => paper.paperId),
    ...request.edges
      .filter((edge) => edge.sourceKind === 'paper' || edge.targetKind === 'paper')
      .flatMap((edge) => [edge.sourceKind === 'paper' ? edge.source : '', edge.targetKind === 'paper' ? edge.target : ''])
      .filter(Boolean),
  ]);
  const paperCount = request.edges
    .filter((edge) => edge.source === entityId || edge.target === entityId)
    .flatMap((edge) => [edge.source, edge.target])
    .filter((id) => paperIds.has(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .length;

  return {
    allowed: true,
    entityId,
    edgeIds,
    keywordNode: isKeywordNodeId(entityId),
    paperCount,
  };
}

/** What the confirmation dialog says. Kept next to the rules so the two cannot drift. */
export function describeEntityDeletion(
  plan: EntityDeletionPlan,
  entityName: string,
): string {
  const edges = plan.edgeIds.length;
  const lines = [
    `删除节点「${entityName}」？`,
    '',
    edges
      ? `与它相连的 ${edges} 条边会一起删除（涉及 ${plan.paperCount} 篇文献）。`
      : '它当前没有任何连线。',
    '图谱里其他内容不受影响，知识库中的文献也不会被删除。',
  ];
  if (plan.keywordNode) {
    lines.push('', '这是一个由论文关键词自动生成的节点：下次同步图谱时会重新出现。');
  }
  return lines.join('\n');
}

export interface EntityDeletionPorts {
  listEntities(): Promise<GraphEntity[]>;
  listEdges(): Promise<GraphEdge[]>;
  listPapers(): Promise<GraphPaper[]>;
  /** Removes the entity and the listed edges in one transaction. */
  deleteEntityCascade(entityId: string, edgeIds: string[]): Promise<void>;
}

export interface EntityDeletionResult {
  deleted: boolean;
  edgesDeleted: number;
  reason?: string;
}

/**
 * Applies a deletion: read, plan, refuse or cascade.
 *
 * The reads happen here rather than in the caller so the plan always describes the *current* store: a
 * plan built from a page snapshot can be minutes old, and deleting on stale edge ids would leave the
 * edges that arrived meanwhile pointing at a node that no longer exists.
 */
export async function deleteGraphEntity(
  entityId: string,
  ports: EntityDeletionPorts,
): Promise<EntityDeletionResult> {
  const [entities, edges, papers] = await Promise.all([
    ports.listEntities(),
    ports.listEdges(),
    ports.listPapers(),
  ]);
  const plan = planEntityDeletion({ entityId, entities, edges, papers });
  if (!plan.allowed) {
    return { deleted: false, edgesDeleted: 0, ...(plan.reason ? { reason: plan.reason } : {}) };
  }
  await ports.deleteEntityCascade(entityId, plan.edgeIds);
  return { deleted: true, edgesDeleted: plan.edgeIds.length };
}
