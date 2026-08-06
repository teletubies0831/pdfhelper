import { browser } from "wxt/browser";

import type {
  CcfLookupRequest,
  CcfLookupResponse,
  CcfRank,
  CcfRankResult,
} from "../../shared/research";

export type { CcfRank, CcfRankResult } from "../../shared/research";

const CCF_INDEX_URL = "https://www.ccf.org.cn/Academic_Evaluation/By_category/";

export async function resolveCcfRank(
  venue: string,
  force = false,
): Promise<CcfRankResult> {
  const cleaned = venue.trim();
  if (!cleaned) {
    return {
      status: "not-listed",
      venue: cleaned,
      sourceUrl: CCF_INDEX_URL,
      checkedAt: Date.now(),
    };
  }
  try {
    const response = await browser.runtime.sendMessage({
      type: "pdf-helper:research-ccf",
      venue: cleaned,
      force,
    } satisfies CcfLookupRequest) as CcfLookupResponse | undefined;
    if (response?.ok) return response.result;
    return {
      status: "unavailable",
      venue: cleaned,
      sourceUrl: CCF_INDEX_URL,
      checkedAt: Date.now(),
    };
  }
  catch {
    return {
      status: "unavailable",
      venue: cleaned,
      sourceUrl: CCF_INDEX_URL,
      checkedAt: Date.now(),
    };
  }
}

export function renderCcfRankResult(
  element: HTMLElement,
  result: CcfRankResult,
): void {
  element.classList.remove(
    "ccf-rank-loading",
    "ccf-rank-verified",
    "ccf-rank-not-listed",
    "ccf-rank-unavailable",
    "ccf-rank-a",
    "ccf-rank-b",
    "ccf-rank-c",
  );
  element.classList.add(`ccf-rank-${result.status}`);
  element.textContent = result.status === "verified" && result.rank
    ? `CCF ${result.rank}`
    : result.status === "not-listed"
      ? "CCF未收录"
      : "CCF暂无法核验";
  if (result.status === "verified" && result.rank) {
    element.classList.add(`ccf-rank-${result.rank.toLowerCase()}`);
  }
  const sourceLabel = result.sourceKind === "pdf"
    ? "CCF官方PDF"
    : result.sourceKind === "html"
      ? "CCF官方网页目录"
      : result.sourceKind === "official-snapshot"
        ? "CCF官方网络与信息安全目录快照"
        : "CCF官方目录";
  element.title = result.status === "verified"
    ? `${sourceLabel}核验：${result.matchedText ?? result.venue}`
    : result.status === "not-listed"
      ? "已查询CCF官方目录，未找到可靠匹配。"
      : "CCF官方目录暂时无法访问，未使用AI或常识猜测。";
  if (element instanceof HTMLAnchorElement) {
    element.href = result.sourceUrl || CCF_INDEX_URL;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
  }
}

export function installCurrentPaperCcfRank(): void {
  const page = document.getElementById("paper-card-page");
  const venueInput = document.getElementById("paper-venue-year") as HTMLInputElement | null;
  const output = document.getElementById("paper-ccf-rank");
  if (!page || !venueInput || !output) return;

  let timer: number | undefined;
  let lastVenue = "";
  const schedule = (force = false): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (page.hidden) return;
      const venue = venueInput.value.trim();
      if (!venue) {
        output.textContent = "待填写会议/期刊";
        return;
      }
      if (!force && venue === lastVenue) return;
      lastVenue = venue;
      output.textContent = "CCF官网核验中…";
      output.className = "paper-card-ccf-rank ccf-rank-loading";
      renderCcfRankResult(output, await resolveCcfRank(venue, force));
    }, 350);
  };

  venueInput.addEventListener("change", () => schedule(true));
  document.getElementById("regenerate-paper-card")?.addEventListener("click", () => {
    lastVenue = "";
    window.setTimeout(() => schedule(true), 1200);
  });
  const observer = new MutationObserver(() => {
    if (!page.hidden) schedule(false);
  });
  observer.observe(page, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["hidden"],
  });
  schedule(false);
}
