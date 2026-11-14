import { D } from "../domain/decimal";
import type { Metal } from "../domain/purity";
import { TRY_ANOTHER_SOURCE, fail, ok, type Fetched, type FxQuote, type SpotQuote } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SPOT_MS = 120 * 1000;
const MAX_FUTURE_FX_MS = DAY_MS;
const MAX_PAST_FX_MS = 7 * DAY_MS;

const MAX_MOVE = new D("0.10");
export const MAX_DISAGREEMENT = new D("0.02");

const PLAUSIBLE_USD_PER_TROY_OZ: Record<Metal, { min: D; max: D; reason: string }> = {
  gold: { min: new D(200), max: new D(50000), reason: "a per-gram price or a decimal point shifted two places falls outside" },
  silver: { min: new D(2), max: new D(2000), reason: "a per-gram price or a decimal point shifted two places falls outside" },
};

export function positiveDecimal(value: number, what: string): Fetched<string> {
  if (!Number.isFinite(value) || value <= 0) {
    return fail("rate_rejected", `${what} was ${value}, which is not a positive number.`, TRY_ANOTHER_SOURCE);
  }
  return ok(new D(value).toFixed());
}

export function relativeGap(value: string, reference: string): D {
  const base = new D(reference);
  return new D(value).minus(base).abs().div(base);
}

export function fxDayStart(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function checkSpot(quote: SpotQuote, now: Date): Fetched<SpotQuote> {
  const price = new D(quote.usdPerTroyOz);
  const { min, max, reason } = PLAUSIBLE_USD_PER_TROY_OZ[quote.metal];
  if (price.lt(min) || price.gt(max)) {
    return fail(
      "rate_rejected",
      `${quote.source} gave ${quote.metal} at ${quote.usdPerTroyOz} USD per troy ounce, outside ${min} to ${max}, where ${reason}.`,
      TRY_ANOTHER_SOURCE,
    );
  }
  if (Date.parse(quote.asOf) - now.getTime() > MAX_FUTURE_SPOT_MS) {
    return fail("rate_rejected", `${quote.source} dated its ${quote.metal} price ${quote.asOf}, more than 120 seconds after now.`, TRY_ANOTHER_SOURCE);
  }
  return ok(quote);
}

export function checkFx(quote: FxQuote, now: Date): Fetched<FxQuote> {
  const rate = new D(quote.rate);
  if (rate.lte(0)) return fail("rate_rejected", `${quote.source} gave USD to ${quote.quote} at ${quote.rate}, which is not a positive rate.`, TRY_ANOTHER_SOURCE);
  const offset = fxDayStart(quote.asOf) - now.getTime();
  if (offset > MAX_FUTURE_FX_MS) return fail("rate_rejected", `${quote.source} dated its USD to ${quote.quote} rate ${quote.asOf}, more than 1 day after now.`, TRY_ANOTHER_SOURCE);
  if (-offset > MAX_PAST_FX_MS) return fail("rate_rejected", `${quote.source} dated its USD to ${quote.quote} rate ${quote.asOf}, more than 7 days before now.`, TRY_ANOTHER_SOURCE);
  return ok(quote);
}

export function checkMove<Q>(quote: Q, value: string, reference: string, what: string): Fetched<Q> {
  const move = relativeGap(value, reference);
  if (move.gt(MAX_MOVE)) {
    return fail("rate_rejected", `${what} ${value}, ${move.times(100).toFixed(1)} percent away from the last good ${reference}.`, TRY_ANOTHER_SOURCE);
  }
  return ok(quote);
}
