import { DEFAULT_EMBEDDING_MODEL_ID } from './embedding-model';

export type KnowledgeRetrievalMode = 'keyword' | 'semantic' | 'hybrid';

export interface KnowledgeRetrievalSettings {
  mode: KnowledgeRetrievalMode;
  modelId: string;
}

export const DEFAULT_KNOWLEDGE_RETRIEVAL_SETTINGS: KnowledgeRetrievalSettings = {
  mode: 'keyword',
  modelId: DEFAULT_EMBEDDING_MODEL_ID,
};

export function normalizeKnowledgeRetrievalSettings(
  value: Partial<KnowledgeRetrievalSettings> | null | undefined,
): KnowledgeRetrievalSettings {
  const mode = value?.mode;
  return {
    mode: mode === 'semantic' || mode === 'hybrid' ? mode : 'keyword',
    modelId: value?.modelId?.trim() || DEFAULT_EMBEDDING_MODEL_ID,
  };
}
