/**
 * 判断「当前打开的这份 PDF」是否就是知识库记录指向的源文件.
 *
 * Kept pure (no signals, no DOM) so the identity rule can be tested directly — it is the rule that decides whether 「打开原文」/「生成
 * 概览」 reuses the reader's current PDF or opens the right file.
 */

/**
 * 规范化成可比较的文件名.
 *
 * A remote PDF's `sourceName` is a **URL**, and the reader's display-name helper turns that into the last path segment. That
 * conversion has to survive here too: dropping it made an already-open remote PDF stop matching its own knowledge-base record, so
 * 「打开原文」 fell back to re-opening it from the recent list and failed when the entry was gone.
 *
 * The URL handling is duplicated rather than imported because this module is the pure rule: `core/pdf-reader` drags in the viewer
 * (DOM, PDF.js). `getDisplayFileName` wins at the call site — this is the defensive floor for callers that pass a URL.
 */
export function normalizePdfFileName(value: string): string {
  let name = value.trim();
  if (/^(?:https?|file):\/\//i.test(name) || /^[a-z]:[\\/]/i.test(name) || /\\/.test(name)) {
    const withoutQuery = name.split(/[?#]/)[0] ?? name;
    const last = withoutQuery.split(/[\\/]/).filter(Boolean).pop();
    if (last) {
      try {
        name = decodeURIComponent(last);
      } catch {
        name = last;
      }
    }
  }
  return name
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export interface OpenSourceMatchInput {
  /** 阅读器里是否有已打开的 PDF。 */
  hasOpenDocument: boolean;
  /** 当前打开文档对应的最近文件条目 id（可能没有）。 */
  openEntryId: string | null;
  /** 调用方为这条知识库记录记录的条目 id；未提供表示「没有 id 可用」。 */
  requestedEntryId?: string;
  /** 当前打开文档的显示名。 */
  openName: string;
  /** 知识库记录的名字。 */
  targetName: string;
}

/**
 * 条目 id 是强身份.
 *
 * Two different files can share a name — a downloaded copy and a saved annotated copy (`论文.pdf` / `论文-pdfpal.pdf`), or simply two
 * papers both named `paper.pdf` — and the name-only fallback treated them as the same document. The consequence was concrete: the
 * "source" path returned true, so PDFPal skipped opening the real file and extracted the overview from whatever PDF happened to be
 * open, then saved it onto the record.
 *
 * The name comparison survives only where there is no id to compare, which is the one case it is good for: a document opened
 * outside the recent-files flow.
 */
export function sourcePdfMatchesOpenDocument(input: OpenSourceMatchInput): boolean {
  if (!input.hasOpenDocument) return false;
  if (input.requestedEntryId) return input.openEntryId === input.requestedEntryId;
  return normalizePdfFileName(input.openName) === normalizePdfFileName(input.targetName);
}
