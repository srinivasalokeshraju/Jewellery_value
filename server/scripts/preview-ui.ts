// Writes .preview/index.html: every card scenario, fed by the real tools on the fake rates in test/tools/fakes.ts.
// No deploy, no host, no network. Open the printed path in a browser. Add ?theme=dark or ?width=375 to the URL.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MemoryCache } from "../src/rates/cache";
import { buildServer } from "../src/server";
import { DOWN, fakeDeps, minutesBefore, SATURDAY_NOON, spotProvider, WEDNESDAY_NOON } from "../test/tools/fakes";

const SERVER = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${SERVER}.preview/`;

interface Scenario {
  label: string;
  tool: "get_metal_rate" | "convert_weight" | "calc_melt_value" | "list_supported";
  arguments: Record<string, unknown>;
  fakes?: Parameters<typeof fakeDeps>[0];
}

const bothDown = { primary: spotProvider("gold-api.com", () => DOWN), fallback: spotProvider("xaus.com", () => DOWN) };

function oldSpot(minutes: number): MemoryCache {
  const cache = new MemoryCache();
  const asOf = minutesBefore(WEDNESDAY_NOON, minutes);
  cache.records.set("spot:gold", { quote: { metal: "gold", usdPerTroyOz: "4000", asOf, source: "gold-api.com" }, fetchedAt: asOf });
  return cache;
}

const ring = { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", currency: "INR", non_metal_weight: 0.5 };

const SCENARIOS: Scenario[] = [
  { label: "Melt value, rupees, with a currency conversion", tool: "calc_melt_value", arguments: ring },
  {
    label: "Melt value, no stone weight and over 5 kg",
    tool: "calc_melt_value",
    arguments: { metal: "silver", weight: 6000, unit: "g", purity: "sterling", country: "US", currency: "USD" },
  },
  {
    label: "Melt value on a stale spot price",
    tool: "calc_melt_value",
    arguments: { ...ring, currency: "USD" },
    fakes: { cache: oldSpot(30), ...bothDown },
  },
  {
    label: "Melt value with the market closed",
    tool: "calc_melt_value",
    arguments: { ...ring, currency: "USD" },
    fakes: { now: SATURDAY_NOON },
  },
  {
    label: "Melt value with no currency given",
    tool: "calc_melt_value",
    arguments: { metal: "gold", weight: 1, unit: "tola", purity: "916", country: "ZZ" },
  },
  {
    label: "Melt value, ambiguous unit (tool error)",
    tool: "calc_melt_value",
    arguments: { metal: "gold", weight: 1, unit: "oz", purity: "22K", country: "US" },
  },
  { label: "Melt value, rate unavailable (tool error)", tool: "calc_melt_value", arguments: ring, fakes: bothDown },
  { label: "Metal rate, silver in rupees", tool: "get_metal_rate", arguments: { metal: "silver", country: "IN", currency: "INR" } },
  { label: "Convert weight, tola to grams", tool: "convert_weight", arguments: { value: 12.5, from_unit: "tola", to_unit: "g" } },
  {
    label: "Convert weight, over-long unit (schema rejection, plain text)",
    tool: "convert_weight",
    arguments: { value: 1, from_unit: "q".repeat(65), to_unit: "g" },
  },
  { label: "Supported units and marks", tool: "list_supported", arguments: {} },
];

async function run(scenario: Scenario) {
  const server = buildServer({ ...fakeDeps(scenario.fakes), logUsage: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "preview", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  const uri = getToolUiResourceUri(tools.find((tool) => tool.name === scenario.tool) ?? {});
  if (uri === undefined) throw new Error(`${scenario.tool} has no card.`);
  const [content] = (await client.readResource({ uri })).contents as { text: string }[];
  const result = await client.callTool({ name: scenario.tool, arguments: scenario.arguments });
  await client.close();
  return { label: scenario.label, html: content!.text, arguments: scenario.arguments, result };
}

const scenarios = [];
for (const scenario of SCENARIOS) scenarios.push(await run(scenario));

const host = await build({
  absWorkingDir: SERVER,
  entryPoints: ["scripts/preview-host.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  write: false,
  logLevel: "silent",
});
const script = host.outputFiles[0]!.text;
if (/<\/script/i.test(script)) throw new Error("The preview host bundle holds </script.");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Melt value cards</title>
<style>
body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: #eef0f3; color: #1f2328; }
body[data-theme="dark"] { background: #0b0d10; color: #e6edf3; }
header { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.grid { display: flex; flex-direction: column; gap: 20px; }
figure { margin: 0; }
figcaption { margin-bottom: 6px; font-weight: 600; }
iframe { display: block; border: 1px solid #c8ccd1; border-radius: 10px; width: var(--card-width, 560px); max-width: 100%; height: 120px; background: transparent; }
body[data-theme="dark"] iframe { border-color: #30363d; }
</style>
</head>
<body>
<header><strong>Melt value cards</strong><button id="theme" type="button">Switch theme</button><button id="width" type="button">Switch width</button></header>
<div class="grid" id="cards"></div>
<script type="application/json" id="scenarios">${JSON.stringify(scenarios).replaceAll("<", "\\u003c")}</script>
<script type="module">${script}</script>
</body>
</html>
`;

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}index.html`, page);
console.log(`${OUT}index.html (${scenarios.length} scenarios)`);
