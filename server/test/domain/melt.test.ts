import { describe, expect, it } from "vitest";
import { D } from "../../src/domain/decimal";
import { calcMelt, type MeltInput } from "../../src/domain/melt";
import { minorUnits, parseCurrency, roundMoney, type Currency } from "../../src/domain/money";

const USD = parseCurrency("USD")!;
const GOLD = { perTroyOz: new D(4000), currency: USD };
const SILVER = { perTroyOz: new D(50), currency: USD };

function melt(input: MeltInput) {
  const result = calcMelt(input);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function failure(input: MeltInput) {
  const result = calcMelt(input);
  if (result.ok) throw new Error("expected a DomainError");
  return result.error;
}

describe("calcMelt golden cases at gold 4000 and silver 50 USD per troy ounce", () => {
  it.each([
    ["10 g of 24K gold", { metal: "gold", weight: 10, unit: "g", purity: "24K", rate: GOLD }, "10.00", "1286.03", "900.22", "1221.73"],
    ["1 tola of 22K gold", { metal: "gold", weight: 1, unit: "tola", purity: "22K", rate: GOLD }, "10.69", "1375.00", "962.50", "1306.25"],
    ["1 troy ounce of 999 silver", { metal: "silver", weight: 1, unit: "ozt", purity: "999", rate: SILVER }, "31.07", "49.95", "34.97", "47.45"],
    ["50 g of sterling silver less 5 g", { metal: "silver", weight: 50, unit: "g", purity: "sterling", nonMetalWeight: 5, rate: SILVER }, "41.63", "66.91", "46.84", "63.57"],
    ["1 pennyweight of 14K gold", { metal: "gold", weight: 1, unit: "dwt", purity: "14K", rate: GOLD }, "0.91", "116.67", "81.67", "110.83"],
  ] as const)("%s", (_name, input, pureGrams, meltValue, buybackLow, buybackHigh) => {
    const result = melt(input);
    expect({ pureGrams: result.pureGrams, meltValue: result.meltValue, buybackLow: result.buybackLow, buybackHigh: result.buybackHigh }).toEqual({
      pureGrams,
      meltValue,
      buybackLow,
      buybackHigh,
    });
    expect(result.currency).toBe("USD");
  });

  it("reports gross, net, and pure grams for the sterling case", () => {
    const result = melt({ metal: "silver", weight: "50", unit: "g", purity: "sterling", nonMetalWeight: "5", rate: SILVER });
    expect([result.grossGrams, result.netGrams, result.pureGrams]).toEqual(["50.00", "45.00", "41.63"]);
    expect(result.warnings).toEqual([]);
  });
});

describe("calcMelt warnings", () => {
  it("warns gross_weight_used when no non-metal weight is given", () => {
    expect(melt({ metal: "gold", weight: 12.4, unit: "g", purity: "22K", rate: GOLD }).warnings).toEqual(["gross_weight_used"]);
  });

  it("does not warn gross_weight_used for a zero non-metal weight", () => {
    expect(melt({ metal: "gold", weight: 12.4, unit: "g", purity: "22K", nonMetalWeight: 0, rate: GOLD }).warnings).toEqual([]);
  });

  it("warns large_weight above 5000 g and still returns a value", () => {
    const result = melt({ metal: "gold", weight: 6000, unit: "g", purity: "22K", nonMetalWeight: 0, rate: GOLD });
    expect(result.warnings).toEqual(["large_weight"]);
    expect(result.meltValue).toBe("707316.42");
  });

  it("does not warn large_weight at exactly 5000 g", () => {
    expect(melt({ metal: "gold", weight: 5, unit: "kg", purity: "22K", nonMetalWeight: 0, rate: GOLD }).warnings).toEqual([]);
  });
});

describe("calcMelt errors", () => {
  it.each([
    ["ambiguous_unit", { metal: "gold", weight: 2, unit: "oz", purity: "18K", rate: GOLD }],
    ["unknown_unit", { metal: "gold", weight: 2, unit: "stone", purity: "18K", rate: GOLD }],
    ["unknown_purity", { metal: "gold", weight: 2, unit: "g", purity: "rose", rate: GOLD }],
    ["invalid_purity", { metal: "silver", weight: 2, unit: "g", purity: "22K", rate: SILVER }],
    ["invalid_purity", { metal: "gold", weight: 2, unit: "g", purity: "25K", rate: GOLD }],
    ["invalid_weight", { metal: "gold", weight: 0, unit: "g", purity: "22K", rate: GOLD }],
    ["invalid_weight", { metal: "gold", weight: "two", unit: "g", purity: "22K", rate: GOLD }],
    ["invalid_non_metal_weight", { metal: "gold", weight: 5, unit: "g", purity: "22K", nonMetalWeight: 5, rate: GOLD }],
    ["invalid_non_metal_weight", { metal: "gold", weight: 5, unit: "g", purity: "22K", nonMetalWeight: -1, rate: GOLD }],
  ] as const)("returns %s", (code, input) => {
    const error = failure(input);
    expect(error.code).toBe(code);
    expect(error.message).not.toBe("");
    expect(error.fix).not.toBe("");
  });
});

describe("money", () => {
  it("rounds to the currency's minor units, half up", () => {
    const JPY = parseCurrency("jpy")!;
    const KWD = parseCurrency("KWD")!;
    expect([minorUnits(USD), minorUnits(JPY), minorUnits(KWD)]).toEqual([2, 0, 3]);
    expect(roundMoney(new D("2.005"), USD)).toBe("2.01");
    expect(roundMoney(new D("1286.5"), JPY)).toBe("1287");
    expect(roundMoney(new D("1.0005"), KWD)).toBe("1.001");
  });

  it("prices 10 g of 24K gold in JPY with no decimal places", () => {
    const result = melt({ metal: "gold", weight: 10, unit: "g", purity: "24K", rate: { perTroyOz: new D(600000), currency: parseCurrency("JPY") as Currency } });
    expect(result.meltValue).toBe("192904");
  });

  it.each(["US", "dollars", "US1"])("rejects malformed currency code %j", (text) => {
    expect(parseCurrency(text)).toBeUndefined();
  });
});
