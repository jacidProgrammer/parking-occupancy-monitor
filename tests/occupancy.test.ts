import { describe, expect, it } from "vitest";
import { computeOccupancy, parseTotalSpaces, resolveTotal, statusFor } from "@/lib/occupancy";

describe("computeOccupancy", () => {
  it("derives occupied, free and percent", () => {
    expect(computeOccupancy(12, 40)).toEqual({
      total: 40,
      occupied: 12,
      free: 28,
      percent: 30,
      overflow: 0,
      status: "green",
    });
  });

  it("rounds the percent to one decimal", () => {
    expect(computeOccupancy(1, 3).percent).toBe(33.3);
  });

  it("handles an empty lot", () => {
    expect(computeOccupancy(0, 40)).toMatchObject({ occupied: 0, free: 40, percent: 0, status: "green" });
  });

  it("caps at 100% and reports the surplus when more vehicles than spaces are detected", () => {
    expect(computeOccupancy(14, 10)).toEqual({
      total: 10,
      occupied: 10,
      free: 0,
      percent: 100,
      overflow: 4,
      status: "red",
    });
  });
});

describe("statusFor", () => {
  it.each([
    [0, "green"],
    [49.9, "green"],
    [50, "yellow"],
    [80, "yellow"],
    [80.1, "red"],
    [100, "red"],
  ] as const)("%s%% is %s", (percent, status) => expect(statusFor(percent)).toBe(status));
});

describe("parseTotalSpaces", () => {
  it.each([
    ["40", 40],
    [" 1 ", 1],
    ["10000", 10000],
  ])("accepts %j", (input, value) => expect(parseTotalSpaces(input)).toBe(value));

  it.each(["", "0", "-5", "2.5", "abc", "12abc", "1e3", "10001"])("rejects %j", (input) =>
    expect(parseTotalSpaces(input)).toBeNull(),
  );
});

describe("resolveTotal", () => {
  it("uses cars plus free bays seen in the photo when no capacity was entered", () => {
    expect(resolveTotal(70, 112, null)).toEqual({ total: 182, source: "detected", detected: 182, mismatch: false });
  });

  it("lets an entered capacity win", () => {
    expect(resolveTotal(70, 112, 180)).toEqual({ total: 180, source: "manual", detected: 182, mismatch: false });
  });

  it("flags an entered capacity more than 10 % away from what the photo shows", () => {
    expect(resolveTotal(70, 112, 168)?.mismatch).toBe(false); // 182 is 8.3 % over 168
    expect(resolveTotal(70, 112, 160)?.mismatch).toBe(true); // 13.8 % over
    expect(resolveTotal(70, 112, 210)?.mismatch).toBe(true); // 13.3 % under
  });

  it("has no total when the photo shows neither cars nor free bays, entered capacity or not", () => {
    expect(resolveTotal(0, 0, null)).toBeNull();
    expect(resolveTotal(0, 0, 40)).toBeNull();
  });

  it("is an empty lot, not an error, when only free bays are seen", () => {
    expect(resolveTotal(0, 30, null)).toEqual({ total: 30, source: "detected", detected: 30, mismatch: false });
  });
});
