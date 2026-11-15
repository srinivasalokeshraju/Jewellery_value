import { z } from "zod";
import { AMBIGUOUS_UNITS, UNITS, type UnitId } from "../domain/units";
import { LOCAL_ADJUSTMENTS } from "../rates/local";
import { done, type ToolResult } from "./rates";

export const PURITY_MARKS = {
  gold: ["24K", "22K", "18K", "14K", "10K", "9K", "999", "916", "750", "585", "375", "fine"],
  silver: ["999", "958", "925", "900", "800", "sterling", "britannia", "fine"],
} as const;

const PURITY_FORMS = [
  "Karat for gold, 1K to 24K, such as 22K.",
  "Fineness in parts per thousand, 375 to 999.9 for gold and 800 to 999.9 for silver, such as 916.",
  "Percent above 0 and at most 100, such as 91.6%.",
  "A name: sterling and britannia for silver, fine for either metal.",
];

export const listSupportedInput = z.object({});

export const listSupportedOutput = z.object({
  units: z.array(z.object({ id: z.string(), label: z.string(), grams_per_unit: z.string() })),
  ambiguous_units: z.array(z.object({ name: z.string(), options: z.array(z.string()) })).describe("Names that need one of the listed unit ids instead."),
  purity_marks: z.object({ gold: z.array(z.string()), silver: z.array(z.string()) }),
  purity_forms: z.array(z.string()),
  local_estimate_countries: z.array(z.string()).describe("Countries with a local rate estimate. Every other country gets spot only."),
});

export type ListSupportedOutput = z.infer<typeof listSupportedOutput>;

export function listSupported(): ToolResult<ListSupportedOutput> {
  return done({
    units: (Object.keys(UNITS) as UnitId[]).map((id) => ({ id, label: UNITS[id].label, grams_per_unit: UNITS[id].gramsPerUnit })),
    ambiguous_units: Object.entries(AMBIGUOUS_UNITS).map(([name, options]) => ({ name, options: [...options] })),
    purity_marks: { gold: [...PURITY_MARKS.gold], silver: [...PURITY_MARKS.silver] },
    purity_forms: PURITY_FORMS,
    local_estimate_countries: Object.keys(LOCAL_ADJUSTMENTS),
  });
}

export function summarizeSupported(output: ListSupportedOutput): string {
  const countries = output.local_estimate_countries.length > 0 ? output.local_estimate_countries.join(", ") : "none yet";
  return [
    `Units: ${output.units.map((unit) => unit.id).join(", ")}.`,
    `Gold marks: ${output.purity_marks.gold.join(", ")}. Silver marks: ${output.purity_marks.silver.join(", ")}.`,
    `Countries with a local rate estimate: ${countries}.`,
  ].join("\n");
}
