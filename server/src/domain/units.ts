import { D, parseDecimal } from "./decimal";
import { nearest } from "./nearest";
import { err, ok, type Result } from "./result";

interface UnitDef {
  gramsPerUnit: string;
  label: string;
  source: string;
}

const SI = "SI Brochure, 9th edition (BIPM 2019), section 3: SI prefixes on the gram";
const NIST_HB44 =
  "NIST Handbook 44 (2026), Appendix C: grain = 64.79891 mg exactly; avoirdupois ounce = 437.5 grains; troy ounce = 480 grains; pennyweight = 24 grains";

export const UNITS = {
  g: { gramsPerUnit: "1", label: "gram", source: SI },
  kg: { gramsPerUnit: "1000", label: "kilogram", source: SI },
  mg: { gramsPerUnit: "0.001", label: "milligram", source: SI },
  ozt: { gramsPerUnit: "31.1034768", label: "troy ounce", source: NIST_HB44 },
  oz_av: { gramsPerUnit: "28.349523125", label: "avoirdupois ounce", source: NIST_HB44 },
  dwt: { gramsPerUnit: "1.55517384", label: "pennyweight", source: NIST_HB44 },
  grain: { gramsPerUnit: "0.06479891", label: "grain", source: NIST_HB44 },
  tola: {
    gramsPerUnit: "11.6638038",
    label: "tola",
    source:
      "1 tola = 180 grains = 3/8 troy ounce, fixed at 180 grains by Regulation VII of 1833 (secondary source: https://en.wikipedia.org/wiki/Tola_(unit)); grain per NIST Handbook 44 Appendix C",
  },
  baht_jewellery: {
    gramsPerUnit: "15.16",
    label: "Thai baht for jewellery",
    source:
      "1 baht of ornament gold = 15.16 g, as stated in TDRI, Gold Bullion Market in Thailand (1997), https://tdri.or.th/2012/11/a9-4/",
  },
  baht_bullion: {
    gramsPerUnit: "15.244",
    label: "Thai baht for bullion",
    source: "1 baht of bar gold = 15.244 g, as stated in TDRI, Gold Bullion Market in Thailand (1997), https://tdri.or.th/2012/11/a9-4/",
  },
  tael_hk: {
    gramsPerUnit: "37.429",
    label: "Hong Kong troy tael",
    source: "Chinese Gold & Silver Exchange Society, 99 Tael Gold Contract: 1 tael troy = 37.429 g, https://cgse.com.hk/chines/en/node/12",
  },
  tael_tw: {
    gramsPerUnit: "37.5",
    label: "Taiwan tael",
    source: "Taiwan Futures Exchange, TWD gold futures contract size: 1 tael = 37.5 g, https://www.taifex.com.tw/cht/2/tGF",
  },
} as const satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNITS;

export const AMBIGUOUS_UNITS: Readonly<Record<string, readonly UnitId[]>> = {
  oz: ["oz_av", "ozt"],
  ounce: ["oz_av", "ozt"],
  baht: ["baht_jewellery", "baht_bullion"],
  tael: ["tael_hk", "tael_tw"],
};

const UNIT_IDS = Object.keys(UNITS) as UnitId[];

function isUnitId(text: string): text is UnitId {
  return Object.hasOwn(UNITS, text);
}

export function parseUnit(text: string): Result<UnitId> {
  const key = text.trim().toLowerCase();
  if (isUnitId(key)) return ok(key);
  const options = Object.hasOwn(AMBIGUOUS_UNITS, key) ? AMBIGUOUS_UNITS[key] : undefined;
  if (options) {
    const labels = options.map((id) => `${id} (${UNITS[id].label})`).join(" or ");
    return err("ambiguous_unit", `"${text}" can mean more than one unit.`, `Use ${labels}.`);
  }
  // An ambiguous name is matched but suggested as its unit ids, so every suggestion parses.
  const names = [...UNIT_IDS, ...Object.keys(AMBIGUOUS_UNITS)];
  const close = nearest(key, names, names.length).flatMap((name) => (isUnitId(name) ? [name] : (AMBIGUOUS_UNITS[name] ?? [])));
  const suggested = [...new Set(close)].slice(0, 3);
  return err("unknown_unit", `"${text}" is not a supported unit.`, `Use one of: ${suggested.join(", ")}.`);
}

export function parseWeight(value: string | number): Result<D> {
  const weight = parseDecimal(value);
  if (!weight || weight.lte(0)) {
    return err("invalid_weight", `Weight "${value}" is not a number above zero.`, "Give the weight as a number above zero, such as 12.4.");
  }
  return ok(weight);
}

export function toGrams(value: D, unit: UnitId): D {
  return value.times(UNITS[unit].gramsPerUnit);
}

export function convert(value: D, from: UnitId, to: UnitId): D {
  return toGrams(value, from).div(UNITS[to].gramsPerUnit);
}
