import { AnnotationEditorType, type PDFDocumentProxy } from "pdfjs-dist";

import { pdfDocument, sourceName } from "../../app/viewer-state";





export type EmbeddedHelperAnnotations = {
  format: "pdf-helper.annotations";
  version: 1;
  app: "PDF Helper";
  sourceName: string;
  fingerprint: string;
  savedAt: string;
  entries: Array<[string, unknown]>;
  notes?: EmbeddedHelperNote[];
};

export type EmbeddedHelperNote = {
  key?: string;
  signature?: string;
  note: string;
};

export const PDF_HELPER_ATTACHMENT_NAME = "pdfhelper.json";

export const PDF_HELPER_ATTACHMENT_DESCRIPTION =
  "PDF Helper internal annotation data. Open with PDF Helper to restore enhanced reading notes.";

export const DEFAULT_HIGHLIGHT_RGB = [255, 240, 102] as const;

export const FREE_TEXT_MIN_SIZE = 4;

export const FREE_TEXT_MAX_SIZE = 72;

export const FREE_TEXT_DEFAULT_SIZE = 16;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPdfFingerprint(
  documentProxy: PDFDocumentProxy | null = pdfDocument.value,
): string {
  return (
    documentProxy?.fingerprints?.find((fingerprint): fingerprint is string =>
      Boolean(fingerprint),
    ) || ""
  );
}

export function normalizeStorageKey(key: string): string {
  return key.replace(/^(pdf-helper-)+/, "");
}

export function getEditorTypeValue(editor: any): unknown {
  return (
    editor?.editorType ??
    editor?._type ??
    editor?.annotationEditorType ??
    editor?._initialData?.annotationEditorType ??
    editor?._initialData?.annotationType ??
    editor?.data?.annotationEditorType ??
    editor?.data?.annotationType
  );
}

export function hasEditorClass(editor: any, className: string): boolean {
  return Boolean(
    (editor?.div as HTMLElement | null)?.classList?.contains(className),
  );
}

export function isHighlightEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "highlight" ||
    type === AnnotationEditorType.HIGHLIGHT ||
    editor?.constructor?._type === "highlight" ||
    editor?.constructor?._editorType === AnnotationEditorType.HIGHLIGHT ||
    hasEditorClass(editor, "highlightEditor")
  );
}

export function isFreeTextEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "freeText" ||
    type === AnnotationEditorType.FREETEXT ||
    editor?.constructor?._type === "freeText" ||
    editor?.constructor?._editorType === AnnotationEditorType.FREETEXT ||
    hasEditorClass(editor, "freeTextEditor")
  );
}

export function isInkEditor(editor: any): boolean {
  const type = getEditorTypeValue(editor);
  return (
    type === "ink" ||
    type === AnnotationEditorType.INK ||
    editor?.constructor?._type === "ink" ||
    editor?.constructor?._editorType === AnnotationEditorType.INK ||
    hasEditorClass(editor, "inkEditor")
  );
}

export function isStoredHighlightValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.annotationType === AnnotationEditorType.HIGHLIGHT ||
    value.annotationEditorType === AnnotationEditorType.HIGHLIGHT
  );
}

export function hexColorToRgb(color: string): number[] | null {
  const normalized = color.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function normalizeRgbColor(value: unknown): number[] | null {
  if (typeof value === "string") return hexColorToRgb(value);

  const numbers = flattenFiniteNumbers(value);
  if (numbers.length < 3) return null;

  return numbers
    .slice(0, 3)
    .map((channel) => Math.min(255, Math.max(0, Math.round(channel))));
}

export function rgbColorToHex(value: unknown): string | null {
  const rgb = normalizeRgbColor(value);
  if (!rgb) return null;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function sanitizeAnnotationStorageValue(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...value };

  // Runtime/UI fields must not be serialized back into pdf.js. They are valid
  // while an editor is alive, but stale copies can break deserialization after
  // reopening a PDF.
  for (const key of [
    "_uiManager",
    "uiManager",
    "parent",
    "div",
    "editor",
    "colorManager",
    "colorName",
    "hcmColor",
    "hcmColorName",
    "nonHCMColorName",
  ]) {
    delete output[key];
  }

  if (isStoredHighlightValue(output)) {
    const color =
      normalizeRgbColor(output.color) ?? DEFAULT_HIGHLIGHT_RGB.slice();
    output.color = color;
    if (output.highlightColor !== undefined) delete output.highlightColor;
  }

  return output;
}

export function flattenFiniteNumbers(value: unknown, output: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.push(value);
  } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    for (const item of Array.from(value as unknown as ArrayLike<number>)) {
      if (typeof item === "number" && Number.isFinite(item)) output.push(item);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) flattenFiniteNumbers(item, output);
  }
  return output;
}

export function getNumberArraySignature(value: unknown): string {
  return flattenFiniteNumbers(value)
    .map((number) => number.toFixed(3))
    .join(",");
}

export function getAnnotationGeometrySignature(value: unknown): string {
  if (!isRecord(value) || !Number.isInteger(value.pageIndex)) return "";

  const annotationType =
    value.annotationType ?? value.annotationEditorType ?? "";
  const rect = getNumberArraySignature(value.rect);
  const quadPoints = getNumberArraySignature(value.quadPoints);
  const outlines = isRecord(value.outlines)
    ? getNumberArraySignature(value.outlines.points)
    : "";

  return [value.pageIndex, annotationType, rect, quadPoints, outlines].join(
    "|",
  );
}

export function getEditorSerializedValue(editor: any): unknown {
  try {
    const serialized = editor?.serialize?.(false);
    if (serialized) return serialized;
  } catch {
    // Fall back to initial/internal data below.
  }

  return editor?._initialData ?? editor?.data ?? null;
}

export function getEditorStorageKeys(editor: any): string[] {
  const serialized = getEditorSerializedValue(editor);
  const keys = [
    editor?.id,
    editor?.uid,
    editor?.annotationElementId,
    editor?._initialData?.id,
    editor?._initialData?.annotationElementId,
    editor?.data?.id,
    editor?.data?.annotationElementId,
    isRecord(serialized) ? serialized.id : undefined,
    isRecord(serialized) ? serialized.annotationElementId : undefined,
  ];

  return Array.from(
    new Set(
      keys
        .filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        )
        .map(normalizeStorageKey),
    ),
  );
}
