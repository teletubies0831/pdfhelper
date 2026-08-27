import { requiredElement } from "./required-element";

export const appFrame = document.querySelector<HTMLElement>(".app-frame");

export const workspaceStageElement = requiredElement<HTMLElement>(
  "workspace-stage",
);

export const readerWorkspaceElement = requiredElement<HTMLElement>(
  "reader-workspace",
);

export const assistantPanelToggleButton = requiredElement<HTMLButtonElement>(
  "assistant-panel-toggle",
);

export const outlineToggleButton = document.getElementById("outline-toggle");

export const aiPanelToggleButton = document.getElementById("ai-panel-toggle");

export const focusModeButton = requiredElement<HTMLButtonElement>("focus-mode-toggle");

export const focusModeLabel = requiredElement<HTMLElement>("focus-mode-label");

export const aiSettingsButton =
  requiredElement<HTMLButtonElement>("ai-settings-button");
