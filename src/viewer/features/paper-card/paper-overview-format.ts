import type { PaperCardFormData } from "../../core/pdf-reader/public";

export function normalizePaperVenueYearDisplay(
  value: string,
  title = "",
): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return title.trim();
  const parts = cleaned
    .split(/\s*[·|,，;；]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(" · ");
}

/** Formats legacy overview records so existing user data remains searchable. */
export function formatPaperOverviewMarkdown(data: PaperCardFormData): string {
  return [
    `# ${data.title || "论文阅读卡片"}`,
    "",
    `- 作者：${data.authors || "原文未明确出现"}`,
    `- 会议 / 期刊与年份：${data.venueYear || "原文未明确出现"}`,
    `- 研究领域：${data.researchArea || "原文未明确出现"}`,
    `- 关键词：${data.keywords || "原文未明确出现"}`,
    "",
    "## 一句话总结",
    data.oneSentenceSummary || "原文未明确出现",
    "",
    "## 解决的核心问题",
    data.researchProblem || "原文未明确出现",
    "",
    "## 核心思想与创新",
    data.coreInnovation || "原文未明确出现",
    "",
    "## 关键实验结果",
    data.mainFindings || "原文未明确出现",
    "",
    "## 对我的研究价值",
    data.researchConnection || "原文未明确出现",
    "",
    "## 我的备注",
    data.personalNotes || "",
  ].join("\n");
}
