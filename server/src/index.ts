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

export interface Env {
  RATES: KVNamespace;
  RL: RateLimit;
}

function writeLog(event: object): void {
  console.log(JSON.stringify(event));
}

const loggedFetch: FetchJson = (url, signal) => {
  writeLog({ event: "provider_fetch", host: new URL(url).host });
  return fetchJson(url, signal);
};

function toolDeps(env: Env): ToolDeps {
  return {
    cache: new KvCache(env.RATES),
    now: () => new Date(),
    log: writeLog,
    spotProviders: [goldApiProvider(loggedFetch), xausProvider(loggedFetch)],
    fxProviders: [frankfurterProvider(loggedFetch)],
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/mcp") {
      const { success } = await env.RL.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" });
      if (!success) return new Response("Too many requests. Try again in a minute.", { status: 429 });
    }
    const deps = { ...toolDeps(env), logUsage };
    return createMcpHandler(() => buildServer(deps))(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = toolDeps(env);
    const outcomes = await refreshAll({ ...deps, spotProviders: spaced(deps.spotProviders, REFRESH_GAP_MS) });
    writeLog({ event: "cache_warm", outcomes });
  },
};
