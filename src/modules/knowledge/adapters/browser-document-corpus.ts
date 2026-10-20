const KNOWLEDGE_CORPUS_STORAGE_KEY = "pdf-helper-knowledge-corpus-v1";

/** How many older file identities one record remembers; see `linkKnowledgeDocumentSource`. */
const MAX_SOURCE_ALIASES = 5;

export type KnowledgeDocumentIndexStatus =
  | "pending"
  | "indexing"
  | "ready"
  | "error";

export type KnowledgeDocumentOverviewStatus =
  | "pending"
  | "generating"
  | "ready"
  | "error";

/**
 * How far the reader has got with a document.
 *
 * Three states, no more: a library view needs "what have I not read yet" and "what am I in the middle of", and every
 * extra state is one more thing to decide when filing a paper. Records written before this existed have no value, which
 * is read as `todo` — no migration pass.
 */
export type KnowledgeDocumentReadingStatus = "todo" | "reading" | "done";

export interface KnowledgeFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface KnowledgeLibraryDocument {
  documentId: string;
  documentName: string;
  pageCount: number;
  recentEntryId?: string;
  /**
   * 同一篇文献的其他文件身份（PDF 指纹）。
   *
   * The same paper is often more than one file on disk: saving annotated PDFs re-saves the bytes (pdf-lib writes an
   * embedded attachment), so the file's fingerprint changes while the paper does not. The record keeps its original
   * `documentId` — that id is the graph's paper id and every entity hangs off it — and remembers the newer files here,
   * so opening the annotated copy still finds this record instead of offering to add the paper a second time.
   */
  aliases?: string[];
  folderId: string | null;
  addedAt: string;
  updatedAt: string;
  indexStatus: KnowledgeDocumentIndexStatus;
  chunkCount: number;
  indexError?: string;
  overviewStatus?: KnowledgeDocumentOverviewStatus;
  overviewError?: string;
  overviewMarkdown?: string;
  overviewGeneratedAt?: string;
  overviewRequestId?: string;
  overviewDraftMarkdown?: string;
  overviewDraftComplete?: boolean;
  overviewProgress?: string;
  overviewEditedAt?: string;
  /**
   * The 「相关论文」 section, kept beside the overview rather than inside it.
   *
   * Separate because it is produced on demand and must survive the user editing the overview by hand: folding
   * it into `overviewMarkdown` would mean an edit (or a regeneration) silently deletes a section the user paid
   * a retrieval call for.
   */
  relatedLiteratureMarkdown?: string;
  relatedLiteratureAt?: string;
  /** Tool calls this section cost, so the page can say "1 次检索" instead of implying it was free. */
  relatedLiteratureUsage?: { searchCalls: number; fetchCalls: number };
  relatedLiteratureSources?: Array<"deepseek" | "openalex">;
  relatedLiteratureError?: string;
  /** Absent on records written before the field existed; treat as `todo`. */
  readingStatus?: KnowledgeDocumentReadingStatus;

  /**
   * Bibliographic metadata, filled by the model when a document is added.
   *
   * All of it is optional and independent: a contract has no DOI, a web page has no page count, and an old scan
   * has no authors the model can find. Empty means "not known", never "the model said there are none" — which is
   * why the panel shows a dash instead of hiding a row, and why nothing here is required for the library to work.
   */
  authors?: string[];
  /** Publication date as the model read it (`2026`, `2026-10`, `2026-10-18`); kept verbatim rather than guessed. */
  publishDate?: string;
  /** ISO 639-1 code (`en`, `zh`, …), as a two-letter language tag. */
  language?: string;
  /** Canonical link to the work (arXiv, publisher, DOI resolver). */
  documentUrl?: string;
  /** Bare DOI (`10.xxxx/yyy`), without the `https://doi.org/` prefix. */
  doi?: string;
  /**
   * Whether the metadata pass has run, so the panel can say "尚未提取" instead of showing five dashes.
   *
   * `skipped` is the user's own decision that this document needs no bibliographic data (a handout, an internal report,
   * a journal that issues no DOIs). It is terminal on purpose: the library stops offering to extract, and the 缺元数据
   * filter stops listing it.
   */
  metadataStatus?: "pending" | "extracting" | "ready" | "error" | "skipped";
  metadataError?: string;
  metadataAt?: string;
  /**
   * Per-field provenance: which pass produced the value now stored.
   *
   * The panel shows it ("DOI · 手动"), and the write policy reads it: an automatic pass may fill a blank field, but never
   * replaces one the user typed by hand.
   */
  metadataSources?: Partial<Record<
    "authors" | "publishDate" | "language" | "documentUrl" | "doi",
    "pdf" | "text" | "ai" | "online" | "manual"
  >>;
}

interface KnowledgeCorpusState {
  folders: KnowledgeFolder[];
  documents: KnowledgeLibraryDocument[];
}

function readState(): KnowledgeCorpusState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(KNOWLEDGE_CORPUS_STORAGE_KEY) || "null",
    ) as Partial<KnowledgeCorpusState> | null;
    const rawFolders = Array.isArray(parsed?.folders) ? parsed.folders : [];
    const folderIds = new Set(rawFolders.map((folder) => folder.id));
    const folders = rawFolders.map((folder) => ({
      ...folder,
      parentId: typeof folder.parentId === "string"
        && folder.parentId !== folder.id
        && folderIds.has(folder.parentId)
        ? folder.parentId
        : null,
    }));
    return {
      folders,
      documents: Array.isArray(parsed?.documents) ? parsed.documents : [],
    };
  } catch {
    return { folders: [], documents: [] };
  }
}

function writeState(state: KnowledgeCorpusState): void {
  localStorage.setItem(KNOWLEDGE_CORPUS_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("pdf-helper:knowledge-corpus-change"));
}

export function listKnowledgeFolders(): KnowledgeFolder[] {
  return [...readState().folders];
}

export function listKnowledgeDocuments(): KnowledgeLibraryDocument[] {
  return [...readState().documents];
}

/**
 * Finds the record by its id **or by any file identity it has absorbed**.
 *
 * Resolution lives here rather than at each call site because every caller asks the same question — "is this open PDF
 * in the library" — and the answer must not depend on which of the paper's files happens to be open. Writes resolve the
 * same way, so marking a re-saved file as 已读 updates the paper rather than silently doing nothing.
 */
function resolveDocument(
  documents: KnowledgeLibraryDocument[],
  documentId: string,
): KnowledgeLibraryDocument | undefined {
  const direct = documents.find((item) => item.documentId === documentId);
  if (direct) return direct;
  return documents.find((item) => item.aliases?.includes(documentId));
}

export function getKnowledgeDocument(
  documentId: string,
): KnowledgeLibraryDocument | undefined {
  return resolveDocument(readState().documents, documentId);
}

/**
 * Points a record at a newer file with the same paper's content (e.g. the copy saved with annotations embedded).
 *
 * The `documentId` stays put: it is the graph's paper id and the key every entity, edge and extraction job was
 * recorded under. Only the "which file do we open" edge changes, plus an alias so the new file resolves to this record.
 * The alias list keeps the most recent few — every save re-writes the bytes, so an unbounded list would grow with each
 * save forever.
 */
export function linkKnowledgeDocumentSource(
  documentId: string,
  source: { sourceDocumentId: string; recentEntryId?: string },
): KnowledgeLibraryDocument | undefined {
  const state = readState();
  const document = resolveDocument(state.documents, documentId);
  if (!document) return undefined;
  const aliases = (document.aliases ?? []).filter((alias) => alias !== document.documentId);
  const nextAliases = source.sourceDocumentId === document.documentId
    ? aliases
    : [source.sourceDocumentId, ...aliases.filter((alias) => alias !== source.sourceDocumentId)];
  Object.assign(document, {
    aliases: nextAliases.length ? nextAliases.slice(0, MAX_SOURCE_ALIASES) : undefined,
    recentEntryId: source.recentEntryId ?? document.recentEntryId,
    updatedAt: new Date().toISOString(),
  });
  writeState(state);
  return document;
}

export function addKnowledgeDocument(
  input: Pick<
    KnowledgeLibraryDocument,
    "documentId" | "documentName" | "pageCount" | "recentEntryId"
  >,
): KnowledgeLibraryDocument {
  const state = readState();
  const existing = state.documents.find(
    (item) => item.documentId === input.documentId,
  );
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, input, { updatedAt: now });
    writeState(state);
    return existing;
  }
  const document: KnowledgeLibraryDocument = {
    ...input,
    folderId: null,
    addedAt: now,
    updatedAt: now,
    indexStatus: "pending",
    chunkCount: 0,
    overviewStatus: "pending",
    readingStatus: "todo",
    // The bibliographic pass runs right after the text extraction that follows this call; until it does, the panel
    // shows "尚未提取" rather than five empty rows pretending to be facts.
    metadataStatus: "pending",
  };
  state.documents.unshift(document);
  writeState(state);
  return document;
}

export function updateKnowledgeDocument(
  documentId: string,
  changes: Partial<Omit<KnowledgeLibraryDocument, "documentId" | "addedAt">>,
): void {
  const state = readState();
  const document = resolveDocument(state.documents, documentId);
  if (!document) return;
  Object.assign(document, changes, { updatedAt: new Date().toISOString() });
  writeState(state);
}

export function removeKnowledgeDocument(documentId: string): void {
  const state = readState();
  const target = resolveDocument(state.documents, documentId);
  if (!target) return;
  state.documents = state.documents.filter(
    (item) => item.documentId !== target.documentId,
  );
  writeState(state);
}

export function createKnowledgeFolder(
  name: string,
  parentId: string | null = null,
): KnowledgeFolder {
  const state = readState();
  const normalizedName = name.trim();
  const validParentId = parentId && state.folders.some((folder) => folder.id === parentId)
    ? parentId
    : null;
  const existing = state.folders.find(
    (folder) => folder.parentId === validParentId
      && folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  );
  if (existing) return existing;
  const folder: KnowledgeFolder = {
    id: crypto.randomUUID(),
    name: normalizedName,
    parentId: validParentId,
    createdAt: new Date().toISOString(),
  };
  state.folders.push(folder);
  writeState(state);
  return folder;
}

export function deleteKnowledgeFolder(folderId: string): void {
  const state = readState();
  const deletedIds = new Set<string>([folderId]);
  let foundNestedFolder = true;
  while (foundNestedFolder) {
    foundNestedFolder = false;
    for (const folder of state.folders) {
      if (folder.parentId && deletedIds.has(folder.parentId) && !deletedIds.has(folder.id)) {
        deletedIds.add(folder.id);
        foundNestedFolder = true;
      }
    }
  }
  state.folders = state.folders.filter((folder) => !deletedIds.has(folder.id));
  state.documents.forEach((document) => {
    if (document.folderId && deletedIds.has(document.folderId)) document.folderId = null;
  });
  writeState(state);
}
