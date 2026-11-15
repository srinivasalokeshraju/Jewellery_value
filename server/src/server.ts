import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { INSTRUCTIONS } from "./instructions";
import type { UsageEntry } from "./log";
import { calcMeltValue, calcMeltValueInput, calcMeltValueOutput, meltCard, summarizeMelt } from "./tools/calcMeltValue";
import type { CardTemplate } from "./tools/card";
import { conversionCard, convertWeight, convertWeightInput, convertWeightOutput, summarizeConversion } from "./tools/convertWeight";
import { getMetalRate, getMetalRateInput, getMetalRateOutput, rateCard, summarizeRate } from "./tools/getMetalRate";
import { listSupported, listSupportedInput, listSupportedOutput, summarizeSupported, supportedCard } from "./tools/listSupported";
import type { ToolDeps, ToolResult } from "./tools/rates";
import { cardDocument, cardUri } from "./ui/document";

export interface ServerDeps extends ToolDeps {
  logUsage: (entry: UsageEntry) => void;
}

interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  run: (input: z.infer<I>, deps: ToolDeps) => ToolResult<z.infer<O>> | Promise<ToolResult<z.infer<O>>>;
  summarize: (output: z.infer<O>) => string;
  /** Required, so the tool list is the card list. Its pointers are checked against this tool's output type. */
  card: CardTemplate<z.infer<O>>;
}

function field(input: object, name: "country" | "city" | "metal"): string | null {
  const value: unknown = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

function register<I extends z.ZodObject, O extends z.ZodObject>(server: McpServer, spec: ToolSpec<I, O>, deps: ServerDeps): void {
  const { name, title, description, card } = spec;
  const inputSchema: z.ZodObject = spec.inputSchema;
  const outputSchema: z.ZodObject = spec.outputSchema;
  const resourceUri = cardUri(name);
  // The document is built per read, not at registration: index.ts builds a server per request, and most requests read no card.
  // No `_meta.ui.csp` on the resource: an absent CSP means the card may load nothing from the network.
  registerAppResource(server, title, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: cardDocument(card) }],
  }));
  const config = {
    title,
    description,
    inputSchema,
    outputSchema,
    annotations: { title, readOnlyHint: true },
    _meta: { ui: { resourceUri } },
  };
  registerAppTool(server, name, config, async (args): Promise<CallToolResult> => {
    const input = args as z.infer<I>;
    const started = deps.now().getTime();
    const result = await spec.run(input, deps);
    deps.logUsage({
      tool: name,
      country: field(input, "country"),
      city: field(input, "city"),
      metal: field(input, "metal"),
      latency_ms: deps.now().getTime() - started,
      error_code: result.ok ? null : result.error.code,
    });
    if (!result.ok) return { isError: true, content: [{ type: "text", text: JSON.stringify(result.error) }] };
    return { content: [{ type: "text", text: spec.summarize(result.value) }], structuredContent: result.value };
  });
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "melt-value", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  // The type arguments are explicit: inferring them through the card's path types overflows tsc's depth limit.
  register<typeof getMetalRateInput, typeof getMetalRateOutput>(
    server,
    {
      name: "get_metal_rate",
      title: "Metal rate",
      description:
        "Get the spot price of pure gold or silver per gram and per troy ounce. Use it when the person asks what gold or silver costs now. The currency input sets the currency. Values are in US dollars when it is absent or when no exchange rate is published for it. Each rate carries its source, time, and freshness. To value a piece, use calc_melt_value instead. Repeat every warning to the person.",
      inputSchema: getMetalRateInput,
      outputSchema: getMetalRateOutput,
      run: getMetalRate,
      summarize: summarizeRate,
      card: rateCard,
    },
    deps,
  );
  register<typeof convertWeightInput, typeof convertWeightOutput>(
    server,
    {
      name: "convert_weight",
      title: "Convert weight",
      description:
        "Convert a weight between supported units, such as tola to grams. Use it when the person wants a weight in another unit, instead of converting by hand. calc_melt_value takes any supported unit, so it needs no conversion first.",
      inputSchema: convertWeightInput,
      outputSchema: convertWeightOutput,
      run: convertWeight,
      summarize: summarizeConversion,
      card: conversionCard,
    },
    deps,
  );
  register<typeof calcMeltValueInput, typeof calcMeltValueOutput>(
    server,
    {
      name: "calc_melt_value",
      title: "Melt value",
      description:
        "Compute the melt value of a gold or silver piece from its weight, unit, and purity at the spot price. Use it when the person wants to know what a piece is worth for its metal. The currency input sets the currency. Values are in US dollars when it is absent or when no exchange rate is published for it. It fetches the rate itself, so one call gives the answer. It returns the pure metal mass, the melt value, a likely buyer offer of 70 to 95 percent of melt, the source and time of each rate, warnings to repeat to the person, and the inputs.",
      inputSchema: calcMeltValueInput,
      outputSchema: calcMeltValueOutput,
      run: calcMeltValue,
      summarize: summarizeMelt,
      card: meltCard,
    },
    deps,
  );
  register<typeof listSupportedInput, typeof listSupportedOutput>(
    server,
    {
      name: "list_supported",
      title: "Supported units and marks",
      description:
        "List the supported weight units, purity marks and forms, and the countries with a local rate estimate. Use it when a unit or purity is rejected, or to check which unit or mark the person's words match.",
      inputSchema: listSupportedInput,
      outputSchema: listSupportedOutput,
      run: listSupported,
      summarize: summarizeSupported,
      card: supportedCard,
    },
    deps,
  );
  return server;
}
