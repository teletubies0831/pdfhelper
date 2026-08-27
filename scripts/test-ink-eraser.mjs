import assert from "node:assert/strict";

import {
  createInkBezierLine,
  inkBezierLineToSvgPath,
  splitInkStrokeAtErasedSegments,
  squaredDistanceBetweenSegments,
} from "../src/viewer/features/annotations/ink-eraser-geometry.ts";

assert.equal(
  squaredDistanceBetweenSegments(
    { x: 0, y: 5 },
    { x: 10, y: 5 },
    { x: 5, y: 0 },
    { x: 5, y: 10 },
  ),
  0,
  "crossing eraser and ink segments must hit",
);

assert.equal(
  squaredDistanceBetweenSegments(
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 0, y: 4 },
    { x: 5, y: 4 },
  ),
  16,
  "parallel segment distance must remain stable",
);

assert.deepEqual(
  splitInkStrokeAtErasedSegments(
    [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0],
    new Uint8Array([0, 0, 1, 0, 0]),
  ),
  [
    [0, 0, 1, 0, 2, 0],
    [3, 0, 4, 0, 5, 0],
  ],
  "an erased middle segment must preserve both continuous sides",
);

assert.deepEqual(
  splitInkStrokeAtErasedSegments(
    [0, 0, 1, 0, 2, 0],
    new Uint8Array([1, 1]),
  ),
  [],
  "fully swept strokes must disappear",
);

assert.deepEqual(
  splitInkStrokeAtErasedSegments([2, 3], new Uint8Array([0])),
  [[2, 3]],
  "untouched ink dots must remain",
);

const rebuiltLine = createInkBezierLine([0, 0, 6, 0, 12, 6]);
assert.deepEqual(
  Array.from(rebuiltLine).map((value) =>
    Number.isNaN(value) ? "NaN" : value,
  ),
  ["NaN", "NaN", "NaN", "NaN", 0, 0, 5, 0, 7, 1, 9, 3],
  "partial strokes must use PDF.js-compatible Bezier controls",
);
assert.equal(
  inkBezierLineToSvgPath(rebuiltLine),
  "M0 0C5 0 7 1 9 3",
  "live preview and committed strokes must share one curve path",
);

console.log("Ink eraser geometry checks passed.");
