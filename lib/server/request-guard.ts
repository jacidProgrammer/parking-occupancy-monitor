import { clientIp, createRateLimiter, type RateLimiter } from "./rate-limit";
import { TILE_GRID } from "../tiling";

const HOUR_MS = 60 * 60 * 1000;
const TILES_PER_PHOTO = TILE_GRID * TILE_GRID;

/** One visitor (one IP address): 10 photos an hour. */
export const VISITOR_REQUESTS_PER_HOUR = 10 * TILES_PER_PHOTO;
// Everyone together: 300 predictions a day keeps a 31-day month under the 10,000
// predictions of the Custom Vision free tier.
export const TOTAL_REQUESTS_PER_DAY = 300;

interface Guards {
  visitor: RateLimiter;
  total: RateLimiter;
}

// On globalThis so that a hot reload in development does not hand out a fresh allowance.
const store = globalThis as typeof globalThis & { __parkingGuards?: Guards };
const guards: Guards = (store.__parkingGuards ??= {
  visitor: createRateLimiter({ limit: VISITOR_REQUESTS_PER_HOUR, windowMs: HOUR_MS }),
  total: createRateLimiter({ limit: TOTAL_REQUESTS_PER_DAY, windowMs: 24 * HOUR_MS, maxKeys: 1 }),
});

export type GuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string; retryAfterSeconds: number };

function wait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}

/** Counts the request against the visitor's hourly allowance and the app's daily one. */
export function checkRateLimit(request: Request): GuardResult {
  // The visitor first: a visitor who is already over their limit must not eat into the
  // allowance everyone shares.
  const visitor = guards.visitor.take(clientIp(request));
  if (!visitor.ok) {
    return {
      ok: false,
      code: "too_many_requests",
      message: `This demo allows ${VISITOR_REQUESTS_PER_HOUR / TILES_PER_PHOTO} photos per hour per visitor. Try again in ${wait(visitor.retryAfterSeconds)}.`,
      retryAfterSeconds: visitor.retryAfterSeconds,
    };
  }
  const total = guards.total.take("all");
  if (!total.ok) {
    return {
      ok: false,
      code: "daily_limit_reached",
      message: `This demo has used up its analyses for today. Try again in ${wait(total.retryAfterSeconds)}.`,
      retryAfterSeconds: total.retryAfterSeconds,
    };
  }
  return { ok: true };
}

export function resetRateLimits(): void {
  guards.visitor.reset();
  guards.total.reset();
}
