

import type { DocumentChunk } from './contracts';



export function createDocumentAgentId(
  fingerprint: string,
  name: string,
  pageCount: number,
): string {
  if (fingerprint.trim()) return `pdf:${fingerprint.trim()}`;
  let hash = 2166136261;
  const source = `${name.trim().toLowerCase()}|${pageCount}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pdf:fallback:${(hash >>> 0).toString(16)}:${pageCount}`;
}


export function tokenizeForSearch(value: string): string[] {
  const normalized = value.toLowerCase().normalize('NFKC');
  const latin = normalized.match(/[a-z0-9][a-z0-9_+.-]{1,}/g) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const hanBigrams = hanRuns.flatMap((run) => {
    const tokens: string[] = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
    return tokens;
  });
  return Array.from(new Set([...latin, ...hanBigrams])).slice(0, 80);
}


export interface DocumentSearchResult {
  chunk: DocumentChunk;
  score: number;
  matchedTerms: string[];
}


export function searchDocumentChunks(
  chunks: DocumentChunk[],
  query: string,
  limit = 5,
  maximumPage?: number,
): DocumentSearchResult[] {
  const terms = tokenizeForSearch(query);
  const normalizedQuery = query.toLowerCase().normalize('NFKC').trim();
  return chunks
    .filter((chunk) => maximumPage === undefined || chunk.startPage <= maximumPage)
    .map((chunk) => {
      const haystack = `${chunk.heading ?? ''}\n${chunk.summary ?? ''}\n${chunk.text}`
        .toLowerCase()
        .normalize('NFKC');
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      let score = matchedTerms.length * 4;
      for (const term of matchedTerms) score += Math.min(8, haystack.split(term).length - 1);
      if (normalizedQuery.length >= 4 && haystack.includes(normalizedQuery)) score += 24;
      if (chunk.summary && matchedTerms.some((term) => chunk.summary?.toLowerCase().includes(term))) score += 5;
      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.order - right.chunk.order)
    .slice(0, Math.max(1, Math.min(10, limit)));
}
