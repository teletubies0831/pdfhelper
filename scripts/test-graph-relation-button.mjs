import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * 「分析关系」按钮的生命周期.
 *
 * It is disabled for the duration of a run (a second click would spend the tokens twice) and must be enabled again
 * afterwards, whatever the outcome — success, a dismissed review, a failed request. It has no availability refresh of its
 * own, so the re-enable has to be explicit; without it the button stayed dead until the page was reloaded, which is the
 * 「点一次就不能再点了」 report this suite exists to close.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage();

  // The real toolbar markup, so the module's cached element handle points at a real button.
  const template = await readFile(new URL('../src/viewer/templates/knowledge-graph.html', import.meta.url), 'utf8');
  await page.setContent(template);

  const code = await loadModule('src/viewer/features/knowledge-graph/graph-relation-actions.ts');

  await page.evaluate((source) => {
    window.calls = [];
    window.runOutcome = 'ok';

    // The picker and the review dialog are the two human steps; the tests decide what the user "clicked".
    const picker = {
      async openRelationPaperPicker() {
        window.calls.push(['picker']);
        return { paperIds: ['p1', 'p2'] };
      },
    };
    const review = {
      async openRelationReviewDialog(input) {
        window.calls.push(['review', input.rows.length]);
        return 'accept-all';
      },
    };
    const ports = { createRelationAnalysisPorts: () => ({}) };
    const barrel = {
      relationPairKey: (left, right) => `${left}|${right}`,
      normalizeEntityName: (name) => name,
      loadPendingReview: async () => ({ total: 0 }),
      describeRelationResult: () => '关系分析完成。',
      collectJudgedPairKeys: () => new Set(),
      // The page-side repository the module reaches for directly.
      knowledgeGraphRepository: {
        listEntities: async () => [],
        listEdges: async () => [],
        readSettings: async () => ({ relationTopK: 5, maximalRecallCandidates: 40 }),
      },
      runRelationAnalysis: async () => {
        window.calls.push(['run']);
        if (window.runOutcome === 'throw') throw new Error('provider 不可用');
        return { status: 'done', edgesWritten: 1, bridgesCreated: 0, manualNodes: 0 };
      },
    };
    const statusBar = { setStatus: (message, error) => window.calls.push(['status', message, Boolean(error)]) };
    // 全局任务栏：这里只记录调用，渲染行为由 test:task-center 覆盖。
    const taskCenter = {
      startTask: (input) => {
        window.calls.push(['task-start', input.title]);
        return {
          id: 'task-test',
          update: (patch) => window.calls.push(['task-update', patch.detail ?? '']),
          advance: () => {},
          finish: (status, detail) => window.calls.push(['task-finish', status, detail ?? '']),
        };
      },
    };
    const elements = {
      knowledgeGraphRelationButton: document.getElementById('knowledge-graph-relation'),
    };

    const moduleExports = {};
    new Function('require', 'exports', source)((name) => {
      if (name === '../../../modules/knowledge-graph/public') return barrel;
      if (name === '../../app/viewer-elements') return elements;
      if (name === '../../app/status-bar') return statusBar;
      if (name === './graph-extraction-repository') return ports;
      if (name === './relation-paper-picker') return picker;
      if (name === './relation-review-dialog') return review;
      if (name === '../../shared-ui/tasks/task-center') return taskCenter;
      throw new Error(`Unmocked dependency: ${name}`);
    }, moduleExports);
    window.relationActions = moduleExports;
  }, code);
});

after(async () => {
  await browser?.close();
});

function installContext() {
  // Built inside the page: a context is functions, and Playwright cannot serialise those into `evaluate`.
  return {
    getPapers: () => [{ paperId: 'p1', title: 'A' }, { paperId: 'p2', title: 'B' }],
    getEntityNames: () => new Map(),
    currentPaperId: () => 'p1',
    reload: async () => {},
    ensureReady: () => {},
    setProgress: () => {},
    refreshAvailability: async () => {},
  };
}

test('一次运行结束后按钮重新可用，而且可以再点一次', async () => {
  const result = await page.evaluate(async () => {
    const button = document.getElementById('knowledge-graph-relation');
    const { configureRelationActions, analyzePaperRelations } = window.relationActions;
    configureRelationActions({
      getPapers: () => [{ paperId: 'p1', title: 'A' }, { paperId: 'p2', title: 'B' }],
      getEntityNames: () => new Map(),
      currentPaperId: () => 'p1',
      reload: async () => {},
      ensureReady: () => {},
      setProgress: () => {},
      refreshAvailability: async () => {},
    });

    window.runOutcome = 'ok';
    window.calls = [];
    await analyzePaperRelations();
    const afterRun = { disabled: button.disabled, calls: [...window.calls] };

    // A second click must work: that is the whole bug.
    window.calls = [];
    await analyzePaperRelations();
    return { afterRun, afterSecondRun: { disabled: button.disabled, calls: [...window.calls] } };
  });

  assert.equal(result.afterRun.disabled, false, 'the button is usable again once the run finished');
  // 任务栏调用是这一轮新加的：它穿插在流程里，但不改变 picker → judge → status 的顺序。
  assert.deepEqual(
    result.afterRun.calls.map((call) => call[0]).filter((kind) => !kind.startsWith('task-')),
    ['picker', 'run', 'status'],
    'and the run went through picker → judge → status',
  );
  assert.equal(
    result.afterRun.calls.some((call) => call[0] === 'task-start'),
    true,
    '关系判定也进全局任务栏',
  );
  assert.equal(
    result.afterRun.calls.some((call) => call[0] === 'task-finish' && call[1] === 'done'),
    true,
  );
  assert.equal(result.afterSecondRun.disabled, false, 'a second analysis is possible in the same session');
  assert.deepEqual(
    result.afterSecondRun.calls.map((call) => call[0]).filter((kind) => !kind.startsWith('task-')),
    ['picker', 'run', 'status'],
  );
});

test('运行失败也会恢复按钮，并且把失败说出来', async () => {
  const result = await page.evaluate(async () => {
    const button = document.getElementById('knowledge-graph-relation');
    const { configureRelationActions, analyzePaperRelations } = window.relationActions;
    configureRelationActions({
      getPapers: () => [{ paperId: 'p1', title: 'A' }, { paperId: 'p2', title: 'B' }],
      getEntityNames: () => new Map(),
      currentPaperId: () => 'p1',
      reload: async () => {},
      ensureReady: () => {},
      setProgress: () => {},
      refreshAvailability: async () => {},
    });

    window.calls = [];
    window.runOutcome = 'throw';
    const before = button.disabled;
    await analyzePaperRelations();
    return { before, afterFailure: button.disabled, calls: [...window.calls] };
  });

  assert.equal(result.before, false);
  assert.equal(result.afterFailure, false, 'a failed run must not leave the button dead either');
  const status = result.calls.find((call) => call[0] === 'status');
  assert.ok(status, 'the failure is reported instead of escaping as an unhandled rejection');
  assert.match(status[1], /失败/);
  assert.equal(status[2], true, 'and it is reported as an error, not as a normal status line');
});
