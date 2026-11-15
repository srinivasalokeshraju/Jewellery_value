import type { WireBlock, WireTemplate, WireText } from "../../tools/card";

/** What the host hands the view. The useful part of a CallToolResult. */
export interface ToolResultLike {
  isError?: boolean | undefined;
  content?: readonly { type: string; text?: string }[] | undefined;
  structuredContent?: unknown;
}

declare const printed: unique symbol;

/**
 * Text allowed on screen. Only this file makes one, in three ways: a template's fixed words, a server
 * string copied whole, or String(n) of a number the person typed, echoed under `inputs`. `mount` accepts nothing else.
 */
export type Printed = string & { readonly [printed]: true };

export type FilledBlock =
  | { kind: "headline" | "row"; label: Printed; text: Printed }
  | { kind: "note"; text: Printed }
  | { kind: "chips"; label: Printed; items: readonly Printed[] }
  | { kind: "table"; head: readonly Printed[]; rows: readonly (readonly Printed[])[] };

export type Filled =
  /** Before the result arrives. */
  | { kind: "waiting"; title: Printed }
  /** A success. Every warning the server sent is in `warnings`, in the server's order. */
  | { kind: "card"; title: Printed; blocks: readonly FilledBlock[]; warnings: readonly Printed[] }
  /** A tool error with all three parts. */
  | { kind: "error"; code: Printed; message: Printed; fix: Printed }
  /** Anything else: the server's own text, whole and unchanged. The view never shows half a card. */
  | { kind: "text"; text: Printed };

const print = (words: string): Printed => words as Printed;

export const CANCELLED = print("The tool call was cancelled.");
export const UNREADABLE = print("The card could not be shown.");
const NO_TEXT = print("The result could not be shown.");

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function find(root: unknown, path: string): unknown {
  let here = root;
  for (const key of path.split(".")) {
    if (!isPlain(here) || !Object.hasOwn(here, key)) return undefined;
    here = here[key];
  }
  return here;
}

/** The one road from a value to text. A string is copied whole. A number is printed only when the person typed it. */
function leaf(root: unknown, path: string): Printed | undefined {
  const value = find(root, path);
  if (typeof value === "string") return print(value);
  if (typeof value === "number" && path.startsWith("inputs.")) return print(String(value));
  return undefined;
}

function join(root: unknown, text: WireText): Printed | undefined {
  let out = "";
  for (const part of text) {
    if (typeof part === "string") {
      out += part;
      continue;
    }
    const found = leaf(root, part.at);
    if (found === undefined) return undefined;
    out += found;
  }
  return print(out);
}

function strings(value: unknown): Printed[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value.map(print);
}

const MISSING = Symbol("missing");
const SKIP = Symbol("skip");

function fillBlock(root: Plain, block: WireBlock): FilledBlock | typeof MISSING | typeof SKIP {
  switch (block.kind) {
    case "headline":
    case "row": {
      const text = join(root, block.text);
      return text === undefined ? MISSING : { kind: block.kind, label: print(block.label), text };
    }
    case "row_if_present": {
      const text = join(root, block.text);
      return text === undefined ? SKIP : { kind: "row", label: print(block.label), text };
    }
    case "note": {
      const text = join(root, block.text);
      return text === undefined ? SKIP : { kind: "note", text };
    }
    case "chips": {
      const items = strings(find(root, block.each));
      return items === undefined ? MISSING : { kind: "chips", label: print(block.label), items };
    }
    case "table": {
      const list = find(root, block.each);
      if (!Array.isArray(list)) return MISSING;
      const rows: Printed[][] = [];
      for (const item of list) {
        const row: Printed[] = [];
        for (const column of block.columns) {
          const value = find(item, column.at);
          if (typeof value !== "string") return MISSING;
          row.push(print(value));
        }
        rows.push(row);
      }
      return { kind: "table", head: block.columns.map((column) => print(column.label)), rows };
    }
  }
}

function serverText(result: ToolResultLike): Filled {
  const texts = (result.content ?? []).flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []));
  return { kind: "text", text: texts.length > 0 ? print(texts.join("\n")) : NO_TEXT };
}

function toolError(result: ToolResultLike): Filled {
  const [first] = result.content ?? [];
  if (first?.type !== "text" || typeof first.text !== "string") return serverText(result);
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    return serverText(result);
  }
  if (!isPlain(parsed)) return serverText(result);
  const { code, message, fix } = parsed;
  if (typeof code !== "string" || typeof message !== "string" || typeof fix !== "string") return serverText(result);
  return { kind: "error", code: print(code), message: print(message), fix: print(fix) };
}

function warningsOf(root: Plain): Printed[] | undefined {
  if (!Object.hasOwn(root, "warnings")) return [];
  const list = root["warnings"];
  if (!Array.isArray(list)) return undefined;
  const out: Printed[] = [];
  for (const warning of list) {
    const message = find(warning, "message");
    if (typeof message !== "string") return undefined;
    out.push(print(message));
  }
  return out;
}

export function waiting(template: WireTemplate): Filled {
  return { kind: "waiting", title: print(template.title) };
}

/** Total. Never throws, and never returns a card with a hole in it: a required pointer that finds nothing gives the server's text. */
export function fill(template: WireTemplate, result: ToolResultLike): Filled {
  if (result.isError === true) return toolError(result);
  const root = result.structuredContent;
  if (!isPlain(root)) return serverText(result);
  const warnings = warningsOf(root);
  if (warnings === undefined) return serverText(result);
  const blocks: FilledBlock[] = [];
  for (const block of template.blocks) {
    const filled = fillBlock(root, block);
    if (filled === MISSING) return serverText(result);
    if (filled !== SKIP) blocks.push(filled);
  }
  return { kind: "card", title: print(template.title), blocks, warnings };
}

function isText(value: unknown): value is WireText {
  return Array.isArray(value) && value.every((part) => typeof part === "string" || (isPlain(part) && typeof part["at"] === "string"));
}

function isBlock(value: unknown): value is WireBlock {
  if (!isPlain(value)) return false;
  switch (value["kind"]) {
    case "headline":
    case "row":
    case "row_if_present":
      return typeof value["label"] === "string" && isText(value["text"]);
    case "note":
      return isText(value["text"]);
    case "chips":
      return typeof value["label"] === "string" && typeof value["each"] === "string";
    case "table": {
      const columns = value["columns"];
      return (
        typeof value["each"] === "string" &&
        Array.isArray(columns) &&
        columns.every((column) => isPlain(column) && typeof column["label"] === "string" && typeof column["at"] === "string")
      );
    }
    default:
      return false;
  }
}

/** Reads the template JSON from the document. Anything of the wrong shape, including an unknown block kind, gives undefined. */
export function parseTemplate(json: string): WireTemplate | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isPlain(parsed)) return undefined;
  const { title, blocks } = parsed;
  if (typeof title !== "string" || !Array.isArray(blocks) || !blocks.every(isBlock)) return undefined;
  return { title, blocks };
}
