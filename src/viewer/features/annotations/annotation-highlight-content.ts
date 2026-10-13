export const PDF_HELPER_HIGHLIGHT_TEXT_FIELD = "pdfHelperHighlightText";

function readTextCandidate(value: unknown): string {
  return typeof value === "string" ? normalizeHighlightText(value) : "";
}

export function normalizeHighlightText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00ad/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/gu, "")
    .replace(/^\s+|\s+$/gu, "");
}

function getComparableHighlightText(value: string): string {
  return normalizeHighlightText(value).replace(/\s+/gu, "");
}

/**
 * Use reconstructed PDF text only when it contains the same selected
 * characters as the browser Range. A stale text-layer snapshot can otherwise
 * return an unrelated slice after PDF.js rerenders or reuses a text layer.
 */
export function chooseHighlightSelectionText(
  nativeSelectionText: string,
  reconstructedSelectionText: string,
): string {
  const nativeText = normalizeHighlightText(nativeSelectionText);
  const reconstructedText = normalizeHighlightText(reconstructedSelectionText);
  if (!nativeText) return reconstructedText;
  if (!reconstructedText) return nativeText;

  return getComparableHighlightText(nativeText) ===
    getComparableHighlightText(reconstructedText)
    ? reconstructedText
    : nativeText;
}

export function getStoredHighlightText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return readTextCandidate(
    (value as Record<string, unknown>)[PDF_HELPER_HIGHLIGHT_TEXT_FIELD],
  );
}

export function getHighlightEditorText(editor: any): string {
  const stored =
    readTextCandidate(editor?.[PDF_HELPER_HIGHLIGHT_TEXT_FIELD]) ||
    readTextCandidate(editor?._pdfHelperHighlightText) ||
    getStoredHighlightText(editor?._initialData) ||
    getStoredHighlightText(editor?.data);
  if (stored) return stored;

  // PDF.js only uses aria-label for the selected source text when the editor
  // represents an in-session text highlight. Restored highlights receive a
  // localized generic label (for example "Highlight editor"), which must not
  // leak into the note quote or clipboard.
  const container = editor?.div;
  if (container?.getAttribute?.("role") !== "mark") return "";
  return readTextCandidate(container.getAttribute("aria-label"));
}

export function setHighlightEditorText(editor: any, value: string): string {
  const text = normalizeHighlightText(value);
  if (!editor || !text) return "";

  editor[PDF_HELPER_HIGHLIGHT_TEXT_FIELD] = text;
  editor._pdfHelperHighlightText = text;
  if (editor.div?.setAttribute) {
    editor.div.setAttribute("aria-label", text);
    editor.div.setAttribute("role", "mark");
  }
  return text;
}
