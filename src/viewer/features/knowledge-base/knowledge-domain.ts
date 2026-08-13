
















import { activeKnowledgeFilter, activeKnowledgePageMode } from "../../core/pdf-reader/public";


import { knowledgeDashboardMetricsElement, knowledgeFilterButtons, knowledgeOriginButtons, knowledgeOriginFilterButtons, knowledgePageStatusElement, knowledgeStudentWorkbenchElement, knowledgeWeeklyTasksElement } from "../../app/viewer-elements";






import type { KnowledgeFilter, KnowledgeFocus, KnowledgeItem, KnowledgeKind } from "../../core/pdf-reader/public";
import type { ResolvedReadingMode } from "../../../modules/reading-mode/public";
import { setKnowledgePageMode } from './library-view';
import { renderKnowledgeBase } from './research-controller';
import { normalizeKnowledgeTags, readKnowledgeItemMetaStore, readSavedKnowledgeNotes, writeKnowledgeItemMetaStore, writeSavedKnowledgeNotes } from './knowledge-repository';




export function getKnowledgeKindLabel(kind: KnowledgeKind): string {
  return {
    note: "笔记",
    "reading-card": "阅读卡片",
    "paper-card": "论文卡片",
  }[kind];
}



export function getKnowledgeKindIcon(kind: KnowledgeKind): string {
  return {
    note: "▧",
    "reading-card": "◇",
    "paper-card": "▱",
  }[kind];
}



export function formatKnowledgeDate(value: string, includeTime = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: includeTime ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  }).format(date);
}



export function formatKnowledgeRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000)
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}



export function getKnowledgeExcerpt(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[•*-]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

export function getKnowledgeSourceQuote(
  item: KnowledgeItem | undefined,
): string {
  if (!item) return "";
  const blockquote = item.content.match(/^>\s*(.+)$/m)?.[1]?.trim();
  if (blockquote) return blockquote;
  const originalSection = item.content.match(
    /(?:^|\n)(?:#{1,6}\s*)?原文\s*\n+([^\n#][\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:翻译|单词学习|句子学习|重点词汇|我的判断)\b|$)/,
  )?.[1]?.trim();
  return originalSection?.replace(/\s+/g, " ").slice(0, 500) || "";
}



export function setKnowledgePageStatus(message = "", isError = false): void {
  knowledgePageStatusElement.textContent = message;
  knowledgePageStatusElement.classList.toggle("error", isError);
  knowledgePageStatusElement.hidden = !message;
}




export type KnowledgeOriginFilter = "all" | ResolvedReadingMode;
export type KnowledgeOriginContentFilter = "all" | "reading-card" | "note";

export const activeKnowledgeOrigin: { value: KnowledgeOriginFilter } = { value: "all" };
export const activeKnowledgeOriginContent: { value: KnowledgeOriginContentFilter } = { value: "all" };

export function getKnowledgeOriginContentType(
  item: KnowledgeItem,
): Exclude<KnowledgeOriginContentFilter, "all"> {
  if (item.source === "knowledge-note" || item.source === "summary-note") {
    return "note";
  }
  return "reading-card";
}

export function syncKnowledgeOriginButtons(): void {
  for (const button of knowledgeOriginButtons) {
    button.classList.toggle(
      "active",
      button.dataset.knowledgeOrigin === activeKnowledgeOrigin.value &&
        activeKnowledgeOriginContent.value === "all",
    );
  }

  for (const button of knowledgeOriginFilterButtons) {
    const [origin, content] = (button.dataset.knowledgeOriginFilter || "").split(":");
    button.classList.toggle(
      "active",
      origin === activeKnowledgeOrigin.value &&
        content === activeKnowledgeOriginContent.value,
    );
  }

  for (const button of knowledgeFilterButtons) {
    button.classList.toggle(
      "active",
      button.dataset.knowledgeFilter === "all" && activeKnowledgeOrigin.value === "all",
    );
  }
}

export function resetKnowledgeOriginFilter(): void {
  activeKnowledgeOrigin.value = "all";
  activeKnowledgeOriginContent.value = "all";
  syncKnowledgeOriginButtons();
}

export function setKnowledgeOrigin(
  origin: Exclude<KnowledgeOriginFilter, "all">,
): void {
  activeKnowledgeOrigin.value = origin;
  activeKnowledgeOriginContent.value = "all";
  activeKnowledgeFilter.value = "all";
  if (activeKnowledgePageMode.value !== "library") setKnowledgePageMode("library");
  syncKnowledgeOriginButtons();
  renderKnowledgeBase();
}

export function setKnowledgeOriginContent(
  origin: Exclude<KnowledgeOriginFilter, "all">,
  content: Exclude<KnowledgeOriginContentFilter, "all">,
): void {
  activeKnowledgeOrigin.value = origin;
  activeKnowledgeOriginContent.value = content;
  activeKnowledgeFilter.value = "all";
  if (activeKnowledgePageMode.value !== "library") setKnowledgePageMode("library");
  syncKnowledgeOriginButtons();
  renderKnowledgeBase();
}

export function setKnowledgeFilter(filter: KnowledgeFilter): void {
  activeKnowledgeFilter.value = filter;
  activeKnowledgeOrigin.value = "all";
  activeKnowledgeOriginContent.value = "all";
  if (activeKnowledgePageMode.value !== "library") setKnowledgePageMode("library");
  syncKnowledgeOriginButtons();
  renderKnowledgeBase();
}



export function getKnowledgeBaseDocumentName(label: string): string {
  return label.replace(/\.pdf$/i, "").trim();
}



export function extractKnowledgeYear(item: KnowledgeItem): string {
  const match = [item.title, item.documentName, item.content]
    .join(" ")
    .match(/20\d{2}/);
  return match ? match[0] : "未标注";
}



export function extractKnowledgeVenue(item: KnowledgeItem): string {
  const text = [item.title, item.documentName, item.content].join(" ");
  const venuePatterns = [
    "USENIX",
    "CCS",
    "NDSS",
    "S&P",
    "EUROCRYPT",
    "CRYPTO",
    "IEEE",
    "ACM",
    "AAAI",
    "NeurIPS",
    "ICML",
    "ICLR",
    "TDSC",
  ];
  for (const venue of venuePatterns) {
    if (text.toUpperCase().includes(venue.toUpperCase())) return venue;
  }
  return item.category || "未分类";
}



export function deriveKnowledgeReadingStatus(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  if (/精读中|建议精读|精读/.test(joined)) return "精读中";
  if (/已读完|略读完成|读完|已完成/.test(joined)) return "已读完";
  if (/略读/.test(joined)) return "略读完成";
  if (/待读|待读/.test(joined)) return "待读";
  if (item.kind === "paper-card") return "精读中";
  if (item.kind === "reading-card") return "略读完成";
  return "待读";
}



export function deriveKnowledgePriority(item: KnowledgeItem): string {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  if (/高优先级|建议精读|核心|必读/.test(joined)) return "高优先级";
  if (/中优先级|推荐/.test(joined)) return "中优先级";
  return "常规";
}



export function isKnowledgeCitable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return (
    /可引用|适合引用|引用价值|引用点|研究贡献/.test(joined) ||
    item.kind === "paper-card"
  );
}



export function isKnowledgeReplicable(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return /复现|实验|代码|benchmark|性能评估/i.test(joined);
}



export function isKnowledgeRelatedWork(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return /相关工作|综述|survey|背景/.test(joined);
}



export function isKnowledgeMethodInspiration(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return (
    /方法|思路|灵感|idea|启发|框架|设计/.test(joined) ||
    item.kind === "reading-card"
  );
}



export function matchesKnowledgeFocus(
  item: KnowledgeItem,
  focus: KnowledgeFocus,
): boolean {
  if (focus === "all") return true;
  const status = deriveKnowledgeReadingStatus(item);
  if (focus === "todo") return status === "待读";
  if (focus === "deep") return status === "精读中";
  if (focus === "finished") return status === "已读完" || status === "略读完成";
  if (focus === "citable") return isKnowledgeCitable(item);
  if (focus === "replicate") return isKnowledgeReplicable(item);
  if (focus === "related") return isKnowledgeRelatedWork(item);
  if (focus === "methods") return isKnowledgeMethodInspiration(item);
  return true;
}



export function getKnowledgeCitationScore(item: KnowledgeItem): number {
  const base =
    item.kind === "paper-card" ? 4.2 : item.kind === "reading-card" ? 3.9 : 3.6;
  const bonus = Math.min(
    0.7,
    item.tags.length * 0.08 + (isKnowledgeCitable(item) ? 0.25 : 0),
  );
  return Math.min(5, Math.round((base + bonus) * 10) / 10);
}



export function getKnowledgeRelevancePercent(item: KnowledgeItem): number {
  const base =
    item.kind === "paper-card" ? 78 : item.kind === "reading-card" ? 72 : 65;
  const bonus = Math.min(
    20,
    item.tags.length * 3 + Math.min(12, Math.floor(item.content.length / 120)),
  );
  return Math.min(98, base + bonus);
}



export function getKnowledgeExcerptForDashboard(item: KnowledgeItem): string {
  const excerpt = getKnowledgeExcerpt(item.content).replace(/\s+/g, " ").trim();
  return excerpt || "暂无摘要内容";
}



export function createRatingStars(value: number): string {
  const full = Math.round(value);
  return (
    "★".repeat(Math.max(0, Math.min(5, full))) +
    "☆".repeat(Math.max(0, 5 - full))
  );
}



export function updateKnowledgeItemTags(
  item: KnowledgeItem,
  updater: (tags: string[]) => string[],
): void {
  const now = new Date().toISOString();
  const nextTags = normalizeKnowledgeTags(updater([...item.tags]));
  if (item.source === "knowledge-note") {
    const notes = readSavedKnowledgeNotes().map((note) =>
      note.id === item.id ? { ...note, tags: nextTags, updatedAt: now } : note,
    );
    writeSavedKnowledgeNotes(notes);
  } else {
    const metaStore = readKnowledgeItemMetaStore();
    metaStore[item.recordKey] = {
      ...(metaStore[item.recordKey] || {}),
      tags: nextTags,
      updatedAt: now,
    };
    writeKnowledgeItemMetaStore(metaStore);
  }
}



export function toggleKnowledgeSemanticTag(item: KnowledgeItem, tag: string): void {
  const exists = item.tags.includes(tag);
  updateKnowledgeItemTags(item, (tags) =>
    exists ? tags.filter((candidate) => candidate !== tag) : [...tags, tag],
  );
  setKnowledgePageStatus(exists ? `已取消“${tag}”。` : `已标记为“${tag}”。`);
  renderKnowledgeBase();
}



export function renderKnowledgeMetricCards(
  items: KnowledgeItem[],
  filtered: KnowledgeItem[],
): void {
  if (!knowledgeDashboardMetricsElement) return;
  const now = Date.now();
  const withinWeek = filtered.filter(
    (item) =>
      now - new Date(item.updatedAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );
  const metrics = [
    {
      icon: "📘",
      title: "本周精读",
      value: String(
        withinWeek.filter(
          (item) => deriveKnowledgeReadingStatus(item) === "精读中",
        ).length,
      ),
      unit: "篇",
      hint: `本周更新 ${withinWeek.length}`,
    },
    {
      icon: "❝",
      title: "可引用论文",
      value: String(filtered.filter(isKnowledgeCitable).length),
      unit: "篇",
      hint: "适合写相关工作/论文引用",
    },
    {
      icon: "⚗",
      title: "待复现实验",
      value: String(filtered.filter(isKnowledgeReplicable).length),
      unit: "篇",
      hint: "建议整理代码与实验清单",
    },
    {
      icon: "💡",
      title: "研究灵感",
      value: String(filtered.filter(isKnowledgeMethodInspiration).length),
      unit: "条",
      hint: "方法、设计与启发",
    },
    {
      icon: "🗂",
      title: "知识库总量",
      value: String(items.length),
      unit: "条",
      hint: `覆盖 ${new Set(items.map((item) => item.documentName)).size} 篇文档`,
    },
  ];
  const cards = metrics.map((metric) => {
    const article = document.createElement("article");
    article.className = "knowledge-metric-card";
    article.innerHTML = `
      <div class="knowledge-metric-icon" aria-hidden="true">${metric.icon}</div>
      <div class="knowledge-metric-body">
        <span>${metric.title}</span>
        <strong>${metric.value}<em>${metric.unit}</em></strong>
        <small>${metric.hint}</small>
      </div>
    `;
    return article;
  });
  knowledgeDashboardMetricsElement.replaceChildren(...cards);
}



export function renderKnowledgeStudentPanels(filtered: KnowledgeItem[]): void {
  if (knowledgeStudentWorkbenchElement) {
    const cards = [
      {
        title: "必读清单",
        desc: "把高价值、与研究方向高度相关的论文先排出来。",
        count: filtered.filter(
          (item) => deriveKnowledgePriority(item) === "高优先级",
        ).length,
        label: "待完成",
      },
      {
        title: "可引用观点",
        desc: "优先收集可直接写进相关工作和论文背景的观点。",
        count: filtered.filter(isKnowledgeCitable).length,
        label: "可引用",
      },
      {
        title: "方法对比",
        desc: "比较方法假设、性能、适用场景与局限。",
        count: Math.max(
          1,
          Math.min(
            filtered.length,
            new Set(filtered.map((item) => item.category)).size,
          ),
        ),
        label: "待对比",
      },
      {
        title: "复现实验计划",
        desc: "把需要复现的论文转成实验任务清单。",
        count: filtered.filter(isKnowledgeReplicable).length,
        label: "进行中",
      },
    ];
    const workbench = cards.map((card) => {
      const article = document.createElement("article");
      article.className = "knowledge-workbench-card";
      article.innerHTML = `
        <strong>${card.title}</strong>
        <p>${card.desc}</p>
        <footer><span>${card.label} ${card.count}</span><button type="button">→</button></footer>
      `;
      return article;
    });
    knowledgeStudentWorkbenchElement.replaceChildren(...workbench);
  }

  if (knowledgeWeeklyTasksElement) {
    const tasks = [
      {
        title: "精读 3 篇论文并完成笔记",
        current: Math.min(
          3,
          filtered.filter(
            (item) => deriveKnowledgeReadingStatus(item) === "精读中",
          ).length,
        ),
        total: 3,
      },
      {
        title: "整理可引用观点",
        current: Math.min(10, filtered.filter(isKnowledgeCitable).length),
        total: 10,
      },
      {
        title: "复现实验：补齐实验计划",
        current: Math.min(2, filtered.filter(isKnowledgeReplicable).length),
        total: 2,
      },
      {
        title: "更新相关工作综述",
        current: Math.min(1, filtered.filter(isKnowledgeRelatedWork).length),
        total: 1,
      },
    ];
    const nodes = tasks.map((task) => {
      const row = document.createElement("div");
      row.className = "knowledge-task-row";
      const percent = task.total
        ? Math.max(
            0,
            Math.min(100, Math.round((task.current / task.total) * 100)),
          )
        : 0;
      row.innerHTML = `
        <div class="knowledge-task-copy">
          <label><input type="checkbox" ${task.current >= task.total ? "checked" : ""} /> <span>${task.title}</span></label>
          <small>${task.current}/${task.total}</small>
        </div>
        <div class="knowledge-task-progress"><span style="width:${percent}%"></span></div>
      `;
      return row;
    });
    knowledgeWeeklyTasksElement.replaceChildren(...nodes);
  }
}
