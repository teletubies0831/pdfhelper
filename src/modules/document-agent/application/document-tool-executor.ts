
import { getDocumentAgentStrategy, searchDocumentChunks, type DocumentToolCall, type DocumentToolResult } from "../../../../shared/document-agent";


import { profileToText, toPositivePage, toStringValue } from './runtime-contracts';
import type { BuildRetrievalContextOptions } from './runtime-contracts';
import { detectRequestedSectionTitle, resolveSectionRange, uniquePages } from './section-resolver';



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
