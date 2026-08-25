import {
  aiPanelToggleButton,
  assistantPanelToggleButton,
  knowledgeBaseEntryButton,
  knowledgeBasePageElement,
  outlineToggleButton,
} from "../../app/viewer-elements";
import { renderKnowledgeBase } from "../knowledge-base/public";

export function setCurrentApplicationView(
  view: "viewer" | "journal" | "knowledge",
): void {
  const isViewer = view === "viewer";
  aiPanelToggleButton?.classList.toggle("active", isViewer);
  knowledgeBaseEntryButton.classList.toggle("active", view === "knowledge");
  if (outlineToggleButton instanceof HTMLButtonElement) {
    outlineToggleButton.disabled = !isViewer;
    outlineToggleButton.setAttribute("aria-disabled", String(!isViewer));
  }
  assistantPanelToggleButton.disabled = !isViewer;
  assistantPanelToggleButton.setAttribute("aria-disabled", String(!isViewer));
}

export function updateModeNavigation(): void {
  knowledgeBaseEntryButton.textContent = "知识库";
  knowledgeBaseEntryButton.disabled = false;
  if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
}
