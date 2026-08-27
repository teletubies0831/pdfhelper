import { browser } from "wxt/browser";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";

export const VOCABULARY_LIBRARY_STORAGE_KEY =
  "pdf-helper-vocabulary-library-v1";

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

export async function readVocabularyCards(): Promise<VocabularyCard[]> {
  try {
    const stored = await browser.storage.local.get(
      VOCABULARY_LIBRARY_STORAGE_KEY,
    );
    const value = stored[VOCABULARY_LIBRARY_STORAGE_KEY];
    return Array.isArray(value)
      ? value.map(normalizeCard).filter((card): card is VocabularyCard => Boolean(card))
      : [];
  } catch {
    const fallback = readJsonValue<unknown[]>(
      VOCABULARY_LIBRARY_STORAGE_KEY,
      [],
    );
    return Array.isArray(fallback)
      ? fallback.map(normalizeCard).filter((card): card is VocabularyCard => Boolean(card))
      : [];
  }
}

export async function writeVocabularyCards(
  cards: VocabularyCard[],
): Promise<void> {
  try {
    await browser.storage.local.set({
      [VOCABULARY_LIBRARY_STORAGE_KEY]: cards,
    });
  } catch {
    writeJsonValue(VOCABULARY_LIBRARY_STORAGE_KEY, cards);
  }
}

export async function createVocabularyCard(
  card: Omit<VocabularyCard, "id" | "createdAt" | "updatedAt">,
): Promise<VocabularyCard> {
  const cards = await readVocabularyCards();
  const now = new Date().toISOString();
  const saved: VocabularyCard = {
    ...card,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await writeVocabularyCards([saved, ...cards]);
  return saved;
}

export async function updateVocabularyCard(
  id: string,
  changes: Pick<
    VocabularyCard,
    "term" | "pronunciation" | "partOfSpeech" | "markdown" | "tags"
  >,
): Promise<VocabularyCard | null> {
  const cards = await readVocabularyCards();
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return null;
  const current = cards[index];
  if (!current) return null;
  const saved: VocabularyCard = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  cards[index] = saved;
  await writeVocabularyCards(cards);
  return saved;
}

export async function deleteVocabularyCard(id: string): Promise<boolean> {
  const cards = await readVocabularyCards();
  const next = cards.filter((card) => card.id !== id);
  if (next.length === cards.length) return false;
  await writeVocabularyCards(next);
  return true;
}
