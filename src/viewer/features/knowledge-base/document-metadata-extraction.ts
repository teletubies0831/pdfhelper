import { browser } from "wxt/browser";

import { aiConfig } from "../../app/public";
import type { AiRuntimeResponse } from "../../../modules/ai/public";
import {
  applyExtractedMetadata,
  hasDocumentMetadata,
  markDocumentMetadataExtracting,
  markDocumentMetadataFailed,
  normalizeDocumentMetadata,
  resumeDocumentMetadata,
  type KnowledgeDocumentMetadata,
} from "../../../modules/knowledge/public";
import { getKnowledgeDocument } from "./knowledge-corpus-repository";

/**
 * AI 抽取文献元数据（作者 / 日期 / 语言 / URL / DOI）.
 *
 * Called once when a document is added, over the first pages the indexing pass already extracted — so the text is
 * free and this is exactly one short model call. Deliberately quiet: a failure writes `metadataStatus: 'error'` and
 * leaves the rest of the record alone, because a paper that did not get its authors filled in is still a perfectly
 * usable paper.
 *
 * The manual path (`extractDocumentMetadataFor`) is the same function, exposed for the panel's 「重新提取」 button;
 * that is the only place the user spends a second call on purpose.
 */

const extracting = new Set<string>();

/** True while a call for this document is in flight; the panel's button reads it. */
export function isMetadataExtractionRunning(documentId: string): boolean {
  return extracting.has(documentId);
}

export interface MetadataExtractionAvailability {
  available: boolean;
  reason: string;
}

/**
 * Whether the call can run, and if not why.
 *
 * It needs a chat connection: unlike the overview (which the user asked for explicitly), this one runs by itself at
 * add time, so being silent about "no API key" would look like a bug rather than a setting.
 */
export function metadataExtractionAvailability(): MetadataExtractionAvailability {
  if (!aiConfig.value.apiKey.trim()) {
    return { available: false, reason: '元数据抽取需要先配置模型连接：设置 → 模型与任务' };
  }
  return { available: true, reason: '调用一次模型读取首页信息（约 ¥0.002）' };
}

/**
 * Runs one extraction and stores the result.
 *
 * `text` is the first pages' text; the caller already has it from the indexing pass. Documents that were added
 * before this feature existed have no text at hand, which is why the panel's button can also be pressed with the
 * overview's text as a fallback (see the controller) — a title plus a few hundred characters still identifies most
 * papers.
 */
export async function extractDocumentMetadataFor(
  documentId: string,
  input: { documentName: string; text: string },
): Promise<KnowledgeDocumentMetadata | null> {
  if (extracting.has(documentId)) return null;
  const item = getKnowledgeDocument(documentId);
  if (!item) return null;
  // Pressing the button on a document the user had marked 「无需补全」 is an explicit retraction of that decision.
  if (item.metadataStatus === 'skipped') resumeDocumentMetadata(documentId);
  const availability = metadataExtractionAvailability();
  if (!availability.available) {
    markDocumentMetadataFailed(documentId, availability.reason);
    dispatchChange();
    return null;
  }
  extracting.add(documentId);
  markDocumentMetadataExtracting(documentId);
  dispatchChange();
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-document-metadata',
      requestId: `metadata:${crypto.randomUUID()}`,
      documentName: input.documentName,
      text: input.text.slice(0, 6_000),
    }) as AiRuntimeResponse | undefined;
    if (!response?.ok) throw new Error(response?.error || '元数据抽取失败。');
    const raw = response.documentMetadata;
    if (!raw) throw new Error('后台没有返回元数据结果。');
    const metadata = normalizeDocumentMetadata(raw);
    // An answer the model could not produce as JSON is recorded as a failure with its reason, not as "found
    // nothing": the two look identical in the panel otherwise, and only one of them is worth retrying.
    if (raw.degraded && !hasDocumentMetadata(metadata)) {
      markDocumentMetadataFailed(documentId, raw.degraded);
    } else {
      // `onlyEmpty` + the module's manual-value protection: this pass fills what the free offline layer left blank, and
      // never replaces a DOI the user typed or a value already found in the file.
      applyExtractedMetadata(documentId, metadata, 'ai', { onlyEmpty: true });
    }
    return metadata;
  } catch (error) {
    // Prefixed because the provider's wording ("模型已达到输出 Token 上限…") reads like an overview failure; the panel
    // shows this line under 文献信息, and it must be obvious which task it is talking about.
    const message = error instanceof Error ? error.message : String(error);
    markDocumentMetadataFailed(documentId, `元数据抽取失败：${message}`);
    return null;
  } finally {
    extracting.delete(documentId);
    dispatchChange();
  }
}

/** The corpus-change event the library already listens to; the panel and the table refresh from it. */
function dispatchChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pdf-helper:knowledge-corpus-change'));
}
