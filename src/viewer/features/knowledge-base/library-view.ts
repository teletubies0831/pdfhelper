


















import { knowledgeBasePageElement, knowledgeCountAllElement, knowledgeCountOriginGeneralElement, knowledgeCountOriginGeneralNoteElement, knowledgeCountOriginGeneralReadingCardElement, knowledgeCountOriginNovelElement, knowledgeCountOriginNovelNoteElement, knowledgeCountOriginNovelReadingCardElement, knowledgeCountOriginPaperElement, knowledgeCountOriginPaperNoteElement, knowledgeCountOriginPaperReadingCardElement, knowledgeDetailBodyElement, knowledgeDetailContentElement, knowledgeDetailCreatedElement, knowledgeDetailDocumentElement, knowledgeDetailEmptyElement, knowledgeDetailPositionElement, knowledgeDetailTagsElement, knowledgeDetailTimeElement, knowledgeDetailTitleElement, knowledgeDetailTypeElement, knowledgeDetailUpdatedElement, knowledgeEditItemButton, knowledgeFocusButtons, knowledgeFocusCountCitableElement, knowledgeFocusCountDeepElement, knowledgeFocusCountFinishedElement, knowledgeFocusCountMethodsElement, knowledgeFocusCountRelatedElement, knowledgeFocusCountReplicateElement, knowledgeFocusCountTodoElement, knowledgeListElement, knowledgeOpenSourceButton, knowledgePageTitleElement, knowledgePriorityFilterSelect, knowledgeReadingStatusFilterSelect, knowledgeRecentSummaryElement, knowledgeRelatedSummaryElement, knowledgeSearchInput, knowledgeSortSelect, knowledgeTagListElement, knowledgeVenueFilterSelect, knowledgeYearFilterSelect } from "../../app/viewer-elements";






import type { KnowledgeFocus } from "../../core/pdf-reader/public";
import { activeKnowledgeOrigin, activeKnowledgeOriginContent, extractKnowledgeVenue, extractKnowledgeYear, formatKnowledgeDate, formatKnowledgeRelativeDate, getKnowledgeBaseDocumentName, getKnowledgeKindIcon, getKnowledgeKindLabel, getKnowledgeOriginContentType, syncKnowledgeOriginButtons, type KnowledgeOriginContentFilter, type KnowledgeOriginFilter } from './knowledge-domain';
import { renderKnowledgeBase } from './knowledge-base-controller';
import { deleteKnowledgeItem, openKnowledgeEditor } from './editor-controller';
import { getPaperLibraryCardMetadata } from "./paper-library-card-metadata";
import { activeKnowledgeCategory, activeKnowledgePriority, activeKnowledgeReadingStatus, activeKnowledgeTag, activeKnowledgeVenue, activeKnowledgeYear, selectedKnowledgeRecordKey } from "../../app/public";
import { activeKnowledgeFilter, activeKnowledgeFocus, KnowledgeItem } from "../../app/public";






































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
  knowledgeEditItemButton.textContent = "查看 / 编辑";
  knowledgeEditItemButton.title = "在弹窗中查看排版内容或编辑 Markdown 原文";

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
  knowledgeOpenSourceButton.disabled = false;
}
