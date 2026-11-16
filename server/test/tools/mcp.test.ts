import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../../src/instructions";
import type { UsageEntry } from "../../src/log";
import { buildServer } from "../../src/server";
import { parseTemplate } from "../../src/ui/view/fill";
import { fakeDeps } from "./fakes";

async function connect() {
  const usage: UsageEntry[] = [];
  const server = buildServer({ ...fakeDeps(), logUsage: (entry) => usage.push(entry) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, usage };
}

function text(result: { content?: unknown }): string {
  const [first] = result.content as { type: string; text: string }[];
  return first!.text;
}

describe("MCP server", () => {
  it("sends the instructions in under 200 words", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS.split(/\s+/).length).toBeLessThan(200);
  });

  it("tells every client to copy figures exactly and to add nothing", async () => {
    const { client } = await connect();
    const sent = client.getInstructions() ?? "";
    expect(sent).toMatch(/exactly as the tool wrote it/);
    expect(sent).toMatch(/Do not round/);
    expect(sent).toMatch(/Add no price, charge, or fact that these tools did not give/);
  });

  it("lists exactly four read-only tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(["calc_melt_value", "convert_weight", "get_metal_rate", "list_supported"]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.title, tool.name).toBe(tool.title);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("describes each tool without instructing the model or naming another tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const tool of tools) {
      const description = tool.description ?? "";
      expect(description, tool.name).not.toMatch(/\b(use it|use|repeat|instead|call|always|never|the person)\b/i);
      for (const other of names.filter((name) => name !== tool.name)) expect(description, tool.name).not.toContain(other);
    }
  });

  it("returns structuredContent and a text summary on success", async () => {
    const { client, usage } = await connect();
    const result = await client.callTool({
      name: "calc_melt_value",
      arguments: { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", city: "Chennai", currency: "INR" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ pure_grams: "9.17", currency: "INR", rates: { spot: { source: "gold-api.com" } } });
    expect(text(result)).toContain("9.17 g of pure gold");
    expect(text(result)).toContain("Warning: No weight was given for stones");
    expect(usage).toEqual([{ tool: "calc_melt_value", country: "IN", city: "Chennai", metal: "gold", latency_ms: 0, error_code: null }]);
  });

  it("names the currency rate's source and date in the text summary, as in structuredContent", async () => {
    const { client } = await connect();
    const calls = [
      {
        name: "calc_melt_value",
        arguments: { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", currency: "INR", non_metal_weight: 0 },
      },
      { name: "get_metal_rate", arguments: { metal: "gold", country: "IN", currency: "INR" } },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      const { rates } = result.structuredContent as { rates: { currency: { pair: string; rate: string; source: string; as_of: string } } };
      expect(rates.currency).toMatchObject({ pair: "USD/INR", rate: "88.5", source: "frankfurter.dev", as_of: "2026-11-11" });
      expect(text(result), call.name).toContain("Converted at 1 USD = 88.5 INR from frankfurter.dev, dated 11 Nov 2026.");
    }
  });

  it("rejects an over-long unit or purity in the schema without echoing it back", async () => {
    const { client, usage } = await connect();
    const long = "q".repeat(65);
    const calls = [
      { name: "calc_melt_value", arguments: { metal: "gold", weight: 1, unit: long, purity: "22K", country: "US" } },
      { name: "calc_melt_value", arguments: { metal: "gold", weight: 1, unit: "g", purity: long, country: "US" } },
      { name: "convert_weight", arguments: { value: 1, from_unit: long, to_unit: "g" } },
      { name: "convert_weight", arguments: { value: 1, from_unit: "g", to_unit: long } },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      expect(result.isError, JSON.stringify(call.arguments)).toBe(true);
      expect(text(result)).toContain("Input validation error");
      expect(text(result)).not.toContain(long);
    }
    expect(usage).toEqual([]);
    const atLimit = await client.callTool({ name: "convert_weight", arguments: { value: 1, from_unit: "q".repeat(64), to_unit: "g" } });
    expect(JSON.parse(text(atLimit))).toMatchObject({ code: "unknown_unit" });
  });

  it("returns isError with the error as JSON text on a domain error", async () => {
    const { client, usage } = await connect();
    const result = await client.callTool({
      name: "calc_melt_value",
      arguments: { metal: "gold", weight: 1, unit: "oz", purity: "22K", country: "US" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ code: "ambiguous_unit", fix: "Use oz_av (avoirdupois ounce) or ozt (troy ounce)." });
    expect(usage.map((entry) => entry.error_code)).toEqual(["ambiguous_unit"]);
  });

  it("returns isError on an input that fails the schema", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "calc_melt_value",
      arguments: { metal: "platinum", weight: 1, unit: "g", purity: "950", country: "US" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Input validation error");
  });

  it("links every tool to its own card, an HTML resource that holds that tool's template", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const uris: string[] = [];
    for (const tool of tools) {
      const uri = getToolUiResourceUri(tool);
      expect(uri, tool.name).toBe(`ui://melt-value/card/${tool.name}.html`);
      uris.push(uri!);
      const { contents } = await client.readResource({ uri: uri! });
      expect(contents, tool.name).toHaveLength(1);
      const [content] = contents as { uri: string; mimeType: string; text: string }[];
      expect(content).toMatchObject({ uri, mimeType: "text/html;profile=mcp-app" });
      const json = /<script type="application\/json" id="card-template">(.*?)<\/script>/s.exec(content!.text)?.[1] ?? "";
      expect(parseTemplate(json)?.title, tool.name).toBe(tool.title);
    }
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).toSorted()).toEqual(uris.toSorted());
  });

  it("adds no key to a call result: text content and structuredContent only, or isError with text", async () => {
    const { client } = await connect();
    const ok = await client.callTool({ name: "convert_weight", arguments: { value: 1, from_unit: "tola", to_unit: "g" } });
    expect(Object.keys(ok).toSorted()).toEqual(["content", "structuredContent"]);
    expect(ok.content).toEqual([{ type: "text", text: "1 tola is 11.6638038 g (11.6638038 g)." }]);
    const failed = await client.callTool({ name: "convert_weight", arguments: { value: 1, from_unit: "stone", to_unit: "g" } });
    expect(Object.keys(failed).toSorted()).toEqual(["content", "isError"]);
  });

  it("logs no weight, purity, or other input in the usage line", async () => {
    const { client, usage } = await connect();
    await client.callTool({ name: "convert_weight", arguments: { value: 1, from_unit: "tola", to_unit: "g" } });
    expect(usage).toEqual([{ tool: "convert_weight", country: null, city: null, metal: null, latency_ms: 0, error_code: null }]);
  });
});
