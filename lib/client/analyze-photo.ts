import { mergeTiles, TILE_GRID, TILE_OVERLAP, tileRects, type TileResult } from "../tiling";
import type { AnalyzeTileResponse, ApiErrorBody, Box, ParkingAnalysis } from "../types";

const MAX_RATE_LIMIT_RETRIES = 3;

function cropToJpeg(image: HTMLImageElement, rect: Box): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the photo.");
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser could not prepare the photo."))),
      "image/jpeg",
      0.92,
    ),
  );
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends one tile; a short rate-limit wait is slept through, anything else is an error. */
export async function requestTile(tile: Blob, sleep = pause): Promise<AnalyzeTileResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const form = new FormData();
    form.set("image", new File([tile], "tile.jpg", { type: "image/jpeg" }));
    let res: Response;
    try {
      res = await fetch("/api/analyze-parking", { method: "POST", body: form });
    } catch {
      throw new Error("Could not reach the server. Check your connection and retry.");
    }
    if (res.ok) return (await res.json()) as AnalyzeTileResponse;
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const wait = body?.error?.retryAfterSeconds;
    // The free tier allows 2 predictions per second; a short wait is part of normal use.
    if (res.status === 429 && wait && wait <= 10 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(body?.error?.message ?? `Analysis failed (HTTP ${res.status}).`);
  }
}

/**
 * Cuts the photo at `src` into overlapping tiles, sends them one at a time and merges
 * what the model found into one list in the photo's own pixels.
 */
export async function analyzePhoto(
  src: string,
  onProgress: (done: number, total: number) => void,
): Promise<ParkingAnalysis> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    throw new Error("This browser could not read the image.");
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const rects = tileRects(width, height, TILE_GRID, TILE_OVERLAP);
  const results: TileResult[] = [];
  onProgress(0, rects.length);
  for (const rect of rects) {
    const { detections } = await requestTile(await cropToJpeg(image, rect));
    results.push({ rect, detections });
    onProgress(results.length, rects.length);
  }
  const detections = mergeTiles(results, width, height);
  return {
    width,
    height,
    detections,
    cars: detections.filter((detection) => detection.kind === "car").length,
    free: detections.filter((detection) => detection.kind === "free").length,
  };
}
