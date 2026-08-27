export interface InkScreenPoint {
  x: number;
  y: number;
}

export type InkPointMapper = (point: InkScreenPoint) => InkScreenPoint;

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

/** Rebuild the same smooth line representation PDF.js derives from samples. */
export function createInkBezierLine(
  points: ArrayLike<number>,
): Float32Array {
  const length = points.length - (points.length % 2);
  if (length < 2) return new Float32Array();
  if (length === 2) {
    return new Float32Array([
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      points[0]!,
      points[1]!,
    ]);
  }
  if (length === 4) {
    return new Float32Array([
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      points[0]!,
      points[1]!,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      points[2]!,
      points[3]!,
    ]);
  }

  const line = new Float32Array(3 * (length - 2));
  line.set([
    Number.NaN,
    Number.NaN,
    Number.NaN,
    Number.NaN,
    points[0]!,
    points[1]!,
  ]);
  let x1 = points[0]!;
  let y1 = points[1]!;
  let x2 = points[2]!;
  let y2 = points[3]!;
  for (let index = 4; index < length; index += 2) {
    const x3 = points[index]!;
    const y3 = points[index + 1]!;
    line.set(
      [
        (x1 + 5 * x2) / 6,
        (y1 + 5 * y2) / 6,
        (5 * x2 + x3) / 6,
        (5 * y2 + y3) / 6,
        (x2 + x3) / 2,
        (y2 + y3) / 2,
      ],
      (index - 2) * 3,
    );
    x1 = x2;
    y1 = y2;
    x2 = x3;
    y2 = y3;
  }
  return line;
}

export function inkBezierLineToSvgPath(
  line: ArrayLike<number>,
  mapPoint: InkPointMapper = (point) => point,
): string {
  if (line.length < 6) return "";
  const start = mapPoint({ x: Number(line[4]), y: Number(line[5]) });
  let output = `M${start.x} ${start.y}`;
  if (line.length === 6) return `${output}Z`;
  if (line.length === 12 && Number.isNaN(Number(line[6]))) {
    const end = mapPoint({ x: Number(line[10]), y: Number(line[11]) });
    return `${output}L${end.x} ${end.y}`;
  }
  for (let index = 6; index < line.length; index += 6) {
    const firstControl = mapPoint({
      x: Number(line[index]),
      y: Number(line[index + 1]),
    });
    const secondControl = mapPoint({
      x: Number(line[index + 2]),
      y: Number(line[index + 3]),
    });
    const end = mapPoint({
      x: Number(line[index + 4]),
      y: Number(line[index + 5]),
    });
    output += `C${firstControl.x} ${firstControl.y} ${secondControl.x} ${secondControl.y} ${end.x} ${end.y}`;
  }
  return output;
}
