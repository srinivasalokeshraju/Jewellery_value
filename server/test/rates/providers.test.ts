import { describe, expect, it } from "vitest";
import { parseCurrency, type Currency } from "../../src/domain/money";
import { frankfurterProvider } from "../../src/rates/providers/frankfurter";
import { goldApiProvider } from "../../src/rates/providers/goldApi";
import { xausProvider } from "../../src/rates/providers/xaus";
import type { FetchJson, FetchResponse, Fetched, RateErrorCode } from "../../src/rates/types";
import { neverAnswers, replay } from "./fixtures";

const INR = parseCurrency("INR")!;
const TIMEOUT_MS = 20;

function errorCode<T>(result: Fetched<T>): RateErrorCode {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error.code;
}

describe("gold-api.com", () => {
  it("reads the recorded gold response as USD per troy ounce", async () => {
    const fetchJson = replay("gold-api-xau");
    const result = await goldApiProvider(fetchJson).fetchSpot("gold");
    expect(result).toEqual({
      ok: true,
      value: { metal: "gold", usdPerTroyOz: "3887.600098", asOf: "2026-11-14T22:48:25Z", source: "gold-api.com" },
    });
    expect(fetchJson.urls).toEqual(["https://api.gold-api.com/price/XAU"]);
  });

  it("reads the recorded silver response from the XAG endpoint", async () => {
    const fetchJson = replay("gold-api-xag");
    const result = await goldApiProvider(fetchJson).fetchSpot("silver");
    expect(result.ok && result.value.usdPerTroyOz).toBe("48.650002");
    expect(fetchJson.urls).toEqual(["https://api.gold-api.com/price/XAG"]);
  });

  it.each([
    ["malformed", "gold", "invalid_response"],
    ["wrong-currency", "gold", "invalid_response"],
    ["out-of-range", "gold", "rate_rejected"],
    ["xau", "silver", "invalid_response"],
  ] as const)("rejects the %s fixture asked for %s", async (name, metal, code) => {
    const result = await goldApiProvider(replay(name === "xau" ? "gold-api-xau" : `gold-api-${name}`)).fetchSpot(metal);
    expect(errorCode(result)).toBe(code);
  });

  it("fails on a non-200 status", async () => {
    expect(errorCode(await goldApiProvider(replay("gold-api-xau", 503)).fetchSpot("gold"))).toBe("provider_failed");
  });

  it("fails on a timeout even when the fetch ignores its abort signal", async () => {
    const result = await goldApiProvider(neverAnswers, TIMEOUT_MS).fetchSpot("gold");
    expect(errorCode(result)).toBe("provider_failed");
    expect(!result.ok && result.error.message).toContain(`no answer within ${TIMEOUT_MS} ms`);
  });
});

describe("xaus.com", () => {
  it.each([
    ["gold", "3887.600098"],
    ["silver", "48.650002"],
  ] as const)("reads %s from the recorded spot response", async (metal, price) => {
    const result = await xausProvider(replay("xaus-spot")).fetchSpot(metal);
    expect(result).toEqual({ ok: true, value: { metal, usdPerTroyOz: price, asOf: "2026-11-14T22:47:42.925Z", source: "xaus.com" } });
  });

  it.each([
    ["malformed", "invalid_response"],
    ["wrong-currency", "invalid_response"],
    ["out-of-range", "rate_rejected"],
  ] as const)("rejects the %s fixture", async (name, code) => {
    expect(errorCode(await xausProvider(replay(`xaus-${name}`)).fetchSpot("gold"))).toBe(code);
  });

  it("fails on a timeout", async () => {
    expect(errorCode(await xausProvider(neverAnswers, TIMEOUT_MS).fetchSpot("gold"))).toBe("provider_failed");
  });
});

describe("frankfurter.dev", () => {
  it("reads the recorded INR rate and its date", async () => {
    const fetchJson = replay("frankfurter-inr");
    const result = await frankfurterProvider(fetchJson).fetchFx(INR);
    expect(result).toEqual({ ok: true, value: { quote: "INR", rate: "94.04", asOf: "2026-11-14", source: "frankfurter.dev" } });
    expect(fetchJson.urls).toEqual(["https://api.frankfurter.dev/v2/rates?base=USD&quotes=INR"]);
  });

  it.each([
    ["malformed", "invalid_response"],
    ["wrong-currency", "invalid_response"],
    ["out-of-range", "rate_rejected"],
  ] as const)("rejects the %s fixture", async (name, code) => {
    expect(errorCode(await frankfurterProvider(replay(`frankfurter-${name}`)).fetchFx(INR))).toBe(code);
  });

  it("names a currency the provider does not publish", async () => {
    const result = await frankfurterProvider(replay("frankfurter-invalid-currency", 422)).fetchFx(parseCurrency("XXX")!);
    expect(errorCode(result)).toBe("unknown_currency");
    expect(!result.ok && result.error.message).toContain("XXX");
  });

  it("fails on a timeout", async () => {
    expect(errorCode(await frankfurterProvider(neverAnswers, TIMEOUT_MS).fetchFx(INR))).toBe("provider_failed");
  });

  it("fails when the fetch throws", async () => {
    const offline: FetchJson = async () => {
      throw new TypeError("fetch failed");
    };
    expect(errorCode(await frankfurterProvider(offline).fetchFx(INR))).toBe("provider_failed");
  });

  it("encodes the currency as one query value", async () => {
    const fetchJson = replay("frankfurter-inr");
    await frankfurterProvider(fetchJson).fetchFx("INR&quotes=EUR" as Currency);
    expect(fetchJson.urls).toEqual(["https://api.frankfurter.dev/v2/rates?base=USD&quotes=INR%26quotes%3DEUR"]);
  });
});

describe("a fetch that resolves to something other than a response", () => {
  const notAResponse = (body: unknown): FetchJson => async () => body as FetchResponse;

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "<html>"],
    ["an object without a status", { body: {} }],
  ])("fails every provider with provider_failed when the fetch resolves to %s", async (_, value) => {
    const fetchJson = notAResponse(value);
    expect(errorCode(await goldApiProvider(fetchJson).fetchSpot("gold"))).toBe("provider_failed");
    expect(errorCode(await xausProvider(fetchJson).fetchSpot("gold"))).toBe("provider_failed");
    expect(errorCode(await frankfurterProvider(fetchJson).fetchFx(INR))).toBe("provider_failed");
  });
});
