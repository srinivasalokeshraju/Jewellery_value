import { describe, expect, it } from "vitest";
import { parseCurrency } from "../../src/domain/money";
import type { Metal } from "../../src/domain/purity";
import { KvCache, MemoryCache, type KvNamespaceLike, type RateCache } from "../../src/rates/cache";
import { getFx, getSpot, refreshAll, type SpotDeps } from "../../src/rates/chain";
import { fail, ok, type Fetched, type FxProvider, type FxQuote, type RateLogEvent, type SpotProvider, type SpotQuote, type SpotSource } from "../../src/rates/types";

const WEDNESDAY_NOON = new Date("2026-11-11T12:00:00.000Z");
const SATURDAY_NOON = new Date("2026-11-14T12:00:00.000Z");
const HOUR = 3600;
const INR = parseCurrency("INR")!;

function quote(source: SpotSource, usdPerTroyOz: string, metal: Metal = "gold"): SpotQuote {
  return { metal, usdPerTroyOz, asOf: "2026-11-11T11:59:00Z", source };
}

const DOWN = fail<SpotQuote>("provider_failed", "gold-api.com request failed: no answer within 2000 ms.", "Use another provider.");

function fakeSpot(source: SpotSource, answer: (metal: Metal) => Fetched<SpotQuote>): SpotProvider & { calls: Metal[] } {
  const calls: Metal[] = [];
  return {
    source,
    calls,
    async fetchSpot(metal) {
      calls.push(metal);
      return answer(metal);
    },
  };
}

function setup(options: { primary?: Fetched<SpotQuote>; fallback?: Fetched<SpotQuote>; now?: Date; cache?: RateCache } = {}) {
  const primary = fakeSpot("gold-api.com", () => options.primary ?? ok(quote("gold-api.com", "4000")));
  const fallback = fakeSpot("xaus.com", () => options.fallback ?? ok(quote("xaus.com", "4001")));
  const events: RateLogEvent[] = [];
  const cache = options.cache ?? new MemoryCache();
  const now = options.now ?? WEDNESDAY_NOON;
  const deps: SpotDeps = { spotProviders: [primary, fallback], cache, now: () => now, log: (event) => events.push(event) };
  return { primary, fallback, events, cache, deps };
}

function cacheAged(seconds: number, now = WEDNESDAY_NOON, cached: SpotQuote = quote("gold-api.com", "3900")): MemoryCache {
  const cache = new MemoryCache();
  void cache.put("spot:gold", { quote: cached, fetchedAt: new Date(now.getTime() - seconds * 1000).toISOString() });
  return cache;
}

describe("getSpot", () => {
  it("returns the primary quote as fresh, writes the cache, and leaves the fallback alone", async () => {
    const { deps, fallback, cache } = setup();
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "4000"), ageSeconds: 0 });
    expect(fallback.calls).toEqual([]);
    expect(await cache.get("spot:gold")).toEqual({ quote: quote("gold-api.com", "4000"), fetchedAt: WEDNESDAY_NOON.toISOString() });
  });

  it("serves a warm cache under 60 seconds without calling any provider", async () => {
    const { deps, primary, fallback } = setup({ cache: cacheAged(59) });
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "3900"), ageSeconds: 59 });
    expect(primary.calls).toEqual([]);
    expect(fallback.calls).toEqual([]);
  });

  it("calls the primary once the cache is 60 seconds old", async () => {
    const { deps, primary } = setup({ cache: cacheAged(60) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", ageSeconds: 0, quote: { usdPerTroyOz: "4000" } });
    expect(primary.calls).toEqual(["gold"]);
  });

  it("falls back when the primary fails and logs provider_failed", async () => {
    const { deps, events } = setup({ primary: DOWN });
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("xaus.com", "4001"), ageSeconds: 0 });
    expect(events).toEqual([{ event: "provider_failed", key: "spot:gold", source: "gold-api.com", code: "provider_failed", message: expect.any(String) }]);
  });

  it("rejects a primary price more than 10 percent from the last good value and uses the fallback", async () => {
    const { deps, events } = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "4291")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com", usdPerTroyOz: "4001" } });
    expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
  });

  it("accepts a price exactly 10 percent from the last good value", async () => {
    const { deps, events } = setup({ cache: cacheAged(120, WEDNESDAY_NOON, quote("gold-api.com", "4000")), primary: ok(quote("gold-api.com", "4400")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "gold-api.com", usdPerTroyOz: "4400" } });
    expect(events).toEqual([]);
  });

  it("stops treating a last good value older than 96 hours as the reference", async () => {
    const { deps } = setup({ cache: cacheAged(96 * HOUR), primary: ok(quote("gold-api.com", "4800")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "gold-api.com", usdPerTroyOz: "4800" } });
  });

  it("rejects a provider price dated 24 hours or more before now on an open market", async () => {
    const frozen = { ...quote("gold-api.com", "4000"), asOf: "2026-11-10T12:00:00Z" };
    const { deps, events } = setup({ primary: ok(frozen) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" } });
    expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
  });

  it("accepts the Friday close dated a day earlier while the market is closed", async () => {
    const fridayClose = { ...quote("gold-api.com", "4000"), asOf: "2026-11-13T21:59:00Z" };
    const { deps, events } = setup({ now: SATURDAY_NOON, primary: ok(fridayClose) });
    expect(await getSpot("gold", deps)).toEqual({ kind: "market_closed", quote: fridayClose, ageSeconds: 0 });
    expect(events).toEqual([]);
  });

  it("rejects a non-positive price from any provider", async () => {
    const { deps, events } = setup({ primary: ok(quote("gold-api.com", "0")), fallback: DOWN });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    expect(events.map((e) => e.event)).toEqual(["rate_rejected", "provider_failed"]);
  });

  it("returns the cached record as stale with its age when both providers fail on a weekday", async () => {
    const { deps } = setup({ cache: cacheAged(HOUR), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", deps)).toEqual({ kind: "stale", quote: quote("gold-api.com", "3900"), ageSeconds: HOUR });
  });

  it("stops serving stale at 24 hours", async () => {
    const justUnder = setup({ cache: cacheAged(24 * HOUR - 1), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", justUnder.deps)).toMatchObject({ kind: "stale", ageSeconds: 24 * HOUR - 1 });
    const atLimit = setup({ cache: cacheAged(24 * HOUR), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", atLimit.deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
  });

  it("returns the last close as market_closed on a weekend for up to 96 hours", async () => {
    const closed = setup({ now: SATURDAY_NOON, cache: cacheAged(90000, SATURDAY_NOON), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", closed.deps)).toEqual({ kind: "market_closed", quote: quote("gold-api.com", "3900"), ageSeconds: 90000 });
    const tooOld = setup({ now: SATURDAY_NOON, cache: cacheAged(96 * HOUR, SATURDAY_NOON), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", tooOld.deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
  });

  it("labels a live answer during a closed market as market_closed, never fresh", async () => {
    const { deps } = setup({ now: SATURDAY_NOON });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "market_closed", ageSeconds: 0, quote: { source: "gold-api.com" } });
  });

  it("returns unavailable with rate_unavailable when both providers fail and the cache is empty", async () => {
    const { deps } = setup({ primary: DOWN, fallback: DOWN });
    const result = await getSpot("gold", deps);
    expect(result).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    expect("quote" in result).toBe(false);
  });

  it("ignores a cached record for the wrong metal or with a future timestamp", async () => {
    const cache = new MemoryCache();
    await cache.put("spot:gold", { quote: quote("gold-api.com", "48", "silver"), fetchedAt: WEDNESDAY_NOON.toISOString() });
    await cache.put("spot:silver", { quote: quote("gold-api.com", "48", "silver"), fetchedAt: "2026-11-12T12:00:00.000Z" });
    const { deps, primary } = setup({ cache, primary: ok(quote("gold-api.com", "4000")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { metal: "gold" } });
    expect(primary.calls).toEqual(["gold"]);
  });

  it("still answers and logs cache_failed when the cache throws", async () => {
    const broken: RateCache = {
      get: () => Promise.reject(new Error("kv down")),
      put: () => Promise.reject(new Error("kv down")),
    };
    const { deps, events } = setup({ cache: broken });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
    expect(events.map((e) => e.event)).toEqual(["cache_failed", "cache_failed"]);
  });
});

describe("getFx", () => {
  const inr: FxQuote = { quote: INR, rate: "94.04", asOf: "2026-11-11", source: "frankfurter.dev" };

  function fx(answer: Fetched<FxQuote>, cache = new MemoryCache()) {
    const provider: FxProvider & { calls: number } = {
      source: "frankfurter.dev",
      calls: 0,
      async fetchFx() {
        provider.calls++;
        return answer;
      },
    };
    const events: RateLogEvent[] = [];
    return { provider, events, deps: { fxProviders: [provider], cache, now: () => WEDNESDAY_NOON, log: (e: RateLogEvent) => events.push(e) } };
  }

  it("serves a currency rate from cache for up to an hour", async () => {
    const cache = new MemoryCache();
    await cache.put("fx:INR", { quote: inr, fetchedAt: new Date(WEDNESDAY_NOON.getTime() - (HOUR - 1) * 1000).toISOString() });
    const { deps, provider } = fx(ok({ ...inr, rate: "95" }), cache);
    expect(await getFx(INR, deps)).toEqual({ kind: "fresh", quote: inr, ageSeconds: HOUR - 1 });
    expect(provider.calls).toBe(0);
  });

  it("returns stale after an hour when the provider fails", async () => {
    const cache = new MemoryCache();
    await cache.put("fx:INR", { quote: inr, fetchedAt: new Date(WEDNESDAY_NOON.getTime() - 2 * HOUR * 1000).toISOString() });
    const { deps, events } = fx(fail("provider_failed", "down", "retry"), cache);
    expect(await getFx(INR, deps)).toEqual({ kind: "stale", quote: inr, ageSeconds: 2 * HOUR });
    expect(events.map((e) => e.event)).toEqual(["provider_failed"]);
  });

  it("passes an unknown currency through as unavailable with the provider's error", async () => {
    const xxx = parseCurrency("XXX")!;
    const { deps } = fx(fail("unknown_currency", "frankfurter.dev publishes no USD rate for the currency XXX.", "Ask for another code."));
    expect(await getFx(xxx, deps)).toMatchObject({ kind: "unavailable", error: { code: "unknown_currency", message: expect.stringContaining("XXX") } });
  });
});

describe("refreshAll", () => {
  it("writes the primary quote for both metals and logs a gap above 2 percent", async () => {
    const primary = fakeSpot("gold-api.com", (metal) => ok(quote("gold-api.com", metal === "gold" ? "4000" : "50", metal)));
    const fallback = fakeSpot("xaus.com", (metal) => ok(quote("xaus.com", metal === "gold" ? "4081" : "50.5", metal)));
    const cache = new MemoryCache();
    const events: RateLogEvent[] = [];
    const outcomes = await refreshAll({ spotProviders: [primary, fallback], cache, now: () => WEDNESDAY_NOON, log: (e) => events.push(e) });

    expect(outcomes).toEqual([
      { metal: "gold", written: "gold-api.com" },
      { metal: "silver", written: "gold-api.com" },
    ]);
    expect((await cache.get("spot:silver"))?.quote).toEqual(quote("gold-api.com", "50", "silver"));
    expect(events).toEqual([
      {
        event: "rate_disagreement",
        metal: "gold",
        prices: [
          { source: "gold-api.com", usdPerTroyOz: "4000" },
          { source: "xaus.com", usdPerTroyOz: "4081" },
        ],
        gapPercent: "2.03",
      },
    ]);
  });

  it("writes the fallback quote when the primary fails", async () => {
    const { deps, cache } = setup({ primary: DOWN });
    expect(await refreshAll(deps)).toEqual([
      { metal: "gold", written: "xaus.com" },
      { metal: "silver", written: "xaus.com" },
    ]);
    expect((await cache.get("spot:gold"))?.quote).toMatchObject({ source: "xaus.com" });
  });
});

describe("KvCache", () => {
  function fakeKv() {
    const store = new Map<string, { value: string; ttl: number }>();
    const kv: KvNamespaceLike = {
      async get(key) {
        const hit = store.get(key);
        return hit ? JSON.parse(hit.value) : null;
      },
      async put(key, value, { expirationTtl }) {
        store.set(key, { value, ttl: expirationTtl });
      },
    };
    return { kv, store };
  }

  it("keeps the last good value for 7 days and reads it back", async () => {
    const { kv, store } = fakeKv();
    const cache = new KvCache(kv);
    const record = { quote: quote("gold-api.com", "4000"), fetchedAt: WEDNESDAY_NOON.toISOString() };
    await cache.put("spot:gold", record);
    expect(store.get("spot:gold")?.ttl).toBe(7 * 24 * HOUR);
    expect(await cache.get("spot:gold")).toEqual(record);
  });

  it("treats a missing or malformed record as empty", async () => {
    const { kv, store } = fakeKv();
    store.set("spot:gold", { value: JSON.stringify({ price: 4000 }), ttl: 60 });
    const cache = new KvCache(kv);
    expect(await cache.get("spot:gold")).toBeUndefined();
    expect(await cache.get("spot:silver")).toBeUndefined();
  });
});
