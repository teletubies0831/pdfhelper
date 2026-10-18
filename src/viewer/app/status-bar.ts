import { showAppError } from "./error-dialog";
import { statusText } from "./viewer-elements";

/**
 * Status bar presentation shared by nearly every feature. Lives in the app
 * assembly layer so that features can depend on it without depending on each
 * other (the previous home was the recent-files feature).
 *
 * Errors additionally open the readable error dialog: the status bar is one line
 * wide and previously truncated the reason (a retry-exhausted extraction banner was
 * cut off mid-sentence), so a failure could be seen but not read. The bar still gets
 * the message, because it survives after the dialog is dismissed.
 */
export function setStatus(message: string, isError = false): void {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
  if (isError) showAppError(message);
}
