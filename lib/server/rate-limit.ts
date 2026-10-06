export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one request for `key`, or refuses it when the key has used up its window. */
  take(key: string): RateLimitResult;
  size(): number;
  reset(): void;
}

/**
 * Fixed-window counter kept in memory: enough for one server instance, which is all the
 * free App Service tier runs. It starts from zero when the app restarts.
 */
export function createRateLimiter(
  { limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number },
  now: () => number = () => Date.now(),
): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    take(key) {
      const time = now();
      let current = windows.get(key);
      if (current && current.resetAt <= time) {
        windows.delete(key);
        current = undefined;
      }
      if (!current) {
        if (windows.size >= maxKeys) {
          windows.forEach((entry, other) => {
            if (entry.resetAt <= time) windows.delete(other);
          });
        }
        // Still full of live keys: refuse rather than let the map grow without bound.
        if (windows.size >= maxKeys) return { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        windows.set(key, { count: 1, resetAt: time + windowMs });
        return { ok: true };
      }
      if (current.count >= limit) {
        return { ok: false, retryAfterSeconds: Math.ceil((current.resetAt - time) / 1000) };
      }
      current.count += 1;
      return { ok: true };
    },
    size: () => windows.size,
    reset: () => windows.clear(),
  };
}

/**
 * The caller's address as seen by the proxy in front of the app. Azure App Service appends
 * it to X-Forwarded-For as "ip:port", so only the last entry can be trusted.
 */
export function clientIp(request: Request): string {
  const last = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  if (!last) return "unknown";
  const bracketed = last.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  // One colon means IPv4 with a port; more than one is a bare IPv6 address.
  return last.split(":").length === 2 ? last.split(":")[0] : last;
}
