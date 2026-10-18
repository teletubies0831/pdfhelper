/**
 * Private IndexedDB database for the knowledge graph.
 *
 * A dedicated database (rather than new stores inside
 * `pdf-helper-document-agent`) keeps the graph's schema versions independent
 * from the document-agent and memory modules: bumping a version on a shared
 * database blocks every open PDFPal page during upgrade.
 *
 * The promise helpers are intentionally local copies of the infrastructure
 * ones so that this adapter depends on nothing but the IndexedDB API.
 */

export const KNOWLEDGE_GRAPH_DATABASE_NAME = 'pdfpal-knowledge-graph';
/**
 * v2 adds the job and user-side stores. They are created up front — before the
 * phases that write them — so shipping entity extraction and personal-graph
 * support later does not require a second upgrade on user machines.
 */
export const KNOWLEDGE_GRAPH_DATABASE_VERSION = 2;

export const GRAPH_PAPERS_STORE = 'papers';
export const GRAPH_ENTITIES_STORE = 'entities';
export const GRAPH_EDGES_STORE = 'edges';
export const GRAPH_SETTINGS_STORE = 'settings';
export const GRAPH_EXTRACTION_JOBS_STORE = 'extractionJobs';
export const GRAPH_NOTES_STORE = 'notes';
export const GRAPH_HIGHLIGHTS_STORE = 'highlights';
export const GRAPH_FOLDERS_STORE = 'folders';
export const GRAPH_TAGS_STORE = 'tags';

export const PAPER_ID_INDEX = 'paperId';
export const PAPER_FOLDER_INDEX = 'folderId';
export const PAPER_YEAR_INDEX = 'year';
export const PAPER_EXTRACTION_STATUS_INDEX = 'extractionStatus';

export const ENTITY_NAME_INDEX = 'name';
export const ENTITY_NORMALIZED_NAME_INDEX = 'normalizedName';
export const ENTITY_TYPE_INDEX = 'type';
export const ENTITY_STATUS_INDEX = 'status';
export const ENTITY_SOURCE_PAPER_INDEX = 'sourcePaperId';

export const EDGE_SOURCE_INDEX = 'source';
export const EDGE_TARGET_INDEX = 'target';
export const EDGE_TYPE_INDEX = 'type';
export const EDGE_SOURCE_PAPER_INDEX = 'sourcePaperId';
export const EDGE_ORIGIN_INDEX = 'origin';
export const EDGE_ORIGIN_KEY_INDEX = 'originKey';

export const JOB_PAPER_INDEX = 'paperId';
export const JOB_KIND_INDEX = 'kind';
export const JOB_STATUS_INDEX = 'status';

export const FOLDER_PARENT_INDEX = 'parentId';
export const TAG_NAME_INDEX = 'name';

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('知识图谱数据读取失败。'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('知识图谱数据写入失败。'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('知识图谱数据写入已中止。'));
  });
}

function createStore(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
  name: string,
  keyPath: string,
  indexes: Array<[string, string, IDBIndexParameters?]>,
): void {
  const store = database.objectStoreNames.contains(name)
    ? transaction?.objectStore(name)
    : database.createObjectStore(name, { keyPath });
  if (!store) return;
  for (const [indexName, keyPathName, options] of indexes) {
    if (!store.indexNames.contains(indexName)) {
      store.createIndex(indexName, keyPathName, options ?? {});
    }
  }
}

export function openKnowledgeGraphDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      KNOWLEDGE_GRAPH_DATABASE_NAME,
      KNOWLEDGE_GRAPH_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;

      createStore(database, transaction, GRAPH_PAPERS_STORE, 'paperId', [
        [PAPER_ID_INDEX, 'paperId'],
        [PAPER_FOLDER_INDEX, 'folderId'],
        [PAPER_YEAR_INDEX, 'year'],
        [PAPER_EXTRACTION_STATUS_INDEX, 'extractionStatus'],
      ]);

      createStore(database, transaction, GRAPH_ENTITIES_STORE, 'entityId', [
        [ENTITY_NAME_INDEX, 'name'],
        [ENTITY_NORMALIZED_NAME_INDEX, 'normalizedName'],
        [ENTITY_TYPE_INDEX, 'type'],
        [ENTITY_STATUS_INDEX, 'status'],
        [ENTITY_SOURCE_PAPER_INDEX, 'sourcePaperId'],
      ]);

      createStore(database, transaction, GRAPH_EDGES_STORE, 'edgeId', [
        [EDGE_SOURCE_INDEX, 'source'],
        [EDGE_TARGET_INDEX, 'target'],
        [EDGE_TYPE_INDEX, 'type'],
        [EDGE_SOURCE_PAPER_INDEX, 'sourcePaperId'],
        [EDGE_ORIGIN_INDEX, 'origin'],
        // Unique: a repeated AI relationship judgement for the same normalised
        // pair and type is rejected by IndexedDB itself, so no dedupe pass and
        // no second token spend is possible.
        [EDGE_ORIGIN_KEY_INDEX, 'originKey', { unique: true }],
      ]);

      createStore(database, transaction, GRAPH_SETTINGS_STORE, 'key', []);

      createStore(database, transaction, GRAPH_EXTRACTION_JOBS_STORE, 'jobId', [
        [JOB_PAPER_INDEX, 'paperId'],
        [JOB_KIND_INDEX, 'kind'],
        [JOB_STATUS_INDEX, 'status'],
      ]);

      createStore(database, transaction, GRAPH_NOTES_STORE, 'noteId', [
        [PAPER_ID_INDEX, 'paperId'],
      ]);

      createStore(database, transaction, GRAPH_HIGHLIGHTS_STORE, 'highlightId', [
        [PAPER_ID_INDEX, 'paperId'],
      ]);

      createStore(database, transaction, GRAPH_FOLDERS_STORE, 'folderId', [
        [FOLDER_PARENT_INDEX, 'parentId'],
      ]);

      createStore(database, transaction, GRAPH_TAGS_STORE, 'tagId', [
        [TAG_NAME_INDEX, 'name'],
      ]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('无法打开知识图谱数据库。'));
    request.onblocked = () =>
      reject(
        new Error(
          '知识图谱数据库升级被其他已打开的 PDFPal 页面阻塞，请关闭旧页面后重试。',
        ),
      );
  });
}

/**
 * Reads a store without holding the connection open: the repositories close the
 * database after each call, matching the document-agent adapter convention.
 */
export async function readAllFromGraphStore<T>(storeName: string): Promise<T[]> {
  const database = await openKnowledgeGraphDatabase();
  try {
    const transaction = database.transaction(storeName, 'readonly');
    return await requestToPromise<T[]>(
      transaction.objectStore(storeName).getAll(),
    );
  } finally {
    database.close();
  }
}

export async function writeGraphStore(
  storeName: string,
  mutate: (store: IDBObjectStore) => void,
): Promise<void> {
  const database = await openKnowledgeGraphDatabase();
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    mutate(transaction.objectStore(storeName));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
