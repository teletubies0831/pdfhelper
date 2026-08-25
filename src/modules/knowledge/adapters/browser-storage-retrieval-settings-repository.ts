import {
  normalizeKnowledgeRetrievalSettings,
  type KnowledgeRetrievalSettings,
} from '../domain/retrieval-settings';
import type { RetrievalSettingsRepository } from '../ports/retrieval-settings-repository';

const STORAGE_KEY = 'pdf-helper-knowledge-retrieval-settings';

export class BrowserStorageRetrievalSettingsRepository
implements RetrievalSettingsRepository {
  load(): KnowledgeRetrievalSettings {
    try {
      return normalizeKnowledgeRetrievalSettings(
        JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as
          | Partial<KnowledgeRetrievalSettings>
          | null,
      );
    } catch {
      return normalizeKnowledgeRetrievalSettings(null);
    }
  }

  save(settings: KnowledgeRetrievalSettings): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeKnowledgeRetrievalSettings(settings)),
    );
  }
}
