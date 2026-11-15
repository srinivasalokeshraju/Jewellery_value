import { z } from "zod";
import { minorUnits, roundMoney } from "../domain/money";
import { UNITS } from "../domain/units";
import { at, type CardTemplate } from "./card";
import { conversionLine, conversionNote, done, placeFields, pricedFields, priceIn, ratesSchema, warningSchema, type ToolDeps, type ToolResult } from "./rates";

const PER_GRAM_EXTRA_DIGITS = 4;

export const getMetalRateInput = z.object({
  metal: z.enum(["gold", "silver"]),
  ...placeFields,
});

export const getMetalRateOutput = z.object({
  metal: z.enum(["gold", "silver"]),
  currency: z.string(),
  per_gram: z.string().describe("Pure metal per gram, with four more decimals than the currency uses."),
  per_troy_oz: z.string().describe("Pure metal per troy ounce, rounded to the currency's minor unit."),
  ...pricedFields,
  rates: ratesSchema,
  warnings: z.array(warningSchema),
  inputs: getMetalRateInput,
});

export type GetMetalRateInput = z.infer<typeof getMetalRateInput>;
export type GetMetalRateOutput = z.infer<typeof getMetalRateOutput>;

export async function getMetalRate(input: GetMetalRateInput, deps: ToolDeps): Promise<ToolResult<GetMetalRateOutput>> {
  const priced = await priceIn(input.metal, input.currency, deps);
  if (!priced.ok) return priced;
  const { perTroyOz, currency, rates, warnings, source, as_of, stale } = priced.value;
  const perGram = perTroyOz.div(UNITS.ozt.gramsPerUnit);
  return done({
    metal: input.metal,
    currency,
    per_gram: perGram.toFixed(minorUnits(currency) + PER_GRAM_EXTRA_DIGITS),
    per_troy_oz: roundMoney(perTroyOz, currency),
    source,
    as_of,
    stale,
    rates,
    warnings,
    inputs: input,
  });
}

export function summarizeRate(output: GetMetalRateOutput): string {
  const { metal, currency, per_gram, per_troy_oz, source, rates, warnings } = output;
  return [
    `Pure ${metal}: ${per_gram} ${currency} per gram, ${per_troy_oz} ${currency} per troy ounce, from ${source} at ${rates.spot.as_of_text}.`,
    ...conversionLine(rates),
    ...warnings.map((warning) => `Warning: ${warning.message}`),
  ].join("\n");
}

export const rateCard: CardTemplate<GetMetalRateOutput> = {
  title: "Metal rate",
  blocks: [
    { kind: "headline", label: "Per gram, pure", text: [at("per_gram"), " ", at("currency")], metal: at("metal") },
    { kind: "row", label: "Per troy ounce", text: [at("per_troy_oz"), " ", at("currency")] },
    { kind: "note", text: ["Spot price from ", at("source"), ", ", at("rates.spot.as_of_text"), "."] },
    conversionNote,
  ],
};
