import { readFileSync } from "node:fs";
import type { FetchJson } from "../../src/rates/types";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

export function replay(name: string, status = 200): FetchJson & { urls: string[] } {
  const urls: string[] = [];
  const fetchJson = async (url: string) => {
    urls.push(url);
    return { status, body: fixture(name) };
  };
  return Object.assign(fetchJson, { urls });
}

export const neverAnswers: FetchJson = () => new Promise(() => {});
