import type { AiEvidenceSource } from "../../../modules/ai/public";

function knowledgeMatchesFromToolContent(content: string): unknown[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const candidate = parsed as Record<string, unknown>;
    const payload = candidate.data && typeof candidate.data === "object"
      ? candidate.data as Record<string, unknown>
      : candidate;
    return Array.isArray(payload.knowledgeMatches) ? payload.knowledgeMatches : [];
  } catch {
    return [];
  }
}

export function readKnowledgeEvidenceSources(content: string): AiEvidenceSource[] {
  const shortcuts = new Map<string, AiEvidenceSource>();
  for (const value of knowledgeMatchesFromToolContent(content)) {
    if (!value || typeof value !== "object") continue;
    const match = value as Record<string, unknown>;
    const documentId = typeof match.documentId === "string" ? match.documentId : "";
    const documentName = typeof match.documentName === "string" ? match.documentName : "";
    const pageNumber = typeof match.startPage === "number"
      ? match.startPage
      : typeof match.pageNumber === "number"
        ? match.pageNumber
        : 0;
    if (!documentName || pageNumber < 1) continue;
    const source: AiEvidenceSource = {
      documentId: documentId || documentName,
      documentName,
      pageNumber,
      recentEntryId: typeof match.recentEntryId === "string"
        ? match.recentEntryId
        : undefined,
    };
    shortcuts.set(`${source.documentId}:${source.pageNumber}`, source);
    if (shortcuts.size >= 8) break;
  }
  return [...shortcuts.values()];
}

export function mergeEvidenceSources(
  current: AiEvidenceSource[],
  incoming: AiEvidenceSource[],
): AiEvidenceSource[] {
  return [...new Map(
    [...current, ...incoming].map((source) => [
      `${source.documentId}:${source.pageNumber}`,
      source,
    ]),
  ).values()].slice(0, 8);
}
