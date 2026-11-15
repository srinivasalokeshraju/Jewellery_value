import { D, parseDecimal } from "./decimal";
import { roundMoney, type Currency } from "./money";
import { parsePurity, type Metal } from "./purity";
import { err, ok, type Result } from "./result";
import { UNITS, parseUnit, parseWeight, toGrams } from "./units";

export interface MeltInput {
  metal: Metal;
  weight: string | number;
  unit: string;
  purity: string;
  nonMetalWeight?: string | number;
  rate: { perTroyOz: D; currency: Currency };
}

export type MeltWarning = "gross_weight_used" | "large_weight";

export interface MeltResult {
  grossGrams: string;
  netGrams: string;
  pureGrams: string;
  meltValue: string;
  buybackLow: string;
  buybackHigh: string;
  currency: Currency;
  warnings: MeltWarning[];
}

const LARGE_WEIGHT_GRAMS = 5000;
const BUYBACK_LOW = "0.70";
const BUYBACK_HIGH = "0.95";

function roundMass(grams: D): string {
  return grams.toFixed(2, D.ROUND_HALF_UP);
}

export function calcMelt(input: MeltInput): Result<MeltResult> {
  const unit = parseUnit(input.unit);
  if (!unit.ok) return unit;
  const purity = parsePurity(input.purity, input.metal);
  if (!purity.ok) return purity;
  const weight = parseWeight(input.weight);
  if (!weight.ok) return weight;

  const grossGrams = toGrams(weight.value, unit.value);
  const warnings: MeltWarning[] = [];
  let netGrams = grossGrams;

  if (input.nonMetalWeight === undefined) {
    warnings.push("gross_weight_used");
  } else {
    const nonMetal = parseDecimal(input.nonMetalWeight);
    if (!nonMetal || nonMetal.lt(0) || nonMetal.gte(weight.value)) {
      return err(
        "invalid_non_metal_weight",
        `Non-metal weight "${input.nonMetalWeight}" must be zero or more and less than the total weight ${weight.value.toFixed()} ${unit.value}.`,
        `Give the weight of stones and other non-metal parts in ${UNITS[unit.value].label}s, below the total weight.`,
      );
    }
    netGrams = grossGrams.minus(toGrams(nonMetal, unit.value));
  }
  if (grossGrams.gt(LARGE_WEIGHT_GRAMS)) warnings.push("large_weight");

  const pureGrams = netGrams.times(purity.value.fraction);
  const meltValue = pureGrams.div(UNITS.ozt.gramsPerUnit).times(input.rate.perTroyOz);
  const currency = input.rate.currency;

  return ok({
    grossGrams: roundMass(grossGrams),
    netGrams: roundMass(netGrams),
    pureGrams: roundMass(pureGrams),
    meltValue: roundMoney(meltValue, currency),
    buybackLow: roundMoney(meltValue.times(BUYBACK_LOW), currency),
    buybackHigh: roundMoney(meltValue.times(BUYBACK_HIGH), currency),
    currency,
    warnings,
  });
}
