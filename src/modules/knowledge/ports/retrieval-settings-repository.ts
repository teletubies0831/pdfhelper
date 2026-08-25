import type { KnowledgeRetrievalSettings } from '../domain/retrieval-settings';

export interface RetrievalSettingsRepository {
  load(): KnowledgeRetrievalSettings;
  save(settings: KnowledgeRetrievalSettings): void;
}
