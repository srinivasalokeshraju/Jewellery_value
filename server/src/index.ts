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
import type { ToolDeps } from "./tools/rates";
import { REFRESH_GAP_MS, spaced } from "./tools/refresh";
import { bounded, sharedFetches } from "./tools/upstream";

export interface Env {
  RATES: KVNamespace;
  RL: RateLimit;
}

const MAX_BATCH = 10;

const shared = sharedFetches();

function writeLog(event: object): void {
  console.log(JSON.stringify(event));
}

const loggedFetch: FetchJson = (url, signal) => {
  writeLog({ event: "provider_fetch", host: new URL(url).host });
  return fetchJson(url, signal);
};

function toolDeps(cache: KvCache): ToolDeps {
  return {
    cache,
    now: () => new Date(),
    log: writeLog,
    spotProviders: [goldApiProvider(loggedFetch), xausProvider(loggedFetch)],
    fxProviders: [frankfurterProvider(loggedFetch)],
  };
}

async function isOversizedBatch(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  return Array.isArray(body) && body.length > MAX_BATCH;
}

function oversizedBatch(): Response {
  const error = { code: -32600, message: `Invalid Request: a batch can hold at most ${MAX_BATCH} messages.` };
  return Response.json({ jsonrpc: "2.0", error, id: null }, { status: 400 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/mcp") {
      const { success } = await env.RL.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" });
      if (!success) return new Response("Too many requests. Try again in a minute.", { status: 429 });
      if (await isOversizedBatch(request)) return oversizedBatch();
    }
    const cache = new KvCache(env.RATES);
    const deps = { ...bounded(toolDeps(cache), cache, shared), logUsage };
    return createMcpHandler(() => buildServer(deps))(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = toolDeps(new KvCache(env.RATES));
    const outcomes = await refreshAll({ ...deps, spotProviders: spaced(deps.spotProviders, REFRESH_GAP_MS) });
    writeLog({ event: "cache_warm", outcomes });
  },
};
