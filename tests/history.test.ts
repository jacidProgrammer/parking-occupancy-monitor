import { describe, expect, it } from "vitest";
import {
  addEntry,
  explainTotal,
  hasCapacityMismatch,
  HISTORY_KEY,
  loadHistory,
  loadTotalSpaces,
  MAX_HISTORY,
  saveHistory,
  saveTotalSpaces,
  type HistoryEntry,
} from "@/lib/client/history";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const entry = (id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  timestamp: "2026-10-05T10:00:00.000Z",
  fileName: `${id}.jpg`,
  vehicles: 12,
  totalSpaces: 40,
  ...overrides,
});

describe("history storage", () => {
  it("round-trips entries", () => {
    const storage = memoryStorage();
    const history = [entry("b", { thumbnail: "data:image/jpeg;base64,xx" }), entry("a")];
    expect(saveHistory(storage, history)).toBe(true);
    expect(loadHistory(storage)).toEqual(history);
  });

  it("round-trips where the total came from", () => {
    const storage = memoryStorage();
    const history = [entry("a", { totalSource: "detected", detectedSpaces: 40 })];
    saveHistory(storage, history);
    expect(loadHistory(storage)).toEqual(history);
  });

  it("is empty when nothing was saved", () => {
    expect(loadHistory(memoryStorage())).toEqual([]);
  });

  it("is empty when the stored value is not JSON or not an array", () => {
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: "{oops" }))).toEqual([]);
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: '{"a":1}' }))).toEqual([]);
  });

  it("drops malformed entries and keeps the valid ones", () => {
    const stored = JSON.stringify([
      entry("ok"),
      { id: "no-total", timestamp: "2026-10-05T10:00:00.000Z", fileName: "x", vehicles: 3 },
      { ...entry("zero-total"), totalSpaces: 0 },
      { ...entry("negative"), vehicles: -1 },
      { ...entry("bad-date"), timestamp: "yesterday" },
      { ...entry("bad-source"), totalSource: "guessed" },
      { ...entry("bad-detected"), detectedSpaces: -3 },
      null,
    ]);
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: stored })).map((e) => e.id)).toEqual(["ok"]);
  });

  it("reports failure instead of throwing when the quota is exceeded", () => {
    const storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(saveHistory(storage, [entry("a")])).toBe(false);
  });
});

describe("addEntry", () => {
  it("puts the newest entry first", () => {
    expect(addEntry([entry("old")], entry("new")).map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("drops the oldest entries beyond the cap", () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => entry(`e${i}`));
    const next = addEntry(full, entry("new"));
    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0].id).toBe("new");
    expect(next.at(-1)!.id).toBe(`e${MAX_HISTORY - 2}`);
  });
});

describe("total spaces", () => {
  it("round-trips", () => {
    const storage = memoryStorage();
    saveTotalSpaces(storage, 40);
    expect(loadTotalSpaces(storage)).toBe(40);
  });

  it("forgets the capacity when it is cleared", () => {
    const storage = memoryStorage();
    saveTotalSpaces(storage, 40);
    saveTotalSpaces(storage, null);
    expect(loadTotalSpaces(storage)).toBeNull();
    expect(storage.getItem("parking-monitor:total-spaces:v1")).toBeNull();
  });

  it("is null when missing or invalid", () => {
    expect(loadTotalSpaces(memoryStorage())).toBeNull();
    expect(loadTotalSpaces(memoryStorage({ "parking-monitor:total-spaces:v1": "0" }))).toBeNull();
  });
});

describe("explainTotal", () => {
  it("shows the sum when the total was counted in the photo", () => {
    expect(explainTotal(entry("a", { vehicles: 59, totalSpaces: 177, totalSource: "detected", detectedSpaces: 177 }))).toBe(
      "Total counted in the photo: 59 cars + 118 free bays = 177 spaces.",
    );
  });

  it("shows both numbers when the capacity was typed", () => {
    expect(explainTotal(entry("a", { vehicles: 59, totalSpaces: 168, totalSource: "manual", detectedSpaces: 177 }))).toBe(
      "Total entered by you: 168. The photo shows 59 cars + 118 free bays = 177 spaces.",
    );
  });

  it("claims nothing about the photo for entries saved before it was counted", () => {
    expect(explainTotal(entry("a"))).toBe("Total entered by you: 40.");
  });
});

describe("hasCapacityMismatch", () => {
  const typed = (detectedSpaces: number) => entry("a", { totalSpaces: 100, totalSource: "manual", detectedSpaces });

  it("is true when the typed capacity and the photo differ by more than 10 %", () => {
    expect(hasCapacityMismatch(typed(111))).toBe(true);
    expect(hasCapacityMismatch(typed(110))).toBe(false);
  });

  it("is false when the total came from the photo or the photo was not counted", () => {
    expect(hasCapacityMismatch(entry("a", { totalSpaces: 100, totalSource: "detected", detectedSpaces: 150 }))).toBe(false);
    expect(hasCapacityMismatch(entry("a", { totalSpaces: 100, totalSource: "manual" }))).toBe(false);
  });
});

describe("storage that fails", () => {
  const broken = {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
    removeItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  };

  it("reads as nothing saved", () => {
    expect(loadHistory(broken)).toEqual([]);
    expect(loadTotalSpaces(broken)).toBeNull();
  });

  it("does not break the page when the capacity cannot be saved or forgotten", () => {
    expect(() => saveTotalSpaces(broken, 40)).not.toThrow();
    expect(() => saveTotalSpaces(broken, null)).not.toThrow();
  });
});
