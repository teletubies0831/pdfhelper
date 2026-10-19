import type { KnowledgeLibraryDocument } from '../../../modules/knowledge/public';
import { listKnowledgeDocuments, updateKnowledgeDocument } from './knowledge-corpus-repository';
import { isMetadataExtractionRunning } from './document-metadata-extraction';

/**
 * 回收被中断的后台任务状态。
 *
 * Indexing and metadata extraction are tracked twice: as a durable flag on the record (`indexStatus: 'indexing'`,
 * `metadataStatus: 'extracting'`) and as an in-memory set of running tasks. The record survives a page reload; the set
 * does not. A reload (or closing the tab, or reloading the extension) during either task therefore used to leave the
 * record claiming "in progress" with nothing running — the table showed `…` forever, and both the toolbar's
 * 「正在建立索引…」 button and the panel's 「正在读取首页信息…」 button stayed disabled with no way back.
 *
 * So: a durable "running" flag with no live task behind it is a lie, and this is where it gets corrected. Anything that
 * really is running in this page is left alone (the sets are the source of truth for "live").
 */

/** How long a "running" flag may be trusted when we have no in-memory task to compare against. */
const STALE_AFTER_MS = 2 * 60_000;

function isStale(updatedAt: string | undefined, now: number): boolean {
  if (!updatedAt) return true;
  const at = Date.parse(updatedAt);
  return Number.isNaN(at) || now - at > STALE_AFTER_MS;
}

/**
 * Repairs stale flags and returns the documents as they now stand.
 *
 * Called once per library render because that is the only place that reads the corpus anyway: no timer, no background
 * poller, and a page that is never opened never pays for it.
 */
export function reconcileInterruptedDocumentWork(
  documents: readonly KnowledgeLibraryDocument[],
  options: {
    isIndexing: (documentId: string) => boolean;
    now?: number;
  },
): KnowledgeLibraryDocument[] {
  const now = options.now ?? Date.now();
  let changed = false;
  const repaired = documents.map((document) => {
    const patch: Partial<KnowledgeLibraryDocument> = {};
    if (document.indexStatus === 'indexing' && !options.isIndexing(document.documentId)
      && isStale(document.updatedAt, now)) {
      // Back to `error` rather than `pending`: `error` is what re-enables the toolbar's 「↻ 重试知识库索引」, and the
      // interruption is a fact worth stating — pretending it never started would hide why no index exists.
      patch.indexStatus = 'error';
      patch.indexError = '索引任务被中断（页面或浏览器在此过程中被关闭），可以点击重新建立索引。';
    }
    if (document.metadataStatus === 'extracting'
      && !isMetadataExtractionRunning(document.documentId)
      && isStale(document.updatedAt, now)) {
      patch.metadataStatus = 'error';
      patch.metadataError = '元数据提取被中断（页面或浏览器在此过程中被关闭），可以重新提取。';
    }
    if (!Object.keys(patch).length) return document;
    changed = true;
    return { ...document, ...patch };
  });
  if (changed) {
    for (const document of repaired) {
      const before = documents.find((item) => item.documentId === document.documentId);
      if (before && (before.indexStatus !== document.indexStatus
        || before.metadataStatus !== document.metadataStatus)) {
        updateKnowledgeDocument(document.documentId, {
          indexStatus: document.indexStatus,
          indexError: document.indexError,
          metadataStatus: document.metadataStatus,
          metadataError: document.metadataError,
        });
      }
    }
  }
  return repaired;
}

/** The library's own entry point: reconciles, then returns the corpus the page should render. */
export function listKnowledgeDocumentsForDisplay(
  isIndexing: (documentId: string) => boolean,
): KnowledgeLibraryDocument[] {
  return reconcileInterruptedDocumentWork(listKnowledgeDocuments(), { isIndexing });
}
