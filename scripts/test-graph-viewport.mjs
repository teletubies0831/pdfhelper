import assert from 'node:assert/strict';

import {
  MAX_GRAPH_SCALE,
  MIN_GRAPH_SCALE,
  boundsOfPoints,
  clampScale,
  createViewport,
  fitViewport,
  layoutWorldSize,
  panBy,
  zoomAt,
} from '../src/viewer/features/knowledge-graph/graph-viewport.ts';

/**
 * 画布视口的数学.
 *
 * Pan and zoom are the interaction the user complained about ("cannot drag it"), and the arithmetic behind them is easy to get
 * subtly wrong in a way that only shows up as drift: zoom around the cursor must keep the point under the cursor fixed, pan
 * must move the world by exactly the pointer delta, and the world size must not depend on the canvas — that dependency is what
 * made the graph rescale with the window.
 */

// ---------------------------------------------------------------------------
// 缩放：以光标为锚点，锚点下的世界坐标不动
// ---------------------------------------------------------------------------
{
  const start = createViewport();
  // Screen point 300,200; zoom in 2×.
  const zoomed = zoomAt(start, 2, 300, 200);
  assert.equal(zoomed.scale, 2);
  // The world point under the cursor before and after must be the same.
  const worldBefore = { x: (300 - start.offsetX) / start.scale, y: (200 - start.offsetY) / start.scale };
  const worldAfter = { x: (300 - zoomed.offsetX) / zoomed.scale, y: (200 - zoomed.offsetY) / zoomed.scale };
  assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 1e-9);
  assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 1e-9);

  // Zooming a viewport that was already panned keeps whatever is under the cursor *now* fixed (not what was there before the
  // pan — that is the point of panning).
  const moved = panBy(zoomed, -120, 45);
  const underCursorBefore = { x: (300 - moved.offsetX) / moved.scale, y: (200 - moved.offsetY) / moved.scale };
  const again = zoomAt(moved, 0.5, 300, 200);
  assert.ok(Math.abs((300 - again.offsetX) / again.scale - underCursorBefore.x) < 1e-9);
  assert.ok(Math.abs((200 - again.offsetY) / again.scale - underCursorBefore.y) < 1e-9);
}

// ---------------------------------------------------------------------------
// 缩放边界：不会缩到看不见，也不会放大到失控
// ---------------------------------------------------------------------------
{
  assert.equal(clampScale(0.0001), MIN_GRAPH_SCALE);
  assert.equal(clampScale(99), MAX_GRAPH_SCALE);
  assert.equal(clampScale(Number.NaN), 1);
  // Already at the ceiling: the viewport is returned untouched, so a wheel gesture at the limit is a no-op.
  const maxed = { scale: MAX_GRAPH_SCALE, offsetX: 10, offsetY: 20 };
  assert.equal(zoomAt(maxed, 2, 0, 0), maxed);
}

// ---------------------------------------------------------------------------
// 平移：严格等于指针位移，缩放不变
// ---------------------------------------------------------------------------
{
  const panned = panBy({ scale: 1.5, offsetX: 10, offsetY: -4 }, 33, -12);
  assert.deepEqual(panned, { scale: 1.5, offsetX: 43, offsetY: -16 });
  // 平移是纯加法：连续两次与一次相同。
  assert.deepEqual(panBy(panBy(createViewport(), 5, 5), 5, 5), panBy(createViewport(), 10, 10));
}

// ---------------------------------------------------------------------------
// 适应画布：全部节点可见，且不放大到荒谬的程度
// ---------------------------------------------------------------------------
{
  const bounds = boundsOfPoints([{ x: 0, y: 0, radius: 10 }, { x: 400, y: 300, radius: 10 }]);
  assert.deepEqual(bounds, { minX: -10, minY: -10, maxX: 410, maxY: 310 });
  const fitted = fitViewport(bounds, 800, 600);
  // Both extremes land inside the canvas.
  const toScreen = (x, y) => ({ x: x * fitted.scale + fitted.offsetX, y: y * fitted.scale + fitted.offsetY });
  const topLeft = toScreen(-10, -10);
  const bottomRight = toScreen(410, 310);
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0, JSON.stringify(topLeft));
  assert.ok(bottomRight.x <= 800 && bottomRight.y <= 600, JSON.stringify(bottomRight));
  // A tiny graph is not blown up past 1.6× — that made a three-node graph fill the screen with giant circles.
  const tiny = fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 800, 600);
  assert.ok(tiny.scale <= 1.6);
}

// ---------------------------------------------------------------------------
// 世界尺寸：只随节点数变化，与画布无关（窗口缩放不再重排图）
// ---------------------------------------------------------------------------
{
  const small = layoutWorldSize(8);
  const medium = layoutWorldSize(80);
  const large = layoutWorldSize(400);
  assert.ok(small.width < medium.width, 'more nodes need a bigger world');
  assert.ok(medium.width <= large.width);
  assert.equal(Math.round(small.width * 0.72), small.height);
  assert.equal(Math.round(medium.width * 0.72), medium.height);
  // 同一个节点数永远得到同一个世界：布局缓存与「同内容不重排」都依赖它。
  assert.deepEqual(layoutWorldSize(80), medium);
  assert.ok(layoutWorldSize(0).width > 0);
  assert.ok(layoutWorldSize(1).width > 0);
  // 与画布尺寸无关这一条没有参数可以传，这正是重点：函数签名里没有 width/height。
  assert.equal(layoutWorldSize.length, 1);
}

console.log('Graph viewport contract tests passed.');
