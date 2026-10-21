import {
  getKnowledgeDocument,
  listKnowledgeDocuments,
  listKnowledgeFolders,
  removeKnowledgeDocument,
  updateKnowledgeDocument,
} from './knowledge-corpus-repository';
import { syncCurrentPdfLibraryButton } from './current-pdf-add-to-library';
import { openKnowledgePdfOverview } from './knowledge-pdf-overview';
import {
  isRelatedPapersSearchRunning,
  relatedPapersAvailability,
  searchRelatedPapers,
} from './knowledge-related-papers';
import { openLibraryContextMenu } from './library-context-menu';
import { openCitationDialog } from './citation-dialog';
import {
  describeBatchRelatedPlan,
  formatBatchCost,
  planBatchRelatedPapers,
  RELATED_SEARCH_COST_YUAN,
} from './library-batch-actions';
import type { LibraryTableHandlers } from './library-table';
import type { DocumentPanelHandlers } from './library-doc-panel';
import {
  applyExtractedMetadata,
  getDocumentOverviewMarkdown,
  markDocumentMetadataFailed,
  markDocumentOpened,
  nextReadingStatus,
  readReadingStatus,
  resumeDocumentMetadata,
  saveManualDocumentMetadata,
  setDocumentReadingStatus,
  skipDocumentMetadata,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';
import { clearMetadataLookup, lookupDocumentMetadata } from './metadata-lookup';
import { getDocumentChatId } from '../../app/document-identity';
import { webRetrievalConfig } from '../../app/public';
import { pdfDocument } from '../../app/viewer-state';
import { openSourcePdfFromKnowledge, relinkSourcePdfFromPicker } from '../../shared-ui/navigation/source-pdf-navigation';
import { extractDocumentMetadataFor } from './document-metadata-extraction';
import { readPdfHeadText } from './pdf-text-extraction';

/**
 * Everything the library can *do* to a document.
 *
 * Split from the controller (which decides what to draw) for the same reason the graph page splits its action layer: the
 * two change for different reasons, and this file was the one pushing `knowledge-base-controller.ts` past its size
 * limit. The controller supplies the three things only it knows — how to re-render, what is selected, and where to report
 * — through `LibraryActionPorts`.
 */

export interface LibraryActionPorts {
  /** Re-renders the page after a change. */
  refresh(): void;
  /** Selects a document, or clears the selection with `null`. */
  select(documentId: string | null): void;
  /** Page-level message (`#knowledge-page-status`). */
  status(message: string, isError?: boolean): void;
  /** Leaves the knowledge page, used when a PDF opened and the reader took over. */
  leavePage(): void;
}

export interface LibraryActions {
  /** Everything the table and the cards share; the controller adds `toggleSelect`, which is pure view state. */
  table: Omit<LibraryTableHandlers, 'toggleSelect'>;
  panel: DocumentPanelHandlers;
  batch: LibraryBatchActions;
}

/**
 * 批量操作，one method per action.
 *
 * The controller passes the selected ids in and gets nothing back: these methods own the confirmation, the progress
 * reporting and the writes, exactly like their single-document counterparts above. `planRelated` is separate from
 * `runRelated` because the cost and the skip list have to be shown *before* anything is spent.
 */
export interface LibraryBatchActions {
  planRelated(documentIds: readonly string[]): ReturnType<typeof planBatchRelatedPapers>;
  /** Resolves `true` when the run actually started — the caller keeps the selection if the user cancelled. */
  runRelated(documentIds: readonly string[]): Promise<boolean>;
  moveToFolder(documentIds: readonly string[], folderId: string | null): void;
  /** Resolves `false` when the user cancelled the confirmation. */
  remove(documentIds: readonly string[]): boolean;
}


export function createLibraryActions(ports: LibraryActionPorts): LibraryActions {
  const find = (documentId: string): KnowledgeLibraryDocument | null => (
    listKnowledgeDocuments().find((item) => item.documentId === documentId) ?? null
  );

  /**
   * Opens the PDF in the reader.
   *
   * Opening a paper *is* starting to read it, so the status moves to 在读 here — the one place a document field changes
   * without the user asking, which is why the rule (never downgrade 已读) lives in the module instead of here.
   */
  const openDocument = (documentId: string): void => {
    const item = find(documentId);
    if (!item) return;
    markDocumentOpened(item.documentId);
    const hadOpenPdf = Boolean(pdfDocument.value);
    ports.status(`正在打开「${item.documentName}」…`);
    void openSourcePdfFromKnowledge(item.documentName, item.recentEntryId, 1, item.documentId).then(async (opened) => {
      if (!opened) {
        // The link rotted (the 12-entry 最近打开 list rotated it out) or the file really is gone. Say which one we can
        // actually know — we cannot know — and offer the one action that fixes it either way.
        const linkBroken = !window.confirm(
          `找不到「${item.documentName}」的本地文件关联。「最近打开」只保留 12 项，时间久了的记录会被挤出这张表——文件通常还在原处。\n\n现在选择这份 PDF 文件恢复关联吗？（选定后会重新建立索引）`,
        );
        if (linkBroken) {
          ports.status('已取消。下次可以在「最近打开」里重新打开这份 PDF，再添加到知识库。', false);
          ports.refresh();
          return;
        }
        const relinked = await relinkSourcePdfFromPicker(item.documentId, item.documentName);
        ports.status(
          relinked ? '已重新关联，正在重建索引…' : '没有重新关联：选择被取消，或文件打不开。',
          !relinked,
        );
        if (relinked && !hadOpenPdf) ports.leavePage();
        ports.refresh();
        return;
      }
      ports.status('');
      // The reader is now the surface in front of the user; the library stays open behind it only if a PDF was
      // already loaded there.
      if (!hadOpenPdf) ports.leavePage();
      ports.refresh();
    });
  };

  const cycleReading = (documentId: string): void => {
    const item = find(documentId);
    if (!item) return;
    setDocumentReadingStatus(documentId, nextReadingStatus(readReadingStatus(item)));
    ports.refresh();
  };

  const openOverview = (documentId: string): void => {
    const item = find(documentId);
    if (item) openKnowledgePdfOverview(item);
  };

  const searchRelated = (documentId: string): void => {
    const item = find(documentId);
    if (!item) return;
    void searchRelatedPapers(item).finally(() => ports.refresh());
  };

  /**
   * The manual 「提取元数据」 path.
   *
   * It needs text, and an already-indexed document has none at hand — the index stores vectors, not prose. So: the
   * open PDF's first pages when this *is* that document, otherwise the overview the library already has, otherwise a
   * stated failure instead of a button that appears to do nothing.
   */
  const extractMetadata = async (documentId: string): Promise<void> => {
    const item = find(documentId);
    if (!item) return;
    const openPdf = pdfDocument.value;
    const text = openPdf && getDocumentChatId(openPdf) === documentId
      ? await readPdfHeadText(openPdf).catch(() => '')
      : getDocumentOverviewMarkdown(item).slice(0, 6_000);
    if (!text.trim()) {
      markDocumentMetadataFailed(
        documentId,
        '没有可用正文：先打开这份 PDF，或先生成概览，再提取元数据。',
      );
      ports.refresh();
      return;
    }
    // The extraction module records the outcome (and dispatches the corpus-change event the page listens to).
    await extractDocumentMetadataFor(documentId, { documentName: item.documentName, text });
  };

  const openGraph = (documentId: string): void => {
    // A dynamic import, like `graph-removal-bridge`: the graph page imports this feature back (the overview dialog),
    // so a static import here would be a module cycle.
    void import('./graph-navigation-bridge')
      .then((bridge) => bridge.openGraphForDocument(documentId))
      .catch(() => undefined);
  };

  /**
   * Removes one document and everything derived from it.
   *
   * The library record goes first, then the graph: left behind, its entities, edges and extraction jobs would outlive
   * the document (the graph would claim relationships to a paper the user removed, and a later re-add would silently
   * skip extraction because a stale `done` job was still recorded).
   */
  const removeDocument = (documentId: string): void => {
    removeKnowledgeDocument(documentId);
    void import('./graph-removal-bridge')
      .then((bridge) => bridge.removeDocumentFromGraph(documentId))
      .catch(() => undefined);
  };

  const remove = (documentId: string, confirmFirst = true): void => {
    const item = find(documentId);
    if (!item) return;
    if (confirmFirst && !window.confirm('将这份 PDF 移出知识库吗？它将不再参与跨文献检索。')) return;
    removeDocument(documentId);
    syncCurrentPdfLibraryButton();
    ports.select(null);
  };

  /** Both ways in (the bar and the context menu) go through one plan, so the confirmation cannot drift apart. */
  const planRelated = (documentIds: readonly string[]) => planBatchRelatedPapers(
    documentIds.map(find).filter((item): item is KnowledgeLibraryDocument => Boolean(item)),
    {
      webRetrievalReady: webRetrievalConfig.value !== null,
      isRunning: isRelatedPapersSearchRunning,
    },
  );

  /**
   * Runs the plan one document at a time.
   *
   * Sequential on purpose: parallel retrieval would fire N web searches at once, which the DeepSeek endpoint
   * rate-limits and which would make the progress line meaningless. Success is read back from the record (a new
   * `relatedLiteratureAt`) rather than from the return value, because `searchRelatedPapers` reports failures through a
   * floating notice and returns nothing.
   */
  const runRelated = async (documentIds: readonly string[]): Promise<boolean> => {
    const plan = planRelated(documentIds);
    if (!plan.runnable.length) {
      const reason = plan.skipped[0]?.reason ?? '没有选中的文献。';
      ports.status(`没有可检索的文献：${reason}`, true);
      return false;
    }
    if (!window.confirm(describeBatchRelatedPlan(plan))) return false;
    let succeeded = 0;
    const failures: string[] = [];
    for (const [index, item] of plan.runnable.entries()) {
      ports.status(`批量检索相关论文 ${index + 1}/${plan.runnable.length}：${item.documentName}`);
      const before = getKnowledgeDocument(item.documentId)?.relatedLiteratureAt ?? '';
      await searchRelatedPapers(item);
      const after = getKnowledgeDocument(item.documentId);
      // `saveRelatedLiterature` writes `relatedLiteratureAt` even for a degraded result ("this is not a paper, nothing
      // to look up"), so the timestamp alone would report those as successes. The error field is what distinguishes
      // "looked up and found something" from "looked up and got a footnote".
      const finished = Boolean(after?.relatedLiteratureAt) && after?.relatedLiteratureAt !== before;
      if (finished && !after?.relatedLiteratureError) succeeded += 1;
      else failures.push(item.documentName.replace(/\.pdf$/i, ''));
    }
    const summary = [`已检索 ${succeeded}/${plan.runnable.length} 篇文献`];
    if (plan.skipped.length) summary.push(`跳过 ${plan.skipped.length} 篇`);
    if (failures.length) summary.push(`失败 ${failures.length} 篇：${failures.slice(0, 3).join('、')}`);
    summary.push(`预估 ${formatBatchCost(plan.estimatedCostYuan)}，实际以每次联网调用计费为准`);
    ports.status(summary.join(' · '), failures.length > 0);
    ports.refresh();
    return true;
  };

  const moveToFolder = (documentIds: readonly string[], folderId: string | null): void => {
    const documents = documentIds.map(find).filter((item): item is KnowledgeLibraryDocument => Boolean(item));
    if (!documents.length) return;
    for (const item of documents) updateKnowledgeDocument(item.documentId, { folderId });
    const folderName = folderId
      ? listKnowledgeFolders().find((folder) => folder.id === folderId)?.name ?? '目标文件夹'
      : '未分类';
    ports.status(`已把 ${documents.length} 篇文献移动到「${folderName}」。`);
    ports.refresh();
  };

  const removeSelected = (documentIds: readonly string[]): boolean => {
    const documents = documentIds.map(find).filter((item): item is KnowledgeLibraryDocument => Boolean(item));
    if (!documents.length) return false;
    const confirmation = `将选中的 ${documents.length} 篇 PDF 移出知识库吗？它们将不再参与跨文献检索，图谱中的实体与关系也会一并移除。`;
    if (!window.confirm(confirmation)) return false;
    for (const item of documents) removeDocument(item.documentId);
    syncCurrentPdfLibraryButton();
    ports.status(`已移出 ${documents.length} 篇文献。`);
    // The inspector's document may be among them, and the batch is over either way.
    ports.select(null);
    return true;
  };

  return {
    table: {
      select: ports.select,
      open: openDocument,
      cycleReading,
      contextMenu: (documentId, x, y) => {
        const item = find(documentId);
        if (!item) return;
        const status = readReadingStatus(item);
        openLibraryContextMenu([
          { label: '打开原文', onSelect: () => openDocument(documentId) },
          { label: '查看概览', onSelect: () => openOverview(documentId) },
          {
            label: '检索相关论文',
            disabled: !relatedPapersAvailability(item).available,
            onSelect: () => searchRelated(documentId),
          },
          {
            label: `标记为${{ todo: '在读', reading: '已读', done: '待读' }[status]}`,
            onSelect: () => cycleReading(documentId),
          },
          { label: '在图谱中查看', onSelect: () => openGraph(documentId) },
          { label: '移出知识库', danger: true, onSelect: () => remove(documentId) },
        ], x, y);
      },
    },
    panel: {
      openOverview,
      openSource: openDocument,
      openGraph,
      remove: (documentId) => remove(documentId),
      searchRelated,
      // 引文只读当前那条记录；对话框自己负责格式切换与复制。
      openCitation: (documentId) => {
        const item = getKnowledgeDocument(documentId);
        if (item) openCitationDialog(item);
      },
      extractMetadata: (documentId) => {
        void extractMetadata(documentId);
      },
      saveMetadata: (documentId, metadata) => {
        // The user's own words: every field this touches is labelled `manual`, which no automatic pass may overwrite.
        saveManualDocumentMetadata(documentId, metadata);
        ports.refresh();
      },
      toggleMetadataSkip: (documentId, skipped) => {
        if (skipped) skipDocumentMetadata(documentId);
        else resumeDocumentMetadata(documentId);
        ports.refresh();
      },
      lookupMetadata: (documentId) => {
        const item = getKnowledgeDocument(documentId);
        if (!item) return;
        void lookupDocumentMetadata(item).then(() => ports.refresh());
      },
      applyMetadataSuggestion: (documentId, candidate) => {
        // Only reached through an 「填入」 click on an accepted candidate — the gate already refused everything else, and
        // nothing here runs automatically. `manual` fields keep their lock, so a value the user typed is never replaced.
        applyExtractedMetadata(documentId, {
          // The online candidate carries a subtitle-qualified title from Crossref/OpenAlex; it may be better than what the
          // first page said, and `applyExtractedMetadata` keeps any value the user typed by hand.
          title: candidate.title ?? '',
          authors: candidate.authors,
          publishDate: candidate.publishDate,
          language: '',
          documentUrl: candidate.documentUrl,
          doi: candidate.doi,
          // 出版信息: without these the GB/T citation cannot say 刊名/卷(期)/页码, which is most of what makes it a citation.
          containerTitle: candidate.containerTitle ?? '',
          volume: candidate.volume ?? '',
          issue: candidate.issue ?? '',
          page: candidate.page ?? '',
          publisher: candidate.publisher ?? '',
          publisherPlace: candidate.publisherPlace ?? '',
          issn: candidate.issn ?? '',
          isbn: candidate.isbn ?? '',
          publicationKind: candidate.kind ?? '',
        }, 'online');
        clearMetadataLookup(documentId);
        ports.refresh();
      },
      dismissMetadataSuggestions: (documentId) => {
        clearMetadataLookup(documentId);
        ports.refresh();
      },
      changeReading: (documentId, status) => {
        if (!status) return;
        setDocumentReadingStatus(documentId, status);
        ports.refresh();
      },
      moveToFolder: (documentId, folderId) => {
        updateKnowledgeDocument(documentId, { folderId });
        ports.refresh();
      },
    },
    batch: {
      planRelated,
      runRelated,
      moveToFolder,
      remove: removeSelected,
    },
  };
}
