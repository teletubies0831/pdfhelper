import {
  activeKnowledgeCategory,
  activeKnowledgeFilter,
  activeKnowledgeFocus,
  activeKnowledgePriority,
  activeKnowledgeReadingStatus,
  activeKnowledgeTag,
  activeKnowledgeVenue,
  activeKnowledgeYear,
  selectedKnowledgeRecordKey,
} from "../../core/pdf-reader/public";
import {
  knowledgePriorityFilterSelect,
  knowledgeReadingStatusFilterSelect,
  knowledgeSearchInput,
  knowledgeVenueFilterSelect,
  knowledgeYearFilterSelect,
} from "../viewer-elements";
import {
  collectKnowledgeItems,
  renderKnowledgeBase,
  resetKnowledgeOriginFilter,
} from "../../features/knowledge-base/public";

function getLatestKnowledgeRecordKey(): string {
  return [...collectKnowledgeItems()]
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime()
        - new Date(left.updatedAt).getTime(),
    )[0]?.recordKey ?? "";
}

function resetFiltersForRecentItem(): void {
  activeKnowledgeFilter.value = "all";
  activeKnowledgeCategory.value = "all";
  activeKnowledgeTag.value = "";
  activeKnowledgeFocus.value = "all";
  activeKnowledgeYear.value = "all";
  activeKnowledgeVenue.value = "all";
  activeKnowledgeReadingStatus.value = "all";
  activeKnowledgePriority.value = "all";
  resetKnowledgeOriginFilter();

  knowledgeSearchInput.value = "";
  if (knowledgeYearFilterSelect) knowledgeYearFilterSelect.value = "all";
  if (knowledgeVenueFilterSelect) knowledgeVenueFilterSelect.value = "all";
  if (knowledgeReadingStatusFilterSelect) {
    knowledgeReadingStatusFilterSelect.value = "all";
  }
  if (knowledgePriorityFilterSelect) {
    knowledgePriorityFilterSelect.value = "all";
  }
}

function scrollToRecentKnowledgeCard(): void {
  const recordKey = getLatestKnowledgeRecordKey();
  if (!recordKey) return;

  resetFiltersForRecentItem();
  selectedKnowledgeRecordKey.value = recordKey;
  renderKnowledgeBase();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>("[data-record-key]"),
      ).find((element) => element.dataset.recordKey === recordKey);

      if (!target) return;

      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
      target.classList.add("knowledge-recent-target");
      window.setTimeout(
        () => target.classList.remove("knowledge-recent-target"),
        1800,
      );
    });
  });
}

export function registerKnowledgeRecentEvents(): void {
  const summary = document.getElementById("knowledge-recent-summary");
  const recentCard = summary?.closest<HTMLElement>(".knowledge-recent-card");
  if (!recentCard) return;

  recentCard.setAttribute("role", "button");
  recentCard.setAttribute("tabindex", "0");
  recentCard.setAttribute("aria-label", "跳转到最近保存的知识内容");

  recentCard.addEventListener("click", scrollToRecentKnowledgeCard);
  recentCard.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    scrollToRecentKnowledgeCard();
  });
}
