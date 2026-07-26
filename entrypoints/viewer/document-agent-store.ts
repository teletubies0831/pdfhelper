import type {
  DocumentAgentRecord,
  DocumentAgentSession,
  DocumentChunk,
} from '../../shared/document-agent';

const DB_NAME = 'pdf-helper-document-agent';
const DB_VERSION = 2;
const DOCUMENTS_STORE = 'documents';
const CHUNKS_STORE = 'chunks';
const SESSIONS_STORE = 'sessions';
const VISION_CACHE_STORE = 'visionCache';
const DOCUMENT_ID_INDEX = 'documentId';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = database.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
        store.createIndex(DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX, { unique: false });
      }
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = database.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        store.createIndex(DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX, { unique: false });
      }
      if (!database.objectStoreNames.contains(VISION_CACHE_STORE)) {
        const store = database.createObjectStore(VISION_CACHE_STORE, { keyPath: 'id' });
        store.createIndex(DOCUMENT_ID_INDEX, DOCUMENT_ID_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open document agent database.'));
  });
}

export async function getDocumentAgentRecord(id: string): Promise<DocumentAgentRecord | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const value = await requestToPromise<DocumentAgentRecord | undefined>(
      transaction.objectStore(DOCUMENTS_STORE).get(id),
    );
    return value ?? null;
  } finally {
    database.close();
  }
}

export async function putDocumentAgentRecord(record: DocumentAgentRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHUNKS_STORE, 'readonly');
    const chunks = await requestToPromise<DocumentChunk[]>(
      transaction.objectStore(CHUNKS_STORE).index(DOCUMENT_ID_INDEX).getAll(documentId),
    );
    return chunks.sort((left, right) => left.order - right.order);
  } finally {
    database.close();
  }
}

export async function replaceDocumentChunks(documentId: string, chunks: DocumentChunk[]): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHUNKS_STORE, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE);
    const keys = await requestToPromise<IDBValidKey[]>(store.index(DOCUMENT_ID_INDEX).getAllKeys(documentId));
    for (const key of keys) store.delete(key);
    for (const chunk of chunks) store.put(chunk);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getLatestDocumentSession(documentId: string): Promise<DocumentAgentSession | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSIONS_STORE, 'readonly');
    const sessions = await requestToPromise<DocumentAgentSession[]>(
      transaction.objectStore(SESSIONS_STORE).index(DOCUMENT_ID_INDEX).getAll(documentId),
    );
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  } finally {
    database.close();
  }
}

export async function putDocumentSession(session: DocumentAgentSession): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSIONS_STORE, 'readwrite');
    transaction.objectStore(SESSIONS_STORE).put(session);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export interface DocumentVisionCacheEntry {
  id: string;
  documentId: string;
  pageNumber: number;
  questionKey: string;
  content: string;
  model: string;
  updatedAt: number;
}

export async function getDocumentVisionCacheEntry(id: string): Promise<DocumentVisionCacheEntry | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISION_CACHE_STORE, 'readonly');
    const value = await requestToPromise<DocumentVisionCacheEntry | undefined>(
      transaction.objectStore(VISION_CACHE_STORE).get(id),
    );
    return value ?? null;
  } finally {
    database.close();
  }
}

export async function putDocumentVisionCacheEntry(entry: DocumentVisionCacheEntry): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISION_CACHE_STORE, 'readwrite');
    transaction.objectStore(VISION_CACHE_STORE).put(entry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
