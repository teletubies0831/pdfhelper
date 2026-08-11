
import { DOCUMENT_AGENT_INDEX_VERSION, createDocumentAgentId, getDocumentAgentStrategy, type DocumentAgentRecord, type DocumentChunk, type DocumentPageText } from "../../../../shared/document-agent";

import { getDocumentAgentRecord, getDocumentChunks, putDocumentAgentRecord, replaceDocumentChunks } from "../../../../entrypoints/viewer/document-agent-store";
import { attachChunkHeadings, parseProfile, pauseForBrowser } from './runtime-contracts';
import type { InitializeDocumentKnowledgeOptions, InitializedDocumentKnowledge } from './runtime-contracts';



export async function analyzePaperChunks(
  record: DocumentAgentRecord,
  chunks: DocumentChunk[],
  options: InitializeDocumentKnowledgeOptions,
): Promise<InitializedDocumentKnowledge> {
  const strategy = getDocumentAgentStrategy(options.readingMode);
  record.processingStatus = 'analyzing';
  record.providerId = options.providerId;
  record.model = options.model;
  record.error = undefined;
  record.updatedAt = Date.now();
  await putDocumentAgentRecord(record);

  const chunkSummaries: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (!options.isCurrent()) throw new Error('文档已切换，停止全文建档。');
    const chunk = chunks[index];
    if (!chunk) continue;
    options.onStatus({
      text: `AI 正在阅读全文：${index + 1}/${chunks.length} 块`,
      status: 'analyzing',
      completed: index,
      total: chunks.length,
    });
    const summary = await options.requestAi(
      [{ role: 'user', content: strategy.buildChunkAnalysisPrompt(`pages ${chunk.startPage}-${chunk.endPage}`) }],
      {
        task: `论文首次建档 · 分块 ${index + 1}/${chunks.length}`,
        documentName: options.name,
        pageNumber: chunk.startPage,
        totalPages: options.pageCount,
        pageText: chunk.text,
        sourceScope: 'document',
        sourceLabel: `第 ${chunk.startPage}-${chunk.endPage} 页`,
        sourcePages: Array.from({ length: chunk.endPage - chunk.startPage + 1 }, (_, offset) => chunk.startPage + offset),
        contextNote: '首次全文处理：该段原文属于整篇论文的一部分。',
      },
    );
    chunk.summary = summary.trim().slice(0, 3000);
    chunkSummaries.push(`[第 ${chunk.startPage}-${chunk.endPage} 页]\n${chunk.summary}`);
    if ((index + 1) % 3 === 0) await replaceDocumentChunks(record.id, chunks);
    await pauseForBrowser();
  }

  await replaceDocumentChunks(record.id, chunks);
  options.onStatus({ text: '正在合成整篇论文档案…', status: 'analyzing', completed: chunks.length, total: chunks.length });
  const synthesisSource = chunkSummaries.map((summary) => summary.slice(0, 1800)).join('\n\n').slice(0, 24000);
  const profileResponse = await options.requestAi(
    [{ role: 'user', content: strategy.buildProfileSynthesisPrompt() }],
    {
      task: '论文首次建档 · 全文综合',
      documentName: options.name,
      totalPages: options.pageCount,
      pageText: synthesisSource,
      sourceScope: 'document',
      sourceLabel: '全文分块阅读记录',
      sourcePages: Array.from({ length: options.pageCount }, (_, index) => index + 1),
      contextNote: '依据所有分块阅读记录生成可复用的整篇论文档案。',
    },
  );
  record.profile = parseProfile(profileResponse, chunkSummaries);
  record.processingStatus = 'ready';
  record.updatedAt = Date.now();
  await putDocumentAgentRecord(record);
  options.onStatus({ text: `全文档案已就绪 · ${chunks.length} 块`, status: 'ready', completed: chunks.length, total: chunks.length });
  return { documentId: record.id, record, chunks, restored: false };
}


export async function initializeDocumentKnowledge(
  options: InitializeDocumentKnowledgeOptions,
): Promise<InitializedDocumentKnowledge> {
  const documentId = createDocumentAgentId(options.fingerprint, options.name, options.pageCount);
  const strategy = getDocumentAgentStrategy(options.readingMode);
  const existingRecord = await getDocumentAgentRecord(documentId);
  const existingChunks = await getDocumentChunks(documentId);
  if (!options.isCurrent()) throw new Error('文档已切换。');

  const canRestore = !options.force
    && existingRecord?.indexVersion === DOCUMENT_AGENT_INDEX_VERSION
    && existingRecord.pageCount === options.pageCount
    && existingRecord.readingMode === options.readingMode
    && existingChunks.length > 0;

  if (canRestore && existingRecord) {
    if (
      strategy.autoAnalyzeWholeDocument
      && options.hasApiKey
      && existingRecord.processingStatus !== 'ready'
    ) {
      return analyzePaperChunks(existingRecord, existingChunks, options);
    }
    const statusText = existingRecord.processingStatus === 'ready'
      ? `已恢复全文档案 · ${existingChunks.length} 块`
      : existingRecord.processingStatus === 'needs-api-key'
        ? `本地全文索引已恢复 · 配置 API Key 后可生成论文档案`
        : `本地全文索引已恢复 · ${existingChunks.length} 块`;
    options.onStatus({ text: statusText, status: existingRecord.processingStatus });
    return { documentId, record: existingRecord, chunks: existingChunks, restored: true };
  }

  const now = Date.now();
  const record: DocumentAgentRecord = {
    id: documentId,
    fingerprint: options.fingerprint,
    name: options.name,
    readingMode: options.readingMode,
    pageCount: options.pageCount,
    indexVersion: DOCUMENT_AGENT_INDEX_VERSION,
    processingStatus: 'extracting',
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
  };
  await putDocumentAgentRecord(record);

  const pages: DocumentPageText[] = [];
  for (let pageNumber = 1; pageNumber <= options.pageCount; pageNumber += 1) {
    if (!options.isCurrent()) throw new Error('文档已切换，停止索引。');
    options.onStatus({
      text: `正在建立本地全文索引：${pageNumber}/${options.pageCount} 页`,
      status: 'extracting',
      completed: pageNumber - 1,
      total: options.pageCount,
    });
    const text = await options.extractPageText(pageNumber).catch(() => '');
    pages.push({ pageNumber, text });
    if (pageNumber % 4 === 0) await pauseForBrowser();
  }

  const chunks = strategy.chunkPages(pages, documentId);
  attachChunkHeadings(chunks, options.getOutline());
  await replaceDocumentChunks(documentId, chunks);
  record.processingStatus = strategy.autoAnalyzeWholeDocument && !options.hasApiKey
    ? 'needs-api-key'
    : 'indexed';
  record.updatedAt = Date.now();
  await putDocumentAgentRecord(record);

  if (strategy.autoAnalyzeWholeDocument && options.hasApiKey) {
    return analyzePaperChunks(record, chunks, options);
  }

  const text = strategy.autoAnalyzeWholeDocument
    ? `本地全文索引已完成 · 配置 API Key 后自动生成论文档案`
    : options.readingMode === 'novel'
      ? `无剧透索引已完成 · 仅向 AI 开放当前阅读位置之前的内容`
      : `本地全文索引已完成 · ${chunks.length} 块`;
  options.onStatus({ text, status: record.processingStatus, completed: options.pageCount, total: options.pageCount });
  return { documentId, record, chunks, restored: false };
}
