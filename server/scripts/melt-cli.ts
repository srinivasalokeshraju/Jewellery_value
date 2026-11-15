import { parseArgs } from "node:util";
import { parseDecimal } from "../src/domain/decimal";
import { calcMelt } from "../src/domain/melt";
import { parseCurrency } from "../src/domain/money";
import type { Result } from "../src/domain/result";
import { convert, parseUnit, parseWeight, toGrams } from "../src/domain/units";

const USAGE = `Usage:
  melt-cli --metal gold|silver --weight <n> --unit <id> --purity <mark> [--non-metal <n>] --rate <per troy oz> --currency <ISO code>
  melt-cli convert <value> <from> <to>`;

function usage(problem: string): never {
  console.error(`${problem}\n${USAGE}`);
  process.exit(1);
}

function print<T>(result: Result<T>): void {
  if (result.ok) {
    console.log(JSON.stringify(result.value));
    return;
  }
  console.log(JSON.stringify({ error: result.error }));
  process.exitCode = 2;
}

function runConvert([value, from, to]: string[]): void {
  if (value === undefined || from === undefined || to === undefined) usage("convert needs <value> <from> <to>.");
  const amount = parseWeight(value);
  if (!amount.ok) return print(amount);
  const fromUnit = parseUnit(from);
  if (!fromUnit.ok) return print(fromUnit);
  const toUnit = parseUnit(to);
  if (!toUnit.ok) return print(toUnit);
  print({
    ok: true,
    value: {
      value: convert(amount.value, fromUnit.value, toUnit.value).toSignificantDigits(20).toFixed(),
      unit: toUnit.value,
      grams: toGrams(amount.value, fromUnit.value).toSignificantDigits(20).toFixed(),
    },
  });
}

function runMelt(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      metal: { type: "string" },
      weight: { type: "string" },
      unit: { type: "string" },
      purity: { type: "string" },
      "non-metal": { type: "string" },
      rate: { type: "string" },
      currency: { type: "string" },
    },
  });
  const { metal, weight, unit, purity, rate, currency } = values;
  if (metal !== "gold" && metal !== "silver") usage("--metal must be gold or silver.");
  if (weight === undefined || unit === undefined || purity === undefined) usage("--weight, --unit, and --purity are required.");
  const perTroyOz = parseDecimal(rate ?? "");
  if (!perTroyOz || perTroyOz.lte(0)) usage("--rate must be a number above zero.");
  const code = parseCurrency(currency ?? "");
  if (!code) usage("--currency must be a three-letter ISO 4217 code.");
  const nonMetal = values["non-metal"];
  print(
    calcMelt({
      metal,
      weight,
      unit,
      purity,
      ...(nonMetal === undefined ? {} : { nonMetalWeight: nonMetal }),
      rate: { perTroyOz, currency: code },
    }),
  );
}

const [first, ...rest] = process.argv.slice(2);
if (first === "convert") runConvert(rest);
else runMelt(process.argv.slice(2));
