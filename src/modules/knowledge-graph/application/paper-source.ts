import type { KnowledgeLibraryDocument } from '../../knowledge/public';
import type { PaperLibraryRecord } from '../../memory/public';

/**
 * Where the graph's papers come from.
 *
 * The knowledge base is the **authority**: a document is in the graph because the user put
 * it in the knowledge base, not because it was ever opened. This replaced the reading
 * history as the source, which projected *every* PDF ever opened — so emptying the
 * knowledge base left papers behind that could not be deleted from anywhere, and a
 * knowledge-base removal was silently undone by the next sync.
 *
 * The reading history still contributes, but only as **bibliographic enrichment**: the
 * knowledge base knows titles, folders and indexing state, while year / authors / abstract
 * keywords / fingerprint live in the library record. Membership comes from the knowledge
 * base alone, so a document that was never added cannot appear, however often it is read.
 */

/** A paper as the projection needs it, assembled from both sources. */
export interface GraphPaperSource {
  /** Paper id. The knowledge-base document id and the library document id are the same value. */
  documentId: string;
  title: string;
  folderId: string | null;
  fingerprint: string;
  year: number | null;
  authors: string[];
  abstract: string;
  keywords: string[];
}

export interface KnowledgePaperJoinInput {
  /** Authoritative membership, in the order the knowledge base lists them. */
  documents: readonly KnowledgeLibraryDocument[];
  /** Enrichment only; records for documents outside the knowledge base are ignored. */
  libraryRecords: readonly PaperLibraryRecord[];
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Builds the projection input: one entry per knowledge-base document.
 *
 * Two rules matter and are both deliberate:
 *
 * - **Membership is the knowledge base, full stop.** A library record whose document is not
 *   in the knowledge base is dropped rather than projected, which is what makes a
 *   knowledge-base deletion stick.
 * - **A missing library record is not a missing paper.** The gap degrades to empty
 *   metadata instead of dropping the document: the user added it to the knowledge base, so
 *   it belongs in the graph even if it was never in the reading history.
 */
export function joinKnowledgePaperSources(input: KnowledgePaperJoinInput): GraphPaperSource[] {
  const libraryById = new Map<string, PaperLibraryRecord>();
  for (const record of input.libraryRecords) {
    const documentId = cleanString(record?.documentId);
    // First record wins: `searchPapers` returns one row per document, and a duplicate here
    // would otherwise make the projection depend on iteration order.
    if (documentId && !libraryById.has(documentId)) libraryById.set(documentId, record);
  }

  const seen = new Set<string>();
  const sources: GraphPaperSource[] = [];
  for (const document of input.documents) {
    // The corpus is parsed from localStorage without validation, so a damaged entry with a
    // blank id must not become a paper named after nothing.
    const documentId = cleanString(document?.documentId);
    if (!documentId || seen.has(documentId)) continue;
    seen.add(documentId);

    const library = libraryById.get(documentId);
    sources.push({
      documentId,
      title: cleanString(document.documentName),
      folderId: cleanString(document.folderId) || null,
      fingerprint: cleanString(library?.fingerprint),
      year: typeof library?.year === 'number' && Number.isFinite(library.year)
        ? library.year
        : null,
      authors: cleanStringList(library?.authors),
      abstract: cleanString(library?.abstract),
      keywords: cleanStringList(library?.keywords),
    });
  }
  return sources;
}

/**
 * The ids the graph is allowed to contain.
 *
 * Used by the cleanup pass: a stored paper whose id is not in this set is deleted, together
 * with the entities, edges and extraction jobs only it supported.
 */
export function knowledgePaperIds(
  documents: readonly KnowledgeLibraryDocument[],
): Set<string> {
  const ids = new Set<string>();
  for (const document of documents) {
    const documentId = cleanString(document?.documentId);
    if (documentId) ids.add(documentId);
  }
  return ids;
}
