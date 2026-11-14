import { performance } from "node:perf_hooks";
import { D } from "../src/domain/decimal";
import { calcMelt, type MeltInput } from "../src/domain/melt";
import { parseCurrency } from "../src/domain/money";

const RUNS = 10_000;
const WARMUP = 1_000;
const USD = parseCurrency("USD")!;
const JPY = parseCurrency("JPY")!;

const SHAPES: Omit<MeltInput, "weight">[] = [
  { metal: "gold", unit: "g", purity: "24K", rate: { perTroyOz: new D(4000), currency: USD } },
  { metal: "gold", unit: "tola", purity: "22K", nonMetalWeight: "0.1", rate: { perTroyOz: new D(4000), currency: USD } },
  { metal: "silver", unit: "ozt", purity: "999", rate: { perTroyOz: new D(50), currency: USD } },
  { metal: "silver", unit: "g", purity: "sterling", nonMetalWeight: "0.5", rate: { perTroyOz: new D(50), currency: USD } },
  { metal: "gold", unit: "dwt", purity: "14k", rate: { perTroyOz: new D(600000), currency: JPY } },
  { metal: "gold", unit: "baht_jewellery", purity: "91.6%", rate: { perTroyOz: new D(4000), currency: USD } },
];

const inputs: MeltInput[] = Array.from({ length: RUNS }, (_, i) => ({
  ...SHAPES[i % SHAPES.length]!,
  weight: (1 + (i % 997) / 10).toFixed(1),
}));

let failures = 0;
for (let i = 0; i < WARMUP; i++) calcMelt(inputs[i]!);
const start = performance.now();
for (const input of inputs) if (!calcMelt(input).ok) failures++;
const elapsedMs = performance.now() - start;

console.log(JSON.stringify({ meanMicros: Number(((elapsedMs * 1000) / RUNS).toFixed(2)), runs: RUNS, warmup: WARMUP, failures }));
