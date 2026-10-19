import assert from 'node:assert/strict';

import {
  planGraphImage,
  suggestGraphImageFileName,
} from '../src/modules/knowledge-graph/domain/graph-image-plan.ts';

/**
 * The graph's PNG export geometry.
 *
 * The button exports an image of the **whole** graph, so its size cannot come from the window: the plan fits every
 * node into one bitmap, and it is the only part of the export that can be checked without a canvas. The rest of the
 * path (swapping the renderer onto a detached canvas, encoding, downloading) is exercised in the packaged build.
 */

// Nothing to draw: callers must not export an empty picture.
assert.deepEqual(planGraphImage([]), {
  width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0, empty: true, nodeCount: 0,
});
assert.equal(planGraphImage([{ x: Number.NaN, y: 0 }]).empty, true, 'a node without a position is not a node');

// A single node still gets a picture: both spans are floored at one world unit, so the scale lands on the maximum
// instead of infinity.
const single = planGraphImage([{ x: 40, y: 40 }], { maxSize: 800, padding: 50, maxScale: 1.5 });
assert.equal(single.empty, false);
assert.equal(single.scale, 1.5);
assert.equal(single.nodeCount, 1);
assert.equal(single.width, 100 + Math.ceil(1.5 * 1), 'span floor of 1 unit keeps the size finite');
assert.ok(single.offsetX < 0, 'the world origin sits to the left of the picture');

// A wide graph and a tall graph are both fitted to the same long side, and neither is distorted: one scale for both
// axes, which is what keeps circles round.
const wide = planGraphImage([{ x: 0, y: 0 }, { x: 1_000, y: 10 }], { maxSize: 1_000, padding: 50 });
const tall = planGraphImage([{ x: 0, y: 0 }, { x: 10, y: 1_000 }], { maxSize: 1_000, padding: 50 });
assert.equal(wide.width, 1_000);
assert.equal(tall.height, 1_000);
assert.equal(wide.scale, tall.scale, 'the same span gives the same scale in either direction');
assert.ok(wide.height < tall.height, 'the shorter axis produces the shorter picture');

// The world's top-left corner maps to the padding, so no node is ever clipped at the edge.
const padded = planGraphImage([{ x: -300, y: -200 }, { x: 300, y: 200 }], { maxSize: 1_000, padding: 60 });
assert.equal(Math.round(-300 * padded.scale + padded.offsetX), 60);
assert.equal(Math.round(-200 * padded.scale + padded.offsetY), 60);
assert.equal(
  Math.round(300 * padded.scale + padded.offsetX),
  padded.width - 60,
  'and the bottom-right corner lands the same distance from the far edge',
);

// Bounds: a tiny graph is not blown up past readability, a huge one is not shrunk into a smear.
const tiny = planGraphImage([{ x: 0, y: 0 }, { x: 20, y: 20 }], { maxSize: 1_000, maxScale: 1.6 });
assert.equal(tiny.scale, 1.6, 'a two-node graph is capped, not zoomed to 40×');
const huge = planGraphImage([{ x: 0, y: 0 }, { x: 100_000, y: 100_000 }], { maxSize: 1_000, minScale: 0.4 });
assert.equal(huge.scale, 0.4, 'a sprawling graph is capped at the other end');

// The long side stays inside the cap whenever the scale was chosen by fitting rather than clamping.
const fitted = planGraphImage([{ x: 0, y: 0 }, { x: 5_000, y: 2_000 }], { maxSize: 1_600, padding: 40 });
assert.ok(fitted.width <= 1_600 && fitted.height <= 1_600, `${fitted.width}×${fitted.height} exceeds the cap`);

// Deterministic: the same graph exports byte-identical geometry, which is what makes the picture comparable.
assert.deepEqual(
  planGraphImage([{ x: 5, y: 9 }, { x: 100, y: 3 }], { maxSize: 900 }),
  planGraphImage([{ x: 5, y: 9 }, { x: 100, y: 3 }], { maxSize: 900 }),
);

// The file name is sortable by time and free of characters a file system dislikes.
assert.equal(
  suggestGraphImageFileName(new Date(2026, 9, 18, 15, 7, 42)),
  'pdfpal-knowledge-graph-20261018-1507.png',
);
assert.match(suggestGraphImageFileName(new Date(2026, 0, 2, 3, 4)), /^pdfpal-knowledge-graph-\d{8}-\d{4}\.png$/);

console.log('Graph image plan tests passed.');
