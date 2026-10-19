import {
  isRelatedPapersSearchRunning,
  relatedPapersAvailability,
} from './knowledge-related-papers';
import { knowledgeListElement } from '../../app/viewer-elements';
import { readReadingStatus, READING_STATUS_LABELS } from '../../../modules/knowledge/public';
import type { KnowledgeFolder, KnowledgeLibraryDocument } from './knowledge-corpus-repository';

/**
 * 卡片视图与文件夹下拉选项。
 *
 * Split out of the controller when it reached its size limit, and the seam is real: both functions turn corpus data
 * into markup and nothing else. The state they need — which document the inspector shows, which ones a batch has
 * ticked, how many documents the library holds — is passed in, so this module cannot disagree with the controller.
 */

export interface CardViewState {
  /** Total documents in the library, so "no matches for this filter" is distinguishable from "nothing added yet". */
  libraryDocumentCount: number;
  /** The document the inspector shows. */
  selectedId: string | null;
  /** The documents a batch would act on. */
  selection: ReadonlySet<string>;
}

/** Escapes a value for the template strings below; the DOM does the escaping, so no hand-written table is needed. */
export function escapeCorpusHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export function renderCorpusDocuments(
  documents: readonly KnowledgeLibraryDocument[],
  folders: readonly KnowledgeFolder[],
  state: CardViewState,
): void {
  const libraryDocumentCount = state.libraryDocumentCount;
  if (!documents.length) {
    // Two different empty states: a library with nothing in it needs "add a PDF", a filter that matched nothing needs
    // "clear the filter" — telling a user with 40 documents to add one is simply wrong.
    knowledgeListElement.innerHTML = libraryDocumentCount
      ? `<div class="knowledge-list-empty"><img src="/resources/no-data.svg" alt="" /><strong>当前筛选下没有匹配的文献</strong><p>试试清空搜索词，或把左侧的文件夹与阅读状态切回“全部 PDF”。</p></div>`
      : `<div class="knowledge-list-empty"><img src="/resources/no-data.svg" alt="" /><strong>这里还没有 PDF</strong><p>打开一份 PDF，点击顶部“添加到知识库”即可建立全文索引。</p></div>`;
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
    // 「检索相关论文」 sits between 查看概览 and 移出知识库: it belongs with the two things the user already does
    // with a document here, and it keeps the money-spending action out of the overview dialog.
    const related = relatedPapersAvailability(item);
    const relatedRunning = isRelatedPapersSearchRunning(item.documentId);
    const relatedLabel = relatedRunning
      ? "检索中…"
      : item.relatedLiteratureMarkdown?.trim()
        ? "重新检索"
        : "检索相关论文";
    return `<article class="knowledge-pdf-card${item.documentId === state.selectedId ? " is-selected" : ""}${state.selection.has(item.documentId) ? " is-checked" : ""}" data-document-id="${escapeCorpusHtml(item.documentId)}">
      <div class="knowledge-pdf-icon">PDF</div>
      <div class="knowledge-pdf-body">
        <h2><button type="button" class="knowledge-pdf-title-button" data-introduce-document="${escapeCorpusHtml(item.documentId)}" title="查看这份 PDF 的智能概览">${escapeCorpusHtml(item.documentName)}</button></h2>
        <p><button type="button" class="knowledge-reading-chip is-${readReadingStatus(item)}" data-cycle-reading="${escapeCorpusHtml(item.documentId)}" title="点击切换：待读 → 在读 → 已读">${READING_STATUS_LABELS[readReadingStatus(item)]}</button> · ${item.pageCount} 页 · ${new Date(item.addedAt).toLocaleDateString()} · <span class="index-${item.indexStatus}">${status}</span> · <span>${overviewStatus}</span></p>
        <label>文件夹 <select data-move-document="${escapeCorpusHtml(item.documentId)}">
          <option value="">未分类</option>
          ${buildCorpusFolderOptions(folders, item.folderId)}
        </select></label>
      </div>
      <div class="knowledge-pdf-actions">
        <button type="button" class="knowledge-ai-intro-button" data-introduce-document="${escapeCorpusHtml(item.documentId)}">${overviewButtonText}</button>
        <button type="button" class="knowledge-related-button" data-search-related="${escapeCorpusHtml(item.documentId)}"${related.available && !relatedRunning ? "" : ' aria-disabled="true"'} title="${escapeCorpusHtml(related.reason)}">${relatedLabel}</button>
        <button type="button" class="danger-button" data-remove-document="${escapeCorpusHtml(item.documentId)}">移出知识库</button>
        <label class="knowledge-card-check" title="选择这篇文献以进行批量操作">
          <input type="checkbox" data-select-document="${escapeCorpusHtml(item.documentId)}" aria-label="选择 ${escapeCorpusHtml(item.documentName)}"${state.selection.has(item.documentId) ? " checked" : ""} />
        </label>
      </div>
    </article>`;
  }).join("");
}

export function buildCorpusFolderOptions(
  folders: readonly KnowledgeFolder[],
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
