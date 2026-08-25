/// <reference lib="webworker" />

import {
  DOCUMENT_AGENT_INDEX_VERSION,
  getDocumentAgentRecord,
  getDocumentAgentStrategy,
  putDocumentAgentRecord,
  replaceDocumentChunks,
  type DocumentAgentRecord,
  type DocumentPageText,
} from "../../../modules/document-agent/public";
import type { KnowledgeRetrievalMode } from "../../../modules/knowledge/public";

interface IndexKnowledgeMessage {
  type: "index";
  pages: DocumentPageText[];
  documentId: string;
  fingerprint: string;
  documentName: string;
  pageCount: number;
  retrievalMode: KnowledgeRetrievalMode;
  modelId: string;
}

type WorkerProgressPhase = "extracting" | "embedding";

function postProgress(
  phase: WorkerProgressPhase,
  message: string,
  completed?: number,
  total?: number,
): void {
  self.postMessage({ type: "progress", phase, message, completed, total });
}

self.addEventListener("message", (event: MessageEvent<IndexKnowledgeMessage>) => {
  if (event.data.type !== "index") return;
  void indexKnowledgeDocument(event.data).catch((error) => {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

async function indexKnowledgeDocument(input: IndexKnowledgeMessage): Promise<void> {
  const previousRecord = await getDocumentAgentRecord(input.documentId);
  const now = Date.now();
  const record: DocumentAgentRecord = {
    id: input.documentId,
    fingerprint: input.fingerprint,
    name: input.documentName,
    readingMode: "paper",
    pageCount: input.pageCount,
    indexVersion: DOCUMENT_AGENT_INDEX_VERSION,
    processingStatus: "extracting",
    createdAt: previousRecord?.createdAt ?? now,
    updatedAt: now,
  };
  await putDocumentAgentRecord(record);

  const chunks = getDocumentAgentStrategy("paper").chunkPages(input.pages, input.documentId);
    await replaceDocumentChunks(input.documentId, chunks);
    record.processingStatus = "indexed";
    record.updatedAt = Date.now();
    await putDocumentAgentRecord(record);

    if (input.retrievalMode !== "keyword" && chunks.length) {
      const {
        HuggingFaceEmbeddingProvider,
        IndexedDbKnowledgeVectorRepository,
        SemanticKnowledgeRetriever,
        resolveEmbeddingModel,
      } = await import("../../../modules/knowledge/public");
      type SemanticKnowledgeDocument = import("../../../modules/knowledge/public").SemanticKnowledgeDocument;
      const updatedAt = new Date(record.updatedAt).toISOString();
      const sources: SemanticKnowledgeDocument[] = chunks.map((chunk) => ({
        recordKey: `pdf-full-text:${chunk.id}`,
        title: chunk.heading?.trim() || input.documentName.replace(/\.pdf$/i, ""),
        content: chunk.text,
        documentName: input.documentName,
        positionLabel: chunk.startPage === chunk.endPage
          ? `第 ${chunk.startPage} 页`
          : `第 ${chunk.startPage}-${chunk.endPage} 页`,
        category: "PDF 全文",
        tags: ["PDF 全文", chunk.heading?.trim() || ""].filter(Boolean),
        updatedAt,
      }));
      const retriever = new SemanticKnowledgeRetriever(
        new HuggingFaceEmbeddingProvider(),
        new IndexedDbKnowledgeVectorRepository(),
      );
      await retriever.retrieve(
        sources,
        "PDF 全文语义索引",
        resolveEmbeddingModel(input.modelId),
        {
          limit: 1,
          onProgress: (message) => postProgress("embedding", message),
          onModelProgress: (progress) => postProgress(
            "embedding",
            progress.status === "ready"
              ? "Embedding 模型已就绪"
              : `后台加载 Embedding${typeof progress.progress === "number" ? `：${Math.round(progress.progress)}%` : "…"}`,
            progress.progress,
            100,
          ),
        },
      );
      await retriever.unloadModel();
    }

    self.postMessage({ type: "done", chunkCount: chunks.length });
}
