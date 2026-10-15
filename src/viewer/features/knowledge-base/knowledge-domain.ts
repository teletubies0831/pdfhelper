



















import { knowledgeDashboardMetricsElement, knowledgeFilterButtons, knowledgeOriginButtons, knowledgeOriginFilterButtons, knowledgePageStatusElement, knowledgeStudentWorkbenchElement, knowledgeWeeklyTasksElement } from "../../app/viewer-elements";






import type { KnowledgeFilter, KnowledgeFocus, KnowledgeKind } from "../../core/pdf-reader/public";
import type { ResolvedReadingMode } from "../../../modules/reading-mode/public";
import { activeKnowledgeFilter, KnowledgeItem } from "../../app/public";

import { renderKnowledgeBase } from './knowledge-base-controller';
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



// Excerpt formatting moved to the app assembly layer (app/knowledge-excerpt).
export { getKnowledgeExcerpt } from "../../app/knowledge-excerpt";

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
  syncKnowledgeOriginButtons();
  renderKnowledgeBase();
}

export function setKnowledgeFilter(filter: KnowledgeFilter): void {
  activeKnowledgeFilter.value = filter;
  activeKnowledgeOrigin.value = "all";
  activeKnowledgeOriginContent.value = "all";
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



















export function isKnowledgeRelatedWork(item: KnowledgeItem): boolean {
  const joined = [item.category, ...item.tags, item.content].join(" ");
  return /相关工作|综述|survey|背景/.test(joined);
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








