import { describe, expect, it } from "vitest";
import { MemoryCache } from "../../src/rates/cache";
import type { WireTemplate } from "../../src/tools/card";
import { calcMeltValue, ESTIMATE_DISCLAIMER, meltCard, summarizeMelt, type CalcMeltValueInput } from "../../src/tools/calcMeltValue";
import { conversionCard, convertWeight, summarizeConversion } from "../../src/tools/convertWeight";
import { getMetalRate, rateCard, summarizeRate } from "../../src/tools/getMetalRate";
import { listSupported, summarizeSupported, supportedCard } from "../../src/tools/listSupported";
import type { ToolResult } from "../../src/tools/rates";
import { fill, parseTemplate, type Filled, type FilledBlock, type ToolResultLike } from "../../src/ui/view/fill";
import { DOWN, fakeDeps, fxProvider, minutesBefore, SATURDAY_NOON, spotProvider, WEDNESDAY_NOON } from "../tools/fakes";

function wire(template: object): WireTemplate {
  const parsed = parseTemplate(JSON.stringify(template));
  if (parsed === undefined) throw new Error("the template did not survive JSON");
  return parsed;
}

const MELT = wire(meltCard);
const RATE = wire(rateCard);
const CONVERSION = wire(conversionCard);
const SUPPORTED = wire(supportedCard);

/** The same shape server.ts builds from a tool result. */
function asCallResult<T>(result: ToolResult<T>, summarize: (value: T) => string): ToolResultLike {
  if (!result.ok) return { isError: true, content: [{ type: "text", text: JSON.stringify(result.error) }] };
  return { content: [{ type: "text", text: summarize(result.value) }], structuredContent: result.value };
}

function card(filled: Filled): Extract<Filled, { kind: "card" }> {
  if (filled.kind !== "card") throw new Error(`expected a card, got ${JSON.stringify(filled)}`);
  return filled;
}

function texts(block: FilledBlock): string[] {
  switch (block.kind) {
    case "headline":
    case "row":
      return [block.label, block.text];
    case "note":
      return [block.text];
    case "chips":
      return [block.label, ...block.items];
    case "table":
      return [...block.head, ...block.rows.flat()];
  }
}

function everyText(filled: Filled): string {
  const { blocks, warnings, title } = card(filled);
  return [title, ...blocks.flatMap(texts), ...warnings].join("\n");
}

const INR: CalcMeltValueInput = { metal: "gold", weight: 10, unit: "g", purity: "22K", country: "IN", currency: "INR", non_metal_weight: 0.5 };

async function melt(input: CalcMeltValueInput = INR, deps = fakeDeps()) {
  return asCallResult(await calcMeltValue(input, deps), summarizeMelt);
}

async function allFour(): Promise<[WireTemplate, ToolResultLike][]> {
  return [
    [MELT, await melt()],
    [RATE, asCallResult(await getMetalRate({ metal: "silver", country: "IN", currency: "INR" }, fakeDeps()), summarizeRate)],
    [CONVERSION, asCallResult(convertWeight({ value: 12.5, from_unit: "tola", to_unit: "g" }), summarizeConversion)],
    [SUPPORTED, asCallResult(listSupported(), summarizeSupported)],
  ];
}

function mapStrings(value: unknown, path: string, change: (path: string) => string): unknown {
  if (typeof value === "string") return change(path);
  if (Array.isArray(value)) return value.map((item, index) => mapStrings(item, `${path}[${index}]`, change));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, path === "" ? key : `${path}.${key}`, change)]));
  }
  return value;
}

/** Every string a card may print from this result: its string leaves, and the numbers the person typed. */
function printable(structured: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, underInputs: boolean) => {
    if (typeof value === "string") out.add(value);
    else if (typeof value === "number" && underInputs) out.add(String(value));
    else if (Array.isArray(value)) value.forEach((item) => walk(item, underInputs));
    else if (typeof value === "object" && value !== null) for (const [key, item] of Object.entries(value)) walk(item, underInputs || key === "inputs");
  };
  walk(structured, false);
  return out;
}

const escape = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("fill on real tool results", () => {
  it("heads the melt card with the spot melt value and currency, copied whole, and shows the buyer offer", async () => {
    const result = await melt();
    const out = result.structuredContent as { spot_melt: { value: string }; currency: string; buyback_low: string; buyback_high: string };
    const { blocks } = card(fill(MELT, result));
    expect(blocks[0]).toEqual({ kind: "headline", label: "Melt value at spot", text: `${out.spot_melt.value} ${out.currency}` });
    expect(blocks).toContainEqual({ kind: "row", label: "Likely buyer offer", text: `${out.buyback_low} to ${out.buyback_high} ${out.currency}` });
  });

  it("shows the same estimate disclaimer the text summary gives", async () => {
    const result = await melt();
    expect(result.content?.[0]?.text).toContain(ESTIMATE_DISCLAIMER);
    expect(card(fill(MELT, result)).blocks).toContainEqual({ kind: "note", text: ESTIMATE_DISCLAIMER });
  });

  const spotCache = (asOf: string) => {
    const cache = new MemoryCache();
    cache.records.set("spot:gold", { quote: { metal: "gold", usdPerTroyOz: "4000", asOf, source: "gold-api.com" }, fetchedAt: asOf });
    return cache;
  };
  const bothDown = { primary: spotProvider("gold-api.com", () => DOWN), fallback: spotProvider("xaus.com", () => DOWN) };
  const fxStale = fxProvider((quote) => ({ ok: true, value: { quote, rate: "88.5", asOf: "2026-11-05", source: "frankfurter.dev" } }));
  const warned: [string, () => Promise<ToolResultLike>][] = [
    ["gross_weight_used and large_weight", () => melt({ metal: "gold", weight: 6000, unit: "g", purity: "22K", country: "US", currency: "USD" })],
    ["spot_stale", () => melt({ ...INR, currency: "USD" }, fakeDeps({ cache: spotCache(minutesBefore(WEDNESDAY_NOON, 30)), ...bothDown }))],
    ["market_closed", () => melt({ ...INR, currency: "USD" }, fakeDeps({ now: SATURDAY_NOON }))],
    ["spot_unverified", () => melt({ ...INR, currency: "USD" }, fakeDeps({ fallback: spotProvider("xaus.com", () => DOWN) }))],
    ["currency_stale and currency_unverified", () => melt(INR, fakeDeps({ fx: fxStale }))],
    ["unknown_currency_usd_used", () => melt({ metal: "gold", weight: 1, unit: "g", purity: "22K", country: "ZZ" })],
  ];

  it.each(warned)("shows every warning, in order and unchanged: %s", async (_name, run) => {
    const result = await run();
    const sent = (result.structuredContent as { warnings: { message: string }[] }).warnings.map((warning) => warning.message);
    expect(sent.length).toBeGreaterThan(0);
    expect(card(fill(MELT, result)).warnings).toEqual(sent);
  });

  it("prints each figure whole: a marker in place of every server string comes back unbroken", async () => {
    for (const [template, result] of await allFour()) {
      const marked = mapStrings(result.structuredContent, "", (path) => `«${path}»`);
      const shown = everyText(fill(template, { ...result, structuredContent: marked }));
      for (const block of template.blocks) {
        const paths = "text" in block ? block.text.flatMap((part) => (typeof part === "string" ? [] : [part.at])) : [];
        for (const path of paths) {
          const found = path.split(".").reduce<unknown>((here, key) => (here as Record<string, unknown> | undefined)?.[key], marked);
          if (typeof found === "string") expect(shown, template.title).toContain(found);
        }
      }
      expect(shown).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("prints nothing a server did not send: each piece between fixed words is a server string or a typed number", async () => {
    for (const [template, result] of await allFour()) {
      const allowed = printable(result.structuredContent);
      const { blocks } = card(fill(template, result));
      const shaped = template.blocks.filter((block) => "text" in block);
      const filledTexts = blocks.flatMap((block) => (block.kind === "headline" || block.kind === "row" || block.kind === "note" ? [block.text] : []));
      for (const text of filledTexts) {
        const matching = shaped.flatMap((block) => {
          const pattern = new RegExp(`^${block.text.map((part) => (typeof part === "string" ? escape(part) : "(.*?)")).join("")}$`, "s");
          const match = pattern.exec(text);
          return match === null ? [] : [match.slice(1)];
        });
        expect(matching.length, text).toBeGreaterThan(0);
        expect(matching.some((pieces) => pieces.every((piece) => allowed.has(piece))), text).toBe(true);
      }
      for (const block of blocks) {
        if (block.kind === "chips") for (const item of block.items) expect(allowed.has(item), item).toBe(true);
        if (block.kind === "table") for (const cell of block.rows.flat()) expect(allowed.has(cell), cell).toBe(true);
      }
    }
  });

  it("leaves out the local estimate and the conversion note, whole, when the server sent neither", async () => {
    const result = await melt({ ...INR, currency: "USD" });
    const { blocks } = card(fill(MELT, result));
    const shown = blocks.flatMap(texts).join("\n");
    expect(shown).not.toContain("Local estimate");
    expect(shown).not.toContain("Converted at");
    expect(blocks[0]?.kind).toBe("headline");
    expect(blocks).toContainEqual({ kind: "note", text: ESTIMATE_DISCLAIMER });
  });

  it("shows the local estimate and its note when the server sent one", async () => {
    const result = await melt();
    const structured = {
      ...(result.structuredContent as object),
      local_estimate: { value: "99000.00", currency: "INR", label: "estimated", note: "Includes duty and tax.", source: { url: "https://example.org", retrieved: "2026-11-01" } },
    };
    const { blocks } = card(fill(MELT, { ...result, structuredContent: structured }));
    expect(blocks).toContainEqual({ kind: "row", label: "Local estimate", text: "99000.00 INR (estimated)" });
    expect(blocks).toContainEqual({ kind: "note", text: "Includes duty and tax." });
    expect(blocks).toContainEqual({ kind: "note", text: "Converted at USD/INR 88.5 from frankfurter.dev, dated 2026-11-11." });
  });

  it.each([
    ["unknown_unit", () => asCallResult(convertWeight({ value: 1, from_unit: "stone", to_unit: "g" }), summarizeConversion)],
    ["rate_unavailable", async () => asCallResult(await getMetalRate({ metal: "gold", country: "US" }, fakeDeps(bothDown)), summarizeRate)],
  ] as const)("shows a %s error with its code, message, and fix unchanged", async (code, run) => {
    const result = await run();
    const sent = JSON.parse(result.content?.[0]?.text ?? "") as { code: string; message: string; fix: string };
    expect(sent.code).toBe(code);
    expect(fill(RATE, result)).toEqual({ kind: "error", code: sent.code, message: sent.message, fix: sent.fix });
  });

  it("shows the SDK's plain-text schema rejection unchanged", () => {
    const text = "MCP error -32602: Input validation error: Invalid arguments for tool convert_weight";
    expect(fill(CONVERSION, { isError: true, content: [{ type: "text", text }] })).toEqual({ kind: "text", text });
  });

  it("falls back to the server's text, never a card with a hole, when a required field is missing", async () => {
    const result = await melt();
    const { pure_grams: _gone, ...rest } = result.structuredContent as Record<string, unknown>;
    expect(fill(MELT, { ...result, structuredContent: rest })).toEqual({ kind: "text", text: result.content?.[0]?.text });
  });

  it("falls back to the server's text when a pointed-at figure arrives as a number, not a string", async () => {
    const result = await melt();
    const structured = result.structuredContent as { spot_melt: object };
    const broken = { ...structured, spot_melt: { ...structured.spot_melt, value: 104329.17 } };
    expect(fill(MELT, { ...result, structuredContent: broken })).toEqual({ kind: "text", text: result.content?.[0]?.text });
  });

  it("falls back to the server's text when a warning has no message, so no warning is dropped", async () => {
    const result = await melt();
    const broken = { ...(result.structuredContent as object), warnings: [{ code: "spot_stale" }] };
    expect(fill(MELT, { ...result, structuredContent: broken })).toEqual({ kind: "text", text: result.content?.[0]?.text });
  });

  it("lists one table row per unit with grams per unit unchanged, and every purity mark as a chip", () => {
    const result = asCallResult(listSupported(), summarizeSupported);
    const out = result.structuredContent as { units: { id: string; label: string; grams_per_unit: string }[]; purity_marks: { gold: string[]; silver: string[] } };
    const { blocks } = card(fill(SUPPORTED, result));
    expect(blocks[0]).toEqual({ kind: "table", head: ["Unit", "Name", "Grams per unit"], rows: out.units.map((unit) => [unit.id, unit.label, unit.grams_per_unit]) });
    expect(blocks).toContainEqual({ kind: "chips", label: "Gold marks", items: out.purity_marks.gold });
    expect(blocks).toContainEqual({ kind: "chips", label: "Silver marks", items: out.purity_marks.silver });
  });

  it("keeps markup in a server string as the same characters", () => {
    const unit = "<script>alert(1)</script>";
    const result = { content: [{ type: "text", text: "x" }], structuredContent: { value: "1", grams: "1", inputs: { value: 1, from_unit: unit, to_unit: "g" } } };
    expect(card(fill(CONVERSION, result)).blocks).toContainEqual({ kind: "row", label: "From", text: `1 ${unit}` });
  });
});

describe("templates", () => {
  it("hold no digit in any fixed word, so no figure hides in a template", () => {
    for (const template of [MELT, RATE, CONVERSION, SUPPORTED]) {
      const fixed = [
        template.title,
        ...template.blocks.flatMap((block) => [
          ..."label" in block ? [block.label] : [],
          ..."text" in block ? block.text.filter((part) => typeof part === "string") : [],
          ...block.kind === "table" ? block.columns.map((column) => column.label) : [],
        ]),
      ];
      for (const words of fixed) expect(words, template.title).not.toMatch(/\d/);
    }
  });
});
