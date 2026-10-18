import type { ExtractionJobRecord } from '../../contracts-jobs.ts';
import {
  GRAPH_EXTRACTION_JOBS_STORE,
  JOB_PAPER_INDEX,
  openKnowledgeGraphDatabase,
  readAllFromGraphStore,
  requestToPromise,
  transactionDone,
  writeGraphStore,
} from './knowledge-graph-database.ts';

/**
 * Persistence for extraction jobs.
 *
 * These records are the feature's durability boundary: without them, a service
 * worker teardown between batches would lose all knowledge of what had already
 * been extracted, and the next run would pay for the same tokens again.
 */

export interface ExtractionJobRepository {
  listJobs(): Promise<ExtractionJobRecord[]>;
  getJob(jobId: string): Promise<ExtractionJobRecord | null>;
  /** Latest job for a paper and kind, regardless of status. */
  findJob(paperId: string, kind: ExtractionJobRecord['kind']): Promise<ExtractionJobRecord | null>;
  putJob(job: ExtractionJobRecord): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  /** Drops every job for a paper; used when a paper leaves the graph. */
  deleteJobsForPaper(paperId: string): Promise<number>;
}

export class IndexedDbExtractionJobRepository implements ExtractionJobRepository {
  listJobs(): Promise<ExtractionJobRecord[]> {
    return readAllFromGraphStore<ExtractionJobRecord>(GRAPH_EXTRACTION_JOBS_STORE);
  }

  async getJob(jobId: string): Promise<ExtractionJobRecord | null> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EXTRACTION_JOBS_STORE, 'readonly');
      const value = await requestToPromise<ExtractionJobRecord | undefined>(
        transaction.objectStore(GRAPH_EXTRACTION_JOBS_STORE).get(jobId),
      );
      return value ?? null;
    } finally {
      database.close();
    }
  }

  async findJob(
    paperId: string,
    kind: ExtractionJobRecord['kind'],
  ): Promise<ExtractionJobRecord | null> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EXTRACTION_JOBS_STORE, 'readonly');
      const rows = await requestToPromise<ExtractionJobRecord[]>(
        transaction
          .objectStore(GRAPH_EXTRACTION_JOBS_STORE)
          .index(JOB_PAPER_INDEX)
          .getAll(paperId),
      );
      const matching = rows.filter((job) => job.kind === kind);
      if (!matching.length) return null;
      // Newest first, so a re-queued job wins over a stale completed one.
      return matching.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    } finally {
      database.close();
    }
  }

  async putJob(job: ExtractionJobRecord): Promise<void> {
    await writeGraphStore(GRAPH_EXTRACTION_JOBS_STORE, (store) => store.put(job));
  }

  async deleteJob(jobId: string): Promise<void> {
    await writeGraphStore(GRAPH_EXTRACTION_JOBS_STORE, (store) => store.delete(jobId));
  }

  async deleteJobsForPaper(paperId: string): Promise<number> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EXTRACTION_JOBS_STORE, 'readwrite');
      const index = transaction.objectStore(GRAPH_EXTRACTION_JOBS_STORE).index(JOB_PAPER_INDEX);
      const keys = await requestToPromise<IDBValidKey[]>(index.getAllKeys(paperId));
      const store = transaction.objectStore(GRAPH_EXTRACTION_JOBS_STORE);
      for (const key of keys) store.delete(key);
      await transactionDone(transaction);
      return keys.length;
    } finally {
      database.close();
    }
  }
}
