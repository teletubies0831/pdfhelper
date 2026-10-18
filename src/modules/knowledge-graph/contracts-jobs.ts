import type { EntityType, GraphEvidence } from './contracts.ts';

/**
 * Long-running work records.
 *
 * The MV3 service worker can be torn down at any moment, so a multi-chunk entity
 * extraction cannot be held in memory. Every batch persists its cursor here and
 * the still-alive viewer page resumes the job from that cursor: the job table is
 * the feature's durability boundary, not an optimisation.
 */

export type ExtractionJobKind =
  | 'entity-extraction'
  | 'relation-judgement'
  | 'entity-alignment';

export type ExtractionJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ExtractionJobCursor {
  /**
   * Index of the next *batch* to process, not the next chunk.
   *
   * Batching is deterministic for a given paper (`planExtractionBatches`), so a
   * batch index is enough to resume, and it avoids the off-by-one that arises
   * when a cursor in chunk units has to be mapped back onto variable-sized
   * batches. Each batch is committed as it completes, so this index is always a
   * safe restart point.
   */
  batchIndex?: number;
  /** Index of the next candidate pair to judge (relation judgement). */
  pairIndex?: number;
  /** Index of the next entity comparison (alignment). */
  alignmentIndex?: number;
}

export interface ExtractionJobRecord {
  jobId: string;
  paperId: string;
  kind: ExtractionJobKind;
  status: ExtractionJobStatus;
  /** Number of provider calls attempted so far, for bounded retry. */
  attempts: number;
  lastError: string | null;
  /** Resume point; null means "start from the beginning". */
  cursor: ExtractionJobCursor | null;
  /**
   * Fingerprint of the input the job ran against. A changed fingerprint means
   * the cached result is stale and the job must re-run, which is also what keeps
   * a re-open of the same paper from spending tokens twice.
   */
  inputFingerprint: string;
  createdAt: number;
  updatedAt: number;
}

/** Entity candidate produced by extraction, before user confirmation. */
export interface ExtractedEntityCandidate {
  name: string;
  type: EntityType;
  confidence: number;
  evidence: GraphEvidence[];
  /**
   * Other spellings of the same thing, as the paper itself used them.
   *
   * The model reads a whole section, so it sees `Boyar-Peralta heuristic (BP heuristic)` and
   * knows the two spellings name one concept. Recording that here is what lets a later extraction
   * of `BP heuristic` land on the existing entity instead of creating a twin — the string
   * similarity scorer cannot make that leap, because an abbreviation shares almost no characters
   * with the name it abbreviates.
   */
  aliases?: string[];
}
