import { z } from "zod";
import { TRY_ANOTHER_SOURCE, fail, ok, type FetchJson, type FxProvider } from "../types";
import { positiveDecimal } from "../validate";
import { PROVIDER_TIMEOUT_MS, request } from "./fetch";

const SOURCE = "frankfurter.dev";

const bodySchema = z.array(z.object({ date: z.iso.date(), base: z.string(), quote: z.string(), rate: z.number() }));
const rejectionSchema = z.object({ message: z.string() });

export function frankfurterProvider(fetchJson: FetchJson, timeoutMs = PROVIDER_TIMEOUT_MS): FxProvider {
  return {
    source: SOURCE,
    async fetchFx(currency) {
      const response = await request(fetchJson, `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${currency}`, SOURCE, timeoutMs);
      if (!response.ok) return response;
      const { status } = response.value;
      if (status === 422 && rejectionSchema.safeParse(response.value.body).data?.message.includes("invalid currency")) {
        return fail("unknown_currency", `${SOURCE} publishes no USD rate for the currency ${currency}.`, "Ask for an ISO 4217 code the provider supports, such as INR, AED, or EUR.");
      }
      if (status !== 200) return fail("provider_failed", `${SOURCE} answered HTTP ${status}.`, TRY_ANOTHER_SOURCE);
      const body = bodySchema.safeParse(response.value.body);
      if (!body.success) return fail("invalid_response", `${SOURCE} sent a body that does not match its rates format: ${z.prettifyError(body.error)}`, TRY_ANOTHER_SOURCE);
      const entry = body.data.find((row) => row.base === "USD" && row.quote === currency);
      if (entry === undefined) return fail("invalid_response", `${SOURCE} sent no USD to ${currency} rate.`, TRY_ANOTHER_SOURCE);
      const rate = positiveDecimal(entry.rate, `${SOURCE} USD to ${currency} rate`);
      if (!rate.ok) return rate;
      return ok({ quote: currency, rate: rate.value, asOf: entry.date, source: SOURCE });
    },
  };
}
