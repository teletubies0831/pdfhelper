import { resolveEmbeddingModel } from '../domain/embedding-model';
import type {
  KnowledgeRetrievalMode,
  KnowledgeRetrievalSettings,
} from '../domain/retrieval-settings';
import type {
  SemanticKnowledgeDocument,
  SemanticKnowledgeMatch,
} from '../domain/semantic-retrieval';
import { fuseKnowledgeRankings } from '../domain/semantic-retrieval';
import type { EmbeddingLoadProgress } from '../ports/embedding-provider';
import type { RetrievalSettingsRepository } from '../ports/retrieval-settings-repository';
import { KeywordKnowledgeRetriever } from './keyword-knowledge-retriever';
import { SemanticKnowledgeRetriever } from './semantic-knowledge-retriever';

export interface KnowledgeRetrievalOptions {
  mode?: KnowledgeRetrievalMode;
  modelId?: string;
  limit?: number;
  onProgress?: (message: string) => void;
  onModelProgress?: (progress: EmbeddingLoadProgress) => void;
}

export class KnowledgeRetrievalService {
  constructor(
    private readonly keyword: KeywordKnowledgeRetriever,
    private readonly semantic: SemanticKnowledgeRetriever,
    private readonly settingsRepository: RetrievalSettingsRepository,
  ) {}

  getSettings(): KnowledgeRetrievalSettings {
    return this.settingsRepository.load();
  }

  saveSettings(settings: KnowledgeRetrievalSettings): void {
    this.settingsRepository.save(settings);
  }

  getLoadedModelId(): string | null {
    return this.semantic.getLoadedModelId();
  }

  async loadModel(
    modelId: string,
    onProgress?: (progress: EmbeddingLoadProgress) => void,
  ): Promise<void> {
    await this.semantic.loadModel(resolveEmbeddingModel(modelId), onProgress);
  }

  async unloadModel(): Promise<void> {
    await this.semantic.unloadModel();
  }

  async rebuildIndex(
    documents: SemanticKnowledgeDocument[],
    modelId: string,
    options: Pick<KnowledgeRetrievalOptions, 'onProgress' | 'onModelProgress'> = {},
  ): Promise<void> {
    await this.semantic.rebuildIndex(
      documents,
      resolveEmbeddingModel(modelId),
      options,
    );
  }

  async retrieve(
    documents: SemanticKnowledgeDocument[],
    query: string,
    options: KnowledgeRetrievalOptions = {},
  ): Promise<SemanticKnowledgeMatch[]> {
    const settings = this.getSettings();
    const mode = options.mode ?? settings.mode;
    const model = resolveEmbeddingModel(options.modelId ?? settings.modelId);
    const limit = options.limit ?? 12;
    if (mode === 'keyword') {
      options.onProgress?.('正在使用关键词与元数据检索…');
      return this.keyword.retrieve(documents, query, limit);
    }

    try {
      const semantic = await this.semantic.retrieve(documents, query, model, {
        limit: mode === 'hybrid' ? Math.max(30, limit * 3) : limit,
        onProgress: options.onProgress,
        onModelProgress: options.onModelProgress,
      });
      if (mode === 'semantic') return semantic;
      const keyword = this.keyword.retrieve(documents, query, Math.max(30, limit * 3));
      options.onProgress?.('正在融合关键词与语义检索结果…');
      return fuseKnowledgeRankings(keyword, semantic, limit);
    } catch (error) {
      options.onProgress?.('本地语义检索不可用，本次已自动使用关键词检索。');
      return this.keyword.retrieve(documents, query, limit);
    }
  }

}
