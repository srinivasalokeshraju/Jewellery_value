import { describe, expect, it } from "vitest";
import { D } from "../../src/domain/decimal";
import { parsePurity } from "../../src/domain/purity";
import { UNITS } from "../../src/domain/units";
import { MemoryCache } from "../../src/rates/cache";
import { fail, ok } from "../../src/rates/types";
import { calcMeltValue, type CalcMeltValueInput } from "../../src/tools/calcMeltValue";
import { convertWeight } from "../../src/tools/convertWeight";
import { getMetalRate } from "../../src/tools/getMetalRate";
import { listSupported, PURITY_MARKS } from "../../src/tools/listSupported";
import type { ToolResult } from "../../src/tools/rates";
import { DOWN, fakeDeps, fxProvider, minutesBefore, SATURDAY_NOON, spotProvider, WEDNESDAY_NOON } from "./fakes";

function value<T>(result: ToolResult<T>): T {
  if (!result.ok) throw new Error(`expected a result, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function codes(result: ToolResult<{ warnings: { code: string }[] }>): string[] {
  return value(result).warnings.map((warning) => warning.code);
}

const base: CalcMeltValueInput = { metal: "gold", weight: 10, unit: "g", purity: "24K", country: "US", currency: "USD", non_metal_weight: 0 };

describe("calcMeltValue golden values at 4000 USD gold and 50 USD silver", () => {
  const cases: [string, Partial<CalcMeltValueInput>, string, string, string, string][] = [
    ["10 g of 24K gold", {}, "10.00", "1286.03", "900.22", "1221.73"],
    ["1 tola of 22K gold", { weight: 1, unit: "tola", purity: "22K" }, "10.69", "1375.00", "962.50", "1306.25"],
    ["1 troy ounce of 999 silver", { metal: "silver", weight: 1, unit: "ozt", purity: "999" }, "31.07", "49.95", "34.97", "47.45"],
    ["50 g of sterling silver less 5 g", { metal: "silver", weight: 50, purity: "sterling", non_metal_weight: 5 }, "41.63", "66.91", "46.84", "63.57"],
    ["1 pennyweight of 14K gold", { weight: 1, unit: "dwt", purity: "14K" }, "0.91", "116.67", "81.67", "110.83"],
  ];

  it.each(cases)("%s", async (_name, change, pure, melt, low, high) => {
    const out = value(await calcMeltValue({ ...base, ...change }, fakeDeps()));
    expect(out).toMatchObject({ pure_grams: pure, spot_melt: { value: melt }, buyback_low: low, buyback_high: high, currency: "USD" });
    expect(out.warnings).toEqual([]);
  });
});

describe("calcMeltValue result", () => {
  it("stamps every rate with source, time, kind, and age, and echoes the inputs", async () => {
    const input: CalcMeltValueInput = { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", city: "Chennai", currency: "INR" };
    const out = value(await calcMeltValue(input, fakeDeps()));
    expect(out.pure_grams).toBe("9.17");
    expect(out.currency).toBe("INR");
    expect(out.spot_melt).toEqual({ value: "104329.17", source: "gold-api.com", as_of: minutesBefore(WEDNESDAY_NOON, 1), stale: false });
    expect(out.rates).toEqual({
      spot: { source: "gold-api.com", as_of: minutesBefore(WEDNESDAY_NOON, 1), kind: "fresh", age_seconds: 60, unverified: false, usd_per_troy_oz: "4000" },
      currency: { source: "frankfurter.dev", as_of: "2026-11-11", kind: "fresh", age_seconds: 43200, unverified: true, pair: "USD/INR", rate: "88.5" },
    });
    expect(out.inputs).toEqual(input);
    expect(out.local_estimate).toBeUndefined();
  });

  it("converts 50 g of sterling less 5 g to AED with no gross-weight warning", async () => {
    const out = value(await calcMeltValue({ ...base, metal: "silver", weight: 50, purity: "925", non_metal_weight: 5, country: "AE", currency: "AED" }, fakeDeps()));
    expect(out).toMatchObject({ pure_grams: "41.63", currency: "AED" });
    expect(out.warnings.map((warning) => warning.code)).not.toContain("gross_weight_used");
  });
});

describe("warnings", () => {
  it("gross_weight_used when no non-metal weight is given", async () => {
    const { non_metal_weight: _omit, ...input } = base;
    expect(codes(await calcMeltValue(input, fakeDeps()))).toEqual(["gross_weight_used"]);
  });

  it("large_weight above 5 kg", async () => {
    expect(codes(await calcMeltValue({ ...base, weight: 6, unit: "kg" }, fakeDeps()))).toEqual(["large_weight"]);
  });

  it("spot_stale when providers fail and the cached price is 30 minutes old", async () => {
    const cache = new MemoryCache();
    const asOf = minutesBefore(WEDNESDAY_NOON, 30);
    await cache.put("spot:gold", { quote: { metal: "gold", usdPerTroyOz: "4000", asOf, source: "gold-api.com" }, fetchedAt: asOf });
    const deps = fakeDeps({ cache, primary: spotProvider("gold-api.com", () => DOWN), fallback: spotProvider("xaus.com", () => DOWN) });
    const result = await calcMeltValue(base, deps);
    expect(codes(result)).toEqual(["spot_stale"]);
    expect(value(result).spot_melt.stale).toBe(true);
    expect(value(result).rates.spot).toMatchObject({ kind: "stale", age_seconds: 1800 });
  });

  it("market_closed with the last close time on a Saturday", async () => {
    const close = "2026-11-13T21:59:00.000Z";
    const answer = (source: "gold-api.com" | "xaus.com", price: string) => () => ok({ metal: "gold" as const, usdPerTroyOz: price, asOf: close, source });
    const deps = fakeDeps({ now: SATURDAY_NOON, primary: spotProvider("gold-api.com", answer("gold-api.com", "4000")), fallback: spotProvider("xaus.com", answer("xaus.com", "4001")) });
    const out = value(await calcMeltValue(base, deps));
    expect(out.warnings).toEqual([{ code: "market_closed", message: `The gold market is closed. The value uses the last price the source gave, timed ${close}.` }]);
    expect(out.rates.spot.kind).toBe("market_closed");
  });

  it("spot_unverified when only one spot source answers", async () => {
    const deps = fakeDeps({ fallback: spotProvider("xaus.com", () => DOWN) });
    expect(codes(await calcMeltValue(base, deps))).toEqual(["spot_unverified"]);
  });

  it("currency_unverified on a first currency rate, and not once a later day's rate confirms it", async () => {
    const deps = fakeDeps();
    const input = { ...base, currency: "INR" };
    expect(codes(await calcMeltValue(input, deps))).toEqual(["currency_unverified"]);
    const record = deps.cache.records.get("fx:INR")!;
    const yesterday = { ...(record.quote as object), asOf: "2026-11-10" };
    deps.cache.records.set("fx:INR", { ...record, quote: yesterday, fetchedAt: minutesBefore(WEDNESDAY_NOON, 61) });
    expect(codes(await calcMeltValue(input, deps))).toEqual([]);
  });

  it("currency_stale for a rate dated six days back", async () => {
    const fx = fxProvider((quote) => ok({ quote, rate: "88.5", asOf: "2026-11-05", source: "frankfurter.dev" }));
    expect(codes(await calcMeltValue({ ...base, currency: "INR" }, fakeDeps({ fx })))).toEqual(["currency_stale", "currency_unverified"]);
  });

  it("unknown_currency_usd_used for an unknown country with no currency", async () => {
    const { currency: _omit, ...input } = base;
    const deps = fakeDeps();
    const out = value(await calcMeltValue({ ...input, country: "Atlantis" }, deps));
    expect(out.currency).toBe("USD");
    expect(out.rates.currency).toBeUndefined();
    expect(out.warnings.map((warning) => warning.code)).toEqual(["unknown_currency_usd_used"]);
    expect(out.spot_melt.value).toBe("1286.03");
  });

  it("unknown_currency_usd_used when no rate is published for the currency", async () => {
    const fx = fxProvider(() => fail("unknown_currency", "frankfurter.dev publishes no USD rate for the currency XYZ.", "Ask for another code."));
    const out = value(await getMetalRate({ metal: "gold", country: "US", currency: "XYZ" }, fakeDeps({ fx })));
    expect(out.currency).toBe("USD");
    expect(out.warnings.map((warning) => warning.code)).toEqual(["unknown_currency_usd_used"]);
  });
});

describe("errors", () => {
  it("rate_unavailable when no spot source answers and nothing is cached", async () => {
    const deps = fakeDeps({ primary: spotProvider("gold-api.com", () => DOWN), fallback: spotProvider("xaus.com", () => DOWN) });
    const result = await calcMeltValue(base, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("rate_unavailable");
    expect(result.error.fix).toMatch(/^Do not estimate/);
  });

  it("rate_unavailable when the currency rate fails and nothing is cached", async () => {
    const result = await getMetalRate({ metal: "gold", country: "IN", currency: "INR" }, fakeDeps({ fx: fxProvider(() => DOWN) }));
    expect(result.ok ? undefined : result.error.code).toBe("rate_unavailable");
  });

  it("ambiguous_unit for oz, with both options, before any rate fetch", async () => {
    const primary = spotProvider("gold-api.com");
    const result = await calcMeltValue({ ...base, unit: "oz" }, fakeDeps({ primary }));
    expect(result.ok ? undefined : result.error).toEqual({
      code: "ambiguous_unit",
      message: '"oz" can mean more than one unit.',
      fix: "Use oz_av (avoirdupois ounce) or ozt (troy ounce).",
    });
    expect(primary.calls).toEqual([]);
  });

  it("passes the unknown_purity fix through unchanged", async () => {
    expect(await calcMeltValue({ ...base, purity: "50" }, fakeDeps())).toEqual(parsePurity("50", "gold"));
  });

  it.each([
    ["invalid_weight", { weight: 0 }],
    ["invalid_non_metal_weight", { non_metal_weight: 10 }],
    ["invalid_purity", { purity: "25K" }],
    ["unknown_unit", { unit: "stone" }],
  ] as const)("%s", async (code, change) => {
    const result = await calcMeltValue({ ...base, ...change }, fakeDeps());
    expect(result.ok ? undefined : result.error.code).toBe(code);
  });
});

describe("getMetalRate", () => {
  it("gives a per-gram rate that times 31.1034768 equals the per-troy-ounce rate to the cent", async () => {
    const out = value(await getMetalRate({ metal: "gold", country: "US", currency: "USD" }, fakeDeps()));
    expect(out.per_troy_oz).toBe("4000.00");
    expect(new D(out.per_gram).times(UNITS.ozt.gramsPerUnit).toFixed(2)).toBe(out.per_troy_oz);
    expect(out).toMatchObject({ source: "gold-api.com", as_of: minutesBefore(WEDNESDAY_NOON, 1), stale: false, warnings: [] });
  });

  it("prices in the requested currency", async () => {
    const out = value(await getMetalRate({ metal: "silver", country: "IN", currency: "inr" }, fakeDeps()));
    expect(out).toMatchObject({ currency: "INR", per_troy_oz: "4425.00" });
  });
});

describe("convertWeight", () => {
  it("converts 1 tola to 11.6638038 g", () => {
    expect(value(convertWeight({ value: 1, from_unit: "tola", to_unit: "g" }))).toMatchObject({ value: "11.6638038", grams: "11.6638038" });
  });

  it("rejects a bare oz", () => {
    const result = convertWeight({ value: 1, from_unit: "oz", to_unit: "g" });
    expect(result.ok ? undefined : result.error.code).toBe("ambiguous_unit");
  });
});

describe("listSupported", () => {
  it("lists every unit id in UNITS", () => {
    expect(value(listSupported()).units.map((unit) => unit.id)).toEqual(Object.keys(UNITS));
  });

  it("lists only purity marks that parse for their metal", () => {
    for (const metal of ["gold", "silver"] as const) {
      for (const mark of PURITY_MARKS[metal]) expect(parsePurity(mark, metal).ok, `${metal} ${mark}`).toBe(true);
    }
  });
});
