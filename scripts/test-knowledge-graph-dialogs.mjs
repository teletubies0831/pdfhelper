import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule, loadModuleClosure } from './support/module-closure.mjs';

/**
 * Browser-level tests for the knowledge-graph confirmation and merge dialogs.
 *
 * These run the **real dialog modules** against the **real markup**, in a real
 * browser. The contract tests cover the planning rules; this covers the layer
 * where every bug in this feature has actually appeared — DOM ids that do not
 * exist, pre-check decisions that disagree with the threshold, a confirm action
 * that sends the wrong payload, and a dismissal path that leaves the caller's
 * promise pending forever.
 *
 * The repository module is stubbed, so no IndexedDB is touched and the test needs
 * no build step or extension host.
 */

let browser;
let page;

const REVIEW_IDS = [
  'knowledge-graph-review-dialog',
  'knowledge-graph-review-title',
  'knowledge-graph-review-summary',
  'knowledge-graph-review-groups',
  'knowledge-graph-review-selection',
  'knowledge-graph-review-show-low',
  'knowledge-graph-review-translate-field',
  'knowledge-graph-review-translate',
  'knowledge-graph-review-synonym-field',
  'knowledge-graph-review-synonym',
  'knowledge-graph-review-select-all',
  'knowledge-graph-review-select-none',
  'knowledge-graph-review-confirm',
  'knowledge-graph-review-later',
  'knowledge-graph-review-close',
];

const MERGE_IDS = [
  'knowledge-graph-merge-dialog',
  'knowledge-graph-merge-title',
  'knowledge-graph-merge-summary',
  'knowledge-graph-merge-groups',
  'knowledge-graph-merge-selection',
  'knowledge-graph-merge-restore',
  'knowledge-graph-merge-apply',
  'knowledge-graph-merge-later',
  'knowledge-graph-merge-close',
];

const METRICS_IDS = [
  'knowledge-graph-metrics-dialog',
  'knowledge-graph-metrics-title',
  'knowledge-graph-metrics-summary',
  'knowledge-graph-metrics-body',
  'knowledge-graph-metrics-note',
  'knowledge-graph-metrics-copy',
  'knowledge-graph-metrics-done',
  'knowledge-graph-metrics-close',
];

const CONFLICT_IDS = [
  'knowledge-graph-conflict-dialog',
  'knowledge-graph-conflict-title',
  'knowledge-graph-conflict-summary',
  'knowledge-graph-conflict-groups',
  'knowledge-graph-conflict-selection',
  'knowledge-graph-conflict-apply',
  'knowledge-graph-conflict-later',
  'knowledge-graph-conflict-close',
];

const PAPERS_IDS = [
  'knowledge-graph-papers-dialog',
  'knowledge-graph-papers-title',
  'knowledge-graph-papers-summary',
  'knowledge-graph-papers-groups',
  'knowledge-graph-papers-selection',
  'knowledge-graph-papers-library',
  'knowledge-graph-papers-later',
  'knowledge-graph-papers-close',
];

const RELATION_IDS = [
  'knowledge-graph-relation-dialog',
  'knowledge-graph-relation-title',
  'knowledge-graph-relation-summary',
  'knowledge-graph-relation-groups',
  'knowledge-graph-relation-selection',
  'knowledge-graph-relation-select-all',
  'knowledge-graph-relation-select-none',
  'knowledge-graph-relation-write',
  'knowledge-graph-relation-discard',
  'knowledge-graph-relation-close',
];

/**
 * The statistics and conflict dialogs render real reports and real explanations,
 * so they need the real modules behind them.
 *
 * Stubbing `computeGraphMetrics` or `describeConflicts` would leave the
 * interesting half — turning records into the sentences the user reads — untested
 * in the one place it runs. These are the entry points; their relative dependency
 * closure is walked automatically (see `loadModuleClosure`). The module barrel
 * itself stays stubbed, because importing it would pull in the persistence
 * adapters.
 */
const MODULE_CLOSURES = [
  'src/modules/knowledge-graph/application/graph-metrics.ts',
  'src/modules/knowledge-graph/application/conflict-resolution.ts',
  // Relation wording: the canvas no longer writes the relation type, so the inspector and the two
  // review dialogs read it from here. Real code, because a missing label is exactly what would show
  // up as a bare `MENTIONS` in the panel the user opened to learn what it means.
  'src/modules/knowledge-graph/domain/edge-labels.ts',
];

/**
 * Explicit `#id` -> exported handle name map, mirroring
 * `app/elements/knowledge-graph-elements.ts`.
 *
 * Written out rather than derived from the id: a regex conversion is easy to get
 * subtly wrong (it silently produced `graphReviewShowLow` instead of
 * `knowledgeGraphReviewShowLow`), and the failure mode is a confusing
 * "undefined.addEventListener" deep inside the module under test.
 */
const ELEMENT_HANDLES = {
  'knowledge-graph-review-dialog': 'knowledgeGraphReviewDialog',
  'knowledge-graph-review-title': 'knowledgeGraphReviewTitleElement',
  'knowledge-graph-review-summary': 'knowledgeGraphReviewSummaryElement',
  'knowledge-graph-review-groups': 'knowledgeGraphReviewGroupsElement',
  'knowledge-graph-review-selection': 'knowledgeGraphReviewSelectionElement',
  'knowledge-graph-review-show-low': 'knowledgeGraphReviewShowLowInput',
  'knowledge-graph-review-translate-field': 'knowledgeGraphReviewTranslateField',
  'knowledge-graph-review-translate': 'knowledgeGraphReviewTranslateInput',
  'knowledge-graph-review-synonym-field': 'knowledgeGraphReviewSynonymField',
  'knowledge-graph-review-synonym': 'knowledgeGraphReviewSynonymInput',
  'knowledge-graph-review-select-all': 'knowledgeGraphReviewSelectAllButton',
  'knowledge-graph-review-select-none': 'knowledgeGraphReviewSelectNoneButton',
  'knowledge-graph-review-confirm': 'knowledgeGraphReviewConfirmButton',
  'knowledge-graph-review-later': 'knowledgeGraphReviewLaterButton',
  'knowledge-graph-review-close': 'knowledgeGraphReviewCloseButton',
  'knowledge-graph-merge-dialog': 'knowledgeGraphMergeDialog',
  'knowledge-graph-merge-title': 'knowledgeGraphMergeTitleElement',
  'knowledge-graph-merge-summary': 'knowledgeGraphMergeSummaryElement',
  'knowledge-graph-merge-groups': 'knowledgeGraphMergeGroupsElement',
  'knowledge-graph-merge-selection': 'knowledgeGraphMergeSelectionElement',
  'knowledge-graph-merge-restore': 'knowledgeGraphMergeRestoreButton',
  'knowledge-graph-merge-apply': 'knowledgeGraphMergeApplyButton',
  'knowledge-graph-merge-later': 'knowledgeGraphMergeLaterButton',
  'knowledge-graph-merge-close': 'knowledgeGraphMergeCloseButton',
  'knowledge-graph-metrics-dialog': 'knowledgeGraphMetricsDialog',
  'knowledge-graph-metrics-title': 'knowledgeGraphMetricsTitleElement',
  'knowledge-graph-metrics-summary': 'knowledgeGraphMetricsSummaryElement',
  'knowledge-graph-metrics-body': 'knowledgeGraphMetricsBodyElement',
  'knowledge-graph-metrics-note': 'knowledgeGraphMetricsNoteElement',
  'knowledge-graph-metrics-copy': 'knowledgeGraphMetricsCopyButton',
  'knowledge-graph-metrics-done': 'knowledgeGraphMetricsDoneButton',
  'knowledge-graph-metrics-close': 'knowledgeGraphMetricsCloseButton',
  'knowledge-graph-conflict-dialog': 'knowledgeGraphConflictDialog',
  'knowledge-graph-conflict-title': 'knowledgeGraphConflictTitleElement',
  'knowledge-graph-conflict-summary': 'knowledgeGraphConflictSummaryElement',
  'knowledge-graph-conflict-groups': 'knowledgeGraphConflictGroupsElement',
  'knowledge-graph-conflict-selection': 'knowledgeGraphConflictSelectionElement',
  'knowledge-graph-conflict-apply': 'knowledgeGraphConflictApplyButton',
  'knowledge-graph-conflict-later': 'knowledgeGraphConflictLaterButton',
  'knowledge-graph-conflict-close': 'knowledgeGraphConflictCloseButton',
  'knowledge-graph-relation-dialog': 'knowledgeGraphRelationDialog',
  'knowledge-graph-relation-title': 'knowledgeGraphRelationTitleElement',
  'knowledge-graph-relation-summary': 'knowledgeGraphRelationSummaryElement',
  'knowledge-graph-relation-groups': 'knowledgeGraphRelationGroupsElement',
  'knowledge-graph-relation-selection': 'knowledgeGraphRelationSelectionElement',
  'knowledge-graph-relation-select-all': 'knowledgeGraphRelationSelectAllButton',
  'knowledge-graph-relation-select-none': 'knowledgeGraphRelationSelectNoneButton',
  'knowledge-graph-relation-write': 'knowledgeGraphRelationWriteButton',
  'knowledge-graph-relation-discard': 'knowledgeGraphRelationDiscardButton',
  'knowledge-graph-relation-close': 'knowledgeGraphRelationCloseButton',
  'knowledge-graph-papers-dialog': 'knowledgeGraphPapersDialog',
  'knowledge-graph-papers-title': 'knowledgeGraphPapersTitleElement',
  'knowledge-graph-papers-summary': 'knowledgeGraphPapersSummaryElement',
  'knowledge-graph-papers-groups': 'knowledgeGraphPapersGroupsElement',
  'knowledge-graph-papers-selection': 'knowledgeGraphPapersSelectionElement',
  'knowledge-graph-papers-library': 'knowledgeGraphPapersLibraryButton',
  'knowledge-graph-papers-later': 'knowledgeGraphPapersLaterButton',
  'knowledge-graph-papers-close': 'knowledgeGraphPapersCloseButton',
};

/** Waits until a dialog is closed (attribute check, not visibility). */
/** Waits until a dialog is closed (attribute check, not visibility). */
function waitForClosed(selector) {
  return page.waitForFunction(
    (id) => !document.getElementById(id).open,
    selector.replace(/^#/, ''),
  );
}

// Fixtures for the statistics dialog. Only the fields the metrics module reads
// are meaningful; the rest are present so the payloads are shaped like real
// records rather than convenient ones.
function paperOf(paperId) {
  return {
    paperId, documentAgentId: paperId, fingerprint: `fp-${paperId}`, title: paperId,
    year: 2020, authors: [], venue: '', doi: '', abstract: '', folderId: null, keywords: [],
    extractionStatus: 'ready', extractionError: null, extractedAt: null,
    projectionVersion: 1, createdAt: 1, updatedAt: 1,
  };
}

function entityOf(entityId, status, sourcePaperId) {
  return {
    entityId, name: entityId, normalizedName: entityId, aliases: [], type: 'Method',
    status, confidence: 0.8, sourcePaperId, evidence: [], mergedInto: null,
    userEdited: false, createdAt: 1, updatedAt: 1,
  };
}

function mentionsEdge(edgeId, paperId, entityId, quote) {
  return {
    edgeId, source: paperId, sourceKind: 'paper', target: entityId, targetKind: 'entity',
    type: 'MENTIONS', confidence: 0.9, sourcePaperId: paperId, origin: 'ai',
    originKey: `MENTIONS|${paperId}|${entityId}`, provenance: {}, createdAt: 1, updatedAt: 1,
    evidence: quote ? [{ paperId, pageNumber: 1, quote }] : [],
  };
}

/** Opens the statistics dialog for a snapshot; it needs no repository read. */
async function openMetrics(source) {
  await page.evaluate((payload) => {
    window.metrics.openGraphMetricsDialog(payload);
  }, source);
  await page.waitForSelector('#knowledge-graph-metrics-dialog[open]');
}

/**
 * The dialog stylesheets, in the order the viewer loads them.
 *
 * `composer-and-settings.css` carries the shared `.app-confirm-dialog` chrome that the
 * graph dialogs also inherit — including the three-column header grid that used to
 * squeeze their titles into one character per line.
 */
async function loadDialogCss() {
  const files = [
    'src/viewer/styles/application.css',
    'src/viewer/features/assistant/composer-and-settings.css',
    'src/viewer/styles/select-theme.css',
    'src/viewer/features/knowledge-graph/review-dialog.css',
  ];
  const parts = await Promise.all(files.map(async (path) => (
    readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  )));
  return parts.join('\n');
}

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage();

  const overlays = await readFile(
    new URL('../src/viewer/templates/knowledge-graph-overlays.html', import.meta.url),
    'utf8',
  );
  // The real stylesheets: several of these dialog regressions were pure layout (a title
  // wrapping one character per line, a `<select>` drawing a frame inside another frame),
  // so they can only be caught with the cascade in place.
  const dialogCss = await loadDialogCss();
  await page.setContent(
    `<!doctype html><html><head><style>${dialogCss}</style></head><body>${overlays}</body></html>`,
  );

  const reviewCode = await loadModule(
    'src/viewer/features/knowledge-graph/entity-review-dialog.ts',
  );
  const mergeCode = await loadModule(
    'src/viewer/features/knowledge-graph/entity-merge-dialog.ts',
  );
  const metricsCode = await loadModule(
    'src/viewer/features/knowledge-graph/graph-metrics-dialog.ts',
  );
  const conflictCode = await loadModule(
    'src/viewer/features/knowledge-graph/conflict-dialog.ts',
  );
  // The theme module is dependency-free and holds the origin copy the conflict
  // dialog shows, so it is used for real rather than stubbed.
  const themeCode = await loadModule('src/viewer/features/knowledge-graph/graph-theme.ts');
  const relationCode = await loadModule(
    'src/viewer/features/knowledge-graph/relation-review-dialog.ts',
  );
  const metricsClosure = await loadModuleClosure(MODULE_CLOSURES[0]);
  const conflictClosure = await loadModuleClosure(MODULE_CLOSURES[1]);
  const edgeLabelsClosure = await loadModuleClosure(MODULE_CLOSURES[2]);
  const papersCode = await loadModule(
    'src/viewer/features/knowledge-graph/papers-dialog.ts',
  );
  // The app wraps every `<select>` in a `.ui-select` trigger and hands the select's class names
  // to the wrapper (`custom-select.ts`). Leaving that out of the test is how a "fixed" double
  // frame survived: the test measured the native element, while the user saw the wrapper's frame
  // around the trigger's frame. The enhancer is part of the real page, so it runs here too.
  const selectCode = await loadModule('src/viewer/shared-ui/select/custom-select.ts');
  // The dialog's optional annotations (Chinese gloss, synonym suggestion) live in their own module
  // because they are a self-contained subsystem; it is real code, so it is loaded for real.
  const annotationsCode = await loadModule(
    'src/viewer/features/knowledge-graph/entity-review-annotations.ts',
  );

  await page.evaluate(
    ([reviewSource, mergeSource, metricsSource, conflictSource, relationSource, themeSource, closures, handleMap, papersSource, selectSource, annotationsSource]) => {
    const get = (id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing required element: #${id}`);
      return element;
    };

    // Reproduce the element handle barrel from the real markup, so a template/id
    // mismatch fails here exactly as it would at runtime.
    const elements = {};
    for (const [id, handleName] of Object.entries(handleMap)) {
      elements[handleName] = get(id);
    }

    // Capture every repository call so payloads can be asserted.
    window.confirmCalls = [];
    window.dismissCalls = [];
    window.mergeRejectCalls = [];
    window.mergeRejections = [];
    window.mergeCalls = [];
    window.ignored = [];
    window.statuses = [];
    window.openErrors = [];
    window.copiedText = '';
    // Names handed to the explanation hook. A page-level stub for the same reason as the translator:
    // a function cannot cross into the page, and the hook must be assertable without an API key.
    window.explainCalls = [];
    window.reviewExplainStub = (names) => {
      window.explainCalls.push([...names]);
    };

    // `loadPendingReview` is contractually responsible for the pre-check decision
    // (`buildPendingReview` derives it from `minConfidenceToAutoCheck`), so the
    // stub supplies it. Omitting it makes the dialog treat every row as
    // un-pre-checked and then hide them all by default — which is exactly how this
    // test first failed, and the dialog was right to refuse to invent a decision.
    const reviewRows = [
      { entityId: 'e-high', name: 'Transformer', normalizedName: 'transformer', type: 'Method',
        confidence: 0.95, aliases: [], paperId: 'p1', preChecked: true,
        evidence: [{ paperId: 'p1', pageNumber: 3, quote: 'we propose the Transformer' }] },
      { entityId: 'e-low', name: 'Obscure Trick', normalizedName: 'obscuretrick', type: 'Method',
        confidence: 0.4, aliases: [], paperId: 'p1', preChecked: false,
        evidence: [{ paperId: 'p1', pageNumber: 9, quote: 'a minor trick' }] },
      { entityId: 'e-metric', name: 'BLEU', normalizedName: 'bleu', type: 'Metric',
        confidence: 0.8, aliases: [], paperId: 'p2', preChecked: true, evidence: [] },
    ];

    window.moduleStub = {
      ENTITY_TYPES: ['Method', 'Task', 'Dataset', 'Metric', 'Concept', 'Claim'],
      knowledgeGraphRepository: {
        async readSettings() {
          return { mergeRejections: window.mergeRejections ?? [] };
        },
      },
      async loadPendingReview() {
        // Tests that need aliases or other names install their own row set.
        const rowsInUse = window.reviewRowsOverride ?? reviewRows;
        const types = [...new Set(rowsInUse.map((row) => row.type))];
        return {
          total: rowsInUse.length,
          preChecked: rowsInUse.filter((row) => row.preChecked).length,
          groups: types.map((type) => ({
            type,
            candidates: rowsInUse.filter((row) => row.type === type),
          })),
        };
      },
      async confirmEntityCandidates(candidates, paperId, _repo, options) {
        confirmCalls.push({ candidates, paperId, options });
        return {
          createdEntityIds: candidates.map((_, index) => `new-${index}`),
          reusedEntityIds: [], skippedIgnoredNames: [], edgesWritten: candidates.length,
        };
      },
      async ignoreEntityName(name) { ignored.push(name); return null; },
      async rejectMergeSuggestion(left, right, _repo) {
        window.mergeRejectCalls.push({ left, right });
        const key = [left, right].sort().join('|');
        window.mergeRejections = [...(window.mergeRejections ?? []), key];
        return window.mergeRejections.length;
      },
      async clearMergeRejections() {
        const cleared = (window.mergeRejections ?? []).length;
        window.mergeRejections = [];
        return cleared;
      },
      /**
       * Dismissal now writes through the module, so the test can assert *what* was written. A purely
       * local removal is what made the pending badge and the next opening disagree with the row.
       */
      async dismissEntityCandidates(entityIds, _repo, options) {
        window.dismissCalls.push({ entityIds: [...entityIds], remember: Boolean(options?.remember) });
        return { dismissed: entityIds.length, remembered: options?.remember ? entityIds.length : 0 };
      },
      async loadMergeReview() {
        return {
          autoSelectableCount: 1,
          excludedCount: 2,
          rows: [
            { keepEntityId: 'keep', mergeEntityId: 'm1', score: 0.983,
              reasons: ['spelling is very close'], autoSelectable: true,
              keepName: 'Graph Convolutional Network',
              mergeName: 'Graph Convolution Networks', keepAliases: [], mergeAliases: [],
              keepEvidenceCount: 3, mergeEvidenceCount: 1 },
            { keepEntityId: 'keep', mergeEntityId: 'm2', score: 1,
              reasons: ['identical after normalization'], autoSelectable: false,
              keepName: 'Graph Convolutional Network',
              mergeName: 'Graph Convolutional Networks', keepAliases: [], mergeAliases: [],
              keepEvidenceCount: 3, mergeEvidenceCount: 1 },
          ],
        };
      },
      groupMergeRowsByKeep(rows) {
        const byKeep = new Map();
        for (const row of rows) {
          if (!byKeep.has(row.keepEntityId)) byKeep.set(row.keepEntityId, []);
          byKeep.get(row.keepEntityId).push(row);
        }
        return [...byKeep.entries()].map(([keepEntityId, grouped]) => ({
          keepEntityId, keepName: grouped[0].keepName, rows: grouped,
        }));
      },
      orderMergePairsForBatch(rows) {
        return [...rows]
          .sort((left, right) => right.score - left.score)
          .map((row) => ({ keepEntityId: row.keepEntityId, mergeEntityId: row.mergeEntityId }));
      },
      async mergeGraphEntities(keepEntityId, mergeEntityId) {
        mergeCalls.push({ keepEntityId, mergeEntityId });
        return { keepEntityId, absorbedEntityId: mergeEntityId, edgesRewritten: 1, edgesDropped: 0 };
      },
    };

    const dialogMotion = {
      showAnimatedDialog(dialog) { dialog.showModal(); },
      dismissAnimatedDialog(dialog) { dialog.close(); },
    };
    const statusBar = {
      setStatus(message, isError) { statuses.push({ message, isError }); },
    };
    // Errors surface through the app error dialog; the stub records them so a failed
    // open path can be asserted rather than merely not-crashing.
    window.shownErrors = [];
    const errorDialog = {
      showAppError(message, options) {
        window.shownErrors.push({ message, options });
      },
    };

    // Instantiate the real module closures. Each module gets a `require` that
    // resolves relative to itself, mirroring Node's behaviour, so the modules can
    // be used exactly as they are written.
    const codeByPath = new Map(closures.flat());
    const registry = new Map();
    const resolveRelative = (fromPath, spec) => {
      const stack = fromPath.split('/').slice(0, -1);
      for (const part of spec.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') stack.pop();
        else stack.push(part);
      }
      const joined = stack.join('/');
      return [`${joined}.ts`, joined, `${joined}/public.ts`]
        .find((candidate) => codeByPath.has(candidate)) ?? null;
    };
    const instantiate = (path) => {
      const cached = registry.get(path);
      if (cached) return cached.exports;
      const module = { exports: {} };
      registry.set(path, module);
      new Function('require', 'exports', 'module', codeByPath.get(path))(
        (name) => {
          const resolved = resolveRelative(path, name);
          if (!resolved) throw new Error(`Unresolvable dependency ${name} from ${path}`);
          return instantiate(resolved);
        },
        module.exports,
        module,
      );
      return module.exports;
    };

    const build = (code, target) => {
      new Function('require', 'exports', code)((name) => {
        if (name.includes('knowledge-graph/public')) return window.moduleStub;
        if (name.includes('shared-ui/dialog/dialog-motion')) return dialogMotion;
        if (name.includes('viewer-elements')) return elements;
        if (name.includes('status-bar')) return statusBar;
        if (name.includes('error-dialog')) return errorDialog;
        if (name.includes('graph-theme')) return graphTheme;
        if (name.includes('entity-review-annotations')) return window.reviewAnnotations;
        throw new Error(`Unmocked dependency: ${name}`);
      }, target);
    };

    // Built before the dialog, which wires the controller up at module scope.
    window.reviewAnnotations = {};
    build(annotationsSource, window.reviewAnnotations);

    // The statistics and conflict dialogs read their report copy through the module
    // barrel, so the real implementations are grafted onto the stub barrel rather
    // than mocked.
    Object.assign(
      window.moduleStub,
      instantiate('src/modules/knowledge-graph/application/graph-metrics.ts'),
      instantiate('src/modules/knowledge-graph/application/conflict-resolution.ts'),
      instantiate('src/modules/knowledge-graph/domain/edge-labels.ts'),
    );

    window.review = {};
    build(reviewSource, window.review);
    window.merge = {};
    build(mergeSource, window.merge);
    window.metrics = {};
    build(metricsSource, window.metrics);
    const graphTheme = {};
    build(themeSource, graphTheme);
    window.conflicts = {};
    build(conflictSource, window.conflicts);
    window.relationReview = {};
    build(relationSource, window.relationReview);
    window.papers = {};
    build(papersSource, window.papers);
    window.elements = elements;

    // Clipboard access is not granted in headless mode, so the copy path is
    // observed through a stub instead of a permission prompt.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(text) { window.copiedText = text; } },
    });

    window.review.registerEntityReviewEvents();
    window.merge.registerEntityMergeEvents();
    window.metrics.registerGraphMetricsEvents();
    window.conflicts.registerConflictEvents();
    window.relationReview.registerRelationReviewEvents();
    window.papers.registerPapersDialogEvents();

    // Installed last, exactly as the app does it: the observer then enhances every `<select>` the
    // dialogs create from this point on, so the tests measure what the user sees.
    const selectModule = {};
    build(selectSource, selectModule);
    selectModule.installReusableSelects();
  }, [
    reviewCode, mergeCode, metricsCode, conflictCode, relationCode, themeCode,
    [metricsClosure, conflictClosure, edgeLabelsClosure], ELEMENT_HANDLES, papersCode, selectCode, annotationsCode,
  ]);
});

after(async () => { await browser?.close(); });

/** Opens the review dialog without awaiting it (it settles only on close). */
async function openReview(options = {}) {
  await page.evaluate((nextOptions) => {
    // Records are per opening: a test that asserts on the confirm payload must not see an earlier
    // test's rows.
    window.confirmCalls.length = 0;
    window.ignored.length = 0;
    window.dismissCalls.length = 0;
    window.explainCalls.length = 0;
    // A `Map` does not survive the trip into the page as a Map, so the title map is
    // passed as pairs and rebuilt on the other side.
    const paperTitles = nextOptions.paperTitles
      ? new Map(nextOptions.paperTitles)
      : undefined;
    // A function cannot cross into the page either, so the gloss translator is a page-level stub
    // that each test can install (or leave absent, which must hide the control entirely).
    const stub = window.reviewTranslateStub;
    const synonymStub = window.reviewSynonymStub;
    window.review
      .openEntityReviewDialog({
        ...nextOptions,
        paperTitles,
        translate: stub ? (terms) => stub(terms) : undefined,
        findSynonyms: synonymStub ? (terms) => synonymStub(terms) : undefined,
        explain: window.reviewExplainStub,
      })
      .catch((error) => {
        window.openErrors.push(String(error));
      });
  }, options);
  await page.waitForSelector('#knowledge-graph-review-dialog[open]');
  // The dialog is shown before `renderGroups` has necessarily populated it: the
  // open path awaits the repository read first, so wait for rendered rows rather
  // than for the element to exist.
  await page.waitForSelector('.knowledge-graph-review-row', { timeout: 5000 });
}

test('the review dialog header lays out as a row, not one character per line', async () => {
  // The shared `.app-confirm-dialog header` is a three-column grid built for an icon
  // plus text plus a close button. These dialogs have no icon, so their title landed in
  // the 42px icon column and — CJK breaks between any two characters — wrapped
  // vertically. Measured rather than assumed, because the failure is purely visual.
  await openReview();

  const header = await page.evaluate(() => {
    const dialog = document.getElementById('knowledge-graph-review-dialog');
    const title = document.getElementById('knowledge-graph-review-title');
    const summary = document.getElementById('knowledge-graph-review-summary');
    const dialogRect = dialog.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    return {
      dialogWidth: Math.round(dialogRect.width),
      titleWidth: Math.round(titleRect.width),
      titleHeight: Math.round(titleRect.height),
      titleText: (title.textContent ?? '').trim(),
      titleLines: Math.max(1, Math.round(titleRect.height / 22)),
      summaryWidth: Math.round(summaryRect.width),
      summaryHeight: Math.round(summaryRect.height),
    };
  });

  assert.ok(header.dialogWidth > 400, `dialog should be wide; got ${header.dialogWidth}`);
  assert.ok(
    header.titleWidth > 120,
    `the title must have room for a whole line; got ${header.titleWidth}px for "${header.titleText}"`,
  );
  assert.equal(
    header.titleLines,
    1,
    `the title must stay on one line; it occupies ${header.titleLines} lines`,
  );
  assert.ok(
    header.summaryWidth > 120,
    `the summary must not collapse to a character column; got ${header.summaryWidth}px`,
  );
  assert.ok(
    header.summaryHeight < 60,
    `the summary must read as a sentence, not a vertical column (${header.summaryHeight}px tall)`,
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('the type picker shows exactly one frame and the source names the paper', async () => {
  await openReview({
    paperTitles: [
      ['p1', 'Attention Is All You Need'],
      ['p2', 'BERT: Pre-training of Deep Bidirectional Transformers'],
    ],
  });

  const row = await page.evaluate(() => {
    const wrapper = document.querySelector('.knowledge-graph-review-type');
    const trigger = wrapper?.querySelector('.ui-select-trigger');
    const source = document.querySelector('.knowledge-graph-review-source');
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    const triggerStyle = trigger ? getComputedStyle(trigger) : null;
    const wrapperRect = wrapper?.getBoundingClientRect() ?? null;
    const triggerRect = trigger?.getBoundingClientRect() ?? null;
    return {
      enhanced: Boolean(wrapper?.classList.contains('ui-select')),
      // A wrapper frame around the trigger frame is the "double box" the user reported.
      wrapperBorder: wrapperStyle?.borderTopWidth ?? null,
      wrapperBackground: (wrapperStyle?.backgroundImage ?? '').slice(0, 24),
      triggerBorder: triggerStyle?.borderTopWidth ?? null,
      triggerBorderStyle: triggerStyle?.borderTopStyle ?? null,
      carets: wrapper?.querySelectorAll('.ui-select-caret').length ?? 0,
      valueText: (trigger?.querySelector('.ui-select-value')?.textContent ?? '').trim(),
      // No frame is drawn outside the trigger: the two boxes measure the same.
      wrapperWiderThanTrigger: wrapperRect && triggerRect
        ? Math.round(wrapperRect.width) - Math.round(triggerRect.width)
        : null,
      // The trigger must stay the only framed box even while it has focus.
      focusBorders: (() => {
        trigger?.focus();
        const focusedTrigger = trigger ? getComputedStyle(trigger) : null;
        const focusedWrapper = wrapper ? getComputedStyle(wrapper) : null;
        return {
          wrapper: focusedWrapper?.borderTopWidth ?? null,
          trigger: focusedTrigger?.borderTopWidth ?? null,
          triggerStyle: focusedTrigger?.borderTopStyle ?? null,
        };
      })(),
      sourceText: (source?.textContent ?? '').trim(),
    };
  });

  // The app enhances every select into a wrapper + trigger; both halves are asserted, because a
  // frame on the wrapper is invisible to a test that only looks at the native element.
  assert.equal(row.enhanced, true, 'the test must exercise the enhanced control, as the app does');
  assert.equal(row.wrapperBorder, '0px', 'the wrapper must not draw a frame of its own');
  assert.equal(row.wrapperBackground, 'none', 'the wrapper must not draw a caret either');
  assert.equal(row.triggerBorder, '1px', 'exactly one border is drawn');
  assert.equal(row.triggerBorderStyle, 'solid');
  assert.equal(row.carets, 1, 'exactly one caret');
  assert.equal(row.valueText, 'Method', 'the trigger shows the selected type');
  assert.equal(
    row.wrapperWiderThanTrigger,
    0,
    `the wrapper must not add a box around the trigger (extra ${row.wrapperWiderThanTrigger}px)`,
  );
  // Focus may add a ring, but not a second border: the frame count must not change.
  assert.equal(row.focusBorders.wrapper, '0px', 'focus must not draw a frame on the wrapper');
  assert.equal(row.focusBorders.trigger, '1px', 'the trigger keeps its single border when focused');

  // `来源 @816707a` was an internal id; the row must name the document instead.
  assert.match(
    row.sourceText,
    /Attention Is All You Need/,
    `the source must be the paper title; got "${row.sourceText}"`,
  );
  assert.doesNotMatch(row.sourceText, /@[0-9a-f]{6,}/, 'no truncated ids are shown');

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('ignoring a candidate removes the row and leaves the pending list', async () => {
  // Reported twice from real use. First the row stayed on screen; then it disappeared but the
  // candidate stayed *pending*, so the badge never moved and the row was back on the next open.
  // Both halves are asserted: the visible row and the write behind it.
  await openReview();
  const before = await page.locator('.knowledge-graph-review-row').count();
  assert.equal(before, 2, 'the two pre-checked candidates are listed');

  const firstName = await page.evaluate(() => document.querySelector(
    '.knowledge-graph-review-row .knowledge-graph-review-name',
  ).value);
  await page.locator('.knowledge-graph-review-row').first()
    .locator('button', { hasText: '忽略' }).click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.knowledge-graph-review-row').length === expected,
    before - 1,
  );
  assert.equal(
    await page.evaluate((gone) => [...document.querySelectorAll('.knowledge-graph-review-row .knowledge-graph-review-name')]
      .some((input) => input.value === gone), firstName),
    false,
    `the ignored row must be gone (was ${firstName})`,
  );
  // 忽略 rejects it for this review, and only for this review: no ignore-list write.
  assert.deepEqual(
    await page.evaluate(() => window.dismissCalls),
    [{ entityIds: ['e-high'], remember: false }],
    'the candidate is dismissed in the store, and not remembered',
  );
  // The counters follow the decision: one row dismissed, two candidates left in the review (the
  // hidden low-confidence row is still part of it, just not shown).
  assert.match(await page.locator('#knowledge-graph-review-selection').textContent(), /已忽略 1/);
  assert.match(await page.locator('#knowledge-graph-review-summary').textContent(), /共 2 个候选/);
  assert.match(await page.locator('#knowledge-graph-review-summary').textContent(), /已忽略 1 个/);

  // 不再提示 also removes the row, and writes the name to the ignore list so extraction stops
  // offering it.
  await page.locator('.knowledge-graph-review-row').first()
    .locator('button', { hasText: '不再提示' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.knowledge-graph-review-row').length === 0);
  assert.deepEqual(
    await page.evaluate(() => window.dismissCalls),
    [
      { entityIds: ['e-high'], remember: false },
      { entityIds: ['e-metric'], remember: true },
    ],
    'the second dismissal is remembered',
  );
  assert.match(
    await page.locator('#knowledge-graph-review-summary').textContent(),
    /已忽略 2 个/,
    'the header accumulates what was dismissed instead of showing a stale count',
  );
  assert.match(
    await page.locator('#knowledge-graph-review-groups').textContent(),
    /没有符合当前筛选的候选/,
    'and the list itself says why it is empty',
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('a Chinese gloss can be shown under each candidate name, without renaming it', async () => {
  // The user is deciding about terms in a foreign language; a gloss under the name turns that into
  // a judgement about the concept. It must stay a gloss: the name is what the graph links on.
  await page.evaluate(() => {
    window.translateCalls = [];
    window.reviewTranslateStub = async (terms) => {
      window.translateCalls.push([...terms]);
      return new Map([
        ['Transformer', 'Transformer 变换器（自注意力架构）'],
        ['BLEU', 'BLEU（双语评估替补指标）'],
      ]);
    };
  });
  await openReview();

  // The control exists only when a translator is wired up, and it starts off: it spends tokens.
  assert.equal(
    await page.locator('#knowledge-graph-review-translate-field').evaluate((element) => element.hidden),
    false,
    'the gloss control is available',
  );
  assert.equal(await page.locator('#knowledge-graph-review-translate').isChecked(), false);
  assert.equal(await page.locator('.knowledge-graph-review-translation').count(), 0);

  await page.locator('#knowledge-graph-review-translate').check({ timeout: 5_000 });
  // Explicit timeout: a busy machine once made this wait burn the default 30s and report a timeout
  // instead of which state it was stuck in.
  await page.waitForSelector('.knowledge-graph-review-translation', { timeout: 10_000 });

  // One request, for the rows on screen only: the hidden low-confidence row is not paid for.
  assert.deepEqual(
    await page.evaluate(() => window.translateCalls),
    [['Transformer', 'BLEU']],
    'a single request covers the visible candidates',
  );

  const glosses = await page.evaluate(() => [...document.querySelectorAll(
    '.knowledge-graph-review-row',
  )].map((row) => ({
    name: row.querySelector('.knowledge-graph-review-name').value,
    gloss: row.querySelector('.knowledge-graph-review-translation')?.textContent ?? '',
    // The gloss belongs to the row body, right under the name — not to the actions column.
    inBody: Boolean(row.querySelector('.knowledge-graph-review-row-body .knowledge-graph-review-translation')),
  })));
  assert.equal(glosses.length, 2);
  assert.deepEqual(
    glosses.map((row) => row.name),
    ['Transformer', 'BLEU'],
    'the extracted names are untouched: a gloss is not a rename',
  );
  assert.deepEqual(glosses.map((row) => row.gloss), [
    'Transformer 变换器（自注意力架构）',
    'BLEU（双语评估替补指标）',
  ]);
  assert.ok(glosses.every((row) => row.inBody), 'the gloss sits under the name it explains');

  // Turning it off hides the glosses but keeps the names and the selection as they were.
  await page.locator('#knowledge-graph-review-translate').uncheck();
  assert.equal(await page.locator('.knowledge-graph-review-translation').count(), 0);
  assert.equal(
    await page.evaluate(() => document.querySelector('.knowledge-graph-review-name').value),
    'Transformer',
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
  await page.evaluate(() => { window.reviewTranslateStub = null; });
});

test('a failed translation is reported in the row instead of blocking the dialog', async () => {
  await page.evaluate(() => {
    window.reviewTranslateStub = async () => {
      throw new Error('模型服务超时');
    };
  });
  await openReview();
  await page.locator('#knowledge-graph-review-translate').check();
  await page.waitForFunction(() => document.querySelectorAll(
    '.knowledge-graph-review-translation.is-error',
  ).length > 0);

  assert.match(
    await page.locator('.knowledge-graph-review-translation.is-error').first().textContent(),
    /翻译失败：模型服务超时/,
    'the reason is shown where the gloss would have been',
  );
  // The review itself is still usable: the failure of a reading aid must not take the dialog with it.
  assert.equal(await page.locator('#knowledge-graph-review-confirm').isDisabled(), false);
  assert.match(
    await page.locator('#knowledge-graph-review-selection').textContent(),
    /已选 2 \/ 3/,
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
  await page.evaluate(() => { window.reviewTranslateStub = null; });
});

test('aliases are shown, and a suggested synonym can be merged by renaming the row', async () => {
  // The user's own case: the same thing extracted under two names. The alias the paper declared has
  // to be visible on the row it belongs to, and a synonym suggestion must be *actionable* without
  // inventing a second merge path — the action renames the row, which is what folds the two together.
  await page.evaluate(() => {
    window.reviewRowsOverride = [
      { entityId: 'e-long', name: 'Boyar-Peralta heuristic', normalizedName: 'boyarperaltaheuristic',
        type: 'Method', confidence: 0.98, aliases: ['BP heuristic'], paperId: 'p1', preChecked: true,
        evidence: [{ paperId: 'p1', pageNumber: 1, quote: 'the Boyar-Peralta ( BP ) heuristic' }] },
      { entityId: 'e-short', name: 'BP heuristic', normalizedName: 'bpheuristic',
        type: 'Method', confidence: 0.95, aliases: [], paperId: 'p1', preChecked: true,
        evidence: [{ paperId: 'p1', pageNumber: 4, quote: 'it beats BP on matrices' }] },
    ];
    window.synonymCalls = [];
    window.reviewSynonymStub = async (terms) => {
      window.synonymCalls.push([...terms]);
      return new Map([['BP heuristic', 'Boyar-Peralta heuristic']]);
    };
  });
  await openReview();

  // The paper's other name is on the row that owns it.
  assert.match(
    await page.locator('.knowledge-graph-review-aliases').first().textContent(),
    /别名：BP heuristic/,
  );

  // Without a checker there is no control; with one it appears, unticked (it spends tokens).
  assert.equal(
    await page.locator('#knowledge-graph-review-synonym-field').evaluate((element) => element.hidden),
    false,
  );
  assert.equal(await page.locator('#knowledge-graph-review-synonym').isChecked(), false);
  assert.equal(await page.locator('.knowledge-graph-review-synonym').count(), 0);

  await page.locator('#knowledge-graph-review-synonym').check({ timeout: 5_000 });
  await page.waitForSelector('.knowledge-graph-review-synonym .knowledge-graph-review-synonym-apply', {
    timeout: 10_000,
  });

  assert.deepEqual(
    await page.evaluate(() => window.synonymCalls),
    [['Boyar-Peralta heuristic', 'BP heuristic']],
    'one request for the names on screen',
  );
  const hint = await page.locator('.knowledge-graph-review-synonym').first().textContent();
  assert.match(hint, /疑似与「Boyar-Peralta heuristic」是同一概念/);

  // Acting on the suggestion renames the row and keeps the old spelling as an alias — the same two
  // edits the user would have made by hand.
  await page.locator('.knowledge-graph-review-synonym-apply').first().click();
  const renamed = await page.evaluate(() => [...document.querySelectorAll(
    '.knowledge-graph-review-row',
  )].map((row) => ({
    name: row.querySelector('.knowledge-graph-review-name').value,
    aliases: row.querySelector('.knowledge-graph-review-aliases')?.textContent ?? '',
    dirty: row.hasAttribute('data-dirty'),
  })));
  assert.deepEqual(
    renamed.map((row) => row.name),
    ['Boyar-Peralta heuristic', 'Boyar-Peralta heuristic'],
    'both rows now carry the canonical name, which is what merges them on confirm',
  );
  assert.match(renamed[1].aliases, /BP heuristic/, 'the discarded spelling survives as an alias');
  assert.equal(renamed[1].dirty, true, 'and the row is marked as hand-corrected');

  // The confirmation payload is what the module collapses: two candidates, one name.
  await page.locator('#knowledge-graph-review-confirm').click();
  await waitForClosed('#knowledge-graph-review-dialog');
  const candidates = await page.evaluate(() => window.confirmCalls.flatMap((call) => call.candidates));
  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ['Boyar-Peralta heuristic', 'Boyar-Peralta heuristic'],
  );
  assert.deepEqual(
    candidates[1].aliases,
    ['BP heuristic'],
    'the alias travels with the confirmation, so the record keeps the paper’s spelling',
  );

  await page.evaluate(() => {
    window.reviewRowsOverride = null;
    window.reviewSynonymStub = null;
  });
});

test('a failure while opening the review dialog resolves the caller instead of hanging it', async () => {
  // This dialog's promise only settles on close, so an exception on the open path used
  // to leave the awaiting action pending forever — the button would look dead and the
  // failure would be invisible.
  const outcome = await page.evaluate(async () => {
    const original = window.moduleStub.loadPendingReview;
    window.moduleStub.loadPendingReview = async () => {
      throw new Error('读取候选实体失败');
    };
    window.shownErrors.length = 0;
    const result = await Promise.race([
      window.review.openEntityReviewDialog(),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 800)),
    ]);
    window.moduleStub.loadPendingReview = original;
    return {
      result,
      errors: window.shownErrors.map((entry) => entry.message),
      dialogOpen: document.getElementById('knowledge-graph-review-dialog').open,
    };
  });

  assert.equal(outcome.result, null, 'the caller must be resolved, not left pending');
  assert.deepEqual(outcome.errors, ['读取候选实体失败'], 'and be told what went wrong');
  assert.equal(outcome.dialogOpen, false, 'a dialog that failed to populate stays closed');
});

test('every dialog id exists in the real overlay template', async () => {
  const missing = await page.evaluate(
    ([reviewIds, mergeIds, metricsIds, conflictIds, relationIds, papersIds]) => [
      ...reviewIds, ...mergeIds, ...metricsIds, ...conflictIds, ...relationIds, ...papersIds,
    ].filter((id) => !document.getElementById(id)),
    [REVIEW_IDS, MERGE_IDS, METRICS_IDS, CONFLICT_IDS, RELATION_IDS, PAPERS_IDS],
  );
  assert.deepEqual(missing, [], 'template and element handles must not drift apart');
});

test('review dialog pre-checks only high-confidence candidates and hides the rest by default', async () => {
  await openReview();

  // The stub marks 0.95 and 0.8 as pre-checked (threshold 0.75) and 0.4 as not.
  assert.equal(
    await page.locator('#knowledge-graph-review-groups input[type="checkbox"]').count(),
    2,
    'low-confidence candidates are hidden by default',
  );
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll(
      '#knowledge-graph-review-groups input[type="checkbox"]',
    )].map((box) => ({ checked: box.checked, label: box.getAttribute('aria-label') }))),
    [
      { checked: true, label: '确认 Transformer' },
      { checked: true, label: '确认 BLEU' },
    ],
    'exactly the pre-checked candidates are ticked',
  );

  // The readout counts every row including the hidden one, so the user knows they
  // are not looking at the whole set.
  assert.match(
    await page.locator('#knowledge-graph-review-selection').textContent(),
    /已选 2 \/ 3/,
  );

  // Revealing low confidence must show them, still unticked.
  await page.locator('#knowledge-graph-review-show-low').check();
  assert.equal(
    await page.locator('#knowledge-graph-review-groups input[type="checkbox"]').count(),
    3,
  );
  assert.equal(
    await page.evaluate(() => [...document.querySelectorAll(
      '#knowledge-graph-review-groups input[type="checkbox"]',
    )].find((box) => box.getAttribute('aria-label') === '确认 Obscure Trick')?.checked),
    false,
    'a revealed low-confidence row stays unticked',
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('select-all, per-group select and edits reach the confirm payload', async () => {
  await openReview();

  await page.locator('#knowledge-graph-review-select-all').click();
  assert.match(await page.locator('#knowledge-graph-review-selection').textContent(), /已选 3 \/ 3/);
  await page.locator('#knowledge-graph-review-select-none').click();
  assert.match(await page.locator('#knowledge-graph-review-selection').textContent(), /已选 0 \/ 3/);

  // Select the Method group only (its first action button is "全选"). With
  // low-confidence rows hidden, the Method group contains exactly one visible row,
  // so this is expected to select one candidate, not two.
  await page.evaluate(() => {
    const group = [...document.querySelectorAll('.knowledge-graph-review-group')]
      .find((section) => section.querySelector('h3').textContent.startsWith('Method'));
    group.querySelectorAll('button')[0].click();
  });
  assert.match(
    await page.locator('#knowledge-graph-review-selection').textContent(),
    /已选 1 \/ 3/,
    'a group action applies to the rows the user can see',
  );

  // Rename the first row and retype it; both must reach the confirm call.
  const nameInput = page.locator('#knowledge-graph-review-groups input[type="text"]').first();
  await nameInput.fill('Transformer XL');
  await nameInput.blur();
  await page.evaluate(() => {
    const select = document.querySelector('#knowledge-graph-review-groups select');
    select.value = 'Concept';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  assert.ok(
    await page.locator('.knowledge-graph-review-row[data-dirty]').count() > 0,
    'a hand-corrected row must be visibly marked',
  );

  await page.locator('#knowledge-graph-review-confirm').click();
  await waitForClosed('#knowledge-graph-review-dialog');

  const calls = await page.evaluate(() => window.confirmCalls);
  const allCandidates = calls.flatMap((call) => call.candidates);
  assert.equal(
    allCandidates.length,
    1,
    `exactly the visible Method row is confirmed; got ${JSON.stringify(allCandidates.map((c) => c.name))}`,
  );
  const edited = allCandidates.find((candidate) => candidate.name === 'Transformer XL');
  assert.ok(edited, 'the edited name must be sent, not the original');
  assert.equal(edited.type, 'Concept', 'the edited type must be sent');
  // Candidates are grouped per paper, because the plan is built per paper.
  assert.ok(calls.every((call) => call.paperId === 'p1'), 'only the Method group was selected');
  assert.equal(calls[0].options.edgeType, 'MENTIONS');
});

test('confirming asks for a meaning for exactly the names that entered the graph', async () => {
  // The user asked for the gloss at the moment a candidate becomes part of the graph — and only then:
  // batch extraction proposes dozens of names nobody has accepted, and paying to explain all of them
  // would be paying for text nobody asked to read.
  await openReview();
  assert.equal(
    (await page.evaluate(() => window.explainCalls)).length,
    0,
    'opening the dialog must not generate anything',
  );

  await page.locator('#knowledge-graph-review-select-all').click();
  await page.locator('#knowledge-graph-review-confirm').click();
  await waitForClosed('#knowledge-graph-review-dialog');

  const calls = await page.evaluate(() => window.explainCalls);
  assert.equal(calls.length, 1, 'one batch for the whole confirmation');
  // Select-all covers every row, including the low-confidence one the dialog hides by default, so the
  // three confirmed names are exactly what must be asked about — no more (nothing unconfirmed) and no
  // fewer (the low-confidence row was confirmed too).
  const confirmedNames = await page.evaluate(
    () => window.confirmCalls.flatMap((call) => call.candidates.map((candidate) => candidate.name)),
  );
  assert.deepEqual(
    [...calls[0]].sort(),
    [...confirmedNames].sort(),
    `the requested names must be the confirmed ones; got ${JSON.stringify(calls[0])} `
      + `for ${JSON.stringify(confirmedNames)}`,
  );
  assert.equal(confirmedNames.length, 3, 'sanity: select-all confirmed all three rows');
});

test('dismissing the dialog explains nothing', async () => {
  await openReview();
  await page.locator('#knowledge-graph-review-select-all').click();
  await page.keyboard.press('Escape');
  await waitForClosed('#knowledge-graph-review-dialog');
  assert.equal(
    (await page.evaluate(() => window.explainCalls)).length,
    0,
    'a dismissed dialog confirms nothing, so there is nothing to explain',
  );
});

test('"never ask again" records the ignored name and removes the row', async () => {
  await openReview();
  await page.locator('#knowledge-graph-review-show-low').check();

  // Ticking the show-low box re-renders; the low-confidence row appears only then.
  await page.locator('#knowledge-graph-review-show-low').check();
  await page.waitForSelector('.knowledge-graph-review-row >> nth=2', { timeout: 5000 });
  assert.equal(
    await page.locator('.knowledge-graph-review-row').count(),
    3,
    'revealing low-confidence candidates must add their rows',
  );
  // The entity name lives in an `<input value>`, which `textContent` does not
  // include, so the low-confidence row is identified by its evidence quote.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.knowledge-graph-review-row')]
      .find((item) => item.textContent.includes('a minor trick'));
    if (!row) {
      throw new Error(`row not found; rows are: ${JSON.stringify(
        [...document.querySelectorAll('.knowledge-graph-review-row')]
          .map((item) => item.textContent.replace(/\s+/g, ' ').slice(0, 80)),
      )}`);
    }
    [...row.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === '不再提示')
      .click();
  });
  await page.waitForFunction(() => window.dismissCalls.length === 1);
  assert.deepEqual(
    await page.evaluate(() => window.dismissCalls),
    [{ entityIds: ['e-low'], remember: true }],
    'the name is written to the ignore list through the dismissal call',
  );
  // "Never ask again" removes the row: keeping it on screen was what made the button look broken.
  await page.waitForFunction(() => document.querySelectorAll('.knowledge-graph-review-row').length === 2);
  assert.equal(
    await page.evaluate(() => [...document.querySelectorAll('.knowledge-graph-review-row')]
      .some((item) => item.textContent.includes('a minor trick'))),
    false,
    'the ignored candidate must leave the list',
  );

  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('dismissing with Escape resolves the caller instead of hanging it', async () => {
  // This is the failure that only appears by pressing Escape: a per-button resolve
  // leaves the awaiting caller pending forever.
  const resolved = await page.evaluate(async () => {
    const promise = window.review.openEntityReviewDialog();
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.getElementById('knowledge-graph-review-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
    return Promise.race([
      promise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);
  });
  assert.equal(resolved, 'resolved', 'Escape must resolve the open promise');
  assert.equal(
    await page.locator('#knowledge-graph-review-dialog').evaluate((dialog) => dialog.open),
    false,
  );
});

test('merge dialog groups by survivor, marks tentative rows, and applies in order', async () => {
  await page.evaluate(() => { window.merge.openEntityMergeDialog(); });
  await page.waitForSelector('#knowledge-graph-merge-dialog[open]');
  await page.waitForSelector('#knowledge-graph-merge-groups input', { timeout: 5000 });

  // One group: both misspellings point at the same survivor.
  assert.equal(
    await page.locator('.knowledge-graph-merge-dialog .knowledge-graph-review-group').count(),
    1,
  );
  assert.equal(
    await page.locator('.knowledge-graph-merge-dialog .knowledge-graph-review-row').count(),
    2,
  );
  const summary = await page.locator('#knowledge-graph-merge-summary').textContent();
  assert.match(summary, /1 组已默认勾选/);
  assert.match(summary, /2 个已合并实体不参与/, 'excluded tombstones are reported, not hidden');

  // Exactly the auto-selectable row starts ticked; the derived 1.0 row does not.
  const rows = await page.evaluate(() => [...document.querySelectorAll(
    '.knowledge-graph-merge-dialog .knowledge-graph-review-row',
  )].map((row) => ({
    checked: row.querySelector('input[type="checkbox"]').checked,
    tentative: row.hasAttribute('data-tentative'),
    text: row.textContent,
  })));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.checked).length, 1, 'only the direct pair is pre-ticked');
  const derived = rows.find((row) => row.text.includes('Graph Convolutional Networks'));
  assert.ok(derived, 'the transitively-linked member must be offered');
  assert.equal(derived.checked, false, 'a derived row must not be pre-ticked');
  assert.equal(derived.tentative, true, 'a derived row must be visibly tentative');

  // Select both and apply: both merges must be issued in one pass.
  await page.evaluate(() => {
    for (const box of document.querySelectorAll(
      '.knowledge-graph-merge-dialog input[type="checkbox"]',
    )) {
      if (!box.checked) box.click();
    }
  });
  await page.locator('#knowledge-graph-merge-apply').click();
  await waitForClosed('#knowledge-graph-merge-dialog');

  const mergeCalls = await page.evaluate(() => window.mergeCalls);
  assert.equal(mergeCalls.length, 2, 'both cluster members are merged in one pass');
  assert.ok(
    mergeCalls.every((call) => call.keepEntityId === 'keep'),
    'every merge must target the chosen survivor',
  );
  assert.deepEqual(
    mergeCalls.map((call) => call.mergeEntityId),
    ['m2', 'm1'],
    'applied highest-score first',
  );
});

test('a merge suggestion can be rejected, and the rejection is remembered', async () => {
  // Reported from real use: the dialog offered `s-XOR → b-XOR` (similarity 0.70, shared letters) with
  // no way to say "these are different things" — so the same wrong row came back every time.
  await page.evaluate(() => {
    window.mergeRejectCalls = [];
    window.mergeRejections = [];
  });
  await page.evaluate(() => { window.merge.openEntityMergeDialog(); });
  await page.waitForSelector('#knowledge-graph-merge-dialog[open]');
  await page.waitForSelector('.knowledge-graph-merge-dialog .knowledge-graph-review-row');
  assert.equal(
    await page.locator('.knowledge-graph-merge-dialog .knowledge-graph-review-row').count(),
    2,
    'both suggestions are offered',
  );
  assert.equal(
    await page.locator('#knowledge-graph-merge-restore').evaluate((element) => element.hidden),
    true,
    'no restore control when nothing was rejected',
  );

  await page.locator('.knowledge-graph-merge-dialog .knowledge-graph-review-row').first()
    .locator('button', { hasText: '不是同一实体' }).click();
  await page.waitForFunction(() => window.mergeRejectCalls.length === 1);
  assert.deepEqual(
    await page.evaluate(() => window.mergeRejectCalls),
    [{ left: 'keep', right: 'm1' }],
    'the pair is written, in the order the row showed it',
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.knowledge-graph-merge-dialog .knowledge-graph-review-row').length === 1,
  );
  assert.match(
    await page.locator('#knowledge-graph-merge-selection').textContent(),
    /已拒绝 1 条建议/,
    'and the count is visible rather than silent',
  );
  assert.match(
    await page.locator('#knowledge-graph-merge-summary').textContent(),
    /已按你的判断排除 1 条/,
  );

  // The restore control is the only way back from a mis-click.
  await page.locator('#knowledge-graph-merge-restore').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.knowledge-graph-merge-dialog .knowledge-graph-review-row').length === 2,
  );
  assert.equal(await page.evaluate(() => window.mergeRejections.length), 0);

  await page.locator('#knowledge-graph-merge-later').click();
  await waitForClosed('#knowledge-graph-merge-dialog');
  await page.evaluate(() => { window.mergeRejections = []; });
});

test('an empty review disables confirm rather than offering a dead action', async () => {
  await page.evaluate(() => {
    window.moduleStub.loadPendingReview = async () => ({ total: 0, preChecked: 0, groups: [] });
  });
  await page.evaluate(() => { window.review.openEntityReviewDialog(); });
  await page.waitForSelector('#knowledge-graph-review-dialog[open]');
  assert.equal(
    await page.locator('#knowledge-graph-review-confirm').isDisabled(),
    true,
    'confirm must be disabled when there is nothing to confirm',
  );
  await page.locator('#knowledge-graph-review-later').click();
  await waitForClosed('#knowledge-graph-review-dialog');
});

test('statistics dialog reports an undefined rate as 「—」 instead of 0%', async () => {
  await openMetrics({ papers: [], entities: [], edges: [] });

  const numbers = await page
    .locator('.knowledge-graph-metrics-numbers .knowledge-graph-metrics-row')
    .allTextContents();
  const text = numbers.join('\n');
  assert.match(text, /候选采纳率：—/, 'no decisions yet is not a rate of zero');
  // The real failure this guards against: an empty graph reporting "采纳率 0%",
  // which reads as a measured failure rather than an absence of data.
  assert.ok(!text.includes('0%'), `an undefined rate must not read as 0%: ${text}`);
  assert.match(
    await page.locator('#knowledge-graph-metrics-note').textContent(),
    /不是 0%/,
    'the dash is explained rather than left for the user to guess',
  );
  assert.equal(
    await page.locator('#knowledge-graph-metrics-summary').textContent(),
    '暂无可统计的内容',
  );
  assert.equal(
    await page.locator('.knowledge-graph-metrics-advice').count(),
    0,
    'there is nothing to advise on an empty graph',
  );
  assert.match(
    await page.locator('#knowledge-graph-metrics-body .knowledge-graph-review-empty').textContent(),
    /图谱还是空的/,
    'an empty advice list must say why it is empty',
  );

  await page.locator('#knowledge-graph-metrics-done').click();
  await waitForClosed('#knowledge-graph-metrics-dialog');
});

test('statistics dialog reports measured rates and ties every suggestion to a number', async () => {
  const papers = [paperOf('p1'), paperOf('p2')];
  const entities = [
    entityOf('shared', 'confirmed', 'p1'),
    entityOf('other', 'confirmed', 'p2'),
    ...Array.from({ length: 8 }, (_, index) => entityOf(`noise-${index}`, 'rejected', 'p1')),
  ];
  const edges = [
    mentionsEdge('e1', 'p1', 'shared', 'we use a shared encoder'),
    mentionsEdge('e2', 'p2', 'shared', undefined),
    mentionsEdge('e3', 'p1', 'other', undefined),
  ];

  await openMetrics({ papers, entities, edges });

  const text = (await page
    .locator('.knowledge-graph-metrics-numbers .knowledge-graph-metrics-row')
    .allTextContents()).join('\n');
  // 2 confirmed of 10 decided, 1 of 10 entities shared by two papers, 1 of 3 edges
  // carrying a quote.
  assert.match(text, /候选采纳率：20%/, text);
  assert.match(text, /实体复用率：10%/, text);
  assert.match(text, /有原文证据 1（33%）/, text);
  assert.equal(
    await page.locator('#knowledge-graph-metrics-note').textContent(),
    '',
    'nothing is undefined here, so there is nothing to explain',
  );
  assert.match(await page.locator('#knowledge-graph-metrics-summary').textContent(), /2 篇文献/);

  const advice = await page
    .locator('.knowledge-graph-metrics-advice .knowledge-graph-metrics-row')
    .allTextContents();
  assert.ok(advice.length >= 2, `expected advice for a noisy graph; got ${JSON.stringify(advice)}`);
  assert.ok(
    advice.some((line) => line.includes('采纳率') && line.includes('候选上限')),
    'the adoption advice must name a concrete lever, not just observe the problem',
  );
  assert.ok(
    advice.some((line) => line.includes('证据')),
    'the weak evidence rate must be called out too',
  );

  await page.locator('#knowledge-graph-metrics-copy').click();
  await page.waitForFunction(() => window.copiedText.length > 0);
  const copied = await page.evaluate(() => window.copiedText);
  assert.match(copied, /候选采纳率：20%/);
  assert.match(copied, /建议：/);
  // `isError` is read separately because an undefined value does not survive the
  // round trip out of the page.
  assert.equal(
    await page.evaluate(() => window.statuses.at(-1).message),
    '已复制统计报告。',
  );
  assert.ok(await page.evaluate(() => !window.statuses.at(-1).isError), 'copying is not an error');

  // Escape must dismiss it: a report dialog with no way out that the user
  // believes in is worse than no dialog.
  await page.evaluate(() => {
    document.getElementById('knowledge-graph-metrics-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await waitForClosed('#knowledge-graph-metrics-dialog');
});

test('conflict dialog marks the retiring verdict and sends only the pairs the user overrode', async () => {
  // The fixtures go through the real detector, so the dialog is opened with the
  // exact shape the module produces rather than a hand-written imitation of it.
  const opened = await page.evaluate(() => {
    const edge = (id, type, overrides = {}) => ({
      edgeId: id,
      source: 'p1',
      sourceKind: 'paper',
      target: 'p2',
      targetKind: 'paper',
      type,
      confidence: 0.8,
      evidence: [],
      sourcePaperId: 'p1',
      origin: 'ai',
      originKey: `${type}|p1|p2`,
      provenance: {},
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    });
    const conflicts = window.moduleStub.findRelationConflicts([
      edge('extends', 'EXTENDS', {
        evidence: [{ paperId: 'p1', pageNumber: 4, quote: 'we extend the encoder' }],
        provenance: { model: 'deepseek-chat', judgedAt: 1700000000000 },
      }),
      edge('similar', 'SIMILAR_TO'),
      edge('cites', 'CITES', { target: 'p3', originKey: 'CITES|p1|p3' }),
      edge('improves', 'IMPROVES', { target: 'p3', originKey: 'IMPROVES|p1|p3' }),
    ]);

    window.appliedSelections = [];
    window.conflictResult = 'pending';
    window.openConflicts = (list) => {
      window.conflictResult = 'pending';
      window.conflicts.openConflictDialog({
        conflicts: list,
        paperTitles: new Map([
          ['p1', 'Attention Is All You Need'],
          ['p2', 'BERT'],
          ['p3', 'GPT-3'],
        ]),
        apply: async (selections) => {
          window.appliedSelections.push([...selections.entries()]);
          return { pairs: 2, edgesWritten: 2, retiredKeys: 2, staleSelections: [] };
        },
      }).then((result) => { window.conflictResult = result; });
    };
    window.conflictFixtures = conflicts;
    window.openConflicts(conflicts);

    return {
      count: conflicts.length,
      survivors: conflicts.map((conflict) => conflict.survivor.edgeId),
    };
  });

  assert.equal(opened.count, 2);
  assert.deepEqual(
    opened.survivors,
    ['extends', 'improves'],
    'EXTENDS outranks SIMILAR_TO and IMPROVES outranks CITES',
  );

  await page.waitForSelector('#knowledge-graph-conflict-dialog[open]');
  assert.match(
    await page.locator('#knowledge-graph-conflict-summary').textContent(),
    /2 组矛盾结论/,
  );
  assert.equal(await page.locator('.knowledge-graph-conflict-group').count(), 2);
  // Papers are named, not shown as ids: the user is deciding about two documents.
  assert.match(
    await page.locator('.knowledge-graph-conflict-group h3').first().textContent(),
    /Attention Is All You Need ↔ BERT/,
  );

  const firstGroup = await page.evaluate(() => [...document.querySelectorAll(
    '.knowledge-graph-conflict-group',
  )[0].querySelectorAll('.knowledge-graph-conflict-row')].map((row) => ({
    keeps: row.hasAttribute('data-keeps'),
    retires: row.hasAttribute('data-retires'),
    checked: row.querySelector('input[type="radio"]').checked,
    type: row.querySelector('.knowledge-graph-conflict-type').textContent,
    badge: row.querySelector('.knowledge-graph-conflict-badge').textContent,
    recommended: Boolean(row.querySelector('.knowledge-graph-conflict-recommended')),
    text: row.textContent,
  })));

  // Strongest verdict first, with the recommendation marked as such — the user
  // must be able to tell a default from their own choice.
  assert.deepEqual(firstGroup.map((row) => row.type), ['扩展（EXTENDS）', '相似（SIMILAR_TO）']);
  assert.deepEqual(firstGroup.map((row) => row.keeps), [true, false]);
  assert.deepEqual(firstGroup.map((row) => row.retires), [false, true]);
  assert.deepEqual(firstGroup.map((row) => row.badge), ['保留', '将退役']);
  assert.deepEqual(firstGroup.map((row) => row.checked), [true, false]);
  assert.deepEqual(firstGroup.map((row) => row.recommended), [true, false]);
  // Evidence and provenance travel with the verdict: the user is choosing between
  // claims, and a claim without its source is not something to choose between.
  assert.match(firstGroup[0].text, /we extend the encoder/);
  assert.match(firstGroup[0].text, /deepseek-chat/);

  // The recommendation is not a user decision, so nothing is reported as overridden.
  assert.match(
    await page.locator('#knowledge-graph-conflict-selection').textContent(),
    /其中 0 组改为你的选择/,
  );

  await page.locator('.knowledge-graph-conflict-group').first()
    .locator('input[type="radio"]').nth(1).check();
  assert.match(
    await page.locator('#knowledge-graph-conflict-selection').textContent(),
    /其中 1 组改为你的选择/,
  );

  await page.locator('#knowledge-graph-conflict-apply').click();
  await waitForClosed('#knowledge-graph-conflict-dialog');

  // Only the overridden pair counts as the user's decision. Sending the
  // recommendation as a selection would record `resolvedBy: 'user'` for a choice
  // the ranking made, which is a lie the record would keep forever.
  assert.deepEqual(
    await page.evaluate(() => window.appliedSelections),
    [[['p1|p2', 'similar']]],
    'exactly the overridden pair is sent',
  );
  assert.deepEqual(
    await page.evaluate(() => window.conflictResult),
    { pairs: 2, edgesWritten: 2, retiredKeys: 2, staleSelections: [] },
  );

  // Escape must resolve the caller (the action awaits it) and must apply nothing.
  await page.evaluate(() => { window.openConflicts(window.conflictFixtures); });
  await page.waitForSelector('#knowledge-graph-conflict-dialog[open]');
  await page.evaluate(() => {
    document.getElementById('knowledge-graph-conflict-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await waitForClosed('#knowledge-graph-conflict-dialog');
  assert.equal(await page.evaluate(() => window.conflictResult), null);
  assert.equal(await page.evaluate(() => window.appliedSelections.length), 1, 'dismissing writes nothing');

  // Nothing to resolve: the apply button is disabled rather than offering a dead
  // action, and the dialog says so.
  await page.evaluate(() => { window.openConflicts([]); });
  await page.waitForSelector('#knowledge-graph-conflict-dialog[open]');
  assert.equal(await page.locator('#knowledge-graph-conflict-apply').isDisabled(), true);
  assert.match(
    await page.locator('#knowledge-graph-conflict-groups').textContent(),
    /没有发现互相矛盾的结论/,
  );
  await page.locator('#knowledge-graph-conflict-later').click();
  await waitForClosed('#knowledge-graph-conflict-dialog');
});

test('relation review starts fully accepted, drops individual pairs, and declining writes nothing', async () => {
  const rows = [
    { pairKey: 'p1|p2', leftPaperId: 'p1', rightPaperId: 'p2',
      verdict: 'EXTENDS', confidence: 0.92, evidenceQuote: 'we extend the encoder',
      rationale: '相同任务上的扩展' },
    { pairKey: 'p1|p3', leftPaperId: 'p1', rightPaperId: 'p3',
      verdict: 'CITES', confidence: 0.7, evidenceQuote: '', rationale: '' },
    { pairKey: 'p2|p3', leftPaperId: 'p2', rightPaperId: 'p3',
      verdict: 'NONE', confidence: 0, evidenceQuote: '', rationale: '领域不同' },
  ];
  const opened = await page.evaluate((reviewRows) => {
    window.reviewResult = 'pending';
    window.openRelationReview = (list, rejectedCount) => {
      window.reviewResult = 'pending';
      window.relationReview.openRelationReviewDialog({
        rows: list,
        paperTitles: new Map([['p1', 'Attention Is All You Need'], ['p2', 'BERT'], ['p3', 'GPT-3']]),
        model: 'deepseek-chat',
        rejectedCount,
      }).then((accepted) => {
        window.reviewResult = accepted ? [...accepted] : null;
      });
    };
    window.openRelationReview(reviewRows, 1);
    return reviewRows.length;
  }, rows);
  assert.equal(opened, 3);

  await page.waitForSelector('#knowledge-graph-relation-dialog[open]');
  // The summary names the model and accounts for verdicts that could not be parsed,
  // so the numbers the user sees add up.
  const summary = await page.locator('#knowledge-graph-relation-summary').textContent();
  assert.match(summary, /3 条结论待确认/);
  assert.match(summary, /deepseek-chat/);
  assert.match(summary, /1 条无法解析/);

  // Everything starts accepted: the model's output is what the user paid for, so the
  // common case must not be the slow one.
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll(
      '#knowledge-graph-relation-groups input[type="checkbox"]',
    )].map((box) => box.checked)),
    [true, true, true],
  );
  assert.match(await page.locator('#knowledge-graph-relation-selection').textContent(), /已选 3 \/ 3/);
  assert.match(await page.locator('#knowledge-graph-relation-write').textContent(), /写入所选（3）/);

  const rendered = await page.evaluate(() => [...document.querySelectorAll(
    '#knowledge-graph-relation-groups .knowledge-graph-review-row',
  )].map((row) => ({
    negative: row.hasAttribute('data-negative'),
    verdict: row.querySelector('.knowledge-graph-relation-verdict').textContent,
    text: row.textContent,
  })));
  assert.deepEqual(rendered.map((row) => row.negative), [false, false, true]);
  assert.equal(rendered[0].verdict, '扩展（EXTENDS）');
  assert.equal(rendered[2].verdict, '无关（不建立关系）');
  // A verdict with no quoted evidence says so, rather than looking like it has one.
  assert.match(rendered[1].text, /没有给出原文引文/);
  // A negative verdict is cache-forming but invisible on the canvas, so what
  // accepting it means has to be stated.
  assert.match(rendered[2].text, /避免下次重复消耗 Token/);
  assert.match(rendered[0].text, /we extend the encoder/);

  // Dropping one pair leaves the rest accepted.
  await page.locator('#knowledge-graph-relation-groups input[type="checkbox"]').nth(1).uncheck();
  assert.match(await page.locator('#knowledge-graph-relation-selection').textContent(), /已选 2 \/ 3/);
  await page.locator('#knowledge-graph-relation-write').click();
  await waitForClosed('#knowledge-graph-relation-dialog');
  assert.deepEqual(
    await page.evaluate(() => window.reviewResult),
    ['p1|p2', 'p2|p3'],
    'the accepted set is exactly what remains ticked',
  );

  // Unticking everything disables the write action rather than offering a dead click;
  // "write nothing" has its own button.
  await page.evaluate((reviewRows) => { window.openRelationReview(reviewRows, 0); }, rows);
  await page.waitForSelector('#knowledge-graph-relation-dialog[open]');
  await page.locator('#knowledge-graph-relation-select-none').click();
  assert.equal(await page.locator('#knowledge-graph-relation-write').isDisabled(), true);
  assert.match(await page.locator('#knowledge-graph-relation-selection').textContent(), /已选 0 \/ 3/);
  await page.locator('#knowledge-graph-relation-select-all').click();
  assert.match(await page.locator('#knowledge-graph-relation-selection').textContent(), /已选 3 \/ 3/);

  // Declining returns null, which the runner treats as "decline to write" rather
  // than "accept everything on the user's behalf".
  await page.locator('#knowledge-graph-relation-discard').click();
  await waitForClosed('#knowledge-graph-relation-dialog');
  assert.equal(await page.evaluate(() => window.reviewResult), null);

  // Escape is the same decline, and must resolve the awaiting runner.
  await page.evaluate((reviewRows) => { window.openRelationReview(reviewRows, 0); }, rows);
  await page.waitForSelector('#knowledge-graph-relation-dialog[open]');
  await page.evaluate(() => {
    document.getElementById('knowledge-graph-relation-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await waitForClosed('#knowledge-graph-relation-dialog');
  assert.equal(await page.evaluate(() => window.reviewResult), null);
});

test('the papers dialog reports every knowledge-base paper and offers no way to delete one', async () => {
  // Two separate reasons this dialog exists, and both are visible in the markup:
  //
  // 1. A paper with no relations has no node on the canvas, so the list is the only surface
  //    that can tell the user it is in the graph and contributes nothing.
  // 2. It is **read-only**. The graph projects the knowledge base, so deleting lives there;
  //    a delete button here would be a second, contradictory answer to "is this paper in the
  //    graph?" — which is exactly the state this whole change removed.
  await page.evaluate(() => {
    window.libraryOpens = 0;
    window.papers.openPapersDialog({
      papers: [
        { paperId: 'p1', title: 'Attention Is All You Need', indexStatus: 'ready' },
        { paperId: 'p2', title: 'BERT', indexStatus: 'error', indexError: '无法读取 PDF 数据' },
        { paperId: 'p3', title: 'GPT-3', indexStatus: 'indexing' },
      ],
      // Built in the page: a `Map` argument does not survive the crossing as a Map.
      relationCounts: new Map([['p1', 3]]),
      openKnowledgeBase() { window.libraryOpens += 1; },
    });
  });
  await page.waitForSelector('#knowledge-graph-papers-dialog[open]');
  await page.waitForSelector('.knowledge-graph-papers-row');

  assert.match(
    await page.locator('#knowledge-graph-papers-groups').textContent(),
    /知识库中的文献（3）/,
    'the section names the knowledge base as the source',
  );

  // The section heading is a `header`, and the shared `.app-confirm-dialog header` is a
  // three-column grid. A CJK heading fell into the 42px icon column and wrapped one character
  // per line; measured, because a vertical heading is a layout fact, not a wording one.
  const heading = await page.evaluate(() => {
    const element = document.querySelector(
      '#knowledge-graph-papers-groups .knowledge-graph-review-group-heading',
    );
    const title = element?.querySelector('h3');
    const titleRect = title?.getBoundingClientRect() ?? null;
    return {
      display: element ? getComputedStyle(element).display : null,
      title: (title?.textContent ?? '').trim(),
      titleWidth: titleRect ? Math.round(titleRect.width) : null,
      titleHeight: titleRect ? Math.round(titleRect.height) : null,
    };
  });
  assert.equal(heading.display, 'flex', 'a section heading lays out as a row, not the dialog grid');
  // A vertical CJK heading is tall and narrow; a horizontal one is wide and one line high. Both
  // numbers are measured, because "it looks wrong" is the only other signal available.
  assert.ok(
    heading.titleHeight < 26,
    `the heading must stay on one line; it is ${heading.titleHeight}px tall`,
  );
  assert.ok(
    heading.titleWidth > heading.titleHeight * 3,
    `the heading must run horizontally; got ${heading.titleWidth}×${heading.titleHeight} for "${heading.title}"`,
  );

  const rows = await page.evaluate(() => [...document.querySelectorAll(
    '.knowledge-graph-papers-row',
  )].map((row) => ({
    text: row.textContent,
    buttons: row.querySelectorAll('button').length,
  })));
  assert.equal(rows.length, 3);
  assert.match(rows[0].text, /3 条关系/);
  assert.match(
    rows[1].text,
    /还没有任何关系（所以画布上没有它的节点）/,
    'an unconnected paper must explain why it is invisible',
  );
  // Index state is shown when it is not ready: it is the reason extraction is unavailable,
  // and it is stored in the knowledge base, which the graph's own snapshot does not carry.
  assert.match(rows[1].text, /索引失败：无法读取 PDF 数据/);
  assert.match(rows[2].text, /正在建立索引/);
  assert.doesNotMatch(rows[0].text, /索引/, 'a ready document says nothing about indexing');
  assert.deepEqual(
    rows.map((row) => row.buttons),
    [0, 0, 0],
    'no row may offer a delete action: removing happens in the knowledge base',
  );

  assert.match(
    await page.locator('#knowledge-graph-papers-selection').textContent(),
    /3 篇在图谱中，其中 2 篇还没有任何关系/,
  );
  assert.match(
    await page.locator('#knowledge-graph-papers-summary').textContent(),
    /共 3 篇/,
  );
  assert.match(
    await page.locator('#knowledge-graph-papers-dialog .knowledge-graph-review-hint').textContent(),
    /只有点「添加到知识库」的 PDF 才会进入图谱/,
  );

  // The one action is a way to the place where deleting is legitimate — and it closes first,
  // because the knowledge base page replaces the workspace.
  await page.locator('#knowledge-graph-papers-library').click();
  assert.equal(await page.evaluate(() => window.libraryOpens), 1, 'the button opens the knowledge base');
  assert.equal(
    await page.locator('#knowledge-graph-papers-dialog').evaluate((dialog) => dialog.open),
    false,
    'the dialog closes before navigating away',
  );
});

test('the papers dialog explains an empty knowledge base instead of showing an empty list', async () => {
  await page.evaluate(() => {
    window.papers.openPapersDialog({
      papers: [],
      relationCounts: new Map(),
      openKnowledgeBase() { window.libraryOpens += 1; },
    });
  });
  await page.waitForSelector('#knowledge-graph-papers-dialog[open]');

  assert.match(
    await page.locator('#knowledge-graph-papers-groups').textContent(),
    /知识库还是空的：打开 PDF 后点「添加到知识库」，它才会进入图谱/,
  );
  assert.equal(
    await page.locator('#knowledge-graph-papers-summary').textContent(),
    '图谱里还没有文献',
  );
  assert.equal(await page.locator('.knowledge-graph-papers-row').count(), 0);

  // Escape closes without touching the knowledge base.
  await page.evaluate(() => {
    document.getElementById('knowledge-graph-papers-dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await waitForClosed('#knowledge-graph-papers-dialog');
  assert.equal(
    await page.evaluate(() => window.libraryOpens),
    1,
    'dismissing the dialog must not navigate anywhere new',
  );
});

console.log('Knowledge graph dialog browser tests passed.');
