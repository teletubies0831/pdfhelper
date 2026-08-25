import {
  chunkKnowledgeDocument,
  type SemanticKnowledgeDocument,
  type SemanticKnowledgeMatch,
} from '../domain/semantic-retrieval';

function tokenize(value: string): string[] {
  const normalized = value.toLocaleLowerCase('zh-CN');
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const term of terms) {
    tokens.push(term);
    if (/^[\p{Script=Han}]+$/u.test(term) && term.length > 2) {
      for (let index = 0; index < term.length - 1; index += 1) {
        tokens.push(term.slice(index, index + 2));
      }
    }
  }
  return Array.from(new Set(tokens)).slice(0, 48);
}

function countMatches(value: string, tokens: string[], weight: number): number {
  const normalized = value.toLocaleLowerCase('zh-CN');
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score += weight * Math.min(3, token.length);
  }
  return score;
}

export class KeywordKnowledgeRetriever {
  retrieve(
    documents: SemanticKnowledgeDocument[],
    query: string,
    limit = 12,
  ): SemanticKnowledgeMatch[] {
    const tokens = tokenize(query);
    const matches = documents.map((document, sourceIndex) => {
      const metadataScore =
        countMatches(document.title, tokens, 8) +
        countMatches(document.tags.join(' '), tokens, 5) +
        countMatches(document.category, tokens, 5) +
        countMatches(document.documentName, tokens, 3) +
        countMatches(document.positionLabel ?? '', tokens, 2);
      const chunks = chunkKnowledgeDocument(document);
      let bestText = chunks[0]?.text ?? document.content;
      let bestContentScore = 0;
      for (const chunk of chunks) {
        const score = countMatches(chunk.text, tokens, 1);
        if (score > bestContentScore) {
          bestContentScore = score;
          bestText = chunk.text;
        }
      }
      return {
        recordKey: document.recordKey,
        score: metadataScore + bestContentScore,
        matchedText: bestText,
        sourceIndex,
        updatedAt: new Date(document.updatedAt).getTime() || 0,
      };
    });
    const relevantMatches = matches.filter((match) => match.score > 0);
    relevantMatches.sort(
      (left, right) =>
        right.score - left.score ||
        right.updatedAt - left.updatedAt ||
        left.sourceIndex - right.sourceIndex,
    );
    return relevantMatches.slice(0, limit).map(({ sourceIndex: _sourceIndex, updatedAt: _updatedAt, ...match }) => match);
  }
}
