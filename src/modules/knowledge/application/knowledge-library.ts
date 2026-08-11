import type { KnowledgeRecord } from '../domain/knowledge-record';
import type { KnowledgeRepository } from '../ports/knowledge-repository';

export class KnowledgeLibrary {
  constructor(private readonly repository: KnowledgeRepository) {}

  list(readingMode?: string): KnowledgeRecord[] {
    return this.repository.list(readingMode);
  }

  save(record: KnowledgeRecord): void {
    this.repository.upsert(record);
  }

  delete(recordKey: string): void {
    this.repository.remove(recordKey);
  }

  synchronize(readingMode: string, records: Array<Omit<KnowledgeRecord, 'readingMode'>>): void {
    this.repository.synchronizeScope(
      readingMode,
      records.map((record) => ({ ...record, readingMode })),
    );
  }
}
