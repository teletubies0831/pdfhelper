import { browser } from 'wxt/browser';

const statusElement = document.querySelector<HTMLElement>('#status');

async function openViewer() {
  const viewerUrl = browser.runtime.getURL('/viewer.html');
  const tabs = await browser.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url?.startsWith(viewerUrl));

  if (existingTab?.id !== undefined) {
    await browser.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: viewerUrl });
  }

  window.close();
}

void openViewer().catch((error: unknown) => {
  console.error('打开 PDFPal 失败：', error);
  if (statusElement) {
    statusElement.textContent = '打开失败，请在扩展管理页重新加载后再试。';
  }
});
