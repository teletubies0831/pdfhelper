export interface SemanticKnowledgeDocument {
  recordKey: string;
  title: string;
  content: string;
  documentName: string;
  positionLabel?: string;
  category: string;
  tags: string[];
  updatedAt: string;
}

export interface KnowledgeVectorChunk {
  chunkIndex: number;
  text: string;
}

export interface SemanticKnowledgeMatch {
  recordKey: string;
  score: number;
  matchedText: string;
}

export interface EmbeddedKnowledgeChunk {
  recordKey: string;
  text: string;
  embedding: number[];
}

const MAX_CHUNK_LENGTH = 900;
const CHUNK_OVERLAP = 120;

export function buildKnowledgeFingerprint(
  document: SemanticKnowledgeDocument,
): string {
  const value = [
    document.title,
    document.content,
    document.documentName,
    document.positionLabel ?? '',
    document.category,
    document.tags.join('\u0000'),
    document.updatedAt,
  ].join('\u0001');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export function chunkKnowledgeDocument(
  document: SemanticKnowledgeDocument,
): KnowledgeVectorChunk[] {
  const header = [
    document.title,
    document.documentName,
    document.positionLabel ?? '',
    document.category,
    document.tags.join(' '),
  ].filter(Boolean).join(' · ');
  const content = document.content.replace(/\s+/g, ' ').trim();
  if (!content) return header ? [{ chunkIndex: 0, text: header }] : [];

  const chunks: KnowledgeVectorChunk[] = [];
  let start = 0;
  while (start < content.length) {
    const hardEnd = Math.min(content.length, start + MAX_CHUNK_LENGTH);
    let end = hardEnd;
    if (hardEnd < content.length) {
      const naturalBreak = Math.max(
        content.lastIndexOf('。', hardEnd),
        content.lastIndexOf('！', hardEnd),
        content.lastIndexOf('？', hardEnd),
        content.lastIndexOf('. ', hardEnd),
        content.lastIndexOf('\n', hardEnd),
      );
      if (naturalBreak > start + MAX_CHUNK_LENGTH / 2) end = naturalBreak + 1;
    }
    chunks.push({
      chunkIndex: chunks.length,
      text: `${header}\n${content.slice(start, end)}`.trim(),
    });
    if (end >= content.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (!leftMagnitude || !rightMagnitude) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function rankSemanticKnowledgeChunks(
  chunks: EmbeddedKnowledgeChunk[],
  queryVector: number[],
  documents: SemanticKnowledgeDocument[],
  limit = 12,
): SemanticKnowledgeMatch[] {
  const bestByRecord = new Map<string, SemanticKnowledgeMatch>();
  for (const chunk of chunks) {
    const score = cosineSimilarity(queryVector, chunk.embedding);
    const current = bestByRecord.get(chunk.recordKey);
    if (!current || score > current.score) {
      bestByRecord.set(chunk.recordKey, {
        recordKey: chunk.recordKey,
        score,
        matchedText: chunk.text,
      });
    }
  }

  const ranked = Array.from(bestByRecord.values()).sort(
    (left, right) => right.score - left.score,
  );
  const documentByKey = new Map(
    documents.map((document) => [document.recordKey, document]),
  );
  const result: SemanticKnowledgeMatch[] = [];
  const perDocument = new Map<string, number>();
  for (const match of ranked) {
    const documentName = documentByKey.get(match.recordKey)?.documentName ?? '';
    const count = perDocument.get(documentName) ?? 0;
    if (count >= 3 && result.length < Math.min(8, ranked.length)) continue;
    result.push(match);
    perDocument.set(documentName, count + 1);
    if (result.length >= limit) break;
  }
  return result;
}

export function fuseKnowledgeRankings(
  keyword: SemanticKnowledgeMatch[],
  semantic: SemanticKnowledgeMatch[],
  limit: number,
): SemanticKnowledgeMatch[] {
  const byKey = new Map<string, SemanticKnowledgeMatch & { rankScore: number }>();
  for (const [source, matches] of [
    ['keyword', keyword],
    ['semantic', semantic],
  ] as const) {
    for (const [index, match] of matches.entries()) {
      const current = byKey.get(match.recordKey);
      const rankScore = (current?.rankScore ?? 0) + 1 / (60 + index + 1);
      byKey.set(match.recordKey, {
        ...(current ?? match),
        matchedText:
          source === 'semantic'
            ? match.matchedText
            : current?.matchedText ?? match.matchedText,
        rankScore,
      });
    }
  }
  return Array.from(byKey.values())
    .sort((left, right) => right.rankScore - left.rankScore)
    .slice(0, limit)
    .map(({ rankScore, ...match }) => ({ ...match, score: rankScore }));
}
