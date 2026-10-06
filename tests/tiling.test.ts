import { describe, expect, it } from "vitest";
import { mergeTiles, tileRects, type TileResult } from "@/lib/tiling";
import type { Detection } from "@/lib/types";

const det = (kind: Detection["kind"], x: number, y: number, w: number, h: number, confidence = 0.9): Detection => ({
  kind,
  confidence,
  box: { x, y, w, h },
});

describe("tileRects", () => {
  it("is the whole image for a 1×1 grid", () => {
    expect(tileRects(800, 600, 1, 0.2)).toEqual([{ x: 0, y: 0, w: 800, h: 600 }]);
  });

  it("covers the image edge to edge with n×n tiles", () => {
    const tiles = tileRects(2600, 1300, 3, 0.2);
    expect(tiles).toHaveLength(9);
    expect(Math.min(...tiles.map((t) => t.x))).toBe(0);
    expect(Math.min(...tiles.map((t) => t.y))).toBe(0);
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(2600);
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBe(1300);
  });

  it("overlaps neighbouring tiles by the requested share of a tile", () => {
    const tiles = tileRects(2600, 1300, 3, 0.2);
    // 2600 / (3 − 2·0.2) = 1000 px wide, stepping 800 px.
    expect(tiles.slice(0, 3).map((t) => [t.x, t.w])).toEqual([
      [0, 1000],
      [800, 1000],
      [1600, 1000],
    ]);
    expect(tiles[3]).toEqual({ x: 0, y: 400, w: 1000, h: 500 });
  });
});

describe("mergeTiles", () => {
  // Two 1000×500 tiles side by side on a 1800×500 image, sharing x 800–1000.
  const left = { x: 0, y: 0, w: 1000, h: 500 };
  const right = { x: 800, y: 0, w: 1000, h: 500 };
  const merge = (results: TileResult[]) => mergeTiles(results, 1800, 500);

  it("places tile fractions on the photo in pixels", () => {
    const merged = merge([
      { rect: left, detections: [] },
      { rect: right, detections: [det("car", 0.5, 0.2, 0.1, 0.4)] },
    ]);
    expect(merged).toEqual([det("car", 1300, 100, 100, 200)]);
  });

  it("counts once a car that two tiles both see whole", () => {
    const merged = merge([
      { rect: left, detections: [det("car", 0.85, 0.2, 0.1, 0.4, 0.7)] }, // x 850–950
      { rect: right, detections: [det("car", 0.052, 0.2, 0.1, 0.4, 0.95)] }, // x 852–952
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.95);
  });

  it("drops the half of a car cut by an inner tile edge and keeps the whole one from the neighbour", () => {
    const merged = merge([
      { rect: left, detections: [det("car", 0.93, 0.2, 0.07, 0.4)] }, // x 930–1000: touches the cut
      { rect: right, detections: [det("car", 0.13, 0.2, 0.12, 0.4)] }, // x 930–1050: whole
    ]);
    expect(merged).toEqual([det("car", 930, 100, 120, 200)]);
  });

  it("keeps a box that touches the real border of the photo", () => {
    const merged = merge([
      { rect: left, detections: [det("car", 0, 0, 0.1, 0.4)] },
      { rect: right, detections: [det("free", 0.9, 0.6, 0.1, 0.4)] },
    ]);
    expect(merged.map((d) => d.kind)).toEqual(["car", "free"]);
  });

  it("keeps two different cars parked side by side", () => {
    const merged = merge([
      { rect: left, detections: [det("car", 0.3, 0.2, 0.1, 0.4), det("car", 0.41, 0.2, 0.1, 0.4)] },
      { rect: right, detections: [] },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("counts once a free bay the model returns twice, shifted by half a bay", () => {
    const merged = merge([
      { rect: left, detections: [det("free", 0.3, 0.2, 0.1, 0.4, 0.9), det("free", 0.35, 0.2, 0.1, 0.4, 0.4)] },
      { rect: right, detections: [] },
    ]);
    expect(merged).toEqual([det("free", 300, 100, 100, 200, 0.9)]);
  });

  it("keeps neighbouring bays whose loose boxes share 30 % of a bay", () => {
    const merged = merge([
      { rect: left, detections: [det("free", 0.3, 0.2, 0.1, 0.4), det("free", 0.37, 0.2, 0.1, 0.4)] },
      { rect: right, detections: [] },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps the more confident reading when a bay is seen as both car and free", () => {
    const merged = merge([
      { rect: left, detections: [det("free", 0.3, 0.2, 0.1, 0.4, 0.4), det("car", 0.305, 0.2, 0.1, 0.4, 0.8)] },
      { rect: right, detections: [] },
    ]);
    expect(merged.map((d) => d.kind)).toEqual(["car"]);
  });
});
