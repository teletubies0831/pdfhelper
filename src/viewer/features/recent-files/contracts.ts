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

export type ReadingPosition = {
  pageNumber: number;
  scrollTop: number;
  scrollLeft: number;
  scale: number;
  updatedAt: number;
};

export type InternalNavigationEntry = ReadingPosition & {
  documentKey: string;
};
