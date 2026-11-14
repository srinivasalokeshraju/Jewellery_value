import { performance } from "node:perf_hooks";
import { MemoryCache } from "../src/rates/cache";
import { getSpot, spotKey } from "../src/rates/chain";
import { goldApiProvider } from "../src/rates/providers/goldApi";
import { xausProvider } from "../src/rates/providers/xaus";
import type { FetchJson, RateLogEvent } from "../src/rates/types";

const RUNS = 10_000;
const WARMUP = 1_000;
const WEDNESDAY_NOON = new Date("2026-11-11T12:00:00.000Z");

const neverAnswers: FetchJson = () => new Promise(() => {});
const deadProviders = [goldApiProvider(neverAnswers), xausProvider(neverAnswers)];
const events: RateLogEvent[] = [];
const log = (event: RateLogEvent) => events.push(event);

const warm = new MemoryCache();
await warm.put(spotKey("gold"), {
  quote: { metal: "gold", usdPerTroyOz: "3887.600098", asOf: "2026-11-11T11:59:50Z", source: "gold-api.com" },
  fetchedAt: new Date(WEDNESDAY_NOON.getTime() - 10_000).toISOString(),
});
const warmDeps = { spotProviders: deadProviders, cache: warm, now: () => WEDNESDAY_NOON, log };

let notFresh = 0;
for (let i = 0; i < WARMUP; i++) await getSpot("gold", warmDeps);
const warmStart = performance.now();
for (let i = 0; i < RUNS; i++) if ((await getSpot("gold", warmDeps)).kind !== "fresh") notFresh++;
const warmMs = performance.now() - warmStart;

const coldStart = performance.now();
const cold = await getSpot("gold", { spotProviders: deadProviders, cache: new MemoryCache(), now: () => WEDNESDAY_NOON, log });
const doubleTimeoutMs = performance.now() - coldStart;

console.log(
  JSON.stringify({
    warmMeanMicros: Number(((warmMs * 1000) / RUNS).toFixed(2)),
    runs: RUNS,
    warmup: WARMUP,
    notFresh,
    doubleTimeoutMs: Math.round(doubleTimeoutMs),
    doubleTimeoutKind: cold.kind,
    providerFailures: events.filter((e) => e.event === "provider_failed").length,
  }),
);
