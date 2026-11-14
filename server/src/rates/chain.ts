import type { z } from "zod";
import { D } from "../domain/decimal";
import type { Currency } from "../domain/money";
import type { Metal } from "../domain/purity";
import type { CacheRecord, RateCache } from "./cache";
import { isMarketClosed } from "./market";
import {
  fxQuoteSchema,
  ok,
  spotQuoteSchema,
  type Fetched,
  type FxProvider,
  type FxQuote,
  type FxSource,
  type RateLog,
  type RateResult,
  type SpotProvider,
  type SpotQuote,
  type SpotSource,
} from "./types";
import { validateSpot } from "./validate";

const HOUR = 60 * 60;
const SPOT_FRESH_SECONDS = 60;
const FX_FRESH_SECONDS = HOUR;
const STALE_LIMIT_SECONDS = 24 * HOUR;
const MARKET_CLOSED_LIMIT_SECONDS = 96 * HOUR;
const DISAGREEMENT = new D("0.02");

interface Deps {
  cache: RateCache;
  now: () => Date;
  log: RateLog;
}

export interface SpotDeps extends Deps {
  spotProviders: readonly SpotProvider[];
}

export interface FxDeps extends Deps {
  fxProviders: readonly FxProvider[];
}

interface Lane<Q> {
  key: string;
  freshSeconds: number;
  schema: z.ZodType<Q, unknown>;
  matches(quote: Q): boolean;
  sources: readonly { source: SpotSource | FxSource; fetch(): Promise<Fetched<Q>> }[];
  validate(quote: Q, lastGood: Q | undefined): Fetched<Q>;
}

interface Cached<Q> {
  quote: Q;
  ageSeconds: number;
}

export function spotKey(metal: Metal): string {
  return `spot:${metal}`;
}

export function fxKey(currency: Currency): string {
  return `fx:${currency}`;
}

function ageSeconds(fetchedAt: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(fetchedAt)) / 1000);
}

async function readCache<Q>(lane: Lane<Q>, deps: Deps, now: Date): Promise<Cached<Q> | undefined> {
  let record: CacheRecord | undefined;
  try {
    record = await deps.cache.get(lane.key);
  } catch (cause) {
    deps.log({ event: "cache_failed", key: lane.key, message: String(cause) });
    return undefined;
  }
  if (record === undefined) return undefined;
  const quote = lane.schema.safeParse(record.quote);
  const age = ageSeconds(record.fetchedAt, now);
  if (!quote.success || !lane.matches(quote.data) || !(age >= 0)) return undefined;
  return { quote: quote.data, ageSeconds: age };
}

async function writeCache<Q extends SpotQuote | FxQuote>(lane: Lane<Q>, deps: Deps, quote: Q, now: Date): Promise<void> {
  try {
    await deps.cache.put(lane.key, { quote, fetchedAt: now.toISOString() });
  } catch (cause) {
    deps.log({ event: "cache_failed", key: lane.key, message: String(cause) });
  }
}

function lastGoodOf<Q>(cached: Cached<Q> | undefined): Q | undefined {
  return cached && cached.ageSeconds < MARKET_CLOSED_LIMIT_SECONDS ? cached.quote : undefined;
}

async function attempt<Q>(lane: Lane<Q>, { source, fetch }: Lane<Q>["sources"][number], lastGood: Q | undefined, deps: Deps): Promise<Fetched<Q>> {
  const fetched = await fetch();
  const checked = fetched.ok ? lane.validate(fetched.value, lastGood) : fetched;
  if (!checked.ok && checked.error.code !== "unknown_currency") {
    const event = checked.error.code === "rate_rejected" ? "rate_rejected" : "provider_failed";
    deps.log({ event, key: lane.key, source, code: checked.error.code, message: checked.error.message });
  }
  return checked;
}

async function resolve<Q extends SpotQuote | FxQuote>(lane: Lane<Q>, deps: Deps): Promise<RateResult<Q>> {
  const now = deps.now();
  const closed = isMarketClosed(now);
  const live = closed ? "market_closed" : "fresh";
  const cached = await readCache(lane, deps, now);
  if (cached && cached.ageSeconds < lane.freshSeconds) return { kind: live, quote: cached.quote, ageSeconds: cached.ageSeconds };

  const lastGood = lastGoodOf(cached);
  for (const source of lane.sources) {
    const checked = await attempt(lane, source, lastGood, deps);
    if (checked.ok) {
      await writeCache(lane, deps, checked.value, now);
      return { kind: live, quote: checked.value, ageSeconds: 0 };
    }
    if (checked.error.code === "unknown_currency") return { kind: "unavailable", error: checked.error };
  }

  if (cached && closed && cached.ageSeconds < MARKET_CLOSED_LIMIT_SECONDS) return { kind: "market_closed", ...cached };
  if (cached && cached.ageSeconds < STALE_LIMIT_SECONDS) return { kind: "stale", ...cached };
  return {
    kind: "unavailable",
    error: {
      code: "rate_unavailable",
      message: `No provider answered for ${lane.key} and no cached rate is recent enough to use.`,
      fix: "Do not estimate the rate. Tell the person the rate is unavailable and try again later.",
    },
  };
}

function spotLane(metal: Metal, providers: readonly SpotProvider[]): Lane<SpotQuote> {
  return {
    key: spotKey(metal),
    freshSeconds: SPOT_FRESH_SECONDS,
    schema: spotQuoteSchema,
    matches: (quote) => quote.metal === metal,
    sources: providers.map((provider) => ({ source: provider.source, fetch: () => provider.fetchSpot(metal) })),
    validate: validateSpot,
  };
}

export function getSpot(metal: Metal, deps: SpotDeps): Promise<RateResult<SpotQuote>> {
  return resolve(spotLane(metal, deps.spotProviders), deps);
}

export function getFx(currency: Currency, deps: FxDeps): Promise<RateResult<FxQuote>> {
  return resolve<FxQuote>(
    {
      key: fxKey(currency),
      freshSeconds: FX_FRESH_SECONDS,
      schema: fxQuoteSchema,
      matches: (quote) => quote.quote === currency,
      sources: deps.fxProviders.map((provider) => ({ source: provider.source, fetch: () => provider.fetchFx(currency) })),
      validate: (quote) => ok(quote),
    },
    deps,
  );
}

export interface RefreshOutcome {
  metal: Metal;
  written?: SpotSource;
}

export async function refreshAll(deps: SpotDeps): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];
  for (const metal of ["gold", "silver"] as const) {
    const lane = spotLane(metal, deps.spotProviders);
    const now = deps.now();
    const cached = await readCache(lane, deps, now);
    const lastGood = lastGoodOf(cached);
    const results = await Promise.all(lane.sources.map((source) => attempt(lane, source, lastGood, deps)));
    const good = results.flatMap((result) => (result.ok ? [result.value] : []));

    const [first, second] = good;
    if (first && second) {
      const a = new D(first.usdPerTroyOz);
      const gap = a.minus(second.usdPerTroyOz).abs().div(a);
      if (gap.gt(DISAGREEMENT)) {
        deps.log({
          event: "rate_disagreement",
          metal,
          prices: good.map((quote) => ({ source: quote.source, usdPerTroyOz: quote.usdPerTroyOz })),
          gapPercent: gap.times(100).toFixed(2),
        });
      }
    }
    if (first) await writeCache(lane, deps, first, now);
    outcomes.push(first ? { metal, written: first.source } : { metal });
  }
  return outcomes;
}
