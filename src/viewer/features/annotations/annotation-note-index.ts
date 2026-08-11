

import { restoredHelperNotesBySignature, restoredHelperNotesByStorageKey } from "../../app/viewer-state";



import { normalizeStorageKey } from "./annotation-value-codec";

export function rememberHelperNote(
  key: string | undefined,
  signature: string | undefined,
  note: string,
) {
  const normalizedNote = note.trim();
  if (!normalizedNote) return;

  if (key)
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
  for (const key of keys) {
    const note = restoredHelperNotesByStorageKey
      .get(normalizeStorageKey(key))
      ?.trim();
    if (note) return note;
  }

  return (
    (signature ? restoredHelperNotesBySignature.get(signature)?.trim() : "") ||
    ""
  );
}
