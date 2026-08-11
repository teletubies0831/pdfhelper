import { KnowledgeLibrary } from './application/knowledge-library';
import { BrowserStorageKnowledgeRepository } from './adapters/browser-storage-knowledge-repository';

export type { KnowledgeRecord, KnowledgeRecordKind } from './domain/knowledge-record';
export type { KnowledgeRepository } from './ports/knowledge-repository';
export { KnowledgeLibrary } from './application/knowledge-library';
export { BrowserStorageKnowledgeRepository } from './adapters/browser-storage-knowledge-repository';

export const knowledgeLibrary = new KnowledgeLibrary(
  new BrowserStorageKnowledgeRepository(),
);
