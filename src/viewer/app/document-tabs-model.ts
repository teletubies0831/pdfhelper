import type { PDFDocumentProxy } from "pdfjs-dist";

import type { FileHandleLike, ReadingPosition } from "./viewer-types";

/**
 * Pure tab-list model for the multi-document tab bar. Kept free of DOM and
 * PDF.js runtime dependencies so the tab bookkeeping is unit-testable.
 */
export interface DocumentTab {
  id: string;
  /** Display name (original file name or URL). */
  name: string;
  /** Latest PDF bytes (annotated export included), kept for re-attachment. */
  bytes: Uint8Array;
  fileHandle: FileHandleLike | null;
  url?: string;
  /** Parsed proxy, kept alive across switches; null until first rendered. */
  documentProxy: PDFDocumentProxy | null;
  documentId: string;
  fingerprint: string;
  recentEntryId: string | null;
  /** Snapshot of the reading position captured when the tab lost focus. */
  readingPosition: ReadingPosition | null;
  hasUnsavedChanges: boolean;
}

export function createDocumentTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function findDocumentTab(
  tabs: readonly DocumentTab[],
  tabId: string,
): DocumentTab | null {
  return tabs.find((tab) => tab.id === tabId) ?? null;
}

export function findDocumentTabByFingerprint(
  tabs: readonly DocumentTab[],
  fingerprint: string,
): DocumentTab | null {
  if (!fingerprint) return null;
  return tabs.find((tab) => tab.fingerprint === fingerprint) ?? null;
}

/**
 * Browser-like neighbor selection: after removing a tab, prefer the tab that
 * took its slot (the next one), otherwise the previous one.
 */
export function neighborTabAfterRemoval(
  tabs: readonly DocumentTab[],
  removedTabId: string,
): DocumentTab | null {
  const index = tabs.findIndex((tab) => tab.id === removedTabId);
  if (index < 0 || tabs.length === 0) return null;
  const next = tabs[index + 1] ?? null;
  if (next) return next;
  return tabs[index - 1] ?? null;
}

/** Compact display label: PDF extension dropped, truncated by the UI layer. */
export function documentTabLabel(tab: DocumentTab): string {
  return tab.name.replace(/\.pdf$/i, "");
}
