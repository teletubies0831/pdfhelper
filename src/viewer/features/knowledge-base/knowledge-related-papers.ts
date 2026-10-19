import { browser } from "wxt/browser";

import { webRetrievalConfig } from "../../app/public";
import type { AiRuntimeResponse } from "../../../modules/ai/public";
import {
  getDocumentOverviewMarkdown,
  saveRelatedLiterature,
} from "../../../modules/knowledge/public";
import type { KnowledgeLibraryDocument } from "./knowledge-corpus-repository";

/**
 * 「检索相关论文」, triggered from the PDF card rather than from inside the overview.
 *
 * It lives on the card because that is where the user picks a document to work on: the overview dialog is a
 * reader, and a money-spending action buried at its bottom (with its own heading, hint and empty state) read as
 * a second document inside the document — the user called that out as ugly, and they were right.
 *
 * The work itself is one message to the service worker, which resolves the DeepSeek settings, searches, and
 * writes the section back through `saveRelatedLiterature`. Both the card and an open overview refresh themselves
 * from the corpus-change event that write dispatches, so nothing here touches the DOM.
 */

const searching = new Set<string>();

/** True while a retrieval for this document is in flight; the card and the dialog both read it. */
export function isRelatedPapersSearchRunning(documentId: string): boolean {
  return searching.has(documentId);
}

export interface RelatedPapersAvailability {
  available: boolean;
  /** Why it cannot run yet, in words the button's tooltip can show. */
  reason: string;
}

/**
 * Whether the button can do anything, and if not, why.
 *
 * Two independent preconditions, and saying only "unavailable" would leave the user guessing: without a DeepSeek
 * key nothing can be searched, and without an overview there is no `paper` title and topic to search *from*.
 */
export function relatedPapersAvailability(
  item: KnowledgeLibraryDocument,
): RelatedPapersAvailability {
  if (webRetrievalConfig.value === null) {
    return {
      available: false,
      reason: '联网检索需要先配置 DeepSeek API Key：设置 → 模型与任务 → 联网检索',
    };
  }
  if (!getDocumentOverviewMarkdown(item).trim()) {
    return { available: false, reason: '先生成 PDF 概览，再检索相关论文' };
  }
  return { available: true, reason: '调用一次 DeepSeek 联网检索（约 ¥0.005）' };
}

/**
 * Runs the retrieval for one document.
 *
 * Deliberately silent about failures in the DOM: it reports through a floating notice (the same plate the
 * knowledge base already uses for background work) and otherwise leaves the card alone, so a failed lookup cannot
 * make the library look broken.
 */
export async function searchRelatedPapers(item: KnowledgeLibraryDocument): Promise<void> {
  if (searching.has(item.documentId)) return;
  const availability = relatedPapersAvailability(item);
  if (!availability.available) {
    showNotice(item.documentId, availability.reason, 'error');
    return;
  }
  const overviewMarkdown = getDocumentOverviewMarkdown(item).trim();
  searching.add(item.documentId);
  showNotice(item.documentId, '正在检索相关论文（联网检索约 0.005 元/次）…', 'active');
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-related-literature',
      requestId: `related:${crypto.randomUUID()}`,
      documentName: item.documentName,
      overviewMarkdown,
    }) as AiRuntimeResponse | undefined;
    if (!response?.ok) throw new Error(response?.error || '检索相关论文失败。');
    const related = response.relatedLiterature;
    if (!related) throw new Error('后台没有返回相关论文结果。');
    saveRelatedLiterature(item.documentId, {
      markdown: related.markdown,
      searchCalls: related.usage.searchCalls,
      fetchCalls: related.usage.fetchCalls,
      sources: related.sources,
      degraded: related.degraded,
    });
    const calls = related.usage.searchCalls + related.usage.fetchCalls;
    showNotice(
      item.documentId,
      related.degraded
        ? `相关论文已保存，但检索不完整：${related.degraded}`
        : `相关论文已保存（联网调用 ${calls} 次约 ¥${(calls * 0.005).toFixed(3)}）`,
      related.degraded ? 'error' : 'success',
    );
  } catch (error) {
    showNotice(
      item.documentId,
      `检索相关论文失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  } finally {
    searching.delete(item.documentId);
    // The button's label and disabled state depend on `searching`, and the card is re-rendered by the caller.
    window.dispatchEvent(new CustomEvent("pdf-helper:knowledge-corpus-change"));
  }
}

/** The floating plate the knowledge base already uses for background work; only its classes are reused. */
function showNotice(
  documentId: string,
  message: string,
  state: 'active' | 'success' | 'error',
): void {
  const noticeId = `knowledge-related-notice-${CSS.escape(documentId)}`;
  let notice = document.getElementById(noticeId);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = noticeId;
    notice.className = 'knowledge-background-task-toast';
    notice.innerHTML = '<span class="knowledge-background-task-spinner" aria-hidden="true"></span>'
      + '<div><strong>相关论文</strong><p></p><i></i></div>';
    document.body.append(notice);
  }
  notice.classList.toggle('is-success', state === 'success');
  notice.classList.toggle('is-error', state === 'error');
  const text = notice.querySelector('p');
  if (text) text.textContent = message;
  const bar = notice.querySelector<HTMLElement>('i');
  if (bar) bar.style.width = state === 'active' ? '38%' : '100%';
  if (state !== 'active') window.setTimeout(() => notice?.remove(), 5_000);
}
