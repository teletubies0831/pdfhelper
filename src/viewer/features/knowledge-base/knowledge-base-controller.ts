















import { persistCurrentAppViewState, resolvedReadingMode, selectedKnowledgeRecordKey } from "../../core/pdf-reader/public";


import { aiPanelToggleButton, appFrame, knowledgeBaseEntryButton, knowledgeBasePageElement, knowledgeDocumentCountElement, knowledgeGroupSelect, knowledgeListElement, knowledgePageSubtitleElement, knowledgePageTitleElement, knowledgeSearchInput, knowledgeSortSelect, knowledgeTotalCountElement, readerWorkspaceElement } from "../../app/viewer-elements";
import { setCurrentApplicationView } from "../assistant/public";




import type { KnowledgeItem, SavedKnowledgeNote } from "../../core/pdf-reader/public";
import { collectKnowledgeItems, getKnowledgeRecordKey, normalizeKnowledgeCategory, readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import {
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  listKnowledgeDocuments,
  listKnowledgeFolders,
  removeKnowledgeDocument,
  updateKnowledgeDocument,
} from "./knowledge-corpus-repository";
import { syncCurrentPdfLibraryButton } from "./current-pdf-add-to-library";
import { openKnowledgePdfOverview, registerKnowledgePdfOverviewEvents } from "./knowledge-pdf-overview";




export function renderKnowledgeBase(): void {
  const folders = listKnowledgeFolders();
  const documents = listKnowledgeDocuments();
  const query = knowledgeSearchInput.value.trim().toLocaleLowerCase();
  let filtered = documents.filter((document) =>
    (!query || document.documentName.toLocaleLowerCase().includes(query))
    && (activeCorpusFolder === "all"
      || (activeCorpusFolder === "unfiled" && !document.folderId)
      || document.folderId === activeCorpusFolder),
  );
  filtered.sort((left, right) => {
    if (knowledgeSortSelect.value === "title") return left.documentName.localeCompare(right.documentName);
    if (knowledgeSortSelect.value === "oldest") return left.addedAt.localeCompare(right.addedAt);
    return right.addedAt.localeCompare(left.addedAt);
  });

  knowledgeGroupSelect.value = "none";
  knowledgePageTitleElement.textContent = activeCorpusFolder === "all"
    ? "知识库"
    : activeCorpusFolder === "unfiled"
      ? "未分类"
      : folders.find((folder) => folder.id === activeCorpusFolder)?.name || "知识库";
  if (knowledgePageSubtitleElement) knowledgePageSubtitleElement.textContent = "管理你主动添加的 PDF，并为跨文献问答提供全文检索。";
  knowledgeTotalCountElement.textContent = String(filtered.length);
  knowledgeDocumentCountElement.textContent = String(documents.length);
  renderCorpusSidebar(folders, documents);
  renderCorpusDocuments(filtered, folders);
  persistCurrentAppViewState();
}

let activeCorpusFolder = "all";
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

function buildCorpusFolderOptions(
  folders: ReturnType<typeof listKnowledgeFolders>,
  selectedId: string | null,
  parentId: string | null = null,
  depth = 0,
): string {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((folder) => {
      const prefix = depth ? `${"　".repeat(depth)}↳ ` : "";
      return `<option value="${folder.id}"${selectedId === folder.id ? " selected" : ""}>${prefix}${escapeCorpusHtml(folder.name)}</option>${buildCorpusFolderOptions(folders, selectedId, folder.id, depth + 1)}`;
    })
    .join("");
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

function escapeCorpusHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function renderCorpusDocuments(
  documents: ReturnType<typeof listKnowledgeDocuments>,
  folders: ReturnType<typeof listKnowledgeFolders>,
): void {
  if (!documents.length) {
    knowledgeListElement.innerHTML = `<div class="knowledge-list-empty"><img src="/resources/no-data.svg" alt="" /><strong>这里还没有 PDF</strong><p>打开一份 PDF，点击顶部“添加到知识库”即可建立全文索引。</p></div>`;
    return;
  }
  knowledgeListElement.innerHTML = documents.map((item) => {
    const status = item.indexStatus === "ready"
      ? `已索引 · ${item.chunkCount} 个片段`
      : item.indexStatus === "indexing" ? "正在建立全文索引…"
        : item.indexStatus === "error" ? "索引失败" : "等待建立索引";
    const hasOverview = Boolean(item.overviewMarkdown?.trim());
    const overviewStatus = hasOverview
      ? "PDF 概览已生成"
      : item.overviewStatus === "generating"
        ? "PDF 概览处理中…"
        : item.overviewStatus === "error"
          ? "PDF 概览生成失败"
          : "PDF 概览待生成";
    const overviewButtonText = hasOverview
      ? "查看概览"
      : item.overviewStatus === "generating"
        ? "处理中…"
        : "生成概览";
    return `<article class="knowledge-pdf-card" data-document-id="${escapeCorpusHtml(item.documentId)}">
      <div class="knowledge-pdf-icon">PDF</div>
      <div class="knowledge-pdf-body">
        <h2><button type="button" class="knowledge-pdf-title-button" data-introduce-document="${escapeCorpusHtml(item.documentId)}" title="查看这份 PDF 的智能概览">${escapeCorpusHtml(item.documentName)}</button></h2>
        <p>${item.pageCount} 页 · ${new Date(item.addedAt).toLocaleDateString()} · <span class="index-${item.indexStatus}">${status}</span> · <span>${overviewStatus}</span></p>
        <label>文件夹 <select data-move-document="${escapeCorpusHtml(item.documentId)}">
          <option value="">未分类</option>
          ${buildCorpusFolderOptions(folders, item.folderId)}
        </select></label>
      </div>
      <div class="knowledge-pdf-actions">
        <button type="button" class="knowledge-ai-intro-button" data-introduce-document="${escapeCorpusHtml(item.documentId)}" ${item.overviewStatus === "generating" ? "disabled" : ""}>${overviewButtonText}</button>
        <button type="button" class="danger-button" data-remove-document="${escapeCorpusHtml(item.documentId)}">移出知识库</button>
      </div>
    </article>`;
  }).join("");
}

export function registerKnowledgeCorpusEvents(): void {
  registerKnowledgePdfOverviewEvents();
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
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-move-document]");
    if (!select?.dataset.moveDocument) return;
    updateKnowledgeDocument(select.dataset.moveDocument, { folderId: select.value || null });
    renderKnowledgeBase();
  });
  knowledgeListElement.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLButtonElement>("[data-remove-document]");
    if (remove?.dataset.removeDocument) {
      if (!window.confirm("将这份 PDF 移出知识库吗？它将不再参与跨文献检索。")) return;
      removeKnowledgeDocument(remove.dataset.removeDocument);
      syncCurrentPdfLibraryButton();
      renderKnowledgeBase();
      return;
    }
    const introduce = target.closest<HTMLButtonElement>("[data-introduce-document]");
    if (introduce?.dataset.introduceDocument) {
      const item = listKnowledgeDocuments().find((document) => document.documentId === introduce.dataset.introduceDocument);
      if (item) openKnowledgePdfOverview(item);
      return;
    }
  });
  window.addEventListener("pdf-helper:knowledge-corpus-change", () => {
    if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
  });
}



export function refreshKnowledgeBaseIfOpen(): void {
  if (!knowledgeBasePageElement.hidden) renderKnowledgeBase();
}

type WorkspaceView = "viewer" | "knowledge";

let activeWorkspaceView: WorkspaceView = knowledgeBasePageElement.hidden
  ? "viewer"
  : "knowledge";
let workspaceTransitionToken = 0;
let workspaceAnimations: Animation[] = [];

function cancelWorkspaceTransition(): void {
  workspaceTransitionToken += 1;
  for (const animation of workspaceAnimations) animation.cancel();
  workspaceAnimations = [];
  appFrame?.classList.remove("workspace-view-transitioning");
  appFrame?.style.removeProperty("--workspace-transition-top");
}

function setWorkspaceViewImmediately(view: WorkspaceView): void {
  cancelWorkspaceTransition();
  activeWorkspaceView = view;
  const knowledgeVisible = view === "knowledge";
  knowledgeBasePageElement.hidden = !knowledgeVisible;
  knowledgeBasePageElement.inert = !knowledgeVisible;
  readerWorkspaceElement.inert = knowledgeVisible;
  knowledgeBasePageElement.toggleAttribute("aria-hidden", !knowledgeVisible);
  readerWorkspaceElement.toggleAttribute("aria-hidden", knowledgeVisible);
  appFrame?.classList.toggle("knowledge-base-page-open", knowledgeVisible);
}

async function transitionWorkspaceView(view: WorkspaceView): Promise<void> {
  if (!workspaceAnimations.length) {
    activeWorkspaceView = knowledgeBasePageElement.hidden ? "viewer" : "knowledge";
  }
  if (!appFrame || view === activeWorkspaceView) {
    setWorkspaceViewImmediately(view);
    return;
  }

  const outgoingView = activeWorkspaceView;
  setWorkspaceViewImmediately(outgoingView);
  const transitionToken = ++workspaceTransitionToken;
  activeWorkspaceView = view;
  const forward = view === "knowledge";
  const outgoing = forward ? readerWorkspaceElement : knowledgeBasePageElement;
  const incoming = forward ? knowledgeBasePageElement : readerWorkspaceElement;
  const contentTop = outgoing.getBoundingClientRect().top;

  appFrame.style.setProperty("--workspace-transition-top", `${contentTop}px`);
  appFrame.classList.add("workspace-view-transitioning");
  appFrame.classList.toggle("knowledge-base-page-open", view === "knowledge");
  knowledgeBasePageElement.hidden = false;
  outgoing.inert = true;
  incoming.inert = false;
  outgoing.setAttribute("aria-hidden", "true");
  incoming.removeAttribute("aria-hidden");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setWorkspaceViewImmediately(view);
    return;
  }

  const timing: KeyframeAnimationOptions = {
    duration: 360,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "both",
  };
  const outgoingAnimation = outgoing.animate([
    { transform: "translate3d(0, 0, 0)", opacity: 1 },
    {
      transform: forward
        ? "translate3d(-100%, 0, 0)"
        : "translate3d(100%, 0, 0)",
      opacity: 0.94,
    },
  ], timing);
  const incomingAnimation = incoming.animate([
    {
      transform: forward
        ? "translate3d(100%, 0, 0)"
        : "translate3d(-100%, 0, 0)",
      opacity: 0.94,
    },
    { transform: "translate3d(0, 0, 0)", opacity: 1 },
  ], timing);
  workspaceAnimations = [outgoingAnimation, incomingAnimation];

  await Promise.allSettled(workspaceAnimations.map((animation) => animation.finished));
  if (transitionToken !== workspaceTransitionToken) return;
  const completedAnimations = workspaceAnimations;
  workspaceAnimations = [];
  for (const animation of completedAnimations) animation.cancel();
  const knowledgeVisible = view === "knowledge";
  knowledgeBasePageElement.hidden = !knowledgeVisible;
  knowledgeBasePageElement.inert = !knowledgeVisible;
  readerWorkspaceElement.inert = knowledgeVisible;
  knowledgeBasePageElement.toggleAttribute("aria-hidden", !knowledgeVisible);
  readerWorkspaceElement.toggleAttribute("aria-hidden", knowledgeVisible);
  appFrame.classList.toggle("knowledge-base-page-open", knowledgeVisible);
  appFrame.classList.remove("workspace-view-transitioning");
  appFrame.style.removeProperty("--workspace-transition-top");
}



export function openKnowledgeBasePage(): void {
  knowledgeBaseEntryButton.classList.add("active");
  aiPanelToggleButton?.classList.remove("active");
  setCurrentApplicationView("knowledge");
  knowledgeBasePageElement.scrollTop = 0;
  renderKnowledgeBase();
  void transitionWorkspaceView("knowledge");
}



export function closeKnowledgeBasePage(): void {
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
