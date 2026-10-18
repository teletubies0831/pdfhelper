/**
 * Multi-paper extraction.
 *
 * Built on top of the single-paper runner rather than beside it, because every
 * property worth having already lives there: per-batch commits, the resumable
 * cursor, the per-paper lock, and the input fingerprint that skips an unchanged
 * paper without spending a token.
 *
 * What this layer adds is **ordering and bounded pressure**. Papers are processed
 * one at a time on purpose: a batch that fanned out across papers would multiply
 * the in-flight request count by the batch size, and the provider rate limiter
 * would then be doing the throttling that the graph should have done itself. The
 * per-paper fingerprint check is what makes a batch cheap to re-run — already
 * extracted papers cost one chunk read each and no network calls.
 */

export interface BatchTargetPaper {
  paperId: string;
  title: string;
}

export interface BatchProgress {
  /** Papers finished so far, including skipped ones. */
  completedPapers: number;
  totalPapers: number;
  /** Paper currently being processed. */
  currentTitle: string;
  message: string;
  lastResult?: BatchPaperOutcome;
}

export interface BatchPaperOutcome {
  paperId: string;
  title: string;
  status: 'done' | 'skipped' | 'failed' | 'busy' | 'cancelled';
  candidatesFound: number;
  newEntityCount: number;
  reason?: string;
}

export interface BatchExtractionResult {
  outcomes: BatchPaperOutcome[];
  papersProcessed: number;
  papersSkipped: number;
  papersFailed: number;
  totalCandidatesFound: number;
  totalNewEntities: number;
  cancelled: boolean;
}

export interface BatchExtractionRunnerPorts {
  /**
   * Runs one paper to completion. Injected rather than imported so this module
   * stays pure and testable, and so the batch layer cannot accidentally reach
   * around the single-paper runner's invariants.
   */
  runPaper(paperId: string, signal?: AbortSignal): Promise<{
    status: 'done' | 'skipped' | 'failed' | 'busy' | 'cancelled';
    candidatesFound: number;
    newEntityCount: number;
    reason?: string;
  }>;
}

export interface BatchExtractionOptions {
  papers: readonly BatchTargetPaper[];
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress) => void;
}

/**
 * Runs extraction across papers, sequentially and cancellably.
 *
 * Cancellation is checked *between* papers, never mid-paper: the single-paper
 * runner commits per batch, so stopping between papers always leaves every
 * finished batch persisted and the unfinished one resumable from its cursor.
 */
export async function runBatchExtraction(
  ports: BatchExtractionRunnerPorts,
  options: BatchExtractionOptions,
): Promise<BatchExtractionResult> {
  const outcomes: BatchPaperOutcome[] = [];
  const total = options.papers.length;
  let cancelled = false;

  for (const [index, paper] of options.papers.entries()) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    options.onProgress?.({
      completedPapers: index,
      totalPapers: total,
      currentTitle: paper.title,
      message: `正在抽取第 ${index + 1}/${total} 篇：${paper.title}`,
    });

    let outcome: BatchPaperOutcome;
    try {
      const result = await ports.runPaper(paper.paperId, options.signal);
      outcome = {
        paperId: paper.paperId,
        title: paper.title,
        status: result.status,
        candidatesFound: result.candidatesFound,
        newEntityCount: result.newEntityCount,
        reason: result.reason,
      };
    } catch (error) {
      // One paper failing must not abandon the rest: the others are independent
      // and their tokens would otherwise be wasted.
      outcome = {
        paperId: paper.paperId,
        title: paper.title,
        status: 'failed',
        candidatesFound: 0,
        newEntityCount: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    outcomes.push(outcome);

    options.onProgress?.({
      completedPapers: index + 1,
      totalPapers: total,
      currentTitle: paper.title,
      message: `已完成 ${index + 1}/${total} 篇`,
      lastResult: outcome,
    });

    if (outcome.status === 'cancelled') {
      cancelled = true;
      break;
    }
  }

  const papersSkipped = outcomes.filter((outcome) => outcome.status === 'skipped').length;
  const papersFailed = outcomes.filter(
    (outcome) => outcome.status === 'failed' || outcome.status === 'busy',
  ).length;

  return {
    outcomes,
    papersProcessed: outcomes.length - papersSkipped,
    papersSkipped,
    papersFailed,
    totalCandidatesFound: outcomes.reduce((sum, outcome) => sum + outcome.candidatesFound, 0),
    totalNewEntities: outcomes.reduce((sum, outcome) => sum + outcome.newEntityCount, 0),
    cancelled,
  };
}

/**
 * Papers worth sending through extraction.
 *
 * Papers with no chunks cannot be extracted at all, so they are filtered out
 * before the batch starts rather than each failing individually — a batch that
 * reports "8 of 10 failed: no index" is noise, not information. The caller is
 * expected to have told the user which papers were skipped.
 */
export function selectBatchTargets(
  papers: readonly BatchTargetPaper[],
  indexedPaperIds: ReadonlySet<string>,
): { targets: BatchTargetPaper[]; skippedForIndex: BatchTargetPaper[] } {
  const targets: BatchTargetPaper[] = [];
  const skippedForIndex: BatchTargetPaper[] = [];
  for (const paper of papers) {
    if (indexedPaperIds.has(paper.paperId)) targets.push(paper);
    else skippedForIndex.push(paper);
  }
  return { targets, skippedForIndex };
}

/** One-line summary for the status bar. */
export function summarizeBatchResult(result: BatchExtractionResult): string {
  const parts = [
    `已处理 ${result.papersProcessed} 篇`,
    result.papersSkipped ? `跳过 ${result.papersSkipped} 篇（正文未变化）` : '',
    result.totalNewEntities ? `新增候选 ${result.totalNewEntities} 个` : '',
    result.papersFailed ? `${result.papersFailed} 篇失败` : '',
    result.cancelled ? '已取消' : '',
  ];
  return parts.filter(Boolean).join('，') + '。';
}
