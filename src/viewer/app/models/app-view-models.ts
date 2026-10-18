import type { KnowledgeFilter, KnowledgeFocus } from "../../core/pdf-reader/reader-controls";

export const APP_VIEW_SESSION_STORAGE_KEY = "pdf-helper-app-view-state-v1";

export type PersistedAppView = "viewer" | "knowledge" | "graph" | "vocabulary";

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
  graphFocusMode: "all" | "current";
  graphFocusHops: number;
  graphMinConfidence: number;
  graphSearch: string;
  graphShowPapers: boolean;
  graphShowEntities: boolean;
  graphSelectedNodeId: string;
}
