import { requiredElement } from "./required-element";

export const openFileButton = requiredElement<HTMLElement>("open-file");

export const fileInput = requiredElement<HTMLInputElement>("file-input");

export const recentFilesButton = requiredElement<HTMLButtonElement>(
  "recent-files-button",
);

export const recentFilesDialog = requiredElement<HTMLElement>("recent-files-dialog");

export const recentFilesList = requiredElement<HTMLElement>("recent-files-list");

export const closeRecentFilesButton =
  requiredElement<HTMLButtonElement>("close-recent-files");

export const clearRecentFilesButton =
  requiredElement<HTMLButtonElement>("clear-recent-files");

export const previousButton = requiredElement<HTMLButtonElement>("previous-page");

export const nextButton = requiredElement<HTMLButtonElement>("next-page");

export const pageNumberInput = requiredElement<HTMLInputElement>("page-number");

export const pageCountElement = requiredElement<HTMLElement>("page-count");

export const zoomOutButton = requiredElement<HTMLButtonElement>("zoom-out");

export const zoomInButton = requiredElement<HTMLButtonElement>("zoom-in");

export const zoomValueElement = requiredElement<HTMLElement>("zoom-value");

export const findBar = requiredElement<HTMLFormElement>("find-bar");

export const findInput = requiredElement<HTMLInputElement>("find-input");

export const findCount = requiredElement<HTMLElement>("find-count");

export const findPreviousButton = requiredElement<HTMLButtonElement>("find-previous");

export const findNextButton = requiredElement<HTMLButtonElement>("find-next");

export const findCloseButton = requiredElement<HTMLButtonElement>("find-close");

export const statusText = requiredElement<HTMLElement>("status-text");

export const textStatus = requiredElement<HTMLElement>("text-status");

export const viewerContainer = requiredElement<HTMLDivElement>("viewer-container");

export const viewerElement = requiredElement<HTMLDivElement>("viewer");

export const citationReturnButton = requiredElement<HTMLButtonElement>(
  "citation-return-button",
);

export const citationReturnPosition = requiredElement<HTMLElement>(
  "citation-return-position",
);
