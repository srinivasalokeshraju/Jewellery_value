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
        "Returns the spot price of pure gold or silver per gram and per troy ounce. The currency input sets the currency. Values are in US dollars when it is absent or when no exchange rate is published for it. Each rate carries its source, time, and freshness, and the result lists any warnings.",
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
      description: "Converts a weight between supported units, such as tola to grams.",
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
        "Computes the melt value of a gold or silver piece from its weight, unit, and purity at the spot price. It accepts any supported unit and fetches the rate itself. The currency input sets the currency. Values are in US dollars when it is absent or when no exchange rate is published for it. It returns the pure metal mass, the melt value, a likely buyer offer of 70 to 95 percent of melt, the source and time of each rate, any warnings, and the inputs.",
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
      description: "Lists the supported weight units, purity marks and forms, and the countries with a local rate estimate.",
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
