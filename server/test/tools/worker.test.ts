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

describe("batch limit", () => {
  afterEach(() => vi.restoreAllMocks());

  const headers = { host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream" };
  const batch = (size: number, name: string, args: object) =>
    JSON.stringify(Array.from({ length: size }, (_, id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })));

  it("rejects a batch of 11 messages before any tool runs", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unit tests never touch the network"));
    const { env } = fakeEnv(true);
    const body = batch(11, "get_metal_rate", { metal: "gold", country: "US" });
    const response = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers, body }), env, ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request: a batch can hold at most 10 messages." }, id: null });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("runs a batch of 10 messages", async () => {
    const { env } = fakeEnv(true);
    const body = batch(10, "list_supported", {});
    const response = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers, body }), env, ctx);
    expect(response.status).toBe(200);
    expect((await response.text()).match(/"structuredContent"/g)).toHaveLength(10);
  });
});

describe("request size limit", () => {
  const MIB = 1024 * 1024;
  const CHUNK = 64 * 1024;

  function eightMiB() {
    const counter = { pulled: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (counter.pulled >= 8 * MIB) return controller.close();
        counter.pulled += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
      },
    }, { highWaterMark: 0 });
    return { body, counter };
  }

  const post = (body: ReadableStream<Uint8Array>, extra: Record<string, string> = {}) =>
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream", ...extra },
      body,
      duplex: "half",
    } as RequestInit);

  it("refuses a Content-Length over 1 MiB with 413 and reads none of the body", async () => {
    const { body, counter } = eightMiB();
    const response = await worker.fetch(post(body, { "content-length": String(95 * MIB) }), fakeEnv(true).env, ctx);
    expect(response.status).toBe(413);
    expect(counter.pulled).toBe(0);
  });

  it("refuses a body with no Content-Length once it passes 1 MiB, and stops reading there", async () => {
    const { body, counter } = eightMiB();
    const response = await worker.fetch(post(body), fakeEnv(true).env, ctx);
    expect(response.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(MIB + 2 * CHUNK);
  });

  it("refuses at the limiter before it reads any of the body", async () => {
    const { body, counter } = eightMiB();
    const response = await worker.fetch(post(body), fakeEnv(false).env, ctx);
    expect(response.status).toBe(429);
    expect(counter.pulled).toBe(0);
  });
});

describe("cron refresh spacing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("keeps the 500 ms gap from the first call when a timer fires 2 ms early", async () => {
    vi.useFakeTimers();
    const exact = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (fn: () => void, ms = 0) => exact(fn, ms > 2 ? ms - 2 : ms));
    const starts: number[] = [];
    const timed = (source: SpotSource): SpotProvider => {
      const inner = spotProvider(source);
      return { source, fetchSpot: (metal) => (starts.push(Date.now()), inner.fetchSpot(metal)) };
    };
    const run = refreshAll({ ...fakeDeps(), spotProviders: spaced([timed("gold-api.com"), timed("xaus.com")], REFRESH_GAP_MS) });
    await vi.runAllTimersAsync();
    await run;
    expect(starts).toHaveLength(4);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(Math.min(...gaps), `gaps ${gaps.join(", ")}`).toBeGreaterThanOrEqual(REFRESH_GAP_MS);
  });
});
