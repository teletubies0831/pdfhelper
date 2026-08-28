import { browser } from "wxt/browser";

const ONBOARDING_SEEN_KEY = "pdfpal-onboarding-seen-v1";

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(ONBOARDING_SEEN_KEY);
    return stored[ONBOARDING_SEEN_KEY] === true;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await browser.storage.local.set({ [ONBOARDING_SEEN_KEY]: true });
  } catch {
    // The tour remains usable for the current page if storage is unavailable.
  }
}
