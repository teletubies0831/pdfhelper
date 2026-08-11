import { RECENT_FILES_DB_NAME, RECENT_FILES_DB_VERSION, RECENT_FILES_LIMIT, RECENT_FILES_STORE_NAME, type RecentPdfEntry } from "./contracts";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function isRecentFileStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openRecentFilesDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECENT_FILES_DB_NAME, RECENT_FILES_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECENT_FILES_STORE_NAME)) {
        database.createObjectStore(RECENT_FILES_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开最近文件数据库。"));
  });
}

export async function readRecentFiles(): Promise<RecentPdfEntry[]> {
  if (!isRecentFileStorageAvailable()) return [];
  const database = await openRecentFilesDatabase();
  try {
    const transaction = database.transaction(RECENT_FILES_STORE_NAME, "readonly");
    const entries = await requestToPromise<RecentPdfEntry[]>(
      transaction.objectStore(RECENT_FILES_STORE_NAME).getAll(),
    );
    return entries
      .filter((entry) => entry && entry.name && entry.id)
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  } finally {
    database.close();
  }
}

export async function writeRecentFiles(entries: RecentPdfEntry[]): Promise<void> {
  if (!isRecentFileStorageAvailable()) return;
  const database = await openRecentFilesDatabase();
  try {
    const transaction = database.transaction(RECENT_FILES_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_FILES_STORE_NAME);
    store.clear();
    for (const entry of entries.slice(0, RECENT_FILES_LIMIT)) store.put(entry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
