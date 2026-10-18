import assert from 'node:assert/strict';

import {
  cullRenderModel,
  isHubNode,
  nodeWithinBounds,
  pointWithinBounds,
  segmentCrossesBounds,
  shouldDrawLabel,
  visibleWorldBounds,
  HUB_RADIUS_BONUS,
  LABEL_BOX_BOTTOM,
  LABEL_SCALE_FLOOR,
  PERSONAL_LABEL_SCALE_FLOOR,
} from '../src/modules/knowledge-graph/domain/graph-culling.ts';
import {
  radiusForDegree,
  ENTITY_NODE_RADIUS,
  PAPER_NODE_RADIUS,
} from '../src/modules/knowledge-graph/domain/graph-render-model.ts';

/**
 * Viewport culling and label thinning.
 *
 * The reason these rules live in the domain layer is the edge case in the middle of
 * this file: culling on "both endpoints visible" makes long edges disappear exactly
 * when the user zooms in to follow them, which is the moment they matter most.
 */

function node(id, x, y, overrides = {}) {
  return {
    id,
    kind: 'entity',
    label: id,
    x,
    y,
    radius: ENTITY_NODE_RADIUS,
    confidence: 0.8,
    ...overrides,
  };
}

function edgeTo(sourceId, targetId, overrides = {}) {
  return {
    edge: {
      edgeId: `e-${sourceId}-${targetId}`,
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
      ...(overrides.edge ?? {}),
    },
    sourceId,
    targetId,
  };
}

function modelOf(nodes, edges = []) {
  return {
    nodes,
    edges,
    nodeById: new Map(nodes.map((item) => [item.id, item])),
  };
}

// ---------------------------------------------------------------------------
// The visible rectangle.
// ---------------------------------------------------------------------------
const identity = visibleWorldBounds({ scale: 1, offsetX: 0, offsetY: 0 }, 800, 600, 0);
assert.deepEqual(identity, { minX: 0, maxX: 800, minY: 0, maxY: 600 });

// Panning moves the window in the opposite direction to the offset, which is the
// convention the canvas transform uses.
const panned = visibleWorldBounds({ scale: 1, offsetX: -100, offsetY: -50 }, 800, 600, 0);
assert.deepEqual(panned, { minX: 100, maxX: 900, minY: 50, maxY: 650 });

// Zooming in shrinks the world window around the same anchor.
const zoomed = visibleWorldBounds({ scale: 2, offsetX: 0, offsetY: 0 }, 800, 600, 0);
assert.deepEqual(zoomed, { minX: 0, maxX: 400, minY: 0, maxY: 300 });

// The margin is given in screen pixels, so it converts to world units: at 2x the
// same visual band covers half the world distance.
const zoomedMargin = visibleWorldBounds({ scale: 2, offsetX: 0, offsetY: 0 }, 800, 600, 20);
assert.equal(zoomedMargin.minX, -10, 'a 20px screen margin is 10 world units at 2x');
assert.equal(
  visibleWorldBounds({ scale: 0.5, offsetX: 0, offsetY: 0 }, 800, 600, 20).minX,
  -40,
  'and 40 world units at 0.5x',
);

// A degenerate scale must not produce infinities: the viewer clamps it, but a
// culling function that returns an empty or infinite box on bad input is a trap.
const degenerate = visibleWorldBounds({ scale: 0, offsetX: 0, offsetY: 0 }, 800, 600, 0);
assert.ok(Number.isFinite(degenerate.minX) && Number.isFinite(degenerate.maxX));

assert.equal(pointWithinBounds(5, 5, identity), true);
assert.equal(pointWithinBounds(-1, 5, identity), false);

// ---------------------------------------------------------------------------
// Nodes: the drawn box is taller at the bottom, because the caption hangs there.
// ---------------------------------------------------------------------------
assert.equal(nodeWithinBounds(node('a', 100, 100), identity), true);
// Just past the right edge: its radius still reaches into view.
assert.equal(nodeWithinBounds(node('b', 803, 100), identity), true);
assert.equal(nodeWithinBounds(node('c', 900, 0), identity), false);

// The caption hangs *below* the node, so the box reaches further back past the TOP
// edge: a node whose body is just off-screen still has readable text in view.
const aboveTop = node('d', 100, -10);
assert.ok(aboveTop.y + aboveTop.radius < 0, 'its body is off-screen');
assert.equal(
  nodeWithinBounds(aboveTop, identity),
  true,
  `${LABEL_BOX_BOTTOM}px of caption below the node keeps it visible`,
);
assert.equal(
  nodeWithinBounds(node('d2', 100, -40), identity),
  false,
  'far enough above, nothing of it shows',
);
// At the bottom edge the body alone decides, because the caption is underneath it.
assert.equal(nodeWithinBounds(node('g', 100, 595), identity), true, 'the body still overlaps');
assert.equal(nodeWithinBounds(node('f', 100, 700), identity), false);

// ---------------------------------------------------------------------------
// Edges: the rule everybody gets wrong.
//
// Both endpoints outside the viewport, but the segment passes straight through it.
// Culling this edge would make long relationships vanish as soon as the user zooms
// in to follow them.
// ---------------------------------------------------------------------------
const crossing = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
assert.equal(
  segmentCrossesBounds(-500, 50, 500, 50, crossing),
  true,
  'a horizontal segment through the box is visible even with both endpoints outside',
);
assert.equal(segmentCrossesBounds(50, -500, 50, 500, crossing), true);
// Diagonal, corner to corner, both endpoints far outside.
assert.equal(segmentCrossesBounds(-100, -100, 200, 200, crossing), true);

// A segment entirely beside the box is culled — including one that is parallel to an
// edge and outside it, which is the branch a naive slab test gets wrong.
assert.equal(segmentCrossesBounds(-500, 150, 500, 150, crossing), false);
assert.equal(segmentCrossesBounds(-500, -150, 500, -150, crossing), false);
assert.equal(segmentCrossesBounds(150, -500, 150, 500, crossing), false);
assert.equal(segmentCrossesBounds(150, 150, 200, 200, crossing), false, 'outside and same side');

// Touching the boundary counts as visible.
assert.equal(segmentCrossesBounds(-10, 0, 10, 0, crossing), true);
// A point inside is trivially visible.
assert.equal(segmentCrossesBounds(50, 50, 60, 60, crossing), true);
// A degenerate "segment" (a point) outside is not.
assert.equal(segmentCrossesBounds(-5, -5, -5, -5, crossing), false);

// ---------------------------------------------------------------------------
// Culling a whole model.
// ---------------------------------------------------------------------------
const nodes = [
  node('left', -1000, 50),
  node('p1', 100, 100, { kind: 'paper', radius: PAPER_NODE_RADIUS }),
  node('p2', 400, 100, { kind: 'paper', radius: PAPER_NODE_RADIUS }),
  node('far', 5000, 5000),
];
const edges = [
  edgeTo('p1', 'p2'),
  // Crosses the viewport with both endpoints outside.
  edgeTo('left', 'p2', { edge: { originKey: 'MENTIONS|left|p2' } }),
  edgeTo('left', 'far', { edge: { originKey: 'MENTIONS|left|far' } }),
  // Dangling: a target that is not in the model at all.
  edgeTo('p1', 'ghost', { edge: { originKey: 'MENTIONS|p1|ghost' } }),
];
const fullModel = modelOf(nodes, edges);
const culled = cullRenderModel(fullModel, { minX: 0, minY: 0, maxX: 800, maxY: 600 });

assert.deepEqual(culled.stats.totalNodes, 4);
assert.deepEqual(culled.stats.totalEdges, 4);
assert.deepEqual(
  culled.nodes.map((item) => item.id),
  ['p1', 'p2'],
  'only the nodes inside the viewport are drawn',
);
assert.deepEqual(
  culled.edges.map((item) => item.edge.edgeId),
  ['e-p1-p2', 'e-left-p2'],
  'the crossing edge survives; the far one and the dangling one do not',
);
assert.equal(culled.stats.nodesCulled, 2);
assert.equal(culled.stats.edgesCulled, 1, 'the edge to the far node is genuinely off-view');
assert.equal(culled.stats.edgesUnresolved, 1, 'the dangling edge is classified separately');
assert.equal(
  culled.stats.nodesDrawn + culled.stats.nodesCulled,
  culled.stats.totalNodes,
  'every node is either drawn or culled',
);
assert.equal(
  culled.stats.edgesDrawn + culled.stats.edgesCulled + culled.stats.edgesUnresolved,
  culled.stats.totalEdges,
  'and every edge is drawn, culled, or unresolved',
);
assert.equal(culled.stats.fullFrame, false);

// nodeById stays complete: a visible edge may have an off-screen endpoint, and the
// renderer needs its coordinates to draw it at all.
assert.equal(culled.nodeById.size, 4, 'the lookup map is not culled');
assert.ok(culled.nodeById.get('left'), 'the off-screen endpoint is still resolvable');
assert.equal(culled.nodeById, fullModel.nodeById, 'and it is passed through, not rebuilt');
assert.equal(culled.nodes.length, 2, 'the draw list is the culled one');

// A viewport that contains everything reports a full frame, so the renderer (and a
// test) can tell "nothing needed skipping" from "everything was skipped".
const everything = cullRenderModel(modelOf(nodes, edges), {
  minX: -10000, minY: -10000, maxX: 10000, maxY: 10000,
});
assert.equal(everything.stats.nodesCulled, 0);
assert.equal(everything.stats.edgesCulled, 0);
assert.equal(everything.stats.edgesDrawn, 3, 'the dangling edge is still dropped');
// A dangling edge is a broken model, not a viewport decision: it must not make the
// frame report that culling happened, or that signal becomes useless.
assert.equal(everything.stats.edgesUnresolved, 1);
assert.equal(everything.stats.fullFrame, true, 'the viewport removed nothing');

const empty = cullRenderModel({ nodes: [], edges: [], nodeById: new Map() }, identity);
assert.equal(empty.stats.fullFrame, true, 'an empty graph is trivially a full frame');
assert.deepEqual(empty.nodes, []);

// Determinism: the culled lists keep the model's order, so the draw order and the
// hit-test order do not depend on the viewport.
const reversed = cullRenderModel(modelOf([...nodes].reverse(), [...edges].reverse()), {
  minX: 0, minY: 0, maxX: 800, maxY: 600,
});
assert.deepEqual(reversed.nodes.map((item) => item.id), ['p2', 'p1']);

// ---------------------------------------------------------------------------
// Label thinning.
// ---------------------------------------------------------------------------
const hub = node('hub', 0, 0, {
  kind: 'paper',
  radius: radiusForDegree(PAPER_NODE_RADIUS, 8),
});
const leaf = node('leaf', 0, 0, {
  kind: 'paper',
  radius: radiusForDegree(PAPER_NODE_RADIUS, 1),
});

// Hubs are defined by the same curve that sizes the nodes, so the threshold is
// "degree 3 or more" rather than a magic number.
assert.equal(isHubNode(hub), true);
assert.equal(isHubNode(leaf), false);
assert.equal(isHubNode(node('mid', 0, 0, { kind: 'paper', radius: PAPER_NODE_RADIUS + HUB_RADIUS_BONUS })), true);
assert.equal(isHubNode({ kind: 'entity', radius: ENTITY_NODE_RADIUS + 2 }), false, 'degree 2 is not a hub');

// At a readable zoom everything is labelled, exactly as before this change.
for (const item of [hub, leaf]) {
  assert.equal(shouldDrawLabel(item, { scale: 1 }), true);
  assert.equal(shouldDrawLabel(item, { scale: LABEL_SCALE_FLOOR + 0.01 }), true);
}
assert.equal(shouldDrawLabel(node('n', 0, 0, { kind: 'note' }), { scale: 1 }), true);

// Far out, only hubs are named: a hairball of thousands of illegible captions costs
// the most and says the least.
assert.equal(shouldDrawLabel(hub, { scale: LABEL_SCALE_FLOOR - 0.01 }), true);
assert.equal(shouldDrawLabel(leaf, { scale: LABEL_SCALE_FLOOR - 0.01 }), false);
assert.equal(shouldDrawLabel(leaf, { scale: 0.15 }), false);

// The user pointing at a node always wins — including a leaf they are hovering at a
// glance-level zoom, which is the case that would otherwise make search useless.
assert.equal(shouldDrawLabel(leaf, { scale: 0.15, interactive: true }), true);
assert.equal(shouldDrawLabel(node('n', 0, 0, { kind: 'note' }), { scale: 0.2, interactive: true }), true);

// Dense personal markers keep their own, higher floor: they are numerous and small,
// so naming them earlier would bury the documents.
const personal = node('n', 0, 0, { kind: 'highlight', radius: 6 });
assert.equal(shouldDrawLabel(personal, { scale: PERSONAL_LABEL_SCALE_FLOOR }), false);
assert.equal(shouldDrawLabel(personal, { scale: PERSONAL_LABEL_SCALE_FLOOR + 0.01 }), true);
// Folders are the exception: there are few of them and they name structure.
assert.equal(
  shouldDrawLabel({ kind: 'folder', radius: 6 }, { scale: PERSONAL_LABEL_SCALE_FLOOR + 0.01 }),
  true,
  'a folder keeps its caption even at a scale where dense markers lose theirs',
);

console.log('Graph culling contract tests passed.');
