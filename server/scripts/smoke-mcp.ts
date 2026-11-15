import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

type Call = { tool: string; args: Record<string, unknown>; expect: (structured: Record<string, unknown>) => string | undefined };

const EXPECTED_TOOLS = ["calc_melt_value", "convert_weight", "get_metal_rate", "list_supported"];

const CALLS: Call[] = [
  {
    tool: "list_supported",
    args: {},
    expect: (out) => (Array.isArray(out["units"]) ? undefined : "no units array"),
  },
  {
    tool: "convert_weight",
    args: { value: 1, from_unit: "tola", to_unit: "g" },
    expect: (out) => (out["grams"] === "11.6638038" ? undefined : `1 tola gave ${String(out["grams"])} g`),
  },
  {
    tool: "get_metal_rate",
    args: { metal: "gold", country: "US", currency: "USD" },
    expect: (out) => (out["currency"] === "USD" && typeof out["per_gram"] === "string" ? undefined : "no USD per_gram"),
  },
  {
    tool: "get_metal_rate",
    args: { metal: "silver", country: "IN", currency: "INR" },
    expect: (out) => (out["currency"] === "INR" && typeof out["per_gram"] === "string" ? undefined : "no INR per_gram"),
  },
  {
    tool: "calc_melt_value",
    args: { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", currency: "INR", non_metal_weight: 0 },
    expect: (out) => (out["pure_grams"] === "9.17" && out["currency"] === "INR" ? undefined : `pure_grams ${String(out["pure_grams"])}`),
  },
];

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const url = process.argv[2];
if (url === undefined) fail("usage: npx tsx scripts/smoke-mcp.ts <mcp url>");

const client = new Client({ name: "melt-value-smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name).toSorted();
if (names.join() !== EXPECTED_TOOLS.join()) fail(`tools are ${names.join(", ")}`);
for (const tool of tools) {
  if (!tool.title) fail(`${tool.name} has no title`);
  if (tool.annotations?.readOnlyHint !== true) fail(`${tool.name} is not readOnlyHint`);
  const uri = getToolUiResourceUri(tool);
  if (uri === undefined) fail(`${tool.name} has no card`);
  const card = await client.readResource({ uri });
  if (card.contents.length === 0) fail(`${tool.name} card ${uri} is empty`);
  console.log(`ok   ${tool.name}: "${tool.title}", readOnlyHint, card ${uri}`);
}

for (const { tool, args, expect } of CALLS) {
  const result = await client.callTool({ name: tool, arguments: args });
  if (result.isError === true) fail(`${tool} ${JSON.stringify(args)} returned ${JSON.stringify(result.content)}`);
  const problem = expect(result.structuredContent as Record<string, unknown>);
  if (problem !== undefined) fail(`${tool} ${JSON.stringify(args)}: ${problem}`);
  const [first] = result.content as { text: string }[];
  console.log(`ok   ${tool} ${JSON.stringify(args)}\n     ${first?.text.split("\n")[0] ?? ""}`);
}

const refused = await client.callTool({
  name: "calc_melt_value",
  arguments: { metal: "gold", weight: 1, unit: "oz", purity: "22K", country: "US" },
});
const refusal = JSON.stringify(refused.content);
if (refused.isError !== true || !refusal.includes('\\"fix\\"')) fail(`a bare oz was not refused with a fix: ${refusal}`);
console.log("ok   calc_melt_value refuses a bare oz with code, message, and fix");

await client.close();
console.log(`PASS ${url}: ${tools.length} tools listed, ${CALLS.length + 1} calls checked`);
