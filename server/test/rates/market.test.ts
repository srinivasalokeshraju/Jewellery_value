import { describe, expect, it } from "vitest";
import { isMarketClosed } from "../../src/rates/market";

describe("isMarketClosed", () => {
  it.each([
    ["2026-11-13T21:59:59.999Z", "Friday one moment before 22.00 UTC", false],
    ["2026-11-13T22:00:00.000Z", "Friday at 22.00 UTC", true],
    ["2026-11-14T12:00:00.000Z", "Saturday noon", true],
    ["2026-11-15T21:59:59.999Z", "Sunday one moment before 22.00 UTC", true],
    ["2026-11-15T22:00:00.000Z", "Sunday at 22.00 UTC", false],
    ["2026-11-16T03:00:00.000Z", "Monday early", false],
    ["2026-11-18T23:30:00.000Z", "Wednesday late", false],
  ])("%s, %s, is closed: %s", (iso, _label, closed) => {
    expect(isMarketClosed(new Date(iso))).toBe(closed);
  });
});
