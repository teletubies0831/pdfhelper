import { requiredElement } from "./required-element";

export const appFrame = document.querySelector<HTMLElement>(".app-frame");

export const assistantPanelToggleButton = requiredElement<HTMLButtonElement>(
  "assistant-panel-toggle",
);

export const outlineToggleButton = document.getElementById("outline-toggle");

export const aiPanelToggleButton = document.getElementById("ai-panel-toggle");

export const focusModeButton = requiredElement<HTMLButtonElement>("focus-mode-toggle");

export const focusModeLabel = requiredElement<HTMLElement>("focus-mode-label");

export const readingModeSelect = requiredElement<HTMLSelectElement>(
  "reading-mode-select",
);

export const readingModeTriggerLabel = requiredElement<HTMLElement>(
  "reading-mode-trigger-label",
);

export const readingModeMenuButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-reading-mode-value]"),
);

export const detectReadingModeButton = requiredElement<HTMLButtonElement>(
  "detect-reading-mode",
);

export const readingModeStatus = requiredElement<HTMLElement>("reading-mode-status");

export const aiSettingsButton =
  requiredElement<HTMLButtonElement>("ai-settings-button");
