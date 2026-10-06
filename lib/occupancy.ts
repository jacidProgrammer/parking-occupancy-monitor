export type OccupancyStatus = "green" | "yellow" | "red";

export interface Occupancy {
  total: number;
  /** Detected vehicles, capped at `total`. */
  occupied: number;
  free: number;
  /** 0–100, one decimal. */
  percent: number;
  /** Vehicles detected beyond the declared capacity. */
  overflow: number;
  status: OccupancyStatus;
}

export const MAX_TOTAL_SPACES = 10_000;

export const STATUS: Record<OccupancyStatus, { label: string; color: string }> = {
  green: { label: "Plenty of space", color: "#16a34a" },
  yellow: { label: "Filling up", color: "#ca8a04" },
  red: { label: "Almost full", color: "#dc2626" },
};

/** Green below 50 %, yellow from 50 % to 80 %, red above 80 %. */
export function statusFor(percent: number): OccupancyStatus {
  if (percent < 50) return "green";
  if (percent <= 80) return "yellow";
  return "red";
}

export function computeOccupancy(vehicles: number, total: number): Occupancy {
  const occupied = Math.min(vehicles, total);
  const percent = Math.round((occupied / total) * 1000) / 10;
  return {
    total,
    occupied,
    free: total - occupied,
    percent,
    overflow: Math.max(0, vehicles - total),
    status: statusFor(percent),
  };
}

export interface ResolvedTotal {
  total: number;
  /** "manual": the capacity the user typed. "detected": cars plus free bays seen in the photo. */
  source: "manual" | "detected";
  /** Cars plus free bays seen in the photo. */
  detected: number;
  /** The typed capacity is more than 10 % away from what the photo shows. */
  mismatch: boolean;
}

const MISMATCH_TOLERANCE = 0.1;

export function isMismatch(manual: number, detected: number): boolean {
  return Math.abs(detected - manual) / manual > MISMATCH_TOLERANCE;
}

/**
 * A typed capacity wins; otherwise the total is what the photo shows. Null when the model
 * saw neither cars nor free bays: an empty lot still shows its bays, so that is a photo
 * the model does not understand, not 0 % occupancy.
 */
export function resolveTotal(cars: number, free: number, manual: number | null): ResolvedTotal | null {
  const detected = cars + free;
  if (detected === 0) return null;
  if (manual !== null) {
    return { total: manual, source: "manual", detected, mismatch: isMismatch(manual, detected) };
  }
  return { total: detected, source: "detected", detected, mismatch: false };
}

export function parseTotalSpaces(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_TOTAL_SPACES ? value : null;
}

export function formatPercent(percent: number): string {
  return `${percent}%`;
}
