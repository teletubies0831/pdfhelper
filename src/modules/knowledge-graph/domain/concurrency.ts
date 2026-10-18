/**
 * Bounded-concurrency task runner.
 *
 * Two jobs:
 *
 * - Never push more than `limit` requests at a provider at once. The provider
 *   layer already has its own 429 queue, but that reacts *after* a limit is hit;
 *   this stops the graph from being the thing that hits it.
 * - Report results positionally, so the caller can persist per-batch progress
 *   even when batches finish out of order. Order-independence is what makes the
 *   persisted cursor safe.
 *
 * Deliberately sequential when `limit <= 1`, so the common "be gentle" setting
 * has obviously correct behaviour rather than being a special case of a worker
 * pool.
 */

export interface TaskOutcome<T> {
  index: number;
  ok: boolean;
  value?: T;
  error?: string;
}

export interface RunTasksOptions {
  /** Maximum tasks in flight at once. Clamped to at least 1. */
  limit: number;
  /** Checked before each task starts; a throwing abort stops scheduling. */
  signal?: AbortSignal;
  /** Called as each task settles, in completion order. */
  onSettled?: (outcome: TaskOutcome<unknown>) => void;
}

/**
 * Runs `tasks` with at most `limit` in flight.
 *
 * A rejected task never rejects the whole run: its outcome is reported with
 * `ok: false`, because one failed batch must not discard the batches that
 * already succeeded (their tokens are already spent).
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  options: RunTasksOptions,
): Promise<Array<TaskOutcome<T>>> {
  const limit = Math.max(1, Math.floor(options.limit));
  const outcomes: Array<TaskOutcome<T>> = new Array(tasks.length);

  if (!tasks.length) return outcomes;

  const { signal } = options;
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      // Abort is checked between tasks, never mid-task: an in-flight request is
      // left to finish or fail on its own signal, so a cancellation cannot leave
      // a provider call neither counted nor recorded.
      if (signal?.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;

      const task = tasks[index]!;
      let outcome: TaskOutcome<T>;
      try {
        outcome = { index, ok: true, value: await task() };
      } catch (error) {
        outcome = {
          index,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      outcomes[index] = outcome;
      options.onSettled?.(outcome as TaskOutcome<unknown>);
    }
  };

  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  // Tasks skipped by an abort are simply absent; represent them explicitly so
  // callers never have to reason about holes in the array.
  for (let index = 0; index < tasks.length; index += 1) {
    if (!outcomes[index]) {
      outcomes[index] = { index, ok: false, error: '任务已取消。' };
    }
  }
  return outcomes;
}

/**
 * Highest contiguous completed index.
 *
 * A cursor may only advance across a *contiguous* run of successes. Advancing it
 * over a gap would mark a failed batch as done, and the retry would then skip it
 * — silently losing those entities and their token spend.
 */
export function contiguousCompletedCount(
  outcomes: ReadonlyArray<TaskOutcome<unknown>>,
  fromIndex = 0,
): number {
  let count = 0;
  for (let index = fromIndex; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (!outcome || !outcome.ok) break;
    count += 1;
  }
  return count;
}
