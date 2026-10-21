import type { KnowledgeDocumentIndexStatus } from '../../../modules/knowledge/public';

/**
 * 「打开文献时该不该顺手重建索引」的判定.
 *
 * Pure, because the *decision* is the part that can be wrong in a way nobody notices: rebuilding for a record that was
 * never indexed is surprising work, rebuilding while a run is already in flight starts a second worker, and treating a
 * failed storage read as "missing" would rebuild over data that is actually fine. The caller does the IO; this decides.
 *
 * Indexing is local (chunking plus a local embedding model), so it costs time rather than money — but it is still not
 * something to do silently on every open, hence `alreadyAttempted` per session.
 */

export interface IndexPrecheckInput {
  /** The library record for the document now open, if any. A PDF that is not in the library has nothing to repair. */
  record: {
    documentId: string;
    documentName: string;
    indexStatus: KnowledgeDocumentIndexStatus;
  } | null;
  /** Non-empty chunk count as read from storage; `null` when the read failed (which is not "zero"). */
  chunkCount: number | null;
  /** An index run for this record is already in flight. */
  isIndexRunning: boolean;
  /** This session already tried to repair this record once. */
  alreadyAttempted: boolean;
}

export type IndexPrecheckDecision =
  | { action: 'skip'; reason: string }
  | { action: 'rebuild'; documentId: string };

export function decideIndexPrecheck(input: IndexPrecheckInput): IndexPrecheckDecision {
  const { record } = input;
  if (!record) return { action: 'skip', reason: '这份 PDF 还没进知识库。' };
  // A record that was never indexed has no data to lose, and one that is indexing right now is already being handled.
  // Both are the normal flow's business, not a repair.
  if (record.indexStatus !== 'ready' && record.indexStatus !== 'error') {
    return { action: 'skip', reason: '这篇文献的索引还没有完成过一次。' };
  }
  if (input.isIndexRunning) return { action: 'skip', reason: '索引已经在跑了。' };
  if (input.alreadyAttempted) return { action: 'skip', reason: '这次会话里已经修过一次。' };
  // A read failure is not evidence of anything: leave it to 数据体检, which can say so instead of rebuilding blindly.
  if (input.chunkCount === null) return { action: 'skip', reason: '读不到本地索引，交给数据体检处理。' };
  if (input.chunkCount > 0) return { action: 'skip', reason: '索引是完整的。' };
  return { action: 'rebuild', documentId: record.documentId };
}
