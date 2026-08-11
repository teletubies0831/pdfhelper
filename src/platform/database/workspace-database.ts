export const DOCUMENT_AGENT_DB_NAME = 'pdf-helper-document-agent';
export const DOCUMENT_AGENT_DB_VERSION = 4;

export const DOCUMENTS_STORE = 'documents';
export const CHUNKS_STORE = 'chunks';
export const SESSIONS_STORE = 'sessions';
export const VISION_CACHE_STORE = 'visionCache';
export const LONG_TERM_MEMORIES_STORE = 'longTermMemories';
export const PAPER_LIBRARY_STORE = 'paperLibrary';

export const DOCUMENT_ID_INDEX = 'documentId';
export const CATEGORY_INDEX = 'category';
export const SOURCE_PDF_ID_INDEX = 'sourcePdfId';
export const UPDATED_AT_INDEX = 'updatedAt';
export const FINGERPRINT_INDEX = 'fingerprint';
export const LAST_OPENED_AT_INDEX = 'lastOpenedAt';
export const MEMORY_KEY_INDEX = 'key';
export const MEMORY_SCOPE_INDEX = 'scope';
export const MEMORY_STATUS_INDEX = 'status';

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  options: IDBIndexParameters = {},
): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

export function openDocumentAgentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOCUMENT_AGENT_DB_NAME, DOCUMENT_AGENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;

      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }

      const chunks = database.objectStoreNames.contains(CHUNKS_STORE)
        ? transaction?.objectStore(CHUNKS_STORE)
        : database.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
      if (chunks) ensureIndex(chunks, DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX);

      const sessions = database.objectStoreNames.contains(SESSIONS_STORE)
        ? transaction?.objectStore(SESSIONS_STORE)
        : database.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      if (sessions) ensureIndex(sessions, DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX);

      const visionCache = database.objectStoreNames.contains(VISION_CACHE_STORE)
        ? transaction?.objectStore(VISION_CACHE_STORE)
        : database.createObjectStore(VISION_CACHE_STORE, { keyPath: 'id' });
      if (visionCache) ensureIndex(visionCache, DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX);

      const memories = database.objectStoreNames.contains(LONG_TERM_MEMORIES_STORE)
        ? transaction?.objectStore(LONG_TERM_MEMORIES_STORE)
        : database.createObjectStore(LONG_TERM_MEMORIES_STORE, { keyPath: 'id' });
      if (memories) {
        ensureIndex(memories, CATEGORY_INDEX, CATEGORY_INDEX);
        ensureIndex(memories, SOURCE_PDF_ID_INDEX, SOURCE_PDF_ID_INDEX);
        ensureIndex(memories, UPDATED_AT_INDEX, UPDATED_AT_INDEX);
        ensureIndex(memories, MEMORY_KEY_INDEX, MEMORY_KEY_INDEX);
        ensureIndex(memories, MEMORY_SCOPE_INDEX, MEMORY_SCOPE_INDEX);
        ensureIndex(memories, MEMORY_STATUS_INDEX, MEMORY_STATUS_INDEX);
      }

      const paperLibrary = database.objectStoreNames.contains(PAPER_LIBRARY_STORE)
        ? transaction?.objectStore(PAPER_LIBRARY_STORE)
        : database.createObjectStore(PAPER_LIBRARY_STORE, { keyPath: 'id' });
      if (paperLibrary) {
        ensureIndex(paperLibrary, FINGERPRINT_INDEX, FINGERPRINT_INDEX, { unique: false });
        ensureIndex(paperLibrary, LAST_OPENED_AT_INDEX, LAST_OPENED_AT_INDEX);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open document agent database.'));
    request.onblocked = () => reject(new Error('数据库升级被其他已打开的 PDF Helper 页面阻塞，请关闭旧页面后重试。'));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}
