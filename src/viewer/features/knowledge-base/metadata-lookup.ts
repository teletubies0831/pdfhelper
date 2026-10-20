import { browser } from "wxt/browser";

import type { AiRuntimeResponse } from "../../../modules/ai/public";
import {
  buildLookupTitle,
  evaluateMetadataCandidates,
  readDocumentMetadata,
  type KnowledgeLibraryDocument,
  type MetadataCandidate,
  type MetadataSuggestion,
} from "../../../modules/knowledge/public";

/**
 * 联网查找文献元数据（Crossref → OpenAlex），**只出建议，绝不自动写入**。
 *
 * Three rules shape this file:
 *
 * 1. **Opt-in.** Nothing here runs on its own. Opening a PDF never discloses its title to a third party; only the
 *    panel's 「联网查找」 does, and the button says so.
 * 2. **Suggestion, not result.** The candidates are gated by `evaluateMetadataCandidates` (title similarity, plus a
 *    year or author that agrees). A candidate that fails the gate is still *shown* with the reason it was refused —
 *    "we found something but it is not this paper" is information the user wants — but it can never be filled in.
 * 3. **No persistence of suggestions.** They live for the session only: a stale suggestion sitting on a record the user
 *    has since edited by hand is worse than no suggestion at all.
 */

export interface MetadataLookupState {
  running: boolean;
  /** Gated candidates for this document, best first; empty while nothing has been looked up. */
  suggestions: readonly MetadataSuggestion[];
  /** `''` while the last lookup is still valid; a sentence otherwise (nothing found, source failed). */
  message: string;
  /** Every source failed, as opposed to "the databases do not have this paper". */
  failed: boolean;
  /** Whether a lookup has ever run, so the panel can tell "not looked up" from "looked up, found nothing". */
  lookedUp: boolean;
}

const EMPTY_STATE: MetadataLookupState = {
  running: false,
  suggestions: [],
  message: '',
  failed: false,
  lookedUp: false,
};

const lookupStates = new Map<string, MetadataLookupState>();
const inFlight = new Set<string>();

export function readMetadataLookupState(documentId: string): MetadataLookupState {
  return lookupStates.get(documentId) ?? EMPTY_STATE;
}

export function isMetadataLookupRunning(documentId: string): boolean {
  return inFlight.has(documentId);
}

/** Forgets the suggestions (the user pressed 「都不对」). */
export function clearMetadataLookup(documentId: string): void {
  lookupStates.set(documentId, { ...EMPTY_STATE, lookedUp: readMetadataLookupState(documentId).lookedUp });
  dispatchLookupChange(documentId);
}

function updateLookupState(documentId: string, patch: Partial<MetadataLookupState>): void {
  lookupStates.set(documentId, { ...readMetadataLookupState(documentId), ...patch });
  dispatchLookupChange(documentId);
}

/** The panel listens for this; a corpus change is the wrong event (nothing in the library changed). */
function dispatchLookupChange(documentId: string): void {
  window.dispatchEvent(new CustomEvent('pdf-helper:knowledge-metadata-lookup', {
    detail: { documentId },
  }));
}

/**
 * Looks this document up by title and gates what comes back.
 *
 * The query title prefers the overview's own title (the paper's real title, as read by the model) and falls back to the
 * cleaned file name. The gate also cross-checks a year or an author when the record has them — and when it has
 * neither, nothing can be accepted unless the title matches almost exactly *and* is long enough to be meaningful.
 */
export async function lookupDocumentMetadata(
  item: KnowledgeLibraryDocument,
): Promise<MetadataSuggestion[]> {
  const documentId = item.documentId;
  if (inFlight.has(documentId)) return [...readMetadataLookupState(documentId).suggestions];
  const title = buildLookupTitle({
    overviewTitle: firstMarkdownHeading(item.overviewMarkdown ?? ''),
    documentName: item.documentName,
  });
  if (!title) {
    updateLookupState(documentId, {
      suggestions: [],
      lookedUp: true,
      failed: false,
      message: '没有可用的标题（文件名为空），无法在线查找。',
    });
    return [];
  }

  inFlight.add(documentId);
  updateLookupState(documentId, { running: true, message: '', failed: false });
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:lookup-bibliographic-metadata',
      requestId: `lookup:${crypto.randomUUID()}`,
      title,
    }) as AiRuntimeResponse | undefined;
    if (!response?.ok) throw new Error(response?.error || '在线查找失败。');
    const candidates = (response.bibliographicCandidates ?? []) as MetadataCandidate[];
    const metadata = readDocumentMetadata(item);
    const suggestions = evaluateMetadataCandidates({
      title,
      authors: metadata.authors,
      year: Number(metadata.publishDate.slice(0, 4)) || 0,
    }, candidates);
    const accepted = suggestions.filter((suggestion) => suggestion.accepted).length;
    const errors = response.bibliographicLookupErrors ?? [];
    updateLookupState(documentId, {
      running: false,
      suggestions,
      lookedUp: true,
      failed: !candidates.length && errors.length > 0,
      message: accepted > 0
        ? `在线找到 ${accepted} 条可信候选，确认后才会写入。`
        : candidates.length
          ? '找到了记录，但没有一条能确认是这篇（标题/年份/作者对不上），所以没有填写。'
          : errors.length
            ? `在线查找没有结果：${errors.join('；')}`
            : '在线查找没有找到这份文献的记录。',
    });
    return suggestions;
  } catch (error) {
    updateLookupState(documentId, {
      running: false,
      suggestions: [],
      lookedUp: true,
      failed: true,
      message: `在线查找失败：${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  } finally {
    inFlight.delete(documentId);
  }
}

function firstMarkdownHeading(markdown: string): string {
  const heading = markdown.match(/^#+\s*(.+)$/m);
  return heading?.[1]?.trim() ?? '';
}
