import type {
  GraphEdge,
  GraphEntity,
  GraphPaper,
} from '../contracts.ts';
import { KEYWORD_NODE_PREFIX } from './keyword-layer.ts';
import { isAggregateNodeId } from '../domain/graph-condensation.ts';

/**
 * Graph quality metrics.
 *
 * The feature asks the user to spend tokens, so it owes them evidence about whether
 * that spending produced anything. Two of these numbers are the only defence
 * against the feature being quietly useless:
 *
 * - **Adoption rate** — of the candidates the model proposed, how many did the user
 *   keep? A collapsing rate means the extraction prompt is producing noise, and no
 *   amount of UI polish fixes that.
 * - **Reuse** — how many confirmed entities are shared by two or more papers? Reuse
 *   is the mechanism that connects papers for free, so if it is near zero the graph
 *   is just a pile of separate documents.
 *
 * Everything is computed from stored records, on demand. There is deliberately no
 * metrics store: counters that are incremented at write time drift out of sync with
 * the data and are then believed anyway, whereas a computation from the records is
 * always consistent with what the user can actually see.
 */

export interface EntityFunnelMetrics {
  /** Candidates awaiting a decision. */
  pending: number;
  /** Candidates the user accepted. */
  confirmed: number;
  /** Candidates the user dismissed. */
  rejected: number;
  /** Records folded into another entity by a merge. */
  merged: number;
  /** Rule-derived keyword nodes, excluded from every rate below. */
  keywordNodes: number;
  /** Extraction candidates only: pending + confirmed + rejected. */
  extractionCandidates: number;
  /**
   * Share of decided candidates that were kept.
   *
   * Null when nothing has been decided yet — an adoption rate over zero decisions
   * is not 0%, it is undefined, and reporting 0% would look like a failure.
   */
  adoptionRate: number | null;
}

export interface EntityReuseMetrics {
  /** Entities attached to two or more papers. */
  sharedEntities: number;
  /** Entities attached to exactly one paper. */
  singleUseEntities: number;
  /** Papers that share at least one entity with another paper. */
  connectedPapers: number;
  /**
   * Share of entities that connect more than one paper.
   *
   * The headline number for "is this a graph or a pile of documents".
   */
  reuseRate: number | null;
}

export interface EdgeCompositionMetrics {
  total: number;
  /** Judged by a model. */
  ai: number;
  /** Derived locally (keywords, filing, tagging). */
  rule: number;
  /** Asserted by the user. */
  user: number;
  /** Recorded negative judgements, which exist only to make re-runs free. */
  negative: number;
  /** Paper-to-paper conclusions. */
  paperPaper: number;
  /** Edges carrying at least one quoted source. */
  withEvidence: number;
  /** Share of edges traceable to a quote. */
  evidenceRate: number | null;
}

export interface GraphScaleMetrics {
  papers: number;
  entities: number;
  edges: number;
  /** Mean confirmed-entity count per paper. */
  entitiesPerPaper: number | null;
  /** Mean edge count per paper. */
  edgesPerPaper: number | null;
  /** Papers with no confirmed entity at all — extraction never ran or found nothing. */
  papersWithoutEntities: number;
}

export interface GraphMetrics {
  funnel: EntityFunnelMetrics;
  reuse: EntityReuseMetrics;
  edges: EdgeCompositionMetrics;
  scale: GraphScaleMetrics;
}

/** True for a rule-derived keyword node, which is not an extraction candidate. */
export function isKeywordNodeId(entityId: string): boolean {
  return entityId.startsWith(KEYWORD_NODE_PREFIX);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function computeGraphMetrics(
  papers: readonly GraphPaper[],
  entities: readonly GraphEntity[],
  edges: readonly GraphEdge[],
): GraphMetrics {
  // Aggregates are view artefacts; counting them would inflate every total the
  // moment the graph got large enough to fold.
  const realEntities = entities.filter((entity) => !isAggregateNodeId(entity.entityId));
  const keywordNodes = realEntities.filter((entity) => isKeywordNodeId(entity.entityId)).length;
  const extractionEntities = realEntities.filter((entity) => !isKeywordNodeId(entity.entityId));

  const pending = extractionEntities.filter((entity) => entity.status === 'pending').length;
  const confirmed = extractionEntities.filter((entity) => entity.status === 'confirmed').length;
  const rejected = extractionEntities.filter((entity) => entity.status === 'rejected').length;
  const merged = extractionEntities.filter((entity) => entity.status === 'merged').length;
  // Merged records are excluded from the adoption denominator: a merge is the user
  // consolidating two accepted candidates, not rejecting one, so counting it would
  // understate adoption.
  const decided = confirmed + rejected;
  const extractionCandidates = pending + confirmed + rejected;

  const paperIds = new Set(papers.map((paper) => paper.paperId));
  // Which papers each entity is attached to, from the stored edges.
  const papersByEntity = new Map<string, Set<string>>();
  for (const edge of edges) {
    const entityId = edge.sourceKind === 'entity'
      ? edge.source
      : edge.targetKind === 'entity'
        ? edge.target
        : null;
    if (!entityId) continue;
    const otherId = entityId === edge.source ? edge.target : edge.source;
    const otherKind = entityId === edge.source ? edge.targetKind : edge.sourceKind;
    // Only paper attachments count: an entity linked to another entity is not
    // evidence that it reaches a second document.
    if (otherKind !== 'paper' || !paperIds.has(otherId)) continue;
    const bucket = papersByEntity.get(entityId);
    if (bucket) bucket.add(otherId);
    else papersByEntity.set(entityId, new Set([otherId]));
  }

  let sharedEntities = 0;
  let singleUseEntities = 0;
  const connectedPaperIds = new Set<string>();
  for (const entity of extractionEntities) {
    const attached = papersByEntity.get(entity.entityId);
    if (!attached || attached.size === 0) {
      singleUseEntities += 1;
      continue;
    }
    if (attached.size >= 2) {
      sharedEntities += 1;
      for (const paperId of attached) connectedPaperIds.add(paperId);
    } else {
      singleUseEntities += 1;
    }
  }

  const realEdges = edges.filter((edge) => !isAggregateNodeId(edge.source) && !isAggregateNodeId(edge.target));
  const ai = realEdges.filter((edge) => edge.origin === 'ai').length;
  const rule = realEdges.filter((edge) => edge.origin === 'rule').length;
  const user = realEdges.filter((edge) => edge.origin === 'user').length;
  const negative = realEdges.filter((edge) => edge.type === 'NO_RELATION').length;
  const paperPaper = realEdges.filter(
    (edge) => edge.sourceKind === 'paper' && edge.targetKind === 'paper',
  ).length;
  const withEvidence = realEdges.filter(
    (edge) => edge.evidence.some((item) => item.quote.trim().length > 0),
  ).length;

  const papersWithEntities = new Set<string>();
  for (const entity of extractionEntities) {
    if (!entity.sourcePaperId || !paperIds.has(entity.sourcePaperId)) continue;
    papersWithEntities.add(entity.sourcePaperId);
  }

  return {
    funnel: {
      pending,
      confirmed,
      rejected,
      merged,
      keywordNodes,
      extractionCandidates,
      adoptionRate: ratio(confirmed, decided),
    },
    reuse: {
      sharedEntities,
      singleUseEntities,
      connectedPapers: connectedPaperIds.size,
      reuseRate: ratio(sharedEntities, extractionEntities.length),
    },
    edges: {
      total: realEdges.length,
      ai,
      rule,
      user,
      negative,
      paperPaper,
      withEvidence,
      evidenceRate: ratio(withEvidence, realEdges.length),
    },
    scale: {
      papers: papers.length,
      entities: extractionEntities.length,
      edges: realEdges.length,
      entitiesPerPaper: ratio(extractionEntities.length, papers.length),
      edgesPerPaper: ratio(realEdges.length, papers.length),
      papersWithoutEntities: papers.filter(
        (paper) => !papersWithEntities.has(paper.paperId),
      ).length,
    },
  };
}

function percent(value: number | null): string {
  // An undefined rate is reported as such rather than as 0%, because 0% reads as a
  // measured failure.
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/**
 * Human-readable report.
 *
 * Written as a list of lines rather than a single sentence because these numbers
 * are meant to be read together and judged, not glanced at.
 */
export function formatGraphMetrics(metrics: GraphMetrics): string[] {
  const { funnel, reuse, edges, scale } = metrics;
  return [
    `规模：${scale.papers} 篇文献、${scale.entities} 个实体、${scale.edges} 条边`
      + (scale.entitiesPerPaper === null ? '' : `（平均每篇 ${scale.entitiesPerPaper.toFixed(1)} 个实体）`),
    `候选采纳率：${percent(funnel.adoptionRate)}`
      + `（已确认 ${funnel.confirmed}、已忽略 ${funnel.rejected}、待确认 ${funnel.pending}）`,
    `实体复用率：${percent(reuse.reuseRate)}`
      + `（${reuse.sharedEntities} 个实体连接了多篇文献，涉及 ${reuse.connectedPapers} 篇）`,
    `边构成：AI 判断 ${edges.ai}、规则推导 ${edges.rule}、用户标注 ${edges.user}`
      + `；其中文献间关系 ${edges.paperPaper}、有原文证据 ${edges.withEvidence}（${percent(edges.evidenceRate)}）`,
    `未抽取到实体的文献：${scale.papersWithoutEntities} 篇`,
    `关键词节点 ${funnel.keywordNodes} 个（规则推导，不计入采纳率）`,
    edges.negative ? `已记录的无关系结论 ${edges.negative} 条（用于避免重复消耗 Token）` : '',
  ].filter(Boolean);
}

/**
 * Recommendations derived from the numbers.
 *
 * Deliberately conservative: each suggestion is tied to a specific measurement, so
 * the user can see *why* it is being made and ignore it if the cause is something
 * else. Advice that cannot be traced to a number is advice the user has to trust.
 */
export function suggestGraphImprovements(metrics: GraphMetrics): string[] {
  const suggestions: string[] = [];
  const { funnel, reuse, edges, scale } = metrics;

  if (funnel.adoptionRate !== null && funnel.adoptionRate < 0.4 && funnel.confirmed + funnel.rejected >= 10) {
    suggestions.push(
      `采纳率只有 ${percent(funnel.adoptionRate)}：模型给出的候选多数被忽略，`
      + '可以在设置里降低每段候选上限，或在抽取提示词里更强调"只保留具体、有区分度的实体"。',
    );
  }
  if (funnel.pending > 50) {
    suggestions.push(`有 ${funnel.pending} 个候选待确认：先批量处理一批，图谱才反映你的判断。`);
  }
  if (scale.papers >= 4 && reuse.sharedEntities === 0) {
    suggestions.push(
      '还没有任何实体连接两篇以上文献：可以先对几篇文献抽取并确认实体，'
      + '共享实体是让文献自动相连的唯一机制。',
    );
  }
  if (scale.papers >= 4 && edges.paperPaper === 0) {
    suggestions.push('还没有文献间关系：点"分析关系"让模型判断一次（会先显示 Token 估算）。');
  }
  if (edges.total > 0 && edges.evidenceRate !== null && edges.evidenceRate < 0.5) {
    suggestions.push(
      `只有 ${percent(edges.evidenceRate)} 的边带原文证据：证据是溯源的前提，`
      + '可以在抽取提示词里更强调必须给出逐字引文。',
    );
  }
  if (scale.papersWithoutEntities > 0) {
    suggestions.push(`有 ${scale.papersWithoutEntities} 篇文献还没有实体：可能是尚未建立全文索引。`);
  }
  return suggestions;
}
