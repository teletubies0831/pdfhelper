


import { paperKeywordsInput, paperResearchAreaInput, paperTitleInput } from "../../app/viewer-elements";
import { sourceName } from "../../app/viewer-state";

import { getDisplayFileName } from "../../core/pdf-reader/public";
import { collectKnowledgeItems, getKnowledgeKindLabel } from "../knowledge-base/public";




export function normalizeKnowledgeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\w\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeKnowledgeSearchText(value: string): string[] {
  const matches: string[] =
    normalizeKnowledgeSearchText(value).match(
      /[a-z0-9\u4e00-\u9fff]{2,}/g,
    ) ?? [];

  return Array.from(
    new Set(matches.filter((token: string) => token.length >= 2)),
  );
}

export function collectRelevantKnowledgeContextForPaper(): string {
  const title = paperTitleInput.value.trim();
  const researchArea = paperResearchAreaInput.value.trim();
  const keywords = paperKeywordsInput.value.trim();
  const currentDocumentName = (
    sourceName.value ? getDisplayFileName(sourceName.value) : ""
  ).trim();

  const queryTokens = new Set(
    tokenizeKnowledgeSearchText(
      [title, researchArea, keywords].filter(Boolean).join(" "),
    ),
  );

  if (queryTokens.size === 0) return "";

  const normalizedTitle = normalizeKnowledgeSearchText(title);
  const normalizedDocumentName = normalizeKnowledgeSearchText(
    currentDocumentName,
  );

  const matches = collectKnowledgeItems()
    .filter((item) => {
      const haystack = [
        item.title,
        item.content,
        item.category,
        item.documentName,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(" ");
      const normalizedHaystack = normalizeKnowledgeSearchText(haystack);
      if (!normalizedHaystack) return false;

      const isSameDocument =
        (normalizedTitle &&
          normalizeKnowledgeSearchText(item.title) === normalizedTitle) ||
        (normalizedDocumentName &&
          normalizeKnowledgeSearchText(item.documentName) ===
            normalizedDocumentName);
      if (isSameDocument) return false;

      let score = 0;
      for (const token of queryTokens) {
        if (normalizedHaystack.includes(token)) {
          score += token.length >= 5 ? 2 : 1;
        }
      }
      return score > 0;
    })
    .map((item) => {
      const haystack = [
        item.title,
        item.content,
        item.category,
        ...(item.tags || []),
      ].join(" ");
      const normalizedHaystack = normalizeKnowledgeSearchText(haystack);
      let score = 0;
      for (const token of queryTokens) {
        if (normalizedHaystack.includes(token)) {
          score += token.length >= 5 ? 2 : 1;
        }
      }
      if (item.kind === "paper-card") score += 2;
      if (item.kind === "reading-card") score += 1;
      return { item, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (matches.length === 0) return "";

  return matches
    .map(({ item }, index) => {
      const excerpt = item.content.replace(/\s+/g, " ").trim().slice(0, 260);
      const tags = item.tags.slice(0, 5).join("、") || "无";
      return [
        `[知识库参考 ${index + 1}]`,
        `标题：${item.title}`,
        `类型：${getKnowledgeKindLabel(item.kind)}`,
        `来源：${item.documentName} · ${item.positionLabel}`,
        `标签：${tags}`,
        `内容摘录：${excerpt}${item.content.length > 260 ? "…" : ""}`,
      ].join("\n");
    })
    .join("\n\n");
}
