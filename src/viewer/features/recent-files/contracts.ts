import type { FileHandleLike } from "../../app/viewer-types";

export const RECENT_FILES_DB_NAME = "pdf-helper-recent-files";
export const RECENT_FILES_DB_VERSION = 1;
export const RECENT_FILES_STORE_NAME = "recent-files";
export const RECENT_FILES_LIMIT = 12;

export type RecentPdfEntry = {
  id: string;
  name: string;
  kind: "local" | "remote";
  lastOpenedAt: number;
  readingPosition?: ReadingPosition;
  fileHandle?: FileHandleLike;
  url?: string;
};

// Reading-position types live in app/viewer-types so app-level state
// (viewer-state) can use them without importing the recent-files feature.
export type { ReadingPosition, InternalNavigationEntry } from "../../app/viewer-types";
import type { ReadingPosition } from "../../app/viewer-types";