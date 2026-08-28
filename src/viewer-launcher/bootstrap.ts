import { browser } from 'wxt/browser';

const statusElement = document.querySelector<HTMLElement>('#status');
const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const startButtonLabel = document.querySelector<HTMLElement>('#start-button-label');

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

}

async function handleOpenViewer(): Promise<void> {
  if (!startButton || !startButtonLabel) return;
  startButton.disabled = true;
  startButtonLabel.textContent = '正在打开…';
  statusElement?.classList.remove('is-error');
  if (statusElement) statusElement.textContent = '正在进入 PDFPal 阅读工作区';

  try {
    await openViewer();
    startButton.disabled = false;
    startButtonLabel.textContent = '返回 PDFPal';
    if (statusElement) statusElement.textContent = '阅读器已打开，侧边栏会继续保留';
  } catch (error: unknown) {
    console.error('打开 PDFPal 失败：', error);
    startButton.disabled = false;
    startButtonLabel.textContent = '重新尝试';
    if (statusElement) {
      statusElement.classList.add('is-error');
      statusElement.textContent = '打开失败，请在扩展管理页重新加载后再试。';
    }
  }
}

if (startButton && startButtonLabel) {
  startButton.addEventListener('click', () => {
    void handleOpenViewer();
  });
} else {
  if (statusElement) {
    statusElement.classList.add('is-error');
    statusElement.textContent = '启动按钮加载失败，请重新打开扩展。';
  }
}
