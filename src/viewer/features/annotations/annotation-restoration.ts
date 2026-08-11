import { type PDFDocumentProxy } from "pdfjs-dist";

import { pdfDocument } from "../../app/viewer-state";

import { extractCommentText, getAnnotationNoteFromValue } from "./annotations";

import { fromJsonSafeAnnotationValue } from "./embedded-helper-payload";
import { getAnnotationGeometrySignature, isRecord, isStoredHighlightValue, normalizeStorageKey, sanitizeAnnotationStorageValue } from "./annotation-value-codec";
import { getRememberedHelperNote, rememberHelperNote } from "./annotation-note-index";
import { readEmbeddedHelperPayload } from "./embedded-helper-payload";
import type { EmbeddedHelperAnnotations } from "./annotation-value-codec";

export function restoreHelperNoteIndexes(notes: unknown) {
  if (!Array.isArray(notes)) return;

  for (const item of notes) {
    if (!isRecord(item)) continue;
    const note = extractCommentText(item.note);
    if (!note) continue;
    const key = typeof item.key === "string" ? item.key : undefined;
    const signature =
      typeof item.signature === "string" ? item.signature : undefined;
    rememberHelperNote(key, signature, note);
  }
}

export function restoreEmbeddedHelperPayload(
  payload: EmbeddedHelperAnnotations | null,
): number {
  if (!payload) return 0;

  // Fingerprint is kept as metadata only. Embedding pdfhelper.json changes the PDF
  // bytes and can change pdf.js' calculated fingerprint, so it must not block
  // restoring data that is already inside the currently opened PDF.

  let restoredCount = 0;
  const annotationStorage = (pdfDocument.value as any)?.annotationStorage;
  if (!annotationStorage) return 0;
  restoreHelperNoteIndexes(payload.notes);

  for (const [key, storedValue] of payload.entries) {
    const value = fromJsonSafeAnnotationValue(storedValue);
    if (!isRecord(value)) continue;
    if (
      !Number.isInteger(value.pageIndex) ||
      (value.annotationType === undefined &&
        value.annotationEditorType === undefined)
    ) {
      continue;
    }

    const normalizedKey = normalizeStorageKey(String(key));
    const signature = getAnnotationGeometrySignature(value);
    const note =
      getAnnotationNoteFromValue(value) ||
      getRememberedHelperNote(
        [normalizedKey, `pdf-helper-${normalizedKey}`],
        signature,
      );
    if (note) {
      value.pdfHelperNote = note;
      if (isStoredHighlightValue(value)) {
        value.comment = note;
      }

      rememberHelperNote(normalizedKey, signature, note);
    }

    const restoredValue = sanitizeAnnotationStorageValue(value);
    annotationStorage.setValue(`pdf-helper-${normalizedKey}`, {
      ...restoredValue,
      isClone: true,
    });
    restoredCount += 1;
  }

  annotationStorage.resetModified?.();
  return restoredCount;
}

export async function restoreHelperAnnotations(
  documentProxy: PDFDocumentProxy,
): Promise<number> {
  const payload = await readEmbeddedHelperPayload(documentProxy);
  return restoreEmbeddedHelperPayload(payload);
}
