import { z } from "zod";
import type { Currency } from "../domain/money";
import type { Metal } from "../domain/purity";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/);

export const spotQuoteSchema = z.object({
  metal: z.enum(["gold", "silver"]),
  usdPerTroyOz: decimalString,
  asOf: z.iso.datetime(),
  source: z.enum(["gold-api.com", "xaus.com"]),
});

export const fxQuoteSchema = z.object({
  quote: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .transform((code) => code as Currency),
  rate: decimalString,
  asOf: z.iso.date(),
  source: z.literal("frankfurter.dev"),
});

export type SpotQuote = z.infer<typeof spotQuoteSchema>;
export type FxQuote = z.infer<typeof fxQuoteSchema>;
export type SpotSource = SpotQuote["source"];
export type FxSource = FxQuote["source"];

export type RateErrorCode = "provider_failed" | "invalid_response" | "rate_rejected" | "unknown_currency" | "rate_unavailable";

export interface RateError {
  code: RateErrorCode;
  message: string;
  fix: string;
}

export type Fetched<T> = { ok: true; value: T } | { ok: false; error: RateError };

export function ok<T>(value: T): Fetched<T> {
  return { ok: true, value };
}

export const TRY_ANOTHER_SOURCE = "Use another provider or the last good cached value.";

export function fail<T>(code: RateErrorCode, message: string, fix: string): Fetched<T> {
  return { ok: false, error: { code, message, fix } };
}

export interface FetchResponse {
  status: number;
  body: unknown;
}

export type FetchJson = (url: string, signal: AbortSignal) => Promise<FetchResponse>;

export interface SpotProvider {
  source: SpotSource;
  fetchSpot(metal: Metal): Promise<Fetched<SpotQuote>>;
}

export interface FxProvider {
  source: FxSource;
  fetchFx(currency: Currency): Promise<Fetched<FxQuote>>;
}

export type RateKind = "fresh" | "stale" | "market_closed";

export type RateResult<Q> =
  | { kind: RateKind; quote: Q; ageSeconds: number; unverified?: true }
  | { kind: "unavailable"; error: RateError };

export type RateLogEvent =
  | { event: "provider_failed" | "rate_rejected"; key: string; source: SpotSource | FxSource; code: RateErrorCode; message: string }
  | { event: "rate_disagreement"; metal: Metal; prices: { source: SpotSource; usdPerTroyOz: string }[]; gapPercent: string }
  | { event: "reference_replaced"; metal: Metal; source: SpotSource; previous: string; usdPerTroyOz: string }
  | { event: "cache_failed"; key: string; message: string };

export type RateLog = (event: RateLogEvent) => void;
