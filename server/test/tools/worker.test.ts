import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../../src/index";
import { REFRESH_GAP_MS, spaced } from "../../src/tools/refresh";
import { MemoryCache } from "../../src/rates/cache";
import { refreshAll } from "../../src/rates/chain";
import type { Metal } from "../../src/domain/purity";
import type { SpotProvider, SpotSource } from "../../src/rates/types";
import { fakeDeps, spotProvider } from "./fakes";

function fakeEnv(allow: boolean) {
  const keys: string[] = [];
  const env = {
    RATES: { get: async () => null, put: async () => {} },
    RL: {
      async limit({ key }: { key: string }) {
        keys.push(key);
        return { success: allow };
      },
    },
  } as unknown as Env;
  return { env, keys };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as never;

describe("rate limiter", () => {
  it("keys on cf-connecting-ip and ignores x-forwarded-for", async () => {
    const { env, keys } = fakeEnv(false);
    const headers = { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" };
    const response = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers }), env, ctx);
    expect(response.status).toBe(429);
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("keys on local when cf-connecting-ip is absent, whatever other header is sent", async () => {
    const { env, keys } = fakeEnv(false);
    const response = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers: { "x-forwarded-for": "198.51.100.1" } }), env, ctx);
    expect(response.status).toBe(429);
    expect(keys).toEqual(["local"]);
  });
});

describe("cron refresh spacing", () => {
  afterEach(() => vi.useRealTimers());

  it("starts each upstream call at least 500 ms after the one before", async () => {
    vi.useFakeTimers();
    const starts: { source: SpotSource; metal: Metal; at: number }[] = [];
    const timed = (source: SpotSource): SpotProvider => {
      const inner = spotProvider(source);
      return {
        source,
        fetchSpot(metal) {
          starts.push({ source, metal, at: Date.now() });
          return inner.fetchSpot(metal);
        },
      };
    };
    const deps = fakeDeps({ cache: new MemoryCache() });
    const run = refreshAll({ ...deps, spotProviders: spaced([timed("gold-api.com"), timed("xaus.com")], REFRESH_GAP_MS) });
    await vi.runAllTimersAsync();
    expect(await run).toEqual([
      { metal: "gold", written: "gold-api.com" },
      { metal: "silver", written: "gold-api.com" },
    ]);
    const gaps = starts.slice(1).map((start, index) => start.at - starts[index]!.at);
    expect(starts).toHaveLength(4);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(REFRESH_GAP_MS);
  });
});
