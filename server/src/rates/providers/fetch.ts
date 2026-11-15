import { z } from "zod";
import { TRY_ANOTHER_SOURCE, fail, ok, type FetchJson, type FetchResponse, type Fetched } from "../types";

export const PROVIDER_TIMEOUT_MS = 2000;

const responseSchema = z.object({ status: z.number(), body: z.unknown() });

export const fetchJson: FetchJson = async (url, signal) => {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, body };
};

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
}

export async function request(fetcher: FetchJson, url: string, source: string, timeoutMs: number): Promise<Fetched<FetchResponse>> {
  const controller = new AbortController();
  const { signal } = controller;
  // A referenced timer, unlike AbortSignal.timeout under Node, holds the process open until the deadline fires.
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = responseSchema.safeParse(await Promise.race([fetcher(url, signal), aborted(signal)]));
    if (!response.success) return fail("provider_failed", `${source} request returned no HTTP response.`, TRY_ANOTHER_SOURCE);
    return ok({ status: response.data.status, body: response.data.body });
  } catch (cause) {
    const reason = signal.aborted ? `no answer within ${timeoutMs} ms` : String(cause);
    return fail("provider_failed", `${source} request failed: ${reason}.`, TRY_ANOTHER_SOURCE);
  } finally {
    clearTimeout(timer);
  }
}
