import { statusText } from "./viewer-elements";

/**
 * Status bar presentation shared by nearly every feature. Lives in the app
 * assembly layer so that features can depend on it without depending on each
 * other (the previous home was the recent-files feature).
 */
export function setStatus(message: string, isError = false): void {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}
