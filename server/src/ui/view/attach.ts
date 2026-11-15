import type { App } from "@modelcontextprotocol/ext-apps";
import type { WireTemplate } from "../../tools/card";
import { CANCELLED, fill, waiting, type Filled } from "./fill";

/** Sets the App's handlers, so call it before app.connect(). `show` takes the drawing step, so a test can run a real App with no DOM. */
export function attach(app: Pick<App, "addEventListener">, template: WireTemplate, show: (filled: Filled) => void): void {
  show(waiting(template));
  app.addEventListener("toolresult", (result) => show(fill(template, result)));
  app.addEventListener("toolcancelled", () => show({ kind: "text", text: CANCELLED }));
}
