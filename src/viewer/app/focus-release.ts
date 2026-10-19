/**
 * Getting focus out of a region just before it is hidden.
 *
 * Chromium refuses to apply `aria-hidden="true"` to an ancestor of the focused element and logs
 * "Blocked aria-hidden on an element because its descendant retained focus" — which is exactly what happens when a
 * 返回 button inside a sliding-away settings screen keeps focus after the click that navigated away. The block is
 * correct: hiding the focused element from assistive technology would drop the caret into nowhere.
 *
 * So the element is blurred first. Focus lands on `<body>`, which is where it would be after any page transition
 * anyway, and the region can then be hidden for real. Callers must run this **before** the `aria-hidden` write, not
 * after it: once the attribute is on, the browser has already complained.
 *
 * App-level rather than feature-level because both workspace switching and the settings panels need it.
 */
export function releaseFocusBeforeHiding(region: HTMLElement | null | undefined): void {
  if (!region) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && region.contains(active)) active.blur();
}
