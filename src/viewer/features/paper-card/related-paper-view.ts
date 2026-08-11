import { renderCcfRankResult } from "./ccf-controller";
import { runRelatedResearch, type RelatedPaper } from "../../../modules/research/public";

const UI = {
  title: "近期高质量相关工作",
  waiting: "等待当前论文卡片生成完成后检索相关工作…",
  loading: "正在根据当前论文标题、关键词和研究领域检索相关工作…",
  empty: "暂未找到与当前论文同时满足质量和相关性要求的结果。",
  error: "当前论文的相关工作检索失败，请检查网络后重试。",
  refresh: "刷新",
};

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getSection(): { section: HTMLElement; result: HTMLElement } | null {
  const comparisonField = document.getElementById(
    "paper-comparison-prior-work",
  ) as HTMLTextAreaElement | null;
  if (!comparisonField) return null;
  const section = comparisonField.closest<HTMLElement>(".paper-card-side-card") ??
    comparisonField.closest<HTMLElement>("section");
  if (!section) return null;

  section.classList.add("online-related-paper-section");
  comparisonField.closest<HTMLElement>("label")?.setAttribute("hidden", "");
  section.querySelector("h2")?.setAttribute("hidden", "");

  let toolbar = section.querySelector<HTMLElement>(
    ".online-related-paper-toolbar",
  );
  if (!toolbar) {
    toolbar = create("div", "online-related-paper-toolbar");
    const button = create("button", "online-related-paper-refresh", UI.refresh);
    button.type = "button";
    button.dataset.relatedRefresh = "true";
    toolbar.append(create("strong", "", UI.title), button);
    section.prepend(toolbar);
  }

  let result = section.querySelector<HTMLElement>(
    ".online-related-paper-result",
  );
  if (!result) {
    result = create("div", "online-related-paper-result");
    section.append(result);
  }
  return { section, result };
}

function renderStatus(
  result: HTMLElement,
  text: string,
  error = false,
): void {
  result.replaceChildren(
    create(
      "div",
      `online-related-paper-status${error ? " error" : ""}`,
      text,
    ),
  );
}

function relationLabel(paper: RelatedPaper): string {
  if (paper.recommendationSeed && paper.relevance >= 0.45) return "直接推荐";
  if (paper.relevance >= 0.58) return "高度相关";
  if (paper.year && paper.year >= new Date().getFullYear() - 2) return "近期跟进";
  return "同类方法";
}

function regionLabel(paper: RelatedPaper): string {
  return paper.region === "domestic" ? "国内来源" : "国际来源";
}

function sourceLabel(paper: RelatedPaper): string {
  const sources = paper.sources.length > 0 ? paper.sources : [paper.source];
  return sources.slice(0, 2).join(" + ");
}

function renderPapers(
  result: HTMLElement,
  papers: RelatedPaper[],
  diagnostics?: {
    queries: string[];
    sourceCounts: Record<string, number>;
    currentPaperMatched: boolean;
    ccfDirectorySource: string;
  },
): void {
  result.replaceChildren();
  if (papers.length === 0) {
    renderStatus(result, UI.empty);
    return;
  }

  const list = create("div", "online-related-paper-list");
  papers.forEach((paper, index) => {
    const article = create("article", "online-related-paper-item");
    const top = create("div", "online-related-paper-top");
    const left = create("div", "online-related-paper-top-left");
    left.append(
      create("span", "online-related-paper-order", String(index + 1)),
      create("span", "online-related-paper-label", relationLabel(paper)),
      create(
        "span",
        `online-related-paper-region region-${paper.region}`,
        regionLabel(paper),
      ),
    );
    top.append(left, create("span", "online-related-paper-source", sourceLabel(paper)));

    const title = create("a", "online-related-paper-title", paper.title);
    title.href = paper.url || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";

    const metaRow = create("div", "online-related-paper-meta-row");
    metaRow.append(
      create(
        "span",
        "online-related-paper-meta",
        [paper.venue, paper.year].filter(Boolean).join(" · ") || "发表场所待核验",
      ),
    );
    const ccf = create(
      "a",
      "online-related-paper-ccf ccf-rank-loading",
      "CCF核验中…",
    );
    renderCcfRankResult(ccf, {
      status: paper.ccfStatus,
      rank: paper.ccfRank,
      venue: paper.venue,
      sourceUrl: paper.ccfSourceUrl,
      sourceKind: paper.ccfSourceKind,
      checkedAt: Date.now(),
    });
    metaRow.append(ccf);

    const evidenceParts = [
      `相关度 ${Math.round(paper.relevance * 100)}%`,
      `共同主题 ${paper.overlap} 个`,
      paper.citationCount > 0 ? `引用 ${paper.citationCount} 次` : "",
    ].filter(Boolean);

    article.append(
      top,
      title,
      metaRow,
      create("p", "online-related-paper-reason", evidenceParts.join("；")),
    );
    list.append(article);
  });

  const sourceSummary = diagnostics
    ? Object.entries(diagnostics.sourceCounts)
        .filter(([, count]) => count > 0)
        .map(([source, count]) => `${source} ${count}`)
        .join("、")
    : "Semantic Scholar、OpenAlex、DBLP、Crossref";
  const footer = create(
    "div",
    "online-related-paper-footer",
    [
      `来源：${sourceSummary}`,
      "排序：CCF/场所质量 → 相关度 → 时间",
      diagnostics?.currentPaperMatched
        ? "已使用当前论文的 Semantic Scholar 推荐图"
        : "未匹配到当前论文ID，已使用多查询检索",
      `更新于 ${new Date().toLocaleString()}`,
    ].join("；"),
  );
  result.append(list, footer);
}

async function load(force = false): Promise<void> {
  const page = document.getElementById("paper-card-page");
  if (!page || page.hidden) return;
  const title = (
    document.getElementById("paper-title") as HTMLInputElement | null
  )?.value.trim() ?? "";
  const keywords = (
    document.getElementById("paper-keywords") as HTMLInputElement | null
  )?.value.trim() ?? "";
  const researchArea = (
    document.getElementById("paper-research-area") as HTMLInputElement | null
  )?.value.trim() ?? "";

  const target = getSection();
  if (!target) return;
  if (!title) {
    renderStatus(target.result, UI.waiting);
    return;
  }
  renderStatus(target.result, UI.loading);

  const response = await runRelatedResearch({
    title,
    keywords,
    researchArea,
    force,
  });
  if (!response.ok) {
    console.error("[PDF Helper] LangGraph research failed", response.error);
    renderStatus(target.result, `${UI.error} ${response.error}`, true);
    return;
  }
  renderPapers(target.result, response.papers, response.diagnostics);
}

export function installOnlineRelatedPapers(): void {
  let timer: number | undefined;
  let lastKey = "";

  const schedule = (force = false): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const title = (
        document.getElementById("paper-title") as HTMLInputElement | null
      )?.value.trim() ?? "";
      const keywords = (
        document.getElementById("paper-keywords") as HTMLInputElement | null
      )?.value.trim() ?? "";
      const researchArea = (
        document.getElementById("paper-research-area") as HTMLInputElement | null
      )?.value.trim() ?? "";
      const key = `${title}\u0000${keywords}\u0000${researchArea}`;
      if (!title) {
        lastKey = "";
        const target = getSection();
        if (target) renderStatus(target.result, UI.waiting);
        return;
      }
      if (!force && key === lastKey) return;
      lastKey = key;
      void load(force);
    }, 550);
  };

  const initialize = (): void => {
    const page = document.getElementById("paper-card-page");
    if (!page) return;

    const initialTarget = getSection();
    if (initialTarget) renderStatus(initialTarget.result, UI.waiting);

    document.addEventListener("pdf-helper:paper-card-reset", () => {
      lastKey = "";
      window.clearTimeout(timer);
      const target = getSection();
      if (target) renderStatus(target.result, UI.waiting);
    });

    document.addEventListener("pdf-helper:paper-card-ready", () => {
      lastKey = "";
      schedule(true);
    });

    page.addEventListener("click", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-related-refresh]")
      ) {
        lastKey = "";
        schedule(true);
      }
    });
    document.getElementById("regenerate-paper-card")?.addEventListener("click", () => {
      lastKey = "";
      window.setTimeout(() => schedule(true), 1500);
    });
    for (const id of ["paper-title", "paper-keywords", "paper-research-area"]) {
      document.getElementById(id)?.addEventListener("change", () => {
        lastKey = "";
        schedule(true);
      });
    }
    const observer = new MutationObserver(() => {
      if (!page.hidden) schedule(false);
    });
    observer.observe(page, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
    schedule(false);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  }
  else {
    initialize();
  }
}
