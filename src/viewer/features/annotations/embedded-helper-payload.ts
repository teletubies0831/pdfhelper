import { type PDFDocumentProxy } from "pdfjs-dist";

import { annotationEditor, pdfDocument, sourceName } from "../../app/viewer-state";

import { getHighlightNote, getStoredOrLiveAnnotationNote } from "./annotations";

import { getAnnotationGeometrySignature, getEditorSerializedValue, getEditorStorageKeys, getPdfFingerprint, isHighlightEditor, isRecord, isStoredHighlightValue, normalizeStorageKey, sanitizeAnnotationStorageValue, PDF_HELPER_ATTACHMENT_NAME, type EmbeddedHelperAnnotations, type EmbeddedHelperNote } from "./annotation-value-codec";


export function toJsonSafeAnnotationValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typedArray = value as unknown as ArrayLike<number> & {
      constructor: { name: string };
    };
    return {
      __pdfHelperTypedArray: typedArray.constructor.name,
      values: Array.from(typedArray),
    };
  }

  if (Array.isArray(value)) return value.map(toJsonSafeAnnotationValue);

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = toJsonSafeAnnotationValue(nestedValue);
    }
    return output;
  }

  return value;
}

export function fromJsonSafeAnnotationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJsonSafeAnnotationValue);

  if (isRecord(value)) {
    if (
      typeof value.__pdfHelperTypedArray === "string" &&
      Array.isArray(value.values)
    ) {
      const values = value.values as number[];
      switch (value.__pdfHelperTypedArray) {
        case "Float32Array":
          return new Float32Array(values);
        case "Float64Array":
          return new Float64Array(values);
        case "Uint8Array":
          return new Uint8Array(values);
        case "Uint8ClampedArray":
          return new Uint8ClampedArray(values);
        case "Uint16Array":
          return new Uint16Array(values);
        case "Uint32Array":
          return new Uint32Array(values);
        case "Int8Array":
          return new Int8Array(values);
        case "Int16Array":
          return new Int16Array(values);
        case "Int32Array":
          return new Int32Array(values);
        default:
          return values;
      }
    }

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = fromJsonSafeAnnotationValue(nestedValue);
    }
    return output;
  }

  return value;
}

export function getSerializableAnnotationEntries(): Array<[string, unknown]> {
  if (!pdfDocument.value) return [];
  const serializable = (pdfDocument.value as any).annotationStorage?.serializable;
  const map = serializable?.map;
  if (!(map instanceof Map)) return [];

  return Array.from(map.entries())
    .filter(([, value]) => {
      if (!isRecord(value) || value.deleted === true) return false;
      return (
        Number.isInteger(value.pageIndex) &&
        (value.annotationType !== undefined ||
          value.annotationEditorType !== undefined)
      );
    })
    .map(([key, value]) => {
      const normalizedKey = String(key);
      const note = getStoredOrLiveAnnotationNote(normalizedKey, value);
      const output = { ...value };

      if (note) {
        output.pdfHelperNote = note;
        if (isStoredHighlightValue(output)) {
          output.comment = note;
        }
      }

      return [
        normalizedKey,
        toJsonSafeAnnotationValue(sanitizeAnnotationStorageValue(output)),
      ];
    });
}

export function getSerializableHelperNotes(): EmbeddedHelperNote[] {
  if (!pdfDocument.value) return [];

  const notes = new Map<string, EmbeddedHelperNote>();
  const addNote = (
    key: string | undefined,
    signature: string | undefined,
    note: string,
  ) => {
    const normalizedNote = note.trim();
    if (!normalizedNote) return;
    const normalizedKey = key ? normalizeStorageKey(key) : undefined;
    const id = `${normalizedKey || ""}|${signature || ""}|${normalizedNote}`;
    notes.set(id, {
      ...(normalizedKey ? { key: normalizedKey } : {}),
      ...(signature ? { signature } : {}),
      note: normalizedNote,
    });
  };

  const serializable = (pdfDocument.value as any).annotationStorage?.serializable;
  const map = serializable?.map;
  if (map instanceof Map) {
    for (const [key, value] of map.entries()) {
      if (!isRecord(value)) continue;
      const note = getStoredOrLiveAnnotationNote(String(key), value);
      addNote(String(key), getAnnotationGeometrySignature(value), note);
    }
  }

  if (annotationEditor.value) {
    for (
      let pageIndex = 0;
      pageIndex < (pdfDocument.value?.numPages ?? 0);
      pageIndex += 1
    ) {
      for (const editor of annotationEditor.value.getEditors(pageIndex)) {
        if (!isHighlightEditor(editor)) continue;
        const note = getHighlightNote(editor);
        if (!note) continue;
        const signature = getAnnotationGeometrySignature(
          getEditorSerializedValue(editor),
        );
        const keys = getEditorStorageKeys(editor);
        if (keys.length === 0) {
          addNote(undefined, signature, note);
        } else {
          for (const key of keys) addNote(key, signature, note);
        }
      }
    }
  }

  return Array.from(notes.values());
}

export function createEmbeddedHelperPayload(): EmbeddedHelperAnnotations {
  if (!pdfDocument.value) throw new Error("PDF 尚未打开。");
  const entries = getSerializableAnnotationEntries();
  return {
    format: "pdf-helper.annotations",
    version: 1,
    app: "PDFPal",
    sourceName: sourceName.value,
    fingerprint: getPdfFingerprint(pdfDocument.value),
    savedAt: new Date().toISOString(),
    entries,
    notes: getSerializableHelperNotes(),
  };
}

export function parseEmbeddedHelperPayload(
  rawJson: string,
): EmbeddedHelperAnnotations | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  if (payload.format !== "pdf-helper.annotations") return null;
  if (payload.version !== 1) return null;
  if (!Array.isArray(payload.entries)) return null;

  return payload as EmbeddedHelperAnnotations;
}

export function decodeAttachmentContent(content: unknown): string | null {
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (content instanceof ArrayBuffer)
    return new TextDecoder().decode(new Uint8Array(content));
  if (Array.isArray(content))
    return new TextDecoder().decode(new Uint8Array(content));
  if (typeof content === "string") return content;
  return null;
}

export async function readEmbeddedHelperPayload(
  documentProxy: PDFDocumentProxy,
): Promise<EmbeddedHelperAnnotations | null> {
  const attachments = (await documentProxy.getAttachments()) as Record<
    string,
    { content?: unknown; filename?: string }
  > | null;
  if (!attachments) return null;

  const candidates: EmbeddedHelperAnnotations[] = [];
  for (const [name, attachment] of Object.entries(attachments)) {
    const filename = attachment.filename || name;
    if (
      filename !== PDF_HELPER_ATTACHMENT_NAME &&
      name !== PDF_HELPER_ATTACHMENT_NAME
    )
      continue;
    const rawJson = decodeAttachmentContent(attachment.content);
    if (!rawJson) continue;
    const payload = parseEmbeddedHelperPayload(rawJson);
    if (payload) candidates.push(payload);
  }

  return (
    candidates.sort(
      (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt),
    )[0] ?? null
  );
}
