// Browser code for the preview page. It plays the chat host: one sandboxed iframe and one AppBridge per scenario.
import type { CallToolResult } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface Scenario {
  label: string;
  html: string;
  arguments: Record<string, unknown>;
  result: CallToolResult;
}

type Theme = "light" | "dark";

const params = new URLSearchParams(location.search);
let theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
let narrow = params.get("width") === "375";
const scenarios = JSON.parse(document.getElementById("scenarios")!.textContent) as Scenario[];
const bridges: AppBridge[] = [];

function applyPage(): void {
  document.body.dataset["theme"] = theme;
  document.body.style.setProperty("--card-width", narrow ? "375px" : "560px");
}

async function show(scenario: Scenario): Promise<void> {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = scenario.label;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.title = scenario.label;
  figure.append(caption, frame);
  document.getElementById("cards")!.append(figure);

  const bridge = new AppBridge(null, { name: "melt-value-preview", version: "0" }, {}, { hostContext: { theme, platform: "web" } });
  bridges.push(bridge);
  bridge.addEventListener("initialized", () => {
    void bridge.sendToolInput({ arguments: scenario.arguments }).then(() => bridge.sendToolResult(scenario.result));
  });
  bridge.addEventListener("sizechange", ({ height }) => {
    if (height !== undefined) frame.style.height = `${height}px`;
  });
  // Listen before the document loads, so the view's first message is not lost. The window proxy survives the srcdoc navigation.
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = scenario.html;
}

document.getElementById("theme")!.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  applyPage();
  for (const bridge of bridges) bridge.setHostContext({ theme, platform: "web" });
});
document.getElementById("width")!.addEventListener("click", () => {
  narrow = !narrow;
  applyPage();
});

applyPage();
for (const scenario of scenarios) await show(scenario);
