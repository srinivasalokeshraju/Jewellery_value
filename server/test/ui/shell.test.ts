import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildShellModule, SHELL_MODULE } from "../../scripts/build-ui";
import { at, type CardTemplate } from "../../src/tools/card";
import type { ConvertWeightOutput } from "../../src/tools/convertWeight";
import { cardDocument } from "../../src/ui/document";
import { SHELL } from "../../src/ui/shell.generated";
import { parseTemplate } from "../../src/ui/view/fill";

const SERVER = fileURLToPath(new URL("../../", import.meta.url));
const VIEW = `${SERVER}src/ui/view/`;

/** A dependency bump that grows the card this much gets looked at before it ships. */
const BUDGET_BYTES = 720_000;

function templateSlot(document: string): string {
  const open = '<script type="application/json" id="card-template">';
  const start = document.indexOf(open) + open.length;
  return document.slice(start, document.indexOf("</script>", start));
}

describe("the card document", () => {
  it("is fresh: rebuilding src/ui/view/ gives the committed shell", async () => {
    const committed = await readFile(`${SERVER}${SHELL_MODULE}`, "utf8");
    expect(await buildShellModule() === committed, "The view bundle is stale. Run `npm run ui:build` in server/ and commit the result.").toBe(true);
  }, 30_000);

  it(`fits in ${BUDGET_BYTES} bytes`, () => {
    expect(SHELL.before.length + SHELL.after.length).toBeLessThan(BUDGET_BYTES);
  });

  it("carries nothing about the build machine", () => {
    const whole = SHELL.before + SHELL.after;
    expect(whole).not.toContain("sourceMappingURL");
    expect(whole).not.toContain(SERVER);
    expect(whole).not.toMatch(/\/Users\/|\/home\//);
  });

  it("keeps a label with </script> inside the template slot and reads it back unchanged", () => {
    const label = "</script><b>bold</b>";
    const template: CardTemplate<ConvertWeightOutput> = { title: label, blocks: [{ kind: "row", label, text: [at("grams")] }] };
    const slot = templateSlot(cardDocument(template));
    expect(slot).not.toContain("</script");
    expect(slot).not.toContain("<");
    expect(parseTemplate(slot)).toEqual(JSON.parse(JSON.stringify(template)));
  });

  it("loads nothing from the network: no src, link, image, url(), or @import outside the script", () => {
    const html = SHELL.before + SHELL.after;
    const script = html.indexOf('<script type="module">');
    const outside = html.slice(0, script);
    expect(outside).not.toMatch(/\bsrc=|<link|<img|url\(|@import/i);
    expect(html.slice(script)).not.toMatch(/<script[^>]*\bsrc=/i);
  });

  it("holds no view source that parses, rounds, or formats a figure, or writes HTML", async () => {
    const banned = /innerHTML|outerHTML|insertAdjacentHTML|Number\(|parseFloat|parseInt|toFixed|toPrecision|toLocaleString|Intl\.|Math\./;
    const files = (await readdir(VIEW)).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = await readFile(`${VIEW}${name}`, "utf8");
      expect(source, name).not.toMatch(banned);
      if (name !== "fill.ts") expect(source, name).not.toMatch(/as Printed/);
    }
  });
});
