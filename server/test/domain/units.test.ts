import { describe, expect, it } from "vitest";
import { D } from "../../src/domain/decimal";
import { UNITS, convert, parseUnit, parseWeight, toGrams, type UnitId } from "../../src/domain/units";

const EXPECTED_GRAMS: Record<UnitId, string> = {
  g: "1",
  kg: "1000",
  mg: "0.001",
  ozt: "31.1034768",
  oz_av: "28.349523125",
  dwt: "1.55517384",
  grain: "0.06479891",
  tola: "11.6638038",
  baht_jewellery: "15.16",
  baht_bullion: "15.244",
  tael_hk: "37.429",
  tael_tw: "37.5",
};

const IDS = Object.keys(UNITS) as UnitId[];

describe("units", () => {
  it("covers exactly the expected units, each with a cited source", () => {
    expect(IDS.sort()).toEqual(Object.keys(EXPECTED_GRAMS).sort());
    for (const id of IDS) expect(UNITS[id].source.length).toBeGreaterThan(10);
  });

  it.each(IDS)("converts 1 %s to its table value in grams", (id) => {
    expect(toGrams(new D(1), id).toFixed()).toBe(EXPECTED_GRAMS[id]);
    expect(convert(new D(1), id, "g").toFixed()).toBe(EXPECTED_GRAMS[id]);
  });

  it("returns the original value to 20 significant digits after converting to every unit and back", () => {
    for (const x of ["1", "12.4", "0.001", "7", "3.14159", "999999.99", "0.000123456789"]) {
      for (const a of IDS) {
        for (const b of IDS) {
          const back = convert(convert(new D(x), a, b), b, a).toSignificantDigits(20);
          expect(back.toFixed(), `${x} ${a}->${b}->${a}`).toBe(new D(x).toFixed());
        }
      }
    }
  });

  it("converts a troy ounce to pennyweights and grains exactly", () => {
    expect(convert(new D(1), "ozt", "dwt").toFixed()).toBe("20");
    expect(convert(new D(1), "ozt", "grain").toFixed()).toBe("480");
    expect(convert(new D(1), "tola", "grain").toFixed()).toBe("180");
  });
});

describe("parseUnit", () => {
  it("accepts unit ids in any case and with spaces", () => {
    expect(parseUnit(" OZT ")).toEqual({ ok: true, value: "ozt" });
    expect(parseUnit("tola")).toEqual({ ok: true, value: "tola" });
  });

  it.each([
    ["oz", ["oz_av", "ozt"]],
    ["ounce", ["oz_av", "ozt"]],
    ["baht", ["baht_jewellery", "baht_bullion"]],
    ["Tael", ["tael_hk", "tael_tw"]],
  ])("rejects %s as ambiguous and names both options", (text, options) => {
    const result = parseUnit(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ambiguous_unit");
    for (const option of options) expect(result.error.fix).toContain(option);
  });

  it("rejects an unknown unit and suggests the nearest ids", () => {
    const result = parseUnit("ozz");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown_unit");
    expect(result.error.fix).toContain("ozt");
  });

  it("rejects inherited object keys as unknown units", () => {
    const result = parseUnit("constructor");
    expect(result.ok ? null : result.error.code).toBe("unknown_unit");
  });
});

describe("parseWeight", () => {
  it.each(["0", "-1", "abc", "", "1e3", "NaN"])("rejects %j", (text) => {
    const result = parseWeight(text);
    expect(result.ok ? null : result.error.code).toBe("invalid_weight");
  });

  it("rejects non-finite numbers", () => {
    const result = parseWeight(Number.POSITIVE_INFINITY);
    expect(result.ok ? null : result.error.code).toBe("invalid_weight");
  });

  it("accepts a positive decimal", () => {
    const result = parseWeight("12.40");
    expect(result.ok && result.value.toFixed()).toBe("12.4");
  });
});
