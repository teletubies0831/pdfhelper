import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule, loadModuleClosure } from './support/module-closure.mjs';

/**
 * Rendering-budget tests for the graph canvas.
 *
 * The culling *rules* are covered by the contract test; this suite checks the
 * integration, which a contract test cannot see: that the real renderer, with a real
 * 2D context and a large model, narrows its frame, thins captions and refuses to
 * hit-test what the viewport does not show. A regression here is invisible
 * everywhere else — the canvas produces no observable output in a headless run,
 * which is why the renderer reports draw-call counts.
 *
 * The module barrel is stubbed (importing it would pull in the persistence
 * adapters) and the real geometry modules are grafted onto it, so the file under
 * test is the one that ships.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || 'msedge',
    headless: true,
  });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');

  const rendererCode = await loadModule(
    'src/viewer/features/knowledge-graph/graph-canvas-renderer.ts',
  );
  const themeCode = await loadModule('src/viewer/features/knowledge-graph/graph-theme.ts');
  // The culling entry pulls in the render-model module it is built on, so the walk
  // is what decides the closure rather than a hand-kept list.
  const closure = await loadModuleClosure(
    'src/modules/knowledge-graph/domain/graph-culling.ts',
  );
  // The PNG export plans its own geometry and then reuses the renderer, so the plan module is grafted onto the
  // stubbed barrel as well.
  const imagePlanCode = await loadModule(
    'src/modules/knowledge-graph/domain/graph-image-plan.ts',
  );

  await page.evaluate(([rendererSource, themeSource, modules, imagePlanSource]) => {
    const codeByPath = new Map(modules);
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

    // The barrel the renderer imports, with the real geometry implementations.
    const imagePlanModule = {};
    new Function('require', 'exports', imagePlanSource)(() => ({}), imagePlanModule);
    const barrel = {
      ...instantiate('src/modules/knowledge-graph/domain/graph-render-model.ts'),
      ...instantiate('src/modules/knowledge-graph/domain/graph-culling.ts'),
      ...imagePlanModule,
    };

    const themeModule = {};
    const build = (code, target) => {
      new Function('require', 'exports', code)((name) => {
        if (name.includes('knowledge-graph/public')) return barrel;
        if (name.includes('graph-theme')) return themeModule;
        throw new Error(`Unmocked dependency: ${name}`);
      }, target);
    };
    build(themeSource, themeModule);
    const rendererModule = {};
    build(rendererSource, rendererModule);

    window.graph = { barrel, theme: themeModule, ...rendererModule };
  }, [rendererCode, themeCode, closure, imagePlanCode]);
});

after(async () => { await browser?.close(); });

const GRID = { columns: 80, rows: 50, spacing: 60, leaves: 2000 };

/**
 * Builds a large model with the shape a real graph has: a connected core of papers
 * and hubs, plus a crowd of degree-1 leaves (keywords, single-use entities). The
 * leaves matter for the caption assertions — they are what thinning is for.
 *
 * Radii come from the real `radiusForDegree`, so "is this a hub" is decided by the
 * same curve that sizes the nodes in production.
 */
async function buildScene() {
  return page.evaluate((grid) => {
    const { radiusForDegree, PAPER_NODE_RADIUS, ENTITY_NODE_RADIUS } = window.graph.barrel;
    const body = document.body;
    body.style.margin = '0';
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    canvas.style.width = '900px';
    canvas.style.height = '600px';
    canvas.style.display = 'block';
    body.append(canvas);

    const nodeSpecs = [];
    const edgePairs = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const index = row * grid.columns + column;
        nodeSpecs.push({
          id: `n${index}`,
          kind: index % 7 === 0 ? 'paper' : 'entity',
          x: column * grid.spacing,
          y: row * grid.spacing,
        });
        if (column + 1 < grid.columns) edgePairs.push([`n${index}`, `n${index + 1}`]);
        if (row + 1 < grid.rows) edgePairs.push([`n${index}`, `n${index + grid.columns}`]);
      }
    }
    // One leaf per core node, the first `leaves` of them.
    for (let index = 0; index < grid.leaves; index += 1) {
      const leafId = `leaf${index}`;
      const owner = `n${index}`;
      const ownerSpec = nodeSpecs[index];
      nodeSpecs.push({
        id: leafId,
        kind: 'entity',
        x: ownerSpec.x + 22,
        y: ownerSpec.y - 22,
      });
      edgePairs.push([owner, leafId]);
    }
    // Two edges spanning the grid corner to corner, plus the leaves' owners.
    edgePairs.push(['n0', `n${grid.rows * grid.columns - 1}`]);
    edgePairs.push([`n${grid.columns - 1}`, `n${(grid.rows - 1) * grid.columns}`]);

    const degree = new Map();
    for (const [source, target] of edgePairs) {
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }

    const nodes = nodeSpecs.map((spec) => {
      const base = spec.kind === 'paper' ? PAPER_NODE_RADIUS : ENTITY_NODE_RADIUS;
      return {
        id: spec.id,
        kind: spec.kind,
        label: `Node ${spec.id}`,
        x: spec.x,
        y: spec.y,
        radius: radiusForDegree(base, degree.get(spec.id) ?? 0),
        confidence: 0.8,
      };
    });

    const edges = edgePairs.map(([sourceId, targetId]) => ({
      edge: {
        edgeId: `${sourceId}->${targetId}`,
        source: sourceId,
        sourceKind: 'paper',
        target: targetId,
        targetKind: 'entity',
        type: 'MENTIONS',
        confidence: 0.8,
        evidence: [],
        sourcePaperId: sourceId,
        origin: 'ai',
        originKey: `MENTIONS|${sourceId}|${targetId}`,
        provenance: {},
        createdAt: 1,
        updatedAt: 1,
      },
      sourceId,
      targetId,
    }));

    const renderer = new window.graph.GraphCanvasRenderer(
      canvas,
      window.graph.theme.resolveGraphTheme(),
      { scale: 1, offsetX: 0, offsetY: 0 },
    );
    const model = {
      nodes,
      edges,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      // No shared entities in this synthetic grid: the renderer dims edges into bridge nodes, and
      // this fixture must carry the (empty) set like any other render model.
      bridgeNodeIds: new Set(),
    };
    renderer.setModel(model);
    renderer.setState({
      hoveredNodeId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      matchedNodeIds: new Set(),
      dimmedNodeIds: new Set(),
    });

    window.scene = { canvas, renderer, model, degree: [...degree.entries()], grid };
    return { nodes: nodes.length, edges: edges.length, leaves: grid.leaves };
  }, GRID);
}

function renderAt(viewport) {
  return page.evaluate((nextViewport) => {
    const { renderer } = window.scene;
    renderer.setViewport(nextViewport);
    renderer.render();
    return renderer.getRenderStats();
  }, viewport);
}

test('a glance-level zoom draws everything but only captions the structure', async () => {
  const size = await buildScene();
  assert.equal(size.nodes, GRID.columns * GRID.rows + GRID.leaves);
  const gridEdges = (GRID.columns - 1) * GRID.rows + (GRID.rows - 1) * GRID.columns;
  assert.equal(size.edges, gridEdges + GRID.leaves + 2);

  // 0.15 is the viewer's minimum scale, i.e. "zoom to fit a large library": the
  // 4760 x 2960 world extent fits inside the 900x600 canvas window of 6000 x 4000.
  const fitted = await renderAt({ scale: 0.15, offsetX: 0, offsetY: 0 });
  assert.equal(fitted.fullFrame, true, 'the whole graph is on screen, so nothing is culled');
  assert.equal(fitted.nodesDrawn, size.nodes);
  assert.equal(fitted.nodesCulled, 0);
  assert.equal(fitted.edgesDrawn, size.edges, 'every edge is on screen or crosses it');
  assert.equal(fitted.edgesUnresolved, 0);

  // Captions are the expensive per-node draw, and at 0.15 they are unreadable. The
  // degree-1 leaves must lose theirs while the hubs keep theirs — so the number of
  // unlabelled nodes is exactly the leaf count, which is what makes this an
  // assertion about the rule rather than about a magic threshold.
  assert.equal(
    fitted.nodesDrawn - fitted.labelsDrawn,
    GRID.leaves,
    'exactly the degree-1 leaves are left unnamed far out',
  );
  assert.ok(fitted.labelsDrawn > 0, 'the structure is still named');
});

test('zooming in narrows the frame and keeps edges that cross the view', async () => {
  // A 300x200 world window near the middle-left of the grid, chosen so that exactly
  // one of the two corner-spanning edges passes through it.
  const zoomed = await renderAt({ scale: 3, offsetX: -5550, offsetY: -4797 });
  assert.equal(zoomed.culled, true, 'most of a 6000-node graph is off-screen at 3x');
  assert.ok(
    zoomed.nodesCulled > 5900,
    `expected nearly everything to be culled; drew ${zoomed.nodesDrawn}`,
  );
  assert.ok(zoomed.nodesDrawn > 0, 'the visible neighbourhood is drawn');
  assert.ok(zoomed.edgesDrawn < zoomed.totalEdges, 'off-screen edges are skipped too');
  assert.equal(
    zoomed.labelsDrawn,
    zoomed.nodesDrawn,
    'at a readable zoom every visible node is captioned',
  );

  // Every node and edge is accounted for exactly once.
  assert.equal(zoomed.nodesDrawn + zoomed.nodesCulled, zoomed.totalNodes);
  assert.equal(
    zoomed.edgesDrawn + zoomed.edgesCulled + zoomed.edgesUnresolved,
    zoomed.totalEdges,
  );

  // The corner-spanning edge has both endpoints far outside this window while its
  // segment crosses it. Culling on "both endpoints visible" would drop it exactly
  // when the user zooms in to follow it, so the drawn ids are inspected directly.
  const drawnIds = await page.evaluate(([offsetX, offsetY]) => {
    const { renderer } = window.scene;
    renderer.setViewport({ scale: 3, offsetX, offsetY });
    renderer.render();
    return renderer.getDrawnEdgeIds();
  }, [-5550, -4797]);
  assert.ok(
    drawnIds.includes('n79->n3920'),
    'the corner-spanning edge that crosses this window is drawn',
  );
  assert.ok(
    !drawnIds.includes('n0->n3999'),
    'the other corner-spanning edge misses this window and is culled',
  );
  assert.ok(
    drawnIds.every((id) => id.startsWith('n') || id.startsWith('leaf')),
    'no invented ids appear in the frame',
  );
  assert.equal(
    drawnIds.length,
    zoomed.edgesDrawn,
    'the id list and the draw count describe the same frame',
  );
  assert.deepEqual(
    drawnIds.filter((id) => id === 'n0->n3999' || id === 'n79->n3920'),
    ['n79->n3920'],
    'exactly one of the two corner-spanning edges is in this frame',
  );
});

test('hit tests only find what the viewport shows', async () => {
  const result = await page.evaluate(() => {
    const { renderer, canvas, model } = window.scene;
    const scale = 3;
    const offsetX = -5550;
    const offsetY = -4797;
    renderer.setViewport({ scale, offsetX, offsetY });
    renderer.render();

    // Client coordinates must account for the canvas's position in the page: the
    // renderer subtracts the element rect.
    const rect = canvas.getBoundingClientRect();
    const clientOf = (x, y) => ({
      x: x * scale + offsetX + rect.left,
      y: y * scale + offsetY + rect.top,
    });

    // A node inside the window: n2273 is at column 33, row 28.
    const insideNode = model.nodeById.get('n2273');
    const insideClient = clientOf(insideNode.x, insideNode.y);
    const hitInside = renderer.hitTestNode(insideClient.x, insideClient.y);

    // A node at the far corner of the grid: its screen position is thousands of
    // pixels outside the canvas, so the pointer can never be there.
    const farNode = model.nodeById.get('n3999');
    const farClient = clientOf(farNode.x, farNode.y);
    const hitFar = renderer.hitTestNode(farClient.x, farClient.y);

    // A point on the corner-spanning edge, clear of the nearest grid edge (7.2 world
    // units) so a tight tolerance can only be satisfied by that edge.
    const probe = clientOf(2000, 1699.4);
    const hitEdge = renderer.hitTestEdge(probe.x, probe.y, 18);
    // The same probe with a wide tolerance finds the nearest grid edge instead, which
    // is what proves the tolerance above was discriminating rather than lucky.
    const hitNearest = renderer.hitTestEdge(probe.x, probe.y, 200);

    return {
      hitInside: hitInside?.id ?? null,
      hitFar: hitFar?.id ?? null,
      hitEdge: hitEdge?.edge.edgeId ?? null,
      hitNearest: hitNearest?.edge.edgeId ?? null,
      canvasWidth: canvas.width,
      farClientX: farClient.x,
    };
  });

  assert.equal(result.hitInside, 'n2273', 'a visible node is hit');
  assert.equal(
    result.hitFar,
    null,
    'an off-screen node is not hit even when its world position matches the point',
  );
  assert.ok(result.farClientX > result.canvasWidth, 'the off-screen node really is outside');
  assert.equal(
    result.hitEdge,
    'n79->n3920',
    'an edge crossing the viewport is hit-testable with both endpoints off-screen',
  );
  assert.ok(result.hitNearest, 'and a wider tolerance still finds something nearer');
});

test('the PNG export draws the whole graph without disturbing the live canvas', async () => {
  const result = await page.evaluate(() => {
    const { renderer, canvas, model } = window.scene;
    // Park the live view somewhere deliberately narrow, so "the export ignores the viewport" is observable.
    renderer.setViewport({ scale: 3, offsetX: -5550, offsetY: -4797 });
    renderer.render();
    const liveBefore = {
      width: canvas.width,
      height: canvas.height,
      signature: canvas.toDataURL().slice(-64),
      stats: renderer.getRenderStats(),
    };

    const image = renderer.renderWholeGraphImage({ maxSize: 1_200 });
    if (!image) throw new Error('the export produced no canvas');

    // The node count in the picture is the whole graph, not the handful on screen at 3x.
    const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    let coloured = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      // The background is a flat colour; anything else is a node, an edge, a caption or the grid.
      if (pixels[index] !== pixels[0] || pixels[index + 1] !== pixels[1] || pixels[index + 2] !== pixels[2]) {
        coloured += 1;
      }
    }

    const liveAfter = {
      width: canvas.width,
      height: canvas.height,
      signature: canvas.toDataURL().slice(-64),
      stats: renderer.getRenderStats(),
    };
    // And the instance still draws from its own viewport afterwards.
    renderer.render();
    const redrawn = canvas.toDataURL().slice(-64);
    return {
      image: { width: image.width, height: image.height },
      coloured,
      nodesInModel: model.nodes.length,
      liveBefore,
      liveAfter,
      redrawn,
      viewportStillApplied: renderer.getRenderStats().nodesDrawn < model.nodes.length,
    };
  });

  // Fitted to the 1200 cap, and taller than it is wide / wider than tall depending on the grid — either way it is a
  // real bitmap, not a 1×1 canvas.
  assert.ok(result.image.width >= 1_000, `expected a fitted width, got ${result.image.width}`);
  assert.ok(result.image.height >= 1_000, `expected a fitted height, got ${result.image.height}`);
  // The picture has content: the export renders the whole model, not an empty background.
  assert.ok(
    result.coloured > result.nodesInModel / 2,
    `only ${result.coloured} non-background pixels for ${result.nodesInModel} nodes`,
  );

  assert.deepEqual(
    result.liveAfter,
    result.liveBefore,
    'rendering the image must leave the live canvas, viewport and frame stats exactly as they were',
  );
  assert.equal(result.redrawn, result.liveBefore.signature, 'and the live view still draws what it drew before');
  assert.equal(
    result.viewportStillApplied,
    true,
    'the viewport swap was undone: the live frame is still the zoomed-in one, not the fitted one',
  );
});

console.log('Graph rendering budget tests passed.');