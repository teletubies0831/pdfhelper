import { READING_JOURNAL_STORAGE_KEY } from "../../core/pdf-reader/public";
import type { SavedReadingJournalEntry } from "../../app/public";

/**
 * Reading journal persistence. Owned by the paper-card feature (the journal is
 * written from the card workflow); the knowledge-base feature reads it through
 * paper-card's public API instead of owning the storage.
 */
export function readReadingJournalEntries(): SavedReadingJournalEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(READING_JOURNAL_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeReadingJournalEntries(entries: SavedReadingJournalEntry[]): void {
  localStorage.setItem(READING_JOURNAL_STORAGE_KEY, JSON.stringify(entries));
}
