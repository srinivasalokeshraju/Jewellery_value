import { describe, expect, it } from "vitest";
import { parseCurrency } from "../../src/domain/money";
import type { Metal } from "../../src/domain/purity";
import { KvCache, MemoryCache, type KvNamespaceLike, type RateCache } from "../../src/rates/cache";
import { getFx, getSpot, refreshAll, type FxDeps, type SpotDeps } from "../../src/rates/chain";
import { fail, ok, type Fetched, type FxProvider, type FxQuote, type RateLogEvent, type SpotProvider, type SpotQuote, type SpotSource } from "../../src/rates/types";

const WEDNESDAY_NOON = new Date("2026-11-11T12:00:00.000Z");
const SATURDAY_NOON = new Date("2026-11-14T12:00:00.000Z");
const HOUR = 3600;
const INR = parseCurrency("INR")!;

function ago(seconds: number, now = WEDNESDAY_NOON): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

function quote(source: SpotSource, usdPerTroyOz: string, metal: Metal = "gold", asOf = "2026-11-11T11:59:00Z"): SpotQuote {
  return { metal, usdPerTroyOz, asOf, source };
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
  const primary = fakeSpot("gold-api.com", (metal) => options.primary ?? ok(quote("gold-api.com", metal === "gold" ? "4000" : "50", metal)));
  const fallback = fakeSpot("xaus.com", (metal) => options.fallback ?? ok(quote("xaus.com", metal === "gold" ? "4001" : "50.05", metal)));
  const events: RateLogEvent[] = [];
  const cache = options.cache ?? new MemoryCache();
  const now = options.now ?? WEDNESDAY_NOON;
  const deps: SpotDeps = { spotProviders: [primary, fallback], cache, now: () => now, log: (event) => events.push(event) };
  return { primary, fallback, events, cache, deps };
}

interface Aged {
  now?: Date;
  price?: string;
  quoteAge?: number;
  unverified?: true;
}

function cacheAged(seconds: number, { now = WEDNESDAY_NOON, price = "3900", quoteAge = seconds, unverified }: Aged = {}): MemoryCache {
  const cache = new MemoryCache();
  const record = { quote: quote("gold-api.com", price, "gold", ago(quoteAge, now)), fetchedAt: ago(seconds, now) };
  void cache.put("spot:gold", unverified ? { ...record, unverified } : record);
  return cache;
}

describe("getSpot", () => {
  it("on a cold cache, asks both providers and returns the primary when they agree within 2 percent", async () => {
    const { deps, primary, fallback, cache } = setup();
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "4000"), ageSeconds: 60 });
    expect(primary.calls).toEqual(["gold"]);
    expect(fallback.calls).toEqual(["gold"]);
    expect(await cache.get("spot:gold")).toEqual({ quote: quote("gold-api.com", "4000"), fetchedAt: WEDNESDAY_NOON.toISOString() });
  });

  it("with a last good value, returns the primary quote and leaves the fallback alone", async () => {
    const { deps, fallback } = setup({ cache: cacheAged(120) });
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "4000"), ageSeconds: 60 });
    expect(fallback.calls).toEqual([]);
  });

  it("serves a warm cache under 60 seconds without calling any provider", async () => {
    const { deps, primary, fallback } = setup({ cache: cacheAged(59) });
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "3900", "gold", ago(59)), ageSeconds: 59 });
    expect(primary.calls).toEqual([]);
    expect(fallback.calls).toEqual([]);
  });

  it("calls the primary once the cache is 60 seconds old", async () => {
    const { deps, primary } = setup({ cache: cacheAged(60) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", ageSeconds: 60, quote: { usdPerTroyOz: "4000" } });
    expect(primary.calls).toEqual(["gold"]);
  });

  it("falls back when the primary fails and logs provider_failed", async () => {
    const { deps, events } = setup({ cache: cacheAged(120), primary: DOWN });
    expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("xaus.com", "4001"), ageSeconds: 60 });
    expect(events).toEqual([{ event: "provider_failed", key: "spot:gold", source: "gold-api.com", code: "provider_failed", message: expect.any(String) }]);
  });

  it("rejects a primary price more than 10 percent from the last good value and uses a fallback that disagrees with it", async () => {
    const { deps, events } = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "4291")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com", usdPerTroyOz: "4001" } });
    expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
  });

  it("accepts a price exactly 10 percent from the last good value", async () => {
    const { deps, events } = setup({ cache: cacheAged(120, { price: "4000" }), primary: ok(quote("gold-api.com", "4400")) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "gold-api.com", usdPerTroyOz: "4400" } });
    expect(events).toEqual([]);
  });

  it("returns the cached record as stale with its age when both providers fail on a weekday", async () => {
    const { deps } = setup({ cache: cacheAged(HOUR), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", deps)).toEqual({ kind: "stale", quote: quote("gold-api.com", "3900", "gold", ago(HOUR)), ageSeconds: HOUR });
  });

  it("stops serving stale at 24 hours", async () => {
    const justUnder = setup({ cache: cacheAged(24 * HOUR - 1), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", justUnder.deps)).toMatchObject({ kind: "stale", ageSeconds: 24 * HOUR - 1 });
    const atLimit = setup({ cache: cacheAged(24 * HOUR), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", atLimit.deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
  });

  it("returns the last close as market_closed on a weekend for up to 96 hours", async () => {
    const closed = setup({ now: SATURDAY_NOON, cache: cacheAged(90000, { now: SATURDAY_NOON }), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", closed.deps)).toEqual({ kind: "market_closed", quote: quote("gold-api.com", "3900", "gold", ago(90000, SATURDAY_NOON)), ageSeconds: 90000 });
    const tooOld = setup({ now: SATURDAY_NOON, cache: cacheAged(96 * HOUR, { now: SATURDAY_NOON }), primary: DOWN, fallback: DOWN });
    expect(await getSpot("gold", tooOld.deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
  });

  it("labels a live answer during a closed market as market_closed, never fresh", async () => {
    const live = (source: SpotSource, price: string) => ok(quote(source, price, "gold", ago(5, SATURDAY_NOON)));
    const { deps } = setup({ now: SATURDAY_NOON, primary: live("gold-api.com", "4000"), fallback: live("xaus.com", "4000") });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "market_closed", ageSeconds: 5, quote: { source: "gold-api.com" } });
  });

  it("accepts the Friday close while the market is closed and reports its true age", async () => {
    const fridayClose = (source: SpotSource) => ok({ ...quote(source, "4000"), asOf: "2026-11-13T21:59:00Z" });
    const { deps, events } = setup({ now: SATURDAY_NOON, primary: fridayClose("gold-api.com"), fallback: fridayClose("xaus.com") });
    expect(await getSpot("gold", deps)).toEqual({ kind: "market_closed", quote: { ...quote("gold-api.com", "4000"), asOf: "2026-11-13T21:59:00Z" }, ageSeconds: 14 * HOUR + 60 });
    expect(events).toEqual([]);
  });

  it("rejects a non-positive price from any provider", async () => {
    const { deps, events } = setup({ primary: ok(quote("gold-api.com", "0")), fallback: DOWN });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    expect(events.map((e) => e.event)).toEqual(["rate_rejected", "provider_failed"]);
  });

  it("returns unavailable with rate_unavailable when both providers fail and the cache is empty", async () => {
    const { deps } = setup({ primary: DOWN, fallback: DOWN });
    const result = await getSpot("gold", deps);
    expect(result).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    expect("quote" in result).toBe(false);
  });

  it("ignores a cached record for the wrong metal or with a future fetch time", async () => {
    const cache = new MemoryCache();
    await cache.put("spot:gold", { quote: quote("gold-api.com", "48", "silver"), fetchedAt: WEDNESDAY_NOON.toISOString() });
    const { deps, primary } = setup({ cache });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { metal: "gold" } });
    expect(primary.calls).toEqual(["gold"]);

    const future = new MemoryCache();
    await future.put("spot:gold", { quote: quote("gold-api.com", "3900"), fetchedAt: "2026-11-12T12:00:00.000Z" });
    const later = setup({ cache: future });
    expect(await getSpot("gold", later.deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
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

  describe("measures age from the provider asOf", () => {
    it("reports a live answer dated 23 hours ago as stale with its true age", async () => {
      const frozen = ok(quote("gold-api.com", "3900", "gold", ago(23 * HOUR)));
      const { deps } = setup({ cache: cacheAged(120), primary: frozen });
      expect(await getSpot("gold", deps)).toEqual({ kind: "stale", quote: quote("gold-api.com", "3900", "gold", ago(23 * HOUR)), ageSeconds: 23 * HOUR });
    });

    it("labels an open-market answer fresh up to 300 seconds after asOf and stale after", async () => {
      const at300 = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "3900", "gold", ago(300))) });
      expect(await getSpot("gold", at300.deps)).toMatchObject({ kind: "fresh", ageSeconds: 300 });
      const at301 = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "3900", "gold", ago(301))) });
      expect(await getSpot("gold", at301.deps)).toMatchObject({ kind: "stale", ageSeconds: 301 });
    });

    it("serves a warm cache record fetched 30 seconds ago but dated 23 hours ago as stale", async () => {
      const { deps, primary } = setup({ cache: cacheAged(30, { quoteAge: 23 * HOUR }) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "stale", ageSeconds: 23 * HOUR });
      expect(primary.calls).toEqual([]);
    });

    it("refetches when a warm cache record fetched 10 seconds ago is dated past every limit", async () => {
      const { deps, primary } = setup({ cache: cacheAged(10, { quoteAge: 6 * 365 * 24 * HOUR }) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
      expect(primary.calls).toEqual(["gold"]);
    });

    it("measures the 24 hour stale limit from asOf, not from the fetch", async () => {
      const { deps } = setup({ cache: cacheAged(HOUR, { quoteAge: 25 * HOUR }), primary: DOWN, fallback: DOWN });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    });

    it("measures the 96 hour market-closed limit from asOf, not from the fetch", async () => {
      const { deps } = setup({ now: SATURDAY_NOON, cache: cacheAged(HOUR, { now: SATURDAY_NOON, quoteAge: 100 * HOUR }), primary: DOWN, fallback: DOWN });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    });

    it("stops using a last good value dated 96 hours ago as the reference, even when fetched recently", async () => {
      const { deps, fallback } = setup({
        cache: cacheAged(HOUR, { quoteAge: 96 * HOUR }),
        primary: ok(quote("gold-api.com", "4800")),
        fallback: ok(quote("xaus.com", "4801")),
      });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "gold-api.com", usdPerTroyOz: "4800" } });
      expect(fallback.calls).toEqual(["gold"]);
    });

    it("rejects a live answer dated 24 hours or more before now on an open market", async () => {
      const { deps, events } = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "3900", "gold", ago(24 * HOUR))) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" } });
      expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
    });
  });

  describe("rejects a quote dated in the future", () => {
    it("rejects and never caches a quote dated more than 120 seconds after now", async () => {
      const future = ok(quote("gold-api.com", "4000", "gold", "2027-11-11T15:00:00Z"));
      const { deps, events, cache } = setup({ cache: cacheAged(120), primary: future });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" } });
      expect(events).toEqual([expect.objectContaining({ event: "rate_rejected", source: "gold-api.com" })]);
      expect((await cache.get("spot:gold")) as { quote: SpotQuote }).toMatchObject({ quote: { source: "xaus.com" } });
    });

    it("accepts a quote dated exactly 120 seconds after now with age 0", async () => {
      const { deps } = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "4000", "gold", ago(-120))) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", ageSeconds: 0, quote: { source: "gold-api.com" } });
      const beyond = setup({ cache: cacheAged(120), primary: ok(quote("gold-api.com", "4000", "gold", ago(-121))) });
      expect(await getSpot("gold", beyond.deps)).toMatchObject({ quote: { source: "xaus.com" } });
    });

    it("ignores a cached record dated more than 120 seconds after now", async () => {
      const { deps, primary } = setup({ cache: cacheAged(10, { quoteAge: -HOUR }) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
      expect(primary.calls).toEqual(["gold"]);
    });
  });

  describe("on a cold cache", () => {
    it("accepts a lone fallback inside the plausibility bounds as unverified when the primary is 100 times too high", async () => {
      const { deps, events, cache } = setup({ primary: ok(quote("gold-api.com", "388760")), fallback: ok(quote("xaus.com", "3887.6")) });
      expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("xaus.com", "3887.6"), ageSeconds: 60, unverified: true });
      expect(events).toEqual([expect.objectContaining({ event: "rate_rejected", source: "gold-api.com" })]);
      expect(await cache.get("spot:gold")).toEqual({ quote: quote("xaus.com", "3887.6"), fetchedAt: WEDNESDAY_NOON.toISOString(), unverified: true });
    });

    it("rejects a primary at 1 percent of the real price as outside the bounds", async () => {
      const { deps } = setup({ primary: ok(quote("gold-api.com", "38.876")), fallback: ok(quote("xaus.com", "3887.6")) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" }, unverified: true });
    });

    it("rejects two agreeing prices that are both outside the bounds", async () => {
      const { deps } = setup({ primary: ok(quote("gold-api.com", "388760")), fallback: ok(quote("xaus.com", "388760")) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
    });

    it("bounds silver to 2 through 2000 USD per troy ounce", async () => {
      const silver = (price: string) => setup({ primary: ok(quote("gold-api.com", price, "silver")), fallback: DOWN });
      expect(await getSpot("silver", silver("1.99").deps)).toMatchObject({ kind: "unavailable" });
      expect(await getSpot("silver", silver("2000.01").deps)).toMatchObject({ kind: "unavailable" });
      expect(await getSpot("silver", silver("2").deps)).toMatchObject({ kind: "fresh", unverified: true });
      expect(await getSpot("silver", silver("2000").deps)).toMatchObject({ kind: "fresh", unverified: true });
    });

    it("bounds gold to 200 through 50000 USD per troy ounce", async () => {
      const gold = (price: string) => setup({ primary: ok(quote("gold-api.com", price)), fallback: DOWN });
      expect(await getSpot("gold", gold("199.99").deps)).toMatchObject({ kind: "unavailable" });
      expect(await getSpot("gold", gold("50000.01").deps)).toMatchObject({ kind: "unavailable" });
      expect(await getSpot("gold", gold("200").deps)).toMatchObject({ kind: "fresh", unverified: true });
      expect(await getSpot("gold", gold("50000").deps)).toMatchObject({ kind: "fresh", unverified: true });
    });

    it("accepts nothing and logs rate_disagreement when the two providers disagree by more than 2 percent", async () => {
      const { deps, events, cache } = setup({ primary: ok(quote("gold-api.com", "7775.2")), fallback: ok(quote("xaus.com", "3887.6")) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
      expect(events.map((e) => e.event)).toEqual(["rate_disagreement"]);
      expect(await cache.get("spot:gold")).toBeUndefined();
    });

    it("keeps an unverified answer unverified from the warm cache, then verifies it once both providers agree", async () => {
      const lone = setup({ fallback: DOWN });
      expect(await getSpot("gold", lone.deps)).toMatchObject({ quote: { source: "gold-api.com" }, unverified: true });
      const warm = setup({ cache: lone.cache, now: new Date(WEDNESDAY_NOON.getTime() + 30_000) });
      expect(await getSpot("gold", warm.deps)).toMatchObject({ quote: { source: "gold-api.com" }, unverified: true });
      expect(warm.primary.calls).toEqual([]);

      const later = setup({ cache: lone.cache, now: new Date(WEDNESDAY_NOON.getTime() + 61_000) });
      const verified = await getSpot("gold", later.deps);
      expect(verified).toMatchObject({ kind: "fresh", quote: { source: "gold-api.com" } });
      expect("unverified" in verified).toBe(false);
      expect(later.fallback.calls).toEqual(["gold"]);
    });

    it("serves an unverified cached value as stale and still unverified when both providers fail", async () => {
      const { deps } = setup({ cache: cacheAged(HOUR, { unverified: true }), primary: DOWN, fallback: DOWN });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "stale", ageSeconds: HOUR, unverified: true });
    });
  });

  describe("replaces a wrong reference when both providers agree", () => {
    it("accepts honest prices that both disagree with a poisoned last good value and logs reference_replaced", async () => {
      const honest = (source: SpotSource) => ok(quote(source, "3887.6"));
      const { deps, events, cache } = setup({ cache: cacheAged(120, { price: "7775.2" }), primary: honest("gold-api.com"), fallback: honest("xaus.com") });
      expect(await getSpot("gold", deps)).toEqual({ kind: "fresh", quote: quote("gold-api.com", "3887.6"), ageSeconds: 60 });
      expect(events).toEqual([{ event: "reference_replaced", metal: "gold", source: "gold-api.com", previous: "7775.2", usdPerTroyOz: "3887.6" }]);
      expect((await cache.get("spot:gold")) as { quote: SpotQuote }).toMatchObject({ quote: { usdPerTroyOz: "3887.6" } });
    });
  });

  describe("ignores an unusable cache record", () => {
    it("ignores a cached record with a zero price", async () => {
      const { deps, primary } = setup({ cache: cacheAged(10, { price: "0" }) });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
      expect(primary.calls).toEqual(["gold"]);
    });

    it("treats a null cache record as empty", async () => {
      const nullCache: RateCache = { get: async () => null, put: async () => {} };
      const { deps } = setup({ cache: nullCache });
      expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
    });
  });

  describe("never throws", () => {
    it("treats a provider that throws as provider_failed and moves to the fallback", async () => {
      const { deps, events } = setup({ cache: cacheAged(120) });
      const throwing: SpotProvider = {
        source: "gold-api.com",
        fetchSpot: () => {
          throw new Error("provider sync throw");
        },
      };
      const result = await getSpot("gold", { ...deps, spotProviders: [throwing, deps.spotProviders[1]] });
      expect(result).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" } });
      expect(events).toEqual([expect.objectContaining({ event: "provider_failed", source: "gold-api.com", code: "provider_failed" })]);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an ok answer with no quote", { ok: true }],
      ["a failure with no error", { ok: false }],
    ])("treats a provider that resolves %s as provider_failed and moves to the fallback", async (_, answer) => {
      const { deps, events } = setup({ cache: cacheAged(120) });
      const broken: SpotProvider = { source: "gold-api.com", fetchSpot: async () => answer as unknown as Fetched<SpotQuote> };
      const result = await getSpot("gold", { ...deps, spotProviders: [broken, deps.spotProviders[1]] });
      expect(result).toMatchObject({ kind: "fresh", quote: { source: "xaus.com" } });
      expect(events).toEqual([expect.objectContaining({ event: "provider_failed", source: "gold-api.com", code: "provider_failed" })]);
    });
  });
});

describe("getFx", () => {
  const inr = (rate = "94.04", asOf = "2026-11-11"): FxQuote => ({ quote: INR, rate, asOf, source: "frankfurter.dev" });

  function fx(answer: Fetched<FxQuote> | (() => Promise<Fetched<FxQuote>>), options: { cache?: MemoryCache; now?: Date } = {}) {
    const provider: FxProvider & { calls: number } = {
      source: "frankfurter.dev",
      calls: 0,
      async fetchFx() {
        provider.calls++;
        return typeof answer === "function" ? answer() : answer;
      },
    };
    const events: RateLogEvent[] = [];
    const now = options.now ?? WEDNESDAY_NOON;
    const deps: FxDeps = { fxProviders: [provider], cache: options.cache ?? new MemoryCache(), now: () => now, log: (e) => events.push(e) };
    return { provider, events, deps };
  }

  async function cachedFx(fetchedSecondsAgo: number, quote = inr(), now = WEDNESDAY_NOON, unverified?: true): Promise<MemoryCache> {
    const cache = new MemoryCache();
    const record = { quote, fetchedAt: ago(fetchedSecondsAgo, now) };
    await cache.put("fx:INR", unverified ? { ...record, unverified } : record);
    return cache;
  }

  describe("marks a rate with no usable last good value unverified", () => {
    it("returns a first rate as unverified and stores the flag", async () => {
      const { deps } = fx(ok(inr()));
      expect(await getFx(INR, deps)).toEqual({ kind: "fresh", quote: inr(), ageSeconds: 12 * HOUR, unverified: true });
      expect(await deps.cache.get("fx:INR")).toEqual({ quote: inr(), fetchedAt: WEDNESDAY_NOON.toISOString(), unverified: true });
    });

    it("keeps an unverified rate unverified from the warm cache", async () => {
      const { deps, provider } = fx(ok(inr("95")), { cache: await cachedFx(HOUR - 1, inr(), WEDNESDAY_NOON, true) });
      expect(await getFx(INR, deps)).toEqual({ kind: "fresh", quote: inr(), ageSeconds: 12 * HOUR, unverified: true });
      expect(provider.calls).toBe(0);
    });

    it("lets an honest rate replace a wrong first rate once the cache window passes", async () => {
      const first = fx(ok(inr("9404")));
      expect(await getFx(INR, first.deps)).toMatchObject({ quote: { rate: "9404" }, unverified: true });
      const later = new Date(WEDNESDAY_NOON.getTime() + HOUR * 1000);
      const second = fx(ok(inr()), { cache: first.deps.cache as MemoryCache, now: later });
      expect(await getFx(INR, second.deps)).toEqual({ kind: "fresh", quote: inr(), ageSeconds: 13 * HOUR, unverified: true });
      expect(second.events).toEqual([]);
    });

    it("verifies an unverified rate once a later rate lands within 10 percent of it", async () => {
      const { deps } = fx(ok(inr("95")), { cache: await cachedFx(2 * HOUR, inr(), WEDNESDAY_NOON, true) });
      expect(await getFx(INR, deps)).toEqual({ kind: "fresh", quote: inr("95"), ageSeconds: 12 * HOUR });
      expect(await deps.cache.get("fx:INR")).toEqual({ quote: inr("95"), fetchedAt: WEDNESDAY_NOON.toISOString() });
    });
  });

  it("serves a currency rate from cache for up to an hour", async () => {
    const { deps, provider } = fx(ok(inr("95")), { cache: await cachedFx(HOUR - 1) });
    expect(await getFx(INR, deps)).toEqual({ kind: "fresh", quote: inr(), ageSeconds: 12 * HOUR });
    expect(provider.calls).toBe(0);
  });

  it("returns stale after an hour when the provider fails", async () => {
    const { deps, events } = fx(fail("provider_failed", "down", "retry"), { cache: await cachedFx(2 * HOUR) });
    expect(await getFx(INR, deps)).toEqual({ kind: "stale", quote: inr(), ageSeconds: 12 * HOUR });
    expect(events.map((e) => e.event)).toEqual(["provider_failed"]);
  });

  it("passes an unknown currency through as unavailable with the provider's error", async () => {
    const xxx = parseCurrency("XXX")!;
    const { deps } = fx(fail("unknown_currency", "frankfurter.dev publishes no USD rate for the currency XXX.", "Ask for another code."));
    expect(await getFx(xxx, deps)).toMatchObject({ kind: "unavailable", error: { code: "unknown_currency", message: expect.stringContaining("XXX") } });
  });

  describe("validates the rate", () => {
    it("rejects a rate that moves more than 10 percent from the last good value and serves the cached value as stale", async () => {
      const { deps, events } = fx(ok(inr("9404")), { cache: await cachedFx(2 * HOUR) });
      expect(await getFx(INR, deps)).toEqual({ kind: "stale", quote: inr(), ageSeconds: 12 * HOUR });
      expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
    });

    it("accepts a move of exactly 10 percent", async () => {
      const { deps } = fx(ok(inr("103.444")), { cache: await cachedFx(2 * HOUR) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "fresh", quote: { rate: "103.444" } });
    });

    it("ignores a last good value dated 96 hours or more before now as the reference", async () => {
      const { deps } = fx(ok(inr("120")), { cache: await cachedFx(2 * HOUR, inr("94.04", "2026-11-07")) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "fresh", quote: { rate: "120" } });
    });

    it("rejects a rate that is not positive", async () => {
      const { deps, events } = fx(ok(inr("0")));
      expect(await getFx(INR, deps)).toMatchObject({ kind: "unavailable", error: { code: "rate_unavailable" } });
      expect(events.map((e) => e.event)).toEqual(["rate_rejected"]);
    });

    it("rejects a date more than 7 days before now", async () => {
      expect(await getFx(INR, fx(ok(inr("94.04", "2000-01-01"))).deps)).toMatchObject({ kind: "unavailable" });
      expect(await getFx(INR, fx(ok(inr("94.04", "2026-11-04"))).deps)).toMatchObject({ kind: "unavailable" });
      expect(await getFx(INR, fx(ok(inr("94.04", "2026-11-05"))).deps)).toMatchObject({ kind: "stale", ageSeconds: 6 * 24 * HOUR + 12 * HOUR });
    });

    it("rejects a date more than 1 day after now", async () => {
      expect(await getFx(INR, fx(ok(inr("94.04", "2030-01-01"))).deps)).toMatchObject({ kind: "unavailable" });
      expect(await getFx(INR, fx(ok(inr("94.04", "2026-11-13"))).deps)).toMatchObject({ kind: "unavailable" });
      expect(await getFx(INR, fx(ok(inr("94.04", "2026-11-12"))).deps)).toMatchObject({ kind: "fresh", ageSeconds: 0 });
    });

    it("rejects a quote for a different currency than the one asked for", async () => {
      const eur = parseCurrency("EUR")!;
      const { deps } = fx(ok({ ...inr(), quote: eur }));
      expect(await getFx(INR, deps)).toMatchObject({ kind: "unavailable" });
    });

    it("treats a provider that throws as provider_failed and never throws", async () => {
      const { deps, events } = fx(() => Promise.reject(new Error("boom")), { cache: await cachedFx(2 * HOUR) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "stale", quote: inr() });
      expect(events.map((e) => e.event)).toEqual(["provider_failed"]);
    });

    it("treats a provider that resolves something other than a Fetched value as provider_failed and never throws", async () => {
      const { deps, events } = fx(async () => undefined as unknown as Fetched<FxQuote>, { cache: await cachedFx(2 * HOUR) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "stale", quote: inr() });
      expect(events.map((e) => e.event)).toEqual(["provider_failed"]);
    });

    it("ignores a warm cached rate of zero and calls the provider", async () => {
      const { deps, provider } = fx(ok(inr()), { cache: await cachedFx(10, inr("0")) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "fresh", quote: { rate: "94.04" } });
      expect(provider.calls).toBe(1);
    });

    it("treats a null cache record as empty", async () => {
      const { deps } = fx(ok(inr()));
      expect(await getFx(INR, { ...deps, cache: { get: async () => null, put: async () => {} } })).toMatchObject({ kind: "fresh" });
    });
  });

  describe("labels freshness by the provider date", () => {
    const at = (iso: string) => new Date(iso);

    it.each([
      ["today", "fresh", "2026-11-11T12:00:00Z", "2026-11-11", 12 * HOUR],
      ["yesterday", "fresh", "2026-11-11T12:00:00Z", "2026-11-10", 36 * HOUR],
      ["two days ago on a Wednesday", "stale", "2026-11-11T12:00:00Z", "2026-11-09", 60 * HOUR],
      ["Friday on a Saturday", "fresh", "2026-11-14T12:00:00Z", "2026-11-13", 36 * HOUR],
      ["Friday on a Sunday", "fresh", "2026-11-15T12:00:00Z", "2026-11-13", 60 * HOUR],
      ["Friday on a Monday", "fresh", "2026-11-16T12:00:00Z", "2026-11-13", 84 * HOUR],
      ["Friday on a Tuesday", "stale", "2026-11-17T12:00:00Z", "2026-11-13", 108 * HOUR],
      ["Thursday on a Sunday", "stale", "2026-11-15T12:00:00Z", "2026-11-12", 84 * HOUR],
    ] as const)("labels a rate dated %s as %s", async (_, kind, now, date, ageSeconds) => {
      const { deps } = fx(ok(inr("94.04", date)), { now: at(now) });
      expect(await getFx(INR, deps)).toEqual({ kind, quote: inr("94.04", date), ageSeconds, unverified: true });
    });

    it("never labels a cached rate fresh once the provider fails", async () => {
      const { deps } = fx(fail("provider_failed", "down", "retry"), { cache: await cachedFx(2 * HOUR) });
      expect(await getFx(INR, deps)).toMatchObject({ kind: "stale" });
    });
  });
});

describe("refreshAll", () => {
  function both(gold: [string, string], silver: [string, string]) {
    const primary = fakeSpot("gold-api.com", (metal) => ok(quote("gold-api.com", metal === "gold" ? gold[0] : silver[0], metal)));
    const fallback = fakeSpot("xaus.com", (metal) => ok(quote("xaus.com", metal === "gold" ? gold[1] : silver[1], metal)));
    const events: RateLogEvent[] = [];
    return { events, deps: { spotProviders: [primary, fallback], cache: new MemoryCache(), now: () => WEDNESDAY_NOON, log: (e: RateLogEvent) => events.push(e) } satisfies SpotDeps };
  }

  it("writes the primary quote for both metals when the providers agree", async () => {
    const { deps, events } = both(["4000", "4080"], ["50", "50.5"]);
    expect(await refreshAll(deps)).toEqual([
      { metal: "gold", written: "gold-api.com" },
      { metal: "silver", written: "gold-api.com" },
    ]);
    expect((await deps.cache.get("spot:silver")) as { quote: SpotQuote }).toMatchObject({ quote: quote("gold-api.com", "50", "silver") });
    expect(events).toEqual([]);
  });

  it("writes nothing for a metal whose providers disagree by more than 2 percent, keeps the last good record, and logs rate_disagreement", async () => {
    const { deps, events } = both(["5831.4", "3887.6"], ["50", "50.5"]);
    const lastGood = { quote: quote("gold-api.com", "3887", "gold", ago(120)), fetchedAt: ago(120) };
    await deps.cache.put("spot:gold", lastGood);
    expect(await refreshAll(deps)).toEqual([{ metal: "gold" }, { metal: "silver", written: "gold-api.com" }]);
    expect(await deps.cache.get("spot:gold")).toEqual(lastGood);
    expect(events).toEqual([
      {
        event: "rate_disagreement",
        metal: "gold",
        prices: [
          { source: "gold-api.com", usdPerTroyOz: "5831.4" },
          { source: "xaus.com", usdPerTroyOz: "3887.6" },
        ],
        gapPercent: "33.33",
      },
    ]);
  });

  it("writes the fallback quote when the primary fails, marked unverified on a cold cache", async () => {
    const { deps, cache } = setup({ primary: DOWN });
    expect(await refreshAll(deps)).toEqual([
      { metal: "gold", written: "xaus.com" },
      { metal: "silver", written: "xaus.com" },
    ]);
    expect(await cache.get("spot:gold")).toMatchObject({ quote: { source: "xaus.com" }, unverified: true });
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
    const record = { quote: quote("gold-api.com", "4000"), fetchedAt: WEDNESDAY_NOON.toISOString(), unverified: true as const };
    await cache.put("spot:gold", record);
    expect(store.get("spot:gold")?.ttl).toBe(7 * 24 * HOUR);
    expect(await cache.get("spot:gold")).toEqual(record);
  });

  it("lets getSpot treat a missing or malformed record as empty", async () => {
    const { kv, store } = fakeKv();
    store.set("spot:gold", { value: JSON.stringify({ price: 4000 }), ttl: 60 });
    store.set("spot:silver", { value: JSON.stringify("garbage"), ttl: 60 });
    const { deps, primary } = setup({ cache: new KvCache(kv) });
    expect(await getSpot("gold", deps)).toMatchObject({ kind: "fresh", quote: { usdPerTroyOz: "4000" } });
    expect(await getSpot("silver", deps)).toMatchObject({ kind: "fresh" });
    expect(primary.calls).toEqual(["gold", "silver"]);
  });
});

