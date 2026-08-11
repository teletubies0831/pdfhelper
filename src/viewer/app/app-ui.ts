
















import { aiTabButtons, aiTabPanels, translationLearningHintElement } from "./viewer-elements";
import { currentEnglishLearningResult, currentEnglishLearningSourceSentence, getViewerSelectionText, persistCurrentAppViewState, selectedTextForAi } from "../core/pdf-reader/public";
import { scheduleAutomaticTranslation, setMoreExamplesButtonVisible, setTranslationLearningTitle, setTranslationSelectionEditor, setTranslationState, updateSummaryMetadata } from "../features/translation/public";
import { scheduleSummaryGeneration } from "../services/document-agent/viewer-document-agent";
import { scheduleCardGeneration, updateCardSourceSnippet } from "../features/paper-card/public";













export const toolbarMenus = Array.from(
  document.querySelectorAll<HTMLElement>("[data-toolbar-menu]"),
);



export function setToolbarMenuOpen(menu: HTMLElement, open: boolean): void {
  const trigger = menu.querySelector<HTMLButtonElement>(
    ".toolbar-menu-trigger",
  );
  const panel = menu.querySelector<HTMLElement>(".toolbar-menu-panel");
  if (!trigger || !panel) return;

  menu.classList.toggle("open", open);
  trigger.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
}



export function closeToolbarMenus(except?: HTMLElement): void {
  for (const menu of toolbarMenus) {
    if (menu !== except) setToolbarMenuOpen(menu, false);
  }
}



export function activateAiTab(tabName: string): void {
  for (const tab of aiTabButtons) {
    tab.classList.toggle("active", tab.dataset.aiTab === tabName);
  }
  for (const panel of aiTabPanels) {
    panel.hidden = panel.dataset.aiPanel !== tabName;
  }

  if (tabName === "translate") {
    const text = selectedTextForAi.value || getViewerSelectionText();
    if (text) {
      selectedTextForAi.value = text;
      setTranslationSelectionEditor(
        text,
        currentEnglishLearningSourceSentence.value || text,
        currentEnglishLearningResult.value?.kind === "word"
          ? currentEnglishLearningResult.value.sentenceTranslation
          : "",
      );
      scheduleAutomaticTranslation(text);
    } else {
      currentEnglishLearningResult.value = null;
      setMoreExamplesButtonVisible(false);
      setTranslationLearningTitle("学习结果");
      translationLearningHintElement.textContent =
        "选一个单词可查看语境词义、词性和例句；选一句话可获得翻译与重点词讲解。";
      setTranslationState("请先在 PDF 中选中一个英文单词、句子或短段。");
    }
  } else if (tabName === "summary") {
    updateSummaryMetadata();
    scheduleSummaryGeneration(0);
  } else if (tabName === "cards") {
    updateCardSourceSnippet();
    scheduleCardGeneration(0);
  }
}



export let appViewStateSaveTimer: number | undefined;


export function scheduleAppViewStateSave(): void {
  if (appViewStateSaveTimer !== undefined)
    window.clearTimeout(appViewStateSaveTimer);
  appViewStateSaveTimer = window.setTimeout(() => {
    persistCurrentAppViewState();
    appViewStateSaveTimer = undefined;
  }, 160);
}



export const source = new URLSearchParams(window.location.search).get("src");
