import { showAnimatedDialog } from "../shared-ui/dialog/dialog-motion";
import {
  appErrorDialog,
  appErrorDialogCloseButton,
  appErrorDialogCopyButton,
  appErrorDialogDismissButton,
  appErrorDialogMessageElement,
  appErrorDialogSummaryElement,
} from "./viewer-elements";

/**
 * Readable error surface.
 *
 * Errors used to appear only in the status bar or in a 260px-wide progress slot,
 * where a message like "1 次抽取失败且已重试 3 次：…" is cut off with an ellipsis — the
 * user can see that something failed but not what or why. This dialog exists to make
 * the whole message readable, selectable and copyable.
 *
 * Three rules keep it from becoming noise:
 *
 * - **One dialog, never a stack.** Repeated errors replace the text of the open
 *   dialog instead of queueing modals behind each other (a batch that fails ten
 *   times must not require ten dismissals).
 * - **Identical repeats are ignored.** The same message arriving twice — common when
 *   a retry loop reports the same failure — does not re-open or re-modal anything.
 * - **It never throws.** Showing an error must not become a new error, so a failure
 *   to open the dialog is swallowed after the text is set.
 */

let lastShownMessage = '';

export function isAppErrorDialogOpen(): boolean {
  return appErrorDialog.open;
}

export interface AppErrorOptions {
  /** Short heading, e.g. "抽取失败". Defaults to "出错了". */
  title?: string;
  /** One-line context above the details. */
  summary?: string;
}

export function showAppError(message: string, options: AppErrorOptions = {}): void {
  const detail = message.trim();
  if (!detail) return;

  appErrorDialogSummaryElement.textContent = options.summary?.trim() || '';
  appErrorDialogSummaryElement.hidden = !options.summary;
  appErrorDialogMessageElement.textContent = detail;

  // Already open with the same text: nothing to do, and definitely no second modal.
  if (appErrorDialog.open && lastShownMessage === detail) return;
  lastShownMessage = detail;

  if (appErrorDialog.open) return;
  try {
    showAnimatedDialog(appErrorDialog);
  } catch {
    // A dialog that cannot open still leaves the text in place; the status bar
    // already carries the message in that case.
  }
}

/** Test/diagnostic hook: forgets the last message so the next identical one shows. */
export function resetAppErrorDialogState(): void {
  lastShownMessage = '';
}

function dismiss(): void {
  lastShownMessage = '';
  if (appErrorDialog.open) appErrorDialog.close();
}

async function copyMessage(): Promise<void> {
  const text = appErrorDialogMessageElement.textContent ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    appErrorDialogCopyButton.textContent = '已复制';
    window.setTimeout(() => {
      appErrorDialogCopyButton.textContent = '复制错误信息';
    }, 1_500);
  } catch {
    // Clipboard permission refused: the text is on screen and selectable anyway.
    appErrorDialogCopyButton.textContent = '复制失败';
  }
}

export function registerAppErrorDialogEvents(): void {
  appErrorDialogDismissButton.addEventListener('click', dismiss);
  // The header × is a real close affordance: it was rendered by the shared dialog
  // markup, so a listener that forgot it would leave a button that does nothing.
  appErrorDialogCloseButton.addEventListener('click', dismiss);
  appErrorDialogCopyButton.addEventListener('click', () => {
    void copyMessage();
  });
  // Escape and a click on the backdrop both close it: the message stays in the
  // status bar, so dismissing never loses information.
  appErrorDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  appErrorDialog.addEventListener('click', (event) => {
    if (event.target === appErrorDialog) dismiss();
  });
}
