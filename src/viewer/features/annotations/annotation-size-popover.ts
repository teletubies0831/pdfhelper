let activeControl: HTMLElement | null = null;
let activeAnchor: HTMLElement | null = null;
let installed = false;

function positionActivePopover(): void {
  if (!activeControl || !activeAnchor || activeControl.hidden) return;
  const anchorRect = activeAnchor.getBoundingClientRect();
  const popoverWidth = activeControl.offsetWidth;
  const viewportPadding = 8;
  const left = Math.min(
    window.innerWidth - popoverWidth - viewportPadding,
    Math.max(
      viewportPadding,
      anchorRect.left + anchorRect.width / 2 - popoverWidth / 2,
    ),
  );
  activeControl.style.left = `${Math.round(left)}px`;
  activeControl.style.top = `${Math.round(anchorRect.bottom + 8)}px`;
  activeControl.style.removeProperty("visibility");
}

export function closeAnnotationSizePopover(
  control?: HTMLElement,
): void {
  if (!activeControl || (control && control !== activeControl)) return;
  activeAnchor?.setAttribute("aria-expanded", "false");
  activeControl.hidden = true;
  activeControl.style.removeProperty("left");
  activeControl.style.removeProperty("top");
  activeControl.style.removeProperty("visibility");
  activeControl = null;
  activeAnchor = null;
}

export function openAnnotationSizePopover(
  control: HTMLElement,
  anchor: HTMLElement,
): void {
  closeAnnotationSizePopover();
  activeControl = control;
  activeAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  control.style.visibility = "hidden";
  control.hidden = false;
  positionActivePopover();
  requestAnimationFrame(positionActivePopover);
}

export function installAnnotationSizePopoverDismissal(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        activeControl?.contains(target) ||
        activeAnchor?.contains(target)
      ) {
        return;
      }
      closeAnnotationSizePopover();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeControl) return;
    const anchor = activeAnchor;
    closeAnnotationSizePopover();
    anchor?.focus();
  });
  window.addEventListener("resize", positionActivePopover);
}
