import Decimal from "decimal.js";

export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type D = Decimal;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseDecimal(value: string | number): D | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? new D(value) : undefined;
  const text = value.trim();
  return NUMBER.test(text) ? new D(text) : undefined;
}
