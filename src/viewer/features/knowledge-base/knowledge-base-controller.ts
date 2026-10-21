


















import { aiPanelToggleButton, knowledgeBaseEntryButton, knowledgeBasePageElement, knowledgeBatchBarElement, knowledgeBatchClearButton, knowledgeBatchCountElement, knowledgeBatchFolderSelect, knowledgeBatchMoveButton, knowledgeBatchRelatedButton, knowledgeBatchRemoveButton, knowledgeDetailCloseButton, knowledgeDocumentCountElement, knowledgeGroupSelect, knowledgeListElement, knowledgeListSummaryElement, knowledgePageStatusElement, knowledgePageSubtitleElement, knowledgePageTitleElement, knowledgeSearchInput, knowledgeSelectAllCheckbox, knowledgeTableSortButtons, knowledgeMetadataFilterButtons, knowledgeTotalCountElement, knowledgeViewGridButton, knowledgeViewListButton } from "../../app/viewer-elements";
import {
  getActiveWorkspaceView,
  transitionWorkspaceView,
} from "../../app/workspace-navigation";
import { setCurrentApplicationView } from "../../app/application-navigation";





import { collectKnowledgeItems, getKnowledgeRecordKey, normalizeKnowledgeCategory, readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import {
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  listKnowledgeDocuments,
  listKnowledgeFolders,
} from "./knowledge-corpus-repository";
import { registerKnowledgePdfOverviewEvents } from "./knowledge-pdf-overview";
import {
  isRelatedPapersSearchRunning,
  relatedPapersAvailability,
  searchRelatedPapers,
} from "./knowledge-related-papers";
import {
  readLibrarySort,
  renderLibrarySortIndicators,
  renderLibraryTable,
  type LibraryTableHandlers,
} from "./library-table";
import {
  describeLibrarySummary,
  sortLibraryDocuments,
  type LibrarySortKey,
} from "./library-table-model";
import { renderDocumentPanel, renderMetadataMissingCount, renderReadingStatusCounts } from "./library-doc-panel";
import { installDataHealth, refreshDataHealthBadge } from "./data-health-actions";
import { installBackupSettings } from "./backup-actions";
import { registerCitationDialogEvents } from "./citation-dialog";
import { applyLibraryViewMode, persistLibraryViewMode, readLibraryViewMode } from "./library-view-mode";
import { isKnowledgeIndexRunning } from "./current-pdf-add-to-library";
import { listKnowledgeDocumentsForDisplay } from "./interrupted-work-recovery";
import { buildCorpusFolderOptions, renderCorpusDocuments } from "./library-card-view";
import { createLibraryActions } from "./library-actions";
import {
  EMPTY_SELECTION,
  describeSelection,
  pruneDocumentSelection,
  selectVisibleDocuments,
  toggleDocumentSelection,
} from "./library-selection";
import {
  isMetadataMissing,
  readReadingStatus,
  READING_STATUS_LABELS,
  type KnowledgeDocumentReadingStatus,
} from "../../../modules/knowledge/public";
import { persistCurrentAppViewState, resolvedReadingMode, selectedKnowledgeRecordKey, SavedKnowledgeNote } from "../../app/public";
import { KnowledgeItem } from "../../app/public";





let knowledgeOpenToken = 0;



export function renderKnowledgeBase(): void {
  const folders = listKnowledgeFolders();
  // Interrupted background work is repaired here, because this is the only place that reads the whole corpus anyway:
  // a record still claiming `indexing`/`extracting` with no live task behind it would otherwise keep the toolbar and
  // the inspector's buttons disabled forever after a page reload.
  const documents = listKnowledgeDocumentsForDisplay(isKnowledgeIndexRunning);
  const query = knowledgeSearchInput.value.trim().toLocaleLowerCase();
  // A folder shows everything filed in it **and below it** — the sidebar badge counts the subtree, so the list has to
  // as well, or clicking a parent folder looks like it lost the documents in its subfolders.
  const folderScopes = activeCorpusFolder !== "all" && activeCorpusFolder !== "unfiled"
    ? getCorpusDescendantIds(folders, activeCorpusFolder)
    : null;
  const filtered = documents.filter((document) =>
    (!query || document.documentName.toLocaleLowerCase().includes(query))
    && (activeCorpusFolder === "all"
      || (activeCorpusFolder === "unfiled" && !document.folderId)
      || (folderScopes ? Boolean(document.folderId && folderScopes.has(document.folderId)) : false))
    && (activeReadingFilter === "all" || readReadingStatus(document) === activeReadingFilter)
    // The 缺元数据 view is a filter of its own, not a reading state: it answers "what still needs a DOI/date/author",
    // and documents the user marked 无需补全 never appear here.
    && (!activeMetadataFilter || isMetadataMissing(document)),
  );

  // The batch may only ever contain documents the user can see: narrowing the filter or the search drops the rest,
  // which is why this happens before anything is drawn from the selection.
  visibleDocumentIds = filtered.map((document) => document.documentId);
  selectedDocumentIds = pruneDocumentSelection(selectedDocumentIds, visibleDocumentIds);

  knowledgeGroupSelect.value = "none";
  const metadataScopeLabel = activeMetadataFilter ? "缺元数据" : "";
  knowledgePageTitleElement.textContent = activeMetadataFilter
    ? `${metadataScopeLabel}（${activeCorpusFolder === "all"
      ? "全部"
      : folders.find((folder) => folder.id === activeCorpusFolder)?.name || "未分类"}）`
    : activeReadingFilter !== "all"
      ? `${READING_FILTER_LABELS[activeReadingFilter]}（${activeCorpusFolder === "all"
        ? "全部"
        : folders.find((folder) => folder.id === activeCorpusFolder)?.name || "未分类"}）`
      : activeCorpusFolder === "all"
        ? "知识库"
        : activeCorpusFolder === "unfiled"
          ? "未分类"
          : folders.find((folder) => folder.id === activeCorpusFolder)?.name || "知识库";
  if (knowledgePageSubtitleElement) knowledgePageSubtitleElement.textContent = "管理你主动添加的 PDF，并为跨文献问答提供全文检索。";
  knowledgeTotalCountElement.textContent = String(filtered.length);
  knowledgeDocumentCountElement.textContent = String(documents.length);
  renderCorpusSidebar(folders, documents);
  renderReadingStatusCounts(documents);
  renderMetadataMissingCount(documents);
  // The badge only — never the dialog. It says "there is something to look at", and opening it is the user's call.
  void refreshDataHealthBadge();

  // Both views are rendered from the same filtered list; only one is visible, and the choice is remembered. Sorting is
  // the table headers' (the only sort control there is): the card view has no headers, so it follows the same state
  // rather than carrying a second, invisible order.
  const mode = readLibraryViewMode();
  applyLibraryViewMode(mode);
  const sort = readLibrarySort();
  renderLibrarySortIndicators(sort);
  renderCorpusDocuments(sortLibraryDocuments(filtered, sort), folders, {
    libraryDocumentCount: documents.length,
    selectedId: selectedDocumentId,
    selection: selectedDocumentIds,
  });
  if (mode === "list") {
    renderLibraryTable(
      sortLibraryDocuments(filtered, sort),
      { selectedId: selectedDocumentId, selection: selectedDocumentIds },
      tableHandlers,
    );
    knowledgeListSummaryElement.textContent = describeLibrarySummary(filtered.length, documents.length);
  } else {
    knowledgeListSummaryElement.textContent = "";
  }

  renderBatchBar(folders, documents);

  // The inspector follows the selection and disappears when the selected row is filtered out.
  const selected = filtered.find((item) => item.documentId === selectedDocumentId) ?? null;
  selectedDocumentId = selected?.documentId ?? null;
  renderDocumentPanel(selected, folders, panelHandlers);
  persistCurrentAppViewState();
}

/**
 * 批量栏: the count, the destination folder, and the three things a batch can do.
 *
 * Hidden when nothing is selected rather than disabled: a permanently visible row of inert buttons above the list is
 * exactly the clutter this redesign was meant to remove.
 */
function renderBatchBar(
  folders: ReturnType<typeof listKnowledgeFolders>,
  documents: ReturnType<typeof listKnowledgeDocuments>,
): void {
  const selected = selectedDocumentIds.size;
  knowledgeBatchBarElement.hidden = selected === 0;
  knowledgeSelectAllCheckbox.checked = selected > 0 && selected === visibleDocumentIds.length;
  knowledgeSelectAllCheckbox.indeterminate = selected > 0 && selected < visibleDocumentIds.length;
  if (!selected) return;
  knowledgeBatchCountElement.textContent = describeSelection(selectedDocumentIds);
  const currentFolder = knowledgeBatchFolderSelect.value;
  knowledgeBatchFolderSelect.replaceChildren(
    new Option('移动到未分类', ''),
    ...folders.map((folder) => new Option(folder.name, folder.id)),
  );
  knowledgeBatchFolderSelect.value = folders.some((folder) => folder.id === currentFolder)
    ? currentFolder
    : '';
  knowledgeBatchFolderSelect.disabled = documents.length === 0;
}

const READING_FILTER_LABELS: Record<KnowledgeDocumentReadingStatus, string> = {
  todo: "待读",
  reading: "在读",
  done: "已读",
};

let activeCorpusFolder = "all";
let activeReadingFilter: "all" | KnowledgeDocumentReadingStatus = "all";
/** 缺元数据 view: `true` while it is on. Exclusive with the reading filter — one nav, one active filter. */
let activeMetadataFilter = false;
let selectedDocumentId: string | null = null;
/** 多选 for the batch bar; independent of `selectedDocumentId`, which drives the inspector. */
let selectedDocumentIds: ReadonlySet<string> = EMPTY_SELECTION;
/** The ids the current filter shows, so 全选 means "everything on screen" and nothing else. */
let visibleDocumentIds: readonly string[] = [];
const expandedCorpusFolders = new Set<string>();
const knownCorpusFolders = new Set<string>();

function registerNewCorpusFolders(folders: ReturnType<typeof listKnowledgeFolders>): void {
  for (const folder of folders) {
    if (knownCorpusFolders.has(folder.id)) continue;
    knownCorpusFolders.add(folder.id);
    expandedCorpusFolders.add(folder.id);
  }
}

function getCorpusDescendantIds(
  folders: ReturnType<typeof listKnowledgeFolders>,
  folderId: string,
): Set<string> {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function buildCorpusFolderRows(
  folders: ReturnType<typeof listKnowledgeFolders>,
  documents: ReturnType<typeof listKnowledgeDocuments>,
  parentId: string | null,
  depth = 0,
): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const children = folders
    .filter((folder) => folder.parentId === parentId)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const folder of children) {
    const childFolders = folders.filter((candidate) => candidate.parentId === folder.id);
    const descendantIds = getCorpusDescendantIds(folders, folder.id);
    const row = document.createElement("div");
    row.className = "knowledge-folder-row";
    row.classList.toggle("is-nested", depth > 0);
    row.style.setProperty("--folder-depth", String(depth));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "knowledge-folder-toggle";
    toggle.dataset.toggleFolderId = folder.id;
    toggle.disabled = childFolders.length === 0;
    toggle.title = expandedCorpusFolders.has(folder.id) ? "收起子文件夹" : "展开子文件夹";
    toggle.textContent = childFolders.length
      ? (expandedCorpusFolders.has(folder.id) ? "⌄" : "›")
      : "";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.folderId = folder.id;
    button.className = "knowledge-folder-main";
    button.classList.toggle("active", activeCorpusFolder === folder.id);
    const icon = document.createElement("img");
    icon.src = "/resources/folder.svg";
    icon.alt = "";
    const label = document.createElement("span");
    label.textContent = folder.name;
    const count = document.createElement("strong");
    count.textContent = String(documents.filter((item) => item.folderId && descendantIds.has(item.folderId)).length);
    button.append(icon, label, count);

    const createChild = document.createElement("button");
    createChild.type = "button";
    createChild.className = "knowledge-folder-create-child";
    createChild.dataset.createChildFolderId = folder.id;
    createChild.title = `在“${folder.name}”中新建子文件夹`;
    createChild.textContent = "+";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "knowledge-folder-delete";
    remove.dataset.deleteFolderId = folder.id;
    remove.title = "删除文件夹及其子文件夹（PDF 将移到未分类）";
    remove.textContent = "×";
    row.append(toggle, button, createChild, remove);
    rows.push(row);
    if (expandedCorpusFolders.has(folder.id)) {
      rows.push(...buildCorpusFolderRows(folders, documents, folder.id, depth + 1));
    }
  }
  return rows;
}


function openCreateCorpusFolderDialog(parentId: string | null): void {
  const dialog = document.getElementById("knowledge-folder-dialog") as HTMLDialogElement | null;
  const input = document.getElementById("knowledge-folder-name-input") as HTMLInputElement | null;
  const parentSelect = document.getElementById("knowledge-folder-parent-select") as HTMLSelectElement | null;
  if (!dialog || !input || !parentSelect) return;
  const folders = listKnowledgeFolders();
  parentSelect.innerHTML = `<option value="">知识库根目录</option>${buildCorpusFolderOptions(folders, parentId)}`;
  parentSelect.value = parentId || "";
  input.value = "";
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => input.focus(), 0);
}

function renderCorpusSidebar(
  folders: ReturnType<typeof listKnowledgeFolders>,
  documents: ReturnType<typeof listKnowledgeDocuments>,
): void {
  registerNewCorpusFolders(folders);
  const allButton = document.getElementById("knowledge-folder-all");
  const unfiledButton = document.getElementById("knowledge-folder-unfiled");
  allButton?.classList.toggle("active", activeCorpusFolder === "all");
  unfiledButton?.classList.toggle("active", activeCorpusFolder === "unfiled");
  const allCount = document.getElementById("knowledge-library-count");
  const unfiledCount = document.getElementById("knowledge-unfiled-count");
  if (allCount) allCount.textContent = String(documents.length);
  if (unfiledCount) unfiledCount.textContent = String(documents.filter((item) => !item.folderId).length);
  const list = document.getElementById("knowledge-folder-list");
  if (!list) return;
  list.replaceChildren(...buildCorpusFolderRows(folders, documents, null));
}


function findDocument(documentId: string) {
  return listKnowledgeDocuments().find((item) => item.documentId === documentId) ?? null;
}

function setLibraryStatus(message: string, isError = false): void {
  knowledgePageStatusElement.textContent = message;
  knowledgePageStatusElement.classList.toggle("error", isError);
  knowledgePageStatusElement.hidden = !message;
}

function selectLibraryDocument(documentId: string | null): void {
  selectedDocumentId = documentId;
  renderKnowledgeBase();
}

/**
 * What the library can *do* to a document lives in `library-actions.ts`; this controller only decides what to draw.
 *
 * The four ports are the things only the page knows: how to re-render, what is selected, where to report, and how to
 * step aside when the reader opens a PDF. `select` re-renders, so removing a document (which clears the selection)
 * never leaves the inspector pointing at a row that is gone.
 */
const libraryActions = createLibraryActions({
  refresh: renderKnowledgeBase,
  select: selectLibraryDocument,
  status: setLibraryStatus,
  leavePage: closeKnowledgeBasePage,
});

/**
 * Redraws after a selection change; every 多选 path goes through here so the bar and the rows cannot disagree.
 *
 * The checkbox toggle is the one handler the action layer does not own: it is pure view state, so it lives here and is
 * merged into the table's handlers.
 */
function updateSelection(next: ReadonlySet<string>): void {
  selectedDocumentIds = next;
  renderKnowledgeBase();
}

/** The list's handlers, shared with the grid so a card click selects the same document. */
const tableHandlers: LibraryTableHandlers = {
  ...libraryActions.table,
  toggleSelect: (documentId: string) => {
    updateSelection(toggleDocumentSelection(selectedDocumentIds, documentId));
  },
};
const panelHandlers = libraryActions.panel;

export function registerKnowledgeCorpusEvents(): void {
  registerKnowledgePdfOverviewEvents();
  installDataHealth();
  installBackupSettings();
  registerCitationDialogEvents();
  document.getElementById("knowledge-folder-all")?.addEventListener("click", () => { activeCorpusFolder = "all"; renderKnowledgeBase(); });
  document.getElementById("knowledge-folder-unfiled")?.addEventListener("click", () => { activeCorpusFolder = "unfiled"; renderKnowledgeBase(); });
  document.getElementById("knowledge-create-folder")?.addEventListener("click", () => {
    openCreateCorpusFolderDialog(activeCorpusFolder !== "all" && activeCorpusFolder !== "unfiled" ? activeCorpusFolder : null);
  });
  document.getElementById("knowledge-folder-dialog-close")?.addEventListener("click", () => {
    (document.getElementById("knowledge-folder-dialog") as HTMLDialogElement | null)?.close();
  });
  document.getElementById("knowledge-folder-dialog-cancel")?.addEventListener("click", () => {
    (document.getElementById("knowledge-folder-dialog") as HTMLDialogElement | null)?.close();
  });
  document.getElementById("knowledge-folder-dialog")?.addEventListener("pointerdown", (event) => {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (event.target === dialog) dialog.close();
  });
  document.getElementById("knowledge-folder-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const dialog = document.getElementById("knowledge-folder-dialog") as HTMLDialogElement | null;
    const input = document.getElementById("knowledge-folder-name-input") as HTMLInputElement | null;
    const parentSelect = document.getElementById("knowledge-folder-parent-select") as HTMLSelectElement | null;
    if (!input?.value.trim()) return;
    const parentId = parentSelect?.value || null;
    const folder = createKnowledgeFolder(input.value, parentId);
    if (parentId) expandedCorpusFolders.add(parentId);
    expandedCorpusFolders.add(folder.id);
    activeCorpusFolder = folder.id;
    dialog?.close();
    renderKnowledgeBase();
  });
  document.getElementById("knowledge-folder-list")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const childButton = target.closest<HTMLButtonElement>("[data-create-child-folder-id]");
    if (childButton?.dataset.createChildFolderId) {
      expandedCorpusFolders.add(childButton.dataset.createChildFolderId);
      openCreateCorpusFolderDialog(childButton.dataset.createChildFolderId);
      return;
    }
    const toggleButton = target.closest<HTMLButtonElement>("[data-toggle-folder-id]");
    if (toggleButton?.dataset.toggleFolderId) {
      const folderId = toggleButton.dataset.toggleFolderId;
      if (expandedCorpusFolders.has(folderId)) expandedCorpusFolders.delete(folderId);
      else expandedCorpusFolders.add(folderId);
      renderKnowledgeBase();
      return;
    }
    const deleteButton = target.closest<HTMLButtonElement>("[data-delete-folder-id]");
    if (deleteButton?.dataset.deleteFolderId) {
      if (!window.confirm("删除这个文件夹及其所有子文件夹吗？其中的 PDF 会移到“未分类”。")) return;
      const deletedIds = getCorpusDescendantIds(listKnowledgeFolders(), deleteButton.dataset.deleteFolderId);
      deleteKnowledgeFolder(deleteButton.dataset.deleteFolderId);
      if (deletedIds.has(activeCorpusFolder)) activeCorpusFolder = "all";
      renderKnowledgeBase();
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-folder-id]");
    if (button?.dataset.folderId) { activeCorpusFolder = button.dataset.folderId; renderKnowledgeBase(); }
  });
  knowledgeListElement.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const check = target.closest<HTMLInputElement>("[data-select-document]");
    if (check?.dataset.selectDocument) {
      updateSelection(toggleDocumentSelection(selectedDocumentIds, check.dataset.selectDocument));
      return;
    }
    const select = target.closest<HTMLSelectElement>("[data-move-document]");
    if (!select?.dataset.moveDocument) return;
    panelHandlers.moveToFolder(select.dataset.moveDocument, select.value || null);
  });
  knowledgeListElement.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    // The card's checkbox only changes the batch; it must not also move the inspector.
    if (target.closest("[data-select-document]")) return;
    const cycle = target.closest<HTMLButtonElement>("[data-cycle-reading]");
    if (cycle?.dataset.cycleReading) {
      event.stopPropagation();
      tableHandlers.cycleReading(cycle.dataset.cycleReading);
      return;
    }
    const related = target.closest<HTMLButtonElement>("[data-search-related]");
    if (related?.dataset.searchRelated) {
      const item = findDocument(related.dataset.searchRelated);
      // `aria-disabled` rather than `disabled`: a disabled button cannot be hovered, and its tooltip is the only
      // thing that explains what to do first.
      if (item && !related.getAttribute("aria-disabled")) panelHandlers.searchRelated(item.documentId);
      else if (item) related.title = relatedPapersAvailability(item).reason;
      return;
    }
    const remove = target.closest<HTMLButtonElement>("[data-remove-document]");
    if (remove?.dataset.removeDocument) {
      panelHandlers.remove(remove.dataset.removeDocument);
      return;
    }
    const introduce = target.closest<HTMLButtonElement>("[data-introduce-document]");
    if (introduce?.dataset.introduceDocument) {
      panelHandlers.openOverview(introduce.dataset.introduceDocument);
      return;
    }
    // A plain click anywhere else on the card selects it, so the inspector follows in both views.
    const card = target.closest<HTMLElement>(".knowledge-pdf-card");
    if (card?.dataset.documentId && card.dataset.documentId !== selectedDocumentId) {
      selectLibraryDocument(card.dataset.documentId);
    }
  });

  // 视图切换 + 阅读状态筛选 + 表头排序：三个控件都只影响"怎么显示"，落地方式统一为重渲染。
  knowledgeViewListButton.addEventListener("click", () => {
    persistLibraryViewMode("list");
    renderKnowledgeBase();
  });
  knowledgeViewGridButton.addEventListener("click", () => {
    persistLibraryViewMode("grid");
    renderKnowledgeBase();
  });
  for (const button of readingFilterButtons()) {
    button.addEventListener("click", () => {
      const value = button.dataset.readingFilter;
      if (value !== "todo" && value !== "reading" && value !== "done") return;
      activeReadingFilter = activeReadingFilter === value ? "all" : value;
      // One nav group is active at a time, or the title would have to describe two filters at once.
      if (activeReadingFilter !== "all" && activeMetadataFilter) {
        activeMetadataFilter = false;
        syncMetadataFilterButtons();
      }
      for (const other of readingFilterButtons()) {
        other.classList.toggle("active", other.dataset.readingFilter === activeReadingFilter);
      }
      renderKnowledgeBase();
    });
  }
  for (const button of knowledgeMetadataFilterButtons) {
    button.addEventListener("click", () => {
      activeMetadataFilter = !activeMetadataFilter;
      if (activeMetadataFilter) {
        activeReadingFilter = "all";
        for (const other of readingFilterButtons()) other.classList.remove("active");
      }
      syncMetadataFilterButtons();
      renderKnowledgeBase();
    });
  }
  for (const button of knowledgeTableSortButtons) {
    button.addEventListener("click", () => {
      const key = button.dataset.knowledgeSort as LibrarySortKey | undefined;
      if (!key) return;
      const current = readLibrarySort();
      // Same column toggles the direction; a new column starts in the direction that shows the interesting end first.
      const descending = current.key === key
        ? !current.descending
        : key === "date" || key === "pages";
      button.dataset.sortDirection = descending ? "desc" : "asc";
      for (const other of knowledgeTableSortButtons) {
        if (other !== button) delete other.dataset.sortDirection;
      }
      renderKnowledgeBase();
    });
  }
  knowledgeDetailCloseButton.addEventListener("click", () => {
    selectLibraryDocument(null);
  });

  // 全选只针对当前筛选出来的列表：筛选之外的文献用户看不见，也就不该被批量操作带上。
  knowledgeSelectAllCheckbox.addEventListener("change", () => {
    updateSelection(knowledgeSelectAllCheckbox.checked
      ? selectVisibleDocuments(visibleDocumentIds)
      : EMPTY_SELECTION);
  });
  knowledgeBatchClearButton.addEventListener("click", () => updateSelection(EMPTY_SELECTION));
  knowledgeBatchMoveButton.addEventListener("click", () => {
    libraryActions.batch.moveToFolder([...selectedDocumentIds], knowledgeBatchFolderSelect.value || null);
    updateSelection(EMPTY_SELECTION);
  });
  knowledgeBatchRelatedButton.addEventListener("click", () => {
    // `runRelated` shows the cost/skip confirmation itself and reports progress in the page status line. The selection
    // is only dropped when a run actually started — cancelling the confirmation must not clear what the user picked.
    void libraryActions.batch.runRelated([...selectedDocumentIds]).then((started) => {
      if (started) updateSelection(EMPTY_SELECTION);
    });
  });
  knowledgeBatchRemoveButton.addEventListener("click", () => {
    if (libraryActions.batch.remove([...selectedDocumentIds])) updateSelection(EMPTY_SELECTION);
  });
  window.addEventListener("pdf-helper:knowledge-corpus-change", () => {
    if (getActiveWorkspaceView() === "knowledge") renderKnowledgeBase();
  });
  // A metadata lookup writes nothing, so it must not go through the corpus change event (which rebuilds the table).
  // Only the inspector's suggestion block changes, and the panel is re-rendered from the current records.
  window.addEventListener("pdf-helper:knowledge-metadata-lookup", () => {
    if (getActiveWorkspaceView() !== "knowledge") return;
    renderKnowledgeBase();
  });
}

/** Keeps the 缺元数据 nav button's active state in sync with the flag (also used when a reading filter takes over). */
function syncMetadataFilterButtons(): void {
  for (const button of knowledgeMetadataFilterButtons) {
    button.classList.toggle("active", activeMetadataFilter);
  }
}

/** The three sidebar reading filters, read from the DOM so the markup stays the single source of truth. */
function readingFilterButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-reading-filter]"));
}



export function refreshKnowledgeBaseIfOpen(): void {
  if (getActiveWorkspaceView() === "knowledge") renderKnowledgeBase();
}

export function openKnowledgeBasePage(): void {
  const openToken = ++knowledgeOpenToken;
  knowledgeBaseEntryButton.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");
  setCurrentApplicationView("knowledge");
  knowledgeBasePageElement.scrollTop = 0;
  void transitionWorkspaceView("knowledge").then(() => {
    if (
      openToken !== knowledgeOpenToken ||
      getActiveWorkspaceView() !== "knowledge"
    ) {
      return;
    }
    requestAnimationFrame(() => {
      if (
        openToken === knowledgeOpenToken &&
        getActiveWorkspaceView() === "knowledge"
      ) {
        renderKnowledgeBase();
      }
    });
  });
}



export function closeKnowledgeBasePage(): void {
  if (getActiveWorkspaceView() !== "knowledge") return;
  knowledgeOpenToken += 1;
  knowledgeBaseEntryButton.classList.remove("active");
  aiPanelToggleButton?.classList.add("active");
  setCurrentApplicationView("viewer");
  void transitionWorkspaceView("viewer");
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
