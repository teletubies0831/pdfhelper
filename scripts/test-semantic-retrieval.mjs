import assert from 'node:assert/strict';

import {
  chunkKnowledgeDocument,
  cosineSimilarity,
  fuseKnowledgeRankings,
  rankSemanticKnowledgeChunks,
} from '../src/modules/knowledge/domain/semantic-retrieval.ts';
import { mapHistoricalDocumentSemanticSources } from '../src/viewer/services/document-agent/historical-document-source-mapper.ts';
import {
  findExplicitKnowledgeDocumentScope,
  trimWeakKnowledgeEvidence,
} from '../src/viewer/features/assistant/document-scope-filter.ts';

const documents = [
  {
    recordKey: 'a',
    title: '注意力机制',
    content: 'Transformer 使用自注意力建模长距离关系。'.repeat(80),
    documentName: 'paper-a.pdf',
    category: '方法',
    tags: ['Transformer'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    recordKey: 'b',
    title: '卷积网络',
    content: '卷积神经网络使用局部感受野。',
    documentName: 'paper-b.pdf',
    category: '方法',
    tags: ['CNN'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const chunks = chunkKnowledgeDocument(documents[0]);
assert.ok(chunks.length > 1, 'long knowledge content should be chunked');
assert.ok(chunks.every((chunk) => chunk.text.includes('注意力机制')));

assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);

const ranked = rankSemanticKnowledgeChunks(
  [
    { recordKey: 'a', text: 'weak a', embedding: [0.2, 0.8] },
    { recordKey: 'a', text: 'best a', embedding: [0.99, 0.01] },
    { recordKey: 'b', text: 'best b', embedding: [0.4, 0.6] },
  ],
  [1, 0],
  documents,
  2,
);
assert.deepEqual(ranked.map((match) => match.recordKey), ['a', 'b']);
assert.equal(ranked[0].matchedText, 'best a');

const fused = fuseKnowledgeRankings(
  [
    { recordKey: 'exact', score: 10, matchedText: 'exact keyword' },
    { recordKey: 'both', score: 8, matchedText: 'keyword passage' },
  ],
  [
    { recordKey: 'semantic', score: 0.9, matchedText: 'semantic only' },
    { recordKey: 'both', score: 0.8, matchedText: 'semantic passage' },
  ],
  3,
);
assert.equal(fused[0].recordKey, 'both', 'hybrid retrieval should reward agreement');
assert.equal(fused[0].matchedText, 'semantic passage');

const fullTextSources = mapHistoricalDocumentSemanticSources(
  [{
    id: 'pdf:history',
    fingerprint: 'history',
    name: 'history.pdf',
    readingMode: 'paper',
    pageCount: 8,
    indexVersion: 1,
    processingStatus: 'indexed',
    createdAt: 1,
    updatedAt: 2,
  }],
  new Map([['pdf:history', [{
    id: 'pdf:history:chunk:0',
    documentId: 'pdf:history',
    order: 0,
    startPage: 3,
    endPage: 4,
    heading: 'Method',
    text: 'A historical paper full-text passage.',
  }]]]),
);
assert.equal(fullTextSources.length, 1);
assert.equal(fullTextSources[0].recordKey, 'pdf-full-text:pdf:history:chunk:0');
assert.equal(fullTextSources[0].positionLabel, '第 3-4 页');

const libraryDocuments = [
  { documentId: 'breakneck', documentName: 'Breakneck by Dan Wang.pdf' },
  { documentId: 'egnn', documentName: 'EGNNFingers Explainability-Driven Fingerprinting.pdf' },
  { documentId: 'deepreg', documentName: 'DeepReg Ownership Regulatory Framework.pdf' },
];
assert.deepEqual(
  Array.from(findExplicitKnowledgeDocumentScope('breakneck 第二章讲了什么', libraryDocuments)),
  ['breakneck'],
  'an explicit paper name should constrain retrieval to that PDF',
);
assert.deepEqual(
  Array.from(findExplicitKnowledgeDocumentScope('比较 Breakneck 和 EGNN 的方案', libraryDocuments)),
  ['breakneck', 'egnn'],
  'multiple explicit names should keep all requested PDFs',
);
assert.equal(
  findExplicitKnowledgeDocumentScope('模型所有权验证有哪些方法', libraryDocuments).size,
  0,
  'generic research terms should preserve whole-library retrieval',
);

const trimmedEvidence = trimWeakKnowledgeEvidence(
  [
    { recordKey: 'breakneck:1', score: 0.9, matchedText: 'best' },
    { recordKey: 'breakneck:2', score: 0.82, matchedText: 'second' },
    { recordKey: 'breakneck:3', score: 0.79, matchedText: 'third' },
    { recordKey: 'breakneck:4', score: 0.76, matchedText: 'fourth same paper' },
    { recordKey: 'egnn:1', score: 0.2, matchedText: 'weak unrelated' },
  ],
  (recordKey) => recordKey.split(':')[0],
  'semantic',
  6,
);
assert.deepEqual(
  trimmedEvidence.map((match) => match.recordKey),
  ['breakneck:1', 'breakneck:2', 'breakneck:3'],
  'weak evidence and excess passages from one PDF should be removed',
);
assert.equal(fullTextSources[0].documentId, 'pdf:history');

console.log('Semantic retrieval tests passed.');
