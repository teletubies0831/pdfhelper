const REGION_SELECTOR = [
  'dialog', '[role="dialog"]', '#highlight-note-popover', '#find-bar',
  '.reading-panel', '.left-panel', '.assistant-panel', '.ai-tab-panel',
  '.right-panel', '#knowledge-base-page', '#vocabulary-library-page',
].join(',');

export function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function elementAt(target: EventTarget | null): Element | null {
  return target instanceof Element ? target :
    target instanceof Node ? target.parentElement : null;
}

function isAvailable(element: Element): boolean {
  return element.isConnected &&
    !element.closest('[hidden], [inert], [aria-hidden="true"], .is-workspace-outgoing, dialog:not([open])') &&
    getComputedStyle(element).display !== 'none' &&
    getComputedStyle(element).visibility !== 'hidden';
}

/** Install before PDF.js creates its document/window listeners. */
export function createInteractionBoundary(doc: Document, pdfContainer: HTMLElement) {
  const win = doc.defaultView!;
  let lastTarget: Element | null = null;
  let installed = false;
  const keyboardOwnership = new WeakMap<Event, boolean>();
  const keyboardRegions = new WeakMap<Event, Element | null>();

  function modal(): Element | null {
    return Array.from(doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
      .filter(isAvailable).at(-1) ?? null;
  }

  function region(target: EventTarget | null): Element | null {
    const overlay = modal();
    if (overlay) return overlay;
    const element = elementAt(target);
    // Text editing has priority over a stale DOM selection or pointer position.
    if (isTextInputTarget(element) || element instanceof HTMLSelectElement) {
      return element?.closest(REGION_SELECTOR) ?? element;
    }
    const current = lastTarget && isAvailable(lastTarget) ? lastTarget : element;
    const scope = current?.closest(REGION_SELECTOR);
    if (scope && isAvailable(scope)) return scope;
    // Switching workspaces can hide the previous focused element without a focusin.
    return Array.from(doc.querySelectorAll('#knowledge-base-page, #vocabulary-library-page'))
      .find(isAvailable) ?? null;
  }

  function ownsPdfRegion(target: EventTarget | null): boolean {
    if (!isAvailable(pdfContainer) || modal()) return false;
    const scope = region(target);
    return Boolean(scope && (
      scope.contains(pdfContainer) || scope.matches('.left-panel, #find-bar')
    ));
  }

  function ownsPdfKeyboard(event: KeyboardEvent): boolean {
    return keyboardOwnership.get(event) ?? ownsPdfRegion(event.target);
  }

  function ownsRegion(event: KeyboardEvent, root: Element): boolean {
    const scope = keyboardRegions.get(event) ?? region(event.target);
    return Boolean(scope && (root.contains(scope) || scope === root));
  }

  function ownsPdfClipboard(event: Event): boolean {
    const target = elementAt(event.target);
    if (!isAvailable(pdfContainer) || modal()) return false;
    // PDF form/free-text editors handle their own native editing at the target.
    if (isTextInputTarget(target)) return false;
    if (event.type === 'copy' || event.type === 'cut') {
      const selection = doc.getSelection();
      if (selection && !selection.isCollapsed) {
        return pdfContainer.contains(selection.anchorNode) &&
          pdfContainer.contains(selection.focusNode);
      }
    }
    return ownsPdfRegion(target);
  }

  function install(): void {
    if (installed) return;
    installed = true;
    const remember = (event: Event) => { lastTarget = elementAt(event.target); };
    doc.addEventListener('pointerdown', remember, true);
    doc.addEventListener('focusin', remember, true);

    win.addEventListener('keydown', (event) => {
      keyboardOwnership.set(event, ownsPdfRegion(event.target));
      keyboardRegions.set(event, region(event.target));
    }, true);

    win.addEventListener('keydown', (event) => {
      const input = isTextInputTarget(event.target) || event.target instanceof HTMLSelectElement;
      if (ownsPdfKeyboard(event) && !input && !event.isComposing && !event.defaultPrevented) return;

      // Run after component and document handlers, before PDF.js's window handler.
      // Do not cancel native input deletion, undo, clipboard or IME behavior.
      event.stopImmediatePropagation();
      if (!input && !event.defaultPrevented && !event.isComposing &&
          (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
          event.key.toLowerCase() === 'a') {
        // With no content region (e.g. the app toolbar), never select the whole
        // document and accidentally include the PDF and unrelated panels.
        event.preventDefault();
        const scope = keyboardRegions.get(event);
        if (scope && isAvailable(scope)) {
          const content = scope.querySelector('#chat-messages') ?? scope;
          const range = doc.createRange();
          range.selectNodeContents(content);
          const selection = doc.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
    });

    // Allow keyup through: PDF.js must release Shift even if focus moved while held.
    for (const type of ['copy', 'cut', 'paste']) {
      doc.addEventListener(type, (event) => {
        if (!ownsPdfClipboard(event) || event.defaultPrevented) {
          event.stopImmediatePropagation();
        }
      });
    }
    // Images dropped into other panels must not become PDF stamp annotations.
    for (const type of ['dragover', 'drop']) {
      doc.addEventListener(type, (event) => {
        const target = elementAt(event.target);
        if (!target || !pdfContainer.contains(target) || !isAvailable(pdfContainer) ||
            modal() || isTextInputTarget(target) || event.defaultPrevented) {
          event.stopImmediatePropagation();
        }
      });
    }
  }

  return { install, ownsPdfKeyboard, ownsPdfClipboard, ownsRegion };
}
