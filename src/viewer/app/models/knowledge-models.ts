import type { ResolvedReadingMode } from "../../../modules/reading-mode/public";
import type { KnowledgeFilter, KnowledgeFocus, KnowledgeKind, KnowledgeSource } from "../../core/pdf-reader/reader-controls";
import { createStateCell } from "../state-cell";

export interface SavedKnowledgeNote {
  id: string;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel?: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  readingMode?: ResolvedReadingMode;
}

export interface SavedReadingJournalEntry {
  id: string;
  readingMode: ResolvedReadingMode;
  documentId: string;
  documentName: string;
  recentEntryId?: string;
  pageNumber: number;
  positionLabel: string;
  title: string;
  quote: string;
  content: string;
  tags: string[];
  origin: "ai" | "translation" | "user";
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItemMeta {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  updatedAt?: string;
}

export type KnowledgeItemMetaStore = Record<string, KnowledgeItemMeta>;

export interface KnowledgeItem {
  recordKey: string;
  id: string;
  source: KnowledgeSource;
  kind: KnowledgeKind;
  originMode: ResolvedReadingMode;
  title: string;
  content: string;
  documentName: string;
  pageNumber?: number;
  positionLabel: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export const activeKnowledgeFilter = createStateCell<KnowledgeFilter>("all");

export const activeKnowledgeCategory = createStateCell("all");

export const activeKnowledgeTag = createStateCell("");

export const activeKnowledgeFocus = createStateCell<KnowledgeFocus>("all");

export const activeKnowledgeYear = createStateCell("all");

export const activeKnowledgeVenue = createStateCell("all");

export const activeKnowledgeReadingStatus = createStateCell("all");

export const activeKnowledgePriority = createStateCell("all");

// Knowledge selection state (previously scattered across app-view-persistence).
export const selectedKnowledgeRecordKey = createStateCell("");

export const knowledgeEditorTargetKey = createStateCell<string | null>(null);
