import {
  getDocumentOverviewMarkdown,
  readDocumentMetadata,
  readReadingStatus,
  type KnowledgeDocumentReadingStatus,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';

/**
 * Sorting and the per-document state ranking, with no DOM in sight.
 *
 * Split from `library-table.ts` so the two questions this file answers — what order the rows go in, and which of the
 * three AI steps is *finished* — can be tested without a browser. The rendering half is the only part that needs one.
 */

export type LibrarySortKey =
  | 'title'
  | 'reading'
  | 'pages'
  | 'date'
  | 'published'
  | 'index'
  | 'overview'
  | 'related';

export interface LibrarySortState {
  key: LibrarySortKey;
  descending: boolean;
}

export const DEFAULT_LIBRARY_SORT: LibrarySortState = { key: 'date', descending: true };

/** Reading status sorts by how much is left to do, not alphabetically: 待读 first is the useful order. */
const READING_RANK: Record<KnowledgeDocumentReadingStatus, number> = {
  todo: 0,
  reading: 1,
  done: 2,
};

const STATE_RANK = { missing: 0, failed: 1, running: 2, done: 3 } as const;

export type StateRank = keyof typeof STATE_RANK;

export function indexState(item: KnowledgeLibraryDocument): StateRank {
  if (item.indexStatus === 'ready') return 'done';
  if (item.indexStatus === 'indexing') return 'running';
  if (item.indexStatus === 'error') return 'failed';
  return 'missing';
}

export function overviewState(item: KnowledgeLibraryDocument): StateRank {
  if (getDocumentOverviewMarkdown(item).trim()) return 'done';
  if (item.overviewStatus === 'generating') return 'running';
  if (item.overviewStatus === 'error') return 'failed';
  return 'missing';
}

export function relatedState(item: KnowledgeLibraryDocument): StateRank {
  if (item.relatedLiteratureMarkdown?.trim()) return 'done';
  if (item.relatedLiteratureError) return 'failed';
  return 'missing';
}

function stateRankOf(key: LibrarySortKey, item: KnowledgeLibraryDocument): number {
  if (key === 'index') return STATE_RANK[indexState(item)];
  if (key === 'overview') return STATE_RANK[overviewState(item)];
  if (key === 'related') return STATE_RANK[relatedState(item)];
  return 0;
}

/**
 * Sorts a copy; the caller keeps its own array. Unknown keys fall back to the newest first.
 *
 * 发表日期 is metadata the model read off the first page, so it is often empty. Empty sorts last in both directions:
 * "oldest first" should not mean "every paper without a date comes first", which is what a plain string compare does.
 */
export function sortLibraryDocuments(
  documents: readonly KnowledgeLibraryDocument[],
  sort: LibrarySortState,
): KnowledgeLibraryDocument[] {
  const items = [...documents];
  const direction = sort.descending ? -1 : 1;
  items.sort((left, right) => {
    if (sort.key === 'title') return left.documentName.localeCompare(right.documentName) * direction;
    if (sort.key === 'pages') return (left.pageCount - right.pageCount) * direction;
    if (sort.key === 'published') {
      const leftDate = readDocumentMetadata(left).publishDate;
      const rightDate = readDocumentMetadata(right).publishDate;
      if (!leftDate || !rightDate) return leftDate ? -1 : rightDate ? 1 : 0;
      return leftDate.localeCompare(rightDate) * direction;
    }
    if (sort.key === 'reading') {
      return (READING_RANK[readReadingStatus(left)] - READING_RANK[readReadingStatus(right)]) * direction;
    }
    if (sort.key === 'index' || sort.key === 'overview' || sort.key === 'related') {
      // Unfinished work first is the point of these columns, so "ascending" means "least complete first".
      return (stateRankOf(sort.key, left) - stateRankOf(sort.key, right)) * direction;
    }
    return left.addedAt.localeCompare(right.addedAt) * direction;
  });
  return items;
}

/** The "共 N 篇 · 已筛选" line under the table. */
export function describeLibrarySummary(shown: number, total: number): string {
  if (!total) return '';
  return shown === total
    ? `共 ${total} 篇文献`
    : `共 ${total} 篇文献 · 当前显示 ${shown} 篇`;
}
