import { browser } from "wxt/browser";
import {
  TRANSLATION_HISTORY_KEY_PREFIX,
  TRANSLATION_HISTORY_STORAGE_KEY,
  type TranslationHistoryEntry,
  type TranslationHistoryStore,
} from "../../app/public";

/**
 * 英语学习历史的存储层：一篇文献一个键.
 *
 * The old layout kept every document's list in one object under a single key and rewrote that whole object on every save. Two
 * Viewer pages writing different documents therefore still wrote the same value, and the later write threw away the other
 * document's list — plus, if the two pages were on the same document, the other page's new entries. `browser.storage.local` has no
 * transaction or version check, so nothing could notice.
 *
 * One key per document makes the two pages independent. Extracted from `translation-history.ts` because that module is UI glue
 * (dialogs, DOM, signals); the storage rules are testable on their own against a fake port, which is the only way to prove the
 * concurrency fix.
 */

export const HISTORY_KEY_PREFIX = TRANSLATION_HISTORY_KEY_PREFIX;

/** 只依赖 storage 接口，测试可以传入假实现. */
export interface TranslationHistoryStorage {
  /** 取一个键或一批键；`keys` 为列表时按列表取。 */
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const browserTranslationHistoryStorage: TranslationHistoryStorage = {
  get: (keys) => browser.storage.local.get(keys),
  set: (items) => browser.storage.local.set(items),
  remove: (keys) => browser.storage.local.remove(keys),
};

export function historyStorageKeyFor(documentKey: string): string {
  return `${HISTORY_KEY_PREFIX}${documentKey}`;
}

/**
 * 迁移专用键：旧整包里的内容只写到这里，**永远不碰用户正在使用的键**.
 *
 * This is what closes the migration race rather than narrowing it. `storage.local` has no compare-and-set, so any
 * "read the target → write it if missing" sequence has a window between the check and the write, and a page saving a new entry inside
 * that window lost its data when the migration's snapshot landed on top (the legacy key was then removed, making it permanent).
 *
 * Giving each writer its own key removes the shared cell entirely: saves write `…::<doc>`, the migration writes
 * `…::legacy::<doc>`. No interleaving of the two can lose either value, and reads prefer the live key — the user's own writes always
 * win over an imported snapshot for the same document.
 */
export function historyImportKeyFor(documentKey: string): string {
  return `${HISTORY_KEY_PREFIX}legacy::${documentKey}`;
}

/** A deletion wins over an in-flight import that already captured the old bundle. */
export function historyTombstoneKeyFor(documentKey: string): string {
  return `${HISTORY_KEY_PREFIX}deleted::${documentKey}`;
}

/** Timestamp of the writer that last deliberately recreated this document after a clear. */
export function historyWriteMarkerKeyFor(documentKey: string): string {
  return `pdf-helper-translation-history-write-v1::${documentKey}`;
}

function readTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 读取一篇文献的历史原始值.
 *
 * The live key first, the migration snapshot only as a fallback for documents that have not been touched since the upgrade. Both
 * hold the same shape, so the caller parses them identically.
 */
export async function readDocumentHistory(
  documentKey: string,
  storage: TranslationHistoryStorage = browserTranslationHistoryStorage,
): Promise<unknown> {
  const liveKey = historyStorageKeyFor(documentKey);
  const importKey = historyImportKeyFor(documentKey);
  const tombstoneKey = historyTombstoneKeyFor(documentKey);
  const writeMarkerKey = historyWriteMarkerKeyFor(documentKey);
  const stored = await storage.get([liveKey, importKey, tombstoneKey, writeMarkerKey]);
  // A clear wins over a save that started before it but reached storage later. A save started after the clear has a newer
  // marker and intentionally recreates the document. Keeping the tombstone instead of removing it makes this comparison
  // safe without `storage.local` compare-and-set.
  if (tombstoneKey in stored && (
    !(liveKey in stored)
    || readTimestamp(stored[writeMarkerKey]) <= readTimestamp(stored[tombstoneKey])
  )) return undefined;
  if (liveKey in stored) return stored[liveKey];
  return stored[importKey];
}

/**
 * 写入一篇文献的历史；空列表等于清空.
 *
 * Clearing removes **both** keys: dropping only the live one would let the migration snapshot bring the deleted history back on the
 * next read.
 */
export async function writeDocumentHistory(
  documentKey: string,
  entries: readonly TranslationHistoryEntry[],
  storage: TranslationHistoryStorage = browserTranslationHistoryStorage,
  operationStartedAt = Date.now(),
): Promise<void> {
  if (entries.length) {
    // Keep a write generation alongside the live value. We deliberately do not remove a tombstone: readers compare the two
    // timestamps, so an old in-flight page cannot erase a newer clear by merely reaching this line late.
    await storage.set({
      [historyStorageKeyFor(documentKey)]: entries,
      [historyWriteMarkerKeyFor(documentKey)]: operationStartedAt,
    });
    return;
  }
  // The marker has to be durable: another Viewer may have read the legacy bundle already and can still write its import
  // key after this clear. The reader and importer both honour this marker, so that stale write stays invisible.
  await storage.set({ [historyTombstoneKeyFor(documentKey)]: operationStartedAt });
  await storage.remove([
    historyStorageKeyFor(documentKey),
    historyImportKeyFor(documentKey),
    historyWriteMarkerKeyFor(documentKey),
  ]);
}

let legacyHistoryKnownAbsent = false;

/**
 * 旧格式迁移：把整包对象拆成一篇文献一个键.
 *
 * **Writes only the migration keys, never the live ones.** That is the fix for the check-then-write race: `storage.local` cannot do
 * compare-and-set, so "read the target, write it if missing" always leaves a window in which another page saves something newer, and
 * the migration's older snapshot then lands on top of it. Writing to a key nobody else writes makes the two operations disjoint, so no
 * ordering can lose data:
 *
 * - live keys belong to the reader's own saves;
 * - `legacy::<doc>` belongs to this migration;
 * - reads prefer the live key, so a document the user has touched since the upgrade is never shadowed by an imported snapshot.
 *
 * Order is still "fill first, remove last": the legacy key is the only copy until every import key exists, and it is removed only
 * after a read-back confirms they all landed.
 *
 * Returns the legacy store for callers that want it, but readers must re-read afterwards (`readDocumentHistory` does).
 */
export async function migrateLegacyHistory(
  storage: TranslationHistoryStorage = browserTranslationHistoryStorage,
): Promise<TranslationHistoryStore | null> {
  if (legacyHistoryKnownAbsent) return null;
  let legacy: unknown;
  try {
    const stored = await storage.get(TRANSLATION_HISTORY_STORAGE_KEY);
    legacy = stored[TRANSLATION_HISTORY_STORAGE_KEY];
  } catch (error) {
    console.warn("PDFPal 无法读取旧的英语学习历史，跳过迁移。", error);
    return null;
  }
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
    legacyHistoryKnownAbsent = true;
    return null;
  }
  const store = legacy as TranslationHistoryStore;
  const candidates: Record<string, unknown> = {};
  const liveKeys: string[] = [];
  const tombstoneKeys: string[] = [];
  for (const [documentKey, entries] of Object.entries(store)) {
    if (!Array.isArray(entries) || !entries.length) continue;
    candidates[historyImportKeyFor(documentKey)] = entries;
    liveKeys.push(historyStorageKeyFor(documentKey));
    tombstoneKeys.push(historyTombstoneKeyFor(documentKey));
  }
  const importKeys = Object.keys(candidates);
  if (!importKeys.length) {
    // Empty/invalid legacy entries carry no readable history; remove this obsolete container so future document switches do not
    // keep probing it forever.
    try {
      await storage.remove(TRANSLATION_HISTORY_STORAGE_KEY);
      legacyHistoryKnownAbsent = true;
    } catch (error) {
      console.warn("PDFPal 无法清理空的旧英语学习历史，下次读取会重试。", error);
    }
    return store;
  }
  try {
    // Skip the documents the user already has a live key for: that key is newer by definition, and the reader prefers it anyway.
    const existing = await storage.get([...importKeys, ...liveKeys, ...tombstoneKeys]);
    const patch: Record<string, unknown> = {};
    for (let index = 0; index < importKeys.length; index += 1) {
      const importKey = importKeys[index]!;
      if (liveKeys[index]! in existing) continue;
      if (tombstoneKeys[index]! in existing) continue;
      if (importKey in existing) continue;
      patch[importKey] = candidates[importKey];
    }
    if (Object.keys(patch).length) await storage.set(patch);
    // Only drop the legacy key once every document has an import key (or a newer live one).
    const after = await storage.get([...importKeys, ...liveKeys, ...tombstoneKeys]);
    const missing = importKeys.filter((importKey, index) => (
      !(importKey in after) && !(liveKeys[index]! in after) && !(tombstoneKeys[index]! in after)
    ));
    if (missing.length) {
      console.warn("PDFPal 英语学习历史迁移未完成，保留旧数据下次重试。", { missing });
      return store;
    }
    await storage.remove(TRANSLATION_HISTORY_STORAGE_KEY);
    legacyHistoryKnownAbsent = true;
  } catch (error) {
    console.warn("PDFPal 英语学习历史迁移失败，下次读取会重试。", error);
  }
  return store;
}
