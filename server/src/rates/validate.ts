import { D } from "../domain/decimal";
import { TRY_ANOTHER_SOURCE, fail, ok, type Fetched, type SpotQuote } from "./types";

const MAX_MOVE = new D("0.10");

export function positiveDecimal(value: number, what: string): Fetched<string> {
  if (!Number.isFinite(value) || value <= 0) {
    return fail("rate_rejected", `${what} was ${value}, which is not a positive number.`, TRY_ANOTHER_SOURCE);
  }
  return ok(new D(value).toFixed());
}

export function rejectOldSpot(quote: SpotQuote, now: Date, limitSeconds: number): Fetched<SpotQuote> {
  const ageSeconds = Math.floor((now.getTime() - Date.parse(quote.asOf)) / 1000);
  if (ageSeconds >= limitSeconds) {
    return fail("rate_rejected", `${quote.source} dated its ${quote.metal} price ${quote.asOf}, ${ageSeconds} seconds before now.`, TRY_ANOTHER_SOURCE);
  }
  return ok(quote);
}

export function validateSpot(quote: SpotQuote, lastGood: SpotQuote | undefined): Fetched<SpotQuote> {
  const price = new D(quote.usdPerTroyOz);
  if (!price.isFinite() || price.lte(0)) {
    return fail("rate_rejected", `${quote.source} gave ${quote.metal} at ${quote.usdPerTroyOz} USD, which is not a positive price.`, TRY_ANOTHER_SOURCE);
  }
  if (lastGood === undefined) return ok(quote);
  const last = new D(lastGood.usdPerTroyOz);
  const move = price.minus(last).abs().div(last);
  if (move.gt(MAX_MOVE)) {
    return fail(
      "rate_rejected",
      `${quote.source} gave ${quote.metal} at ${quote.usdPerTroyOz} USD, ${move.times(100).toFixed(1)} percent away from the last good ${lastGood.usdPerTroyOz} USD.`,
      TRY_ANOTHER_SOURCE,
    );
  }
  return ok(quote);
}
