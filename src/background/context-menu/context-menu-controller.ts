import { browser } from "wxt/browser";

import { ACTION_LABELS, SELECTION_STORAGE_KEY, type SelectionAction, type SelectionRequest } from "../../../shared/selection";









export const MENU_ROOT_ID = 'pdf-helper-selection';

export const MENU_PREFIX = 'pdf-helper-action-';

export const PAPER_OVERVIEW_TIMEOUT_MS = 120_000;

export const paperOverviewRequestControllers = new Map<string, AbortController>();


export async function registerContextMenus() {
  await browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: MENU_ROOT_ID,
    title: '发送给 PDF Helper',
    contexts: ['selection'],
  });

  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    browser.contextMenus.create({
      id: `${MENU_PREFIX}${action}`,
      parentId: MENU_ROOT_ID,
      title: label,
      contexts: ['selection'],
    });
  }
}


export async function saveSelection(
  action: SelectionAction,
  text: string,
  tab?: { title?: string; url?: string },
) {
  const request: SelectionRequest = {
    id: crypto.randomUUID(),
    action,
    text: text.trim(),
    pageTitle: tab?.title,
    pageUrl: tab?.url,
    createdAt: Date.now(),
  };

  await browser.storage.local.set({ [SELECTION_STORAGE_KEY]: request });
}


export async function openEnhancedViewer() {
  const viewerUrl = browser.runtime.getURL('/viewer.html');
  const tabs = await browser.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url?.startsWith(viewerUrl));

  if (existingTab?.id !== undefined) {
    await browser.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: viewerUrl });
}


export async function openHelperPanelPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('/helper-panel.html') });
}
