import {
  buildKnowledgeFingerprint,
  chunkKnowledgeDocument,
  rankSemanticKnowledgeChunks,
  type SemanticKnowledgeDocument,
  type SemanticKnowledgeMatch,
} from '../domain/semantic-retrieval';
import type { EmbeddingProvider } from '../ports/embedding-provider';
import type { EmbeddingModelDescriptor } from '../domain/embedding-model';
import type { EmbeddingLoadProgress } from '../ports/embedding-provider';
import type {
  KnowledgeVectorRepository,
  StoredKnowledgeVector,
} from '../ports/knowledge-vector-repository';

export interface SemanticRetrievalOptions {
  limit?: number;
  onProgress?: (message: string) => void;
  onModelProgress?: (progress: EmbeddingLoadProgress) => void;
}

export class SemanticKnowledgeRetriever {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: KnowledgeVectorRepository,
  ) {}

  async retrieve(
    documents: SemanticKnowledgeDocument[],
    query: string,
    model: EmbeddingModelDescriptor,
    options: SemanticRetrievalOptions = {},
  ): Promise<SemanticKnowledgeMatch[]> {
    await this.embeddings.loadModel(model, options.onModelProgress);
    const modelIndexId = this.modelIndexId(model);
    const fingerprints = new Map(
      documents.map((document) => [
        document.recordKey,
        buildKnowledgeFingerprint(document),
      ]),
    );
    const cached = await this.vectors.findByRecordKeys(
      documents.map((document) => document.recordKey),
      modelIndexId,
    );
    const validCached = cached.filter(
      (vector) => fingerprints.get(vector.recordKey) === vector.fingerprint,
    );
    const indexedKeys = new Set(validCached.map((vector) => vector.recordKey));
    const missing = documents.filter(
      (document) => !indexedKeys.has(document.recordKey),
    );

    if (missing.length) {
      options.onProgress?.(`正在为 ${missing.length} 条内容建立语义索引…`);
      for (const [documentIndex, document] of missing.entries()) {
        const chunks = chunkKnowledgeDocument(document);
        const stored: StoredKnowledgeVector[] = [];
        for (let start = 0; start < chunks.length; start += 8) {
          const batch = chunks.slice(start, start + 8);
          const embeddings = await this.embeddings.embedDocuments(
            model,
            batch.map((chunk) => chunk.text),
          );
          for (const [index, chunk] of batch.entries()) {
            stored.push({
              id: `${modelIndexId}\u0000${document.recordKey}\u0000${chunk.chunkIndex}`,
              recordKey: document.recordKey,
              modelId: modelIndexId,
              fingerprint: fingerprints.get(document.recordKey) ?? '',
              chunkIndex: chunk.chunkIndex,
              text: chunk.text,
              embedding: embeddings[index] ?? [],
            });
          }
        }
        await this.vectors.replaceRecord(
          document.recordKey,
          modelIndexId,
          stored,
        );
        validCached.push(...stored);
        options.onProgress?.(
          `正在建立语义索引（${documentIndex + 1}/${missing.length}）…`,
        );
      }
    }

    options.onProgress?.('正在计算问题与知识内容的语义相似度…');
    const queryVector = await this.embeddings.embedQuery(model, query);
    return rankSemanticKnowledgeChunks(
      validCached,
      queryVector,
      documents,
      options.limit,
    );
  }

  async loadModel(
    model: EmbeddingModelDescriptor,
    onProgress?: (progress: EmbeddingLoadProgress) => void,
  ): Promise<void> {
    await this.embeddings.loadModel(model, onProgress);
  }

  getLoadedModelId(): string | null {
    return this.embeddings.getLoadedModelId();
  }

  async unloadModel(): Promise<void> {
    await this.embeddings.unloadModel();
  }

  async rebuildIndex(
    documents: SemanticKnowledgeDocument[],
    model: EmbeddingModelDescriptor,
    options: SemanticRetrievalOptions = {},
  ): Promise<void> {
    await this.embeddings.loadModel(model, options.onModelProgress);
    await this.vectors.deleteByModelId(this.modelIndexId(model));
    if (!documents.length) return;
    await this.retrieve(documents, '知识库语义索引', model, options);
  }

  private modelIndexId(model: EmbeddingModelDescriptor): string {
    return `${model.id}@${model.dtype}:${model.pooling}:${model.dimensions ?? 'auto'}`;
  }
}
