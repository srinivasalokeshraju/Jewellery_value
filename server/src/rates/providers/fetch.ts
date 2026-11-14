import { TRY_ANOTHER_SOURCE, fail, ok, type FetchJson, type FetchResponse, type Fetched } from "../types";

export const PROVIDER_TIMEOUT_MS = 2000;

export const fetchJson: FetchJson = async (url, signal) => {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, body };
};

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

export async function request(fetchJson: FetchJson, url: string, source: string, timeoutMs: number): Promise<Fetched<FetchResponse>> {
  const controller = new AbortController();
  const { signal } = controller;
  // A referenced timer, unlike AbortSignal.timeout under Node, holds the process open until the deadline fires.
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return ok(await Promise.race([fetchJson(url, signal), aborted(signal)]));
  } catch (cause) {
    const reason = signal.aborted ? `no answer within ${timeoutMs} ms` : String(cause);
    return fail("provider_failed", `${source} request failed: ${reason}.`, TRY_ANOTHER_SOURCE);
  } finally {
    clearTimeout(timer);
  }
}
