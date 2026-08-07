export type LongTermMemoryCategory =
  | 'preference'
  | 'profile'
  | 'project'
  | 'fact'
  | 'correction';

export type LongTermMemorySourceType = 'explicit' | 'inferred' | 'system';
export type LongTermMemoryScope = 'global' | 'project' | 'pdf';
export type LongTermMemoryStatus = 'active' | 'superseded' | 'deleted';

export const CONVERSATION_MEMORY_CONFIG_STORAGE_KEY = 'pdf-helper-conversation-memory-config-v1';

export interface ConversationMemoryConfig {
  compressionTriggerCharacters: number;
  compressionMaxRecentMessages: number;
  compressionKeepRecentMessages: number;
}

export const DEFAULT_CONVERSATION_MEMORY_CONFIG: ConversationMemoryConfig = {
  compressionTriggerCharacters: 40_000,
  compressionMaxRecentMessages: 16,
  compressionKeepRecentMessages: 4,
};

export interface LongTermMemory {
  id: string;
  key: string;
  category: LongTermMemoryCategory;
  content: string;
  scope: LongTermMemoryScope;
  scopeId?: string;
  confidence: number;
  importance: number;
  sourceType: LongTermMemorySourceType;
  evidenceCount: number;
  status: LongTermMemoryStatus;
  supersededBy?: string;
  sourceConversationId?: string;
  sourcePdfId?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
}

export interface UpsertLongTermMemoryInput {
  id?: string;
  key: string;
  category: LongTermMemoryCategory;
  content: string;
  scope?: LongTermMemoryScope;
  scopeId?: string;
  confidence?: number;
  importance?: number;
  sourceType: LongTermMemorySourceType;
  sourceConversationId?: string;
  sourcePdfId?: string;
  expiresAt?: number;
}

export interface LongTermMemorySearchOptions {
  query?: string;
  categories?: LongTermMemoryCategory[];
  sourcePdfId?: string;
  scopes?: LongTermMemoryScope[];
  scopeId?: string;
  statuses?: LongTermMemoryStatus[];
  minimumConfidence?: number;
  includeExpired?: boolean;
  limit?: number;
}

export interface PaperLibraryRecord {
  id: string;
  documentId: string;
  fingerprint: string;
  title: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  keywords?: string[];
  pageCount: number;
  currentPage: number;
  readingCount: number;
  firstOpenedAt: number;
  lastOpenedAt: number;
  userSummary?: string;
  userRating?: number;
  sourceName?: string;
  recentEntryId?: string;
  sourceKind?: 'local' | 'remote';
  sourceUrl?: string;
  /** Browser-safe source locator. Local files use a persisted file-handle id. */
  sourceLocator?: string;
}

export interface UpsertPaperLibraryInput extends Partial<Omit<PaperLibraryRecord, 'id' | 'documentId'>> {
  id?: string;
  documentId: string;
  title: string;
  pageCount: number;
}

export interface PaperLibrarySearchOptions {
  query?: string;
  openedAfter?: number;
  openedBefore?: number;
  limit?: number;
}

export type MemoryToolCall =
  | { name: 'memory.search'; arguments: LongTermMemorySearchOptions }
  | { name: 'memory.upsert'; arguments: UpsertLongTermMemoryInput }
  | { name: 'memory.list'; arguments: LongTermMemorySearchOptions }
  | { name: 'memory.forget'; arguments: { id: string } }
  | { name: 'library.searchPapers'; arguments: PaperLibrarySearchOptions }
  | { name: 'library.getPaper'; arguments: { id: string } }
  | { name: 'library.upsertPaper'; arguments: UpsertPaperLibraryInput }
  | {
    name: 'library.recordOpen';
    arguments: {
      documentId: string;
      fingerprint?: string;
      title: string;
      pageCount: number;
      currentPage: number;
      sourceName?: string;
      recentEntryId?: string;
      sourceKind?: 'local' | 'remote';
      sourceUrl?: string;
      sourceLocator?: string;
    };
  };

export interface MemoryToolResult<T = unknown> {
  ok: boolean;
  tool: MemoryToolCall['name'];
  data?: T;
  error?: string;
}

export interface MemoryTools {
  search(options?: LongTermMemorySearchOptions): Promise<LongTermMemory[]>;
  upsert(input: UpsertLongTermMemoryInput): Promise<LongTermMemory>;
  list(options?: LongTermMemorySearchOptions): Promise<LongTermMemory[]>;
  forget(id: string): Promise<boolean>;
}

export function normalizeConversationMemoryConfig(
  value?: Partial<ConversationMemoryConfig>,
): ConversationMemoryConfig {
  const triggerValue = Number(value?.compressionTriggerCharacters);
  const maxRecentValue = Number(value?.compressionMaxRecentMessages);
  const keepRecentValue = Number(value?.compressionKeepRecentMessages);
  const compressionTriggerCharacters = Number.isFinite(triggerValue)
    ? Math.min(500_000, Math.max(5_000, Math.trunc(triggerValue)))
    : DEFAULT_CONVERSATION_MEMORY_CONFIG.compressionTriggerCharacters;
  const compressionMaxRecentMessages = Number.isFinite(maxRecentValue)
    ? Math.min(100, Math.max(4, Math.trunc(maxRecentValue)))
    : DEFAULT_CONVERSATION_MEMORY_CONFIG.compressionMaxRecentMessages;
  const compressionKeepRecentMessages = Number.isFinite(keepRecentValue)
    ? Math.min(
      compressionMaxRecentMessages - 1,
      Math.max(2, Math.trunc(keepRecentValue)),
    )
    : Math.min(
      DEFAULT_CONVERSATION_MEMORY_CONFIG.compressionKeepRecentMessages,
      compressionMaxRecentMessages - 1,
    );
  return {
    compressionTriggerCharacters,
    compressionMaxRecentMessages,
    compressionKeepRecentMessages,
  };
}

export interface PaperLibraryTools {
  searchPapers(options?: PaperLibrarySearchOptions): Promise<PaperLibraryRecord[]>;
  getPaper(id: string): Promise<PaperLibraryRecord | null>;
  upsertPaper(input: UpsertPaperLibraryInput): Promise<PaperLibraryRecord>;
  recordOpen(input: Extract<MemoryToolCall, { name: 'library.recordOpen' }>['arguments']): Promise<PaperLibraryRecord>;
}
