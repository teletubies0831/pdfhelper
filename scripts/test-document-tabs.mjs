import assert from 'node:assert/strict';

import {
  createDocumentTabId,
  documentTabLabel,
  findDocumentTab,
  findDocumentTabByFingerprint,
  neighborTabAfterRemoval,
  planTabClose,
  planTabCloseGuard,
} from '../src/viewer/app/document-tabs-model.ts';
import { normalizePdfFileName, sourcePdfMatchesOpenDocument } from '../src/viewer/shared-ui/navigation/source-pdf-match.ts';
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

// ---------------------------------------------------------------------------
// 关闭标签页前的确认：后台标签页也可能带着未保存批注
//
// `snapshotActiveTab()` 在切走时把 hasUnsavedChanges 和批注状态复制进标签页，而不是保存或解决它，所以「后台标签页不可能有未保存
// 改动」这个前提是错的：按旧规则关掉它，用户的批注会被无提示丢掉。
// ---------------------------------------------------------------------------
assert.equal(
  planTabCloseGuard({ isActive: true, hasActiveDocument: true, tabHasUnsavedChanges: false }),
  'active',
  '活动标签页总是先问（确认函数自己在没有改动时直接返回 true）',
);
assert.equal(
  planTabCloseGuard({ isActive: true, hasActiveDocument: false, tabHasUnsavedChanges: true }),
  'none',
  '工作区是空的时候没有可确认的内容',
);
assert.equal(
  planTabCloseGuard({ isActive: false, hasActiveDocument: true, tabHasUnsavedChanges: true }),
  'background',
  '带未保存改动的后台标签页必须先确认',
);
assert.equal(
  planTabCloseGuard({ isActive: false, hasActiveDocument: true, tabHasUnsavedChanges: false }),
  'none',
  '干净的后台标签页直接关，不打扰用户',
);

// ---------------------------------------------------------------------------
// 源文件身份：给了条目 id 就只认 id，同一文件名不算同一份文件
// ---------------------------------------------------------------------------
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: 'entry-b',
    requestedEntryId: 'entry-a',
    openName: '论文.pdf',
    targetName: '论文.pdf',
  }),
  false,
  '同名但不同条目：不是同一份文件，必须真的去打开目标文件',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: 'entry-a',
    requestedEntryId: 'entry-a',
    openName: '另一个名字.pdf',
    targetName: '论文.pdf',
  }),
  true,
  '同一个条目就是同一份文件，名字不同也无所谓',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: null,
    requestedEntryId: 'entry-a',
    openName: '论文.pdf',
    targetName: '论文.pdf',
  }),
  false,
  '当前文档没有条目 id 时不能靠重名蒙对',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: null,
    openName: '论文.pdf',
    targetName: '论文.PDF',
  }),
  true,
  '调用方没有 id 可给时才退回文件名比较（大小写、扩展名无关）',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: false,
    openEntryId: 'entry-a',
    requestedEntryId: 'entry-a',
    openName: '',
    targetName: '论文.pdf',
  }),
  false,
  '没有打开的文档就谈不上「已经是这份文件」',
);

// ---------------------------------------------------------------------------
// 远程 PDF：sourceName 是 URL，两侧都可能没有 entry id
//
// 上一轮把规则抽成纯函数时漏了「URL → 文件名」这一步：远程 PDF 的 sourceName 是完整 URL，与记录里的文件名永远不相等，
// 于是已经打开的原文认不出来，「打开原文」转而去最近文件里重开（记录被清掉时就失败）。
// ---------------------------------------------------------------------------
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: null,
    openName: 'https://arxiv.org/pdf/2401.00001v2.pdf?download=1',
    targetName: '2401.00001v2.pdf',
  }),
  true,
  'URL 与同名显示文件（两侧都没有条目 id）应当认为是同一份',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: null,
    openName: 'file:///C:/Users/me/Documents/%E8%AE%BA%E6%96%87.pdf',
    targetName: '论文.pdf',
  }),
  true,
  '本地文件 URL 要解码成文件名再比较',
);
assert.equal(
  sourcePdfMatchesOpenDocument({
    hasOpenDocument: true,
    openEntryId: null,
    openName: 'https://example.com/a/one.pdf',
    targetName: 'two.pdf',
  }),
  false,
  'URL 也要真的比较文件名，不是一律相等',
);
assert.equal(normalizePdfFileName('  Paper  Name.PDF '), 'paper name', '空白与大小写归一化');

console.log('Document tab model and batch-open tests passed.');
