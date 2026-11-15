import { InMemoryTransport } from "@modelcontextprotocol/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it } from "vitest";
import { conversionCard, convertWeight, summarizeConversion } from "../../src/tools/convertWeight";
import { attach } from "../../src/ui/view/attach";
import { fill, parseTemplate, type Filled } from "../../src/ui/view/fill";

const template = parseTemplate(JSON.stringify(conversionCard))!;

async function connected() {
  const shown: Filled[] = [];
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(null, { name: "test-host", version: "0" }, {});
  const app = new App({ name: "melt-value-card", version: "0" }, {}, { autoResize: false });
  attach(app, template, (filled) => shown.push(filled));
  const ready = new Promise<void>((resolve) => {
    bridge.addEventListener("initialized", () => resolve());
  });
  await bridge.connect(hostSide);
  await app.connect(viewSide);
  await ready;
  return { bridge, shown };
}

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("attach with a real App and AppBridge", () => {
  it("shows waiting first, then the filled card for the host's tool result", async () => {
    const { bridge, shown } = await connected();
    expect(shown).toEqual([{ kind: "waiting", title: "Convert weight" }]);
    const output = convertWeight({ value: 1, from_unit: "tola", to_unit: "g" });
    if (!output.ok) throw new Error("conversion failed");
    const result = { content: [{ type: "text" as const, text: summarizeConversion(output.value) }], structuredContent: output.value };
    await bridge.sendToolResult(result);
    await until(() => shown.length > 1);
    expect(shown[1]).toEqual(fill(template, result));
    expect(shown[1]?.kind).toBe("card");
  });

  it("shows the cancelled line when the host cancels the call", async () => {
    const { bridge, shown } = await connected();
    await bridge.sendToolCancelled({ reason: "The person stopped it." });
    await until(() => shown.length > 1);
    expect(shown[1]).toEqual({ kind: "text", text: "The tool call was cancelled." });
  });
});
