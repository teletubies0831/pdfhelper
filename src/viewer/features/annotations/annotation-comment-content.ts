export function extractCommentText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value.deleted === true) return "";
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.contents === "string") return value.contents.trim();
  if (typeof value.str === "string") return value.str.trim();
  if (typeof value.richText?.str === "string") return value.richText.str.trim();
  if (typeof value.contentsObj?.str === "string")
    return value.contentsObj.str.trim();
  return "";
}

export function getAnnotationNoteFromValue(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  // An explicitly saved empty note is a deletion, not a missing value.
  if (typeof record.pdfHelperNote === "string") return record.pdfHelperNote.trim();
  if (record.comment && typeof record.comment === "object" &&
      "deleted" in record.comment && record.comment.deleted === true) return "";
  return (
    extractCommentText(record.pdfHelperNote) ||
    extractCommentText(record.comment) ||
    extractCommentText(record.popup) ||
    extractCommentText(record.contentsObj) ||
    extractCommentText(record.richText) ||
    ""
  );
}
