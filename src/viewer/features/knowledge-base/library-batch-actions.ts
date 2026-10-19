import {
  getDocumentOverviewMarkdown,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';

/**
 * 批量操作的「计划」部分：谁会被处理、谁会被跳过、要花多少钱。
 *
 * Kept away from the code that actually runs the operations, because the interesting part is this one: a batch that
 * quietly skips half the selection is indistinguishable from one that succeeded, and a batch that silently spends money
 * is worse than not having the button. So the plan is computed first, shown to the user (counts, skip reasons, total
 * cost), and only then executed.
 */

/** The one price the library knows for certain: a DeepSeek web-retrieval call. */
export const RELATED_SEARCH_COST_YUAN = 0.005;

export interface BatchSkip {
  documentId: string;
  documentName: string;
  reason: string;
}

export interface BatchRelatedPlan {
  runnable: KnowledgeLibraryDocument[];
  skipped: BatchSkip[];
  estimatedCostYuan: number;
}

/**
 * Decides which selected documents can have 「相关论文」 fetched.
 *
 * Three ways to be skipped, each with its own sentence: no overview (nothing to search from), web retrieval not
 * configured (nothing to search with), and already running (would double-charge for the same paper).
 */
export function planBatchRelatedPapers(
  documents: readonly KnowledgeLibraryDocument[],
  options: {
    webRetrievalReady: boolean;
    isRunning: (documentId: string) => boolean;
  },
): BatchRelatedPlan {
  const runnable: KnowledgeLibraryDocument[] = [];
  const skipped: BatchSkip[] = [];
  for (const document of documents) {
    if (!options.webRetrievalReady) {
      skipped.push({
        documentId: document.documentId,
        documentName: document.documentName,
        reason: '未配置 DeepSeek API Key，检索无法运行',
      });
      continue;
    }
    if (!getDocumentOverviewMarkdown(document).trim()) {
      skipped.push({
        documentId: document.documentId,
        documentName: document.documentName,
        reason: '还没有概览，没有可用来检索的主题',
      });
      continue;
    }
    if (options.isRunning(document.documentId)) {
      skipped.push({
        documentId: document.documentId,
        documentName: document.documentName,
        reason: '这篇正在检索中',
      });
      continue;
    }
    runnable.push(document);
  }
  return {
    runnable,
    skipped,
    estimatedCostYuan: runnable.length * RELATED_SEARCH_COST_YUAN,
  };
}

/** `¥0.015`-style money, or `零` when the plan is empty. */
export function formatBatchCost(yuan: number): string {
  return yuan > 0 ? `¥${yuan.toFixed(3)}` : '¥0';
}

/**
 * The confirmation the user sees before money is spent: how many papers, how much, and exactly what is being left out.
 *
 * Skipped documents are listed by name rather than counted, because "跳过 2 篇" invites the question "which two" and the
 * answer is usually the reason the batch was a bad idea.
 */
export function describeBatchRelatedPlan(plan: BatchRelatedPlan): string {
  const lines = [
    `将为 ${plan.runnable.length} 篇文献各检索一次相关论文，合计约 ${formatBatchCost(plan.estimatedCostYuan)}。`,
  ];
  if (plan.skipped.length) {
    lines.push('', `跳过 ${plan.skipped.length} 篇：`);
    for (const skip of plan.skipped.slice(0, 8)) {
      lines.push(`· ${skip.documentName.replace(/\.pdf$/i, '')}：${skip.reason}`);
    }
    if (plan.skipped.length > 8) lines.push(`· 另有 ${plan.skipped.length - 8} 篇同样原因`);
  }
  lines.push('', '继续吗？');
  return lines.join('\n');
}
