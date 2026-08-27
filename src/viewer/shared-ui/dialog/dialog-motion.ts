const DIALOG_CLOSE_ANIMATION_MS = 340;

const closeAnimationTimers = new WeakMap<HTMLDialogElement, number>();
const initializedDialogs = new WeakSet<HTMLDialogElement>();

function clearCloseAnimation(dialog: HTMLDialogElement): void {
  const timer = closeAnimationTimers.get(dialog);
  if (timer !== undefined) window.clearTimeout(timer);
  closeAnimationTimers.delete(dialog);
}

function initializeDialog(dialog: HTMLDialogElement): void {
  if (initializedDialogs.has(dialog)) return;
  initializedDialogs.add(dialog);
  dialog.addEventListener("close", () => {
    clearCloseAnimation(dialog);
    dialog.classList.remove("is-open");
  });
}

export function showAnimatedDialog(dialog: HTMLDialogElement): void {
  initializeDialog(dialog);
  clearCloseAnimation(dialog);
  if (!dialog.open) {
    dialog.showModal();
    dialog.classList.remove("is-open");
    void dialog.offsetWidth;
  }
  dialog.classList.add("is-open");
}

export function dismissAnimatedDialog(dialog: HTMLDialogElement): void {
  initializeDialog(dialog);
  if (!dialog.open) return;
  clearCloseAnimation(dialog);
  dialog.classList.remove("is-open");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    dialog.close();
    return;
  }

  const timer = window.setTimeout(() => {
    closeAnimationTimers.delete(dialog);
    if (dialog.open) dialog.close();
  }, DIALOG_CLOSE_ANIMATION_MS);
  closeAnimationTimers.set(dialog, timer);
}
