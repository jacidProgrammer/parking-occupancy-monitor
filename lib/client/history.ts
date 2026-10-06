import { isMismatch, parseTotalSpaces } from "../occupancy";

/** One analyzed upload. Occupancy is derived from `vehicles` and `totalSpaces`, never stored. */
export interface HistoryEntry {
  id: string;
  /** ISO 8601. */
  timestamp: string;
  fileName: string;
  /** Cars detected. */
  vehicles: number;
  /** Total the occupancy was computed against when this upload was analyzed. */
  totalSpaces: number;
  /** Where `totalSpaces` came from. Absent in entries saved before the photo could be counted: those were typed. */
  totalSource?: "manual" | "detected";
  /** Cars plus free bays the model saw in the photo. */
  detectedSpaces?: number;
  /** Small JPEG data URL; the full image is not kept. */
  thumbnail?: string;
}

export const HISTORY_KEY = "parking-monitor:history:v1";
export const TOTAL_SPACES_KEY = "parking-monitor:total-spaces:v1";
export const MAX_HISTORY = 50;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    !Number.isNaN(Date.parse(entry.timestamp)) &&
    typeof entry.fileName === "string" &&
    isCount(entry.vehicles) &&
    isCount(entry.totalSpaces) &&
    entry.totalSpaces >= 1 &&
    (entry.totalSource === undefined || entry.totalSource === "manual" || entry.totalSource === "detected") &&
    (entry.detectedSpaces === undefined || isCount(entry.detectedSpaces)) &&
    (entry.thumbnail === undefined || typeof entry.thumbnail === "string")
  );
}

/** Newest first. */
export function loadHistory(storage: Store): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** False when the browser refused the write (quota, private mode). */
export function saveHistory(storage: Store, history: HistoryEntry[]): boolean {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

export function addEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history].slice(0, MAX_HISTORY);
}

export function loadTotalSpaces(storage: Store): number | null {
  try {
    return parseTotalSpaces(storage.getItem(TOTAL_SPACES_KEY) ?? "");
  } catch {
    return null;
  }
}

/** Null forgets the capacity: the total is then counted from each photo. */
export function saveTotalSpaces(storage: Store, total: number | null): void {
  try {
    if (total === null) storage.removeItem(TOTAL_SPACES_KEY);
    else storage.setItem(TOTAL_SPACES_KEY, String(total));
  } catch {
    // Not persisted; the value still applies for this session.
  }
}

/** Where the total of an upload comes from, in words. */
export function explainTotal(entry: HistoryEntry): string {
  const detected = entry.detectedSpaces;
  const seen =
    detected === undefined
      ? null
      : `${entry.vehicles} cars + ${detected - entry.vehicles} free bays = ${detected} spaces`;
  if (entry.totalSource === "detected") return `Total counted in the photo: ${seen}.`;
  return seen
    ? `Total entered by you: ${entry.totalSpaces}. The photo shows ${seen}.`
    : `Total entered by you: ${entry.totalSpaces}.`;
}

/** Whether a typed capacity disagrees with what the photo showed. */
export function hasCapacityMismatch(entry: HistoryEntry): boolean {
  return (
    entry.totalSource === "manual" &&
    entry.detectedSpaces !== undefined &&
    isMismatch(entry.totalSpaces, entry.detectedSpaces)
  );
}
