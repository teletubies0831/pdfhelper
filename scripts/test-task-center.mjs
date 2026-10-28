import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * 全局任务栏的行为.
 *
 * The bar is the only progress surface that survives a page switch, so what matters is: it appears for a running task, it
 * reports the counters it was given, the cancel button calls back exactly once, and a finished task leaves a status behind
 * instead of vanishing silently. A DOM component with no observable output in a headless run would otherwise be "verified" by
 * looking at it.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
  const code = await loadModule('src/viewer/shared-ui/tasks/task-center.ts');
  await page.evaluate((source) => {
    const exports = {};
    new Function('exports', source)(exports);
    window.taskCenter = exports;
  }, code);
});

after(async () => { await browser.close(); });

test('任务栏显示进度、详情与停止', async () => {
  const outcome = await page.evaluate(() => {
    const { startTask, resetTasksForTest } = window.taskCenter;
    resetTasksForTest();
    let cancelled = 0;
    const task = startTask({
      title: '抽取候选实体：Breakneck',
      detail: '正在检查全文索引…',
      total: 54,
      cancelable: true,
      onCancel: () => { cancelled += 1; },
    });
    const bar = document.getElementById('pdfpal-task-center');
    const read = () => ({
      hidden: bar.hidden,
      title: bar.querySelector('.task-center-title')?.textContent,
      detail: bar.querySelector('.task-center-detail')?.textContent,
      fill: bar.querySelector('.task-center-fill')?.style.width,
      cancelHidden: bar.querySelector('.task-center-cancel')?.hidden,
    });
    const started = read();

    task.update({ detail: '正在抽取候选实体：27/54 块 · 第 9/18 批', completed: 27, total: 54 });
    const halfway = read();

    bar.querySelector('.task-center-cancel').click();
    const afterCancel = { cancelled, detail: read().detail };

    task.finish('done', '候选 12 个 · 新增 5 个');
    const finished = {
      ...read(),
      classes: bar.className,
      icon: bar.querySelector('.task-center-icon')?.textContent,
      cancelHidden: bar.querySelector('.task-center-cancel')?.hidden,
    };

    resetTasksForTest();
    const removed = document.getElementById('pdfpal-task-center');
    return { started, halfway, afterCancel, finished, removed: removed === null };
  });

  assert.equal(outcome.started.hidden, false);
  assert.equal(outcome.started.title, '抽取候选实体：Breakneck');
  assert.equal(outcome.started.detail, '正在检查全文索引… · 0/54');
  assert.equal(outcome.started.fill, '0%');
  assert.equal(outcome.started.cancelHidden, false);

  assert.equal(outcome.halfway.detail, '正在抽取候选实体：27/54 块 · 第 9/18 批 · 27/54');
  assert.equal(outcome.halfway.fill, '50%');

  assert.equal(outcome.afterCancel.cancelled, 1, '停止 calls the owner exactly once');
  // 组件不替调用方改文案：是否显示「正在停止」由启动任务的那一方决定。
  assert.equal(outcome.afterCancel.detail, '正在抽取候选实体：27/54 块 · 第 9/18 批 · 27/54');

  assert.equal(outcome.finished.classes.includes('is-done'), true);
  assert.equal(outcome.finished.icon, '✓');
  assert.equal(outcome.finished.cancelHidden, true, 'a finished task offers no cancellation');
  assert.equal(outcome.removed, true, 'reset removes the bar itself');
});

test('多个任务：详情列表逐个列出，行内停止只停那一个', async () => {
  const outcome = await page.evaluate(() => {
    const { startTask, listTasks, resetTasksForTest } = window.taskCenter;
    resetTasksForTest();
    const stopped = [];
    const first = startTask({
      title: '抽取论文 A', total: 10, cancelable: true, onCancel: () => stopped.push('A'),
    });
    first.advance(4, '4/10 块');
    const second = startTask({
      title: '分析关系 B', total: 6, cancelable: true, onCancel: () => stopped.push('B'),
    });
    second.advance(2, '2/6 对');

    const bar = document.getElementById('pdfpal-task-center');
    bar.querySelector('.task-center-toggle').click();
    const rows = [...bar.querySelectorAll('.task-center-row')].map((row) => ({
      title: row.querySelector('.task-center-row-title')?.textContent,
      detail: row.querySelector('.task-center-row-detail')?.textContent,
      hasStop: Boolean(row.querySelector('.task-center-row-stop')),
    }));
    // 行顺序是最新在前：正在跑的那个应当是第一个。
    bar.querySelector('.task-center-row .task-center-row-stop')?.click();
    const stoppedAfterRowClick = [...stopped];

    const allStop = bar.querySelector('.task-center-cancel');
    allStop.click();
    return { rows, stoppedAfterRowClick, stopped, count: listTasks().length };
  });

  assert.equal(outcome.rows.length, 2);
  assert.deepEqual(outcome.rows.map((row) => row.title), ['分析关系 B', '抽取论文 A']);
  assert.equal(outcome.rows[0].detail, '2/6 对 · 2/6 · 33%');
  assert.deepEqual(outcome.rows.map((row) => row.hasStop), [true, true]);
  assert.deepEqual(outcome.stoppedAfterRowClick, ['B'], 'the row stop button only stops its own task');
  assert.deepEqual(outcome.stopped, ['B', 'A', 'B'], '全部停止 stops every running cancelable task');
});

test('切换「详情」只影响展开状态，不丢任务', async () => {
  const outcome = await page.evaluate(() => {
    const { startTask, resetTasksForTest, listTasks } = window.taskCenter;
    resetTasksForTest();
    startTask({ title: '后台任务', total: 3 });
    const bar = document.getElementById('pdfpal-task-center');
    const list = bar.querySelector('.task-center-list');
    const before = list.hidden;
    bar.querySelector('.task-center-toggle').click();
    const opened = list.hidden;
    const count = listTasks().length;
    bar.querySelector('.task-center-toggle').click();
    return { before, opened, closed: list.hidden, count, label: bar.querySelector('.task-center-toggle')?.textContent };
  });

  assert.equal(outcome.before, true);
  assert.equal(outcome.opened, false);
  assert.equal(outcome.closed, true);
  assert.equal(outcome.count, 1, 'expanding/collapsing never loses a task');
  assert.match(outcome.label, /详情（1）/);
});
