import { z } from "zod";
import { convert, parseUnit, parseWeight, toGrams } from "../domain/units";
import { at, type CardTemplate } from "./card";
import { done, failed, type ToolResult } from "./rates";

const DECIMALS = 10;

export const convertWeightInput = z.object({
  value: z.number().describe("The weight to convert, such as 1."),
  from_unit: z.string().max(64).describe("A unit id from list_supported, such as tola."),
  to_unit: z.string().max(64).describe("A unit id from list_supported, such as g."),
});

export const convertWeightOutput = z.object({
  value: z.string().describe("The weight in to_unit, to at most 10 decimals."),
  grams: z.string().describe("The weight in grams, to at most 10 decimals."),
  inputs: convertWeightInput,
});

export type ConvertWeightInput = z.infer<typeof convertWeightInput>;
export type ConvertWeightOutput = z.infer<typeof convertWeightOutput>;

export function convertWeight(input: ConvertWeightInput): ToolResult<ConvertWeightOutput> {
  const from = parseUnit(input.from_unit);
  if (!from.ok) return failed(from.error);
  const to = parseUnit(input.to_unit);
  if (!to.ok) return failed(to.error);
  const weight = parseWeight(input.value);
  if (!weight.ok) return failed(weight.error);
  return done({
    value: convert(weight.value, from.value, to.value).toDecimalPlaces(DECIMALS).toFixed(),
    grams: toGrams(weight.value, from.value).toDecimalPlaces(DECIMALS).toFixed(),
    inputs: input,
  });
}

export function summarizeConversion(output: ConvertWeightOutput): string {
  const { inputs, value, grams } = output;
  return `${inputs.value} ${inputs.from_unit} is ${value} ${inputs.to_unit} (${grams} g).`;
}

export const conversionCard: CardTemplate<ConvertWeightOutput> = {
  title: "Convert weight",
  blocks: [
    { kind: "headline", label: "Converted", text: [at("value"), " ", at("inputs.to_unit")] },
    { kind: "row", label: "From", text: [at("inputs.value"), " ", at("inputs.from_unit")] },
    { kind: "row", label: "In grams", text: [at("grams"), " g"] },
  ],
};
