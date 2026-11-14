import { z } from "zod";
import type { FxQuote, SpotQuote } from "./types";

export interface CacheRecord<Q = unknown> {
  quote: Q;
  fetchedAt: string;
  unverified?: true;
}

export const cacheRecordSchema = z.object({ quote: z.unknown(), fetchedAt: z.iso.datetime(), unverified: z.literal(true).optional() });

export interface RateCache {
  get(key: string): Promise<unknown>;
  put(key: string, record: CacheRecord<SpotQuote | FxQuote>): Promise<void>;
}

export class MemoryCache implements RateCache {
  readonly records = new Map<string, CacheRecord>();

  async get(key: string): Promise<unknown> {
    return this.records.get(key);
  }

  async put(key: string, record: CacheRecord): Promise<void> {
    this.records.set(key, record);
  }
}

export interface KvNamespaceLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

const KEEP_LAST_GOOD_SECONDS = 7 * 24 * 60 * 60;

export class KvCache implements RateCache {
  constructor(private readonly kv: KvNamespaceLike) {}

  get(key: string): Promise<unknown> {
    return this.kv.get(key, "json");
  }

  async put(key: string, record: CacheRecord): Promise<void> {
    await this.kv.put(key, JSON.stringify(record), { expirationTtl: KEEP_LAST_GOOD_SECONDS });
  }
}
