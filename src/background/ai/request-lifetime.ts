import { browser } from 'wxt/browser';

/** Keep a pending AI job alive through provider cooldowns; stop as soon as it settles. */
export async function withAiRequestLifetime<T>(run: () => Promise<T>): Promise<T> {
  const keepAlive = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {});
  }, 20_000);
  try {
    return await run();
  } finally {
    clearInterval(keepAlive);
  }
}
