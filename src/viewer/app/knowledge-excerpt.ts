/**
 * Knowledge excerpt/tag formatting shared by the knowledge-base and paper-card
 * features. Pure functions, kept in the app assembly layer so paper-card does
 * not have to import knowledge-base internals.
 */
export function getKnowledgeExcerpt(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[•*-]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

export function normalizeKnowledgeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}
