import { describe, expect, it } from "vitest";
import { D } from "../../src/domain/decimal";
import { parseCurrency } from "../../src/domain/money";
import { LOCAL_ADJUSTMENTS, localEstimate, type LocalAdjustment } from "../../src/rates/local";

const INR = parseCurrency("INR")!;
const SOURCE = { url: "https://example.gov/notification", retrieved: "2026-11-14" };
const TABLE: Record<string, LocalAdjustment> = { ZZ: { duty: "0.15", tax: "0.03", source: SOURCE } };

describe("localEstimate", () => {
  it("applies duty, then tax, and labels the value as an estimate with its source", () => {
    expect(localEstimate({ value: new D("10000"), currency: INR }, "zz", TABLE)).toEqual({
      value: "11845.00",
      currency: "INR",
      label: "estimated",
      note: "Spot plus ZZ import duty and tax. This is an estimate, not an official local rate.",
      source: SOURCE,
    });
  });

  it("returns no estimate for a country outside the table", () => {
    expect(localEstimate({ value: new D("10000"), currency: INR }, "US", TABLE)).toBeUndefined();
  });

  it("ships no India entry until an official source confirms its duty and tax", () => {
    expect(LOCAL_ADJUSTMENTS).toEqual({});
    expect(localEstimate({ value: new D("10000"), currency: INR }, "IN")).toBeUndefined();
  });
});
