import {
  aiPanelToggleButton,
  assistantPanelToggleButton,
  knowledgeBaseEntryButton,
  outlineToggleButton,
  vocabularyLibraryEntryButton,
} from "../../app/viewer-elements";
import { getActiveWorkspaceView } from "../../app/workspace-navigation";
import { renderKnowledgeBase } from "../knowledge-base/public";

export function setCurrentApplicationView(
  view: "viewer" | "journal" | "knowledge" | "vocabulary",
): void {
  const isViewer = view === "viewer";
  aiPanelToggleButton?.classList.toggle("active", isViewer);
  knowledgeBaseEntryButton.classList.toggle("active", view === "knowledge");
  vocabularyLibraryEntryButton.classList.toggle(
    "active",
    view === "vocabulary",
  );
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
  if (getActiveWorkspaceView() === "knowledge") renderKnowledgeBase();
}
