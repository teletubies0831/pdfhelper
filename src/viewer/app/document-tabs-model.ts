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
  /**
   * The annotation snapshot last written into this tab's file.
   *
   * Per tab because "unsaved" is a comparison: switching tabs used to re-stamp the current state as saved, so an edit
   * made before the switch lost both its marker and its close-tab prompt.
   */
  savedSnapshot: string;
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

export interface TabClosePlan {
  /** Tabs that remain open after the close. */
  remainingTabs: DocumentTab[];
  /**
   * Tab that should become active, or null when nothing should change.
   *
   * Null for a background close on purpose: closing a tab you are not looking at
   * must not change what you are reading. Only closing the *active* tab hands the
   * reader a neighbour.
   */
  nextActiveTabId: string | null;
  /** True when the closed tab was the active one. */
  closedActiveTab: boolean;
  /** True when no tabs remain, so the workspace has to be emptied. */
  shouldClearWorkspace: boolean;
}

/**
 * Plans a tab close without touching runtime state.
 *
 * Split out because the "which document is active afterwards" rule is easy to get
 * wrong in a way that only shows up as the reader jumping to another PDF: the
 * original implementation activated the neighbour unconditionally, so clicking × on
 * a background tab silently switched the visible document.
 */
export function planTabClose(
  tabs: readonly DocumentTab[],
  closingTabId: string,
  activeTabId: string | null,
): TabClosePlan {
  const index = tabs.findIndex((tab) => tab.id === closingTabId);
  if (index < 0) {
    return {
      remainingTabs: [...tabs],
      nextActiveTabId: null,
      closedActiveTab: false,
      shouldClearWorkspace: false,
    };
  }

  const remainingTabs = tabs.filter((tab) => tab.id !== closingTabId);
  const closedActiveTab = closingTabId === activeTabId;
  if (!closedActiveTab) {
    return { remainingTabs, nextActiveTabId: null, closedActiveTab, shouldClearWorkspace: false };
  }

  // Same neighbour rule as a browser: the tab that took the slot, else the previous.
  const next = remainingTabs[index] ?? remainingTabs[index - 1] ?? null;
  return {
    remainingTabs,
    nextActiveTabId: next?.id ?? null,
    closedActiveTab,
    shouldClearWorkspace: remainingTabs.length === 0,
  };
}
