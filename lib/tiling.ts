import type { Box, Detection } from "./types";

// The model was trained on images where a car is 10–25 % of the side. A drone photo of a
// whole lot has them far smaller, so the photo is analyzed as a grid of enlarged tiles.
export const TILE_GRID = 3;
// Neighbouring tiles share this much of a tile, which must be more than one car length:
// a car cut by a tile edge is then whole in the neighbour.
export const TILE_OVERLAP = 0.25;

/** A box closer than this share of the tile to an edge counts as touching it. */
const EDGE_MARGIN = 0.01;
const DUPLICATE_IOU = 0.5;
// The model sometimes returns one bay twice, the second box shifted by half a bay (40–70 %
// of the smaller box shared). Neighbouring bays with loose boxes share up to about 35 %.
const DUPLICATE_COVERAGE = 0.4;

export interface TileResult {
  /** Where the tile sits on the photo, in pixels. */
  rect: Box;
  /** Boxes as fractions of the tile. */
  detections: Detection[];
}

function axis(length: number, grid: number, overlap: number): [number, number][] {
  const size = Math.round(length / (grid - (grid - 1) * overlap));
  const step = grid > 1 ? (length - size) / (grid - 1) : 0;
  return Array.from({ length: grid }, (_, i) => [Math.round(i * step), size]);
}

/** Row by row, `grid`×`grid` tiles covering the photo edge to edge. */
export function tileRects(width: number, height: number, grid: number, overlap: number): Box[] {
  const columns = axis(width, grid, overlap);
  return axis(height, grid, overlap).flatMap(([y, h]) => columns.map(([x, w]) => ({ x, y, w, h })));
}

function touchesInnerEdge(box: Box, rect: Box, width: number, height: number): boolean {
  return (
    (rect.x > 0 && box.x <= EDGE_MARGIN) ||
    (rect.y > 0 && box.y <= EDGE_MARGIN) ||
    (rect.x + rect.w < width && box.x + box.w >= 1 - EDGE_MARGIN) ||
    (rect.y + rect.h < height && box.y + box.h >= 1 - EDGE_MARGIN)
  );
}

function isSameObject(a: Box, b: Box): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return false;
  const intersection = w * h;
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  return (
    intersection / (areaA + areaB - intersection) >= DUPLICATE_IOU ||
    intersection / Math.min(areaA, areaB) >= DUPLICATE_COVERAGE
  );
}

/**
 * One list of detections for the whole photo, in pixels: boxes cut by a tile edge are
 * dropped (the neighbouring tile has them whole) and an object seen by several tiles, or
 * read as both car and free, is kept once with its most confident reading.
 */
export function mergeTiles(results: TileResult[], width: number, height: number): Detection[] {
  const candidates = results.flatMap(({ rect, detections }) =>
    detections
      .filter((detection) => !touchesInnerEdge(detection.box, rect, width, height))
      .map((detection) => ({
        ...detection,
        box: {
          x: Math.round(rect.x + detection.box.x * rect.w),
          y: Math.round(rect.y + detection.box.y * rect.h),
          w: Math.round(detection.box.w * rect.w),
          h: Math.round(detection.box.h * rect.h),
        },
      })),
  );
  const kept: Detection[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some((other) => isSameObject(candidate.box, other.box))) kept.push(candidate);
  }
  return kept;
}
