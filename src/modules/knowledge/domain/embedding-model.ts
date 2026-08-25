export type EmbeddingPooling = 'mean' | 'cls';

export interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  languages: string;
  approximateSizeMb?: number;
  dtype: 'q8';
  pooling: EmbeddingPooling;
  normalize: boolean;
  queryPrefix: string;
  passagePrefix: string;
  dimensions?: number;
}

export const DEFAULT_EMBEDDING_MODEL_ID = 'Xenova/bge-small-zh-v1.5';

export const EMBEDDING_MODEL_PRESETS: readonly EmbeddingModelDescriptor[] = [
  {
    id: DEFAULT_EMBEDDING_MODEL_ID,
    label: 'BGE Small 中文（推荐）',
    languages: '中文',
    approximateSizeMb: 24,
    dtype: 'q8',
    pooling: 'cls',
    normalize: true,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    passagePrefix: '',
    dimensions: 512,
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'MiniLM L6 英文轻量版',
    languages: '英文',
    approximateSizeMb: 23,
    dtype: 'q8',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    passagePrefix: '',
    dimensions: 384,
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    label: 'BGE Small 英文',
    languages: '英文',
    approximateSizeMb: 34,
    dtype: 'q8',
    pooling: 'cls',
    normalize: true,
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    passagePrefix: '',
    dimensions: 384,
  },
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'Multilingual E5 Small',
    languages: '多语言',
    approximateSizeMb: 118,
    dtype: 'q8',
    pooling: 'mean',
    normalize: true,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    dimensions: 384,
  },
];

export function resolveEmbeddingModel(
  modelId: string,
): EmbeddingModelDescriptor {
  const normalized = modelId.trim() || DEFAULT_EMBEDDING_MODEL_ID;
  return EMBEDDING_MODEL_PRESETS.find((model) => model.id === normalized) ?? {
    id: normalized,
    label: normalized,
    languages: '由模型决定',
    dtype: 'q8',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    passagePrefix: '',
  };
}
