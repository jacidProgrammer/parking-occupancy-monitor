// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useParkingMonitor } from "@/hooks/use-parking-monitor";
import { analyzePhoto } from "@/lib/client/analyze-photo";
import { HISTORY_KEY, TOTAL_SPACES_KEY, type HistoryEntry } from "@/lib/client/history";
import { makeThumbnail } from "@/lib/client/thumbnail";
import type { ParkingAnalysis } from "@/lib/types";
import { fakeObjectUrls } from "./browser-fakes";

vi.mock("@/lib/client/analyze-photo", () => ({ analyzePhoto: vi.fn() }));
vi.mock("@/lib/client/thumbnail", () => ({ makeThumbnail: vi.fn() }));

const photo = (name = "lot.jpg", type = "image/jpeg") => new File(["x"], name, { type });
const seen = (cars: number, free: number): ParkingAnalysis => ({ width: 100, height: 100, detections: [], cars, free });
const stored = (id: string): HistoryEntry => ({
  id,
  timestamp: "2026-10-05T10:00:00.000Z",
  fileName: `${id}.jpg`,
  vehicles: 12,
  totalSpaces: 40,
});
const savedHistory = () => JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as HistoryEntry[];

let urls: ReturnType<typeof fakeObjectUrls>;

async function mount() {
  const view = renderHook(() => useParkingMonitor());
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  urls = fakeObjectUrls();
  vi.mocked(analyzePhoto).mockReset().mockResolvedValue(seen(59, 118));
  vi.mocked(makeThumbnail).mockReset().mockResolvedValue("data:image/jpeg;base64,thumb");
});

describe("useParkingMonitor", () => {
  it("starts from what the browser had saved", async () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([stored("a")]));
    window.localStorage.setItem(TOTAL_SPACES_KEY, "168");
    const { result } = await mount();
    expect(result.current.history).toEqual([stored("a")]);
    expect(result.current.totalInput).toBe("168");
    expect(result.current.current).toBeNull();
  });

  it("counts the total from the photo when no capacity is typed, and saves the upload", async () => {
    const { result } = await mount();
    await act(() => result.current.analyze(photo()));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({
      fileName: "lot.jpg",
      vehicles: 59,
      totalSpaces: 177,
      totalSource: "detected",
      detectedSpaces: 177,
      thumbnail: "data:image/jpeg;base64,thumb",
    });
    expect(result.current.current).toMatchObject({
      url: "blob:photo-1",
      fileName: "lot.jpg",
      analysis: seen(59, 118),
      entryId: result.current.history[0].id,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.analyzing).toBe(false);
    await waitFor(() => expect(savedHistory()).toEqual(result.current.history));
  });

  it("uses the typed capacity as the total and keeps what the photo showed", async () => {
    const { result } = await mount();
    act(() => result.current.setTotalInput("168"));
    await act(() => result.current.analyze(photo()));
    expect(result.current.history[0]).toMatchObject({ totalSpaces: 168, totalSource: "manual", detectedSpaces: 177 });
  });

  it("shows the photo and the progress while it is being analyzed", async () => {
    let report: (done: number, total: number) => void = () => {};
    let finish: (analysis: ParkingAnalysis) => void = () => {};
    vi.mocked(analyzePhoto).mockImplementation((_, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    const { result } = await mount();
    let pending: Promise<void> = Promise.resolve();
    act(() => void (pending = result.current.analyze(photo())));
    expect(result.current.analyzing).toBe(true);
    expect(result.current.current).toMatchObject({ url: "blob:photo-1", analysis: null, entryId: null });
    act(() => report(4, 9));
    expect(result.current.progress).toEqual({ done: 4, total: 9 });

    // A second photo dropped meanwhile is ignored.
    await act(() => result.current.analyze(photo("other.jpg")));
    expect(analyzePhoto).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(seen(1, 1));
      await pending;
    });
    expect(result.current.analyzing).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it("saves nothing when the model sees neither cars nor bays, even with a capacity typed", async () => {
    vi.mocked(analyzePhoto).mockResolvedValue(seen(0, 0));
    const { result } = await mount();
    act(() => result.current.setTotalInput("100"));
    await act(() => result.current.analyze(photo()));
    expect(result.current.error).toMatch(/^The model found no cars and no free bays in this photo\./);
    expect(result.current.history).toEqual([]);
    expect(result.current.current).toBeNull();
    expect(urls.revoke).toHaveBeenCalledWith("blob:photo-1");
    expect(savedHistory()).toEqual([]);
  });

  it("shows why the analysis failed and drops the photo", async () => {
    vi.mocked(analyzePhoto).mockRejectedValue(new Error("Azure failed."));
    const { result } = await mount();
    await act(() => result.current.analyze(photo()));
    expect(result.current.error).toBe("Azure failed.");
    expect(result.current.current).toBeNull();
    expect(result.current.analyzing).toBe(false);

    vi.mocked(analyzePhoto).mockRejectedValue("not an Error");
    await act(() => result.current.analyze(photo()));
    expect(result.current.error).toBe("Analysis failed.");
  });

  it("clears the previous error when the next photo works", async () => {
    vi.mocked(analyzePhoto).mockRejectedValueOnce(new Error("Azure failed."));
    const { result } = await mount();
    await act(() => result.current.analyze(photo()));
    await act(() => result.current.analyze(photo()));
    expect(result.current.error).toBeNull();
    expect(result.current.history).toHaveLength(1);
  });

  it("refuses a file that is not a photo without calling the server", async () => {
    const { result } = await mount();
    await act(() => result.current.analyze(photo("notes.pdf", "application/pdf")));
    expect(result.current.error).toBe("Unsupported file type. Use JPEG, PNG, GIF, BMP or WEBP.");
    expect(analyzePhoto).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();
  });

  it("blocks uploads and keeps the saved capacity while the typed one is invalid", async () => {
    const { result } = await mount();
    act(() => result.current.setTotalInput("168"));
    await waitFor(() => expect(window.localStorage.getItem(TOTAL_SPACES_KEY)).toBe("168"));
    act(() => result.current.setTotalInput("abc"));
    expect(result.current.totalInvalid).toBe(true);
    await act(() => result.current.analyze(photo()));
    expect(analyzePhoto).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TOTAL_SPACES_KEY)).toBe("168");
  });

  it("forgets the saved capacity when the field is emptied", async () => {
    window.localStorage.setItem(TOTAL_SPACES_KEY, "168");
    const { result } = await mount();
    act(() => result.current.setTotalInput("  "));
    expect(result.current.totalInvalid).toBe(false);
    await waitFor(() => expect(window.localStorage.getItem(TOTAL_SPACES_KEY)).toBeNull());
  });

  it("releases the previous photo when a new one is shown, and the last one on leaving", async () => {
    const { result, unmount } = await mount();
    await act(() => result.current.analyze(photo()));
    expect(urls.revoke).not.toHaveBeenCalled();
    await act(() => result.current.analyze(photo()));
    expect(urls.revoke.mock.calls).toEqual([["blob:photo-1"]]);
    unmount();
    expect(urls.revoke.mock.calls).toEqual([["blob:photo-1"], ["blob:photo-2"]]);
  });

  it("deleting the upload on screen removes its photo; deleting another leaves it", async () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([stored("old")]));
    const { result } = await mount();
    await act(() => result.current.analyze(photo()));
    const shown = result.current.history[0].id;

    act(() => result.current.deleteEntry("old"));
    expect(result.current.history.map((entry) => entry.id)).toEqual([shown]);
    expect(result.current.current?.entryId).toBe(shown);

    act(() => result.current.deleteEntry(shown));
    expect(result.current.history).toEqual([]);
    expect(result.current.current).toBeNull();
    await waitFor(() => expect(savedHistory()).toEqual([]));
  });

  it("clears the history only after confirming, saying how many uploads go", async () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([stored("a"), stored("b")]));
    const { result } = await mount();
    await act(() => result.current.analyze(photo()));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    act(() => result.current.clearHistory());
    expect(confirm).toHaveBeenCalledWith("Delete all 3 uploads from the history?");
    expect(result.current.history).toHaveLength(3);
    expect(result.current.current).not.toBeNull();

    confirm.mockReturnValue(true);
    act(() => result.current.clearHistory());
    expect(result.current.history).toEqual([]);
    expect(result.current.current).toBeNull();
  });

  it("reports when the browser refuses to save the history", async () => {
    const { result } = await mount();
    expect(result.current.notSaved).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await act(() => result.current.analyze(photo()));
    await waitFor(() => expect(result.current.notSaved).toBe(true));
    expect(result.current.history).toHaveLength(1);
  });
});
