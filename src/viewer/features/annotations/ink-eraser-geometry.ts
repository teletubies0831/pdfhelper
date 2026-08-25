export interface InkScreenPoint {
  x: number;
  y: number;
}

const GEOMETRY_EPSILON = 1e-7;

function squaredDistance(first: InkScreenPoint, second: InkScreenPoint): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function squaredDistanceToSegment(
  point: InkScreenPoint,
  start: InkScreenPoint,
  end: InkScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON) return squaredDistance(point, start);

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  );
  return squaredDistance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function orientation(
  first: InkScreenPoint,
  second: InkScreenPoint,
  third: InkScreenPoint,
): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function isPointOnSegment(
  point: InkScreenPoint,
  start: InkScreenPoint,
  end: InkScreenPoint,
): boolean {
  return (
    Math.abs(orientation(start, end, point)) <= GEOMETRY_EPSILON &&
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
  );
}

function segmentsIntersect(
  firstStart: InkScreenPoint,
  firstEnd: InkScreenPoint,
  secondStart: InkScreenPoint,
  secondEnd: InkScreenPoint,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  if (
    firstOrientation * secondOrientation < 0 &&
    thirdOrientation * fourthOrientation < 0
  ) {
    return true;
  }

  return (
    isPointOnSegment(secondStart, firstStart, firstEnd) ||
    isPointOnSegment(secondEnd, firstStart, firstEnd) ||
    isPointOnSegment(firstStart, secondStart, secondEnd) ||
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  );
}

export function squaredDistanceBetweenSegments(
  firstStart: InkScreenPoint,
  firstEnd: InkScreenPoint,
  secondStart: InkScreenPoint,
  secondEnd: InkScreenPoint,
): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    squaredDistanceToSegment(firstStart, secondStart, secondEnd),
    squaredDistanceToSegment(firstEnd, secondStart, secondEnd),
    squaredDistanceToSegment(secondStart, firstStart, firstEnd),
    squaredDistanceToSegment(secondEnd, firstStart, firstEnd),
  );
}

/** Split one serialized PDF.js ink stroke at erased segments. */
export function splitInkStrokeAtErasedSegments(
  points: readonly number[],
  erasedSegments: ArrayLike<number>,
): number[][] {
  const pointCount = Math.floor(points.length / 2);
  if (pointCount === 0) return [];
  if (pointCount === 1) {
    return erasedSegments[0] ? [] : [[points[0]!, points[1]!]];
  }

  const runs: number[][] = [];
  let currentRun: number[] | null = null;
  for (let segmentIndex = 0; segmentIndex < pointCount - 1; segmentIndex += 1) {
    if (erasedSegments[segmentIndex]) {
      if (currentRun && currentRun.length >= 4) runs.push(currentRun);
      currentRun = null;
      continue;
    }

    if (!currentRun) {
      currentRun = [
        points[segmentIndex * 2]!,
        points[segmentIndex * 2 + 1]!,
      ];
    }
    currentRun.push(
      points[(segmentIndex + 1) * 2]!,
      points[(segmentIndex + 1) * 2 + 1]!,
    );
  }
  if (currentRun && currentRun.length >= 4) runs.push(currentRun);
  return runs;
}
