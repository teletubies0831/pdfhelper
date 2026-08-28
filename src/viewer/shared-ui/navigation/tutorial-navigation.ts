import { browser } from 'wxt/browser';

const TUTORIAL_WINDOW_WIDTH = 1120;
const TUTORIAL_WINDOW_HEIGHT = 820;

export async function openTutorialWindow(): Promise<void> {
  await browser.windows.create({
    url: browser.runtime.getURL('/tutorial.html'),
    type: 'popup',
    width: TUTORIAL_WINDOW_WIDTH,
    height: TUTORIAL_WINDOW_HEIGHT,
    focused: true,
  });
}
