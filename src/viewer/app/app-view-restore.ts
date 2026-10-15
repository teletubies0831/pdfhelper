import {
  applyPersistedKnowledgeState,
  readPersistedAppViewState,
} from "./app-view-persistence";
import {
  applyPersistedVocabularyState,
  isVocabularyLibraryEnabled,
  openVocabularyLibraryPage,
} from "../features/vocabulary-library/public";
import { openKnowledgeBasePage } from "../features/knowledge-base/public";
import {
  knowledgeMainElement,
  vocabularyLibraryMainElement,
} from "./viewer-elements";

/**
 * Re-applies the persisted workspace view after a refresh. Lives in the app
 * assembly layer (not in app-view-persistence) because it coordinates feature
 * page opens, which feature code must not be depended on by plain state files.
 */
export function restoreAppViewAfterRefresh(): void {
  const state = readPersistedAppViewState();
  if (!state || state.view === "viewer") return;

  if (state.view === "vocabulary") {
    if (!isVocabularyLibraryEnabled()) return;
    applyPersistedVocabularyState({
      search: state.vocabularySearch,
      sort: state.vocabularySort,
      timeFilter: state.vocabularyTimeFilter,
    });
    openVocabularyLibraryPage();
    requestAnimationFrame(() => {
      vocabularyLibraryMainElement.scrollTop = Math.max(
        0,
        state.vocabularyScrollTop,
      );
    });
    return;
  }

  applyPersistedKnowledgeState(state);
  openKnowledgeBasePage();
  requestAnimationFrame(() => {
    if (knowledgeMainElement) {
      knowledgeMainElement.scrollTop = Math.max(0, state.knowledgeScrollTop);
    }
  });
}
