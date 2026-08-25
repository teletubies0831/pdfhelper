import type {
  DocumentAgentRecord,
  DocumentChunk,
} from "../../../modules/document-agent/public";
import type { SemanticKnowledgeDocument } from "../../../modules/knowledge/public";

export interface HistoricalDocumentSemanticSource
  extends SemanticKnowledgeDocument {
  sourceType: "pdf-full-text";
  documentId: string;
  chunkId: string;
  startPage: number;
  endPage: number;
}

export function mapHistoricalDocumentSemanticSources(
  records: DocumentAgentRecord[],
  chunksByDocument: ReadonlyMap<string, DocumentChunk[]>,
): HistoricalDocumentSemanticSource[] {
  return records.flatMap((record) =>
    (chunksByDocument.get(record.id) ?? []).flatMap((chunk) => {
      const content = chunk.text.trim();
      if (!content) return [];
      return [{
        sourceType: "pdf-full-text" as const,
        recordKey: `pdf-full-text:${chunk.id}`,
        documentId: record.id,
        chunkId: chunk.id,
        title: chunk.heading?.trim() || record.name.replace(/\.pdf$/i, ""),
        content,
        documentName: record.name,
        positionLabel:
          chunk.startPage === chunk.endPage
            ? `第 ${chunk.startPage} 页`
            : `第 ${chunk.startPage}-${chunk.endPage} 页`,
        category: "PDF 全文",
        tags: ["PDF 全文", chunk.heading?.trim() || ""].filter(Boolean),
        updatedAt: new Date(record.updatedAt).toISOString(),
        startPage: chunk.startPage,
        endPage: chunk.endPage,
      }];
    }),
  );
}
