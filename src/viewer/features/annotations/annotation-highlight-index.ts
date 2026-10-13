import {
  restoredHighlightTextBySignature,
  restoredHighlightTextByStorageKey,
} from "../../app/viewer-state";
import { normalizeStorageKey } from "./annotation-value-codec";
import { normalizeHighlightText } from "./annotation-highlight-content";

export function rememberHighlightText(
  key: string | undefined,
  signature: string | undefined,
  value: string,
): void {
  const text = normalizeHighlightText(value);
  if (!text) return;
  if (signature) restoredHighlightTextBySignature.set(signature, text);
  if (key && !signature) restoredHighlightTextByStorageKey.set(normalizeStorageKey(key), text);
}

export function getRememberedHighlightText(
  keys: string[],
  signature: string,
): string {
  // Geometry identifies the actual mark. Prefer it over PDF.js' transient
  // editor id, which can change after save/reopen or be reused after deletion.
  const bySignature = signature
    ? restoredHighlightTextBySignature.get(signature)?.trim()
    : "";
  if (bySignature) return bySignature;

  for (const key of keys) {
    if (/^pdfjs_internal_editor_/.test(normalizeStorageKey(key))) continue;
    const text = restoredHighlightTextByStorageKey
      .get(normalizeStorageKey(key))
      ?.trim();
    if (text) return text;
  }
  return "";
}
