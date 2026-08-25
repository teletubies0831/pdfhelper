import type { EmbeddingModelDescriptor } from '../domain/embedding-model';

export interface EmbeddingLoadProgress {
  modelId: string;
  status: 'loading' | 'ready';
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface EmbeddingProvider {
  getLoadedModelId(): string | null;
  loadModel(
    model: EmbeddingModelDescriptor,
    onProgress?: (progress: EmbeddingLoadProgress) => void,
  ): Promise<void>;
  unloadModel(): Promise<void>;
  embedQuery(model: EmbeddingModelDescriptor, query: string): Promise<number[]>;
  embedDocuments(
    model: EmbeddingModelDescriptor,
    documents: string[],
  ): Promise<number[][]>;
}
