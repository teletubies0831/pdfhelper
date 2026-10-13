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
