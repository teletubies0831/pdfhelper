import { requiredElement } from "./required-element";

export const cardsPanelElement = requiredElement<HTMLElement>("cards-panel");

export const cardSourceSnippetElement = requiredElement<HTMLElement>(
  "card-source-snippet",
);

export const cardGenerationStatusElement = requiredElement<HTMLElement>(
  "card-generation-status",
);

export const cardGeneratedContentElement = requiredElement<HTMLElement>(
  "card-generated-content",
);

export const cardTitleElement = requiredElement<HTMLElement>("card-title");

export const cardExplanationElement = requiredElement<HTMLElement>("card-explanation");

export const cardKeyPointsElement =
  requiredElement<HTMLUListElement>("card-key-points");

export const cardPurposeElement = requiredElement<HTMLElement>("card-purpose");

export const cardUnderstandingElement =
  requiredElement<HTMLElement>("card-understanding");

export const cardSourceLocationElement = requiredElement<HTMLElement>(
  "card-source-location",
);

export const cardTypeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-card-type]"),
);

export const copyCardButton = requiredElement<HTMLButtonElement>("copy-card");

export const saveCardButton = requiredElement<HTMLButtonElement>("save-card");

export const outlineList = document.querySelector<HTMLElement>(".outline-list");
