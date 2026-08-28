import { browser } from 'wxt/browser';

const SIDEPANEL_FIRST_RUN_SEEN_KEY = 'pdfpal-sidepanel-first-run-seen-v1';

export const SIDEPANEL_FIRST_RUN_SEEN_MESSAGE = 'pdfpal:sidepanel-first-run-seen';

export async function hasSeenSidepanelFirstRun(): Promise<boolean> {
  const stored = await browser.storage.local.get(SIDEPANEL_FIRST_RUN_SEEN_KEY);
  return stored[SIDEPANEL_FIRST_RUN_SEEN_KEY] === true;
}

export async function markSidepanelFirstRunSeen(): Promise<void> {
  await browser.storage.local.set({ [SIDEPANEL_FIRST_RUN_SEEN_KEY]: true });

  const behaviorUpdates: Promise<unknown>[] = [
    browser.runtime.sendMessage({ type: SIDEPANEL_FIRST_RUN_SEEN_MESSAGE }),
  ];
  if (browser.sidePanel?.setPanelBehavior) {
    behaviorUpdates.push(
      browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
    );
  }

  await Promise.allSettled(behaviorUpdates);
}

export function isSidepanelFirstRunSeenMessage(
  message: unknown,
): message is { type: typeof SIDEPANEL_FIRST_RUN_SEEN_MESSAGE } {
  if (!message || typeof message !== 'object') return false;
  return (message as { type?: unknown }).type === SIDEPANEL_FIRST_RUN_SEEN_MESSAGE;
}
