const KNOWLEDGE_CORPUS_STORAGE_KEY = "pdf-helper-knowledge-corpus-v1";

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

export function getKnowledgeDocument(
  documentId: string,
): KnowledgeLibraryDocument | undefined {
  return readState().documents.find((item) => item.documentId === documentId);
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
  const document = state.documents.find((item) => item.documentId === documentId);
  if (!document) return;
  Object.assign(document, changes, { updatedAt: new Date().toISOString() });
  writeState(state);
}

export function removeKnowledgeDocument(documentId: string): void {
  const state = readState();
  state.documents = state.documents.filter(
    (item) => item.documentId !== documentId,
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
