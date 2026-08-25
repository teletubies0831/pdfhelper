import {
  getDocumentChunks,
  listDocumentAgentRecords,
} from "../../../modules/document-agent/public";
import {
  mapHistoricalDocumentSemanticSources,
  type HistoricalDocumentSemanticSource,
} from "../../services/document-agent/historical-document-source-mapper";
import { listKnowledgeDocuments } from "../knowledge-base/public";

export async function listHistoricalDocumentSemanticSources(): Promise<
  HistoricalDocumentSemanticSource[]
> {
  const memberIds = new Set(listKnowledgeDocuments().map((item) => item.documentId));
  const records = (await listDocumentAgentRecords()).filter((record) => memberIds.has(record.id));
  const chunksByDocument = new Map(
    await Promise.all(
      records.map(async (record) => [
        record.id,
        await getDocumentChunks(record.id),
      ] as const),
    ),
  );
  return mapHistoricalDocumentSemanticSources(records, chunksByDocument);
}
