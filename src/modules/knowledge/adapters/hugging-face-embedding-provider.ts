import type {
  FeatureExtractionPipeline,
  ProgressInfo,
} from '@huggingface/transformers';
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { EmbeddingModelDescriptor } from '../domain/embedding-model';
import type {
  EmbeddingLoadProgress,
  EmbeddingProvider,
} from '../ports/embedding-provider';

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  private loadedModelId: string | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  getLoadedModelId(): string | null {
    return this.loadedModelId;
  }

  async loadModel(
    model: EmbeddingModelDescriptor,
    onProgress?: (progress: EmbeddingLoadProgress) => void,
  ): Promise<void> {
    await this.getPipeline(model, onProgress);
  }

  async unloadModel(): Promise<void> {
    const pipeline = this.pipelinePromise ? await this.pipelinePromise : null;
    await pipeline?.dispose();
    this.pipelinePromise = null;
    this.loadedModelId = null;
  }

  embedQuery(
    model: EmbeddingModelDescriptor,
    query: string,
  ): Promise<number[]> {
    return this.embedOne(model, `${model.queryPrefix}${query}`);
  }

  async embedDocuments(
    model: EmbeddingModelDescriptor,
    documents: string[],
  ): Promise<number[][]> {
    if (!documents.length) return [];
    const extractor = await this.getPipeline(model);
    const output = await extractor(
      documents.map((document) => `${model.passagePrefix}${document}`),
      { pooling: model.pooling, normalize: model.normalize },
    );
    return output.tolist() as number[][];
  }

  private async embedOne(
    model: EmbeddingModelDescriptor,
    text: string,
  ): Promise<number[]> {
    const extractor = await this.getPipeline(model);
    const output = await extractor(text, {
      pooling: model.pooling,
      normalize: model.normalize,
    });
    const values = output.tolist() as number[][];
    return values[0] ?? [];
  }

  private getPipeline(
    model: EmbeddingModelDescriptor,
    onProgress?: (progress: EmbeddingLoadProgress) => void,
  ): Promise<FeatureExtractionPipeline> {
    if (this.loadedModelId && this.loadedModelId !== model.id) {
      return this.unloadModel().then(() => this.getPipeline(model, onProgress));
    }
    if (!this.pipelinePromise) {
      this.pipelinePromise = import('@huggingface/transformers').then(
        async ({ env, pipeline }) => {
          env.allowLocalModels = false;
          env.allowRemoteModels = true;
          env.useBrowserCache = true;
          // Chromium MV3 extensions cannot execute the blob: module that
          // Transformers.js creates while pre-caching the ONNX WASM factory.
          // Keep the normal HTTP model cache, but load the packaged WASM
          // factory directly from the extension origin instead.
          env.useWasmCache = false;
          if (env.backends.onnx.wasm) {
            env.backends.onnx.wasm.wasmPaths = {
              mjs: ortWasmModuleUrl,
              wasm: ortWasmBinaryUrl,
            };
            // A single thread avoids ONNX spawning another blob-backed worker;
            // embedding already runs inside our dedicated knowledge Worker.
            env.backends.onnx.wasm.numThreads = 1;
            env.backends.onnx.wasm.proxy = false;
          }
          const extractor = await pipeline('feature-extraction', model.id, {
            device: 'wasm',
            dtype: model.dtype,
            progress_callback: (event: ProgressInfo) => {
              const progress = this.normalizeProgress(model.id, event);
              if (progress) onProgress?.(progress);
            },
          });
          this.loadedModelId = model.id;
          onProgress?.({ modelId: model.id, status: 'ready', progress: 100 });
          return extractor;
        },
      );
      this.pipelinePromise.catch(() => {
        this.pipelinePromise = null;
        this.loadedModelId = null;
      });
    }
    return this.pipelinePromise;
  }

  private normalizeProgress(
    modelId: string,
    event: ProgressInfo,
  ): EmbeddingLoadProgress | null {
    if (event.status === 'ready') {
      return { modelId, status: 'ready', progress: 100 };
    }
    if (event.status === 'progress' || event.status === 'progress_total') {
      return {
        modelId,
        status: 'loading',
        ...('file' in event ? { file: event.file } : {}),
        progress: event.progress,
        loaded: event.loaded,
        total: event.total,
      };
    }
    if ('file' in event) {
      return { modelId, status: 'loading', file: event.file };
    }
    return null;
  }
}
