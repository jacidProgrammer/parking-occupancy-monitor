import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

describe("createRateLimiter", () => {
  it("lets through up to the limit and then refuses", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 }, clock().now);
    expect([1, 2, 3].map(() => limiter.take("a").ok)).toEqual([true, true, true]);
    expect(limiter.take("a").ok).toBe(false);
  });

  it("says how long until the window reopens", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, time.now);
    limiter.take("a");
    time.advance(15_500);
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 45 });
  });

  it("starts over when the window has passed", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, time.now);
    limiter.take("a");
    expect(limiter.take("a").ok).toBe(false);
    time.advance(60_000);
    expect(limiter.take("a").ok).toBe(true);
  });

  it("counts each key on its own", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clock().now);
    limiter.take("a");
    expect(limiter.take("a").ok).toBe(false);
    expect(limiter.take("b").ok).toBe(true);
  });

  it("does not count a refused request against the next window", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, time.now);
    limiter.take("a");
    for (let i = 0; i < 50; i += 1) limiter.take("a");
    time.advance(60_000);
    expect(limiter.take("a").ok).toBe(true);
  });

  it("forgets expired keys instead of growing without bound", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 }, time.now);
    for (let i = 0; i < 100; i += 1) limiter.take(`old-${i}`);
    time.advance(60_000);
    limiter.take("new");
    expect(limiter.size()).toBe(1);
  });

  it("refuses new keys rather than exceed its memory bound while none has expired", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 }, clock().now);
    for (let i = 0; i < 100; i += 1) limiter.take(`k-${i}`);
    expect(limiter.take("one-more").ok).toBe(false);
    expect(limiter.take("k-0").ok).toBe(true);
    expect(limiter.size()).toBe(100);
  });
});

describe("clientIp", () => {
  const withHeader = (value?: string) =>
    new Request("http://localhost/", { headers: value ? { "x-forwarded-for": value } : {} });

  it("reads the address Azure's front end appends, without the port", () => {
    expect(clientIp(withHeader("203.0.113.7:51234"))).toBe("203.0.113.7");
  });

  it("uses the last entry: earlier ones are whatever the caller chose to send", () => {
    expect(clientIp(withHeader("1.2.3.4, 9.9.9.9, 203.0.113.7:51234"))).toBe("203.0.113.7");
  });

  it("keeps an IPv6 address whole", () => {
    expect(clientIp(withHeader("[2001:db8::1]:51234"))).toBe("2001:db8::1");
    expect(clientIp(withHeader("2001:db8::1"))).toBe("2001:db8::1");
  });

  it("groups requests with no forwarded address under one key", () => {
    expect(clientIp(withHeader())).toBe("unknown");
  });
});
