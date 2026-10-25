import { browser } from 'wxt/browser';
import type { DataHealthFinding, DataHealthReport, KnowledgeLibraryDocument } from '../../../modules/knowledge/public';
import { knowledgeDataHealthEntryButton } from '../../app/viewer-elements';
import { readRecentFiles } from '../recent-files/public';
import {
  openDataHealthDialog,
  configureDataHealthDialog,
  registerDataHealthDialogEvents,
  renderDataHealth,
  showDataHealthStatus,
  hideDataHealthStatus,
  closeDataHealthDialog,
} from './data-health-dialog';
import {
  markDocumentUnindexed,
  resetStuckExtraction,
  runDataHealthCheck,
  syncChunkCount,
  type DataHealthRun,
} from './data-health-check';
import { listKnowledgeDocuments, getKnowledgeDocument } from './knowledge-corpus-repository';
import { setStatus } from '../../app/status-bar';
import { extractDocumentMetadataFor } from './document-metadata-extraction';
import { openSourcePdfFromKnowledge, relinkSourcePdfFromPicker } from '../../shared-ui/navigation/source-pdf-navigation';

/**
 * 数据体检的装配：检查、修复、入口。
 *
 * Kept out of the controller on purpose — the controller is about rendering the library, this is about repairing what
 * the library says. The only contact points are `installDataHealth()` (once) and `refreshDataHealthBadge()` (per render).
 */

let installed = false;
/** The last run, so a fix can reuse the chunk counts it measured instead of re-reading storage. */
let lastRun: DataHealthRun | null = null;

async function check(): Promise<DataHealthRun> {
  const documents = listKnowledgeDocuments();
  // The check needs to know whether 「最近打开」 still holds a record; read that list once and build the predicate from it.
  const entries = await readRecentFiles();
  const recentIds = new Set(entries.map((entry) => entry.id));
  const recentNames = new Set(entries.map((entry) => entry.name.replace(/\.pdf$/i, '').trim().toLowerCase()));
  lastRun = await runDataHealthCheck({
    documents,
    hasRecentEntry: (document) => (
      Boolean(document.recentEntryId && recentIds.has(document.recentEntryId))
      || recentNames.has(document.documentName.replace(/\.pdf$/i, '').trim().toLowerCase())
    ),
  });
  return lastRun;
}

/**
 * 执行一条修复.
 *
 * Every branch returns the sentence the dialog shows under the row. Nothing here re-checks the data — the caller rescans,
 * so a fix that did not actually change anything reappears as the same finding instead of vanishing optimistically.
 */
async function fixFinding(finding: DataHealthFinding, chunkCount: number | null): Promise<string> {
  const document = getKnowledgeDocument(finding.documentId);
  if (!document) return '这条记录已经不在了（可能已被移出知识库）。';

  switch (finding.fix) {
    case 'sync-chunk-count': {
      if (chunkCount === null) return '没能读到实际分块数，先不要改记录。';
      syncChunkCount(finding.documentId, chunkCount);
      return `记录已改为 ${chunkCount} 段。`;
    }
    case 'mark-unindexed':
      markDocumentUnindexed(finding.documentId);
      return '已标记为未索引，可以重新建立索引。';
    case 'rebuild-index': {
      const opened = await openSourcePdfFromKnowledge(
        document.documentName,
        document.recentEntryId,
        1,
        document.documentId,
      );
      return opened
        ? '已打开原文：打开时会重建全文索引，稍后回来点「重新体检」确认。'
        : '没能打开这份文件。可以先在「最近打开」里打开它，或重新选择文件。';
    }
    case 'relink-file': {
      const relinked = await relinkSourcePdfFromPicker(document.documentId, document.documentName);
      return relinked
        ? '已重新关联到本地文件，索引会在打开时重建。'
        : '没有重新关联：选择被取消，或文件打不开。';
    }
    case 'complete-metadata': {
      const confirmed = window.confirm(
        `补全元数据会调用一次模型读取首页（约 ¥0.002）。\n\n「${document.documentName}」继续吗？`,
      );
      if (!confirmed) return '已取消。';
      const text = (document.overviewMarkdown ?? '').slice(0, 6_000);
      const result = await extractDocumentMetadataFor(document.documentId, {
        documentName: document.documentName,
        text,
      });
      return result ? '已完成一次元数据抽取，可以重新体检。' : '抽取没有成功，详情见右侧面板的说明。';
    }
    case 'reset-extraction': {
      const reset = await resetStuckExtraction(finding.documentId);
      return reset ? '抽取状态已重置，可以重新抽取。' : '状态已经不是「进行中」，不需要重置。';
    }
    case 'extract-graph': {
      // Extraction needs the graph page (progress and review live there). Say so rather than quietly doing half of it.
      // The dialog closes first: it is modal, so leaving it open would cover the page this click just switched to.
      closeDataHealthDialog();
      await import('./graph-navigation-bridge')
        .then((bridge) => bridge.openGraphForDocument(finding.documentId))
        .catch(() => undefined);
      return '已切到知识图谱：点「抽取候选实体」即可重新抽取（按次计费）。';
    }
    default:
      return finding.fixLabel;
  }
}

async function rescan(): Promise<DataHealthReport> {
  const run = await check();
  renderDataHealth(run);
  return run;
}

/** Sidebar badge only: cheap enough to run on every render, and it never opens a dialog by itself. */
export async function refreshDataHealthBadge(): Promise<void> {
  try {
    const run = await check();
    renderDataHealth(run);
  } catch {
    // A thrown health check must not break the library render; the badge simply stays as it was.
  }
}

async function openDialog(): Promise<void> {
  hideDataHealthStatus();
  showDataHealthStatus('正在体检…');
  try {
    const run = await check();
    openDataHealthDialog(run);
    hideDataHealthStatus();
  } catch (error) {
    showDataHealthStatus(`体检失败：${error instanceof Error ? error.message : String(error)}`, true);
    setStatus('数据体检失败。', true);
  }
}

/** Wires the sidebar entry and the dialog once. Safe to call repeatedly. */
export function installDataHealth(): void {
  if (installed) return;
  installed = true;
  configureDataHealthDialog({ fix: fixFinding, rescan });
  registerDataHealthDialogEvents(() => {
    void openDialog();
  });
  knowledgeDataHealthEntryButton.addEventListener('click', () => {
    void openDialog();
  });
}
