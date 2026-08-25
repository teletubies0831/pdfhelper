import type { SemanticKnowledgeMatch } from "../../../modules/knowledge/public";

export interface KnowledgeDocumentScopeCandidate {
  documentId: string;
  documentName: string;
}

const GENERIC_DOCUMENT_TOKENS = new Set([
  "paper", "article", "document", "framework", "method", "model",
  "models", "learning", "deep", "research", "inscrypt", "pdfread",
]);

function tokenizeDocumentName(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase("en-US").replace(/\.pdf$/i, "");
  const latin = normalized.match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const han = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return new Set([
    ...latin.filter((token) => !GENERIC_DOCUMENT_TOKENS.has(token)),
    ...han,
  ]);
}

/**
 * Detect document names explicitly mentioned by the user. Only distinctive
 * tokens that occur in one library document are allowed to narrow the scope,
 * so a generic query such as "ownership model" does not select one paper.
 */
export function findExplicitKnowledgeDocumentScope(
  query: string,
  documents: KnowledgeDocumentScopeCandidate[],
): Set<string> {
  const normalizedQuery = query.toLocaleLowerCase("en-US");
  const queryLatin = normalizedQuery.match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const queryHan = normalizedQuery.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const tokensByDocument = new Map(
    documents.map((document) => [document.documentId, tokenizeDocumentName(document.documentName)]),
  );
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokensByDocument.values()) {
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const result = new Set<string>();
  for (const document of documents) {
    const tokens = tokensByDocument.get(document.documentId) ?? new Set<string>();
    const explicitlyMentioned = Array.from(tokens).some((token) => {
      if (documentFrequency.get(token) !== 1) return false;
      if (/^[a-z]/.test(token)) {
        return queryLatin.some((queryToken) =>
          queryToken === token
          || (queryToken.length >= 4 && token.startsWith(queryToken))
          || (token.length >= 4 && queryToken.startsWith(token)),
        );
      }
      return queryHan.some((queryToken) =>
        queryToken.length >= 2
        && (token.includes(queryToken) || queryToken.includes(token)),
      );
    });
    if (explicitlyMentioned) result.add(document.documentId);
  }
  return result;
}

export function trimWeakKnowledgeEvidence(
  matches: SemanticKnowledgeMatch[],
  documentIdForRecord: (recordKey: string) => string,
  mode: "keyword" | "semantic" | "hybrid",
  limit: number,
): SemanticKnowledgeMatch[] {
  const topScore = matches[0]?.score ?? 0;
  const relativeCutoff = mode === "keyword" ? 0.3 : mode === "semantic" ? 0.72 : 0.55;
  const perDocument = new Map<string, number>();
  const result: SemanticKnowledgeMatch[] = [];
  for (const [index, match] of matches.entries()) {
    if (index >= 2 && topScore > 0 && match.score < topScore * relativeCutoff) continue;
    const documentId = documentIdForRecord(match.recordKey) || match.recordKey;
    const count = perDocument.get(documentId) ?? 0;
    if (count >= 3) continue;
    result.push(match);
    perDocument.set(documentId, count + 1);
    if (result.length >= limit) break;
  }
  return result;
}
