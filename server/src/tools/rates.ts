import { z } from "zod";
import { D } from "../domain/decimal";
import type { DomainErrorCode } from "../domain/errors";
import { parseCurrency, type Currency } from "../domain/money";
import type { Metal } from "../domain/purity";
import { getFx, getSpot, type FxDeps, type SpotDeps } from "../rates/chain";
import type { FxProvider, FxQuote, RateKind, RateResult, SpotQuote } from "../rates/types";
import { at } from "./card";
import { FX_BUSY } from "./upstream";

export type ToolDeps = SpotDeps & FxDeps;

export type ToolErrorCode = DomainErrorCode | "rate_unavailable" | "rate_busy";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  fix: string;
}

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export function done<T>(value: T): ToolResult<T> {
  return { ok: true, value };
}

export function failed<T>(error: ToolError): ToolResult<T> {
  return { ok: false, error };
}

export const warningSchema = z.object({
  code: z.enum([
    "spot_stale",
    "currency_stale",
    "market_closed",
    "spot_unverified",
    "currency_unverified",
    "gross_weight_used",
    "large_weight",
    "unknown_currency_usd_used",
  ]),
  message: z.string().describe("A plain sentence to repeat to the person."),
});

export type Warning = z.infer<typeof warningSchema>;

const stamp = {
  source: z.string(),
  as_of: z.string().describe("The time the provider gave for this rate."),
  as_of_text: z.string().describe("as_of in words, to show to the person."),
  kind: z.enum(["fresh", "stale", "market_closed"]),
  age_seconds: z.number().int().nonnegative().describe("Seconds since as_of."),
  unverified: z.boolean().describe("True when no second source or earlier rate confirmed this rate."),
};

export const ratesSchema = z.object({
  spot: z.object({ ...stamp, usd_per_troy_oz: z.string() }),
  currency: z
    .object({ ...stamp, pair: z.string(), rate: z.string() })
    .optional()
    .describe("Absent when values are in USD."),
});

export type Rates = z.infer<typeof ratesSchema>;

export function conversionLine({ currency }: Rates): string[] {
  if (currency === undefined) return [];
  const [base, quote] = currency.pair.split("/");
  return [`Converted at 1 ${base} = ${currency.rate} ${quote} from ${currency.source}, dated ${currency.as_of_text}.`];
}

/** The card's form of `conversionLine`. The view may not split `pair`, so the card prints it whole. */
export const conversionNote = {
  kind: "note",
  text: [
    "Converted at ",
    at("rates.currency.pair"),
    " ",
    at("rates.currency.rate"),
    " from ",
    at("rates.currency.source"),
    ", dated ",
    at("rates.currency.as_of_text"),
    ".",
  ],
} as const;

export const placeFields = {
  country: z.string().min(1).max(64).describe("The person's country, such as IN."),
  city: z.string().min(1).max(100).optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional()
    .describe("ISO 4217 code, such as INR. Without it, or when no exchange rate is published for it, values are in USD."),
};

export const pricedFields = {
  source: z.string().describe("The spot price source."),
  as_of: z.string().describe("The spot price time."),
  stale: z.boolean().describe("True when the spot or the currency rate is stale."),
};

export interface Priced {
  perTroyOz: D;
  currency: Currency;
  rates: Rates;
  warnings: Warning[];
  source: string;
  as_of: string;
  stale: boolean;
}

const USD = parseCurrency("USD")!;

function describeAge(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "less than a minute";
  if (minutes === 1) return "1 minute";
  if (minutes < 120) return `${minutes} minutes`;
  const hours = `${Math.floor(minutes / 60)} hours`;
  const rest = minutes % 60;
  if (rest === 0) return hours;
  return rest === 1 ? `${hours} 1 minute` : `${hours} ${rest} minutes`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PROVIDER_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z)?$/;

/**
 * A provider's date or UTC time in words, such as "11 Nov 2026, 11:30 UTC". Seconds are left out.
 * A string in any other form comes back unchanged, so the text is never a guess.
 */
export function describeTime(asOf: string): string {
  const match = PROVIDER_TIME.exec(asOf);
  if (match === null) return asOf;
  const [, year, month, day, hour, minute] = match;
  const name = MONTHS[Number(month) - 1];
  if (name === undefined) return asOf;
  const date = `${Number(day)} ${name} ${year}`;
  return hour === undefined ? date : `${date}, ${hour}:${minute} UTC`;
}

function unavailable(what: string, result: { error: { message: string } }): ToolError {
  return {
    code: "rate_unavailable",
    message: `No ${what} is available now. ${result.error.message}`,
    fix: "Do not estimate or guess the rate or the value. Tell the person the rate is unavailable and try again in a few minutes.",
  };
}

function busy(currency: Currency): ToolError {
  return {
    code: "rate_busy",
    message: `The US dollar to ${currency} rate is busy. This server is fetching other currency rates now, so it did not ask for this one.`,
    fix: "Do not estimate or guess the rate or the value. Try again in a few seconds.",
  };
}

function watchingBusy(deps: ToolDeps): { deps: ToolDeps; sawBusy: () => boolean } {
  let saw = false;
  const watch = (provider: FxProvider): FxProvider => ({
    source: provider.source,
    async fetchFx(currency) {
      const fetched = await provider.fetchFx(currency);
      if (fetched === FX_BUSY) saw = true;
      return fetched;
    },
  });
  return { deps: { ...deps, fxProviders: deps.fxProviders.map(watch) }, sawBusy: () => saw };
}

function stampOf(result: { kind: RateKind; ageSeconds: number; unverified?: true }, source: string, asOf: string) {
  return {
    source,
    as_of: asOf,
    as_of_text: describeTime(asOf),
    kind: result.kind,
    age_seconds: result.ageSeconds,
    unverified: result.unverified === true,
  };
}

function spotWarnings(metal: Metal, spot: Extract<RateResult<SpotQuote>, { quote: SpotQuote }>): Warning[] {
  const warnings: Warning[] = [];
  const { source, asOf } = spot.quote;
  if (spot.kind === "stale") {
    warnings.push({
      code: "spot_stale",
      message: `The ${metal} spot price is from ${describeTime(asOf)}, ${describeAge(spot.ageSeconds)} old. It could not be refreshed, or it is more than 5 minutes old, so the value may be out of date.`,
    });
  }
  if (spot.kind === "market_closed") {
    warnings.push({
      code: "market_closed",
      message: `The ${metal} market is closed. The spot price is from ${describeTime(asOf)}, ${describeAge(spot.ageSeconds)} old.`,
    });
  }
  if (spot.unverified) {
    warnings.push({ code: "spot_unverified", message: `No second source confirmed the ${metal} spot price from ${source}.` });
  }
  return warnings;
}

function currencyWarnings(fx: Extract<RateResult<FxQuote>, { quote: FxQuote }>): Warning[] {
  const warnings: Warning[] = [];
  const pair = `US dollar to ${fx.quote.quote}`;
  if (fx.kind === "stale") {
    warnings.push({
      code: "currency_stale",
      message: `The ${pair} rate is dated ${describeTime(fx.quote.asOf)}. It could not be refreshed, or it is older than expected, so the value may be out of date.`,
    });
  }
  if (fx.unverified) {
    warnings.push({ code: "currency_unverified", message: `No earlier rate confirmed the ${pair} rate.` });
  }
  return warnings;
}

const NO_CURRENCY: Warning = {
  code: "unknown_currency_usd_used",
  message: "No currency was given, so values are in US dollars. Ask the person for their currency and pass it, such as INR.",
};

function unpublished(currency: Currency): Warning {
  return { code: "unknown_currency_usd_used", message: `No exchange rate is published for ${currency}, so values are in US dollars.` };
}

export async function priceIn(metal: Metal, requested: string | undefined, deps: ToolDeps): Promise<ToolResult<Priced>> {
  const currency = requested === undefined ? undefined : parseCurrency(requested);
  const wantsFx = currency !== undefined && currency !== USD;
  const watched = watchingBusy(deps);
  const [spot, fx] = await Promise.all([getSpot(metal, deps), wantsFx ? getFx(currency, watched.deps) : undefined]);
  if (spot.kind === "unavailable") return failed(unavailable(`${metal} spot price`, spot));

  const warnings = spotWarnings(metal, spot);
  const rates: Rates = { spot: { ...stampOf(spot, spot.quote.source, spot.quote.asOf), usd_per_troy_oz: spot.quote.usdPerTroyOz } };
  const spotPrice = { source: spot.quote.source, as_of: spot.quote.asOf };
  let perTroyOz = new D(spot.quote.usdPerTroyOz);
  let target = USD;

  if (currency === undefined) {
    warnings.push(NO_CURRENCY);
  } else if (fx !== undefined) {
    if (fx.kind === "unavailable") {
      if (fx.error.code !== "unknown_currency")
        return failed(watched.sawBusy() ? busy(currency) : unavailable(`US dollar to ${currency} rate`, fx));
      warnings.push(unpublished(currency));
    } else {
      rates.currency = { ...stampOf(fx, fx.quote.source, fx.quote.asOf), pair: `USD/${currency}`, rate: fx.quote.rate };
      warnings.push(...currencyWarnings(fx));
      perTroyOz = perTroyOz.times(fx.quote.rate);
      target = currency;
    }
  }

  const stale = rates.spot.kind === "stale" || rates.currency?.kind === "stale";
  return done({ perTroyOz, currency: target, rates, warnings, ...spotPrice, stale });
}
