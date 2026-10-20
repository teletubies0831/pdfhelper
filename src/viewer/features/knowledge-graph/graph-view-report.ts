/**
 * What the graph page reports about the view it is showing.
 *
 * Extracted from the page controller because this text is where the page has been
 * misleading, and misleading text is worse than missing text: the counts line used to
 * say "过滤隐藏 10" for documents that were not filtered at all — they simply had no
 * relations yet — and the empty-canvas hint told the user to widen their filters when
 * nothing had ever been filtered. Both sent the reader looking for a problem that did
 * not exist.
 *
 * Pure and dependency-free so the rules can be tested directly.
 */

export interface GraphViewCountsInput {
  /** Papers actually drawn. */
  visiblePapers: number;
  /** Entities actually drawn. */
  visibleEntities: number;
  /** Personal nodes drawn (notes, highlights, folders, tags, the user anchor). */
  visibleUserNodes: number;
  /** Edges drawn. */
  visibleEdges: number;
  /**
   * Nodes that exist in the graph but belong to no edge.
   *
   * The whole-graph view builds its node set *from* edges, so these cannot appear on the
   * canvas — and they are not filtered out either.
   */
  unconnectedNodes: number;
  /** Nodes that exist, have edges, and were excluded by the current filters. */
  hiddenByFilters: number;
  truncated: boolean;
  /** Condensation summary, e.g. "已折叠 12 个叶子节点". */
  condensationNote: string;
}

export function formatGraphCounts(input: GraphViewCountsInput): string {
  return [
    `${input.visiblePapers} 文献`,
    `${input.visibleEntities} 实体`,
    input.visibleUserNodes ? `${input.visibleUserNodes} 个人标注` : '',
    `${input.visibleEdges} 边`,
    input.truncated ? '已截断' : '',
    input.condensationNote,
    input.unconnectedNodes ? `未连接 ${input.unconnectedNodes}` : '',
    input.hiddenByFilters ? `过滤隐藏 ${input.hiddenByFilters}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Why the graph page is loading.
 *
 * Only a load the user asked for announces itself with the floating plate: entering the page and coming back to it both
 * project the knowledge base, and a 「已同步：写入 0 篇文献」 plate on every visit is noise over the canvas. Kept as a
 * named rule (rather than a boolean at each call site) because "which loads are silent" is a product decision, and one
 * this suite can pin.
 */
export type GraphLoadReason = 'entry' | 'refresh' | 'resync' | 'action';

/** True only for the explicit 「重新同步」 click. */
export function shouldAnnounceGraphLoad(reason: GraphLoadReason): boolean {
  return reason === 'resync';
}

export interface GraphViewReport {
  /** Text for the counts line above the canvas. */
  countsText: string;
  /** True when the canvas has nothing to draw. */
  empty: boolean;
  /** Explanation shown when the canvas is empty. */
  emptyHint: string;
}

export interface GraphViewReportInput {
  visiblePapers: number;
  visibleEntities: number;
  visibleUserNodes: number;
  visibleEdges: number;
  unconnectedNodes: number;
  hiddenByFilters: number;
  truncated: boolean;
  condensationNote: string;
  /** Totals from the snapshot, used to tell the empty cases apart. */
  totalPapers: number;
  totalEntities: number;
  /** Stored edges that can actually be drawn — negatives excluded. */
  totalEdges: number;
  /**
   * Recorded "no relation" verdicts.
   *
   * Those records are a cache, not relationships, so they never draw. Mentioning them is what turns
   * an empty canvas from "something is broken" into "these pairs were judged unrelated".
   */
  unrelatedPairCount?: number;
}

/**
 * Three different reasons for an empty canvas, and they need different answers:
 *
 * - nothing in the knowledge base yet → add a PDF to it;
 * - documents exist but nothing connects them → extract/confirm entities or analyse
 *   relations (the graph is built from relations, so this is the normal starting state);
 * - a filter really is hiding everything → widen the filters.
 *
 * The wording follows the authority: the graph's papers come from the **knowledge base**,
 * so "read some PDFs" is no longer the instruction — opening a PDF does not add it.
 */
export function describeGraphView(input: GraphViewReportInput): GraphViewReport {
  const countsText = formatGraphCounts({
    visiblePapers: input.visiblePapers,
    visibleEntities: input.visibleEntities,
    visibleUserNodes: input.visibleUserNodes,
    visibleEdges: input.visibleEdges,
    unconnectedNodes: input.unconnectedNodes,
    hiddenByFilters: input.hiddenByFilters,
    truncated: input.truncated,
    condensationNote: input.condensationNote,
  });

  const empty = input.visiblePapers + input.visibleEntities === 0;
  if (!empty) return { countsText, empty, emptyHint: '' };

  // Keyed on the paper count alone. With entities present but no papers the graph is still empty of
  // *documents*, and the old condition fell through to "the 0 篇文献 in your knowledge base are not
  // connected" — a sentence that contradicts itself and sends the user to extract from nothing.
  if (input.totalPapers === 0) {
    return {
      countsText,
      empty,
      emptyHint: '知识库还是空的：打开 PDF 后点「添加到知识库」，它才会进入图谱。',
    };
  }
  if (input.totalEdges === 0) {
    // Judged-unrelated is not "nothing has been analysed yet": telling the user to run the analysis
    // again would spend tokens to re-derive a conclusion they already have.
    if ((input.unrelatedPairCount ?? 0) > 0) {
      return {
        countsText,
        empty,
        emptyHint:
          '这些文献之间的关系已被判断为「无关系」（结论已缓存，不会重复消耗 Token），所以没有连线可画：'
          + '换一组文献，或在某条边的详情里「重新判断」。',
      };
    }
    return {
      countsText,
      empty,
      emptyHint:
        `知识库里的 ${input.totalPapers} 篇文献之间还没有任何关系：`
        + '先「抽取候选实体」并确认，共享实体就会自动把文献连起来；也可以直接「分析关系」。',
    };
  }
  return {
    countsText,
    empty,
    emptyHint: '当前过滤条件下没有可显示的节点，请放宽过滤条件或清空搜索。',
  };
}
