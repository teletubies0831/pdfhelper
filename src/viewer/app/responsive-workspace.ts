/** Collapse sidebars when space runs out, and restore the desktop state on return. */
export function initializeResponsiveWorkspace(): void {
  const frame = document.querySelector<HTMLElement>('.app-frame');
  if (!frame) return;
  const setCollapsed = (side: 'left' | 'right', collapsed: boolean): void => {
    frame.classList.toggle(`${side}-panel-collapsed`, collapsed);
    const toggle = document.getElementById(side === 'left' ? 'outline-toggle' : 'assistant-panel-toggle');
    toggle?.classList.toggle('active', !collapsed);
    toggle?.setAttribute('aria-expanded', String(!collapsed));
  };
  for (const [side, query] of [['left', '(max-width: 1180px)'], ['right', '(max-width: 800px)']] as const) {
    const media = window.matchMedia(query);
    let desktopCollapsed = frame.classList.contains(`${side}-panel-collapsed`);
    const apply = (): void => {
      if (media.matches) {
        desktopCollapsed = frame.classList.contains(`${side}-panel-collapsed`);
        setCollapsed(side, true);
      } else {
        setCollapsed(side, desktopCollapsed);
      }
    };
    if (media.matches) apply();
    media.addEventListener('change', apply);
  }
  frame.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const side = event.target.closest('#outline-toggle') ? 'left'
      : event.target.closest('#assistant-panel-toggle') ? 'right' : undefined;
    if (!side) return;
    const collapsed = frame.classList.contains(`${side}-panel-collapsed`);
    setCollapsed(side, collapsed);
    if (window.matchMedia('(max-width: 800px)').matches && !collapsed) {
      setCollapsed(side === 'left' ? 'right' : 'left', true);
    }
  });
}
