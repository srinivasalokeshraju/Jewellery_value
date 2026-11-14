import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseDecimal } from "../src/domain/decimal";
import { parseCurrency, type Currency } from "../src/domain/money";
import type { Metal } from "../src/domain/purity";
import { MemoryCache } from "../src/rates/cache";
import { fxKey, getFx, getSpot, spotKey } from "../src/rates/chain";
import { localEstimate } from "../src/rates/local";
import { fetchJson } from "../src/rates/providers/fetch";
import { frankfurterProvider } from "../src/rates/providers/frankfurter";
import { goldApiProvider } from "../src/rates/providers/goldApi";
import { xausProvider } from "../src/rates/providers/xaus";
import type { FetchJson, Fetched, RateResult } from "../src/rates/types";

const USAGE = `Usage:
  rates-cli spot gold|silver [options]
  rates-cli fx <ISO currency> [options]
  rates-cli local <country> --value <spot value> --currency <ISO currency>
Options:
  --fail primary | primary,fallback   make those providers fail
  --now <ISO time>                    fix the clock
  --seed <fixture>                    answer the primary from test/fixtures/<provider>-<fixture>.json
  --cache-age <seconds>               start with a cached record of the recorded price, dated and fetched that many seconds before now`;

function usage(problem: string): never {
  console.error(`${problem}\n${USAGE}`);
  process.exit(1);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fail: { type: "string" },
    now: { type: "string" },
    seed: { type: "string" },
    "cache-age": { type: "string" },
    value: { type: "string" },
    currency: { type: "string" },
  },
});

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), "utf8"));
}

function replay(name: string): FetchJson {
  const body = fixture(name);
  return async () => ({ status: 200, body });
}

const failing = new Set((values.fail ?? "").split(",").filter(Boolean));
for (const role of failing) if (role !== "primary" && role !== "fallback") usage(`--fail takes primary or fallback, not "${role}".`);

function transport(role: "primary" | "fallback", seedFile: string): FetchJson {
  if (failing.has(role)) {
    return async () => {
      throw new Error(`simulated failure (--fail ${role})`);
    };
  }
  if (role === "primary" && values.seed !== undefined) return replay(`${seedFile}-${values.seed}`);
  return fetchJson;
}

const now = values.now === undefined ? new Date() : new Date(values.now);
if (Number.isNaN(now.getTime())) usage(`--now "${values.now}" is not an ISO time.`);

let cacheAge: number | undefined;
if (values["cache-age"] !== undefined) {
  cacheAge = Number(values["cache-age"]);
  if (!Number.isInteger(cacheAge) || cacheAge < 0) usage(`--cache-age "${values["cache-age"]}" is not a whole number of seconds.`);
}
const seededAt = cacheAge === undefined ? undefined : new Date(now.getTime() - cacheAge * 1000).toISOString();

const cache = new MemoryCache();
const deps = { cache, now: () => now, log: (event: unknown) => console.error(JSON.stringify(event)) };

function seeded<Q>(recorded: Fetched<Q>): Q {
  if (!recorded.ok) throw new Error(`recorded fixture no longer parses: ${recorded.error.message}`);
  return recorded.value;
}

function print<Q>(result: RateResult<Q>): void {
  console.log(JSON.stringify(result));
  if (result.kind === "unavailable") process.exitCode = 3;
}

async function spot(metal: Metal): Promise<void> {
  if (seededAt !== undefined) {
    const recorded = await goldApiProvider(replay(metal === "gold" ? "gold-api-xau" : "gold-api-xag")).fetchSpot(metal);
    await cache.put(spotKey(metal), { quote: { ...seeded(recorded), asOf: seededAt }, fetchedAt: seededAt });
  }
  const spotProviders = [goldApiProvider(transport("primary", "gold-api")), xausProvider(transport("fallback", "xaus"))] as const;
  print(await getSpot(metal, { ...deps, spotProviders }));
}

async function fx(currency: Currency): Promise<void> {
  if (seededAt !== undefined) {
    if (currency !== "INR") usage("--cache-age for fx works only with INR, the one recorded currency fixture.");
    const recorded = await frankfurterProvider(replay("frankfurter-inr")).fetchFx(currency);
    await cache.put(fxKey(currency), { quote: { ...seeded(recorded), asOf: seededAt.slice(0, 10) }, fetchedAt: seededAt });
  }
  print(await getFx(currency, { ...deps, fxProviders: [frankfurterProvider(transport("primary", "frankfurter"))] }));
}

function local(country: string): void {
  const value = values.value === undefined ? undefined : parseDecimal(values.value);
  const currency = values.currency === undefined ? undefined : parseCurrency(values.currency);
  if (value === undefined || value.lte(0)) usage("local needs --value <positive spot value>.");
  if (currency === undefined) usage("local needs --currency <ISO currency>.");
  const estimate = localEstimate({ value, currency }, country);
  if (estimate === undefined) {
    console.log(JSON.stringify({ error: { code: "no_local_estimate", message: `No official duty and tax source is on file for ${country.toUpperCase()}.`, fix: "Show the spot value only." } }));
    process.exitCode = 3;
    return;
  }
  console.log(JSON.stringify(estimate));
}

const [command, arg] = positionals;
if (arg === undefined) usage("Give a command and its argument.");
if (command === "spot") {
  if (arg !== "gold" && arg !== "silver") usage(`spot takes gold or silver, not "${arg}".`);
  await spot(arg);
} else if (command === "fx") {
  const currency = parseCurrency(arg);
  if (currency === undefined) usage(`"${arg}" is not a three-letter currency code.`);
  await fx(currency);
} else if (command === "local") {
  local(arg);
} else {
  usage(`Unknown command "${command}".`);
}
