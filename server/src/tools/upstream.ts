import { z } from "zod";
import { cacheRecordSchema, type CacheRecord } from "../rates/cache";
import { PROVIDER_TIMEOUT_MS, request } from "../rates/providers/fetch";
import { fail, ok, TRY_ANOTHER_SOURCE, type FetchJson, type Fetched, type FxProvider, type SpotProvider } from "../rates/types";
import type { ToolDeps } from "./rates";

const UNPUBLISHED_MEMORY_MS = 60 * 60 * 1000;
const CODES_MEMORY_MS = 24 * 60 * 60 * 1000;
export const MAX_FX_WAIT_MS = 2000;

const unpublishedSchema = z.object({ code: z.literal("unknown_currency"), message: z.string(), fix: z.string() });

export interface MemoCache {
  get(key: string): Promise<unknown>;
  put(key: string, record: CacheRecord): Promise<void>;
}

export interface SharedFetches {
  run<T>(key: string, start: () => Promise<T>): Promise<T>;
}

export interface Gate {
  <T>(start: () => Promise<T>): Promise<T>;
  delayMs(): number;
}

export type FetchCodes = () => Promise<Fetched<readonly string[]>>;

export interface UpstreamDeps extends ToolDeps {
  fetchCurrencyCodes: FetchCodes;
}

// Compared by identity: the chain turns every failed fetch into rate_unavailable, so priceIn watches for this one.
export const FX_BUSY = fail<never>(
  "provider_failed",
  "The currency fetch queue is full, so this server did not ask the feed.",
  TRY_ANOTHER_SOURCE,
);

const CODES_KEY = "fx-codes:frankfurter.dev";
const CODES_URL = "https://api.frankfurter.dev/v2/currencies";
const codesSchema = z.object({ codes: z.array(z.string()).nullable() });
const listSchema = z.array(z.object({ iso_code: z.string() })).min(1);

export function frankfurterCodes(fetchJson: FetchJson, timeoutMs = PROVIDER_TIMEOUT_MS): FetchCodes {
  return async () => {
    const response = await request(fetchJson, CODES_URL, "frankfurter.dev", timeoutMs);
    if (!response.ok) return response;
    const { status } = response.value;
    if (status !== 200)
      return fail("provider_failed", `frankfurter.dev answered HTTP ${status} for its currency list.`, TRY_ANOTHER_SOURCE);
    const list = listSchema.safeParse(response.value.body);
    if (!list.success)
      return fail("invalid_response", "frankfurter.dev sent a currency list that does not match its format.", TRY_ANOTHER_SOURCE);
    return ok(list.data.map((row) => row.iso_code));
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// gold-api.com bans clients that send several requests per second. Each call books a slot and sleeps on its own timer,
// so no request waits on a promise from another request. The clock is checked again after each sleep, because a Worker
// timer can fire a few ms early, and against the last real start, because a late timer can let a later slot go first.
export function spacing(gapMs: number): Gate {
  let nextSlot = -Infinity;
  let lastStart = -Infinity;
  const gate = async <T>(start: () => Promise<T>): Promise<T> => {
    const slot = Math.max(Date.now(), nextSlot);
    nextSlot = slot + gapMs;
    const due = () => Math.max(slot, lastStart + gapMs) - Date.now();
    for (let wait = due(); wait > 0; wait = due()) await sleep(wait);
    lastStart = Date.now();
    return start();
  };
  return Object.assign(gate, { delayMs: () => Math.max(nextSlot, lastStart + gapMs) - Date.now() });
}

export function sharedFetches(): SharedFetches {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, start: () => Promise<T>): Promise<T> {
      const running = pending.get(key) as Promise<T> | undefined;
      if (running) return running;
      const fetch = start().finally(() => pending.delete(key));
      pending.set(key, fetch);
      return fetch;
    },
  };
}

function sharedSpot(provider: SpotProvider, shared: SharedFetches): SpotProvider {
  return { source: provider.source, fetchSpot: (metal) => shared.run(`spot:${provider.source}:${metal}`, () => provider.fetchSpot(metal)) };
}

function recall(raw: unknown, now: Date): z.infer<typeof unpublishedSchema> | undefined {
  const record = cacheRecordSchema.safeParse(raw);
  if (!record.success) return undefined;
  const age = now.getTime() - Date.parse(record.data.fetchedAt);
  const error = unpublishedSchema.safeParse(record.data.quote);
  return error.success && age >= 0 && age < UNPUBLISHED_MEMORY_MS ? error.data : undefined;
}

function cacheFailed(log: ToolDeps["log"], key: string) {
  return (cause: unknown) => log({ event: "cache_failed", key, message: String(cause) });
}

function rememberUnpublished(provider: FxProvider, memo: MemoCache, { now, log }: ToolDeps): FxProvider {
  return {
    source: provider.source,
    async fetchFx(currency) {
      const key = `fx-unpublished:${provider.source}:${currency}`;
      const remembered = recall(await memo.get(key).catch(cacheFailed(log, key)), now());
      if (remembered) return { ok: false, error: remembered };

      const fetched = await provider.fetchFx(currency);
      if (!fetched.ok && fetched.error.code === "unknown_currency") {
        await memo.put(key, { quote: fetched.error, fetchedAt: now().toISOString() }).catch(cacheFailed(log, key));
      }
      return fetched;
    },
  };
}

// A call that would wait past the cap books no slot, so a burst of new codes cannot make later callers wait minutes.
function gatedFx(provider: FxProvider, gate: Gate): FxProvider {
  return {
    source: provider.source,
    fetchFx: async (currency) => (gate.delayMs() > MAX_FX_WAIT_MS ? FX_BUSY : gate(() => provider.fetchFx(currency))),
  };
}

// A failed fetch is kept for a day too, so the list costs one feed request a day while the cache holds the answer.
// The request takes a slot in the currency gate like any other request to the feed, and a capped one is not kept.
async function publishedCodes(
  memo: MemoCache,
  gate: Gate,
  { fetchCurrencyCodes, now, log }: UpstreamDeps,
): Promise<readonly string[] | null> {
  const record = cacheRecordSchema.safeParse(await memo.get(CODES_KEY).catch(cacheFailed(log, CODES_KEY)));
  const kept = record.success ? codesSchema.safeParse(record.data.quote).data : undefined;
  const age = record.success ? now().getTime() - Date.parse(record.data.fetchedAt) : Infinity;
  if (kept && age >= 0 && age < CODES_MEMORY_MS) return kept.codes;
  if (gate.delayMs() > MAX_FX_WAIT_MS) return kept?.codes ?? null;

  const fetched = await gate(fetchCurrencyCodes);
  if (!fetched.ok)
    log({ event: "provider_failed", key: CODES_KEY, source: "frankfurter.dev", code: fetched.error.code, message: fetched.error.message });
  const codes = fetched.ok ? fetched.value : (kept?.codes ?? null);
  await memo.put(CODES_KEY, { quote: { codes }, fetchedAt: now().toISOString() }).catch(cacheFailed(log, CODES_KEY));
  return codes;
}

function listedFx(provider: FxProvider, codes: () => Promise<readonly string[] | null>): FxProvider {
  return {
    source: provider.source,
    async fetchFx(currency) {
      const listed = await codes();
      if (listed === null || listed.includes(currency)) return provider.fetchFx(currency);
      return fail(
        "unknown_currency",
        `${provider.source} does not list the currency ${currency}.`,
        "Ask for an ISO 4217 code the provider supports, such as INR, AED, or EUR.",
      );
    },
  };
}

function sharedFx(provider: FxProvider, shared: SharedFetches): FxProvider {
  return {
    source: provider.source,
    fetchFx: (currency) => shared.run(`fx:${provider.source}:${currency}`, () => provider.fetchFx(currency)),
  };
}

// The schema admits only three-letter codes, so at most 17576 unpublished codes can be remembered.
export function bounded(deps: UpstreamDeps, memo: MemoCache, shared: SharedFetches, fxGate: Gate): ToolDeps {
  const [primary, fallback] = deps.spotProviders;
  const codes = () => shared.run(CODES_KEY, () => publishedCodes(memo, fxGate, deps));
  return {
    ...deps,
    spotProviders: [sharedSpot(primary, shared), sharedSpot(fallback, shared)],
    fxProviders: deps.fxProviders.map((provider) =>
      sharedFx(listedFx(rememberUnpublished(gatedFx(provider, fxGate), memo, deps), codes), shared),
    ),
  };
}
