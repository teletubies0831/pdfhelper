import type { KnowledgeRecord } from '../domain/knowledge-record';

export interface KnowledgeRepository {
  list(readingMode?: string): KnowledgeRecord[];
  get(recordKey: string): KnowledgeRecord | null;
  upsert(record: KnowledgeRecord): void;
  remove(recordKey: string): void;
  synchronizeScope(readingMode: string, records: KnowledgeRecord[]): void;
}
