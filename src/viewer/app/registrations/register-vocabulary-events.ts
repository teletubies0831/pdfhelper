import {
  vocabularyCardGridElement,
  vocabularyEditorCancelButton,
  vocabularyEditorCloseButton,
  vocabularyEditorDeleteButton,
  vocabularyEditorDialog,
  vocabularyEditorForm,
  vocabularyEditorMarkdownInput,
  vocabularyEditorModeToggleButton,
  vocabularyEditorSpeakButton,
  vocabularyLibraryBackButton,
  vocabularyLibraryEntryButton,
  vocabularyLibraryMainElement,
  vocabularyNewCardButton,
  vocabularySearchInput,
  vocabularySortSelect,
  vocabularyTimeFilterSelect,
} from "../viewer-elements";
import { scheduleAppViewStateSave } from "../app-ui";
import {
  closeVocabularyEditor,
  closeVocabularyLibraryPage,
  getEditingVocabularyCardId,
  getVocabularyCardById,
  initializeVocabularyLibraryPreference,
  openVocabularyEditor,
  openVocabularyLibraryPage,
  removeVocabularyCard,
  renderVocabularyLibrary,
  saveVocabularyEditor,
  scheduleVocabularyPreview,
  setVocabularyEditorBodyMode,
  speakVocabularyEditorTerm,
  vocabularyEditorBodyMode,
} from "../../features/vocabulary-library/public";

export function registerVocabularyEvents(): void {
  initializeVocabularyLibraryPreference(closeVocabularyLibraryPage);
  vocabularyLibraryEntryButton.addEventListener(
    "click",
    openVocabularyLibraryPage,
  );
  vocabularyLibraryBackButton.addEventListener(
    "click",
    closeVocabularyLibraryPage,
  );
  vocabularyNewCardButton.addEventListener("click", () => {
    openVocabularyEditor();
  });

  vocabularySearchInput.addEventListener("input", () => {
    void renderVocabularyLibrary();
  });
  vocabularySortSelect.addEventListener("change", () => {
    void renderVocabularyLibrary();
  });
  vocabularyTimeFilterSelect.addEventListener("change", () => {
    void renderVocabularyLibrary();
  });
  vocabularyLibraryMainElement.addEventListener(
    "scroll",
    scheduleAppViewStateSave,
    { passive: true },
  );

  vocabularyCardGridElement.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLButtonElement>(
      "[data-delete-vocabulary-card]",
    );
    if (remove?.dataset.deleteVocabularyCard) {
      void removeVocabularyCard(remove.dataset.deleteVocabularyCard);
      return;
    }
    if (target.closest("a, button")) return;
    const cardElement = target.closest<HTMLElement>(
      "[data-open-vocabulary-card]",
    );
    const card = cardElement?.dataset.openVocabularyCard
      ? getVocabularyCardById(cardElement.dataset.openVocabularyCard)
      : undefined;
    if (card) openVocabularyEditor(card);
  });

  vocabularyCardGridElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cardElement = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-open-vocabulary-card]",
    );
    const card = cardElement?.dataset.openVocabularyCard
      ? getVocabularyCardById(cardElement.dataset.openVocabularyCard)
      : undefined;
    if (!card) return;
    event.preventDefault();
    openVocabularyEditor(card);
  });

  vocabularyEditorMarkdownInput.addEventListener(
    "input",
    scheduleVocabularyPreview,
  );
  vocabularyEditorModeToggleButton.addEventListener("click", () => {
    setVocabularyEditorBodyMode(
      vocabularyEditorBodyMode.value === "preview" ? "edit" : "preview",
      true,
    );
  });
  vocabularyEditorSpeakButton.addEventListener(
    "click",
    speakVocabularyEditorTerm,
  );
  vocabularyEditorCloseButton.addEventListener("click", closeVocabularyEditor);
  vocabularyEditorCancelButton.addEventListener("click", closeVocabularyEditor);
  vocabularyEditorDialog.addEventListener("click", (event) => {
    if (event.target === vocabularyEditorDialog) closeVocabularyEditor();
  });
  vocabularyEditorDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeVocabularyEditor();
  });
  vocabularyEditorDeleteButton.addEventListener("click", () => {
    const id = getEditingVocabularyCardId();
    if (id) void removeVocabularyCard(id);
  });
  vocabularyEditorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveVocabularyEditor();
  });
}
