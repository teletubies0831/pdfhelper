

import { PAPER_CARD_INLINE_DRAFT_STORAGE_KEY, editingPaperOverviewId, paperCardReviewDocumentName } from "../../core/pdf-reader/public";
import { editPaperCardButton, paperAuthorsInput, paperCardDocumentNameElement, paperCardFormElement, paperCoreInnovationInput, paperMainFindingsInput, paperOneSentenceSummaryInput, paperResearchAreaInput, paperResearchConnectionInput, paperResearchProblemInput, paperTitleInput, paperVenueYearInput, paperWorthReadingInput } from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";


import { savePaperOverviewCard } from './paper-card-controller';
import { autoResizePaperCardTextarea, schedulePaperCardTextareaRefresh } from "./paper-card-form-view";
import { readJsonValue, writeJsonValue } from '../../../platform/storage/browser-json-repository';

export let paperCardEditMode = { value: false };

export function getPaperCardInlineControls(): HTMLTextAreaElement[] {
  return [
    paperTitleInput,
    paperAuthorsInput,
    paperVenueYearInput,
    paperResearchAreaInput,
    paperCardDocumentNameElement,
    paperOneSentenceSummaryInput,
    paperResearchProblemInput,
    paperCoreInnovationInput,
    paperMainFindingsInput,
    paperResearchConnectionInput,
    paperWorthReadingInput,
  ];
}

export type PaperCardInlineDraft = {
  values: Record<string, string>;
  updatedAt: string;
};

export type PaperCardInlineDraftStore = Record<string, PaperCardInlineDraft>;

export function getPaperCardInlineDraftKey(): string {
  if (editingPaperOverviewId.value) return `saved:${editingPaperOverviewId.value}`;
  const documentIdentity = sourceName.value
    ? getDisplayFileName(sourceName.value)
    : paperCardReviewDocumentName.value || "untitled";
  return `document:${documentIdentity}`;
}

export function getPaperCardInlineFieldKey(control: HTMLTextAreaElement): string {
  return control.name || control.id;
}

export function readPaperCardInlineDraftStore(): PaperCardInlineDraftStore {
  const value = readJsonValue<unknown>(PAPER_CARD_INLINE_DRAFT_STORAGE_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PaperCardInlineDraftStore
    : {};
}

export function savePaperCardInlineDraft(control: HTMLTextAreaElement): void {
  const store = readPaperCardInlineDraftStore();
  const key = getPaperCardInlineDraftKey();
  const current = store[key] ?? {
    values: {},
    updatedAt: new Date().toISOString(),
  };

  current.values[getPaperCardInlineFieldKey(control)] = control.value.trim();
  current.updatedAt = new Date().toISOString();
  store[key] = current;
  writeJsonValue(PAPER_CARD_INLINE_DRAFT_STORAGE_KEY, store);
}

export function saveAllPaperCardInlineDrafts(): void {
  for (const control of getPaperCardInlineControls()) {
    savePaperCardInlineDraft(control);
  }
}

export function restorePaperCardInlineDrafts(): void {
  const draft = readPaperCardInlineDraftStore()[getPaperCardInlineDraftKey()];
  if (!draft?.values) return;

  for (const control of getPaperCardInlineControls()) {
    const savedValue = draft.values[getPaperCardInlineFieldKey(control)];
    if (typeof savedValue === "string") control.value = savedValue;
  }
}

export function clearPaperCardInlineDrafts(): void {
  const store = readPaperCardInlineDraftStore();
  const key = getPaperCardInlineDraftKey();
  if (!(key in store)) return;
  delete store[key];
  writeJsonValue(PAPER_CARD_INLINE_DRAFT_STORAGE_KEY, store);
}

export function installPaperCardInlineEditing(): void {
  for (const control of getPaperCardInlineControls()) {
    control.classList.add("paper-card-inline-editable");
    control.closest("label")?.classList.add(
      "paper-card-inline-editable-field",
    );
    control
      .closest(".paper-card-insight, .paper-card-decision-reason")
      ?.classList.add("paper-card-inline-editable-card");

    control.addEventListener("input", () => {
      autoResizePaperCardTextarea(control);
    });

    control.addEventListener("blur", () => {
      if (!paperCardEditMode.value) return;
      savePaperCardInlineDraft(control);
    });
  }
}

export function setPaperCardEditMode(editing: boolean): void {
  const wasEditing = paperCardEditMode.value;
  paperCardEditMode.value = editing;

  paperCardFormElement.classList.toggle("editing", editing);
  paperCardFormElement.classList.toggle("reading-view", !editing);

  const controls = paperCardFormElement.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  for (const control of controls) {
    if (control instanceof HTMLSelectElement) {
      control.disabled = !editing;
    }
    else {
      control.readOnly = !editing;
    }
  }

  if (wasEditing && !editing) {
    saveAllPaperCardInlineDrafts();
    if (editingPaperOverviewId.value) savePaperOverviewCard();
  }

  editPaperCardButton.textContent = editing ? "✓ 完成编辑" : "✎ 编辑卡片";
  editPaperCardButton.classList.toggle("active", editing);
  editPaperCardButton.setAttribute("aria-pressed", String(editing));
  schedulePaperCardTextareaRefresh();
}
