import type {
  LongTermMemory,
  LongTermMemorySearchOptions,
  MemoryToolCall,
  MemoryToolResult,
  MemoryTools,
  PaperLibraryRecord,
  PaperLibrarySearchOptions,
  PaperLibraryTools,
  UpsertLongTermMemoryInput,
  UpsertPaperLibraryInput,
} from '../../shared/memory';
import {
  LONG_TERM_MEMORIES_STORE,
  PAPER_LIBRARY_STORE,
  openDocumentAgentDatabase,
  requestToPromise,
  transactionDone,
} from './document-agent-db';

const clamp = (value: number | undefined, fallback: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? Number(value) : fallback));

const normalizeLimit = (value: number | undefined, fallback = 8): number =>
  Math.min(100, Math.max(1, Number.isFinite(value) ? Math.round(Number(value)) : fallback));

const normalizeText = (value: string | undefined): string => value?.trim().replace(/\s+/g, ' ') ?? '';

const createId = (prefix: string): string =>
  `${prefix}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}:${Math.random()}`}`;

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const database = await openDocumentAgentDatabase();
  try {
    const transaction = database.transaction(storeName, 'readonly');
    return await requestToPromise<T[]>(transaction.objectStore(storeName).getAll());
  } finally {
    database.close();
  }
}

function memoryMatches(memory: LongTermMemory, options: LongTermMemorySearchOptions): boolean {
  const now = Date.now();
  if (!options.includeExpired && memory.expiresAt && memory.expiresAt <= now) return false;
  const status = memory.status ?? 'active';
  const statuses = options.statuses?.length ? options.statuses : ['active'];
  if (!statuses.includes(status)) return false;
  if (options.categories?.length && !options.categories.includes(memory.category)) return false;
  if (options.sourcePdfId && memory.sourcePdfId !== options.sourcePdfId) return false;
  if (options.scopes?.length && !options.scopes.includes(memory.scope ?? 'global')) return false;
  if (options.scopeId && memory.scopeId !== options.scopeId) return false;
  if (memory.confidence < (options.minimumConfidence ?? 0)) return false;
  const query = normalizeText(options.query).toLocaleLowerCase();
  return !query || memory.content.toLocaleLowerCase().includes(query);
}

function scoreMemory(memory: LongTermMemory, query: string): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const content = memory.content.toLocaleLowerCase();
  const exactBoost = normalizedQuery && content.includes(normalizedQuery) ? 2 : 0;
  const recency = Math.max(0, 1 - (Date.now() - memory.updatedAt) / (180 * 24 * 60 * 60 * 1000));
  return exactBoost + memory.importance + memory.confidence + recency * 0.25;
}

export const memoryTools: MemoryTools = {
  async search(options = {}) {
    const memories = await getAllFromStore<LongTermMemory>(LONG_TERM_MEMORIES_STORE);
    const query = normalizeText(options.query);
    return memories
      .filter((memory) => memoryMatches(memory, options))
      .sort((left, right) => scoreMemory(right, query) - scoreMemory(left, query))
      .slice(0, normalizeLimit(options.limit));
  },

  async list(options = {}) {
    const memories = await getAllFromStore<LongTermMemory>(LONG_TERM_MEMORIES_STORE);
    return memories
      .filter((memory) => memoryMatches(memory, { ...options, query: undefined }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, normalizeLimit(options.limit, 50));
  },

  async upsert(input: UpsertLongTermMemoryInput) {
    const key = normalizeText(input.key).toLocaleLowerCase();
    const content = normalizeText(input.content);
    if (!key) throw new Error('长期记忆 key 不能为空。');
    if (!content) throw new Error('长期记忆内容不能为空。');
    const database = await openDocumentAgentDatabase();
    try {
      const transaction = database.transaction(LONG_TERM_MEMORIES_STORE, 'readwrite');
      const store = transaction.objectStore(LONG_TERM_MEMORIES_STORE);
      const allMemories = await requestToPromise<LongTermMemory[]>(store.getAll());
      const scope = input.scope ?? 'global';
      const existing = input.id
        ? allMemories.find((memory) => memory.id === input.id)
        : allMemories.find((memory) =>
          memory.key === key
          && (memory.scope ?? 'global') === scope
          && (memory.scopeId ?? '') === (input.scopeId ?? '')
          && (memory.status ?? 'active') === 'active');
      const now = Date.now();
      const memory: LongTermMemory = {
        id: existing?.id ?? input.id ?? createId('memory'),
        key,
        category: input.category,
        content,
        scope,
        scopeId: input.scopeId,
        confidence: clamp(input.confidence, input.sourceType === 'explicit' ? 1 : 0.6),
        importance: clamp(input.importance, 0.5),
        sourceType: input.sourceType,
        evidenceCount: (existing?.evidenceCount ?? 0) + 1,
        status: 'active',
        sourceConversationId: input.sourceConversationId,
        sourcePdfId: input.sourcePdfId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: existing?.lastUsedAt,
        expiresAt: input.expiresAt,
      };
      store.put(memory);
      await transactionDone(transaction);
      return memory;
    } finally {
      database.close();
    }
  },

  async forget(id: string) {
    if (!id.trim()) return false;
    const database = await openDocumentAgentDatabase();
    try {
      const transaction = database.transaction(LONG_TERM_MEMORIES_STORE, 'readwrite');
      const store = transaction.objectStore(LONG_TERM_MEMORIES_STORE);
      const existing = await requestToPromise<LongTermMemory | undefined>(store.get(id));
      if (!existing) return false;
      store.delete(id);
      await transactionDone(transaction);
      return true;
    } finally {
      database.close();
    }
  },
};

function paperMatches(paper: PaperLibraryRecord, options: PaperLibrarySearchOptions): boolean {
  if (options.openedAfter && paper.lastOpenedAt < options.openedAfter) return false;
  if (options.openedBefore && paper.lastOpenedAt > options.openedBefore) return false;
  const query = normalizeText(options.query).toLocaleLowerCase();
  if (!query) return true;
  return [paper.title, paper.abstract, paper.userSummary, ...(paper.authors ?? []), ...(paper.keywords ?? [])]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(query));
}

export const paperLibraryTools: PaperLibraryTools = {
  async searchPapers(options = {}) {
    const papers = await getAllFromStore<PaperLibraryRecord>(PAPER_LIBRARY_STORE);
    return papers
      .filter((paper) => paperMatches(paper, options))
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, normalizeLimit(options.limit, 20));
  },

  async getPaper(id: string) {
    const database = await openDocumentAgentDatabase();
    try {
      const transaction = database.transaction(PAPER_LIBRARY_STORE, 'readonly');
      return (await requestToPromise<PaperLibraryRecord | undefined>(
        transaction.objectStore(PAPER_LIBRARY_STORE).get(id),
      )) ?? null;
    } finally {
      database.close();
    }
  },

  async upsertPaper(input: UpsertPaperLibraryInput) {
    const id = input.id?.trim() || input.documentId;
    if (!id || !input.documentId.trim()) throw new Error('文献记录缺少 documentId。');
    const database = await openDocumentAgentDatabase();
    try {
      const transaction = database.transaction(PAPER_LIBRARY_STORE, 'readwrite');
      const store = transaction.objectStore(PAPER_LIBRARY_STORE);
      const existing = await requestToPromise<PaperLibraryRecord | undefined>(store.get(id));
      const now = Date.now();
      const paper: PaperLibraryRecord = {
        id,
        documentId: input.documentId,
        fingerprint: input.fingerprint ?? existing?.fingerprint ?? '',
        title: input.title.trim() || existing?.title || '未命名 PDF',
        authors: input.authors ?? existing?.authors,
        year: input.year ?? existing?.year,
        abstract: input.abstract ?? existing?.abstract,
        keywords: input.keywords ?? existing?.keywords,
        pageCount: Math.max(0, Math.round(input.pageCount || existing?.pageCount || 0)),
        currentPage: Math.max(1, Math.round(input.currentPage || existing?.currentPage || 1)),
        readingCount: Math.max(1, Math.round(input.readingCount || existing?.readingCount || 1)),
        firstOpenedAt: input.firstOpenedAt ?? existing?.firstOpenedAt ?? now,
        lastOpenedAt: input.lastOpenedAt ?? existing?.lastOpenedAt ?? now,
        userSummary: input.userSummary ?? existing?.userSummary,
        userRating: input.userRating ?? existing?.userRating,
        sourceName: input.sourceName ?? existing?.sourceName,
      };
      store.put(paper);
      await transactionDone(transaction);
      return paper;
    } finally {
      database.close();
    }
  },

  async recordOpen(input) {
    const existing = await paperLibraryTools.getPaper(input.documentId);
    return paperLibraryTools.upsertPaper({
      id: input.documentId,
      documentId: input.documentId,
      fingerprint: input.fingerprint ?? existing?.fingerprint,
      title: input.title,
      pageCount: input.pageCount,
      currentPage: input.currentPage,
      sourceName: input.sourceName,
      firstOpenedAt: existing?.firstOpenedAt,
      lastOpenedAt: Date.now(),
      readingCount: (existing?.readingCount ?? 0) + 1,
    });
  },
};

export async function executeMemoryTool(call: MemoryToolCall): Promise<MemoryToolResult> {
  try {
    switch (call.name) {
      case 'memory.search': return { ok: true, tool: call.name, data: await memoryTools.search(call.arguments) };
      case 'memory.list': return { ok: true, tool: call.name, data: await memoryTools.list(call.arguments) };
      case 'memory.upsert': return { ok: true, tool: call.name, data: await memoryTools.upsert(call.arguments) };
      case 'memory.forget': return { ok: true, tool: call.name, data: await memoryTools.forget(call.arguments.id) };
      case 'library.searchPapers': return { ok: true, tool: call.name, data: await paperLibraryTools.searchPapers(call.arguments) };
      case 'library.getPaper': return { ok: true, tool: call.name, data: await paperLibraryTools.getPaper(call.arguments.id) };
      case 'library.upsertPaper': return { ok: true, tool: call.name, data: await paperLibraryTools.upsertPaper(call.arguments) };
      case 'library.recordOpen': return { ok: true, tool: call.name, data: await paperLibraryTools.recordOpen(call.arguments) };
    }
  } catch (error) {
    return {
      ok: false,
      tool: call.name,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
