import { z } from "zod";
import { D } from "../domain/decimal";
import { calcMelt, type MeltInput } from "../domain/melt";
import { parseCurrency } from "../domain/money";
import { localEstimate } from "../rates/local";
import { conversionLine, done, failed, placeFields, pricedFields, priceIn, ratesSchema, warningSchema, type ToolDeps, type ToolResult, type Warning } from "./rates";

const MELT_WARNINGS: Record<"gross_weight_used" | "large_weight", Warning> = {
  gross_weight_used: {
    code: "gross_weight_used",
    message: "No weight was given for stones or other non-metal parts, so the full weight counts as metal and the value may be too high.",
  },
  large_weight: {
    code: "large_weight",
    message: "The weight is over 5 kg, which is unusual for jewellery. Confirm the weight and the unit.",
  },
};

export const calcMeltValueInput = z.object({
  metal: z.enum(["gold", "silver"]),
  weight: z.number().describe("The weight in the given unit, such as 12.4."),
  unit: z.string().max(64).describe("A unit id from list_supported, such as g, ozt, or tola. A bare oz is rejected."),
  purity: z.string().max(64).describe('A karat, fineness, percent, or name, such as "22K", "916", "91.6%", or "sterling".'),
  ...placeFields,
  non_metal_weight: z.number().optional().describe("Weight of stones and other non-metal parts, in the same unit."),
});

export const calcMeltValueOutput = z.object({
  metal: z.enum(["gold", "silver"]),
  currency: z.string(),
  pure_grams: z.string(),
  spot_melt: z.object({ value: z.string(), ...pricedFields }),
  local_estimate: z
    .object({
      value: z.string(),
      currency: z.string(),
      label: z.literal("estimated"),
      note: z.string(),
      source: z.object({ url: z.string(), retrieved: z.string() }),
    })
    .optional(),
  buyback_low: z.string().describe("70 percent of the spot melt value."),
  buyback_high: z.string().describe("95 percent of the spot melt value."),
  rates: ratesSchema,
  warnings: z.array(warningSchema),
  inputs: calcMeltValueInput,
});

export type CalcMeltValueInput = z.infer<typeof calcMeltValueInput>;
export type CalcMeltValueOutput = z.infer<typeof calcMeltValueOutput>;

export async function calcMeltValue(input: CalcMeltValueInput, deps: ToolDeps): Promise<ToolResult<CalcMeltValueOutput>> {
  const melt: Omit<MeltInput, "rate"> = { metal: input.metal, weight: input.weight, unit: input.unit, purity: input.purity };
  if (input.non_metal_weight !== undefined) melt.nonMetalWeight = input.non_metal_weight;

  // A dry run at a zero rate reports a bad unit or purity before any rate fetch, so input errors show even when rates are down.
  const checked = calcMelt({ ...melt, rate: { perTroyOz: new D(0), currency: parseCurrency("USD")! } });
  if (!checked.ok) return failed(checked.error);

  const priced = await priceIn(input.metal, input.currency, deps);
  if (!priced.ok) return priced;
  const { perTroyOz, currency, rates, warnings, source, as_of, stale } = priced.value;

  const result = calcMelt({ ...melt, rate: { perTroyOz, currency } });
  if (!result.ok) return failed(result.error);
  const value = result.value;

  const output: CalcMeltValueOutput = {
    metal: input.metal,
    currency,
    pure_grams: value.pureGrams,
    spot_melt: { value: value.meltValue, source, as_of, stale },
    buyback_low: value.buybackLow,
    buyback_high: value.buybackHigh,
    rates,
    warnings: [...value.warnings.map((code) => MELT_WARNINGS[code]), ...warnings],
    inputs: input,
  };
  const local = localEstimate({ value: new D(value.meltValue), currency }, input.country);
  if (local !== undefined) output.local_estimate = local;
  return done(output);
}

export function summarizeMelt(output: CalcMeltValueOutput): string {
  const { metal, pure_grams, spot_melt, currency, buyback_low, buyback_high, rates, warnings } = output;
  const lines = [
    `${pure_grams} g of pure ${metal}. Melt value ${spot_melt.value} ${currency} at spot from ${spot_melt.source}, ${spot_melt.as_of}.`,
    ...conversionLine(rates),
    `Likely buyer offer ${buyback_low} to ${buyback_high} ${currency}. This is an estimate from the stated weight and purity, not an appraisal or an offer to buy.`,
    ...warnings.map((warning) => `Warning: ${warning.message}`),
  ];
  return lines.join("\n");
}
