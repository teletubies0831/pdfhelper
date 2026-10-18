import type { AiExtractEntitiesRequest } from '../../ai/public';
import type {
  GraphEntity,
  GraphPaper,
} from '../contracts.ts';
import type { ExtractionJobRecord } from '../contracts-jobs.ts';
import { runWithConcurrency, contiguousCompletedCount } from '../domain/concurrency.ts';
import { normalizeEntityName } from '../domain/entity-normalization.ts';
import { suggestEntityMerges } from '../domain/entity-similarity.ts';
import {
  EXTRACTION_PROMPT_VERSION,
  planExtractionBatches,
  type ExtractionBatch,
} from './extraction-plan.ts';
import {
  canResumeJob,
  createJobRecord,
  extractionInputFingerprint,
  isJobComplete,
  markJobDone,
  markJobFailed,
  markJobProgress,
  markJobRunning,
  MAX_JOB_ATTEMPTS,
  shouldRetryJob,
} from './job-policy.ts';
import { planPendingCandidateUpsert } from './pending-candidates.ts';
import { parseEntityCandidates } from './candidate-parsing.ts';

/**
 * Entity extraction orchestrator.
 *
 * Owns the whole run: decide whether to run at all, resume from the persisted
 * cursor, keep provider pressure bounded, commit after every batch, and record
 * enough state that a service-worker teardown costs nothing but time.
 *
 * Every collaborator is injected. That is not ceremony — it is the only way to
 * test any of this, because the real dependencies are IndexedDB and a network
 * provider, and the rules being tested here are exactly the ones where a mistake
 * either loses tokens or silently corrupts the graph.
 */

export interface ExtractionRunnerPorts {
  loadChunks(documentId: string): Promise<AiExtractEntitiesRequest['chunks']>;
  getJob(paperId: string): Promise<ExtractionJobRecord | null>;
  putJob(job: ExtractionJobRecord): Promise<void>;
  listEntities(): Promise<GraphEntity[]>;
  /** Writes planned entities; returns how many were new. */
  putEntities(entities: readonly GraphEntity[]): Promise<void>;
  /** Removes entities outright; used to replace a paper's stale unconfirmed candidates. */
  deleteEntities(entityIds: readonly string[]): Promise<void>;
  getPaper(paperId: string): Promise<GraphPaper | null>;
  /**
   * One short paragraph saying what the paper is about, used to frame every batch.
   *
   * Resolved by the caller — bibliographic abstract first, the knowledge base's document overview as
   * a fallback — because only it can see both stores. Empty means "no framing available", which is
   * allowed and simply omits the block.
   */
  getPaperSummary(paperId: string): Promise<string>;
  /** Marks the paper's extraction status so the page can show a badge. */
  updatePaperExtraction(
    paperId: string,
    update: Pick<GraphPaper, 'extractionStatus' | 'extractionError' | 'extractedAt'>,
  ): Promise<void>;
  /** Issues the provider call; the only networked dependency. */
  requestEntities(message: AiExtractEntitiesRequest): Promise<ExtractionRunResponse>;
  readSettings(): Promise<{
    extractionMaxCandidatesPerChunk: number;
    maxConcurrentExtractionBatches: number;
    /** Names the user marked 不再提示; extraction must not propose them again. */
    ignoredEntityNames: string[];
  }>;
}

export interface ExtractionRunResponse {
  ok: boolean;
  content?: string;
  error?: string;
  entityExtraction?: {
    batchCount: number;
    failedBatches: Array<{ chunkIds: string[]; error: string }>;
  };
}

export interface ExtractionProgress {
  phase: 'checking' | 'extracting' | 'persisting' | 'done' | 'skipped' | 'failed';
  message: string;
  completedBatches: number;
  totalBatches: number;
}

export interface ExtractionRunResult {
  status: 'done' | 'skipped' | 'failed' | 'cancelled' | 'busy';
  reason?: string;
  candidatesFound: number;
  entitiesWritten: number;
  newEntityCount: number;
  batchesRun: number;
  batchesFailed: number;
  /** Entities the user still needs to confirm, produced or refreshed by this run. */
  pendingEntityIds: string[];
  /**
   * Candidates refused before the review list for scoring below `MIN_PENDING_CONFIDENCE`.
   *
   * Surfaced because it is the only number that measures how noisy the extraction still is: a run
   * that finds 60 candidates and drops 40 of them is a different situation from one that finds 20.
   */
  droppedLowConfidence: number;
  /** Candidates refused because the name is not a concept (table label, bare number, fragment). */
  droppedLowQuality: number;
  /** Candidates folded into an existing name as aliases (`XOR2` under `XOR`). */
  collapsedVariants: number;
  /** Unconfirmed candidates from this paper's previous run that this run replaced. */
  replacedPending: number;
  /** Candidates skipped because the user marked them 不再提示. */
  droppedIgnored: number;
  /** Candidates a previous 忽略 had rejected and this run proposed again. */
  reProposed: number;
  /** Readable names refused for describing an action or being mostly numbering. */
  demotedSuspect: number;
}

/**
 * Papers currently being extracted.
 *
 * Module-level so a second click, a page reopen, or a re-render cannot start a
 * second run for the same paper — which would double the token spend for the same
 * result and race two writers onto the same entities.
 */
const activeRuns = new Set<string>();

export function isExtractionRunning(paperId: string): boolean {
  return activeRuns.has(paperId);
}

export function resetExtractionRunsForTest(): void {
  activeRuns.clear();
}

export interface RunExtractionOptions {
  paperId: string;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractionProgress) => void;
  /** When true, ignore a completed job and extract again. */
  force?: boolean;
  now?: number;
}

export async function runEntityExtraction(
  ports: ExtractionRunnerPorts,
  options: RunExtractionOptions,
): Promise<ExtractionRunResult> {
  const { paperId } = options;
  const now = options.now ?? Date.now();
  const report = (progress: ExtractionProgress): void => options.onProgress?.(progress);

  if (activeRuns.has(paperId)) {
    return {
      status: 'busy',
      reason: '这篇文献正在抽取中。',
      candidatesFound: 0,
      entitiesWritten: 0,
      newEntityCount: 0,
      batchesRun: 0,
      batchesFailed: 0,
      pendingEntityIds: [],
      droppedLowConfidence: 0,
      droppedLowQuality: 0,
      collapsedVariants: 0,
      replacedPending: 0,
      droppedIgnored: 0,
      reProposed: 0,
      demotedSuspect: 0,
    };
  }
  activeRuns.add(paperId);

  try {
    report({
      phase: 'checking',
      message: '正在检查全文索引…',
      completedBatches: 0,
      totalBatches: 0,
    });

    const [chunks, settings, paper, paperSummary] = await Promise.all([
      ports.loadChunks(paperId),
      ports.readSettings(),
      ports.getPaper(paperId),
      ports.getPaperSummary(paperId),
    ]);

    if (!chunks.length) {
      const reason = '这篇文献还没有全文索引，请先在知识库中建立索引。';
      await ports.updatePaperExtraction(paperId, {
        extractionStatus: 'error',
        extractionError: reason,
        extractedAt: null,
      });
      report({ phase: 'failed', message: reason, completedBatches: 0, totalBatches: 0 });
      return {
        status: 'failed',
        reason,
        candidatesFound: 0,
        entitiesWritten: 0,
        newEntityCount: 0,
        batchesRun: 0,
        batchesFailed: 0,
        pendingEntityIds: [],
        droppedLowConfidence: 0,
        droppedLowQuality: 0,
        collapsedVariants: 0,
        replacedPending: 0,
        droppedIgnored: 0,
        reProposed: 0,
        demotedSuspect: 0,
      };
    }

    const fingerprint = extractionInputFingerprint({
      paperId,
      chunkIds: chunks.map((chunk) => chunk.chunkId),
      chunkCharacterCounts: chunks.map((chunk) => chunk.text.length),
      promptVersion: EXTRACTION_PROMPT_VERSION,
      maxCandidatesPerChunk: settings.extractionMaxCandidatesPerChunk,
    });

    const existingJob = await ports.getJob(paperId);
    if (!options.force && isJobComplete(existingJob, fingerprint)) {
      report({
        phase: 'skipped',
        message: '正文未变化，已跳过抽取（不消耗 Token）。',
        completedBatches: 0,
        totalBatches: 0,
      });
      return {
        status: 'skipped',
        reason: '正文未变化，已跳过抽取。',
        candidatesFound: 0,
        entitiesWritten: 0,
        newEntityCount: 0,
        batchesRun: 0,
        batchesFailed: 0,
        pendingEntityIds: [],
        droppedLowConfidence: 0,
        droppedLowQuality: 0,
        collapsedVariants: 0,
        replacedPending: 0,
        droppedIgnored: 0,
        reProposed: 0,
        demotedSuspect: 0,
      };
    }

    const resumable = canResumeJob(existingJob, fingerprint);
    if (existingJob && resumable && !shouldRetryJob(existingJob)) {
      const reason = existingJob.lastError
        ? `上次抽取失败且已重试 ${MAX_JOB_ATTEMPTS} 次：${existingJob.lastError}`
        : '抽取任务已停止，请稍后重试。';
      report({ phase: 'failed', message: reason, completedBatches: 0, totalBatches: 0 });
      return {
        status: 'failed',
        reason,
        candidatesFound: 0,
        entitiesWritten: 0,
        newEntityCount: 0,
        batchesRun: 0,
        batchesFailed: 0,
        pendingEntityIds: [],
        droppedLowConfidence: 0,
        droppedLowQuality: 0,
        collapsedVariants: 0,
        replacedPending: 0,
        droppedIgnored: 0,
        reProposed: 0,
        demotedSuspect: 0,
      };
    }

    const job: ExtractionJobRecord = resumable && existingJob
      ? existingJob
      : createJobRecord({
        jobId: `job:${paperId}:${now}`,
        paperId,
        kind: 'entity-extraction',
        inputFingerprint: fingerprint,
        now,
      });

    const batches = planExtractionBatches(chunks);
    // A cursor pointing past the end means the plan changed under us; restart
    // rather than silently producing an empty run.
    const startBatch = Math.min(job.cursor?.batchIndex ?? 0, batches.length);
    const pendingBatches = batches.slice(startBatch);

    let running = markJobRunning({ ...job, cursor: { batchIndex: startBatch } }, now);
    await ports.putJob(running);
    await ports.updatePaperExtraction(paperId, {
      extractionStatus: 'extracting',
      extractionError: null,
      extractedAt: null,
    });

    const accumulatedEntities: GraphEntity[] = [];
    const pendingEntityIds = new Set<string>();
    let candidatesFound = 0;
    let newEntityCount = 0;
    let batchesFailed = 0;
    let batchesRun = 0;
    /**
     * Stale pending candidates from an earlier run of this paper, replaced by this one.
     *
     * A fresh run (not a resume) starts from a clean slate for the *unconfirmed* candidates of this
     * paper: without this, re-extracting with an improved prompt would show the old noisy list mixed
     * with the new one, and the improvement would be invisible. Confirmed entities are never touched
     * — those are the user's decisions — and neither is a pending entity that another paper's
     * extraction also contributed evidence to.
     */
    let replacedPending = 0;
    if (startBatch === 0) {
      const stale = (await ports.listEntities()).filter((entity) => (
        entity.status === 'pending'
        && entity.evidence.length > 0
        && entity.evidence.every((item) => item.paperId === paperId)
      ));
      if (stale.length) {
        await ports.deleteEntities(stale.map((entity) => entity.entityId));
        replacedPending = stale.length;
      }
    }
    /**
     * Candidates the model produced but that were refused before the review list.
     *
     * Kept as a number rather than as an error: it is the measurement of how noisy the prompt still
     * is, and reporting it is what lets the prompt be judged instead of guessed at.
     */
    let droppedLowConfidence = 0;
    let droppedLowQuality = 0;
    let collapsedVariants = 0;
    /** Candidates skipped because they are on the 不再提示 list. */
    let droppedIgnored = 0;
    /** Candidates a previous 忽略 had rejected, proposed again by this run. */
    let reProposed = 0;
    /** Readable names demoted for describing an action or being mostly numbering. */
    let demotedSuspect = 0;

    report({
      phase: 'extracting',
      message: `正在抽取候选实体：0/${batches.length} 批`,
      completedBatches: startBatch,
      totalBatches: batches.length,
    });

    const tasks = pendingBatches.map((batch: ExtractionBatch) => async () => {
      const response = await ports.requestEntities({
        type: 'pdf-helper:ai-extract-entities',
        requestId: `extract:${paperId}:${batch.chunkIds[0] ?? 'batch'}`,
        paperId,
        paperTitle: paper?.title ?? paperId,
        documentName: paper?.title ?? paperId,
        // The paper's own statement of what it does, so a three-chunk window cannot mistake a
        // background method for the contribution. Absent for papers with neither an abstract nor a
        // document overview; the block is then simply omitted.
        ...(paperSummary.trim() ? { abstract: paperSummary.trim() } : {}),
        chunks: batchChunks(chunks, batch),
        maxCandidatesPerChunk: settings.extractionMaxCandidatesPerChunk,
      });
      if (!response.ok) throw new Error(response.error ?? '抽取请求失败。');
      return { response, batch };
    });

    const outcomes = await runWithConcurrency(tasks, {
      limit: settings.maxConcurrentExtractionBatches,
      signal: options.signal,
    });

    // Commit in plan order, not completion order: batches may finish out of
    // order, but accumulating in plan order keeps ids and `updatedAt` stable
    // between runs, which is what makes a repeat run a no-op.
    let committedBatches = 0;
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index]!;
      batchesRun += 1;

      if (!outcome.ok || !outcome.value) {
        if (options.signal?.aborted) break;
        batchesFailed += 1;
        continue;
      }

      const { response, batch } = outcome.value;
      const firstChunk = chunks.find((chunk) => chunk.chunkId === batch.chunkIds[0]);
      const parsed = parseEntityCandidates(
        response.content ?? '',
        {
          paperId,
          defaultPageNumber: firstChunk?.startPage ?? 1,
          chunkId: batch.chunkIds[0],
          chunkHeading: firstChunk?.heading,
          // The ceiling lives here, not in the prompt: an "at most N" instruction is read as a
          // target, and a target is what fills the list with noise.
          maxCandidates: settings.extractionMaxCandidatesPerChunk,
        },
        (name) => normalizeEntityName(String(name ?? '')),
      );
      candidatesFound += parsed.candidates.length;

      // Persist per batch. A teardown after this point costs only the batches
      // that had not finished; the ones already parsed are on disk.
      const existing = [...await ports.listEntities()];
      const plan = planPendingCandidateUpsert(paperId, parsed.candidates, existing, {
        now,
        ignoredNames: settings.ignoredEntityNames ?? [],
      });
      droppedLowConfidence += plan.droppedLowConfidence;
      droppedLowQuality += plan.droppedLowQuality;
      collapsedVariants += plan.collapsedVariants;
      droppedIgnored += plan.droppedIgnored;
      reProposed += plan.reProposed;
      demotedSuspect += plan.demotedSuspect;
      if (plan.entities.length) {
        await ports.putEntities(plan.entities);
        accumulatedEntities.push(...plan.entities);
        newEntityCount += plan.newEntityCount;
        for (const entity of plan.entities) {
          if (entity.status === 'pending') pendingEntityIds.add(entity.entityId);
        }
      }

      committedBatches += 1;
      // Advance only across contiguous successes: advancing over a failed batch
      // would mark it done and the retry would skip it, losing those entities.
      const contiguous = startBatch + contiguousCompletedCount(outcomes, 0);
      running = markJobProgress(running, { batchIndex: Math.max(startBatch, contiguous) }, now);
      await ports.putJob(running);

      report({
        phase: 'persisting',
        message: `正在抽取候选实体：${contiguous}/${batches.length} 批`,
        completedBatches: contiguous,
        totalBatches: batches.length,
      });
    }

    if (options.signal?.aborted) {
      await ports.putJob(markJobFailed(running, '用户取消了抽取。', now));
      await ports.updatePaperExtraction(paperId, {
        extractionStatus: pendingEntityIds.size ? 'ready' : 'none',
        extractionError: '抽取被取消，可稍后继续。',
        extractedAt: null,
      });
      return {
        status: 'cancelled',
        reason: '抽取已取消，已完成的部分已保存。',
        candidatesFound,
        entitiesWritten: accumulatedEntities.length,
        newEntityCount,
        batchesRun,
        batchesFailed,
        pendingEntityIds: [...pendingEntityIds],
      droppedLowConfidence,
      droppedLowQuality,
      collapsedVariants,
      replacedPending,
      droppedIgnored,
      reProposed,
      demotedSuspect,
        };
    }

    if (batchesFailed > 0) {
      const firstFailure = outcomes.find((outcome) => !outcome.ok);
      const failed = markJobFailed(running, firstFailure?.error ?? '部分批次失败。', now);
      await ports.putJob(failed);
      await ports.updatePaperExtraction(paperId, {
        extractionStatus: 'error',
        extractionError: failed.lastError,
        extractedAt: null,
      });
      report({
        phase: 'failed',
        message: `有 ${batchesFailed} 批抽取失败，已完成的部分已保存。`,
        completedBatches: committedBatches,
        totalBatches: batches.length,
      });
      return {
        status: 'failed',
        reason: failed.lastError ?? undefined,
        candidatesFound,
        entitiesWritten: accumulatedEntities.length,
        newEntityCount,
        batchesRun,
        batchesFailed,
        pendingEntityIds: [...pendingEntityIds],
      droppedLowConfidence,
      droppedLowQuality,
      collapsedVariants,
      replacedPending,
      droppedIgnored,
      reProposed,
      demotedSuspect,
        };
    }

    await ports.putJob(markJobDone(running, now));
    await ports.updatePaperExtraction(paperId, {
      extractionStatus: 'ready',
      extractionError: null,
      extractedAt: now,
    });

    // Alignment runs on the accumulated set so the user sees merge suggestions
    // next to the candidates, without a second trip through the model.
    const suggestions = suggestEntityMerges(accumulatedEntities, {
      threshold: 0.86,
    }).length;

    report({
      phase: 'done',
      message: [
        `抽取完成：${candidatesFound} 个候选`,
        // Named rather than hidden: these are the numbers that say whether the prompt is still noisy
        // and whether the filters are doing anything worth doing.
        droppedLowQuality ? `（${droppedLowQuality} 个不是概念，已丢弃）` : '',
        droppedLowConfidence ? `（${droppedLowConfidence} 个置信度过低已忽略）` : '',
        collapsedVariants ? `（${collapsedVariants} 个编号副本已并入同名实体）` : '',
        suggestions ? `，${suggestions} 组建议合并。` : '待确认。',
      ].filter(Boolean).join(''),
      completedBatches: batches.length,
      totalBatches: batches.length,
    });

    return {
      status: 'done',
      candidatesFound,
      entitiesWritten: accumulatedEntities.length,
      newEntityCount,
      batchesRun,
      batchesFailed,
      pendingEntityIds: [...pendingEntityIds],
      droppedLowConfidence,
      droppedLowQuality,
      collapsedVariants,
      replacedPending,
      droppedIgnored,
      reProposed,
      demotedSuspect,
    };
  } finally {
    activeRuns.delete(paperId);
  }
}

/** Picks the chunks belonging to a batch out of the full list, order preserved. */
function batchChunks(
  chunks: AiExtractEntitiesRequest['chunks'],
  batch: ExtractionBatch,
): AiExtractEntitiesRequest['chunks'] {
  const wanted = new Set(batch.chunkIds);
  return chunks.filter((chunk) => wanted.has(chunk.chunkId));
}
