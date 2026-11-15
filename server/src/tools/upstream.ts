import { z } from "zod";
import { cacheRecordSchema, type CacheRecord } from "../rates/cache";
import type { FxProvider, SpotProvider } from "../rates/types";
import type { ToolDeps } from "./rates";

const UNPUBLISHED_MEMORY_MS = 60 * 60 * 1000;

const unpublishedSchema = z.object({ code: z.literal("unknown_currency"), message: z.string(), fix: z.string() });

export interface MemoCache {
  get(key: string): Promise<unknown>;
  put(key: string, record: CacheRecord): Promise<void>;
}

export interface SharedFetches {
  run<T>(key: string, start: () => Promise<T>): Promise<T>;
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

function rememberUnpublished(provider: FxProvider, memo: MemoCache, { now, log }: ToolDeps): FxProvider {
  const cacheFailed = (key: string) => (cause: unknown) => log({ event: "cache_failed", key, message: String(cause) });
  return {
    source: provider.source,
    async fetchFx(currency) {
      const key = `fx-unpublished:${provider.source}:${currency}`;
      const remembered = recall(await memo.get(key).catch(cacheFailed(key)), now());
      if (remembered) return { ok: false, error: remembered };

      const fetched = await provider.fetchFx(currency);
      if (!fetched.ok && fetched.error.code === "unknown_currency") {
        await memo.put(key, { quote: fetched.error, fetchedAt: now().toISOString() }).catch(cacheFailed(key));
      }
      return fetched;
    },
  };
}

function sharedFx(provider: FxProvider, shared: SharedFetches): FxProvider {
  return { source: provider.source, fetchFx: (currency) => shared.run(`fx:${provider.source}:${currency}`, () => provider.fetchFx(currency)) };
}

// The schema admits only three-letter codes, so at most 17576 unpublished codes can be remembered.
export function bounded(deps: ToolDeps, memo: MemoCache, shared: SharedFetches): ToolDeps {
  const [primary, fallback] = deps.spotProviders;
  return {
    ...deps,
    spotProviders: [sharedSpot(primary, shared), sharedSpot(fallback, shared)],
    fxProviders: deps.fxProviders.map((provider) => sharedFx(rememberUnpublished(provider, memo, deps), shared)),
  };
}
