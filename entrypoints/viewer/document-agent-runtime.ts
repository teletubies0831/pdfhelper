import type { AiConversationMessage, AiStreamStartMessage } from '../../shared/ai';
import {
  DOCUMENT_AGENT_INDEX_VERSION,
  buildDocumentToolPlanningPrompt,
  createDocumentAgentId,
  formatDocumentToolResults,
  getDocumentAgentStrategy,
  parseDocumentToolDecision,
  searchDocumentChunks,
  type DocumentAgentRecord,
  type DocumentChunk,
  type DocumentOutlineItem,
  type DocumentPageText,
  type DocumentProfile,
  type DocumentSectionProfile,
  type DocumentToolCall,
  type DocumentToolResult,
} from '../../shared/document-agent';
import type { ResolvedReadingMode } from '../../shared/reading-mode';
import {
  getDocumentAgentRecord,
  getDocumentChunks,
  putDocumentAgentRecord,
  replaceDocumentChunks,
} from './document-agent-store';

type AiRequester = (
  messages: AiConversationMessage[],
  context?: AiStreamStartMessage['context'],
) => Promise<string>;

export interface DocumentKnowledgeStatus {
  text: string;
  status: DocumentAgentRecord['processingStatus'];
  completed?: number;
  total?: number;
}

export interface InitializeDocumentKnowledgeOptions {
  fingerprint: string;
  name: string;
  pageCount: number;
  readingMode: ResolvedReadingMode;
  providerId: string;
  model: string;
  hasApiKey: boolean;
  force?: boolean;
  extractPageText(pageNumber: number): Promise<string>;
  getOutline(): DocumentOutlineItem[];
  requestAi: AiRequester;
  isCurrent(): boolean;
  onStatus(status: DocumentKnowledgeStatus): void;
}

export interface InitializedDocumentKnowledge {
  documentId: string;
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
  restored: boolean;
}

export interface BuildRetrievalContextOptions {
  question: string;
  currentPage: number;
  currentPageText: string;
  selectedText: string;
  readingMode: ResolvedReadingMode;
  documentName: string;
  pageCount: number;
  record: DocumentAgentRecord | null;
  chunks: DocumentChunk[];
  outline: DocumentOutlineItem[];
  extractPageText(pageNumber: number): Promise<string>;
  requestAi: AiRequester;
  hasVisionModel: boolean;
  userImageAttached?: boolean;
  inspectPageImage?(pageNumber: number, question: string): Promise<{ content: string; model: string; cached: boolean }>;
}

export interface DocumentRetrievalContext {
  text: string;
  sourcePages: number[];
  toolResults: DocumentToolResult[];
  plannerReason: string;
  planningRounds: number;
}

function pauseForBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositivePage(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : fallback;
}

function parseProfile(content: string, chunkSummaries: string[]): DocumentProfile {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效的论文档案 JSON。');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.flatMap((value): DocumentSectionProfile[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const section = value as Record<string, unknown>;
      const title = toStringValue(section.title);
      const summary = toStringValue(section.summary);
      if (!title && !summary) return [];
      return [{
        title: title || '未命名章节',
        startPage: toPositivePage(section.startPage),
        endPage: toPositivePage(section.endPage, toPositivePage(section.startPage)),
        summary,
      }];
    })
    : [];
  return {
    oneSentenceSummary: toStringValue(parsed.oneSentenceSummary),
    researchProblem: toStringValue(parsed.researchProblem),
    method: toStringValue(parsed.method),
    evidence: toStringValue(parsed.evidence),
    conclusions: toStringValue(parsed.conclusions),
    limitations: toStringValue(parsed.limitations),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map(toStringValue).filter(Boolean).slice(0, 30)
      : [],
    sections,
    chunkSummaries,
  };
}

function profileToText(profile: DocumentProfile): string {
  const sections = profile.sections
    .map((section) => `- ${section.title}（第 ${section.startPage}-${section.endPage} 页）：${section.summary}`)
    .join('\n');
  return [
    `一句话总结：${profile.oneSentenceSummary}`,
    `研究问题：${profile.researchProblem}`,
    `方法：${profile.method}`,
    `证据/实验：${profile.evidence}`,
    `结论：${profile.conclusions}`,
    `局限性：${profile.limitations}`,
    `关键词：${profile.keywords.join('、')}`,
    sections ? `章节：\n${sections}` : '',
  ].filter(Boolean).join('\n');
}

function attachChunkHeadings(chunks: DocumentChunk[], outline: DocumentOutlineItem[]): void {
  if (outline.length === 0) return;
  const ordered = [...outline].sort((left, right) => left.pageNumber - right.pageNumber);
  for (const chunk of chunks) {
    let heading = '';
    for (const item of ordered) {
      if (item.pageNumber > chunk.startPage) break;
      heading = item.title;
    }
    if (heading) chunk.heading = heading;
  }
}

async function analyzePaperChunks(
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

function uniquePages(pages: number[]): number[] {
  return Array.from(new Set(pages.filter((page) => Number.isInteger(page) && page > 0))).sort((a, b) => a - b);
}

function normalizeSectionLookupText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

const SECTION_ALIASES: Array<{ patterns: RegExp[]; title: string }> = [
  { patterns: [/\bintroduction\b/i, /引言|绪论/], title: 'Introduction' },
  { patterns: [/\bbackground\b/i, /背景/], title: 'Background' },
  { patterns: [/related\s+work/i, /相关工作/], title: 'Related Work' },
  { patterns: [/\bmethod(?:ology)?\b/i, /方法(?:论)?/], title: 'Methodology' },
  { patterns: [/\bexperiment(?:s|al)?\b/i, /实验/], title: 'Experiments' },
  { patterns: [/\bresult(?:s)?\b/i, /结果/], title: 'Results' },
  { patterns: [/\bdiscussion\b/i, /讨论/], title: 'Discussion' },
  { patterns: [/\bconclusion(?:s)?\b/i, /结论/], title: 'Conclusion' },
  { patterns: [/\babstract\b/i, /摘要/], title: 'Abstract' },
];

function detectRequestedSectionTitle(
  question: string,
  outline: DocumentOutlineItem[],
): string {
  const normalizedQuestion = normalizeSectionLookupText(question);
  const outlineMatch = [...outline]
    .filter((item) => {
      const title = normalizeSectionLookupText(item.title).replace(/^\d+(?:\.\d+)*/, '');
      return title.length >= 3 && normalizedQuestion.includes(title);
    })
    .sort((left, right) => right.title.length - left.title.length)[0];
  if (outlineMatch) return outlineMatch.title;
  return SECTION_ALIASES.find(({ patterns }) => patterns.some((pattern) => pattern.test(question)))?.title ?? '';
}

function resolveSectionRange(
  title: string,
  outline: DocumentOutlineItem[],
  profile: DocumentProfile | undefined,
  pageCount: number,
): { title: string; startPage: number; endPage: number } | null {
  const target = normalizeSectionLookupText(title).replace(/^\d+(?:\.\d+)*/, '');
  const ordered = [...outline].sort((left, right) => left.pageNumber - right.pageNumber || left.depth - right.depth);
  const matchIndex = ordered.findIndex((item) => {
    const candidate = normalizeSectionLookupText(item.title).replace(/^\d+(?:\.\d+)*/, '');
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
  if (matchIndex >= 0) {
    const match = ordered[matchIndex]!;
    const nextPeer = ordered.slice(matchIndex + 1).find((item) => item.depth <= match.depth && item.pageNumber > match.pageNumber);
    return {
      title: match.title,
      startPage: Math.max(1, match.pageNumber),
      endPage: Math.min(pageCount, Math.max(match.pageNumber, (nextPeer?.pageNumber ?? pageCount + 1) - 1)),
    };
  }

  const profileMatch = profile?.sections.find((section) => {
    const candidate = normalizeSectionLookupText(section.title).replace(/^\d+(?:\.\d+)*/, '');
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
  if (!profileMatch) return null;
  return {
    title: profileMatch.title,
    startPage: Math.max(1, profileMatch.startPage),
    endPage: Math.min(pageCount, Math.max(profileMatch.startPage, profileMatch.endPage)),
  };
}

export async function executeDocumentToolCalls(
  calls: DocumentToolCall[],
  options: BuildRetrievalContextOptions,
): Promise<DocumentToolResult[]> {
  const results: DocumentToolResult[] = [];
  const maximumPage = getDocumentAgentStrategy(options.readingMode).knowledgeBoundary === 'current-position'
    ? options.currentPage
    : undefined;

  for (const call of calls) {
    if (call.name === 'search_document') {
      const query = toStringValue(call.arguments.query) || options.question;
      const limit = Math.max(1, Math.min(8, Number(call.arguments.limit) || 5));
      const matches = searchDocumentChunks(options.chunks, query, limit, maximumPage);
      results.push({
        name: call.name,
        label: `全文检索：${query}`,
        pages: uniquePages(matches.flatMap(({ chunk }) => [chunk.startPage, chunk.endPage])),
        content: matches.length
          ? matches.map(({ chunk, score }) => {
            const summary = chunk.summary?.trim();
            const original = chunk.text.trim().slice(0, 4500);
            return [
              `### 第 ${chunk.startPage}-${chunk.endPage} 页（相关度 ${score}）`,
              summary ? `检索摘要：\n${summary.slice(0, 1800)}` : '',
              `可引用原文（回答中的引用必须逐字取自这里）：\n${original}`,
            ].filter(Boolean).join('\n\n');
          }).join('\n\n')
          : '本地索引中没有找到直接匹配的内容。',
      });
      continue;
    }
    if (call.name === 'read_pages') {
      let startPage = Math.min(options.pageCount, toPositivePage(call.arguments.startPage, options.currentPage));
      let endPage = Math.min(options.pageCount, toPositivePage(call.arguments.endPage, startPage));
      if (endPage < startPage) [startPage, endPage] = [endPage, startPage];
      endPage = Math.min(endPage, startPage + 7);
      if (maximumPage !== undefined) {
        startPage = Math.min(startPage, maximumPage);
        endPage = Math.min(endPage, maximumPage);
      }
      const pageTexts: string[] = [];
      for (let page = startPage; page <= endPage; page += 1) {
        pageTexts.push(`[第 ${page} 页]\n${await options.extractPageText(page).catch(() => '')}`);
      }
      results.push({
        name: call.name,
        label: `读取第 ${startPage}-${endPage} 页`,
        pages: Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index),
        content: pageTexts.join('\n\n').slice(0, 18000),
      });
      continue;
    }
    if (call.name === 'read_section') {
      const requestedTitle = toStringValue(call.arguments.title) || detectRequestedSectionTitle(options.question, options.outline);
      const range = resolveSectionRange(requestedTitle, options.outline, options.record?.profile, options.pageCount);
      if (!range) {
        const matches = searchDocumentChunks(options.chunks, requestedTitle || options.question, 4, maximumPage);
        results.push({
          name: call.name,
          label: `读取完整章节：${requestedTitle || '未识别章节'}（未定位边界）`,
          pages: uniquePages(matches.flatMap(({ chunk }) => [chunk.startPage, chunk.endPage])),
          content: matches.length
            ? `PDF 目录没有提供可靠的章节边界，以下是章节标题检索到的相关原文：\n\n${matches.map(({ chunk }) => (
              `[第 ${chunk.startPage}-${chunk.endPage} 页]\n${chunk.text.trim().slice(0, 6000)}`
            )).join('\n\n')}`.slice(0, 24000)
            : '没有在 PDF 目录、全文档案或本地索引中定位到该章节。',
        });
        continue;
      }

      const allowedEndPage = maximumPage === undefined
        ? range.endPage
        : Math.min(range.endPage, maximumPage);
      const pageTexts: string[] = [];
      for (let page = range.startPage; page <= allowedEndPage; page += 1) {
        pageTexts.push(`[第 ${page} 页]\n${await options.extractPageText(page).catch(() => '')}`);
      }
      results.push({
        name: call.name,
        label: `完整章节：${range.title}（第 ${range.startPage}-${allowedEndPage} 页）`,
        pages: Array.from({ length: Math.max(0, allowedEndPage - range.startPage + 1) }, (_, index) => range.startPage + index),
        content: pageTexts.join('\n\n').slice(0, 24000),
      });
      continue;
    }
    if (call.name === 'get_document_profile') {
      results.push({
        name: call.name,
        label: '整篇论文档案',
        pages: [],
        content: options.record?.profile ? profileToText(options.record.profile) : '整篇论文档案尚未生成。',
      });
      continue;
    }
    if (call.name === 'get_document_outline') {
      results.push({
        name: call.name,
        label: '文档目录',
        pages: uniquePages(options.outline.map((item) => item.pageNumber)),
        content: options.outline.length
          ? options.outline.map((item) => `${'  '.repeat(item.depth)}- ${item.title}（第 ${item.pageNumber} 页）`).join('\n')
          : '该 PDF 没有可用目录。',
      });
      continue;
    }
    if (call.name === 'inspect_page_image') {
      const pageNumber = Math.min(
        maximumPage ?? options.pageCount,
        Math.min(options.pageCount, toPositivePage(call.arguments.pageNumber, options.currentPage)),
      );
      const question = toStringValue(call.arguments.question) || options.question;
      if (!options.hasVisionModel || !options.inspectPageImage) {
        results.push({
          name: call.name,
          label: `查看第 ${pageNumber} 页图像`,
          pages: [pageNumber],
          content: '视觉模型尚未配置，无法读取该页中的图、表、公式截图或空间布局。',
        });
        continue;
      }
      try {
        const analysis = await options.inspectPageImage(pageNumber, question);
        results.push({
          name: call.name,
          label: `视觉查看第 ${pageNumber} 页${analysis.cached ? '（缓存）' : ''}`,
          pages: [pageNumber],
          content: analysis.content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: call.name,
          label: `视觉查看第 ${pageNumber} 页（失败）`,
          pages: [pageNumber],
          content: `视觉工具本次调用失败：${message}\n请先依据文字层和其他检索结果回答，并明确说明未能核验页面图像。`,
        });
      }
    }
  }
  return results;
}

export async function buildDocumentRetrievalContext(
  options: BuildRetrievalContextOptions,
): Promise<DocumentRetrievalContext> {
  const explicitlyReferencesPdfVisual = (
    /(?:PDF|文档|论文|本页|当前页|第\s*\d+\s*页).{0,12}(?:图\s*\d*|图表|表格|公式|方程|曲线|流程图|架构图|示意图|figure|fig\.?|table|chart|equation|diagram)/i.test(options.question)
    || /(?:figure|fig\.?|图)\s*\d+.{0,12}(?:PDF|文档|论文|本页|当前页|第\s*\d+\s*页)/i.test(options.question)
  );
  // A chat attachment is an explicit user action. Treat it as the primary visual
  // question even when the wording is only "this part" and contains no image keyword.
  // References such as "Fig. 2 in the PDF" still belong to the PDF-page vision tool.
  const userImageQuestion = Boolean(options.userImageAttached && !explicitlyReferencesPdfVisual);
  const maximumPlanningRounds = 3;
  const maximumToolCalls = 6;
  const toolResults: DocumentToolResult[] = [];
  const seenToolCalls = new Set<string>();
  let plannerReason = '';
  let planningRounds = 0;
  let plannerFailed = false;

  const toolCallKey = (call: DocumentToolCall): string => {
    const orderedArguments = Object.fromEntries(
      Object.entries(call.arguments).sort(([left], [right]) => left.localeCompare(right)),
    );
    return `${call.name}:${JSON.stringify(orderedArguments)}`;
  };

  for (let round = 1; round <= maximumPlanningRounds; round += 1) {
    planningRounds = round;
    try {
      const planningPrompt = buildDocumentToolPlanningPrompt({
        question: options.question,
        currentPage: options.currentPage,
        totalPages: options.pageCount,
        selectedText: options.selectedText,
        currentPageText: options.currentPageText,
        visionAvailable: options.hasVisionModel && !userImageQuestion,
        userImageAttached: Boolean(options.userImageAttached),
        outlineTitles: options.outline.map((item) => item.title),
        previousResults: toolResults,
        round,
      });
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具规划提示词`, planningPrompt);
      const plan = await options.requestAi(
        [{ role: 'user', content: planningPrompt }],
        {
          task: `Agent 证据规划 · 第 ${round} 轮`,
          documentName: options.documentName,
          pageNumber: options.currentPage,
          totalPages: options.pageCount,
          pageText: '',
          selectedText: '',
          sourceScope: 'document',
          sourceLabel: 'Agent 已知证据与本地工具目录',
          sourcePages: uniquePages([options.currentPage, ...toolResults.flatMap((result) => result.pages)]),
          contextNote: '只判断证据是否充分并选择工具；必须返回 JSON，不直接回答用户。',
        },
      );
      const decision = parseDocumentToolDecision(plan);
      if (/Planner returned (?:no valid|malformed) JSON\./.test(decision.reason)) {
        throw new Error(decision.reason);
      }
      plannerReason = decision.reason;
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具决策`, decision);
      if (decision.decision === 'answer' || decision.calls.length === 0) break;

      const remainingCallCount = maximumToolCalls - seenToolCalls.size;
      const calls = decision.calls
        .filter((call) => !(userImageQuestion && call.name === 'inspect_page_image'))
        .filter((call) => !seenToolCalls.has(toolCallKey(call)))
        .slice(0, Math.max(0, remainingCallCount));
      if (calls.length === 0) {
        plannerReason = `${plannerReason}（后续工具调用与已有调用重复，停止继续检索。）`;
        break;
      }
      calls.forEach((call) => seenToolCalls.add(toolCallKey(call)));

      const roundResults = await executeDocumentToolCalls(calls, options);
      toolResults.push(...roundResults);
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具结果`, roundResults.map((result) => ({
        name: result.name,
        label: result.label,
        pages: result.pages,
        contentLength: result.content.length,
      })));
      if (seenToolCalls.size >= maximumToolCalls) {
        plannerReason = `${plannerReason}（已达到单次回答的工具调用上限。）`;
        break;
      }
    } catch (error) {
      plannerFailed = true;
      plannerReason = error instanceof Error ? error.message : String(error);
      console.warn('[PDF Helper Agent] 证据规划失败，准备使用通用检索回退', error);
      break;
    }
  }

  // This is a capability fallback, not a question-specific rule. If the planner is
  // unavailable, retrieve semantically related chunks instead of pretending that
  // the visible page represents the requested scope.
  if (
    plannerFailed
    && toolResults.length === 0
    && options.chunks.length > 0
    && !options.selectedText.trim()
    && !userImageQuestion
  ) {
    const fallbackCall: DocumentToolCall = {
      name: 'search_document',
      arguments: { query: options.question, limit: 5 },
    };
    seenToolCalls.add(toolCallKey(fallbackCall));
    toolResults.push(...await executeDocumentToolCalls([fallbackCall], options));
    plannerReason = `工具规划失败，已执行通用全文语义检索：${plannerReason}`;
  }

  const retrievalText = toolResults.length
    ? formatDocumentToolResults(toolResults)
    : '';
  const currentPageLabel = userImageQuestion ? 'PDF 当前页文字补充' : '当前页正文';
  // Tool evidence is placed first so a long visible page cannot truncate or
  // semantically overshadow the evidence the agent deliberately retrieved.
  const orderedText = toolResults.length
    ? `[Agent 工具检索结果]\n${retrievalText}\n\n[${currentPageLabel} · 第 ${options.currentPage} 页，仅作补充]\n${options.currentPageText}`
    : `[${currentPageLabel} · 第 ${options.currentPage} 页]\n${options.currentPageText}`;
  return {
    text: orderedText.slice(0, 26000),
    sourcePages: uniquePages([options.currentPage, ...toolResults.flatMap((result) => result.pages)]),
    toolResults,
    plannerReason,
    planningRounds,
  };
}
