import type { KnowledgeFilter, KnowledgeFocus } from "../../core/pdf-reader/reader-controls";

export const APP_VIEW_SESSION_STORAGE_KEY = "pdf-helper-app-view-state-v1";

export type PersistedAppView = "viewer" | "knowledge" | "vocabulary";

export interface PersistedAppViewState {
  view: PersistedAppView;
  knowledgeFilter: KnowledgeFilter;
  knowledgeCategory: string;
  knowledgeTag: string;
  knowledgeFocus: KnowledgeFocus;
  knowledgeYear: string;
  knowledgeVenue: string;
  knowledgeReadingStatus: string;
  knowledgePriority: string;
  knowledgeSearch: string;
  knowledgeSort: string;
  knowledgeGroup: string;
  selectedKnowledgeRecordKey: string;
  knowledgeScrollTop: number;
  vocabularySearch: string;
  vocabularySort: string;
  vocabularyTimeFilter: string;
  vocabularyScrollTop: number;
}
