import type { ExecutionContext, KVNamespace, RateLimit, ScheduledController } from "@cloudflare/workers-types/index";
import { createMcpHandler } from "agents/mcp/server";
import { KvCache } from "./rates/cache";
import { refreshAll } from "./rates/chain";
import { fetchJson } from "./rates/providers/fetch";
import { frankfurterProvider } from "./rates/providers/frankfurter";
import { goldApiProvider } from "./rates/providers/goldApi";
import { xausProvider } from "./rates/providers/xaus";
import type { FetchJson } from "./rates/types";
import { logUsage } from "./log";
import { buildServer } from "./server";
import { REFRESH_GAP_MS, spaced } from "./tools/refresh";
import { bounded, frankfurterCodes, sharedFetches, spacing, type UpstreamDeps } from "./tools/upstream";

export interface Env {
  RATES: KVNamespace;
  RL: RateLimit;
}

const MAX_BATCH = 10;
const MAX_BODY_BYTES = 1024 * 1024;

const shared = sharedFetches();
const fxGate = spacing(REFRESH_GAP_MS);

function writeLog(event: object): void {
  console.log(JSON.stringify(event));
}

const loggedFetch: FetchJson = (url, signal) => {
  writeLog({ event: "provider_fetch", host: new URL(url).host });
  return fetchJson(url, signal);
};

function toolDeps(cache: KvCache): UpstreamDeps {
  return {
    cache,
    now: () => new Date(),
    log: writeLog,
    spotProviders: [goldApiProvider(loggedFetch), xausProvider(loggedFetch)],
    fxProviders: [frankfurterProvider(loggedFetch)],
    fetchCurrencyCodes: frankfurterCodes(loggedFetch),
  };
}

function refusal(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

const tooLarge = () => refusal(413, -32000, `Payload Too Large: a request body can hold at most ${MAX_BODY_BYTES} bytes.`);

async function readAtMost(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isOversizedBatch(bytes: Uint8Array): boolean {
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(body) && body.length > MAX_BATCH;
  } catch {
    return false;
  }
}

// The batch check must parse the body before the SDK's own 4 MiB cap applies, so it reads at most 1 MiB and hands the bytes on.
async function screenBody(request: Request): Promise<Request | Response> {
  if (request.method !== "POST" || request.body === null) return request;
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return tooLarge();
  const bytes = await readAtMost(request.body, MAX_BODY_BYTES);
  if (bytes === undefined) return tooLarge();
  if (isOversizedBatch(bytes)) return refusal(400, -32600, `Invalid Request: a batch can hold at most ${MAX_BATCH} messages.`);
  // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- the guard above returns early unless the method is POST.
  return new Request(request, { body: bytes });
}

async function guardMcp(request: Request, env: Env): Promise<Request | Response> {
  const { success } = await env.RL.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" });
  if (!success) return new Response("Too many requests. Try again in a minute.", { status: 429 });
  return screenBody(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const admitted = new URL(request.url).pathname === "/mcp" ? await guardMcp(request, env) : request;
    if (admitted instanceof Response) return admitted;
    const cache = new KvCache(env.RATES);
    const deps = { ...bounded(toolDeps(cache), cache, shared, fxGate), logUsage };
    return createMcpHandler(() => buildServer(deps))(admitted, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = toolDeps(new KvCache(env.RATES));
    const outcomes = await refreshAll({ ...deps, spotProviders: spaced(deps.spotProviders, REFRESH_GAP_MS) });
    writeLog({ event: "cache_warm", outcomes });
  },
};
