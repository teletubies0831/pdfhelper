import { requiredElement } from "./required-element";

/**
 * Application-shell element handles.
 *
 * These belong to chrome that can appear over *any* workspace view — currently the
 * error dialog — rather than to one feature, so they do not live in a feature's
 * element module.
 */

export const appErrorDialog = requiredElement<HTMLDialogElement>("app-error-dialog");

export const appErrorDialogSummaryElement = requiredElement<HTMLElement>(
  "app-error-dialog-summary",
);

export const appErrorDialogMessageElement = requiredElement<HTMLElement>(
  "app-error-dialog-message",
);

export const appErrorDialogCloseButton = requiredElement<HTMLButtonElement>(
  "app-error-dialog-close",
);

export const appErrorDialogCopyButton = requiredElement<HTMLButtonElement>(
  "app-error-dialog-copy",
);

export const appErrorDialogDismissButton = requiredElement<HTMLButtonElement>(
  "app-error-dialog-dismiss",
);

/**
 * The annotation tool row (select / highlight / pen / …).
 *
 * It belongs to the reader: on the knowledge, graph or vocabulary pages there is no
 * PDF to annotate, and leaving the row visible offered a toolbar of dead controls.
 */
export const annotationToolsBar = requiredElement<HTMLElement>("annotation-tools-bar");
