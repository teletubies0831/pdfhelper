/**
 * Remembers *which file on disk* a knowledge-library record came from.
 *
 * The library record itself lives in `localStorage`, which cannot hold a file handle — and it should not, because a
 * handle is a structured-clone object that only IndexedDB can store. The knowledge record's only link used to be
 * `recentEntryId`, a pointer into the 「最近打开」 list, which keeps **12 entries**; once a document rotated out of that
 * list, 「打开原文」 reported 「可能是文件被移动或删除了」 even though the file had never moved. The user was right to
 * call that out, so the link is now kept here, next to the rest of the durable data, and the recent list is only a
 * convenience layer on top.
 *
 * Deliberately not stored: the file's bytes. A handle is a few hundred bytes; a copy of every PDF would be gigabytes.
 */

const DATABASE_NAME = "pdfpal-knowledge-file-handles";
const DATABASE_VERSION = 1;
const STORE_NAME = "handles";

/** The subset of `FileSystemFileHandle` this module uses, declared structurally to keep it layer-free. */
export interface StoredFileHandle {
  name: string;
  getFile(): Promise<File>;
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface StoredHandleRecord {
  documentId: string;
  handle: StoredFileHandle;
  /** When the link was recorded; only ever used for diagnostics. */
  linkedAt: number;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败。"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开文献文件记录数据库。"));
  });
}

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function putDocumentFileHandle(
  documentId: string,
  handle: StoredFileHandle | null | undefined,
): Promise<void> {
  // A remote document has no handle; storing `null` would only make readers branch twice.
  if (!documentId || !handle || !isAvailable()) return;
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        documentId,
        handle,
        linkedAt: Date.now(),
      } satisfies StoredHandleRecord);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("写入失败。"));
        transaction.onabort = () => reject(transaction.error ?? new Error("写入已中止。"));
      });
    } finally {
      database.close();
    }
  } catch (error) {
    // The link is an optimisation, not a requirement: without it the recent list still works.
    console.warn("PDFPal 未能保存文献的文件关联。", error);
  }
}

export async function getDocumentFileHandle(documentId: string): Promise<StoredFileHandle | null> {
  if (!documentId || !isAvailable()) return null;
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const record = await requestToPromise<StoredHandleRecord | undefined>(
        transaction.objectStore(STORE_NAME).get(documentId),
      );
      return record?.handle ?? null;
    } finally {
      database.close();
    }
  } catch (error) {
    console.warn("PDFPal 未能读取文献的文件关联。", error);
    return null;
  }
}

export async function deleteDocumentFileHandle(documentId: string): Promise<void> {
  if (!documentId || !isAvailable()) return;
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(documentId);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("删除失败。"));
        transaction.onabort = () => reject(transaction.error ?? new Error("删除已中止。"));
      });
    } finally {
      database.close();
    }
  } catch (error) {
    console.warn("PDFPal 未能删除文献的文件关联。", error);
  }
}
