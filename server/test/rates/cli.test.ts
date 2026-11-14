import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const server = fileURLToPath(new URL("../..", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));

function cli(...args: string[]): unknown {
  return JSON.parse(execFileSync(tsx, ["scripts/rates-cli.ts", ...args], { cwd: server, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}

describe("rates-cli --cache-age", () => {
  it("seeds a spot record dated and fetched the given seconds before --now", () => {
    expect(cli("spot", "gold", "--fail", "primary,fallback", "--cache-age", "3600", "--now", "2026-11-11T12:00:00Z")).toMatchObject({
      kind: "stale",
      ageSeconds: 3600,
      quote: { asOf: "2026-11-11T11:00:00.000Z" },
    });
  });

  it("seeds a currency record dated on the day the given seconds before --now", () => {
    expect(cli("fx", "INR", "--fail", "primary", "--cache-age", "7200", "--now", "2026-11-11T12:00:00Z")).toMatchObject({
      kind: "stale",
      ageSeconds: 12 * 3600,
      quote: { asOf: "2026-11-11" },
    });
  });
});
