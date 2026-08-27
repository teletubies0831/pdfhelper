import {
  readJsonValue,
  writeJsonValue,
} from "../../../infrastructure/storage/browser-json-repository";
import {
  showVocabularyLibraryInput,
  translationSaveToVocabularyButton,
  vocabularyLibraryEntryButton,
} from "../../app/viewer-elements";

const VOCABULARY_LIBRARY_ENABLED_STORAGE_KEY =
  "pdf-helper-vocabulary-library-enabled-v1";

let vocabularyLibraryEnabled = readJsonValue<boolean>(
  VOCABULARY_LIBRARY_ENABLED_STORAGE_KEY,
  true,
);
let initialized = false;

export function isVocabularyLibraryEnabled(): boolean {
  return vocabularyLibraryEnabled;
}

export function syncVocabularyLibraryVisibility(): void {
  vocabularyLibraryEntryButton.hidden = !vocabularyLibraryEnabled;
  translationSaveToVocabularyButton.hidden = !vocabularyLibraryEnabled;
  showVocabularyLibraryInput.checked = vocabularyLibraryEnabled;
}

export function initializeVocabularyLibraryPreference(
  closeLibrary: () => void,
): void {
  syncVocabularyLibraryVisibility();
  if (initialized) return;
  initialized = true;
  showVocabularyLibraryInput.addEventListener("change", () => {
    vocabularyLibraryEnabled = showVocabularyLibraryInput.checked;
    try {
      writeJsonValue(
        VOCABULARY_LIBRARY_ENABLED_STORAGE_KEY,
        vocabularyLibraryEnabled,
      );
    } catch {
      // Keep the current-session preference usable when storage is blocked.
    }
    syncVocabularyLibraryVisibility();
    if (!vocabularyLibraryEnabled) closeLibrary();
  });
}
