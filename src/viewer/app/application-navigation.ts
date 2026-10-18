import {
  aiPanelToggleButton,
  annotationToolsBar,
  assistantPanelToggleButton,
  knowledgeBaseEntryButton,
  knowledgeGraphEntryButton,
  outlineToggleButton,
  vocabularyLibraryEntryButton,
} from "./viewer-elements";
import { getActiveWorkspaceView } from "./workspace-navigation";

/**
 * App-level navigation state shared by the knowledge, graph, vocabulary and
 * assistant features. The page render handlers are injected by the registration
 * layer so this module stays free of feature imports.
 */
let knowledgeRenderHandler: (() => void) | null = null;
let graphRenderHandler: (() => void) | null = null;

export function setKnowledgeRenderHandler(handler: typeof knowledgeRenderHandler): void {
  knowledgeRenderHandler = handler;
}

export function setGraphRenderHandler(handler: typeof graphRenderHandler): void {
  graphRenderHandler = handler;
}

export function setCurrentApplicationView(
  view: "viewer" | "journal" | "knowledge" | "graph" | "vocabulary",
): void {
  const isViewer = view === "viewer";
  aiPanelToggleButton?.classList.toggle("active", isViewer);
  knowledgeBaseEntryButton.classList.toggle("active", view === "knowledge");
  knowledgeGraphEntryButton.classList.toggle("active", view === "graph");
  vocabularyLibraryEntryButton.classList.toggle(
    "active",
    view === "vocabulary",
  );
  for (const [button, candidate] of [
    [aiPanelToggleButton, "viewer"],
    [knowledgeBaseEntryButton, "knowledge"],
    [knowledgeGraphEntryButton, "graph"],
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
  // The annotation row only makes sense over a PDF: on the knowledge / graph /
  // vocabulary pages it was a row of controls that could not do anything.
  annotationToolsBar.hidden = !isViewer;
}

export function updateModeNavigation(): void {
  knowledgeBaseEntryButton.disabled = false;
  knowledgeGraphEntryButton.disabled = false;
  if (getActiveWorkspaceView() === "knowledge") knowledgeRenderHandler?.();
  if (getActiveWorkspaceView() === "graph") graphRenderHandler?.();
}
