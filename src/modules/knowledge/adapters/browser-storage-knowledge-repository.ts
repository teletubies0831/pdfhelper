import type { KnowledgeRecord } from '../domain/knowledge-record';
import type { KnowledgeRepository } from '../ports/knowledge-repository';

const KNOWLEDGE_LIBRARY_STORAGE_KEY = 'pdf-helper-knowledge-library';

interface StoredKnowledgeLibrary {
  schemaVersion: number;
  records: KnowledgeRecord[];
}

export class BrowserStorageKnowledgeRepository implements KnowledgeRepository {
  list(readingMode?: string): KnowledgeRecord[] {
    const records = this.read().records;
    return readingMode ? records.filter((record) => record.readingMode === readingMode) : records;
  }

  get(recordKey: string): KnowledgeRecord | null {
    return this.read().records.find((record) => record.recordKey === recordKey) ?? null;
  }

  upsert(record: KnowledgeRecord): void {
    const library = this.read();
    const index = library.records.findIndex((item) => item.recordKey === record.recordKey);
    if (index >= 0) library.records[index] = record;
    else library.records.push(record);
    this.write(library);
  }

  remove(recordKey: string): void {
    const library = this.read();
    library.records = library.records.filter((record) => record.recordKey !== recordKey);
    this.write(library);
  }

  synchronizeScope(readingMode: string, records: KnowledgeRecord[]): void {
    const library = this.read();
    library.records = [
      ...library.records.filter((record) => record.readingMode !== readingMode),
      ...records,
    ];
    this.write(library);
  }

  private read(): StoredKnowledgeLibrary {
    try {
      const value = JSON.parse(localStorage.getItem(KNOWLEDGE_LIBRARY_STORAGE_KEY) || 'null') as Partial<StoredKnowledgeLibrary> | null;
      return {
        schemaVersion: 1,
        records: Array.isArray(value?.records) ? value.records as KnowledgeRecord[] : [],
      };
    } catch {
      return { schemaVersion: 1, records: [] };
    }
  }

  private write(library: StoredKnowledgeLibrary): void {
    localStorage.setItem(KNOWLEDGE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  }
}
