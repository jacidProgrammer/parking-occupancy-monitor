// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { analyzePhoto, requestTile } from "@/lib/client/analyze-photo";
import type { Detection } from "@/lib/types";
import { fakeCanvas, fakeImage } from "./browser-fakes";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const limited = (retryAfterSeconds?: number) =>
  json(429, { error: { code: "rate_limited", message: "Azure is busy.", retryAfterSeconds } });
const tile = new Blob(["tile"], { type: "image/jpeg" });

describe("requestTile", () => {
  it("posts the tile as a JPEG in the image field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { detections: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestTile(tile)).resolves.toEqual({ detections: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analyze-parking");
    expect(init.method).toBe("POST");
    const file = (init.body as FormData).get("image") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(tile.size);
  });

  it("waits out a short rate limit and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited(2))
      .mockResolvedValueOnce(json(200, { detections: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(requestTile(tile, sleep)).resolves.toEqual({ detections: [] });
    expect(sleep.mock.calls).toEqual([[2000]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("really waits the seconds it was told before retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValueOnce(limited(2)).mockResolvedValueOnce(json(200, { detections: [] }));
      vi.stubGlobal("fetch", fetchMock);
      const result = requestTile(tile);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ detections: [] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a wait of exactly 10 seconds but not a longer one", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(limited(10)).mockResolvedValueOnce(json(200, { detections: [] })));
    await requestTile(tile, sleep);
    expect(sleep).toHaveBeenCalledTimes(1);

    const fetchMock = vi.fn().mockResolvedValue(limited(11));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestTile(tile, sleep)).rejects.toThrow("Azure is busy.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after three retries", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => limited(1));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(requestTile(tile, sleep)).rejects.toThrow("Azure is busy.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rate limit that says nothing about the wait", async () => {
    const fetchMock = vi.fn().mockResolvedValue(limited());
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestTile(tile, vi.fn())).rejects.toThrow("Azure is busy.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message for any other error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(413, { error: { code: "file_too_large", message: "Too big." } })));
    await expect(requestTile(tile)).rejects.toThrow("Too big.");
  });

  it("names the HTTP status when the error has no readable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 500 })));
    await expect(requestTile(tile)).rejects.toThrow("Analysis failed (HTTP 500).");
  });

  it("says the server is unreachable when the request never arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(requestTile(tile)).rejects.toThrow("Could not reach the server. Check your connection and retry.");
  });
});

describe("analyzePhoto", () => {
  const car: Detection = { kind: "car", confidence: 0.9, box: { x: 0.5, y: 0.5, w: 0.1, h: 0.2 } };
  const free: Detection = { kind: "free", confidence: 0.8, box: { x: 0.2, y: 0.2, w: 0.1, h: 0.2 } };

  it("sends the nine tiles one at a time and merges what comes back", async () => {
    fakeImage({ width: 1981, height: 2000 });
    const { drawImage, sizes } = fakeCanvas();
    let inFlight = 0;
    let maxInFlight = 0;
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        call += 1;
        // First tile sees a car and a free bay, the last one a car; the rest nothing.
        return json(200, { detections: call === 1 ? [car, free] : call === 9 ? [car] : [] });
      }),
    );
    const progress: [number, number][] = [];

    const analysis = await analyzePhoto("blob:photo", (done, total) => progress.push([done, total]));

    expect(maxInFlight).toBe(1);
    expect(progress).toEqual(Array.from({ length: 10 }, (_, done) => [done, 9]));
    expect(sizes).toHaveLength(9);
    expect(sizes[0]).toEqual({ width: 792, height: 800 });
    // drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh): first tile from the corner, last from the far one.
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 792, 800, 0, 0, 792, 800]);
    expect(drawImage.mock.calls[8].slice(1)).toEqual([1189, 1200, 792, 800, 0, 0, 792, 800]);
    expect(analysis).toMatchObject({ width: 1981, height: 2000, cars: 2, free: 1 });
    expect(analysis.detections).toContainEqual({ ...car, box: { x: 396, y: 400, w: 79, h: 160 } });
    expect(analysis.detections).toContainEqual({ ...car, box: { x: 1585, y: 1600, w: 79, h: 160 } });
  });

  it("stops at the first tile that fails", async () => {
    fakeImage();
    fakeCanvas();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { detections: [] }))
      .mockResolvedValueOnce(json(502, { error: { code: "azure_error", message: "Azure failed." } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzePhoto("blob:photo", vi.fn())).rejects.toThrow("Azure failed.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says so when the browser cannot decode the image", async () => {
    fakeImage({ decodes: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzePhoto("blob:photo", vi.fn())).rejects.toThrow("This browser could not read the image.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["has no 2D canvas", { context: false }],
    ["cannot encode the tile", { blob: false }],
  ])("says so when the browser %s", async (_, canvas) => {
    fakeImage();
    fakeCanvas(canvas);
    vi.stubGlobal("fetch", vi.fn());
    await expect(analyzePhoto("blob:photo", vi.fn())).rejects.toThrow("This browser could not prepare the photo.");
  });
});
