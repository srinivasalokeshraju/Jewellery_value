import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metal } from "../../src/domain/purity";
import { MemoryCache } from "../../src/rates/cache";
import type { Currency } from "../../src/domain/money";
import { fail, ok, type FxProvider, type SpotProvider, type SpotSource } from "../../src/rates/types";
import { getMetalRate } from "../../src/tools/getMetalRate";
import { getMetalRateInput } from "../../src/tools/getMetalRate";
import { REFRESH_GAP_MS } from "../../src/tools/refresh";
import { replay } from "../rates/fixtures";
import { bounded, frankfurterCodes, MAX_FX_WAIT_MS, sharedFetches, spacing, type FetchCodes, type Gate } from "../../src/tools/upstream";
import { fakeDeps, fxProvider, minutesBefore, spotProvider, WEDNESDAY_NOON } from "./fakes";

function value<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const UNPUBLISHED = fail<never>("unknown_currency", "frankfurter.dev publishes no USD rate for the currency QQQ.", "Ask for another code.");

function minutesAfter(minutes: number): Date {
  return new Date(WEDNESDAY_NOON.getTime() + minutes * 60_000);
}

function timedFx() {
  const starts: number[] = [];
  const inner = fxProvider();
  const fx: FxProvider = { source: inner.source, fetchFx: (currency) => (starts.push(Date.now()), inner.fetchFx(currency)) };
  return { fx, starts, calls: inner.calls };
}

function counted(gate: Gate): Gate & { slots: number } {
  const wrapped = Object.assign(<T>(start: () => Promise<T>) => (wrapped.slots++, gate(start)), {
    delayMs: () => gate.delayMs(),
    slots: 0,
  });
  return wrapped;
}

function listing(codes: string[]): FetchCodes & { fetches: number } {
  const fetchCodes = Object.assign(async () => (fetchCodes.fetches++, ok(codes)), { fetches: 0 });
  return fetchCodes;
}

function hoursAfter(hours: number): Date {
  return minutesAfter(hours * 60);
}

const rate = (currency: string, deps: ReturnType<typeof bounded>) => getMetalRate({ metal: "gold", country: "US", currency }, deps);

function busy(currency: string) {
  return {
    code: "rate_busy",
    message: `The US dollar to ${currency} rate is busy. This server is fetching other currency rates now, so it did not ask for this one.`,
    fix: "Do not estimate or guess the rate or the value. Try again in a few seconds.",
  };
}

function held(source: SpotSource) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const inner = spotProvider(source);
  const provider: SpotProvider & { calls: Metal[] } = {
    source,
    calls: inner.calls,
    async fetchSpot(metal) {
      const answer = inner.fetchSpot(metal);
      await gate;
      return answer;
    },
  };
  return { provider, release };
}

describe("unpublished currency", () => {
  it("asks the feed once an hour for a currency it does not publish", async () => {
    const fx = fxProvider(() => UNPUBLISHED);
    const cache = new MemoryCache();
    const shared = sharedFetches();
    const call = async (now: Date) => {
      const deps = fakeDeps({ now, fx, cache });
      const result = await getMetalRate({ metal: "gold", country: "US", currency: "QQQ" }, bounded(deps, deps.cache, shared, spacing(0)));
      return result.ok ? result.value.warnings.map((warning) => warning.code) : result.error.code;
    };

    expect(await call(WEDNESDAY_NOON)).toEqual(["unknown_currency_usd_used"]);
    expect(await call(minutesAfter(1))).toEqual(["unknown_currency_usd_used"]);
    expect(await call(minutesAfter(59))).toEqual(["unknown_currency_usd_used"]);
    expect(fx.calls).toEqual(["QQQ"]);

    expect(await call(minutesAfter(61))).toEqual(["unknown_currency_usd_used"]);
    expect(fx.calls).toEqual(["QQQ", "QQQ"]);
  });

  it("accepts only a three-letter code, so at most 17576 codes can be remembered", () => {
    expect(getMetalRateInput.safeParse({ metal: "gold", country: "US", currency: "QQQ" }).success).toBe(true);
    for (const currency of ["QQQQ", "QQ", "Q1Q", "", "ÄBC"]) {
      expect(getMetalRateInput.safeParse({ metal: "gold", country: "US", currency }).success, currency).toBe(false);
    }
  });
});

describe("frankfurter.dev currency list", () => {
  it("reads the codes from the recorded list response", async () => {
    const fetchJson = replay("frankfurter-currencies");
    expect(await frankfurterCodes(fetchJson)()).toEqual({ ok: true, value: ["AED", "BTC", "INR", "USD", "XAU"] });
    expect(fetchJson.urls).toEqual(["https://api.frankfurter.dev/v2/currencies"]);
  });

  it.each([
    ["an HTTP 503", replay("frankfurter-currencies", 503), "provider_failed"],
    ["a rates body", replay("frankfurter-inr"), "invalid_response"],
    ["an empty list", async () => ({ status: 200, body: [] }), "invalid_response"],
  ] as const)("refuses %s", async (_name, fetchJson, code) => {
    expect(await frankfurterCodes(fetchJson)()).toMatchObject({ ok: false, error: { code } });
  });
});

describe("currency list", () => {
  const LISTED = ["AED", "EUR", "INR", "USD"];
  const unlisted = (index: number) => `Q${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;

  it("answers 200 distinct unlisted codes from the list with no rate fetch and no slot of their own", async () => {
    const fx = fxProvider();
    const codes = listing(LISTED);
    const deps = fakeDeps({ fx, codes });
    const gate = counted(spacing(REFRESH_GAP_MS));
    const gated = bounded(deps, deps.cache, sharedFetches(), gate);

    const currencies = Array.from({ length: 200 }, (_, index) => unlisted(index));
    expect(new Set(currencies).size).toBe(200);
    const results = await Promise.all(currencies.map((currency) => rate(currency, gated)));

    expect(results.map((result) => result.ok && result.value.warnings.map((warning) => warning.code))).toEqual(
      currencies.map(() => ["unknown_currency_usd_used"]),
    );
    expect(fx.calls).toEqual([]);
    expect(codes.fetches).toBe(1);
    expect(gate.slots, "the one slot is the list fetch").toBe(1);
  });

  it("fetches the list at most once a day and keeps it in the cache for other isolates", async () => {
    const codes = listing(LISTED);
    const cache = new MemoryCache();
    const isolate = (now: Date) => {
      const deps = fakeDeps({ now, cache, codes });
      return bounded(deps, cache, sharedFetches(), spacing(0));
    };

    await rate("QQQ", isolate(WEDNESDAY_NOON));
    await rate("QQR", isolate(hoursAfter(23)));
    expect(codes.fetches).toBe(1);

    await rate("QQS", isolate(hoursAfter(25)));
    expect(codes.fetches).toBe(2);
  });

  it("falls back to asking the feed when the list cannot be fetched and none is cached, and does not retry within a day", async () => {
    const fx = fxProvider(() => UNPUBLISHED);
    const failing = Object.assign(
      async () => (failing.fetches++, fail<readonly string[]>("provider_failed", "frankfurter.dev answered HTTP 503.", "Try later.")),
      { fetches: 0 },
    );
    const cache = new MemoryCache();
    const call = (now: Date, currency: string) => {
      const deps = fakeDeps({ now, cache, fx, codes: failing });
      return rate(currency, bounded(deps, cache, sharedFetches(), spacing(0)));
    };

    expect(value(await call(WEDNESDAY_NOON, "QQQ")).warnings.map((warning) => warning.code)).toEqual(["unknown_currency_usd_used"]);
    await call(hoursAfter(1), "QQR");
    expect(fx.calls).toEqual(["QQQ", "QQR"]);
    expect(failing.fetches).toBe(1);
  });

  it("keeps using the last list when a later list fetch fails", async () => {
    const cache = new MemoryCache();
    const fx = fxProvider();
    const call = (now: Date, codes: FetchCodes, currency: string) => {
      const deps = fakeDeps({ now, cache, fx, codes });
      return rate(currency, bounded(deps, cache, sharedFetches(), spacing(0)));
    };

    await call(WEDNESDAY_NOON, listing(LISTED), "INR");
    await call(hoursAfter(25), async () => fail("provider_failed", "frankfurter.dev answered HTTP 503.", "Try later."), "QQQ");
    expect(fx.calls).toEqual(["INR"]);
  });
});

describe("currency fetch spacing and wait cap", () => {
  afterEach(() => vi.useRealTimers());

  async function warmed(deps: ReturnType<typeof bounded>) {
    const listFetched = rate("QQQ", deps);
    await vi.advanceTimersByTimeAsync(REFRESH_GAP_MS);
    await listFetched;
    return deps;
  }

  const LISTED: Currency[] = ["AED", "AUD", "CAD", "CHF", "EUR", "GBP", "INR", "JPY", "SGD", "ZAR"].map((code) => code as Currency);

  it("starts the list fetch and the rate fetches at least 500 ms apart", async () => {
    vi.useFakeTimers();
    const { fx, starts } = timedFx();
    const deps = fakeDeps({ fx, codes: async () => (starts.push(Date.now()), ok(LISTED)) });
    const gated = bounded(deps, deps.cache, sharedFetches(), spacing(REFRESH_GAP_MS));

    const calls = Promise.all(LISTED.slice(0, 4).map((currency) => rate(currency, gated)));
    await vi.runAllTimersAsync();
    expect((await calls).map((result) => result.ok)).toEqual([true, true, true, true]);

    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(gaps).toHaveLength(4);
    expect(Math.min(...gaps), `gaps ${gaps.join(", ")}`).toBeGreaterThanOrEqual(REFRESH_GAP_MS);
  });

  it("makes no call wait past the cap, tells capped callers the rate is busy, and serves a call made after the queue drains", async () => {
    vi.useFakeTimers();
    const { fx, calls } = timedFx();
    const deps = fakeDeps({ fx, codes: listing(LISTED) });
    const gated = await warmed(bounded(deps, deps.cache, sharedFetches(), spacing(REFRESH_GAP_MS)));

    const sent = Date.now();
    const waits = new Map<string, number>();
    const all = Promise.all(
      LISTED.map((currency) => rate(currency, gated).then((result) => (waits.set(currency, Date.now() - sent), result))),
    );
    await vi.runAllTimersAsync();
    const results = await all;

    expect(Math.max(...waits.values()), `waits ${[...waits.values()].join(", ")}`).toBeLessThanOrEqual(MAX_FX_WAIT_MS);
    const served = LISTED.filter((_, index) => results[index]!.ok);
    const capped = LISTED.filter((_, index) => !results[index]!.ok);
    expect(served).toHaveLength(MAX_FX_WAIT_MS / REFRESH_GAP_MS + 1);
    expect(calls.toSorted()).toEqual([...served].toSorted());
    expect(results.flatMap((result) => (result.ok ? [] : [result.error]))).toEqual(capped.map(busy));
    for (const currency of capped) expect(waits.get(currency)).toBe(0);

    const later = rate(capped[0]!, gated);
    await vi.runAllTimersAsync();
    expect(value(await later).currency).toBe(capped[0]);
  });

  it("serves a cached rate with its usual warning to a capped call", async () => {
    vi.useFakeTimers();
    const { fx, calls } = timedFx();
    const deps = fakeDeps({ fx, codes: listing(LISTED) });
    deps.cache.records.set("fx:ZAR", {
      quote: { quote: "ZAR", rate: "18.2", asOf: "2026-11-11", source: "frankfurter.dev" },
      fetchedAt: minutesBefore(WEDNESDAY_NOON, 120),
    });
    const gated = await warmed(bounded(deps, deps.cache, sharedFetches(), spacing(REFRESH_GAP_MS)));

    const queued = Promise.all(LISTED.slice(0, 5).map((currency) => rate(currency, gated)));
    const zar = rate("ZAR", gated);
    await vi.runAllTimersAsync();
    await queued;

    const result = value(await zar);
    expect(result.currency).toBe("ZAR");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["currency_stale"]);
    expect(calls).not.toContain("ZAR");
  });
});

describe("concurrent calls on a cold key", () => {
  it("share one upstream fetch per provider and rate key", async () => {
    const primary = held("gold-api.com");
    const fallback = held("xaus.com");
    const fx = fxProvider();
    const deps = bounded(
      fakeDeps({ primary: primary.provider, fallback: fallback.provider, fx }),
      new MemoryCache(),
      sharedFetches(),
      spacing(0),
    );

    const calls = Array.from({ length: 5 }, () => getMetalRate({ metal: "gold", country: "IN", currency: "INR" }, deps));
    calls.push(getMetalRate({ metal: "silver", country: "IN", currency: "INR" }, deps));
    await new Promise((resolve) => setTimeout(resolve, 10));
    primary.release();
    fallback.release();
    const results = await Promise.all(calls);

    expect(results.map((result) => result.ok)).toEqual([true, true, true, true, true, true]);
    expect(primary.provider.calls.toSorted()).toEqual(["gold", "silver"]);
    expect(fallback.provider.calls.toSorted()).toEqual(["gold", "silver"]);
    expect(fx.calls).toEqual(["INR"]);
  });
});
