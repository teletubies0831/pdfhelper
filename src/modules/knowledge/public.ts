import { KnowledgeLibrary } from './application/knowledge-library';
export * from './adapters/browser-document-corpus';
export {
  deleteDocumentFileHandle,
  getDocumentFileHandle,
  putDocumentFileHandle,
} from './adapters/browser-file-handle-store';
export type { StoredFileHandle } from './adapters/browser-file-handle-store';
export { saveDocumentOverview, saveRelatedLiterature, getDocumentOverviewMarkdown } from './application/document-overview';
export {
  READING_STATUS_LABELS,
  READING_STATUS_ORDER,
  countReadingStatuses,
  markDocumentOpened,
  nextReadingStatus,
  normalizeReadingStatus,
  readReadingStatus,
  setDocumentReadingStatus,
} from './application/document-reading-status';
export {
  EMPTY_DOCUMENT_METADATA,
  METADATA_FIELDS,
  applyExtractedMetadata,
  doiUrl,
  hasDocumentMetadata,
  isMetadataMissing,
  markDocumentMetadataExtracting,
  markDocumentMetadataFailed,
  normalizeAuthors,
  normalizeDocumentMetadata,
  normalizeDoi,
  normalizeDocumentUrl,
  normalizeLanguage,
  normalizePublishDate,
  readDocumentMetadata,
  readMetadataSources,
  resumeDocumentMetadata,
  saveManualDocumentMetadata,
  setDocumentMetadata,
  skipDocumentMetadata,
} from './application/document-metadata';
export type {
  KnowledgeDocumentMetadata,
  KnowledgeMetadataSource,
  KnowledgeMetadataSources,
} from './application/document-metadata';
export { extractOfflineDocumentMetadata } from './application/document-metadata-heuristics';
export type { OfflineMetadataHints, OfflineMetadataResult } from './application/document-metadata-heuristics';
export {
  TITLE_SIMILARITY_THRESHOLD,
  buildLookupTitle,
  evaluateMetadataCandidates,
  normalizeMatchTitle,
  surnameKey,
  titleSimilarity,
  yearOf,
} from './application/bibliographic-match';
export type { MetadataCandidate, MetadataSuggestion } from './application/bibliographic-match';
export { describeDataHealth, planDataHealth } from './application/data-health';
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  buildBackupPayload,
  describeRestorePlan,
  parseBackup,
  planRestore,
  serializeBackup,
} from './application/backup';
export type {
  BackupGraph,
  BackupInput,
  BackupParseResult,
  BackupPayload,
  RestoreExisting,
  RestorePlan,
} from './application/backup';
export {
  CITATION_STYLES,
  buildCitationRecord,
  citationAccessDate,
  citationKey,
  citationWarnings,
  citationYear,
  formatAuthors,
  formatBibtex,
  formatCitation,
  formatGbT7714,
  formatMarkdown,
  formatRis,
  getDocType,
  resolveCitationTitle,
} from './application/citation-format';
export type { CitationRecord, CitationStyle, GbtDocumentType } from './application/citation-format';
export type {
  DataHealthFinding,
  DataHealthFindingKind,
  DataHealthFixKind,
  DataHealthGraphPaper,
  DataHealthInput,
  DataHealthReport,
} from './application/data-health';
export {
  findSamePaperDocument,
  paperNameKey,
} from './application/document-identity-match';
export type { PaperIdentityCandidate } from './application/document-identity-match';
import { BrowserStorageKnowledgeRepository } from './adapters/browser-storage-knowledge-repository';
import { HuggingFaceEmbeddingProvider } from './adapters/hugging-face-embedding-provider';
import { IndexedDbKnowledgeVectorRepository } from './adapters/indexed-db/indexed-db-knowledge-vector-repository';
import { SemanticKnowledgeRetriever } from './application/semantic-knowledge-retriever';
import { KeywordKnowledgeRetriever } from './application/keyword-knowledge-retriever';
import { KnowledgeRetrievalService } from './application/knowledge-retrieval-service';
import { BrowserStorageRetrievalSettingsRepository } from './adapters/browser-storage-retrieval-settings-repository';

export type { KnowledgeRecord, KnowledgeRecordKind } from './domain/knowledge-record';
export type { KnowledgeRepository } from './ports/knowledge-repository';
export { KnowledgeLibrary } from './application/knowledge-library';
export { BrowserStorageKnowledgeRepository } from './adapters/browser-storage-knowledge-repository';
export type { SemanticKnowledgeDocument, SemanticKnowledgeMatch } from './domain/semantic-retrieval';
export { SemanticKnowledgeRetriever } from './application/semantic-knowledge-retriever';
export { HuggingFaceEmbeddingProvider } from './adapters/hugging-face-embedding-provider';
export { IndexedDbKnowledgeVectorRepository } from './adapters/indexed-db/indexed-db-knowledge-vector-repository';
export type { EmbeddingModelDescriptor } from './domain/embedding-model';
export { DEFAULT_EMBEDDING_MODEL_ID, EMBEDDING_MODEL_PRESETS, resolveEmbeddingModel } from './domain/embedding-model';
export type { KnowledgeRetrievalMode, KnowledgeRetrievalSettings } from './domain/retrieval-settings';
export { DEFAULT_KNOWLEDGE_RETRIEVAL_SETTINGS } from './domain/retrieval-settings';
export type { EmbeddingLoadProgress } from './ports/embedding-provider';

export const knowledgeLibrary = new KnowledgeLibrary(
  new BrowserStorageKnowledgeRepository(),
);

export const semanticKnowledgeRetriever = new SemanticKnowledgeRetriever(
  new HuggingFaceEmbeddingProvider(),
  new IndexedDbKnowledgeVectorRepository(),
);

export const knowledgeRetrievalService = new KnowledgeRetrievalService(
  new KeywordKnowledgeRetriever(),
  semanticKnowledgeRetriever,
  new BrowserStorageRetrievalSettingsRepository(),
);
