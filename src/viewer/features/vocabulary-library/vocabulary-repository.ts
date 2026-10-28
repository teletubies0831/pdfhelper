import { browser } from "wxt/browser";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";

/**
 * 单词卡片存储：一张卡一个键.
 *
 * The store used to be one array under one key, updated by "read the whole array → change it in memory → write the whole array
 * back". Two Viewer pages doing that at the same time (「新标签页打开原文」 makes that normal) both read the same snapshot and the
 * later `set` silently threw away the other page's new card, edit or delete — `browser.storage.local` has no transaction and no
 * version check, so nothing could detect it.
 *
 * One key per card removes the sharing entirely: creating, editing or deleting a card only ever touches that card's key, so
 * concurrent pages cannot collide. Listing costs one `get(null)` scan filtered by the prefix, which is cheap at the size of a
 * personal vocabulary.
 */

/** 旧格式：整份数组存在一个键下（只用于迁移与 localStorage 兜底）. */
export const VOCABULARY_LIBRARY_STORAGE_KEY =
  "pdf-helper-vocabulary-library-v1";

/** 新格式：`pdf-helper-vocabulary-card-v1::<id>` 一张卡一个键. */
export const VOCABULARY_CARD_KEY_PREFIX = "pdf-helper-vocabulary-card-v1::";

/**
 * 迁移专用键：旧数组里的卡片只写到这里，**永远不碰用户正在使用的键**.
 *
 * `storage.local` has no compare-and-set, so a migration that wrote the live card keys could overwrite an edit another page made
 * between its existence check and its `set` — and because the legacy array was then deleted, the edit was gone for good. Two writers,
 * two keys: saves own `card::<id>`, the migration owns `card-legacy::<id>`, and reads prefer the live key. No ordering can lose data.
 */
export const VOCABULARY_CARD_IMPORT_KEY_PREFIX = "pdf-helper-vocabulary-card-legacy-v1::";

/** A deletion marker prevents an already-running migration from resurrecting this card. */
export const VOCABULARY_CARD_TOMBSTONE_KEY_PREFIX = "pdf-helper-vocabulary-card-deleted-v1::";

export interface VocabularyCard {
  id: string;
  term: string;
  pronunciation: string;
  partOfSpeech: string;
  markdown: string;
  tags: string[];
  sourceText: string;
  documentName: string;
  pageNumber?: number;
  createdAt: string;
  updatedAt: string;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cardStorageKey(id: string): string {
  return `${VOCABULARY_CARD_KEY_PREFIX}${id}`;
}

function cardImportKey(id: string): string {
  return `${VOCABULARY_CARD_IMPORT_KEY_PREFIX}${id}`;
}

function cardTombstoneKey(id: string): string {
  return `${VOCABULARY_CARD_TOMBSTONE_KEY_PREFIX}${id}`;
}

function normalizeCard(value: unknown): VocabularyCard | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const term = readString(record.term);
  const markdown = readString(record.markdown);
  const createdAt = readString(record.createdAt);
  const updatedAt = readString(record.updatedAt) || createdAt;
  if (!id || !term || !markdown || !createdAt) return null;
  const pageNumber = Number(record.pageNumber);
  return {
    id,
    term,
    pronunciation: readString(record.pronunciation),
    partOfSpeech: readString(record.partOfSpeech),
    markdown,
    tags: Array.isArray(record.tags)
      ? record.tags.map(readString).filter(Boolean).slice(0, 20)
      : [],
    sourceText: readString(record.sourceText),
    documentName: readString(record.documentName),
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0
      ? pageNumber
      : undefined,
    createdAt,
    updatedAt,
  };
}

/** 稳定顺序：先按创建时间新→旧，同一时间按 id，保证列表不会因读取顺序抖动. */
function sortCards(cards: VocabularyCard[]): VocabularyCard[] {
  return [...cards].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
  ));
}

/**
 * 把旧格式的整份数组迁移成一张卡一个键.
 *
 * Writes only the **import** keys (`card-legacy::<id>`), never the live ones: the legacy array is the only copy of the user's
 * vocabulary, but another page may be editing a card right now, and a migration that wrote the live key could overwrite that edit
 * between its existence check and its `set` — unrecoverably, since the legacy key is removed afterwards. Two writers, two keys.
 *
 * The legacy key is removed only after a read-back confirms every card has an import key (or a newer live one); a failure leaves it in
 * place and the next read retries.
 */
async function migrateLegacyCards(): Promise<VocabularyCard[]> {
  const stored = await browser.storage.local.get(VOCABULARY_LIBRARY_STORAGE_KEY);
  const legacy = stored[VOCABULARY_LIBRARY_STORAGE_KEY];
  if (!Array.isArray(legacy)) return [];
  const cards = legacy
    .map(normalizeCard)
    .filter((card): card is VocabularyCard => Boolean(card));
  if (!cards.length) return [];
  try {
    // Skip cards the user already has a live key for — that copy is newer by definition, and readers prefer it.
    const liveKeys = cards.map((card) => cardStorageKey(card.id));
    const importKeys = cards.map((card) => cardImportKey(card.id));
    const tombstoneKeys = cards.map((card) => cardTombstoneKey(card.id));
    const existing = await browser.storage.local.get([...liveKeys, ...importKeys, ...tombstoneKeys]);
    const patch: Record<string, unknown> = {};
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index]!;
      if (liveKeys[index]! in existing) continue;
      if (tombstoneKeys[index]! in existing) continue;
      if (importKeys[index]! in existing) continue;
      patch[importKeys[index]!] = card;
    }
    if (Object.keys(patch).length) await browser.storage.local.set(patch);
    const after = await browser.storage.local.get([...liveKeys, ...importKeys, ...tombstoneKeys]);
    const missing = importKeys.filter((key, index) => (
      !(key in after) && !(liveKeys[index]! in after) && !(tombstoneKeys[index]! in after)
    ));
    if (missing.length) {
      console.warn("PDFPal 单词卡片迁移未完成，保留旧数据下次重试。", { missing });
      return sortCards(cards);
    }
    await browser.storage.local.remove(VOCABULARY_LIBRARY_STORAGE_KEY);
  } catch (error) {
    // 迁移失败不是致命错误：读到的卡片照样返回，旧键留到下次再迁。
    console.warn("PDFPal 单词卡片迁移失败，下次读取会重试。", error);
  }
  return sortCards(cards);
}

function cardsFromStorage(stored: Record<string, unknown>): VocabularyCard[] {
  const live = new Map<string, VocabularyCard>();
  const imported = new Map<string, VocabularyCard>();
  const deleted = new Set<string>();
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (key.startsWith(VOCABULARY_CARD_TOMBSTONE_KEY_PREFIX)) {
      deleted.add(key.slice(VOCABULARY_CARD_TOMBSTONE_KEY_PREFIX.length));
      continue;
    }
    const isImport = key.startsWith(VOCABULARY_CARD_IMPORT_KEY_PREFIX);
    if (!isImport && !key.startsWith(VOCABULARY_CARD_KEY_PREFIX)) continue;
    const card = normalizeCard(value);
    if (!card) continue;
    // 同一张卡两个键都存在时，用户自己那份（live）优先，迁移快照只是升级后还没改过的兜底。
    if (isImport) imported.set(card.id, card);
    else live.set(card.id, card);
  }
  const cards = [...imported.values()]
    .filter((card) => !live.has(card.id) && !deleted.has(card.id))
    .concat([...live.values()].filter((card) => !deleted.has(card.id)));
  return sortCards(cards);
}

export async function readVocabularyCards(): Promise<VocabularyCard[]> {
  try {
    const stored = await browser.storage.local.get(null);
    const cards = cardsFromStorage(stored ?? {});
    // A previous migration can write every import key but be interrupted before deleting the old array (or write only some
    // keys before a storage failure). Keep retrying while that legacy key exists; "some cards are visible" is not completion.
    if (!(VOCABULARY_LIBRARY_STORAGE_KEY in (stored ?? {}))) return cards;
    await migrateLegacyCards();
    // Migration may have raced a delete from a different Viewer. Re-read so that a tombstone written in that
    // window is honoured before this page renders the list, rather than briefly showing the removed card.
    const migrated = await browser.storage.local.get(null);
    return cardsFromStorage(migrated ?? {});
  } catch (error) {
    console.warn("PDFPal 无法读取单词卡片，改用本地兜底副本。", error);
    const fallback = readJsonValue<unknown[]>(
      VOCABULARY_LIBRARY_STORAGE_KEY,
      [],
    );
    return Array.isArray(fallback)
      ? sortCards(fallback
        .map(normalizeCard)
        .filter((card): card is VocabularyCard => Boolean(card)))
      : [];
  }
}

/**
 * 整表写入：用于导入/恢复.
 *
 * Still offered because "replace the whole library" is a legitimate operation, but it is now expressed as per-card writes plus a
 * removal of the cards that are gone — the same shape, without ever rewriting a key that holds someone else's card.
 */
export async function writeVocabularyCards(
  cards: VocabularyCard[],
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const keptIds = new Set<string>();
  for (const card of cards) {
    patch[cardStorageKey(card.id)] = card;
    keptIds.add(card.id);
  }
  try {
    const stored = await browser.storage.local.get(null);
    // 两个数据命名空间都要清理；删除墓碑则保留，直到这次整表写明确重新纳入该 id。
    const stale = Object.keys(stored ?? {}).filter((key) => {
      if (!key.startsWith(VOCABULARY_CARD_KEY_PREFIX)
        && !key.startsWith(VOCABULARY_CARD_IMPORT_KEY_PREFIX)) return false;
      const id = key.replace(VOCABULARY_CARD_KEY_PREFIX, "")
        .replace(VOCABULARY_CARD_IMPORT_KEY_PREFIX, "");
      return !keptIds.has(id);
    });
    if (Object.keys(patch).length) await browser.storage.local.set(patch);
    const restoredTombstones = cards.map((card) => cardTombstoneKey(card.id));
    if (restoredTombstones.length) await browser.storage.local.remove(restoredTombstones);
    if (stale.length) await browser.storage.local.remove(stale);
  } catch (error) {
    console.warn("PDFPal 无法写入单词卡片，改存本地兜底副本。", error);
    writeJsonValue(VOCABULARY_LIBRARY_STORAGE_KEY, cards);
  }
}

export async function createVocabularyCard(
  card: Omit<VocabularyCard, "id" | "createdAt" | "updatedAt">,
): Promise<VocabularyCard> {
  const now = new Date().toISOString();
  const saved: VocabularyCard = {
    ...card,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  // 只写这一张卡：另一个页面同时在新增别的卡时，两边都留得住。
  await browser.storage.local.set({ [cardStorageKey(saved.id)]: saved });
  return saved;
}

export async function updateVocabularyCard(
  id: string,
  changes: Pick<
    VocabularyCard,
    "term" | "pronunciation" | "partOfSpeech" | "markdown" | "tags"
  >,
): Promise<VocabularyCard | null> {
  const key = cardStorageKey(id);
  const importKey = cardImportKey(id);
  const tombstoneKey = cardTombstoneKey(id);
  const stored = await browser.storage.local.get([key, importKey, tombstoneKey]);
  if (tombstoneKey in stored) return null;
  // 还没有 live 键时以迁移快照为底（升级后第一次编辑），写入后 live 键即成为权威，快照被遮蔽。
  const current = normalizeCard(stored[key] ?? stored[importKey]);
  if (!current) return null;
  // 同一张卡并发编辑仍是「后写覆盖」，这与用户在同一表单上连续保存的语义一致；不同卡之间不再互相覆盖。
  const saved: VocabularyCard = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  await browser.storage.local.set({ [key]: saved });
  return saved;
}

export async function deleteVocabularyCard(id: string): Promise<boolean> {
  const key = cardStorageKey(id);
  const importKey = cardImportKey(id);
  const tombstoneKey = cardTombstoneKey(id);
  const stored = await browser.storage.local.get([key, importKey, tombstoneKey]);
  if (!stored[key] && !stored[importKey]) return false;
  // Write intent first: a different Viewer may have already read the old array and write its import key later.
  await browser.storage.local.set({ [tombstoneKey]: true });
  await browser.storage.local.remove([key, importKey]);
  return true;
}
