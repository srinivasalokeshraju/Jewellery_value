import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  PostMessageTransport,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-with-deps";
import { attach } from "./attach";
import { parseTemplate, UNREADABLE } from "./fill";
import { mount } from "./mount";

const root = document.getElementById("card")!;
const template = parseTemplate(document.getElementById("card-template")?.textContent ?? "");

// Host fonts are not applied: host font CSS may load from the network, and the card loads nothing.
function theme(context: Partial<McpUiHostContext> | undefined): void {
  if (context?.theme !== undefined) applyDocumentTheme(context.theme);
  if (context?.styles?.variables !== undefined) applyHostStyleVariables(context.styles.variables);
}

if (template === undefined) {
  mount(root, { kind: "text", text: UNREADABLE });
} else {
  const app = new App({ name: "melt-value-card", version: "0.1.0" });
  attach(app, template, (filled) => mount(root, filled));
  app.addEventListener("hostcontextchanged", theme);
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  theme(app.getHostContext());
}
