import type { AiConnectionCatalogState } from '../domain/ai-connection';

export interface AiConnectionRepository {
  load(): Promise<AiConnectionCatalogState>;
  save(state: AiConnectionCatalogState): Promise<void>;
}

