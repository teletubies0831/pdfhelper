import { getKnowledgeDocument, updateKnowledgeDocument, type KnowledgeLibraryDocument } from '../adapters/browser-document-corpus';

export function getDocumentOverviewMarkdown(item: KnowledgeLibraryDocument): string {
  return (item.overviewDraftComplete === true ? item.overviewDraftMarkdown : undefined) || item.overviewMarkdown || '';
}

export function saveDocumentOverview(documentId: string, markdown: string): void {
  if (!getKnowledgeDocument(documentId)) throw new Error('这份 PDF 已从知识库移除。');
  if (!markdown.trim()) throw new Error('请填写概览内容后再保存。');
  updateKnowledgeDocument(documentId, {
    overviewMarkdown: markdown.trim(), overviewStatus: 'ready',
    overviewEditedAt: new Date().toISOString(), overviewError: undefined,
    overviewDraftMarkdown: undefined, overviewDraftComplete: undefined, overviewProgress: undefined,
    // Ignore late background responses after an explicit manual save.
    overviewRequestId: `manual:${crypto.randomUUID()}`,
  });
}

/**
 * Stores the on-demand 「相关论文」 section.
 *
 * Its own record, not a line inside `overviewMarkdown`: the user may edit the overview by hand, and that save
 * replaces the whole markdown — which used to be able to delete a section that cost a retrieval call. Storing it
 * apart also lets the dialog show when it was fetched and what it cost.
 */
export function saveRelatedLiterature(
  documentId: string,
  result: {
    markdown: string;
    searchCalls: number;
    fetchCalls: number;
    sources: Array<'deepseek' | 'openalex'>;
    degraded?: string;
  },
): void {
  if (!getKnowledgeDocument(documentId)) throw new Error('这份 PDF 已从知识库移除。');
  updateKnowledgeDocument(documentId, {
    relatedLiteratureMarkdown: result.markdown.trim() || undefined,
    relatedLiteratureAt: new Date().toISOString(),
    relatedLiteratureUsage: {
      searchCalls: result.searchCalls,
      fetchCalls: result.fetchCalls,
    },
    relatedLiteratureSources: result.sources,
    relatedLiteratureError: result.degraded || undefined,
  });
}
