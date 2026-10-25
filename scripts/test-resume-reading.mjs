import assert from 'node:assert/strict';

import {
  resumeActionLabel,
  resumeLabel,
  resumePointOf,
  sortPendingQueue,
} from '../src/viewer/features/knowledge-base/resume-reading.ts';

/**
 * 续读的判定.
 *
 * The interesting cases are the ones where the record and the file disagree: a paper re-saved with fewer pages, a position
 * recorded on a document that was then replaced. Those must clamp, not open a page that does not exist — and the label has
 * to say so, because "继续阅读（第 900 页）" on a 34-page paper is a bug report waiting to happen.
 */

const document = (overrides = {}) => ({
  documentName: 'paper.pdf',
  pageCount: 34,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 没有进度：不假装有
// ---------------------------------------------------------------------------
{
  assert.equal(resumePointOf(document()), null);
  assert.equal(resumePointOf(document({ lastReadPage: 0 })), null);
  assert.equal(resumePointOf(document({ lastReadPage: Number.NaN })), null);
  assert.equal(resumeLabel(document()), '');
  assert.equal(resumeActionLabel(document()), '打开原文');
}

// ---------------------------------------------------------------------------
// 正常进度
// ---------------------------------------------------------------------------
{
  const point = resumePointOf(document({ lastReadPage: 12, lastReadAt: '2026-10-18T02:00:00.000Z' }));
  assert.deepEqual(point, {
    pageNumber: 12,
    lastReadAt: '2026-10-18T02:00:00.000Z',
    clamped: false,
  });
  assert.equal(resumeLabel(document({ lastReadPage: 12 })), '第 12 / 34 页');
  assert.equal(resumeActionLabel(document({ lastReadPage: 12 })), '继续阅读（第 12 页）');
}

// ---------------------------------------------------------------------------
// 记录里的页码超出当前文件：夹住，并且标签要说清楚
// ---------------------------------------------------------------------------
{
  const point = resumePointOf(document({ lastReadPage: 900 }));
  assert.equal(point.pageNumber, 34);
  assert.equal(point.clamped, true, 'the UI needs to be able to explain the clamp');
  assert.equal(resumeLabel(document({ lastReadPage: 900 })), '第 34 / 34 页');
  assert.equal(resumeActionLabel(document({ lastReadPage: 900 })), '重读结尾（第 34 页）');
}

// ---------------------------------------------------------------------------
// 页数未知（老记录没有 pageCount）：原样返回，不夹
// ---------------------------------------------------------------------------
{
  const point = resumePointOf(document({ pageCount: 0, lastReadPage: 7 }));
  assert.equal(point.pageNumber, 7);
  assert.equal(point.clamped, false);
  assert.equal(resumeLabel(document({ pageCount: 0, lastReadPage: 7 })), '第 7 页');
}

// ---------------------------------------------------------------------------
// 待读队列：按入库时间升序，时间相同保持原顺序
// ---------------------------------------------------------------------------
{
  const queue = [
    { documentName: 'c', addedAt: '2026-03-01T00:00:00.000Z' },
    { documentName: 'a', addedAt: '2026-01-01T00:00:00.000Z' },
    { documentName: 'b', addedAt: '2026-02-01T00:00:00.000Z' },
  ];
  assert.deepEqual(
    sortPendingQueue(queue).map((item) => item.documentName),
    ['a', 'b', 'c'],
    'the earliest added is read first',
  );
  // The input is not mutated: the controller passes the filtered list it may render again.
  assert.equal(queue[0].documentName, 'c');

  const sameDay = [
    { documentName: 'first', addedAt: '2026-01-01T00:00:00.000Z' },
    { documentName: 'second', addedAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortPendingQueue(sameDay).map((item) => item.documentName), ['first', 'second']);

  // A record without a date sorts last rather than jumping to the front (NaN comparisons would do that with `<`).
  const missingDate = [
    { documentName: 'dated', addedAt: '2026-01-01T00:00:00.000Z' },
    { documentName: 'undated' },
  ];
  assert.deepEqual(sortPendingQueue(missingDate).map((item) => item.documentName), ['dated', 'undated']);
}

console.log('Resume reading contract tests passed.');
