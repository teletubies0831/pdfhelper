
import { browser } from "wxt/browser";
import { editingPaperOverviewId, paperCardPageAbortController, paperCardPageDocumentKey, paperCardPageRequestId, paperCardPageSourceCache, paperCardReturnTarget, paperCardReviewDocumentName } from "../../core/pdf-reader/public";
import { paperCardBackButton, paperCardFormElement, paperCardPageElement, paperCardPageSubtitleElement, paperCardPageTitleElement, regeneratePaperCardButton, returnToPdfButton, savePaperCardPageButton } from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";



import { setPaperCardEditMode } from "./paper-card-inline-editor";
import { schedulePaperCardTextareaRefresh, updatePaperCardDocumentName } from "./paper-card-form-view";
import { setPaperCardPageStatus } from "./paper-card-status";

export function setPaperCardPageMode(mode: "generate" | "review"): void {
  const isReview = mode === "review";
  paperCardPageElement.classList.toggle("review-mode", isReview);
  paperCardPageTitleElement.textContent = isReview
    ? "论文阅读卡片"
    : "论文阅读卡片";
  paperCardPageSubtitleElement.textContent = "";
  paperCardPageSubtitleElement.hidden = true;
  regeneratePaperCardButton.hidden = isReview;
  savePaperCardPageButton.textContent = isReview
    ? "▣ 保存修改"
    : "▣ 加入知识库";
  const returnToKnowledge =
    isReview && paperCardReturnTarget.value === "knowledge";
  const returnLabel = returnToKnowledge ? "← 返回知识库" : "← 返回 PDF";
  returnToPdfButton.textContent = returnToKnowledge ? "关闭" : returnLabel;
  returnToPdfButton.setAttribute(
    "aria-label",
    returnToKnowledge ? "关闭论文卡片" : "返回 PDF",
  );
  paperCardBackButton.textContent = returnLabel;
  paperCardBackButton.setAttribute(
    "aria-label",
    returnToKnowledge ? "返回知识库" : "返回 PDF",
  );
  setPaperCardEditMode(false);
}

export function clearPaperCardReviewState(): void {
  editingPaperOverviewId.value = null;
  paperCardReviewDocumentName.value = "";
  paperCardReturnTarget.value = "pdf";
  setPaperCardPageMode("generate");
}

export function cancelActivePaperOverviewRequest(): void {
  const requestId = paperCardPageRequestId.value;
  paperCardPageRequestId.value = "";
  if (!requestId) return;

  void browser.runtime
    .sendMessage({
      type: "pdf-helper:ai-cancel-paper-overview",
      requestId,
    })
    .catch(() => {
      // 扩展后台可能正在重新加载；本地状态仍然必须立即恢复。
    });
}

export function resetPaperCardPageState(): void {
  paperCardPageAbortController.value?.abort();
  cancelActivePaperOverviewRequest();
  paperCardPageAbortController.value = null;
  paperCardPageDocumentKey.value = "";
  paperCardPageSourceCache.value = null;
  paperCardFormElement.reset();
  paperCardFormElement.classList.remove("generating");
  delete paperCardFormElement.dataset.paperReady;
  document.dispatchEvent(
    new CustomEvent("pdf-helper:paper-card-reset", {
      detail: {
        documentName: sourceName.value ? getDisplayFileName(sourceName.value) : "",
      },
    }),
  );
  setPaperCardEditMode(false);
  regeneratePaperCardButton.disabled = false;
  setPaperCardPageStatus();
  if (!editingPaperOverviewId.value) updatePaperCardDocumentName();
  schedulePaperCardTextareaRefresh();
}
