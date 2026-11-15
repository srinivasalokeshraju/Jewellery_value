import type { Currency } from "../../src/domain/money";
import type { Metal } from "../../src/domain/purity";
import { MemoryCache } from "../../src/rates/cache";
import {
  fail,
  ok,
  type Fetched,
  type FxProvider,
  type FxQuote,
  type RateLogEvent,
  type SpotProvider,
  type SpotQuote,
  type SpotSource,
} from "../../src/rates/types";
import type { ToolDeps } from "../../src/tools/rates";
import type { FetchCodes } from "../../src/tools/upstream";

export const WEDNESDAY_NOON = new Date("2026-11-11T12:00:00.000Z");
export const SATURDAY_NOON = new Date("2026-11-14T12:00:00.000Z");

const PRICES: Record<SpotSource, Record<Metal, string>> = {
  "gold-api.com": { gold: "4000", silver: "50" },
  "xaus.com": { gold: "4001", silver: "50.05" },
};

export const DOWN = fail<never>("provider_failed", "request failed: no answer within 2000 ms.", "Use another provider.");

export function minutesBefore(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export function spotProvider(
  source: SpotSource,
  answer?: (metal: Metal) => Fetched<SpotQuote>,
  now = WEDNESDAY_NOON,
): SpotProvider & { calls: Metal[] } {
  const calls: Metal[] = [];
  return {
    source,
    calls,
    async fetchSpot(metal) {
      calls.push(metal);
      return answer ? answer(metal) : ok({ metal, usdPerTroyOz: PRICES[source][metal], asOf: minutesBefore(now, 1), source });
    },
  };
}

export function fxProvider(answer?: (currency: Currency) => Fetched<FxQuote>, now = WEDNESDAY_NOON): FxProvider & { calls: Currency[] } {
  const calls: Currency[] = [];
  return {
    source: "frankfurter.dev",
    calls,
    async fetchFx(currency) {
      calls.push(currency);
      if (answer) return answer(currency);
      const rate = currency === "AED" ? "3.6725" : "88.5";
      return ok({ quote: currency, rate, asOf: now.toISOString().slice(0, 10), source: "frankfurter.dev" });
    },
  };
}

interface Options {
  now?: Date;
  primary?: SpotProvider;
  fallback?: SpotProvider;
  fx?: FxProvider;
  cache?: MemoryCache;
  codes?: FetchCodes;
}

const NO_LIST: FetchCodes = async () => fail("provider_failed", "This test gives no currency list.", "Use another provider.");

export function fakeDeps(options: Options = {}): ToolDeps & { events: RateLogEvent[]; cache: MemoryCache; fetchCurrencyCodes: FetchCodes } {
  const now = options.now ?? WEDNESDAY_NOON;
  const events: RateLogEvent[] = [];
  return {
    cache: options.cache ?? new MemoryCache(),
    now: () => now,
    log: (event) => events.push(event),
    events,
    spotProviders: [
      options.primary ?? spotProvider("gold-api.com", undefined, now),
      options.fallback ?? spotProvider("xaus.com", undefined, now),
    ],
    fxProviders: [options.fx ?? fxProvider(undefined, now)],
    fetchCurrencyCodes: options.codes ?? NO_LIST,
  };
}
