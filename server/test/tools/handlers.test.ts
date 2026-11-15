import { describe, expect, it } from "vitest";
import { D } from "../../src/domain/decimal";
import { parsePurity } from "../../src/domain/purity";
import { UNITS } from "../../src/domain/units";
import { MemoryCache } from "../../src/rates/cache";
import { fail, ok } from "../../src/rates/types";
import { calcMeltValue, type CalcMeltValueInput, type CalcMeltValueOutput } from "../../src/tools/calcMeltValue";
import { convertWeight } from "../../src/tools/convertWeight";
import { getMetalRate } from "../../src/tools/getMetalRate";
import { listSupported, PURITY_MARKS } from "../../src/tools/listSupported";
import { describeTime, type ToolResult } from "../../src/tools/rates";
import { DOWN, fakeDeps, fxProvider, minutesBefore, SATURDAY_NOON, spotProvider, WEDNESDAY_NOON } from "./fakes";

function value<T>(result: ToolResult<T>): T {
  if (!result.ok) throw new Error(`expected a result, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function codes(result: ToolResult<{ warnings: { code: string }[] }>): string[] {
  return value(result).warnings.map((warning) => warning.code);
}

const base: CalcMeltValueInput = {
  metal: "gold",
  weight: 10,
  unit: "g",
  purity: "24K",
  country: "US",
  currency: "USD",
  non_metal_weight: 0,
};

describe("calcMeltValue golden values at 4000 USD gold and 50 USD silver", () => {
  const cases: [string, Partial<CalcMeltValueInput>, string, string, string, string][] = [
    ["10 g of 24K gold", {}, "10.00", "1286.03", "900.22", "1221.73"],
    ["1 tola of 22K gold", { weight: 1, unit: "tola", purity: "22K" }, "10.69", "1375.00", "962.50", "1306.25"],
    ["1 troy ounce of 999 silver", { metal: "silver", weight: 1, unit: "ozt", purity: "999" }, "31.07", "49.95", "34.97", "47.45"],
    [
      "50 g of sterling silver less 5 g",
      { metal: "silver", weight: 50, purity: "sterling", non_metal_weight: 5 },
      "41.63",
      "66.91",
      "46.84",
      "63.57",
    ],
    ["1 pennyweight of 14K gold", { weight: 1, unit: "dwt", purity: "14K" }, "0.91", "116.67", "81.67", "110.83"],
  ];

  it.each(cases)("%s", async (_name, change, pure, melt, low, high) => {
    const out = value(await calcMeltValue({ ...base, ...change }, fakeDeps()));
    expect(out).toMatchObject({ pure_grams: pure, spot_melt: { value: melt }, buyback_low: low, buyback_high: high, currency: "USD" });
    expect(out.warnings).toEqual([]);
  });
});

describe("describeTime", () => {
  it.each([
    ["2026-11-11T11:30:00.000Z", "11 Nov 2026, 11:30 UTC"],
    ["2026-11-11T11:30:00Z", "11 Nov 2026, 11:30 UTC"],
    ["2026-01-05T00:07:59.123Z", "5 Jan 2026, 00:07 UTC"],
    ["2026-11-05", "5 Nov 2026"],
    ["2026-12-31", "31 Dec 2026"],
  ])("writes %s as %s", (asOf, words) => {
    expect(describeTime(asOf)).toBe(words);
  });

  it.each(["2026-11-11T11:30:00+05:30", "2026-13-01", "yesterday", ""])("returns %j unchanged, because it cannot be sure of it", (asOf) => {
    expect(describeTime(asOf)).toBe(asOf);
  });
});

describe("calcMeltValue result", () => {
  it("stamps every rate with source, time, kind, and age, and echoes the inputs", async () => {
    const input: CalcMeltValueInput = {
      metal: "gold",
      weight: 10,
      unit: "g",
      purity: "22K",
      country: "IN",
      city: "Chennai",
      currency: "INR",
    };
    const out = value(await calcMeltValue(input, fakeDeps()));
    expect(out.pure_grams).toBe("9.17");
    expect(out.currency).toBe("INR");
    expect(out.spot_melt).toEqual({ value: "104329.17", source: "gold-api.com", as_of: minutesBefore(WEDNESDAY_NOON, 1), stale: false });
    expect(out.rates).toEqual({
      spot: {
        source: "gold-api.com",
        as_of: minutesBefore(WEDNESDAY_NOON, 1),
        as_of_text: "11 Nov 2026, 11:59 UTC",
        kind: "fresh",
        age_seconds: 60,
        unverified: false,
        usd_per_troy_oz: "4000",
      },
      currency: {
        source: "frankfurter.dev",
        as_of: "2026-11-11",
        as_of_text: "11 Nov 2026",
        kind: "fresh",
        age_seconds: 43200,
        unverified: true,
        pair: "USD/INR",
        rate: "88.5",
      },
    });
    expect(out.inputs).toEqual(input);
    expect(out.local_estimate).toBeUndefined();
  });

  it("converts 50 g of sterling less 5 g to AED with no gross-weight warning", async () => {
    const out = value(
      await calcMeltValue(
        { ...base, metal: "silver", weight: 50, purity: "925", non_metal_weight: 5, country: "AE", currency: "AED" },
        fakeDeps(),
      ),
    );
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

  it("unknown_currency_usd_used for an unknown country with no currency", async () => {
    const { currency: _omit, ...input } = base;
    const deps = fakeDeps();
    const out = value(await calcMeltValue({ ...input, country: "Atlantis" }, deps));
    expect(out.currency).toBe("USD");
    expect(out.rates.currency).toBeUndefined();
    expect(out.warnings).toEqual([
      {
        code: "unknown_currency_usd_used",
        message: "No currency was given, so values are in US dollars. Ask the person for their currency and pass it, such as INR.",
      },
    ]);
    expect(out.spot_melt.value).toBe("1286.03");
  });

  it("unknown_currency_usd_used when no rate is published for the currency", async () => {
    const fx = fxProvider(() =>
      fail("unknown_currency", "frankfurter.dev publishes no USD rate for the currency XYZ.", "Ask for another code."),
    );
    const out = value(await getMetalRate({ metal: "gold", country: "US", currency: "XYZ" }, fakeDeps({ fx })));
    expect(out.currency).toBe("USD");
    expect(out.warnings).toEqual([
      { code: "unknown_currency_usd_used", message: "No exchange rate is published for XYZ, so values are in US dollars." },
    ]);
  });
});

describe("rate warning messages", () => {
  const INR = { ...base, currency: "INR" };
  const bothDown = { primary: spotProvider("gold-api.com", () => DOWN), fallback: spotProvider("xaus.com", () => DOWN) };

  function spotCache(asOf: string, fetchedAt: string, source: "gold-api.com" | "xaus.com" = "gold-api.com") {
    const cache = new MemoryCache();
    cache.records.set("spot:gold", { quote: { metal: "gold", usdPerTroyOz: "4000", asOf, source }, fetchedAt });
    return cache;
  }

  function fxCache(asOf: string, fetchedAt: string, unverified?: true) {
    const cache = new MemoryCache();
    const record = { quote: { quote: "INR", rate: "88.5", asOf, source: "frankfurter.dev" }, fetchedAt };
    cache.records.set("fx:INR", unverified ? { ...record, unverified } : record);
    return cache;
  }

  const spotAnswer = (asOf: string) => (metal: "gold" | "silver") =>
    ok({ metal, usdPerTroyOz: "4000", asOf, source: "gold-api.com" as const });
  const fxAnswer = (asOf: string, rate = "88.5") => fxProvider((quote) => ok({ quote, rate, asOf, source: "frankfurter.dev" }));
  const staleSpot = (asOf: string, age: string) =>
    `The gold spot price is from ${describeTime(asOf)}, ${age} old. It could not be refreshed, or it is more than 5 minutes old, so the value may be out of date.`;
  const staleFx = (asOf: string) =>
    `The US dollar to INR rate is dated ${describeTime(asOf)}. It could not be refreshed, or it is older than expected, so the value may be out of date.`;
  const UNVERIFIED_FX = "No earlier rate confirmed the US dollar to INR rate.";

  const closed = (asOf: string, age: string) => `The gold market is closed. The spot price is from ${describeTime(asOf)}, ${age} old.`;

  const ago = (minutes: number) => minutesBefore(WEDNESDAY_NOON, minutes);
  const satAgo = (minutes: number) => minutesBefore(SATURDAY_NOON, minutes);
  const ahead = (seconds: number) => new Date(WEDNESDAY_NOON.getTime() + seconds * 1000).toISOString();

  const cases: [string, () => Promise<ToolResult<CalcMeltValueOutput>>, { code: string; message: string }[]][] = [
    [
      "spot_stale, feeds down, cache 30 minutes old",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ago(30), ago(30)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ago(30), "30 minutes") }],
    ],
    [
      "spot_stale, feeds answer with a 30-minute-old price",
      () =>
        calcMeltValue(
          base,
          fakeDeps({ primary: spotProvider("gold-api.com", spotAnswer(ago(30))), fallback: spotProvider("xaus.com", spotAnswer(ago(30))) }),
        ),
      [{ code: "spot_stale", message: staleSpot(ago(30), "30 minutes") }],
    ],
    [
      "spot_stale, feeds down, cache 70 seconds old",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ahead(-70), ahead(-70)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ahead(-70), "1 minute") }],
    ],
    [
      "spot_stale, feeds down, provider time 40 seconds ahead",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ahead(40), ahead(-61)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ahead(40), "less than a minute") }],
    ],
    [
      "spot_stale, feeds down, cache 3 hours old",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ago(180), ago(180)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ago(180), "3 hours") }],
    ],
    [
      "spot_stale, feeds down, cache 2.5 hours old",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ago(150), ago(150)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ago(150), "2 hours 30 minutes") }],
    ],
    [
      "spot_stale, feeds down, cache 2 hours 1 minute old",
      () => calcMeltValue(base, fakeDeps({ cache: spotCache(ago(121), ago(121)), ...bothDown })),
      [{ code: "spot_stale", message: staleSpot(ago(121), "2 hours 1 minute") }],
    ],
    [
      "spot_unverified, fallback down",
      () => calcMeltValue(base, fakeDeps({ fallback: spotProvider("xaus.com", () => DOWN) })),
      [{ code: "spot_unverified", message: "No second source confirmed the gold spot price from gold-api.com." }],
    ],
    [
      "spot_unverified, primary down",
      () => calcMeltValue(base, fakeDeps({ primary: spotProvider("gold-api.com", () => DOWN) })),
      [{ code: "spot_unverified", message: "No second source confirmed the gold spot price from xaus.com." }],
    ],
    [
      "currency_stale, feed down, cached rate dated today",
      () => calcMeltValue(INR, fakeDeps({ cache: fxCache("2026-11-11", ago(120)), fx: fxProvider(() => DOWN) })),
      [{ code: "currency_stale", message: staleFx("2026-11-11") }],
    ],
    [
      "currency_stale, feed down, cached rate six days old",
      () => calcMeltValue(INR, fakeDeps({ cache: fxCache("2026-11-05", ago(120)), fx: fxProvider(() => DOWN) })),
      [{ code: "currency_stale", message: staleFx("2026-11-05") }],
    ],
    [
      "currency_stale, cache hit on a rate six days old",
      () => calcMeltValue(INR, fakeDeps({ cache: fxCache("2026-11-05", ago(10)) })),
      [{ code: "currency_stale", message: staleFx("2026-11-05") }],
    ],
    [
      "currency_stale, feed answers with a rate six days old",
      () => calcMeltValue(INR, fakeDeps({ fx: fxAnswer("2026-11-05") })),
      [
        { code: "currency_stale", message: staleFx("2026-11-05") },
        { code: "currency_unverified", message: UNVERIFIED_FX },
      ],
    ],
    [
      "currency_unverified, no earlier rate",
      () => calcMeltValue(INR, fakeDeps()),
      [{ code: "currency_unverified", message: UNVERIFIED_FX }],
    ],
    [
      "currency_unverified, earlier rate moved more than 10 percent",
      () => calcMeltValue(INR, fakeDeps({ cache: fxCache("2026-11-10", ago(61), true), fx: fxAnswer("2026-11-11", "100") })),
      [{ code: "currency_unverified", message: UNVERIFIED_FX }],
    ],
    [
      "currency_unverified, cache hit on an unverified rate",
      () => calcMeltValue(INR, fakeDeps({ cache: fxCache("2026-11-11", ago(10), true) })),
      [{ code: "currency_unverified", message: UNVERIFIED_FX }],
    ],
  ];

  it.each(cases)("%s", async (_name, run, expected) => {
    expect(value(await run()).warnings).toEqual(expected);
  });

  describe("market_closed for every way the chain gives it", () => {
    const FRIDAY_CLOSE = "2026-11-13T21:59:00.000Z";
    const LATER = "2026-11-13T21:59:30.000Z";
    const saturday = (options: Parameters<typeof fakeDeps>[0]) => fakeDeps({ now: SATURDAY_NOON, ...options });
    const priced = (source: "gold-api.com" | "xaus.com", usdPerTroyOz: string, asOf: string) =>
      spotProvider(source, (metal) => ok({ metal, usdPerTroyOz, asOf, source }));
    const sixHours = () => spotCache(FRIDAY_CLOSE, satAgo(360));

    const closedCases: [string, () => ReturnType<typeof fakeDeps>, string, string, string?][] = [
      ["both feeds agree on a fetched price", () => saturday({}), satAgo(1), "1 minute"],
      [
        "a cached price under a minute old",
        () => saturday({ cache: spotCache(FRIDAY_CLOSE, satAgo(0.5)), ...bothDown }),
        FRIDAY_CLOSE,
        "14 hours 1 minute",
      ],
      [
        "both feeds down, cached price used",
        () => saturday({ cache: spotCache(FRIDAY_CLOSE, satAgo(5)), ...bothDown }),
        FRIDAY_CLOSE,
        "14 hours 1 minute",
      ],
      [
        "a later price moved 20 percent and was rejected, cached price used",
        () =>
          saturday({ cache: sixHours(), primary: priced("gold-api.com", "4800", LATER), fallback: spotProvider("xaus.com", () => DOWN) }),
        FRIDAY_CLOSE,
        "14 hours 1 minute",
        "rate_rejected",
      ],
      [
        "the feeds disagree on a later price, cached price used",
        () => {
          const cache = sixHours();
          cache.records.set("spot:gold", { ...cache.records.get("spot:gold")!, unverified: true });
          return saturday({ cache, primary: priced("gold-api.com", "4300", LATER), fallback: priced("xaus.com", "4000", FRIDAY_CLOSE) });
        },
        FRIDAY_CLOSE,
        "14 hours 1 minute",
        "rate_disagreement",
      ],
      [
        "the primary moved 20 percent, the fallback price is accepted",
        () => saturday({ cache: sixHours(), primary: priced("gold-api.com", "4800", LATER), fallback: priced("xaus.com", "4001", LATER) }),
        LATER,
        "14 hours",
      ],
    ];

    it.each(closedCases)("%s", async (_name, makeDeps, asOf, age, event) => {
      const deps = makeDeps();
      const warnings = value(await calcMeltValue(base, deps)).warnings.filter((warning) => warning.code === "market_closed");
      expect(warnings).toEqual([{ code: "market_closed", message: closed(asOf, age) }]);
      if (event) expect(deps.events.map((logged) => logged.event)).toContain(event);
    });
  });

  it("marks a stale spot price in spot_melt and rates", async () => {
    const out = value(await calcMeltValue(base, fakeDeps({ cache: spotCache(ago(30), ago(30)), ...bothDown })));
    expect(out.spot_melt.stale).toBe(true);
    expect(out.rates.spot).toMatchObject({ kind: "stale", age_seconds: 1800 });
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
