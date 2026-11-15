import { z } from "zod";
import type { Metal } from "../../domain/purity";
import { TRY_ANOTHER_SOURCE, fail, ok, type FetchJson, type SpotProvider } from "../types";
import { positiveDecimal } from "../validate";
import { PROVIDER_TIMEOUT_MS, request } from "./fetch";

const SOURCE = "xaus.com";
const FIELD: Record<Metal, "spot_usd_oz" | "silver_usd_oz"> = { gold: "spot_usd_oz", silver: "silver_usd_oz" };

const bodySchema = z.object({
  xau: z.object({ currency: z.string(), unit: z.string() }),
  spot_usd_oz: z.number(),
  silver_usd_oz: z.number(),
  price_as_of: z.iso.datetime(),
});

export function xausProvider(fetchJson: FetchJson, timeoutMs = PROVIDER_TIMEOUT_MS): SpotProvider {
  return {
    source: SOURCE,
    async fetchSpot(metal) {
      const response = await request(fetchJson, "https://xaus.com/api/v1/spot", SOURCE, timeoutMs);
      if (!response.ok) return response;
      if (response.value.status !== 200) return fail("provider_failed", `${SOURCE} answered HTTP ${response.value.status}.`, TRY_ANOTHER_SOURCE);
      const body = bodySchema.safeParse(response.value.body);
      if (!body.success) return fail("invalid_response", `${SOURCE} sent a body that does not match its spot format: ${z.prettifyError(body.error)}`, TRY_ANOTHER_SOURCE);
      const { currency, unit } = body.data.xau;
      if (currency !== "USD" || unit !== "troy_oz") return fail("invalid_response", `${SOURCE} priced spot in ${currency} per ${unit}, not USD per troy_oz.`, TRY_ANOTHER_SOURCE);
      const price = positiveDecimal(body.data[FIELD[metal]], `${SOURCE} ${FIELD[metal]}`);
      if (!price.ok) return price;
      return ok({ metal, usdPerTroyOz: price.value, asOf: body.data.price_as_of, source: SOURCE });
    },
  };
}
