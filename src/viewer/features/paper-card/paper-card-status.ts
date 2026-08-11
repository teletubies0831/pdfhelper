


import { paperCardPageStatusElement } from "../../app/viewer-elements";








export interface PaperCardPageStatusOptions {
  persistent?: boolean;
  hideAfterMs?: number;
}

export let paperCardPageStatusTimer: number | undefined;

export let paperCardPageStatusFadeTimer: number | undefined;

export function hidePaperCardPageStatus(message: string): void {
  if (paperCardPageStatusElement.textContent !== message) return;

  paperCardPageStatusElement.classList.add("fading");
  window.clearTimeout(paperCardPageStatusFadeTimer);
  paperCardPageStatusFadeTimer = window.setTimeout(() => {
    if (paperCardPageStatusElement.textContent !== message) return;
    paperCardPageStatusElement.textContent = "";
    paperCardPageStatusElement.classList.remove("error", "fading");
    paperCardPageStatusElement.hidden = true;
  }, 260);
}

export function setPaperCardPageStatus(
  message = "",
  isError = false,
  options: PaperCardPageStatusOptions = {},
): void {
  window.clearTimeout(paperCardPageStatusTimer);
  window.clearTimeout(paperCardPageStatusFadeTimer);
  paperCardPageStatusElement.classList.remove("fading");
  paperCardPageStatusElement.textContent = message;
  paperCardPageStatusElement.classList.toggle("error", isError);
  paperCardPageStatusElement.classList.toggle(
    "persistent",
    Boolean(message && options.persistent),
  );
  paperCardPageStatusElement.hidden = !message;

  if (!message || options.persistent) return;

  const hideAfterMs =
    options.hideAfterMs ?? (isError ? 9000 : 5000);
  paperCardPageStatusTimer = window.setTimeout(
    () => hidePaperCardPageStatus(message),
    hideAfterMs,
  );
}

export function finishPaperCardGenerationStatus(): void {
  // 等待文本框高度、CCF 和卡片布局完成两轮重排后再提示完成。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setPaperCardPageStatus(
        "论文阅读卡片已完整生成。",
        false,
        { hideAfterMs: 1600 },
      );
    });
  });
}
