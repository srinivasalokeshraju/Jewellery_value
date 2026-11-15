import { describe, expect, it } from "vitest";
import type { Metal } from "../../src/domain/purity";
import { MemoryCache } from "../../src/rates/cache";
import { fail, type SpotProvider, type SpotSource } from "../../src/rates/types";
import { getMetalRate } from "../../src/tools/getMetalRate";
import { getMetalRateInput } from "../../src/tools/getMetalRate";
import { bounded, sharedFetches } from "../../src/tools/upstream";
import { fakeDeps, fxProvider, spotProvider, WEDNESDAY_NOON } from "./fakes";

const UNPUBLISHED = fail<never>("unknown_currency", "frankfurter.dev publishes no USD rate for the currency QQQ.", "Ask for another code.");

function minutesAfter(minutes: number): Date {
  return new Date(WEDNESDAY_NOON.getTime() + minutes * 60_000);
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
      const result = await getMetalRate({ metal: "gold", country: "US", currency: "QQQ" }, bounded(deps, deps.cache, shared));
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

describe("concurrent calls on a cold key", () => {
  it("share one upstream fetch per provider and rate key", async () => {
    const primary = held("gold-api.com");
    const fallback = held("xaus.com");
    const fx = fxProvider();
    const deps = bounded(fakeDeps({ primary: primary.provider, fallback: fallback.provider, fx }), new MemoryCache(), sharedFetches());

    const calls = Array.from({ length: 5 }, () => getMetalRate({ metal: "gold", country: "IN", currency: "INR" }, deps));
    calls.push(getMetalRate({ metal: "silver", country: "IN", currency: "INR" }, deps));
    await new Promise((resolve) => setTimeout(resolve, 10));
    primary.release();
    fallback.release();
    const results = await Promise.all(calls);

    expect(results.map((result) => result.ok)).toEqual([true, true, true, true, true, true]);
    expect(primary.provider.calls.sort()).toEqual(["gold", "silver"]);
    expect(fallback.provider.calls.sort()).toEqual(["gold", "silver"]);
    expect(fx.calls).toEqual(["INR"]);
  });
});
