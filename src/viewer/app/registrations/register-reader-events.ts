import { registerDocumentTabEvents } from "./reader/register-document-tab-events";
import { registerReaderFileOpenEvents } from "./reader/register-reader-file-open-events";
import { registerReaderNavigationEvents } from "./reader/register-reader-navigation-events";
import { registerReaderAnnotationEvents } from "./reader/register-reader-annotation-events";
import { registerReaderKeyboardEvents } from "./reader/register-reader-keyboard-events";

export function registerReaderEvents(): void {
  registerDocumentTabEvents();
  registerReaderFileOpenEvents();
  registerReaderNavigationEvents();
  registerReaderAnnotationEvents();
  registerReaderKeyboardEvents();
}
