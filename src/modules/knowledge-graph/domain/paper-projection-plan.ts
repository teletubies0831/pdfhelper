import type { GraphPaper } from '../contracts';

/**
 * Bumped whenever the stored projection shape changes incompatibly, forcing a
 * rewrite of every paper on the next sync.
 *
 * Declared here rather than in `contracts.ts` so this module has no runtime
 * imports: the contract barrel re-exports it, and a runtime import back into
 * that barrel would create a module cycle.
 *
 * Version 2: the field sources changed. Titles and folders now come from the knowledge
 * base instead of the reading history, so every stored paper has to be rewritten once —
 * without the bump, a paper whose title only differs in source would never be updated.
 */
export const KNOWLEDGE_GRAPH_PROJECTION_VERSION = 2;

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Decides whether a re-projected paper differs from what is already stored.
 *
 * `updatedAt` and `createdAt` are deliberately excluded: they change on every
 * projection pass, and treating them as a difference would rewrite every paper
 * each time the graph page opens.
 */
export function shouldWriteProjection(
  previous: GraphPaper | undefined,
  next: GraphPaper,
): boolean {
  if (!previous) return true;
  if (previous.projectionVersion !== KNOWLEDGE_GRAPH_PROJECTION_VERSION) return true;
  return previous.documentAgentId !== next.documentAgentId
    || previous.fingerprint !== next.fingerprint
    || previous.title !== next.title
    || previous.year !== next.year
    || previous.venue !== next.venue
    || previous.doi !== next.doi
    || previous.abstract !== next.abstract
    || previous.folderId !== next.folderId
    || previous.extractionStatus !== next.extractionStatus
    || previous.extractionError !== next.extractionError
    || previous.extractedAt !== next.extractedAt
    || !sameStringList(previous.authors, next.authors)
    || !sameStringList(previous.keywords, next.keywords);
}
