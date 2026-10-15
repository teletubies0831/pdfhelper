import assert from 'node:assert/strict';

import {
  createDocumentTabId,
  documentTabLabel,
  findDocumentTab,
  findDocumentTabByFingerprint,
  neighborTabAfterRemoval,
} from '../src/viewer/app/document-tabs-model.ts';

const makeTab = (id, fingerprint) => ({ id, fingerprint });
const tabs = [
  makeTab('a', 'fp-1'),
  makeTab('b', 'fp-2'),
  makeTab('c', 'fp-3'),
];

assert.notEqual(createDocumentTabId(), createDocumentTabId());
assert.ok(createDocumentTabId().length > 0);

assert.equal(findDocumentTab(tabs, 'b')?.id, 'b');
assert.equal(findDocumentTab(tabs, 'missing'), null);

assert.equal(findDocumentTabByFingerprint(tabs, 'fp-2')?.id, 'b');
assert.equal(findDocumentTabByFingerprint(tabs, 'fp-missing'), null);
// Empty fingerprints never match (documents without a fingerprint are unique).
assert.equal(findDocumentTabByFingerprint(tabs, ''), null);

// Browser-like neighbor selection after removal.
assert.equal(neighborTabAfterRemoval(tabs, 'a')?.id, 'b');
assert.equal(neighborTabAfterRemoval(tabs, 'b')?.id, 'c');
assert.equal(neighborTabAfterRemoval(tabs, 'c')?.id, 'b');
assert.equal(neighborTabAfterRemoval([tabs[0]], 'a'), null);
assert.equal(neighborTabAfterRemoval(tabs, 'missing'), null);

assert.equal(documentTabLabel({ name: 'Attention Is All You Need.pdf' }), 'Attention Is All You Need');
assert.equal(documentTabLabel({ name: 'https://arxiv.org/x.pdf' }), 'https://arxiv.org/x');
assert.equal(documentTabLabel({ name: 'NoExtension' }), 'NoExtension');

console.log('Document tab model tests passed.');
