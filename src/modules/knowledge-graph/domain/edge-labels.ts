import type { EdgeType } from '../contracts.ts';

/**
 * What each relation means, in words.
 *
 * The canvas no longer writes the relation type on every line — with a dozen edges radiating from
 * one paper it became a wall of `MENTIONS`, and it hid the nodes it was drawn between. The relation
 * is now read in the inspector after clicking an edge, which makes *this* the only place the meaning
 * appears, so it has to be a sentence a reader understands rather than an enum name.
 *
 * Shared with the relation-review and conflict dialogs, which had grown their own copies of the same
 * five labels.
 */

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  CITES: '引用',
  EXTENDS: '扩展',
  IMPROVES: '改进',
  COMPARES_WITH: '可比较',
  SIMILAR_TO: '相似',
  PROPOSES: '提出',
  USES: '使用',
  EVALUATES_ON: '在该数据集上评估',
  REPORTS: '报告',
  MENTIONS: '提及',
  ALIAS_OF: '别名',
  PART_OF: '属于',
  RELATED_TO: '相关',
  SUBCLASS_OF: '子类',
  HAS_KEYWORD: '关键词',
  IN_FOLDER: '归档于',
  HIGHLIGHTED: '高亮',
  TAGGED: '打标签',
  ANNOTATED_AS: '标注为',
  NO_RELATION: '无关（已判定）',
  SHARED_ENTITIES: '共享实体',
};

/** `提及（MENTIONS）` — the label a user can act on, with the stored value for traceability. */
export function describeEdgeType(type: EdgeType | string): string {
  const label = EDGE_TYPE_LABELS[type as EdgeType];
  return label ? `${label}（${type}）` : String(type);
}

/** The label alone, for places that already show the raw type elsewhere. */
export function edgeTypeLabel(type: EdgeType | string): string {
  return EDGE_TYPE_LABELS[type as EdgeType] ?? String(type);
}
