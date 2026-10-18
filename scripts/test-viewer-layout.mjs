import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';
import { describeGraphView } from '../src/viewer/features/knowledge-graph/graph-view-report.ts';
import {
  collectMatchedNodeIds,
  filterVisibleEdges,
  filterVisibleNodes,
  passesConfidence,
} from '../src/viewer/features/knowledge-graph/graph-view-filters.ts';

/**
 * Layout regressions from real use.
 *
 * Two separate reports, both about the *view* rather than the data:
 *
 * 1. Every graph action reloads the snapshot, and the reload used to refit the canvas
 *    — so panning somewhere and then clicking 统计 snapped the graph back to the
 *    origin. The rule now lives in a small controller; "fit exactly once, after the
 *    layout pass" is easy to regress silently, so it is pinned here.
 * 2. A long, deeply nested outline entry printed over the row below it in a narrow
 *    sidebar. That is a CSS height question, tested against the real stylesheet in a
 *    real browser.
 *
 * Both run in the browser because the modules involved are viewer files with
 * extensionless imports, which Node's type stripping cannot resolve.
 */

// ---------------------------------------------------------------------------
// What the graph page reports about the view, and the filters behind it.
//
// These rules produced actively misleading text: documents with no relations were
// counted as "过滤隐藏" (nothing had been filtered) and every empty canvas blamed the
// filters, sending the reader after a problem that did not exist.
// ---------------------------------------------------------------------------
const baseReport = {
  visiblePapers: 0,
  visibleEntities: 0,
  visibleUserNodes: 0,
  visibleEdges: 0,
  unconnectedNodes: 0,
  hiddenByFilters: 0,
  truncated: false,
  condensationNote: '',
  totalPapers: 0,
  totalEntities: 0,
  totalEdges: 0,
};

// Unconnected documents are labelled as such, never as filtered-out.
const unconnected = describeGraphView({ ...baseReport, unconnectedNodes: 10, totalPapers: 10 });
assert.match(unconnected.countsText, /未连接 10/);
assert.doesNotMatch(unconnected.countsText, /过滤隐藏/);

// And the hint names the real reason: nothing connects them yet.
assert.equal(unconnected.empty, true);
assert.match(unconnected.emptyHint, /还没有任何关系/);
assert.match(unconnected.emptyHint, /抽取候选实体/, 'the hint names the action that fixes it');
assert.doesNotMatch(unconnected.emptyHint, /放宽过滤条件/);
// The source is named as the knowledge base, because that is the authority: a paper is in
// the graph because the user put it in the knowledge base, not because it was opened.
assert.match(unconnected.emptyHint, /知识库里的 10 篇文献/);
assert.doesNotMatch(unconnected.emptyHint, /阅读记录/, 'opening a PDF is no longer the entry point');

// A genuinely filtered view still says so.
const filteredView = describeGraphView({
  ...baseReport,
  hiddenByFilters: 4,
  totalPapers: 4,
  totalEntities: 2,
  totalEdges: 6,
});
assert.match(filteredView.countsText, /过滤隐藏 4/);
assert.match(filteredView.emptyHint, /放宽过滤条件/);

// An empty knowledge base gets the "add one to the knowledge base" hint — reading a PDF is
// not enough any more, so the old wording would have sent the user in a circle.
const emptyHint = describeGraphView(baseReport).emptyHint;
assert.match(emptyHint, /知识库还是空的/);
assert.match(emptyHint, /添加到知识库/, 'the hint names the action that actually adds a paper');
assert.doesNotMatch(emptyHint, /阅读记录会自动进入/);

// No papers but leftover entity records: still "the knowledge base is empty". The old condition
// also required zero entities, so this case fell through to "the 0 篇文献 in your knowledge base are
// not connected" — a sentence that contradicts itself.
const papersGone = describeGraphView({
  ...baseReport,
  unconnectedNodes: 4,
  totalEntities: 4,
});
assert.match(
  papersGone.emptyHint,
  /知识库还是空的/,
  `a graph with no papers says so, even if stale entities linger: ${papersGone.emptyHint}`,
);
assert.doesNotMatch(papersGone.emptyHint, /0 篇文献之间/);

// A corpus whose pairs have all been judged "unrelated" is not an un-analysed one: those verdicts
// are cached, so telling the user to analyse again would spend tokens to re-derive an answer they
// already have. The negatives never draw, so this is the only place their existence is visible.
const allUnrelated = describeGraphView({
  ...baseReport,
  unconnectedNodes: 4,
  totalPapers: 4,
  totalEdges: 0,
  unrelatedPairCount: 3,
});
assert.match(allUnrelated.emptyHint, /无关系/);
assert.match(allUnrelated.emptyHint, /重新判断/, 'and it names the way to change one verdict');
assert.doesNotMatch(
  allUnrelated.emptyHint,
  /还没有任何关系/,
  'cached negatives are not "never analysed"',
);

// Components with nothing to say are omitted rather than printed as zero.
const populated = describeGraphView({
  ...baseReport,
  visiblePapers: 3,
  visibleEntities: 5,
  visibleUserNodes: 2,
  visibleEdges: 4,
  truncated: true,
  condensationNote: '已折叠 12 个叶子节点',
  totalPapers: 3,
  totalEntities: 5,
  totalEdges: 4,
});
assert.equal(
  populated.countsText,
  '3 文献 · 5 实体 · 2 个人标注 · 4 边 · 已截断 · 已折叠 12 个叶子节点',
);
assert.equal(populated.empty, false);
assert.equal(populated.emptyHint, '', 'a populated canvas needs no explanation');

// Filters: search is a case-insensitive substring; an empty box passes everything.
const filterPapers = [
  { paperId: 'p1', title: 'Attention Is All You Need' },
  { paperId: 'p2', title: 'BERT' },
];
const filterEntities = [
  { entityId: 'e1', name: 'XOR Count' },
  { entityId: 'e2', name: 'heuristic' },
];
const showAll = {
  showPapers: true,
  showEntities: true,
  showOriginAi: true,
  showOriginRule: true,
  showOriginUser: true,
  searchQuery: '',
};
assert.equal(filterVisibleNodes(filterPapers, filterEntities, showAll).papers.length, 2);
assert.equal(
  filterVisibleNodes(filterPapers, filterEntities, { ...showAll, searchQuery: ' attention ' })
    .papers.length,
  1,
);
assert.equal(
  filterVisibleNodes(filterPapers, filterEntities, { ...showAll, searchQuery: 'HEURISTIC' })
    .entities.length,
  1,
);
assert.equal(
  filterVisibleNodes(filterPapers, filterEntities, { ...showAll, showPapers: false })
    .papers.length,
  0,
);
assert.equal(
  filterVisibleNodes(filterPapers, filterEntities, { ...showAll, showEntities: false })
    .entities.length,
  0,
);

// The confidence floor filters *nodes*, not just edges. It used to cull edges alone, so dragging a
// slider labelled 置信度下限 barely changed the picture.
const confidenceEntities = [
  { entityId: 'high', name: 'Transformer', confidence: 0.9 },
  { entityId: 'low', name: 'Obscure Trick', confidence: 0.45 },
  // No confidence recorded: assumed to pass rather than be hidden.
  { entityId: 'unknown', name: 'Unscored' },
];
const floor = { ...showAll, minConfidence: 0.6 };
assert.deepEqual(
  filterVisibleNodes(filterPapers, confidenceEntities, floor).entities.map((entity) => entity.entityId),
  ['high', 'unknown'],
  'entities below the floor are hidden; an unknown confidence is not treated as zero',
);
assert.equal(
  filterVisibleNodes(filterPapers, confidenceEntities, { ...showAll, minConfidence: 0 }).entities.length,
  3,
  'a floor of zero shows everything',
);
assert.equal(
  filterVisibleNodes(filterPapers, confidenceEntities, floor).papers.length,
  2,
  'documents are not estimates: the floor never hides a paper',
);
assert.equal(passesConfidence(0.6, 0.6), true, 'the floor itself passes');
assert.equal(passesConfidence(0.59, 0.6), false);

// Origins are three independent switches.
const filterEdges = [
  { edgeId: 'a', origin: 'ai' },
  { edgeId: 'r', origin: 'rule' },
  { edgeId: 'u', origin: 'user' },
];
assert.deepEqual(
  filterVisibleEdges(filterEdges, { ...showAll, showOriginRule: false }).map((edge) => edge.edgeId),
  ['a', 'u'],
);
assert.deepEqual(
  filterVisibleEdges(filterEdges, { ...showAll, showOriginAi: false, showOriginUser: false })
    .map((edge) => edge.edgeId),
  ['r'],
);

// Matches are reported for both node kinds; a blank search highlights nothing.
assert.deepEqual([...collectMatchedNodeIds(filterPapers, filterEntities, 'need')], ['p1']);
assert.deepEqual([...collectMatchedNodeIds(filterPapers, filterEntities, 'xor')], ['e1']);
assert.equal(collectMatchedNodeIds(filterPapers, filterEntities, '   ').size, 0);

let browser;
let page;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1092, height: 586 } });

  // The real stylesheets that shape the outline column, and a sidebar at its real
  // width — the overlap only appears once a title actually wraps.
  const [visual, layout] = await Promise.all([
    readFile(new URL('../src/viewer/styles/reader-visual-refresh.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/viewer/styles/reader-workspace-layout.css', import.meta.url), 'utf8'),
  ]);
  await page.setContent(`
    <!doctype html><html><head><style>
      ${visual}
      ${layout}
      html, body { margin: 0; }
      #host { width: 260px; height: 420px; overflow: hidden; }
      .outline-list { max-height: 420px; }
    </style></head>
    <body><div id="host"><nav class="outline-list" aria-label="PDF 目录"></nav></div></body></html>
  `);

  const controllerCode = await loadModule(
    'src/viewer/features/knowledge-graph/graph-viewport-controller.ts',
  );
  const viewportCode = await loadModule(
    'src/viewer/features/knowledge-graph/graph-viewport.ts',
  );

  await page.evaluate(([controllerSource, viewportSource]) => {
    const viewportModule = {};
    new Function('require', 'exports', viewportSource)(() => {
      throw new Error('graph-viewport has no dependencies');
    }, viewportModule);
    window.viewportModule = viewportModule;

    window.controllerModule = {};
    new Function('require', 'exports', controllerSource)((name) => {
      if (name.includes('graph-viewport')) return viewportModule;
      throw new Error(`Unmocked dependency: ${name}`);
    }, window.controllerModule);
  }, [controllerCode, viewportCode]);
});

after(async () => { await browser?.close(); });

test('the first fit happens once and later reloads keep the user position', async () => {
  const result = await page.evaluate(() => {
    const applied = [];
    const controller = window.controllerModule.createGraphViewportController({
      initial: { scale: 1, offsetX: 0, offsetY: 0 },
      measure: () => ({ width: 800, height: 600 }),
      apply: (viewport) => applied.push({ ...viewport }),
    });
    const points = [
      { x: 0, y: 0, radius: 10 },
      { x: 400, y: 300, radius: 10 },
    ];

    const firstFit = controller.fitOnce(points);
    const afterFit = { ...controller.get(), appliedCount: applied.length };

    // The user pans and zooms somewhere deliberate.
    controller.set({ scale: 2.5, offsetX: -640, offsetY: -320 });
    const panned = { ...controller.get() };

    // A reload (statistics / conflicts / a finished extraction) re-runs the layout and
    // asks for a fit: it must be ignored, or the user has to drag back every time.
    const secondFit = controller.fitOnce(points);
    const afterReload = { ...controller.get() };
    const appliedAfterReload = applied.length;

    // The explicit 适应画布 action still fits.
    controller.fit(points);
    const afterExplicitFit = { ...controller.get() };

    // A graph that emptied out is fitted again when it fills up.
    controller.set({ scale: 3, offsetX: -100, offsetY: -100 });
    controller.invalidate();
    const fitAfterInvalidate = controller.fitOnce(points);

    // Fitting an empty graph must not produce a broken viewport.
    controller.fit([]);
    const emptyFit = { ...controller.get() };

    return {
      firstFit,
      secondFit,
      afterFit,
      panned,
      afterReload,
      appliedAfterReload,
      afterExplicitFit,
      fitAfterInvalidate,
      emptyFit,
    };
  });

  assert.equal(result.firstFit, true, 'the first layout fits the view');
  assert.equal(result.afterFit.appliedCount, 1);
  assert.ok(result.afterFit.scale > 0);

  assert.deepEqual(result.panned, { scale: 2.5, offsetX: -640, offsetY: -320 });

  assert.equal(result.secondFit, false, 'a reload must not refit');
  assert.deepEqual(
    result.afterReload,
    { scale: 2.5, offsetX: -640, offsetY: -320 },
    'a reload must not move the canvas',
  );
  assert.equal(result.appliedAfterReload, 2, 'the ignored fit applied nothing');

  assert.notDeepEqual(
    result.afterExplicitFit,
    { scale: 2.5, offsetX: -640, offsetY: -320 },
    '适应画布 still fits on demand',
  );

  assert.equal(result.fitAfterInvalidate, true, 'invalidation re-enables the fit');

  assert.ok(Number.isFinite(result.emptyFit.scale) && result.emptyFit.scale > 0);
  assert.ok(Number.isFinite(result.emptyFit.offsetX));
});

test('a long nested outline title grows its row instead of overlapping the next', async () => {
  const result = await page.evaluate(() => {
    const list = document.querySelector('.outline-list');
    list.replaceChildren();
    // Enough long, nested rows that the list is taller than its box. That is the
    // condition the real bug needed: the list is a column flex container, and flex
    // items shrink by default, so with a constrained height every row was squeezed to
    // its 35px minimum while a wrapped title needed ~53px — and the extra lines printed
    // over the row below.
    const titles = [
      'Introduction',
      'Matrix Decomposition in GN(F2)',
      'Operation Based Matrix Multiplication With A Very Long Nested Title That Must Wrap',
      'Elementary Row (Column) Operations',
      'Cost of XOR Matrices',
      'Converting Matrix Decomposition to Matrix Implementation Without Extra Gates',
      'Reducing the Implementation Cost of Linear Matrices With Heuristics',
      'Search Algorithm and Applications',
      'Hybrid Elementary Operations and Their Cost Model',
      'Rational of Strategy Three And Its Two Variants',
      'Proof of Rule One To Seven',
      'Limitations and Future Work',
      'References and Appendices',
      'Summary',
    ];
    list.style.maxHeight = '200px';
    for (const [index, title] of titles.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.style.paddingLeft = index > 1 ? '40px' : '12px';
      list.appendChild(button);
    }

    const rows = [...list.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      return {
        text: button.textContent.slice(0, 24),
        top: rect.top,
        height: rect.height,
        clientHeight: button.clientHeight,
        scrollHeight: button.scrollHeight,
        flexShrink: getComputedStyle(button).flexShrink,
        bands: [...range.getClientRects()].map((band) => ({
          top: Math.round(band.top), bottom: Math.round(band.bottom),
        })),
      };
    });

    const overlaps = [];
    for (let a = 0; a < rows.length; a += 1) {
      for (let b = a + 1; b < rows.length; b += 1) {
        for (const first of rows[a].bands) {
          for (const second of rows[b].bands) {
            if (Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1) {
              overlaps.push([rows[a].text, rows[b].text]);
            }
          }
        }
      }
    }
    return {
      rows,
      overlaps,
      overflowing: rows.filter((row) => row.scrollHeight - row.clientHeight > 1),
      listScrolls: list.scrollHeight > list.clientHeight + 1,
    };
  });

  const longRow = result.rows[2];
  assert.ok(
    longRow.height > 35,
    `a wrapped title must make its row taller than the 35px minimum; got ${longRow.height}`,
  );
  assert.ok(
    result.rows.every((row) => row.flexShrink === '0'),
    'rows must not shrink: a shrunk row prints its text over the next one',
  );
  assert.deepEqual(
    result.overflowing,
    [],
    'no row may render content taller than its own box (that is what overlapped)',
  );
  assert.deepEqual(result.overlaps, [], 'no two rows may print over each other');
  assert.equal(result.listScrolls, true, 'the list scrolls instead of squeezing its rows');
});

console.log('Viewer layout regression tests passed.');
