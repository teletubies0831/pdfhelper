import type { SavedPaperOverview } from "../../core/pdf-reader/public";
import { SAVED_PAPER_OVERVIEWS_STORAGE_KEY } from "../../core/pdf-reader/public";
import { readJsonValue, writeJsonValue } from "../../../infrastructure/storage/browser-json-repository";

export function readSavedPaperOverviews(): SavedPaperOverview[] {
  const value = readJsonValue<unknown>(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
}

export function writeSavedPaperOverviews(cards: SavedPaperOverview[]): void {
  writeJsonValue(SAVED_PAPER_OVERVIEWS_STORAGE_KEY, cards.slice(0, 100));
}
