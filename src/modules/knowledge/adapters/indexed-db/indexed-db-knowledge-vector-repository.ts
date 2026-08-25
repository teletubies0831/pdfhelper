import type {
  KnowledgeVectorRepository,
  StoredKnowledgeVector,
} from '../../ports/knowledge-vector-repository';

const DATABASE_NAME = 'pdfpal-knowledge-vectors';
const DATABASE_VERSION = 2;
const VECTOR_STORE = 'vectors';
const RECORD_KEY_INDEX = 'recordKey';
const MODEL_ID_INDEX = 'modelId';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('向量索引读写失败。'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('向量索引写入失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('向量索引写入已中止。'));
  });
}

export class IndexedDbKnowledgeVectorRepository
implements KnowledgeVectorRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async findByRecordKeys(
    recordKeys: string[],
    modelId: string,
  ): Promise<StoredKnowledgeVector[]> {
    if (!recordKeys.length) return [];
    const database = await this.open();
    const transaction = database.transaction(VECTOR_STORE, 'readonly');
    const index = transaction.objectStore(VECTOR_STORE).index(RECORD_KEY_INDEX);
    const rows = await Promise.all(
      recordKeys.map((recordKey) => requestToPromise(index.getAll(recordKey))),
    );
    return rows.flat().filter(
      (row): row is StoredKnowledgeVector =>
        typeof row === 'object' && row !== null && row.modelId === modelId,
    );
  }

  async replaceRecord(
    recordKey: string,
    modelId: string,
    vectors: StoredKnowledgeVector[],
  ): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(VECTOR_STORE, 'readwrite');
    const store = transaction.objectStore(VECTOR_STORE);
    const existing = await requestToPromise(
      store.index(RECORD_KEY_INDEX).getAll(recordKey),
    );
    for (const row of existing) {
      if (row.modelId === modelId) store.delete(row.id);
    }
    for (const vector of vectors) store.put(vector);
    await transactionDone(transaction);
  }

  async deleteByModelId(modelId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(VECTOR_STORE, 'readwrite');
    const store = transaction.objectStore(VECTOR_STORE);
    const keys = await requestToPromise(
      store.index(MODEL_ID_INDEX).getAllKeys(modelId),
    );
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains(VECTOR_STORE)
            ? request.transaction?.objectStore(VECTOR_STORE)
            : database.createObjectStore(VECTOR_STORE, { keyPath: 'id' });
          if (store && !store.indexNames.contains(RECORD_KEY_INDEX)) {
            store.createIndex(RECORD_KEY_INDEX, RECORD_KEY_INDEX);
          }
          if (store && !store.indexNames.contains(MODEL_ID_INDEX)) {
            store.createIndex(MODEL_ID_INDEX, MODEL_ID_INDEX);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('无法打开本地向量索引。'));
        request.onblocked = () => reject(new Error('本地知识索引正在被其他页面使用，请关闭旧页面后重试。'));
      });
    }
    return this.databasePromise;
  }
}
