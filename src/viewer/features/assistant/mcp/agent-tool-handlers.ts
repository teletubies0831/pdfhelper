import type {
  AiStreamStartMessage,
} from "../../../../modules/ai/public";
import type { MemoryToolCall } from "../../../../modules/memory/public";
import {
  knowledgeLibrary,
  knowledgeRetrievalService,
} from "../../../../modules/knowledge/public";
import { executeMemoryTool } from "../../../../../entrypoints/viewer/memory-store";
import { resolvedReadingMode } from "../../../core/pdf-reader/public";
import {
  saveReadingJournalEntry,
} from "../../paper-card/public";
import { listKnowledgeDocuments, readReadingJournalEntries } from "../../knowledge-base/public";

import {
  enrichPaperLibraryData,
  readHistoricalPaper,
} from "../paper-library-reader";
import { listHistoricalDocumentSemanticSources } from "../historical-document-sources";
import { pdfDocument } from "../../../app/viewer-state";
import { getDocumentChatId } from "../chat-session";
import {
  findExplicitKnowledgeDocumentScope,
  trimWeakKnowledgeEvidence,
} from "../document-scope-filter";
import { executeViewerDocumentTool } from "../../../services/document-agent/viewer-document-agent";
import { isExplicitMemoryForgetRequest } from "../memory-forget-service";

export interface AgentToolHandlerResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  modelContent: string;
}

export type AgentToolHandler = (
  argumentsValue: Record<string, unknown>,
  context: AiStreamStartMessage["context"],
) => Promise<AgentToolHandlerResult>;

function successfulResult(
  data: unknown,
  maximumCharacters = 30_000,
): AgentToolHandlerResult {
  return {
    ok: true,
    data,
    modelContent: JSON.stringify(data, null, 2).slice(0, maximumCharacters),
  };
}

const addJournalEntry: AgentToolHandler = async (argumentsValue) => {
  const entry = saveReadingJournalEntry({
    title:
      typeof argumentsValue.title === "string"
        ? argumentsValue.title
        : "知识库笔记",
    quote:
      typeof argumentsValue.quote === "string" ? argumentsValue.quote : "",
    content:
      typeof argumentsValue.content === "string"
        ? argumentsValue.content
        : "",
    tags: Array.isArray(argumentsValue.tags)
      ? argumentsValue.tags.filter(
          (tag): tag is string => typeof tag === "string",
        )
      : [],
    origin: "ai",
    pageNumber:
      typeof argumentsValue.pageNumber === "number"
        ? argumentsValue.pageNumber
        : undefined,
  });
  return successfulResult({ saved: true, entry });
};

const searchJournalEntries: AgentToolHandler = async (argumentsValue) => {
  const query =
    typeof argumentsValue.query === "string"
      ? argumentsValue.query.trim().toLowerCase()
      : "";
  const limit =
    typeof argumentsValue.limit === "number"
      ? Math.min(30, Math.max(1, argumentsValue.limit))
      : 10;
  const entries = readReadingJournalEntries()
    .filter((entry) => entry.readingMode === resolvedReadingMode.value)
    .filter(
      (entry) =>
        !query ||
        [entry.title, entry.quote, entry.content, entry.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .slice(0, limit);
  return successfulResult({ readingMode: resolvedReadingMode.value, entries });
};

const readLibraryPaper: AgentToolHandler = async (argumentsValue) =>
  successfulResult(await readHistoricalPaper(argumentsValue), 50_000);

const searchLibraryPapers: AgentToolHandler = async (argumentsValue) => {
  const query =
    typeof argumentsValue.query === "string"
      ? argumentsValue.query.trim()
      : "";
  const limit =
    typeof argumentsValue.limit === "number"
      ? Math.min(30, Math.max(1, argumentsValue.limit))
      : 10;
  const historicalResult = await executeMemoryTool({
    name: "library.searchPapers",
    arguments: { query, limit },
  });
  const libraryDocuments = listKnowledgeDocuments();
  const libraryDocumentIds = new Set(libraryDocuments.map((document) => document.documentId));
  const libraryDocumentById = new Map(
    listKnowledgeDocuments().map((document) => [document.documentId, document]),
  );
  const libraryHistory = Array.isArray(historicalResult.data)
    ? historicalResult.data.filter((item) => {
        if (!item || typeof item !== "object") return false;
        const documentId = (item as Record<string, unknown>).documentId;
        return typeof documentId === "string" && libraryDocumentIds.has(documentId);
      })
    : historicalResult.data;

  if (!query) {
    return successfulResult({
      historicalPapers: enrichPaperLibraryData(libraryHistory),
      knowledgeMatches: [],
    });
  }

  const explicitDocumentScope = findExplicitKnowledgeDocumentScope(query, libraryDocuments);
  const records = knowledgeLibrary.list().filter((record) =>
    explicitDocumentScope.size === 0
    || (typeof record.documentId === "string" && explicitDocumentScope.has(record.documentId)),
  );
  const currentDocumentId = pdfDocument.value
    ? getDocumentChatId(pdfDocument.value)
    : null;
  const fullTextSources = (await listHistoricalDocumentSemanticSources())
    .filter((source) => source.documentId !== currentDocumentId)
    .filter((source) =>
      explicitDocumentScope.size === 0 || explicitDocumentScope.has(source.documentId),
    );
  const retrievalDocuments = [...records, ...fullTextSources];
  const requestedRetrievalMode = knowledgeRetrievalService.getSettings().mode;
  let usedKeywordFallback = false;
  const rawMatches = await knowledgeRetrievalService.retrieve(retrievalDocuments, query, {
    limit: Math.max(limit * 3, 18),
    onProgress: (message) => {
      if (message.includes("自动使用关键词检索")) {
        usedKeywordFallback = true;
      }
    },
  });
  const recordByKey = new Map(
    records.map((record) => [record.recordKey, record]),
  );
  const fullTextSourceByKey = new Map(
    fullTextSources.map((source) => [source.recordKey, source]),
  );
  const matches = trimWeakKnowledgeEvidence(
    rawMatches,
    (recordKey) => fullTextSourceByKey.get(recordKey)?.documentId
      || recordByKey.get(recordKey)?.documentId
      || "",
    usedKeywordFallback ? "keyword" : requestedRetrievalMode,
    limit,
  );
  const knowledgeMatches: Array<Record<string, unknown>> = [];
  for (const match of matches) {
    const fullTextSource = fullTextSourceByKey.get(match.recordKey);
    if (fullTextSource) {
      knowledgeMatches.push({
        sourceType: fullTextSource.sourceType,
        recordKey: fullTextSource.recordKey,
        documentId: fullTextSource.documentId,
        documentName: fullTextSource.documentName,
        title: fullTextSource.title,
        category: fullTextSource.category,
        positionLabel: fullTextSource.positionLabel,
        startPage: fullTextSource.startPage,
        endPage: fullTextSource.endPage,
        recentEntryId: libraryDocumentById.get(fullTextSource.documentId)?.recentEntryId,
        matchedText: match.matchedText.slice(0, 8_000),
        relevanceScore: match.score,
      });
      continue;
    }
    const record = recordByKey.get(match.recordKey);
    if (!record) continue;
    knowledgeMatches.push({
      sourceType: "knowledge-record" as const,
      recordKey: record.recordKey,
      documentId: record.documentId,
      documentName: record.documentName,
      title: record.title,
      kind: record.kind,
      category: record.category,
      tags: record.tags,
      positionLabel: record.positionLabel,
      pageNumber: record.pageNumber,
      recentEntryId: record.recentEntryId,
      matchedText: match.matchedText.slice(0, 8_000),
      relevanceScore: match.score,
    });
  }

  return successfulResult({
    requestedRetrievalMode,
    effectiveRetrievalMode: usedKeywordFallback
      ? "keyword"
      : requestedRetrievalMode,
    retrievalScope: explicitDocumentScope.size
      ? {
          type: "explicit-documents",
          documentIds: Array.from(explicitDocumentScope),
          documentNames: libraryDocuments
            .filter((document) => explicitDocumentScope.has(document.documentId))
            .map((document) => document.documentName),
        }
      : { type: "whole-library" },
    knowledgeMatches,
    historicalPapers: enrichPaperLibraryData(libraryHistory),
  }, 50_000);
};

async function executeNamedMemoryOrLibraryTool(
  applicationName: string,
  argumentsValue: Record<string, unknown>,
  context?: AiStreamStartMessage["context"],
): Promise<AgentToolHandlerResult> {
  if (
    applicationName === "memory.forget"
    && !isExplicitMemoryForgetRequest(context?.userMessage || "")
  ) {
    return {
      ok: false,
      error: "用户本轮没有明确要求删除长期记忆，已拒绝 memory.forget。",
      modelContent: "用户本轮没有明确要求删除长期记忆，不能调用 memory.forget。",
    };
  }
  const toolArguments = { ...argumentsValue };
  if (applicationName === "memory.upsert") {
    const documentId = pdfDocument.value ? getDocumentChatId(pdfDocument.value) : undefined;
    toolArguments.sourceType = "explicit";
    toolArguments.sourceConversationId = crypto.randomUUID();
    if (toolArguments.scope === "pdf" && documentId) {
      toolArguments.scopeId = documentId;
      toolArguments.sourcePdfId = documentId;
    }
  }
  if (
    applicationName === "library.getPaper" &&
    typeof toolArguments.documentId === "string" &&
    !toolArguments.id
  ) {
    toolArguments.id = toolArguments.documentId;
    delete toolArguments.documentId;
  }
  const result = await executeMemoryTool({
    name: applicationName as MemoryToolCall["name"],
    arguments: toolArguments as never,
  });
  if (result.ok && applicationName.startsWith("library.")) {
    result.data = enrichPaperLibraryData(result.data);
  }
  return {
    ok: result.ok,
    data: result,
    error: result.error,
    modelContent: JSON.stringify(result, null, 2).slice(0, 30_000),
  };
}

async function executeCurrentDocumentTool(
  applicationName: string,
  argumentsValue: Record<string, unknown>,
  context: AiStreamStartMessage["context"],
): Promise<AgentToolHandlerResult> {
  const result = await executeViewerDocumentTool(
    applicationName,
    argumentsValue,
    context,
  );
  return successfulResult(result, 30_000);
}

function withApplicationName(
  applicationName: string,
  handler: (
    applicationName: string,
    argumentsValue: Record<string, unknown>,
    context: AiStreamStartMessage["context"],
  ) => Promise<AgentToolHandlerResult>,
): AgentToolHandler {
  return (argumentsValue, context) =>
    handler(applicationName, argumentsValue, context);
}

export function createAgentToolHandlers(): Map<string, AgentToolHandler> {
  const handlers = new Map<string, AgentToolHandler>();
  handlers.set("journal.add", addJournalEntry);
  handlers.set("journal.search", searchJournalEntries);
  handlers.set("library.readPaper", readLibraryPaper);
  handlers.set("library.searchPapers", searchLibraryPapers);

  for (const applicationName of [
    "memory.search",
    "memory.list",
    "memory.upsert",
    "memory.forget",
    "library.getPaper",
  ]) {
    handlers.set(
      applicationName,
      withApplicationName(applicationName, executeNamedMemoryOrLibraryTool),
    );
  }

  for (const applicationName of [
    "document.search",
    "document.readPages",
    "document.readSection",
    "document.getProfile",
    "document.getOutline",
    "document.inspectPageImage",
  ]) {
    handlers.set(
      applicationName,
      withApplicationName(applicationName, executeCurrentDocumentTool),
    );
  }
  return handlers;
}
