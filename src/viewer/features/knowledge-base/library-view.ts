
















import { activeKnowledgeCategory, activeKnowledgeFilter, activeKnowledgeFocus, activeKnowledgePageMode, activeKnowledgePriority, activeKnowledgeReadingStatus, activeKnowledgeTag, activeKnowledgeVenue, activeKnowledgeYear, persistCurrentAppViewState, selectedKnowledgeRecordKey } from "../../core/pdf-reader/public";

import { openSavedPaperOverviewReview } from "../paper-card/public";
import { knowledgeBasePageElement, knowledgeCountAllElement, knowledgeCountOriginGeneralElement, knowledgeCountOriginGeneralNoteElement, knowledgeCountOriginGeneralReadingCardElement, knowledgeCountOriginNovelElement, knowledgeCountOriginNovelNoteElement, knowledgeCountOriginNovelReadingCardElement, knowledgeCountOriginPaperElement, knowledgeCountOriginPaperNoteElement, knowledgeCountOriginPaperReadingCardElement, knowledgeDetailBodyElement, knowledgeDetailContentElement, knowledgeDetailCreatedElement, knowledgeDetailDocumentElement, knowledgeDetailEmptyElement, knowledgeDetailPositionElement, knowledgeDetailTagsElement, knowledgeDetailTimeElement, knowledgeDetailTitleElement, knowledgeDetailTypeElement, knowledgeDetailUpdatedElement, knowledgeEditItemButton, knowledgeFocusButtons, knowledgeFocusCountCitableElement, knowledgeFocusCountDeepElement, knowledgeFocusCountFinishedElement, knowledgeFocusCountMethodsElement, knowledgeFocusCountRelatedElement, knowledgeFocusCountReplicateElement, knowledgeFocusCountTodoElement, knowledgeInsightControls, knowledgeLibraryView, knowledgeListElement, knowledgeModeButtons, knowledgeOpenSourceButton, knowledgePageTitleElement, knowledgePriorityFilterSelect, knowledgeQaControls, knowledgeReadingStatusFilterSelect, knowledgeRecentSummaryElement, knowledgeRelatedSummaryElement, knowledgeResearchDescription, knowledgeResearchHeading, knowledgeResearchQuestionInput, knowledgeResearchView, knowledgeRunResearchButton, knowledgeSearchInput, knowledgeSortSelect, knowledgeTagListElement, knowledgeVenueFilterSelect, knowledgeYearFilterSelect } from "../../app/viewer-elements";






import type { KnowledgeFocus, KnowledgeItem, KnowledgePageMode } from "../../core/pdf-reader/public";
import { activeKnowledgeOrigin, activeKnowledgeOriginContent, deriveKnowledgePriority, deriveKnowledgeReadingStatus, extractKnowledgeVenue, extractKnowledgeYear, formatKnowledgeDate, formatKnowledgeRelativeDate, getKnowledgeBaseDocumentName, getKnowledgeExcerptForDashboard, getKnowledgeKindIcon, getKnowledgeKindLabel, getKnowledgeOriginContentType, matchesKnowledgeFocus, syncKnowledgeOriginButtons, type KnowledgeOriginContentFilter, type KnowledgeOriginFilter } from './knowledge-domain';
import { renderKnowledgeBase, updateKnowledgeResearchScopeSummary } from './research-controller';
import { deleteKnowledgeItem, openKnowledgeEditor } from './editor-controller';




export function syncKnowledgeFocusCounts(items: KnowledgeItem[]): void {
  if (knowledgeFocusCountTodoElement)
    knowledgeFocusCountTodoElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "todo")).length,
    );
  if (knowledgeFocusCountDeepElement)
    knowledgeFocusCountDeepElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "deep")).length,
    );
  if (knowledgeFocusCountFinishedElement)
    knowledgeFocusCountFinishedElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "finished")).length,
    );
  if (knowledgeFocusCountCitableElement)
    knowledgeFocusCountCitableElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "citable")).length,
    );
  if (knowledgeFocusCountReplicateElement)
    knowledgeFocusCountReplicateElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "replicate")).length,
    );
  if (knowledgeFocusCountRelatedElement)
    knowledgeFocusCountRelatedElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "related")).length,
    );
  if (knowledgeFocusCountMethodsElement)
    knowledgeFocusCountMethodsElement.textContent = String(
      items.filter((item) => matchesKnowledgeFocus(item, "methods")).length,
    );
  for (const button of knowledgeFocusButtons) {
    const focus = button.dataset.knowledgeFocus as KnowledgeFocus | undefined;
    button.classList.toggle("active", focus === activeKnowledgeFocus.value);
  }
}



export function populateKnowledgeDashboardFilters(items: KnowledgeItem[]): void {
  const syncSelect = (
    select: HTMLSelectElement | null,
    current: string,
    fallbackLabel: string,
    values: string[],
  ): void => {
    if (!select) return;
    const previous = current;
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = fallbackLabel;
    select.append(allOption);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (values.includes(previous)) select.value = previous;
    else select.value = "all";
  };

  const years = Array.from(
    new Set(
      items
        .map(extractKnowledgeYear)
        .filter((value) => value && value !== "未标注"),
    ),
  ).sort((a, b) => Number(b) - Number(a));
  const venues = Array.from(
    new Set(items.map(extractKnowledgeVenue).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const statuses = ["待读", "精读中", "已读完", "略读完成"];
  const priorities = ["高优先级", "中优先级", "常规"];

  syncSelect(knowledgeYearFilterSelect, activeKnowledgeYear.value, "年份", years);
  syncSelect(
    knowledgeVenueFilterSelect,
    activeKnowledgeVenue.value,
    "会议/期刊",
    venues,
  );
  syncSelect(
    knowledgeReadingStatusFilterSelect,
    activeKnowledgeReadingStatus.value,
    "阅读状态",
    statuses,
  );
  syncSelect(
    knowledgePriorityFilterSelect,
    activeKnowledgePriority.value,
    "优先级",
    priorities,
  );

  activeKnowledgeYear.value = knowledgeYearFilterSelect?.value || "all";
  activeKnowledgeVenue.value = knowledgeVenueFilterSelect?.value || "all";
  activeKnowledgeReadingStatus.value =
    knowledgeReadingStatusFilterSelect?.value || "all";
  activeKnowledgePriority.value = knowledgePriorityFilterSelect?.value || "all";
}



export function getFilteredKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const query = knowledgeSearchInput.value.trim().toLocaleLowerCase("zh-CN");
  const filtered = items.filter((item) => {
    if (
      activeKnowledgeOrigin.value !== "all" &&
      item.originMode !== activeKnowledgeOrigin.value
    )
      return false;
    if (
      activeKnowledgeOriginContent.value !== "all" &&
      getKnowledgeOriginContentType(item) !== activeKnowledgeOriginContent.value
    )
      return false;
    if (activeKnowledgeFilter.value !== "all" && item.kind !== activeKnowledgeFilter.value)
      return false;
    if (activeKnowledgeTag.value && !item.tags.includes(activeKnowledgeTag.value))
      return false;
    if (!matchesKnowledgeFocus(item, activeKnowledgeFocus.value)) return false;
    if (
      activeKnowledgeYear.value !== "all" &&
      extractKnowledgeYear(item) !== activeKnowledgeYear.value
    )
      return false;
    if (
      activeKnowledgeVenue.value !== "all" &&
      extractKnowledgeVenue(item) !== activeKnowledgeVenue.value
    )
      return false;
    if (
      activeKnowledgeReadingStatus.value !== "all" &&
      deriveKnowledgeReadingStatus(item) !== activeKnowledgeReadingStatus.value
    )
      return false;
    if (
      activeKnowledgePriority.value !== "all" &&
      deriveKnowledgePriority(item) !== activeKnowledgePriority.value
    )
      return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.content,
      item.documentName,
      item.positionLabel,
      item.category,
      extractKnowledgeVenue(item),
      extractKnowledgeYear(item),
      ...item.tags,
    ]
      .join("\n")
      .toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });

  const sort = knowledgeSortSelect.value;
  filtered.sort((left, right) => {
    if (sort === "oldest")
      return (
        new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime()
      );
    if (sort === "title") return left.title.localeCompare(right.title, "zh-CN");
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
  return filtered;
}



export function renderKnowledgeSidebar(items: KnowledgeItem[]): void {
  const countOrigin = (
    origin: Exclude<KnowledgeOriginFilter, "all">,
    content: KnowledgeOriginContentFilter = "all",
  ): number =>
    items.filter(
      (item) =>
        item.originMode === origin &&
        (content === "all" || getKnowledgeOriginContentType(item) === content),
    ).length;

  knowledgeCountAllElement.textContent = String(items.length);

  knowledgeCountOriginNovelElement.textContent = String(countOrigin("novel"));
  knowledgeCountOriginNovelReadingCardElement.textContent = String(
    countOrigin("novel", "reading-card"),
  );
  knowledgeCountOriginNovelNoteElement.textContent = String(
    countOrigin("novel", "note"),
  );

  knowledgeCountOriginPaperElement.textContent = String(countOrigin("paper"));
  knowledgeCountOriginPaperReadingCardElement.textContent = String(
    countOrigin("paper", "reading-card"),
  );
  knowledgeCountOriginPaperNoteElement.textContent = String(
    countOrigin("paper", "note"),
  );

  knowledgeCountOriginGeneralElement.textContent = String(countOrigin("general"));
  knowledgeCountOriginGeneralReadingCardElement.textContent = String(
    countOrigin("general", "reading-card"),
  );
  knowledgeCountOriginGeneralNoteElement.textContent = String(
    countOrigin("general", "note"),
  );

  syncKnowledgeOriginButtons();

  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags)
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tagButtons = Array.from(tagCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([tag, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.toggle("active", activeKnowledgeTag.value === tag);
      button.textContent = `# ${tag} ${count}`;
      button.addEventListener("click", () => {
        activeKnowledgeTag.value = activeKnowledgeTag.value === tag ? "" : tag;
        activeKnowledgeCategory.value = "all";
        renderKnowledgeBase();
      });
      return button;
    });
  knowledgeTagListElement.replaceChildren(...tagButtons);

  const latest = [...items].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];
  knowledgeRecentSummaryElement.textContent = latest
    ? `${formatKnowledgeRelativeDate(latest.updatedAt)} · ${latest.title}`
    : "还没有保存内容";
}



export function openKnowledgeItemFromLibrary(item: KnowledgeItem): void {
  selectedKnowledgeRecordKey.value = item.recordKey;

  // 整篇论文生成的论文卡片进入完整论文阅读卡片页。
  if (item.source === "paper-overview") {
    openSavedPaperOverviewReview(item);
    return;
  }

  // 普通笔记、AI 总结和阅读卡片进入内容编辑页。
  openKnowledgeEditor(item);
}



export function createKnowledgeItemCard(item: KnowledgeItem): HTMLElement {
  const card = document.createElement("article");
  card.className = `knowledge-item-card knowledge-simple-card kind-${item.kind}`;
  card.dataset.recordKey = item.recordKey;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    item.source === "paper-overview"
      ? `打开论文卡片：${item.title}`
      : `打开知识内容：${item.title}`,
  );

  const cardHeader = document.createElement("div");
  cardHeader.className = "knowledge-simple-card-header";

  const title = document.createElement("h3");
  title.className = "knowledge-card-title";
  title.textContent = item.title;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "knowledge-card-delete-button";
  deleteButton.textContent = "删除";
  deleteButton.title = `删除“${item.title}”`;
  deleteButton.setAttribute("aria-label", `删除“${item.title}”`);
  deleteButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteKnowledgeItem(item);
  });
  cardHeader.append(title, deleteButton);

  const subtitle = document.createElement("div");
  subtitle.className = "knowledge-card-subtitle";
  const venue = extractKnowledgeVenue(item);
  const year = extractKnowledgeYear(item);
  const subtitleParts: string[] = [];
  if (venue && venue !== "未标注") subtitleParts.push(venue);
  if (year && year !== "未标注") subtitleParts.push(year);
  subtitle.textContent =
    subtitleParts.join(" · ") || getKnowledgeKindLabel(item.kind);

  const fileLine = document.createElement("div");
  fileLine.className = "knowledge-card-file";
  const fileIcon = document.createElement("span");
  fileIcon.className = "knowledge-card-file-icon";
  fileIcon.setAttribute("aria-hidden", "true");
  fileIcon.textContent = "▧";
  const fileName = document.createElement("span");
  fileName.textContent = getKnowledgeBaseDocumentName(item.documentName);
  fileLine.append(fileIcon, fileName);

  const excerpt = document.createElement("p");
  excerpt.className = "knowledge-card-excerpt";
  excerpt.textContent = getKnowledgeExcerptForDashboard(item);

  const tags = document.createElement("div");
  tags.className = "knowledge-card-tags";
  for (const tag of item.tags.slice(0, 4)) {
    const tagElement = document.createElement("span");
    tagElement.textContent = tag;
    tags.append(tagElement);
  }

  card.append(cardHeader, subtitle, fileLine, excerpt, tags);

  const openItem = (): void => openKnowledgeItemFromLibrary(item);
  card.addEventListener("click", openItem);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openItem();
    }
  });

  return card;
}



export function createKnowledgeGroup(
  items: KnowledgeItem[],
  title: string,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "knowledge-group";
  const heading = document.createElement("h2");
  heading.textContent = `${title} (${items.length})`;
  const grid = document.createElement("div");
  grid.className = "knowledge-group-grid";
  grid.append(...items.map(createKnowledgeItemCard));
  section.append(heading, grid);
  return section;
}



export function renderKnowledgeList(items: KnowledgeItem[]): void {
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-list-empty";
    empty.innerHTML =
      "<span>⌕</span><strong>没有找到匹配内容</strong><p>可以调整搜索条件，或新建一条笔记。</p>";
    knowledgeListElement.replaceChildren(empty);
    selectedKnowledgeRecordKey.value = "";
    renderKnowledgeDetail([], undefined);
    return;
  }

  if (!items.some((item) => item.recordKey === selectedKnowledgeRecordKey.value)) {
    selectedKnowledgeRecordKey.value = items[0]?.recordKey || "";
  }

  // 始终使用两列平铺卡片，避免分组后宽度和高度不一致。
  knowledgeListElement.replaceChildren(...items.map(createKnowledgeItemCard));

  renderKnowledgeDetail(
    items,
    items.find((item) => item.recordKey === selectedKnowledgeRecordKey.value),
  );
}



export function renderKnowledgeBody(content: string): void {
  const nodes: HTMLElement[] = [];
  const lines = content.split(/\r?\n/);
  let list: HTMLUListElement | null = null;

  const flushList = (): void => {
    if (!list) return;
    nodes.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch?.[1]) {
      flushList();
      const heading = document.createElement("h4");
      heading.textContent = headingMatch[1];
      nodes.push(heading);
      continue;
    }
    const bulletMatch = line.match(/^[•*-]\s*(.+)$/);
    if (bulletMatch?.[1]) {
      list ||= document.createElement("ul");
      const item = document.createElement("li");
      item.textContent = bulletMatch[1];
      list.append(item);
      continue;
    }
    flushList();
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    nodes.push(paragraph);
  }
  flushList();
  knowledgeDetailBodyElement.replaceChildren(...nodes);
}



export function renderKnowledgeDetail(
  items: KnowledgeItem[],
  item: KnowledgeItem | undefined,
): void {
  knowledgeDetailEmptyElement.hidden = Boolean(item);
  knowledgeDetailContentElement.hidden = !item;
  if (!item) return;

  knowledgeDetailTypeElement.textContent = `${getKnowledgeKindIcon(item.kind)} ${getKnowledgeKindLabel(item.kind)}`;
  knowledgeDetailTypeElement.dataset.kind = item.kind;
  knowledgeDetailTimeElement.textContent = formatKnowledgeRelativeDate(
    item.updatedAt,
  );
  knowledgeDetailTitleElement.textContent = item.title;
  knowledgeDetailDocumentElement.textContent = item.documentName;
  knowledgeDetailPositionElement.textContent =
    item.positionLabel ||
    (item.pageNumber ? `第 ${item.pageNumber} 页` : "未定位");
  knowledgeDetailCreatedElement.textContent = formatKnowledgeDate(
    item.createdAt,
  );
  knowledgeDetailUpdatedElement.textContent = formatKnowledgeDate(
    item.updatedAt,
  );

  const tags = item.tags.map((tag) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = `#${tag}`;
    element.addEventListener("click", () => {
      activeKnowledgeTag.value = tag;
      activeKnowledgeCategory.value = "all";
      renderKnowledgeBase();
    });
    return element;
  });
  knowledgeDetailTagsElement.replaceChildren(...tags);
  renderKnowledgeBody(item.content);
  knowledgeEditItemButton.textContent =
    item.source === "paper-overview" ? "打开复习页" : "编辑内容";
  knowledgeEditItemButton.title =
    item.source === "paper-overview"
      ? "打开完整论文卡片页面进行复习和修改"
      : "编辑当前知识内容";

  const related = items.filter(
    (candidate) =>
      candidate.recordKey !== item.recordKey &&
      candidate.documentName === item.documentName,
  );
  const relatedNotes = related.filter(
    (candidate) => candidate.kind === "note",
  ).length;
  const relatedCards = related.filter(
    (candidate) => candidate.kind !== "note",
  ).length;
  knowledgeRelatedSummaryElement.textContent = related.length
    ? `同一文档中还有 ${relatedNotes} 条笔记、${relatedCards} 张卡片。`
    : "当前文档暂无其他关联内容。";
  knowledgeOpenSourceButton.disabled = !item.pageNumber;
}




export function setKnowledgePageMode(mode: KnowledgePageMode): void {
  activeKnowledgePageMode.value = mode;
  for (const button of knowledgeModeButtons) {
    const isActive = button.dataset.knowledgeMode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
  const isLibrary = mode === "library";
  knowledgeLibraryView.hidden = !isLibrary;
  knowledgeResearchView.hidden = isLibrary;
  knowledgeQaControls.hidden = mode !== "qa";
  knowledgeInsightControls.hidden = mode !== "insights";
  knowledgeBasePageElement.classList.toggle("research-mode", !isLibrary);

  if (mode === "qa") {
    knowledgePageTitleElement.textContent = "跨文献问答";
    knowledgeResearchHeading.textContent = "跨文献问答";
    knowledgeResearchDescription.textContent =
      "让 AI 综合你保存的论文卡片、阅读卡片和笔记，并用 [K1]、[K2] 标注依据。";
    knowledgeRunResearchButton.textContent = "✦ 开始回答";
    window.setTimeout(() => knowledgeResearchQuestionInput.focus(), 0);
  } else if (mode === "insights") {
    knowledgePageTitleElement.textContent = "研究洞察";
    knowledgeResearchHeading.textContent = "研究洞察";
    knowledgeResearchDescription.textContent =
      "寻找文献共识、冲突、研究空白与可验证的新假设，并明确区分证据和 AI 推测。";
    knowledgeRunResearchButton.textContent = "◇ 生成研究洞察";
  }
  updateKnowledgeResearchScopeSummary();
  persistCurrentAppViewState();
}
