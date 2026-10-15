import {
  knowledgeGroupSelect,
  knowledgeMainElement,
  knowledgeSearchInput,
  knowledgeSortSelect,
  vocabularyLibraryMainElement,
  vocabularySearchInput,
  vocabularySortSelect,
  vocabularyTimeFilterSelect,
} from "./viewer-elements";
import { getActiveWorkspaceView } from "./workspace-navigation";
import {
  APP_VIEW_SESSION_STORAGE_KEY,
  activeKnowledgeCategory,
  activeKnowledgeFilter,
  activeKnowledgeFocus,
  activeKnowledgePriority,
  activeKnowledgeReadingStatus,
  activeKnowledgeTag,
  activeKnowledgeVenue,
  activeKnowledgeYear,
  selectedKnowledgeRecordKey,
} from './feature-models';
import type { PersistedAppView, PersistedAppViewState } from './feature-models';

export function readPersistedAppViewState(): PersistedAppViewState | null {
  try {
    const raw = sessionStorage.getItem(APP_VIEW_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedAppViewState>;
    if (
      value.view !== "viewer" &&
      value.view !== "knowledge" &&
      value.view !== "vocabulary"
    ) {
      return null;
    }
    return {
      view: value.view,
      knowledgeFilter:
        value.knowledgeFilter === "note" ||
        value.knowledgeFilter === "reading-card" ||
        value.knowledgeFilter === "paper-card"
          ? value.knowledgeFilter
          : "all",
      knowledgeCategory:
        typeof value.knowledgeCategory === "string"
          ? value.knowledgeCategory
          : "all",
      knowledgeTag:
        typeof value.knowledgeTag === "string" ? value.knowledgeTag : "",
      knowledgeFocus:
        value.knowledgeFocus === "todo" ||
        value.knowledgeFocus === "deep" ||
        value.knowledgeFocus === "finished" ||
        value.knowledgeFocus === "citable" ||
        value.knowledgeFocus === "replicate" ||
        value.knowledgeFocus === "related" ||
        value.knowledgeFocus === "methods"
          ? value.knowledgeFocus
          : "all",
      knowledgeYear:
        typeof value.knowledgeYear === "string" ? value.knowledgeYear : "all",
      knowledgeVenue:
        typeof value.knowledgeVenue === "string" ? value.knowledgeVenue : "all",
      knowledgeReadingStatus:
        typeof value.knowledgeReadingStatus === "string"
          ? value.knowledgeReadingStatus
          : "all",
      knowledgePriority:
        typeof value.knowledgePriority === "string"
          ? value.knowledgePriority
          : "all",
      knowledgeSearch:
        typeof value.knowledgeSearch === "string" ? value.knowledgeSearch : "",
      knowledgeSort:
        typeof value.knowledgeSort === "string"
          ? value.knowledgeSort
          : "newest",
      knowledgeGroup:
        typeof value.knowledgeGroup === "string"
          ? value.knowledgeGroup
          : "none",
      selectedKnowledgeRecordKey:
        typeof value.selectedKnowledgeRecordKey === "string"
          ? value.selectedKnowledgeRecordKey
          : "",
      knowledgeScrollTop: Number.isFinite(value.knowledgeScrollTop)
        ? Number(value.knowledgeScrollTop)
        : 0,
      vocabularySearch:
        typeof value.vocabularySearch === "string" ? value.vocabularySearch : "",
      vocabularySort:
        typeof value.vocabularySort === "string" ? value.vocabularySort : "newest",
      vocabularyTimeFilter:
        typeof value.vocabularyTimeFilter === "string"
          ? value.vocabularyTimeFilter
          : "all",
      vocabularyScrollTop: Number.isFinite(value.vocabularyScrollTop)
        ? Number(value.vocabularyScrollTop)
        : 0,
    };
  } catch {
    return null;
  }
}

function getCurrentPersistedAppView(): PersistedAppView {
  return getActiveWorkspaceView();
}

export function persistCurrentAppViewState(): void {
  const state: PersistedAppViewState = {
    view: getCurrentPersistedAppView(),
    knowledgeFilter: activeKnowledgeFilter.value,
    knowledgeCategory: activeKnowledgeCategory.value,
    knowledgeTag: activeKnowledgeTag.value,
    knowledgeFocus: activeKnowledgeFocus.value,
    knowledgeYear: activeKnowledgeYear.value,
    knowledgeVenue: activeKnowledgeVenue.value,
    knowledgeReadingStatus: activeKnowledgeReadingStatus.value,
    knowledgePriority: activeKnowledgePriority.value,
    knowledgeSearch: knowledgeSearchInput.value,
    knowledgeSort: knowledgeSortSelect.value,
    knowledgeGroup: knowledgeGroupSelect.value,
    selectedKnowledgeRecordKey: selectedKnowledgeRecordKey.value,
    knowledgeScrollTop: knowledgeMainElement?.scrollTop ?? 0,
    vocabularySearch: vocabularySearchInput.value,
    vocabularySort: vocabularySortSelect.value,
    vocabularyTimeFilter: vocabularyTimeFilterSelect.value,
    vocabularyScrollTop: vocabularyLibraryMainElement.scrollTop,
  };

  try {
    sessionStorage.setItem(APP_VIEW_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the application must remain usable.
  }
}

export function applyPersistedKnowledgeState(state: PersistedAppViewState): void {
  activeKnowledgeFilter.value = "all";
  activeKnowledgeCategory.value = "all";
  activeKnowledgeTag.value = "";
  activeKnowledgeFocus.value = "all";
  activeKnowledgeYear.value = state.knowledgeYear;
  activeKnowledgeVenue.value = state.knowledgeVenue;
  activeKnowledgeReadingStatus.value = "all";
  activeKnowledgePriority.value = "all";
  selectedKnowledgeRecordKey.value = state.selectedKnowledgeRecordKey;

  knowledgeSearchInput.value = state.knowledgeSearch;
  knowledgeSortSelect.value = state.knowledgeSort;
  knowledgeGroupSelect.value = "none";
}
