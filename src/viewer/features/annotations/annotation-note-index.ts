

import { restoredHelperNotesBySignature, restoredHelperNotesByStorageKey } from "../../app/viewer-state";



import { normalizeStorageKey } from "./annotation-value-codec";

export function rememberHelperNote(
  key: string | undefined,
  signature: string | undefined,
  note: string,
) {
  const normalizedNote = note.trim();
  if (!normalizedNote) return;

  // Runtime editor ids are reused after restoration. Index geometry-bearing
  // notes only by geometry; keep key lookup for old payloads without geometry.
  if (key && !signature)
    restoredHelperNotesByStorageKey.set(
      normalizeStorageKey(key),
      normalizedNote,
    );
  if (signature) restoredHelperNotesBySignature.set(signature, normalizedNote);
}

export function forgetHelperNote(
  key: string | undefined,
  signature: string | undefined,
) {
  if (key) restoredHelperNotesByStorageKey.delete(normalizeStorageKey(key));
  if (signature) restoredHelperNotesBySignature.delete(signature);
}

export function getRememberedHelperNote(keys: string[], signature: string): string {
  // The geometry belongs to the annotation itself. PDF.js editor ids are
  // transient and can be reassigned after annotations are restored, so an id
  // match must never override a geometry match with unrelated note content.
  const bySignature = signature
    ? restoredHelperNotesBySignature.get(signature)?.trim()
    : "";
  if (bySignature) return bySignature;

  for (const key of keys) {
    if (/^pdfjs_internal_editor_/.test(normalizeStorageKey(key))) continue;
    const note = restoredHelperNotesByStorageKey
      .get(normalizeStorageKey(key))
      ?.trim();
    if (note) return note;
  }
  return "";
}
