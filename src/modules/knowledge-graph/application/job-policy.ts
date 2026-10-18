import type {
  ExtractionJobCursor,
  ExtractionJobKind,
  ExtractionJobRecord,
  ExtractionJobStatus,
} from '../contracts-jobs.ts';

/**
 * Job lifecycle policy.
 *
 * The MV3 service worker can be torn down between messages, so a multi-batch
 * extraction cannot be held in memory. Every state transition is decided by the
 * pure functions here and persisted by the caller, which means a run that is
 * interrupted mid-way resumes from its cursor instead of re-spending tokens on
 * batches that already succeeded.
 *
 * Keeping this pure is also what makes the retry policy testable: the rules that
 * decide "stop asking the model" are exactly the ones that waste money when they
 * are wrong.
 */

/** Attempts allowed before a job is parked as failed. */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Backoff before the next attempt, in milliseconds.
 *
 * Deliberately modest: the user pressed a button and is watching, and the
 * provider layer already handles 429 with its own `Retry-After`-aware queue
 * (`provider-rate-limit.ts`). This backoff is for transient failures only, so it
 * must not stack into a multi-minute wait on top of the provider's own delays.
 */
export function jobRetryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.min(MAX_JOB_ATTEMPTS, Math.floor(attempts)));
  return Math.min(30_000, 1_000 * 2 ** (safeAttempts - 1));
}

export function shouldRetryJob(job: ExtractionJobRecord): boolean {
  if (job.status === 'done' || job.status === 'cancelled') return false;
  return job.attempts < MAX_JOB_ATTEMPTS;
}

export interface JobProgress {
  /** Index of the next unit of work (chunk, pair, comparison). */
  index: number;
  /** Total units, when known; used only for progress display. */
  total?: number;
}

export function jobProgressOf(job: ExtractionJobRecord, kind: ExtractionJobKind): number {
  const cursor = job.cursor;
  if (!cursor) return 0;
  if (kind === 'entity-extraction') return cursor.batchIndex ?? 0;
  if (kind === 'relation-judgement') return cursor.pairIndex ?? 0;
  return cursor.alignmentIndex ?? 0;
}

export function cursorFromProgress(
  kind: ExtractionJobKind,
  progress: JobProgress,
): ExtractionJobCursor {
  const index = Math.max(0, Math.floor(progress.index));
  if (kind === 'entity-extraction') return { batchIndex: index };
  if (kind === 'relation-judgement') return { pairIndex: index };
  return { alignmentIndex: index };
}

/** Creates a fresh job record. */
export function createJobRecord(input: {
  jobId: string;
  paperId: string;
  kind: ExtractionJobKind;
  inputFingerprint: string;
  now?: number;
}): ExtractionJobRecord {
  const now = input.now ?? Date.now();
  return {
    jobId: input.jobId,
    paperId: input.paperId,
    kind: input.kind,
    status: 'queued',
    attempts: 0,
    lastError: null,
    cursor: null,
    inputFingerprint: input.inputFingerprint,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Whether an existing job can be reused instead of starting over.
 *
 * The fingerprint is the whole point: the same paper with the same content must
 * not be re-extracted (that is the token saving), but changed content must
 * invalidate the cached result (that is the correctness).
 */
export function canResumeJob(
  job: ExtractionJobRecord | null | undefined,
  inputFingerprint: string,
): job is ExtractionJobRecord {
  if (!job) return false;
  if (job.inputFingerprint !== inputFingerprint) return false;
  return job.status === 'queued' || job.status === 'running' || job.status === 'failed';
}

/** True when the job already finished for exactly this input. */
export function isJobComplete(
  job: ExtractionJobRecord | null | undefined,
  inputFingerprint: string,
): boolean {
  return Boolean(job && job.status === 'done' && job.inputFingerprint === inputFingerprint);
}

export function markJobRunning(
  job: ExtractionJobRecord,
  now = Date.now(),
): ExtractionJobRecord {
  return {
    ...job,
    status: 'running',
    attempts: job.attempts + 1,
    lastError: null,
    updatedAt: now,
  };
}

/** Records forward progress; clears the error because this attempt got somewhere. */
export function markJobProgress(
  job: ExtractionJobRecord,
  cursor: ExtractionJobCursor,
  now = Date.now(),
): ExtractionJobRecord {
  return {
    ...job,
    status: 'running',
    cursor,
    lastError: null,
    updatedAt: now,
  };
}

/**
 * Records a failure and decides whether the job is still retryable.
 *
 * A retryable failure goes back to `queued` — not `running` — so a later resume
 * does not mistake a half-finished attempt for live work.
 */
export function markJobFailed(
  job: ExtractionJobRecord,
  error: string,
  now = Date.now(),
): ExtractionJobRecord {
  const retryable = job.attempts < MAX_JOB_ATTEMPTS;
  return {
    ...job,
    status: retryable ? 'queued' : 'failed',
    lastError: error.slice(0, 500),
    updatedAt: now,
  };
}

export function markJobDone(
  job: ExtractionJobRecord,
  now = Date.now(),
): ExtractionJobRecord {
  return {
    ...job,
    status: 'done',
    lastError: null,
    updatedAt: now,
  };
}

export function markJobCancelled(
  job: ExtractionJobRecord,
  now = Date.now(),
): ExtractionJobRecord {
  return { ...job, status: 'cancelled', updatedAt: now };
}

/**
 * Fingerprint of the extraction input.
 *
 * Built from the chunk ids plus their text lengths rather than the text itself:
 * a length change catches the realistic edits (re-index after a re-parse, a
 * different chunking strategy) without storing a second copy of the paper. It is
 * deliberately *not* a hash of the whole text, because that would mean reading
 * every chunk of every paper just to decide whether to skip.
 */
export function extractionInputFingerprint(input: {
  paperId: string;
  chunkIds: readonly string[];
  chunkCharacterCounts: readonly number[];
  promptVersion: string;
  maxCandidatesPerChunk: number;
}): string {
  const parts = [
    input.paperId,
    input.promptVersion,
    `cap:${input.maxCandidatesPerChunk}`,
    `chunks:${input.chunkIds.length}`,
    input.chunkIds.join(','),
    input.chunkCharacterCounts.join(','),
  ];
  return parts.join('|');
}

/**
 * How many batches still need work, from the persisted cursor.
 *
 * Used for the progress readout, and by tests to assert that resuming does not
 * restart from zero.
 */
export function remainingBatches(
  cursorIndex: number,
  batchCount: number,
): number {
  return Math.max(0, batchCount - Math.max(0, cursorIndex));
}

export function isTerminalJobStatus(status: ExtractionJobStatus): boolean {
  return status === 'done' || status === 'cancelled' || status === 'failed';
}
