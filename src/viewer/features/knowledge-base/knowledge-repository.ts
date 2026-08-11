
















import { KNOWLEDGE_ITEM_META_STORAGE_KEY, KNOWLEDGE_NOTES_STORAGE_KEY, READING_JOURNAL_STORAGE_KEY, resolvedReadingMode } from "../../core/pdf-reader/public";
import { readSavedSummaryNotes } from "../../services/document-agent/viewer-document-agent";
import { formatGeneratedCardText, formatPaperOverviewMarkdown, getCardTypeLabel, readSavedPaperCards, readSavedPaperOverviews } from "../paper-card/public";







import type { KnowledgeItem, KnowledgeItemMetaStore, KnowledgeSource, SavedKnowledgeNote, SavedReadingJournalEntry } from "../../core/pdf-reader/public";
import { knowledgeLibrary, type KnowledgeRecord } from '../../../modules/knowledge/public';





export function readSavedKnowledgeNotes(): SavedKnowledgeNote[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(KNOWLEDGE_NOTES_STORAGE_KEY) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}



export function writeSavedKnowledgeNotes(notes: SavedKnowledgeNote[]): void {
  localStorage.setItem(
    KNOWLEDGE_NOTES_STORAGE_KEY,
    JSON.stringify(notes.slice(0, 500)),
  );
}



export function readReadingJournalEntries(): SavedReadingJournalEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(READING_JOURNAL_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}



export function writeReadingJournalEntries(entries: SavedReadingJournalEntry[]): void {
  localStorage.setItem(READING_JOURNAL_STORAGE_KEY, JSON.stringify(entries));
}



export function readKnowledgeItemMetaStore(): KnowledgeItemMetaStore {
  try {
    const value = JSON.parse(
      localStorage.getItem(KNOWLEDGE_ITEM_META_STORAGE_KEY) || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as KnowledgeItemMetaStore)
      : {};
  } catch {
    return {};
  }
}



export function writeKnowledgeItemMetaStore(store: KnowledgeItemMetaStore): void {
  localStorage.setItem(KNOWLEDGE_ITEM_META_STORAGE_KEY, JSON.stringify(store));
}



export function normalizeKnowledgeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}



export function normalizeKnowledgeCategory(
  value: unknown,
  fallback = "未分类",
): string {
  if (typeof value !== "string") return fallback;

  const parts = value
    .trim()
    .split(/\s*(?:\/|／|,|，|、|;|；|\||｜)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const uniqueParts = Array.from(new Set(parts));
  return uniqueParts.length ? uniqueParts.join(" / ") : fallback;
}



export function getKnowledgeRecordKey(source: KnowledgeSource, id: string): string {
  return `${source}:${id}`;
}



export function parseKnowledgePageNumber(value: string): number | undefined {
  const match = value.match(/第\s*(\d+)\s*页/);
  const pageNumber = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
}



export function applyKnowledgeMeta(
  item: KnowledgeItem,
  store: KnowledgeItemMetaStore,
): KnowledgeItem {
  const meta = store[item.recordKey];
  if (!meta) return item;
  return {
    ...item,
    title: meta.title?.trim() || item.title,
    content: meta.content?.trim() || item.content,
    category: normalizeKnowledgeCategory(meta.category || item.category),
    tags: normalizeKnowledgeTags(meta.tags).length
      ? normalizeKnowledgeTags(meta.tags)
      : item.tags,
    updatedAt: meta.updatedAt || item.updatedAt,
  };
}



export function collectLegacyKnowledgeItems(): KnowledgeItem[] {
  const metaStore = readKnowledgeItemMetaStore();
  const items: KnowledgeItem[] = [];

  for (const note of readSavedKnowledgeNotes()) {
    if (!note || typeof note.id !== "string") continue;
    if ((note.readingMode ?? "paper") !== resolvedReadingMode.value) continue;
    const createdAt =
      typeof note.createdAt === "string"
        ? note.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof note.updatedAt === "string" ? note.updatedAt : createdAt;
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("knowledge-note", note.id),
          id: note.id,
          source: "knowledge-note",
          kind: "note",
          title:
            typeof note.title === "string" && note.title.trim()
              ? note.title.trim()
              : "未命名笔记",
          content: typeof note.content === "string" ? note.content.trim() : "",
          documentName:
            typeof note.documentName === "string" && note.documentName.trim()
              ? note.documentName.trim()
              : "未关联文档",
          pageNumber: Number.isFinite(note.pageNumber)
            ? note.pageNumber
            : undefined,
          positionLabel:
            typeof note.positionLabel === "string" && note.positionLabel.trim()
              ? note.positionLabel.trim()
              : Number.isFinite(note.pageNumber)
                ? `第 ${note.pageNumber} 页`
                : "未定位",
          category:
            typeof note.category === "string" && note.category.trim()
              ? note.category.trim()
              : "AI 笔记",
          tags: normalizeKnowledgeTags(note.tags),
          createdAt,
          updatedAt,
        },
        metaStore,
      ),
    );
  }

  for (const entry of readReadingJournalEntries()) {
    if (!entry || entry.readingMode !== resolvedReadingMode.value) continue;
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("reading-journal", entry.id),
          id: entry.id,
          source: "reading-journal",
          kind: "note",
          title: entry.title || "未命名阅读札记",
          content: [entry.quote ? `> ${entry.quote}` : "", entry.content]
            .filter(Boolean)
            .join("\n\n"),
          documentName: entry.documentName,
          pageNumber: entry.pageNumber,
          positionLabel: entry.positionLabel,
          category: "阅读札记",
          tags: entry.tags,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
        metaStore,
      ),
    );
  }

  for (const note of readSavedSummaryNotes()) {
    if (resolvedReadingMode.value !== "paper") continue;
    if (!note || typeof note.id !== "string") continue;
    const points = Array.isArray(note.points)
      ? note.points.filter(
          (point): point is string =>
            typeof point === "string" && Boolean(point.trim()),
        )
      : [];
    const createdAt =
      typeof note.createdAt === "string"
        ? note.createdAt
        : new Date().toISOString();
    const rangeLabel =
      typeof note.rangeLabel === "string" && note.rangeLabel.trim()
        ? note.rangeLabel.trim()
        : "内容";
    const sourceLabel =
      typeof note.sourceLabel === "string" ? note.sourceLabel : "";
    const positionLabel =
      typeof note.positionLabel === "string" && note.positionLabel.trim()
        ? note.positionLabel.trim()
        : sourceLabel || "未定位";
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("summary-note", note.id),
          id: note.id,
          source: "summary-note",
          kind: "note",
          title: `${rangeLabel}总结`,
          content: points.map((point) => `• ${point.trim()}`).join("\n"),
          documentName:
            typeof note.documentName === "string" && note.documentName.trim()
              ? note.documentName.trim()
              : "未关联文档",
          pageNumber: parseKnowledgePageNumber(sourceLabel),
          positionLabel,
          category: "AI 总结",
          tags: Array.from(new Set(["总结", rangeLabel])).filter(Boolean),
          createdAt,
          updatedAt: createdAt,
        },
        metaStore,
      ),
    );
  }

  for (const card of readSavedPaperCards()) {
    if (resolvedReadingMode.value !== "paper") continue;
    if (!card || typeof card.id !== "string") continue;
    const createdAt =
      typeof card.createdAt === "string"
        ? card.createdAt
        : new Date().toISOString();
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("reading-card", card.id),
          id: card.id,
          source: "reading-card",
          kind: "reading-card",
          title:
            typeof card.title === "string" && card.title.trim()
              ? card.title.trim()
              : "未命名阅读卡片",
          content: formatGeneratedCardText(card, card),
          documentName:
            typeof card.documentName === "string" && card.documentName.trim()
              ? card.documentName.trim()
              : "未关联文档",
          pageNumber: Number.isFinite(card.pageNumber)
            ? card.pageNumber
            : undefined,
          positionLabel:
            typeof card.sourceLocation === "string" &&
            card.sourceLocation.trim()
              ? card.sourceLocation.trim()
              : typeof card.positionLabel === "string"
                ? card.positionLabel
                : "未定位",
          category: "阅读卡片",
          tags: ["AI 卡片", getCardTypeLabel(card.cardType)],
          createdAt,
          updatedAt: createdAt,
        },
        metaStore,
      ),
    );
  }

  for (const card of readSavedPaperOverviews()) {
    if (resolvedReadingMode.value !== "paper") continue;
    if (!card || typeof card.id !== "string") continue;
    const createdAt =
      typeof card.createdAt === "string"
        ? card.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof card.updatedAt === "string" ? card.updatedAt : createdAt;
    const tags = normalizeKnowledgeTags([
      card.researchArea,
      card.readingStatus,
      card.recommendDeepReading,
      card.keywords,
      card.topicTags,
    ]);
    const linkedReadingCards = readSavedPaperCards().filter((item) =>
      item.paperOverviewId === card.id
      || Boolean(card.documentId && item.documentId === card.documentId),
    );
    const linkedCardContent = linkedReadingCards.length
      ? [
          "## 关联阅读卡片",
          ...linkedReadingCards.map((item) => [
            `### ${item.title}`,
            item.explanation,
            `来源：${item.sourceLocation}`,
          ].join("\n")),
        ].join("\n\n")
      : "";
    items.push(
      applyKnowledgeMeta(
        {
          recordKey: getKnowledgeRecordKey("paper-overview", card.id),
          id: card.id,
          source: "paper-overview",
          kind: "paper-card",
          title: card.title?.trim() || card.documentName || "未命名论文卡片",
          content: [formatPaperOverviewMarkdown(card), linkedCardContent]
            .filter(Boolean)
            .join("\n\n"),
          documentName: card.documentName || "未关联文档",
          positionLabel: "整篇论文",
          category: card.researchArea?.trim() || "论文卡片",
          tags: tags.length ? tags : ["论文卡片"],
          createdAt,
          updatedAt,
        },
        metaStore,
      ),
    );
  }

  return items.map((item) => ({
    ...item,
    category: normalizeKnowledgeCategory(item.category),
  }));
}

export function collectKnowledgeItems(): KnowledgeItem[] {
  const readingMode = resolvedReadingMode.value;
  const legacyItems = collectLegacyKnowledgeItems();
  knowledgeLibrary.synchronize(
    readingMode,
    legacyItems as Array<Omit<KnowledgeRecord, 'readingMode'>>,
  );
  return knowledgeLibrary.list(readingMode).map(({ readingMode: _scope, ...item }) =>
    item as KnowledgeItem);
}
