import type { KnowledgeLibraryDocument } from '../adapters/browser-document-corpus';

/**
 * 「这是同一篇文献吗」——添加文献前必须回答的问题。
 *
 * The library keys its records by PDF fingerprint (`pdf:<fingerprint>`). That is the right key for identity — it is what
 * the graph uses as a paper id — but it is a key on **bytes**, and the app itself changes those bytes: saving annotations
 * embeds an attachment with pdf-lib and re-writes the file, so `我的论文.pdf` and `我的论文-pdfpal.pdf` are one paper with
 * two fingerprints.
 *
 * Without this check that shows up as a confusing duplicate: reopening the annotated file offers 「添加到知识库」 again,
 * and accepting it creates a second record — a second index, a second graph paper, two entries for one work.
 *
 * Only two signals are used, because both are available *before* anything is extracted: the name with the decorations
 * the app and the OS add stripped off, and the page count. Matching by DOI would be stronger, but the DOI for a file
 * that was never added yet is exactly what the first-page extraction has not run for, and running it just to answer
 * "did I already add this?" would spend a model call on every add.
 */

/**
 * The decorations a file name picks up on its way through the save paths.
 *
 * Only patterns that cannot be a paper's own title: `-pdfpal` is this app's download suffix, `(1)`/`副本`/`-1` come from a
 * second copy in the same folder, and `annotated` is what users type. Stripping repeats because `论文-pdfpal (1).pdf`
 * exists in the wild.
 *
 * The numbered form requires a **space** before the dash on purpose: `论文 - 2.pdf` is a copy, but `Llama-3.pdf` and
 * `GPT-4.pdf` are the paper's own names — stripping those would make two different papers share a key, and the
 * identity check would then merge them (repairing the library record to the wrong file, or refusing to add the second
 * paper at all).
 */
const COPY_SUFFIXES = [
  /\s*-\s*pdfpal$/i,
  /\s*[-_ ]annotated$/i,
  /\s*\(\s*\d{1,2}\s*\)$/,
  /\s*-\s*copy$/i,
  /\s*copy\s*\d*$/i,
  /\s*-\s*副本\s*\d*$/,
  /\s*副本\s*\d*$/,
  /\s*\(\s*副本\s*\d*\s*\)$/,
  /\s+-\s*\d{1,2}$/,
];

/** A comparable name for "same paper" purposes: extension and save decorations gone, case and whitespace normalized. */
export function paperNameKey(name: string): string {
  let base = name
    .trim()
    .replace(/\.pdf$/i, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  let previous = '';
  while (base !== previous) {
    previous = base;
    for (const suffix of COPY_SUFFIXES) base = base.replace(suffix, '').trim();
  }
  return base.toLocaleLowerCase();
}

export interface PaperIdentityCandidate {
  documentId: string;
  documentName: string;
  pageCount: number;
}

/**
 * Finds the record this file belongs to, if the library already has that paper under a different file identity.
 *
 * A record with the *same* `documentId` is not a match — that is an exact re-add and the caller handles it separately.
 * The page count has to agree as well: two unrelated papers can both be called `Introduction.pdf`, and a name alone is
 * not enough to merge two library entries.
 */
export function findSamePaperDocument(
  documents: readonly KnowledgeLibraryDocument[],
  candidate: PaperIdentityCandidate,
): KnowledgeLibraryDocument | null {
  const candidateName = paperNameKey(candidate.documentName);
  if (!candidateName) return null;
  return documents.find((item) => (
    item.documentId !== candidate.documentId
    && paperNameKey(item.documentName) === candidateName
    && (candidate.pageCount <= 0 || item.pageCount === candidate.pageCount)
  )) ?? null;
}
