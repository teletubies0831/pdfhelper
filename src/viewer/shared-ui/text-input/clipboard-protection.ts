export function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function installTextInputClipboardProtection(
  root: HTMLElement,
  pdfViewer: HTMLElement,
): void {
  for (const type of ["copy", "cut", "paste"] as const) {
    root.addEventListener(type, (event) => {
      if (
        !isTextInputTarget(event.target) ||
        pdfViewer.contains(event.target as Node)
      ) {
        return;
      }

      // PDF.js handles clipboard events on document and cancels their defaults.
      // Stop at the app root after input handlers (e.g. chat image pasting) run,
      // preserving native text editing without changing PDF annotation pasting.
      event.stopPropagation();
    });
  }
}
