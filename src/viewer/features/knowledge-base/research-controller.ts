















import { activeKnowledgeInsightPrompt, activeKnowledgePageMode, aiConfigLoaded, knowledgeResearchPending, lastKnowledgeResearchAnswer, lastKnowledgeResearchItems, lastKnowledgeResearchQuestion, paperCardPageAbortController, persistCurrentAppViewState, resolvedReadingMode, selectedKnowledgeRecordKey, selectedKnowledgeResearchKeys } from "../../core/pdf-reader/public";


import { aiPanelToggleButton, appFrame, knowledgeBaseEntryButton, knowledgeBasePageElement, knowledgeDocumentCountElement, knowledgeGroupSelect, knowledgeInsightQuestionInput, knowledgePageSubtitleElement, knowledgePageTitleElement, knowledgeResearchQuestionInput, knowledgeResearchResult, knowledgeResearchResultBody, knowledgeResearchResultKind, knowledgeResearchResultTitle, knowledgeResearchScopeSelect, knowledgeResearchScopeSummary, knowledgeResearchSourceList, knowledgeResearchStatus, knowledgeRunResearchButton, knowledgeTotalCountElement, paperCardPageElement } from "../../app/viewer-elements";
import { loadDeepSeekConfig, setCurrentApplicationView } from "../assistant/public";
import { renderChatMarkdown, requestAiContent } from "../../shared-ui/markdown/markdown-renderer";




import type { KnowledgeItem, KnowledgeResearchScope, SavedKnowledgeNote } from "../../core/pdf-reader/public";
import { collectKnowledgeItems, getKnowledgeRecordKey, normalizeKnowledgeCategory, readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import { getFilteredKnowledgeItems, populateKnowledgeDashboardFilters, renderKnowledgeList, renderKnowledgeSidebar, setKnowledgePageMode, syncKnowledgeFocusCounts } from './library-view';
import { activeKnowledgeOrigin, activeKnowledgeOriginContent, getKnowledgeExcerpt, getKnowledgeKindLabel, type KnowledgeOriginContentFilter, type KnowledgeOriginFilter } from './knowledge-domain';




export function getKnowledgeResearchScopeItems(): KnowledgeItem[] {
  const allItems = collectKnowledgeItems();
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  if (scope === "selected") {
    return allItems.filter((item) =>
      selectedKnowledgeResearchKeys.value.has(item.recordKey),
    );
  }
  if (scope === "filtered") return getFilteredKnowledgeItems(allItems);
  return allItems;
}



export function updateKnowledgeResearchScopeSummary(): void {
  const scope = knowledgeResearchScopeSelect.value as KnowledgeResearchScope;
  const items = getKnowledgeResearchScopeItems();
  const documents = new Set(items.map((item) => item.documentName)).size;
  if (scope === "selected" && !items.length) {
    knowledgeResearchScopeSummary.textContent = "尚未勾选材料";
    knowledgeResearchScopeSummary.classList.add("empty");
  } else {
    knowledgeResearchScopeSummary.textContent = `${items.length} 条内容 · ${documents} 篇文档`;
    knowledgeResearchScopeSummary.classList.remove("empty");
  }
}



export function getKnowledgeResearchTokens(query: string): string[] {
  return Array.from(
    new Set(
      (query.toLocaleLowerCase("zh-CN").match(/[\p{L}\p{N}]{2,}/gu) || [])
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ).slice(0, 24);
}



export function rankKnowledgeItemsForResearch(
  items: KnowledgeItem[],
  query: string,
): KnowledgeItem[] {
  const tokens = getKnowledgeResearchTokens(query);
  const scored = items.map((item, index) => {
    const title = item.title.toLocaleLowerCase("zh-CN");
    const tags = `${item.category} ${item.tags.join(" ")}`.toLocaleLowerCase(
      "zh-CN",
    );
    const documentName = item.documentName.toLocaleLowerCase("zh-CN");
    const content = item.content.toLocaleLowerCase("zh-CN");
    let score = 0;
    for (const token of tokens) {
      if (title.includes(token)) score += 8;
      if (tags.includes(token)) score += 5;
      if (documentName.includes(token)) score += 3;
      if (content.includes(token)) score += 1;
    }
    if (selectedKnowledgeResearchKeys.value.has(item.recordKey)) score += 2;
    return { item, index, score };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      new Date(right.item.updatedAt).getTime() -
        new Date(left.item.updatedAt).getTime() ||
      left.index - right.index,
  );

  const result: KnowledgeItem[] = [];
  const perDocument = new Map<string, number>();
  for (const entry of scored) {
    const count = perDocument.get(entry.item.documentName) || 0;
    if (count >= 3 && result.length < Math.min(8, scored.length)) continue;
    result.push(entry.item);
    perDocument.set(entry.item.documentName, count + 1);
    if (result.length >= 12) break;
  }
  return result;
}



export function buildKnowledgeResearchMaterial(items: KnowledgeItem[]): string {
  const blocks: string[] = [];
  let remaining = 12_500;
  for (const [index, item] of items.entries()) {
    const cleanContent = item.content.replace(/\s+/g, " ").trim();
    const prefix = [
      `[K${index + 1}]`,
      `标题：${item.title}`,
      `类型：${getKnowledgeKindLabel(item.kind)}`,
      `来源文档：${item.documentName}`,
      `位置：${item.positionLabel}`,
      `分类与标签：${[item.category, ...item.tags].filter(Boolean).join("、") || "无"}`,
      "内容：",
    ].join("\n");
    const allowance = Math.max(280, Math.min(1_050, remaining - prefix.length));
    const excerpt = cleanContent.slice(0, allowance);
    const block = `${prefix}${excerpt}${cleanContent.length > excerpt.length ? "…" : ""}`;
    if (block.length > remaining && blocks.length >= 4) break;
    blocks.push(block);
    remaining -= block.length + 2;
    if (remaining < 500) break;
  }
  return blocks.join("\n\n");
}



export function renderKnowledgeResearchSources(items: KnowledgeItem[]): void {
  const nodes = items.map((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>[K${index + 1}]</strong><span></span><small></small>`;
    const title = button.querySelector("span");
    const source = button.querySelector("small");
    if (title) title.textContent = item.title;
    if (source)
      source.textContent = `${item.documentName} · ${item.positionLabel}`;
    button.addEventListener("click", () => {
      selectedKnowledgeRecordKey.value = item.recordKey;
      setKnowledgePageMode("library");
      renderKnowledgeBase();
    });
    return button;
  });
  knowledgeResearchSourceList.replaceChildren(...nodes);
}



export function clearKnowledgeResearchResult(): void {
  lastKnowledgeResearchAnswer.value = "";
  lastKnowledgeResearchQuestion.value = "";
  lastKnowledgeResearchItems.value = [];
  knowledgeResearchResult.hidden = true;
  knowledgeResearchResultBody.replaceChildren();
  knowledgeResearchSourceList.replaceChildren();
  knowledgeResearchStatus.textContent = "";
  knowledgeResearchStatus.classList.remove("error");
}



export async function runKnowledgeResearch(): Promise<void> {
  if (knowledgeResearchPending.value) return;
  const scopeItems = getKnowledgeResearchScopeItems();
  if (!scopeItems.length) {
    knowledgeResearchStatus.textContent =
      knowledgeResearchScopeSelect.value === "selected"
        ? "请先在“内容库”中勾选材料，或改用“当前筛选结果/全部知识库”。"
        : "当前范围没有可分析的知识条目。";
    knowledgeResearchStatus.classList.add("error");
    return;
  }

  const supplementary = knowledgeInsightQuestionInput.value.trim();
  const question =
    activeKnowledgePageMode.value === "insights"
      ? `${activeKnowledgeInsightPrompt.value}${supplementary ? `\n\n用户补充要求：${supplementary}` : ""}`
      : knowledgeResearchQuestionInput.value.trim();
  if (!question) {
    knowledgeResearchStatus.textContent = "请先输入一个研究问题。";
    knowledgeResearchStatus.classList.add("error");
    knowledgeResearchQuestionInput.focus();
    return;
  }

  const rankedItems = rankKnowledgeItemsForResearch(scopeItems, question);
  const material = buildKnowledgeResearchMaterial(rankedItems);
  if (!material) {
    knowledgeResearchStatus.textContent =
      "这些条目没有足够的正文内容可供分析。";
    knowledgeResearchStatus.classList.add("error");
    return;
  }

  knowledgeResearchPending.value = true;
  knowledgeRunResearchButton.disabled = true;
  knowledgeResearchStatus.classList.remove("error");
  knowledgeResearchStatus.textContent = `正在综合 ${rankedItems.length} 条内容，请稍候…`;
  knowledgeResearchResult.hidden = false;
  knowledgeResearchResultKind.textContent =
    activeKnowledgePageMode.value === "insights" ? "研究洞察" : "跨文献问答";
  knowledgeResearchResultTitle.textContent =
    activeKnowledgePageMode.value === "insights"
      ? "正在生成研究洞察…"
      : question.slice(0, 56);
  knowledgeResearchResultBody.textContent = "AI 正在比较材料、寻找证据和差异…";
  renderKnowledgeResearchSources(rankedItems);

  try {
    if (!aiConfigLoaded.value) await loadDeepSeekConfig();
    const prompt = [
      "你是严谨的跨文献研究助手。只能依据下方“知识库材料”回答，不要假装看过未提供的论文全文。",
      "回答规则：",
      "1. 所有来自材料的关键结论都要在句末引用 [K1]、[K2]；可以同时引用多个。",
      "2. 明确区分“材料中的事实”“跨材料综合判断”和“AI 推测”。",
      "3. 新想法必须标记为【AI 推测】或【待验证假设】，并说明依据、反例和最小验证方式。",
      "4. 材料不足或互相矛盾时直接说明，不要编造作者、数据、实验结果或引用。",
      "5. 优先给出有研究价值、可验证、能形成下一步行动的回答。",
      "",
      `用户任务：${question}`,
      "",
      "知识库材料：",
      material,
    ].join("\n");
    const answer = await requestAiContent(
      [{ role: "user", content: prompt }],
      {},
    );
    lastKnowledgeResearchAnswer.value = answer;
    lastKnowledgeResearchQuestion.value = question;
    lastKnowledgeResearchItems.value = rankedItems;
    knowledgeResearchResultTitle.textContent =
      activeKnowledgePageMode.value === "insights"
        ? "研究洞察报告"
        : question.slice(0, 80);
    renderChatMarkdown(knowledgeResearchResultBody, answer);
    knowledgeResearchStatus.textContent = `完成：综合了 ${rankedItems.length} 条内容，来自 ${new Set(rankedItems.map((item) => item.documentName)).size} 篇文档。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    knowledgeResearchStatus.textContent = `分析失败：${message}`;
    knowledgeResearchStatus.classList.add("error");
    knowledgeResearchResultBody.textContent = message;
  } finally {
    knowledgeResearchPending.value = false;
    knowledgeRunResearchButton.disabled = false;
  }
}



export function saveKnowledgeResearchResult(): void {
  if (!lastKnowledgeResearchAnswer.value) return;
  const isInsight = activeKnowledgePageMode.value === "insights";
  const title = isInsight
    ? `研究洞察：${lastKnowledgeResearchItems.value[0]?.category || "知识库综合"}`
    : `跨文献问答：${getKnowledgeExcerpt(lastKnowledgeResearchQuestion.value).slice(0, 34)}`;
  const sourceIndex = lastKnowledgeResearchItems.value
    .map(
      (item, index) =>
        `[K${index + 1}] ${item.title}｜${item.documentName}｜${item.positionLabel}`,
    )
    .join("\n");
  const note = addKnowledgeNote({
    title,
    content: [
      "## 研究任务",
      lastKnowledgeResearchQuestion.value,
      "",
      "## AI 综合结果",
      lastKnowledgeResearchAnswer.value,
      "",
      "## 使用的知识条目",
      sourceIndex,
    ].join("\n"),
    documentName: "知识库综合分析",
    positionLabel: `${lastKnowledgeResearchItems.value.length} 条知识内容`,
    category: isInsight ? "研究洞察" : "跨文献问答",
    tags: isInsight
      ? ["研究洞察", "AI 推测", "跨文献"]
      : ["跨文献问答", "知识库"],
  });
  knowledgeResearchStatus.classList.remove("error");
  knowledgeResearchStatus.textContent = `已保存“${note.title}”。`;
}



export function renderKnowledgeBase(): void {
  const items = collectKnowledgeItems();
  const validKeys = new Set(items.map((item) => item.recordKey));
  selectedKnowledgeResearchKeys.value = new Set(
    Array.from(selectedKnowledgeResearchKeys.value).filter((key) =>
      validKeys.has(key),
    ),
  );

  renderKnowledgeSidebar(items);
  populateKnowledgeDashboardFilters(items);
  syncKnowledgeFocusCounts(items);

  // 简洁知识库固定使用平铺模式，不再显示分组、任务和统计面板。
  knowledgeGroupSelect.value = "none";
  const filtered = getFilteredKnowledgeItems(items);

  setKnowledgePageMode("library");

  const originLabels: Record<Exclude<KnowledgeOriginFilter, "all">, string> = {
    novel: "来自小说",
    paper: "来自论文",
    general: "来自通用",
  };
  const contentLabels: Record<
    Exclude<KnowledgeOriginContentFilter, "all">,
    string
  > = {
    "reading-card": "阅读卡片",
    note: "保存的笔记",
  };
  knowledgePageTitleElement.textContent =
    activeKnowledgeOrigin.value === "all"
      ? "全部内容"
      : activeKnowledgeOriginContent.value === "all"
        ? originLabels[activeKnowledgeOrigin.value]
        : `${originLabels[activeKnowledgeOrigin.value]} · ${contentLabels[activeKnowledgeOriginContent.value]}`;
  if (knowledgePageSubtitleElement) {
    knowledgePageSubtitleElement.textContent =
      "统一管理来自小说、论文和通用阅读的笔记与卡片。";
  }
  knowledgeTotalCountElement.textContent = String(filtered.length);
  knowledgeDocumentCountElement.textContent = String(
    new Set(filtered.map((item) => item.documentName)).size,
  );

  renderKnowledgeList(filtered);
  updateKnowledgeResearchScopeSummary();
  persistCurrentAppViewState();
}



export function refreshKnowledgeBaseIfOpen(): void {
  if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
}



export function openKnowledgeBasePage(): void {
  paperCardPageAbortController.value?.abort();
  paperCardPageElement.hidden = true;
  appFrame?.classList.remove("paper-card-page-open");
  knowledgeBasePageElement.hidden = false;
  appFrame?.classList.add("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");
  setCurrentApplicationView("knowledge");
  knowledgeBasePageElement.scrollTop = 0;
  renderKnowledgeBase();
}



export function closeKnowledgeBasePage(): void {
  knowledgeBasePageElement.hidden = true;
  appFrame?.classList.remove("knowledge-base-page-open");
  knowledgeBaseEntryButton.classList.remove("active");
  aiPanelToggleButton?.classList.add("active");
  setCurrentApplicationView("viewer");
  persistCurrentAppViewState();
}



export function getSelectedKnowledgeItem(): KnowledgeItem | undefined {
  return collectKnowledgeItems().find(
    (item) => item.recordKey === selectedKnowledgeRecordKey.value,
  );
}



export function addKnowledgeNote(
  note: Omit<SavedKnowledgeNote, "id" | "createdAt" | "updatedAt">,
): SavedKnowledgeNote {
  const now = new Date().toISOString();
  const saved: SavedKnowledgeNote = {
    ...note,
    readingMode: note.readingMode ?? resolvedReadingMode.value,
    category: normalizeKnowledgeCategory(note.category),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  writeSavedKnowledgeNotes([saved, ...readSavedKnowledgeNotes()]);
  selectedKnowledgeRecordKey.value = getKnowledgeRecordKey(
    "knowledge-note",
    saved.id,
  );
  refreshKnowledgeBaseIfOpen();
  return saved;
}



export type KnowledgeEditorBodyMode = "preview" | "edit";



export const knowledgeEditorPreviewTimer: { value: number | undefined } = {
  value: undefined,
};


export let knowledgeEditorBodyMode: { value: KnowledgeEditorBodyMode } = { value: "preview" };
