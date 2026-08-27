export type SettingsPrimaryPanelName =
  | 'general'
  | 'models'
  | 'tools'
  | 'memory';

const PANEL_ORDER: SettingsPrimaryPanelName[] = [
  'general',
  'models',
  'tools',
  'memory',
];

let transitionToken = 0;
let runningAnimations: Animation[] = [];

function panelFor(
  panels: HTMLElement[],
  name: SettingsPrimaryPanelName,
): HTMLElement | undefined {
  return panels.find((panel) => panel.dataset.settingsPanel === name);
}

function settlePanels(
  container: HTMLElement,
  panels: HTMLElement[],
  visibleName: SettingsPrimaryPanelName,
): void {
  for (const animation of runningAnimations) animation.cancel();
  runningAnimations = [];
  container.classList.remove('is-primary-transitioning');
  for (const panel of panels) {
    const visible = panel.dataset.settingsPanel === visibleName;
    panel.hidden = !visible;
    panel.inert = !visible;
    panel.toggleAttribute('aria-hidden', !visible);
  }
}

export function showSettingsPrimaryPanel(
  container: HTMLElement,
  panels: HTMLElement[],
  from: SettingsPrimaryPanelName,
  to: SettingsPrimaryPanelName,
  animate = true,
): void {
  transitionToken += 1;
  settlePanels(container, panels, from);
  container.scrollTop = 0;

  const outgoing = panelFor(panels, from);
  const incoming = panelFor(panels, to);
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  if (!animate || from === to || !outgoing || !incoming || reduceMotion) {
    settlePanels(container, panels, to);
    return;
  }

  const token = transitionToken;
  const direction = PANEL_ORDER.indexOf(to) > PANEL_ORDER.indexOf(from) ? 1 : -1;
  outgoing.hidden = false;
  incoming.hidden = false;
  outgoing.inert = true;
  incoming.inert = false;
  outgoing.setAttribute('aria-hidden', 'true');
  incoming.removeAttribute('aria-hidden');
  container.classList.add('is-primary-transitioning');

  const timing: KeyframeAnimationOptions = {
    duration: 300,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'both',
  };
  runningAnimations = [
    outgoing.animate(
      [
        { transform: 'translate3d(0, 0, 0) rotateY(0deg)', opacity: 1 },
        {
          transform: `translate3d(${-direction * 24}%, 0, 0) rotateY(${direction * 1.5}deg)`,
          opacity: 0,
        },
      ],
      timing,
    ),
    incoming.animate(
      [
        {
          transform: `translate3d(${direction * 24}%, 0, 0) rotateY(${-direction * 1.5}deg)`,
          opacity: 0,
        },
        { transform: 'translate3d(0, 0, 0) rotateY(0deg)', opacity: 1 },
      ],
      timing,
    ),
  ];

  void Promise.allSettled(
    runningAnimations.map((animation) => animation.finished),
  ).then(() => {
    if (token !== transitionToken) return;
    settlePanels(container, panels, to);
  });
}
