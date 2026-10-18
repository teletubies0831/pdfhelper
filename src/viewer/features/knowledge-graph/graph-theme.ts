/**
 * Canvas colours for the knowledge graph.
 *
 * The palette matches the viewer's light theme (`#f7faff` surfaces, `#1f67e8`
 * accents, `#dce5f1` borders) so the graph page does not look bolted on.
 * Colours live in TypeScript rather than CSS custom properties because Canvas 2D
 * cannot read CSS variables directly and resolving them per frame is wasteful.
 */

import type { EntityType } from '../../../modules/knowledge-graph/public';

export interface GraphTheme {
  background: string;
  grid: string;
  paperNode: string;
  paperNodeCore: string;
  /** Fallback for an entity whose type is unknown. */
  entityNode: string;
  /**
   * One colour per entity type.
   *
   * All entities used to share a single light blue, so a canvas of a dozen nodes carried no
   * information beyond "these are things": a Method, a Metric and a Concept looked identical. The
   * type is the one property every entity has, so it is what the colour encodes.
   */
  entityTypeColors: Record<EntityType, string>;
  /** Personal nodes: the user's own notes, highlights, folders and tags. */
  noteNode: string;
  highlightNode: string;
  folderNode: string;
  tagNode: string;
  userNode: string;
  nodeStroke: string;
  nodeHover: string;
  nodeSelected: string;
  nodeMatched: string;
  label: string;
  /** Label plate behind text, so a caption stays readable over the lines it crosses. */
  labelPlate: string;
  edgeAi: string;
  edgeRule: string;
  edgeUser: string;
  edgeHighlight: string;
  edgeLabel: string;
}

export const LIGHT_GRAPH_THEME: GraphTheme = {
  background: '#f7faff',
  grid: '#e8eefb',
  paperNode: '#1f67e8',
  paperNodeCore: '#f7faff',
  entityNode: '#8fb4ff',
  // Hues chosen to stay distinguishable on the light surface and from each other. Papers keep the
  // deep blue: they are the anchors, and everything else should read as attached to them.
  entityTypeColors: {
    Method: '#e8833a',
    Dataset: '#3aa76d',
    Task: '#8b5cf6',
    Metric: '#c99400',
    Concept: '#8595ab',
    Claim: '#c2553f',
  },
  // Personal nodes are deliberately outside the blue family: the graph already
  // uses saturation for confidence, so reusing blue would imply the user's own
  // notes carry a model confidence they do not have.
  noteNode: '#7c5cd6',
  highlightNode: '#d97706',
  folderNode: '#6b7f9e',
  tagNode: '#2f9e6f',
  userNode: '#16233d',
  nodeStroke: '#ffffff',
  nodeHover: '#1458d4',
  nodeSelected: '#0d3fa8',
  nodeMatched: '#f59e0b',
  label: '#16233d',
  labelPlate: 'rgba(247, 250, 255, 0.88)',
  // Edges are context, not content: muted so the eye lands on the nodes first.
  edgeAi: '#93a6c6',
  edgeRule: '#c2cddd',
  edgeUser: '#7fb89f',
  edgeHighlight: '#d97706',
  edgeLabel: '#6b7f9e',
};

/** Kinds that represent the user's own material rather than learned knowledge. */
const PERSONAL_KINDS = new Set(['note', 'highlight', 'folder', 'tag', 'user']);

export function isPersonalKind(kind: string): boolean {
  return PERSONAL_KINDS.has(kind);
}

export function nodeFill(
  kind: string,
  theme: GraphTheme,
  entityType?: EntityType,
): string {
  switch (kind) {
    case 'paper': return theme.paperNode;
    case 'entity':
      return (entityType && theme.entityTypeColors[entityType]) || theme.entityNode;
    case 'note': return theme.noteNode;
    case 'highlight': return theme.highlightNode;
    case 'folder': return theme.folderNode;
    case 'tag': return theme.tagNode;
    default: return theme.userNode;
  }
}

export function resolveGraphTheme(): GraphTheme {
  return LIGHT_GRAPH_THEME;
}

/** Human-readable provenance copy for the edge inspector. */
export function describeEdgeOrigin(origin: 'ai' | 'rule' | 'user'): string {
  if (origin === 'ai') return 'AI 判断';
  if (origin === 'user') return '用户标注';
  return '规则推导';
}

export function describeEdgeOriginDetail(origin: 'ai' | 'rule' | 'user'): string {
  if (origin === 'ai') return '由模型判断得出，可信度取决于置信度与原文证据。';
  if (origin === 'user') return '由你手动添加或确认，属于个人数据。';
  return '由本地规则推导（例如共享关键词或同一文件夹），没有经过模型判断，也没有原文证据。';
}
