import type { z } from "zod";
import type { Currency } from "../domain/money";
import type { Metal } from "../domain/purity";
import { cacheRecordSchema, type RateCache } from "./cache";
import { isMarketClosed } from "./market";
import {
  fail,
  fetchedSchema,
  fxQuoteSchema,
  spotQuoteSchema,
  TRY_ANOTHER_SOURCE,
  type Fetched,
  type FxProvider,
  type FxQuote,
  type FxSource,
  type RateKind,
  type RateLog,
  type RateResult,
  type SpotProvider,
  type SpotQuote,
  type SpotSource,
} from "./types";
import { checkFx, checkMove, checkSpot, fxDayStart, MAX_DISAGREEMENT, MAX_MOVE, relativeGap } from "./validate";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const SPOT_CACHE_SECONDS = 60;
const SPOT_FRESH_SECONDS = 300;
const FX_CACHE_SECONDS = HOUR;
const STALE_LIMIT_SECONDS = DAY;
const MARKET_CLOSED_LIMIT_SECONDS = 96 * HOUR;
const REFERENCE_LIMIT_SECONDS = 96 * HOUR;
const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const DAYS_SINCE_FRIDAY: Partial<Record<number, number>> = { [SATURDAY]: 1, [SUNDAY]: 2, [MONDAY]: 3 };

interface Deps {
  cache: RateCache;
  now: () => Date;
  log: RateLog;
}

export interface SpotDeps extends Deps {
  spotProviders: readonly [primary: SpotProvider, fallback: SpotProvider];
}

export interface FxDeps extends Deps {
  fxProviders: readonly FxProvider[];
}

interface Freshness {
  kind: RateKind;
  ageSeconds: number;
}

interface Cached<Q> {
  quote: Q;
  cacheAgeSeconds: number;
  unverified?: true;
}

interface Accepted {
  quote: SpotQuote;
  unverified?: true;
}

export function spotKey(metal: Metal): string {
  return `spot:${metal}`;
}

export function fxKey(currency: Currency): string {
  return `fx:${currency}`;
}

function secondsBetween(from: number, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from) / 1000));
}

function spotAge(quote: SpotQuote, now: Date): number {
  return secondsBetween(Date.parse(quote.asOf), now);
}

function fxAge(quote: FxQuote, now: Date): number {
  return secondsBetween(fxDayStart(quote.asOf), now);
}

function spotFreshness(quote: SpotQuote, now: Date): Freshness | undefined {
  const ageSeconds = spotAge(quote, now);
  if (isMarketClosed(now)) return ageSeconds < MARKET_CLOSED_LIMIT_SECONDS ? { kind: "market_closed", ageSeconds } : undefined;
  if (ageSeconds <= SPOT_FRESH_SECONDS) return { kind: "fresh", ageSeconds };
  return ageSeconds < STALE_LIMIT_SECONDS ? { kind: "stale", ageSeconds } : undefined;
}

function fxFreshness(quote: FxQuote, now: Date): Freshness {
  const today = fxDayStart(now.toISOString().slice(0, 10));
  const daysOld = Math.round((today - fxDayStart(quote.asOf)) / (DAY * 1000));
  const fresh = daysOld <= 1 || daysOld === DAYS_SINCE_FRIDAY[now.getUTCDay()];
  return { kind: fresh ? "fresh" : "stale", ageSeconds: fxAge(quote, now) };
}

function answer<Q>(quote: Q, { kind, ageSeconds }: Freshness, unverified?: true): RateResult<Q> {
  return unverified ? { kind, quote, ageSeconds, unverified } : { kind, quote, ageSeconds };
}

function afterFailure<Q>(cached: Cached<Q> | undefined, freshness: Freshness | undefined): RateResult<Q> {
  if (cached && freshness) return answer(cached.quote, { ...freshness, kind: freshness.kind === "fresh" ? "stale" : freshness.kind }, cached.unverified);
  return {
    kind: "unavailable",
    error: {
      code: "rate_unavailable",
      message: "No provider gave an acceptable rate and no cached rate is recent enough to use.",
      fix: "Do not estimate the rate. Tell the person the rate is unavailable and try again later.",
    },
  };
}

async function readCache<Q>(key: string, parse: (quote: unknown) => Q | undefined, deps: Deps, now: Date): Promise<Cached<Q> | undefined> {
  let raw: unknown;
  try {
    raw = await deps.cache.get(key);
  } catch (cause) {
    deps.log({ event: "cache_failed", key, message: String(cause) });
    return undefined;
  }
  const record = cacheRecordSchema.safeParse(raw);
  if (!record.success) return undefined;
  const quote = parse(record.data.quote);
  const fetchedAt = Date.parse(record.data.fetchedAt);
  if (quote === undefined || fetchedAt > now.getTime()) return undefined;
  const cacheAgeSeconds = secondsBetween(fetchedAt, now);
  return record.data.unverified ? { quote, cacheAgeSeconds, unverified: true } : { quote, cacheAgeSeconds };
}

async function writeCache(key: string, quote: SpotQuote | FxQuote, now: Date, deps: Deps, unverified?: true): Promise<void> {
  const record = { quote, fetchedAt: now.toISOString() };
  try {
    await deps.cache.put(key, unverified ? { ...record, unverified } : record);
  } catch (cause) {
    deps.log({ event: "cache_failed", key, message: String(cause) });
  }
}

async function call<Q>(fetch: () => Promise<Fetched<Q>>, source: string, quoteSchema: z.ZodType<Q>): Promise<Fetched<Q>> {
  let answer: unknown;
  try {
    answer = await fetch();
  } catch (cause) {
    return fail("provider_failed", `${source} threw: ${String(cause)}.`, TRY_ANOTHER_SOURCE);
  }
  const fetched = fetchedSchema(quoteSchema).safeParse(answer);
  return fetched.success ? fetched.data : fail("provider_failed", `${source} returned something other than a rate or an error.`, TRY_ANOTHER_SOURCE);
}

function logFailure(key: string, source: SpotSource | FxSource, result: Fetched<unknown>, deps: Deps): void {
  if (result.ok || result.error.code === "unknown_currency") return;
  const event = result.error.code === "rate_rejected" ? "rate_rejected" : "provider_failed";
  deps.log({ event, key, source, code: result.error.code, message: result.error.message });
}

function parseSpot(metal: Metal, now: Date) {
  return (raw: unknown): SpotQuote | undefined => {
    const quote = spotQuoteSchema.safeParse(raw);
    return quote.success && quote.data.metal === metal && checkSpot(quote.data, now).ok ? quote.data : undefined;
  };
}

function checkLiveSpot(metal: Metal, quote: SpotQuote, now: Date): Fetched<SpotQuote> {
  if (quote.metal !== metal) return fail("invalid_response", `${quote.source} answered for ${quote.metal}, not ${metal}.`, TRY_ANOTHER_SOURCE);
  const checked = checkSpot(quote, now);
  if (!checked.ok || spotFreshness(quote, now)) return checked;
  return fail("rate_rejected", `${quote.source} dated its ${metal} price ${quote.asOf}, ${spotAge(quote, now)} seconds before now.`, TRY_ANOTHER_SOURCE);
}

async function fetchSpot(metal: Metal, provider: SpotProvider, now: Date, deps: Deps): Promise<Fetched<SpotQuote>> {
  const fetched = await call(() => provider.fetchSpot(metal), provider.source, spotQuoteSchema);
  const checked = fetched.ok ? checkLiveSpot(metal, fetched.value, now) : fetched;
  logFailure(spotKey(metal), provider.source, checked, deps);
  return checked;
}

function disagreement(metal: Metal, a: SpotQuote, b: SpotQuote, deps: Deps): boolean {
  const gap = relativeGap(b.usdPerTroyOz, a.usdPerTroyOz);
  if (gap.lte(MAX_DISAGREEMENT)) return false;
  deps.log({
    event: "rate_disagreement",
    metal,
    prices: [a, b].map((quote) => ({ source: quote.source, usdPerTroyOz: quote.usdPerTroyOz })),
    gapPercent: gap.times(100).toFixed(2),
  });
  return true;
}

function withinMove(metal: Metal, quote: SpotQuote, reference: SpotQuote): Fetched<SpotQuote> {
  return checkMove(quote, quote.usdPerTroyOz, reference.usdPerTroyOz, `${quote.source} gave ${metal} at`);
}

async function chooseSpot(
  metal: Metal,
  primary: Fetched<SpotQuote>,
  fallback: () => Promise<Fetched<SpotQuote>>,
  reference: SpotQuote | undefined,
  deps: Deps,
): Promise<Accepted | undefined> {
  const key = spotKey(metal);
  if (reference === undefined) {
    const second = await fallback();
    if (primary.ok && second.ok) return disagreement(metal, primary.value, second.value, deps) ? undefined : { quote: primary.value };
    const only = primary.ok ? primary : second;
    return only.ok ? { quote: only.value, unverified: true } : undefined;
  }

  const moved = primary.ok ? withinMove(metal, primary.value, reference) : primary;
  if (moved.ok) return { quote: moved.value };
  const second = await fallback();
  if (primary.ok && second.ok && relativeGap(second.value.usdPerTroyOz, primary.value.usdPerTroyOz).lte(MAX_DISAGREEMENT)) {
    deps.log({ event: "reference_replaced", metal, source: primary.value.source, previous: reference.usdPerTroyOz, usdPerTroyOz: primary.value.usdPerTroyOz });
    return { quote: primary.value };
  }
  if (primary.ok) logFailure(key, primary.value.source, moved, deps);
  const fallbackMoved = second.ok ? withinMove(metal, second.value, reference) : second;
  if (second.ok) logFailure(key, second.value.source, fallbackMoved, deps);
  return fallbackMoved.ok ? { quote: fallbackMoved.value } : undefined;
}

function referenceOf<Q>(cached: Cached<Q> | undefined, age: (quote: Q) => number): Q | undefined {
  return cached && !cached.unverified && age(cached.quote) < REFERENCE_LIMIT_SECONDS ? cached.quote : undefined;
}

export async function getSpot(metal: Metal, deps: SpotDeps): Promise<RateResult<SpotQuote>> {
  const now = deps.now();
  const key = spotKey(metal);
  const cached = await readCache(key, parseSpot(metal, now), deps, now);
  const cachedFreshness = cached && spotFreshness(cached.quote, now);
  if (cached && cachedFreshness && cached.cacheAgeSeconds < SPOT_CACHE_SECONDS) return answer(cached.quote, cachedFreshness, cached.unverified);

  const reference = referenceOf(cached, (quote) => spotAge(quote, now));
  const [primary, fallback] = deps.spotProviders;
  let pending: Promise<Fetched<SpotQuote>> | undefined;
  const first = fetchSpot(metal, primary, now, deps);
  const second = () => (pending ??= fetchSpot(metal, fallback, now, deps));
  if (reference === undefined) void second();

  const accepted = await chooseSpot(metal, await first, second, reference, deps);
  if (accepted === undefined) return afterFailure(cached, cachedFreshness);
  await writeCache(key, accepted.quote, now, deps, accepted.unverified);
  return answer(accepted.quote, spotFreshness(accepted.quote, now)!, accepted.unverified);
}

export async function getFx(currency: Currency, deps: FxDeps): Promise<RateResult<FxQuote>> {
  const now = deps.now();
  const key = fxKey(currency);
  const parse = (raw: unknown): FxQuote | undefined => {
    const quote = fxQuoteSchema.safeParse(raw);
    return quote.success && quote.data.quote === currency && checkFx(quote.data, now).ok ? quote.data : undefined;
  };
  const cached = await readCache(key, parse, deps, now);
  if (cached && cached.cacheAgeSeconds < FX_CACHE_SECONDS) return answer(cached.quote, fxFreshness(cached.quote, now), cached.unverified);

  const reference = referenceOf(cached, (quote) => fxAge(quote, now));
  for (const provider of deps.fxProviders) {
    const fetched = await call(() => provider.fetchFx(currency), provider.source, fxQuoteSchema);
    if (!fetched.ok && fetched.error.code === "unknown_currency") return { kind: "unavailable", error: fetched.error };
    const checked = fetched.ok ? checkLiveFx(currency, fetched.value, reference, now) : fetched;
    logFailure(key, provider.source, checked, deps);
    if (checked.ok) {
      const unverified = confirmsLastGood(checked.value, cached, now) ? undefined : true;
      await writeCache(key, checked.value, now, deps, unverified);
      return answer(checked.value, fxFreshness(checked.value, now), unverified);
    }
  }
  return afterFailure(cached, cached && fxFreshness(cached.quote, now));
}

// Currency rates have one source, so a later rate within the move limit of the last one is what verifies it.
function confirmsLastGood(quote: FxQuote, cached: Cached<FxQuote> | undefined, now: Date): boolean {
  return cached !== undefined && fxAge(cached.quote, now) < REFERENCE_LIMIT_SECONDS && relativeGap(quote.rate, cached.quote.rate).lte(MAX_MOVE);
}

function checkLiveFx(currency: Currency, quote: FxQuote, reference: FxQuote | undefined, now: Date): Fetched<FxQuote> {
  if (quote.quote !== currency) return fail("invalid_response", `${quote.source} answered for ${quote.quote}, not ${currency}.`, TRY_ANOTHER_SOURCE);
  const checked = checkFx(quote, now);
  if (!checked.ok || reference === undefined) return checked;
  return checkMove(quote, quote.rate, reference.rate, `${quote.source} gave USD to ${currency} at`);
}

export interface RefreshOutcome {
  metal: Metal;
  written?: SpotSource;
}

export async function refreshAll(deps: SpotDeps): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];
  for (const metal of ["gold", "silver"] as const) {
    const now = deps.now();
    const key = spotKey(metal);
    const cached = await readCache(key, parseSpot(metal, now), deps, now);
    const [primary, fallback] = deps.spotProviders;
    const [first, second] = await Promise.all([fetchSpot(metal, primary, now, deps), fetchSpot(metal, fallback, now, deps)]);
    const disagree = first.ok && second.ok && disagreement(metal, first.value, second.value, deps);
    const accepted = disagree ? undefined : await chooseSpot(metal, first, async () => second, referenceOf(cached, (quote) => spotAge(quote, now)), deps);
    if (accepted) await writeCache(key, accepted.quote, now, deps, accepted.unverified);
    outcomes.push(accepted ? { metal, written: accepted.quote.source } : { metal });
  }
  return outcomes;
}
