import { browser } from 'wxt/browser';

import {
  ACTION_LABELS,
  SELECTION_STORAGE_KEY,
  isSelectionAction,
  type SelectionAction,
  type SelectionRequest,
} from '../shared/selection';
import { extractPdfSource } from '../shared/pdf-source';

const MENU_ROOT_ID = 'pdf-helper-selection';
const MENU_PREFIX = 'pdf-helper-action-';

async function registerContextMenus() {
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

async function saveSelection(
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

async function configureSidePanel(tabId: number, tabUrl?: string) {
  const isEnhancedViewer = tabUrl?.startsWith(browser.runtime.getURL('/viewer.html'));
  const enabled = Boolean(extractPdfSource(tabUrl) || isEnhancedViewer);

  await browser.sidePanel.setOptions({
    tabId,
    enabled,
    path: '/sidepanel.html',
  });
}

export default defineBackground(() => {
  void registerContextMenus();

  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      void configureSidePanel(tabId, tab.url);
    }
  });

  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await browser.tabs.get(tabId);
    await configureSidePanel(tabId, tab.url);
  });

  void browser.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab?.id !== undefined) return configureSidePanel(tab.id, tab.url);
    });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
      typeof info.menuItemId !== 'string' ||
      !info.menuItemId.startsWith(MENU_PREFIX) ||
      !info.selectionText
    ) {
      return;
    }

    const action = info.menuItemId.slice(MENU_PREFIX.length);
    if (!isSelectionAction(action)) return;

    const pdfSource = extractPdfSource(tab?.url);
    if (!pdfSource && !tab?.url?.startsWith(browser.runtime.getURL('/viewer.html'))) {
      return;
    }

    await saveSelection(action, info.selectionText, tab);

    if (tab?.id !== undefined) {
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });
});
