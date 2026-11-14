import { z } from "zod";
import type { Metal } from "../../domain/purity";
import { TRY_ANOTHER_SOURCE, fail, ok, type FetchJson, type SpotProvider } from "../types";
import { positiveDecimal } from "../validate";
import { PROVIDER_TIMEOUT_MS, request } from "./fetch";

const SOURCE = "gold-api.com";
const SYMBOL: Record<Metal, string> = { gold: "XAU", silver: "XAG" };

const bodySchema = z.object({
  currency: z.string(),
  price: z.number(),
  symbol: z.string(),
  updatedAt: z.iso.datetime(),
});

export function goldApiProvider(fetchJson: FetchJson, timeoutMs = PROVIDER_TIMEOUT_MS): SpotProvider {
  return {
    source: SOURCE,
    async fetchSpot(metal) {
      const symbol = SYMBOL[metal];
      const response = await request(fetchJson, `https://api.gold-api.com/price/${symbol}`, SOURCE, timeoutMs);
      if (!response.ok) return response;
      if (response.value.status !== 200) return fail("provider_failed", `${SOURCE} answered HTTP ${response.value.status}.`, TRY_ANOTHER_SOURCE);
      const body = bodySchema.safeParse(response.value.body);
      if (!body.success) return fail("invalid_response", `${SOURCE} sent a body that does not match its price format: ${z.prettifyError(body.error)}`, TRY_ANOTHER_SOURCE);
      if (body.data.currency !== "USD") return fail("invalid_response", `${SOURCE} priced ${symbol} in ${body.data.currency}, not USD.`, TRY_ANOTHER_SOURCE);
      if (body.data.symbol !== symbol) return fail("invalid_response", `${SOURCE} answered for ${body.data.symbol}, not ${symbol}.`, TRY_ANOTHER_SOURCE);
      const price = positiveDecimal(body.data.price, `${SOURCE} ${symbol} price`);
      if (!price.ok) return price;
      return ok({ metal, usdPerTroyOz: price.value, asOf: body.data.updatedAt, source: SOURCE });
    },
  };
}
