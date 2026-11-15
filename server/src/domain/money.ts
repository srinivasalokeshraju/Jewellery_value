import { D } from "./decimal";

export type Currency = string & { readonly __brand: "Currency" };

export function parseCurrency(text: string): Currency | undefined {
  const code = text.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? (code as Currency) : undefined;
}

export function minorUnits(currency: Currency): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function roundMoney(value: D, currency: Currency): string {
  return value.toFixed(minorUnits(currency), D.ROUND_HALF_UP);
}
