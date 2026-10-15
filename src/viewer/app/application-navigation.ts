import {
  aiPanelToggleButton,
  assistantPanelToggleButton,
  knowledgeBaseEntryButton,
  outlineToggleButton,
  vocabularyLibraryEntryButton,
} from "./viewer-elements";
import { getActiveWorkspaceView } from "./workspace-navigation";

/**
 * App-level navigation state shared by the knowledge, vocabulary and assistant
 * features. The knowledge-page render is injected by the registration layer so
 * this module stays free of feature imports.
 */
let knowledgeRenderHandler: (() => void) | null = null;

export function setKnowledgeRenderHandler(handler: typeof knowledgeRenderHandler): void {
  knowledgeRenderHandler = handler;
}

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
  for (const [button, candidate] of [
    [aiPanelToggleButton, "viewer"],
    [knowledgeBaseEntryButton, "knowledge"],
    [vocabularyLibraryEntryButton, "vocabulary"],
  ] as const) {
    if (candidate === view) button?.setAttribute("aria-current", "page");
    else button?.removeAttribute("aria-current");
  }
  if (outlineToggleButton instanceof HTMLButtonElement) {
    outlineToggleButton.disabled = !isViewer;
    outlineToggleButton.setAttribute("aria-disabled", String(!isViewer));
  }
  assistantPanelToggleButton.disabled = !isViewer;
  assistantPanelToggleButton.setAttribute("aria-disabled", String(!isViewer));
}

export function updateModeNavigation(): void {
  knowledgeBaseEntryButton.disabled = false;
  if (getActiveWorkspaceView() === "knowledge") knowledgeRenderHandler?.();
}
