import { D } from "./decimal";
import { nearest } from "./nearest";
import { err, ok, type Result } from "./result";

export type Metal = "gold" | "silver";

export interface Purity {
  fraction: D;
  mark: string;
  basis: "karat" | "fineness" | "percent" | "name";
}

const NAMES: Readonly<Record<string, { fraction: string; metals: readonly Metal[] }>> = {
  sterling: { fraction: "0.925", metals: ["silver"] },
  britannia: { fraction: "0.958", metals: ["silver"] },
  fine: { fraction: "0.999", metals: ["gold", "silver"] },
};

const COMMON_MARKS: Record<Metal, readonly string[]> = {
  gold: ["24K", "22K", "18K", "14K", "10K", "9K", "999", "916", "750", "585", "375", "fine"],
  silver: ["999", "958", "925", "900", "800", "sterling", "britannia", "fine"],
};

const KARAT = /^(\d+)\s*(k|kt|karat)$/;
const PERCENT = /^(\d+(?:\.\d+)?)\s*%$/;
const FINENESS = /^\d+(?:\.\d+)?$/;

function unknown(text: string, metal: Metal, fix?: string): Result<Purity> {
  const close = nearest(text, COMMON_MARKS[metal]);
  return err("unknown_purity", `"${text}" is not a recognised ${metal} purity mark.`, fix ?? `Use one of: ${close.join(", ")}.`);
}

export function parsePurity(text: string, metal: Metal): Result<Purity> {
  const key = text.trim().toLowerCase();

  const karat = KARAT.exec(key);
  if (karat) {
    const value = Number(karat[1]);
    if (metal !== "gold") {
      return err("invalid_purity", `Karat marks apply to gold only, not ${metal}.`, "Give silver purity as fineness, such as 925, or a name, such as sterling.");
    }
    if (value < 1 || value > 24) {
      return err("invalid_purity", `${value}K is outside 1K to 24K.`, "Give a karat from 1 to 24, such as 22K.");
    }
    return ok({ fraction: new D(value).div(24), mark: `${value}K`, basis: "karat" });
  }

  const percent = PERCENT.exec(key);
  if (percent) {
    const value = new D(percent[1]!);
    if (value.lte(0) || value.gt(100)) {
      return err("invalid_purity", `${percent[1]}% is outside 0% to 100%.`, "Give a percent above 0 and at most 100, such as 91.6%.");
    }
    return ok({ fraction: value.div(100), mark: `${value.toFixed()}%`, basis: "percent" });
  }

  if (FINENESS.test(key)) {
    const value = new D(key);
    if (value.gt("999.9")) {
      return err("invalid_purity", `Fineness ${key} is above 999.9.`, "Give fineness in parts per thousand, at most 999.9, such as 916.");
    }
    if (value.lt(100)) {
      return unknown(text, metal, `Write ${key} as a karat (${key}K) or a percent (${key}%), or give fineness in parts per thousand, such as 916.`);
    }
    return ok({ fraction: value.div(1000), mark: value.toFixed(), basis: "fineness" });
  }

  const name = Object.hasOwn(NAMES, key) ? NAMES[key] : undefined;
  if (name) {
    if (!name.metals.includes(metal)) {
      return err("invalid_purity", `"${key}" is a ${name.metals.join(" or ")} purity, not ${metal}.`, `Use one of: ${COMMON_MARKS[metal].join(", ")}.`);
    }
    return ok({ fraction: new D(name.fraction), mark: key, basis: "name" });
  }

  return unknown(text, metal);
}
