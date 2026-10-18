import type { GraphPaperSource } from '../application/paper-source.ts';
import type { GraphPaper } from '../contracts';
import {
  KNOWLEDGE_GRAPH_PROJECTION_VERSION,
  shouldWriteProjection,
} from './paper-projection-plan.ts';

export interface PaperGraphMetadata {
  folderId?: string | null;
  extractionStatus?: GraphPaper['extractionStatus'];
  extractionError?: string | null;
  extractedAt?: number | null;
}

function normalizeTitle(value: string): string {
  return value.trim() || '未命名 PDF';
}

/**
 * Builds the graph's paper projection from a paper source.
 *
 * The source is assembled in `application/paper-source.ts` from the knowledge base
 * (membership, title, folder) plus the reading history (bibliographic metadata). Only
 * fields the graph renders, filters or exports are copied: the graph stays a projection
 * and never becomes a second source of truth for a document.
 */
export function projectPaperFromSource(
  source: GraphPaperSource,
  metadata: PaperGraphMetadata = {},
  now = Date.now(),
  existing?: GraphPaper,
): GraphPaper {
  return {
    paperId: source.documentId,
    documentAgentId: source.documentId,
    fingerprint: source.fingerprint,
    title: normalizeTitle(source.title),
    year: source.year,
    authors: source.authors,
    venue: '',
    doi: '',
    abstract: source.abstract,
    // The folder belongs to the knowledge base, so it wins over a stale copy on the stored
    // paper; `metadata` stays as an explicit override for callers that know better.
    folderId: metadata.folderId ?? source.folderId ?? existing?.folderId ?? null,
    keywords: source.keywords,
    extractionStatus: metadata.extractionStatus ?? existing?.extractionStatus ?? 'none',
    extractionError: metadata.extractionError ?? existing?.extractionError ?? null,
    extractedAt: metadata.extractedAt ?? existing?.extractedAt ?? null,
    projectionVersion: KNOWLEDGE_GRAPH_PROJECTION_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export interface ProjectionSyncResult {
  papers: GraphPaper[];
  written: number;
}

/**
 * Incremental projection sync.
 *
 * The source list is authoritative: papers whose source disappeared are *not* dropped here
 * (that would delete the paper row and strand its entities and edges), they are reported by
 * `findRemovedPaperIds` so the caller can run the cascade cleanup instead. Records whose
 * projected fields are unchanged are skipped entirely, so opening the graph page repeatedly
 * is not a write storm.
 */
export function syncPaperProjections(
  sources: GraphPaperSource[],
  existing: GraphPaper[],
  metadataByPaperId: Map<string, PaperGraphMetadata> = new Map(),
  now = Date.now(),
): ProjectionSyncResult {
  const existingByPaperId = new Map(existing.map((paper) => [paper.paperId, paper]));
  const papers: GraphPaper[] = [];
  const pending: GraphPaper[] = [];

  for (const source of sources) {
    const previous = existingByPaperId.get(source.documentId);
    const projected = projectPaperFromSource(
      source,
      metadataByPaperId.get(source.documentId),
      now,
      previous,
    );
    papers.push(projected);
    if (shouldWriteProjection(previous, projected)) pending.push(projected);
  }

  return { papers, written: pending.length };
}

/**
 * Papers in the projection whose source no longer exists.
 *
 * "No longer exists" means "no longer in the knowledge base": the graph must not outlive it.
 */
export function findRemovedPaperIds(
  sources: GraphPaperSource[],
  existing: GraphPaper[],
): string[] {
  const liveIds = new Set(sources.map((source) => source.documentId));
  return existing
    .filter((paper) => !liveIds.has(paper.paperId))
    .map((paper) => paper.paperId);
}
