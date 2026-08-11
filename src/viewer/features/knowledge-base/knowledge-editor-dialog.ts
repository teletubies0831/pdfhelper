import { knowledgeEditorTargetKey } from "../../core/pdf-reader/public";

import { openReadingJournalEditor, openReadingJournalPage } from "../paper-card/public";
import { knowledgeEditorBodyInput, knowledgeEditorBodyModeLabel, knowledgeEditorCategoryInput, knowledgeEditorDeleteButton, knowledgeEditorDialog, knowledgeEditorEditPane, knowledgeEditorForm, knowledgeEditorHeading, knowledgeEditorModeToggleButton, knowledgeEditorPreviewElement, knowledgeEditorPreviewPane, knowledgeEditorSource, knowledgeEditorTagsInput, knowledgeEditorTitleInput } from "../../app/viewer-elements";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import { pdfViewer, sourceName } from "../../app/viewer-state";
import { getDisplayFileName } from "../../core/pdf-reader/public";


import type { KnowledgeItem } from "../../core/pdf-reader/public";
import { knowledgeEditorBodyMode, knowledgeEditorPreviewTimer } from './research-controller';
import type { KnowledgeEditorBodyMode } from './research-controller';
import { normalizeKnowledgeCategory, readReadingJournalEntries } from './knowledge-repository';


import { prepareKnowledgeEditorMarkdown } from "./knowledge-markdown-normalizer";

export function renderKnowledgeEditorPreview(): void {
  window.clearTimeout(knowledgeEditorPreviewTimer.value);
  const content = knowledgeEditorBodyInput.value.trim();
  if (!content) {
    knowledgeEditorPreviewElement.innerHTML = `
      <div class="knowledge-editor-preview-empty">
        <span aria-hidden="true">∑</span>
        <strong>正文排版会显示在这里</strong>
        <p>支持 Markdown、原文与翻译分节，以及 LaTeX 公式。</p>
      </div>
    `;
    return;
  }

  renderChatMarkdown(
    knowledgeEditorPreviewElement,
    prepareKnowledgeEditorMarkdown(content),
    false,
    true,
  );
}

export function scheduleKnowledgeEditorPreview(): void {
  window.clearTimeout(knowledgeEditorPreviewTimer.value);
  knowledgeEditorPreviewTimer.value = window.setTimeout(
    renderKnowledgeEditorPreview,
    120,
  );
}

export function setKnowledgeEditorBodyMode(
  mode: KnowledgeEditorBodyMode,
  focusEditor = false,
): void {
  knowledgeEditorBodyMode.value = mode;
  const editing = mode === "edit";

  knowledgeEditorEditPane.hidden = !editing;
  knowledgeEditorPreviewPane.hidden = editing;
  knowledgeEditorModeToggleButton.textContent = editing
    ? "查看排版"
    : "编辑正文";
  knowledgeEditorModeToggleButton.setAttribute(
    "aria-pressed",
    String(editing),
  );
  knowledgeEditorBodyModeLabel.textContent = editing
    ? "编辑正文"
    : "排版正文";

  if (editing) {
    if (focusEditor) {
      requestAnimationFrame(() => {
        knowledgeEditorBodyInput.focus();
        knowledgeEditorBodyInput.setSelectionRange(
          knowledgeEditorBodyInput.value.length,
          knowledgeEditorBodyInput.value.length,
        );
      });
    }
    return;
  }

  renderKnowledgeEditorPreview();
}

export function openKnowledgeEditor(item?: KnowledgeItem): void {
  if (item?.source === "reading-journal") {
    const entry = readReadingJournalEntries().find((candidate) => candidate.id === item.id);
    if (entry) {
      openReadingJournalPage();
      openReadingJournalEditor(entry);
    }
    return;
  }
  knowledgeEditorTargetKey.value = item?.recordKey || null;
  knowledgeEditorDialog.dataset.kind = item?.kind || "note";
  document.documentElement.classList.add("knowledge-editor-open");
  knowledgeEditorHeading.textContent = item
    ? item.kind === "note"
      ? "编辑笔记"
      : "编辑阅读卡片"
    : "新建笔记";
  knowledgeEditorSource.textContent = item
    ? `${item.documentName} · ${item.positionLabel}`
    : sourceName.value
      ? `${getDisplayFileName(sourceName.value)} · 第 ${Math.max(1, pdfViewer.currentPageNumber || 1)} 页`
      : "保存到本地知识库";
  knowledgeEditorTitleInput.value = item?.title || "";
  knowledgeEditorCategoryInput.value = normalizeKnowledgeCategory(
    item?.category || "AI 笔记",
  );
  knowledgeEditorTagsInput.value = item?.tags.join(", ") || "";
  knowledgeEditorBodyInput.value = item?.content || "";
  knowledgeEditorDeleteButton.hidden = !item;
  knowledgeEditorDialog.hidden = false;
  requestAnimationFrame(() => {
    setKnowledgeEditorBodyMode(item ? "preview" : "edit");
    if (!item) knowledgeEditorTitleInput.focus();
  });
}

export function closeKnowledgeEditor(): void {
  window.clearTimeout(knowledgeEditorPreviewTimer.value);
  knowledgeEditorDialog.hidden = true;
  knowledgeEditorDialog.removeAttribute("data-kind");
  document.documentElement.classList.remove("knowledge-editor-open");
  knowledgeEditorDeleteButton.hidden = true;
  knowledgeEditorPreviewElement.replaceChildren();
  knowledgeEditorBodyMode.value = "preview";
  knowledgeEditorTargetKey.value = null;
  knowledgeEditorForm.reset();
}
