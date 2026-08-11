export type KnowledgeRecordKind =
  | 'note'
  | 'summary'
  | 'reading-card'
  | 'paper-card'
  | 'journal'
  | 'research-result';

export interface KnowledgeRecord {
  recordKey: string;
  id: string;
  source: string;
  kind: KnowledgeRecordKind | string;
  title: string;
  content: string;
  documentName: string;
  documentId?: string;
  recentEntryId?: string;
  pageNumber?: number;
  positionLabel: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  readingMode: string;
}
