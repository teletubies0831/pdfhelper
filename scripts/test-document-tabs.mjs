import assert from 'node:assert/strict';

import {
  createDocumentTabId,
  documentTabLabel,
  findDocumentTab,
  findDocumentTabByFingerprint,
  neighborTabAfterRemoval,
  planTabClose,
} from '../src/viewer/app/document-tabs-model.ts';
import {
  describePdfBatch,
  describePdfBatchFailures,
  runPdfBatch,
} from '../src/viewer/app/document-open-batch.ts';

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

// ---------------------------------------------------------------------------
// Closing a tab must not change what the user is reading.
//
// The original implementation activated a neighbour unconditionally, so clicking ×
// on a background tab silently switched the visible document — which is exactly the
// "the close button does something else" complaint this plan exists to fix.
// ---------------------------------------------------------------------------
const closeBackground = planTabClose(tabs, 'a', 'c');
assert.deepEqual(
  closeBackground.remainingTabs.map((tab) => tab.id),
  ['b', 'c'],
  'the closed tab is gone from the list',
);
assert.equal(closeBackground.closedActiveTab, false);
assert.equal(
  closeBackground.nextActiveTabId,
  null,
  'a background close keeps the active document: nothing to activate',
);
assert.equal(closeBackground.shouldClearWorkspace, false);

// Closing the active tab hands the reader a neighbour: the tab that took the slot,
// else the previous one (browser behaviour).
const closeActiveMiddle = planTabClose(tabs, 'b', 'b');
assert.equal(closeActiveMiddle.closedActiveTab, true);
assert.equal(closeActiveMiddle.nextActiveTabId, 'c');
assert.equal(closeActiveMiddle.shouldClearWorkspace, false);

const closeActiveLast = planTabClose(tabs, 'c', 'c');
assert.equal(closeActiveLast.nextActiveTabId, 'b', 'the last tab falls back to the previous');

// Closing the only tab empties the workspace.
const closeOnly = planTabClose([tabs[0]], 'a', 'a');
assert.deepEqual(closeOnly.remainingTabs, []);
assert.equal(closeOnly.nextActiveTabId, null);
assert.equal(closeOnly.shouldClearWorkspace, true);

// An unknown id is a no-op rather than a destructive "remove something else".
const unknown = planTabClose(tabs, 'nope', 'b');
assert.deepEqual(unknown.remainingTabs.map((tab) => tab.id), ['a', 'b', 'c']);
assert.equal(unknown.nextActiveTabId, null);
assert.equal(unknown.shouldClearWorkspace, false);

// The input list is never mutated: the runtime splices its own copy.
assert.equal(tabs.length, 3, 'planning a close must not mutate the caller list');

// ---------------------------------------------------------------------------
// Batch opening.
// ---------------------------------------------------------------------------
const items = [
  { name: 'a.pdf', data: new Uint8Array(), fileHandle: null },
  { name: 'b.pdf', data: new Uint8Array(), fileHandle: null },
  { name: 'c.pdf', data: new Uint8Array(), fileHandle: null },
];

const order = [];
const progress = [];
const batch = await runPdfBatch(items, {
  open: async (item) => {
    order.push(item.name);
    return { id: item.name };
  },
  onProgress: (position, total, name) => progress.push(`${position}/${total} ${name}`),
});
assert.deepEqual(order, ['a.pdf', 'b.pdf', 'c.pdf'], 'opens run in order, one at a time');
assert.deepEqual(progress, ['1/3 a.pdf', '2/3 b.pdf', '3/3 c.pdf']);
assert.deepEqual(batch, { requested: 3, opened: 3, failures: [] });
assert.equal(describePdfBatch(batch), '已打开 3 篇文献。');
assert.equal(describePdfBatchFailures(batch), null);

// One bad file must not stop the rest: picking twenty papers and getting nothing
// because one is corrupt is a worse outcome than getting nineteen.
const mixed = await runPdfBatch(items, {
  open: async (item) => {
    if (item.name === 'b.pdf') throw new Error('PDF 已损坏');
    return { id: item.name };
  },
});
assert.equal(mixed.opened, 2);
assert.deepEqual(mixed.failures, [{ name: 'b.pdf', message: 'PDF 已损坏' }]);
assert.equal(describePdfBatch(mixed), '已打开 2 / 3 篇文献，1 篇失败。');
const detail = describePdfBatchFailures(mixed);
assert.match(detail, /1 篇文献未能打开/);
assert.match(detail, /b\.pdf：PDF 已损坏/, 'the failing file is named with its reason');

// An opener that reports "did not open" with null/false is a failure, not a silent
// success.
const skipped = await runPdfBatch([items[0]], { open: async () => null });
assert.equal(skipped.opened, 0);
assert.equal(skipped.failures.length, 1);
assert.equal(describePdfBatch(skipped), '已打开 0 / 1 篇文献，1 篇失败。');
assert.equal((await runPdfBatch([items[0]], { open: async () => false })).failures.length, 1);

// ...but a void opener that returns nothing is a *success*. Treating `undefined` as
// failure marked every file in a batch as failed while the tabs were opening
// normally — the bug this assertion exists to keep out.
const voidOpened = await runPdfBatch(items, { open: async () => { /* returns undefined */ } });
assert.equal(voidOpened.opened, 3);
assert.deepEqual(voidOpened.failures, []);
assert.equal(describePdfBatch(voidOpened), '已打开 3 篇文献。');
// A truthy object result is a success as well (openPdf resolves with the tab).
const tabResult = await runPdfBatch(items, { open: async () => ({ id: 'tab-1' }) });
assert.equal(tabResult.opened, 3);

// Everything failing is reported as an error state (the caller shows the dialog).
const allFailed = await runPdfBatch(items, {
  open: async () => {
    throw new Error('nope');
  },
});
assert.equal(allFailed.opened, 0);
assert.equal(allFailed.failures.length, 3);

// An empty selection says so instead of claiming success.
const empty = await runPdfBatch([], { open: async () => ({ id: 'x' }) });
assert.deepEqual(empty, { requested: 0, opened: 0, failures: [] });
assert.equal(describePdfBatch(empty), '没有选择任何文件。');

console.log('Document tab model and batch-open tests passed.');
