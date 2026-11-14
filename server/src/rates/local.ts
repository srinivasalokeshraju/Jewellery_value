import { D } from "../domain/decimal";
import { roundMoney, type Currency } from "../domain/money";

export interface LocalAdjustment {
  duty: string;
  tax: string;
  source: { url: string; retrieved: string };
}

export interface LocalEstimate {
  value: string;
  currency: Currency;
  label: "estimated";
  note: string;
  source: LocalAdjustment["source"];
}

// India is left out: no official customs or GST source could be retrieved on 2026-11-14. Add a country only with a cited official source.
export const LOCAL_ADJUSTMENTS: Readonly<Record<string, LocalAdjustment>> = {};

export function localEstimate(
  spot: { value: D; currency: Currency },
  country: string,
  table: Readonly<Record<string, LocalAdjustment>> = LOCAL_ADJUSTMENTS,
): LocalEstimate | undefined {
  const adjustment = table[country.toUpperCase()];
  if (adjustment === undefined) return undefined;
  const value = spot.value.times(new D(1).plus(adjustment.duty)).times(new D(1).plus(adjustment.tax));
  return {
    value: roundMoney(value, spot.currency),
    currency: spot.currency,
    label: "estimated",
    note: `Spot plus ${country.toUpperCase()} import duty and tax. This is an estimate, not an official local rate.`,
    source: adjustment.source,
  };
}
