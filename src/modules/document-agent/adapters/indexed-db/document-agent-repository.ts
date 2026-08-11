import type { DocumentAgentRecord, DocumentAgentSession, DocumentChunk } from '../../contracts';
import { CHUNKS_STORE, DOCUMENTS_STORE, DOCUMENT_ID_INDEX, SESSIONS_STORE, VISION_CACHE_STORE, openDocumentAgentDatabase, requestToPromise, transactionDone } from '../../../../platform/database/workspace-database';

export function isDocumentAgentStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function getDocumentAgentRecord(id: string): Promise<DocumentAgentRecord | null> {
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
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
  const database = await openDocumentAgentDatabase();
  try {
    const transaction = database.transaction(VISION_CACHE_STORE, 'readwrite');
    transaction.objectStore(VISION_CACHE_STORE).put(entry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
