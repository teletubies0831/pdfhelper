import { KnowledgeLibrary } from './application/knowledge-library';
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

const semanticKnowledgeRetriever = new SemanticKnowledgeRetriever(
  new HuggingFaceEmbeddingProvider(),
  new IndexedDbKnowledgeVectorRepository(),
);

export const knowledgeRetrievalService = new KnowledgeRetrievalService(
  new KeywordKnowledgeRetriever(),
  semanticKnowledgeRetriever,
  new BrowserStorageRetrievalSettingsRepository(),
);
