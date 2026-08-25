export interface StoredKnowledgeVector {
  id: string;
  recordKey: string;
  modelId: string;
  fingerprint: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export interface KnowledgeVectorRepository {
  findByRecordKeys(
    recordKeys: string[],
    modelId: string,
  ): Promise<StoredKnowledgeVector[]>;
  replaceRecord(
    recordKey: string,
    modelId: string,
    vectors: StoredKnowledgeVector[],
  ): Promise<void>;
  deleteByModelId(modelId: string): Promise<void>;
}
