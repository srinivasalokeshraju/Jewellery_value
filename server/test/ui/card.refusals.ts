// Checked by `npm run typecheck`, not run by Vitest. Each line below must fail to compile.
import { at, type CardTemplate } from "../../src/tools/card";
import type { CalcMeltValueOutput } from "../../src/tools/calcMeltValue";
import type { ListSupportedOutput } from "../../src/tools/listSupported";

export const refused: CardTemplate<CalcMeltValueOutput> = {
  title: "x",
  blocks: [
    // @ts-expect-error a misspelt field
    { kind: "row", label: "x", text: [at("pure_gram")] },
    // @ts-expect-error a computed number is not printable, so nobody formats seconds into minutes
    { kind: "row", label: "x", text: [at("rates.spot.age_seconds")] },
    // @ts-expect-error an optional field in a plain row: use row_if_present
    { kind: "row", label: "x", text: [at("local_estimate.value")] },
    // @ts-expect-error a boolean is not printable
    { kind: "row", label: "x", text: [at("spot_melt.stale")] },
    // @ts-expect-error an array is not a text pointer
    { kind: "row", label: "x", text: [at("warnings")] },
    // @ts-expect-error the metal pointer must reach a metal name, not any string
    { kind: "headline", label: "x", text: [at("pure_grams")], metal: at("currency") },
  ],
};

export const refusedTable: CardTemplate<ListSupportedOutput> = {
  title: "x",
  blocks: [
    // @ts-expect-error a table column must be a string field of the item
    { kind: "table", each: "units", columns: [{ label: "x", at: "nope" }] },
    // @ts-expect-error ambiguous_units[].options is an array, not a string
    { kind: "table", each: "ambiguous_units", columns: [{ label: "x", at: "options" }] },
    // @ts-expect-error purity_forms is a list of strings: use chips
    { kind: "table", each: "purity_forms", columns: [] },
  ],
};
