import { pdfViewer } from "../../app/viewer-state";
import {
  createInkBezierLine,
  inkBezierLineToSvgPath,
  type InkPointMapper,
  type InkScreenPoint,
  splitInkStrokeAtErasedSegments,
  squaredDistanceBetweenSegments,
} from "./ink-eraser-geometry";
import { isInkEditor } from "./annotation-persistence";

export const INK_ERASER_RADIUS_PX = 9;
const GRID_CELL_SIZE_PX = 28;

interface PageTransform {
  pdfToScreen(x: number, y: number): InkScreenPoint;
  pdfLengthToScreen(length: number): number;
}

interface InkStrokeState {
  sourcePoints: number[];
  screenPoints: InkScreenPoint[];
  sourceLine: number[] | null;
  screenLine: number[] | null;
  erasedSegments: Uint8Array;
}

export interface SurvivingInkPaths {
  points: Float32Array[];
  lines: Float32Array[];
}

export interface InkEraserEntry {
  editor: any;
  layer: any;
  serialized: Record<string, any>;
  strokes: InkStrokeState[];
  hitRadiusPx: number;
  changed: boolean;
}

interface IndexedInkSegment {
  id: number;
  entry: InkEraserEntry;
  stroke: InkStrokeState;
  segmentIndex: number;
  start: InkScreenPoint;
  end: InkScreenPoint;
}

export interface InkEraserSession {
  pointerId: number;
  document: unknown;
  entries: InkEraserEntry[];
  segments: IndexedInkSegment[];
  grid: Map<string, number[]>;
  lastPoint: InkScreenPoint;
  eraserRadiusPx: number;
  previewDirtyEntries: Set<InkEraserEntry>;
  previewFrameId: number | null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPageTransform(pageIndex: number): PageTransform | null {
  const pageView = pdfViewer.getPageView(pageIndex) as any;
  const viewport = pageView?.viewport;
  const pageElement = pageView?.div as HTMLElement | null;
  const surface =
    pageElement?.querySelector<HTMLElement>(".canvasWrapper") ?? pageElement;
  const rect = surface?.getBoundingClientRect();
  const viewportWidth = Number(viewport?.width);
  const viewportHeight = Number(viewport?.height);
  if (
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    typeof viewport?.convertToViewportPoint !== "function"
  ) {
    return null;
  }

  const scaleX = rect.width / viewportWidth;
  const scaleY = rect.height / viewportHeight;
  const viewportOrigin = viewport.convertToViewportPoint(0, 0);
  const viewportUnitX = viewport.convertToViewportPoint(1, 0);
  const viewportUnitY = viewport.convertToViewportPoint(0, 1);
  const screenUnitsPerPdfUnit = Math.max(
    Math.hypot(
      (viewportUnitX[0] - viewportOrigin[0]) * scaleX,
      (viewportUnitX[1] - viewportOrigin[1]) * scaleY,
    ),
    Math.hypot(
      (viewportUnitY[0] - viewportOrigin[0]) * scaleX,
      (viewportUnitY[1] - viewportOrigin[1]) * scaleY,
    ),
  );
  return {
    pdfToScreen(x, y) {
      const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y);
      return {
        x: rect.left + viewportX * scaleX,
        y: rect.top + viewportY * scaleY,
      };
    },
    pdfLengthToScreen(length) {
      return Math.abs(length) * screenUnitsPerPdfUnit;
    },
  };
}

function normalizeSerializedStroke(value: unknown): number[] | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const output = Array.from(value as ArrayLike<unknown>, Number).filter(
    Number.isFinite,
  );
  if (output.length < 2) return null;
  if (output.length % 2 !== 0) output.pop();
  return output.length >= 2 ? output : null;
}

function normalizeSerializedLine(value: unknown): number[] | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const output = Array.from(value as ArrayLike<unknown>, Number);
  if (output.length < 6 || output.length % 6 !== 0) return null;
  return output;
}

function transformSerializedLine(
  line: readonly number[],
  transform: PageTransform,
): number[] {
  const output: number[] = [];
  for (let index = 0; index < line.length; index += 2) {
    const x = line[index]!;
    const y = line[index + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      output.push(Number.NaN, Number.NaN);
      continue;
    }
    const point = transform.pdfToScreen(x, y);
    output.push(point.x, point.y);
  }
  return output;
}

function getSerializedInk(editor: any): Record<string, any> | null {
  try {
    const serialized = editor?.serialize?.(true);
    if (
      !isRecord(serialized) ||
      !isRecord(serialized.paths) ||
      !Array.isArray(serialized.paths.points)
    ) {
      return null;
    }
    return serialized;
  } catch {
    return null;
  }
}

function getScreenStrokes(
  editor: any,
  transform: PageTransform,
): { serialized: Record<string, any>; strokes: InkStrokeState[] } | null {
  const serialized = getSerializedInk(editor);
  if (!serialized) return null;
  const strokes: InkStrokeState[] = [];
  const rawLines = Array.isArray(serialized.paths.lines)
    ? (serialized.paths.lines as unknown[])
    : [];
  for (
    let strokeIndex = 0;
    strokeIndex < serialized.paths.points.length;
    strokeIndex += 1
  ) {
    const rawStroke = serialized.paths.points[strokeIndex];
    const sourcePoints = normalizeSerializedStroke(rawStroke);
    if (!sourcePoints) continue;
    const screenPoints: InkScreenPoint[] = [];
    for (let index = 0; index < sourcePoints.length; index += 2) {
      screenPoints.push(
        transform.pdfToScreen(sourcePoints[index]!, sourcePoints[index + 1]!),
      );
    }
    if (screenPoints.length === 0) continue;
    const sourceLine = normalizeSerializedLine(rawLines[strokeIndex]);
    strokes.push({
      sourcePoints,
      screenPoints,
      sourceLine,
      screenLine: sourceLine
        ? transformSerializedLine(sourceLine, transform)
        : null,
      erasedSegments: new Uint8Array(Math.max(1, screenPoints.length - 1)),
    });
  }
  return strokes.length > 0 ? { serialized, strokes } : null;
}

function getGridCell(value: number): number {
  return Math.floor(value / GRID_CELL_SIZE_PX);
}

function getGridKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function addSegmentToGrid(
  session: InkEraserSession,
  segment: IndexedInkSegment,
): void {
  const minX = getGridCell(
    Math.min(segment.start.x, segment.end.x) - segment.entry.hitRadiusPx,
  );
  const maxX = getGridCell(
    Math.max(segment.start.x, segment.end.x) + segment.entry.hitRadiusPx,
  );
  const minY = getGridCell(
    Math.min(segment.start.y, segment.end.y) - segment.entry.hitRadiusPx,
  );
  const maxY = getGridCell(
    Math.max(segment.start.y, segment.end.y) + segment.entry.hitRadiusPx,
  );
  for (let cellX = minX; cellX <= maxX; cellX += 1) {
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      const key = getGridKey(cellX, cellY);
      const bucket = session.grid.get(key);
      if (bucket) bucket.push(segment.id);
      else session.grid.set(key, [segment.id]);
    }
  }
}

export function buildInkEraserSession(
  uiManager: any,
  documentValue: unknown,
  pointerId: number,
  pageIndex: number,
  point: InkScreenPoint,
  eraserRadiusPx = INK_ERASER_RADIUS_PX,
): InkEraserSession | null {
  const transform = getPageTransform(pageIndex);
  if (!uiManager || !transform || !documentValue) return null;

  const entries: InkEraserEntry[] = [];
  for (const editor of uiManager.getEditors(pageIndex)) {
    if (!isInkEditor(editor)) continue;
    const data = getScreenStrokes(editor, transform);
    if (!data) continue;
    const layer = editor.parent ?? uiManager.getLayer?.(pageIndex);
    if (!layer) continue;
    entries.push({
      editor,
      layer,
      serialized: data.serialized,
      strokes: data.strokes,
      hitRadiusPx:
        eraserRadiusPx +
        transform.pdfLengthToScreen(Number(data.serialized.thickness) || 1) / 2,
      changed: false,
    });
  }
  if (entries.length === 0) return null;

  const session: InkEraserSession = {
    pointerId,
    document: documentValue,
    entries,
    segments: [],
    grid: new Map(),
    lastPoint: point,
    eraserRadiusPx,
    previewDirtyEntries: new Set(),
    previewFrameId: null,
  };
  for (const entry of entries) {
    for (const stroke of entry.strokes) {
      if (stroke.screenPoints.length === 1) {
        const onlyPoint = stroke.screenPoints[0]!;
        const segment: IndexedInkSegment = {
          id: session.segments.length,
          entry,
          stroke,
          segmentIndex: 0,
          start: onlyPoint,
          end: onlyPoint,
        };
        session.segments.push(segment);
        addSegmentToGrid(session, segment);
        continue;
      }
      for (
        let segmentIndex = 0;
        segmentIndex < stroke.screenPoints.length - 1;
        segmentIndex += 1
      ) {
        const segment: IndexedInkSegment = {
          id: session.segments.length,
          entry,
          stroke,
          segmentIndex,
          start: stroke.screenPoints[segmentIndex]!,
          end: stroke.screenPoints[segmentIndex + 1]!,
        };
        session.segments.push(segment);
        addSegmentToGrid(session, segment);
      }
    }
  }
  return session;
}

function getCandidateSegmentIds(
  session: InkEraserSession,
  start: InkScreenPoint,
  end: InkScreenPoint,
): Set<number> {
  const minX = getGridCell(Math.min(start.x, end.x) - session.eraserRadiusPx);
  const maxX = getGridCell(Math.max(start.x, end.x) + session.eraserRadiusPx);
  const minY = getGridCell(Math.min(start.y, end.y) - session.eraserRadiusPx);
  const maxY = getGridCell(Math.max(start.y, end.y) + session.eraserRadiusPx);
  const ids = new Set<number>();
  for (let cellX = minX; cellX <= maxX; cellX += 1) {
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (const id of session.grid.get(getGridKey(cellX, cellY)) ?? []) {
        ids.add(id);
      }
    }
  }
  return ids;
}

export function getInkSvgPath(editor: any): SVGPathElement | null {
  const drawId = Number(editor?._drawId);
  if (!Number.isInteger(drawId) || drawId < 0) return null;
  const path = document.getElementById(`path_${drawId}`);
  return path instanceof SVGPathElement ? path : null;
}

export function eraseInkSweep(
  session: InkEraserSession,
  start: InkScreenPoint,
  end: InkScreenPoint,
): InkEraserEntry[] {
  const hitEntries = new Set<InkEraserEntry>();
  for (const id of getCandidateSegmentIds(session, start, end)) {
    const segment = session.segments[id];
    if (!segment || segment.stroke.erasedSegments[segment.segmentIndex]) continue;
    if (
      squaredDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      ) > segment.entry.hitRadiusPx * segment.entry.hitRadiusPx
    ) {
      continue;
    }
    segment.stroke.erasedSegments[segment.segmentIndex] = 1;
    segment.entry.changed = true;
    hitEntries.add(segment.entry);
  }
  return [...hitEntries];
}

function hasErasedSegment(stroke: InkStrokeState): boolean {
  return stroke.erasedSegments.some((value) => value !== 0);
}

export function getSurvivingInkPath(
  entry: InkEraserEntry,
  mapPoint: InkPointMapper = (point) => point,
): string {
  const commands: string[] = [];
  for (const stroke of entry.strokes) {
    if (!hasErasedSegment(stroke) && stroke.screenLine) {
      commands.push(inkBezierLineToSvgPath(stroke.screenLine, mapPoint));
      continue;
    }
    const flatScreenPoints = stroke.screenPoints.flatMap((point) => [
      point.x,
      point.y,
    ]);
    for (const run of splitInkStrokeAtErasedSegments(
      flatScreenPoints,
      stroke.erasedSegments,
    )) {
      commands.push(
        inkBezierLineToSvgPath(createInkBezierLine(run), mapPoint),
      );
    }
  }
  return commands.join("");
}

export function getSurvivingInkPaths(
  entry: InkEraserEntry,
): SurvivingInkPaths {
  const points: Float32Array[] = [];
  const lines: Float32Array[] = [];
  for (const stroke of entry.strokes) {
    if (!hasErasedSegment(stroke)) {
      const sourcePoints = new Float32Array(stroke.sourcePoints);
      points.push(sourcePoints);
      lines.push(
        stroke.sourceLine
          ? new Float32Array(stroke.sourceLine)
          : createInkBezierLine(sourcePoints),
      );
      continue;
    }
    for (const run of splitInkStrokeAtErasedSegments(
      stroke.sourcePoints,
      stroke.erasedSegments,
    )) {
      const survivingPoints = new Float32Array(run);
      points.push(survivingPoints);
      lines.push(createInkBezierLine(survivingPoints));
    }
  }
  return { points, lines };
}

export function isPointInsideSerializedInk(
  editor: any,
  clientX: number,
  clientY: number,
): boolean {
  const transform = getPageTransform(Number(editor?.pageIndex));
  const data = transform ? getScreenStrokes(editor, transform) : null;
  if (!data) return false;
  const point = { x: clientX, y: clientY };
  const radiusSquared = INK_ERASER_RADIUS_PX * INK_ERASER_RADIUS_PX;
  for (const stroke of data.strokes) {
    if (stroke.screenPoints.length === 1) {
      if (
        squaredDistanceBetweenSegments(
          point,
          point,
          stroke.screenPoints[0]!,
          stroke.screenPoints[0]!,
        ) <= radiusSquared
      ) {
        return true;
      }
      continue;
    }
    for (let index = 0; index < stroke.screenPoints.length - 1; index += 1) {
      if (
        squaredDistanceBetweenSegments(
          point,
          point,
          stroke.screenPoints[index]!,
          stroke.screenPoints[index + 1]!,
        ) <= radiusSquared
      ) {
        return true;
      }
    }
  }
  return false;
}
