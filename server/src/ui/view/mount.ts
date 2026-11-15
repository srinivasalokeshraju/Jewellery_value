import { WORDS, type Filled, type FilledBlock, type Printed } from "./fill";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: Printed): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawBlock(block: FilledBlock): HTMLElement {
  switch (block.kind) {
    case "headline": {
      const box = el("div", "headline");
      box.append(el("div", "headline-label", block.label), el("div", "headline-value", block.text));
      return box;
    }
    case "row": {
      const row = el("div", "row");
      row.append(el("dt", undefined, block.label), el("dd", undefined, block.text));
      return row;
    }
    case "note":
      return el("p", "note", block.text);
    case "chips": {
      const box = el("section", "chips");
      box.append(el("h2", undefined, block.label));
      if (block.items.length === 0) {
        box.append(el("p", "note", WORDS.none));
        return box;
      }
      const list = el("ul");
      list.setAttribute("role", "list");
      for (const item of block.items) list.append(el("li", undefined, item));
      box.append(list);
      return box;
    }
    case "table": {
      const wrap = el("div", "table-wrap");
      const table = el("table");
      const head = el("tr");
      for (const label of block.head) head.append(el("th", undefined, label));
      const body = el("tbody");
      for (const cells of block.rows) {
        const row = el("tr");
        for (const cell of cells) row.append(el("td", undefined, cell));
        body.append(row);
      }
      const thead = el("thead");
      thead.append(head);
      table.append(thead, body);
      wrap.append(table);
      return wrap;
    }
  }
}

const GROUPS = { row: ["dl", "rows"], note: ["div", "notes"] } as const;

/** Consecutive rows share one <dl> and consecutive notes one footer, so each run reads as a unit. */
function drawBlocks(blocks: readonly FilledBlock[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  let open: { kind: FilledBlock["kind"]; box: HTMLElement } | undefined;
  for (const block of blocks) {
    if (block.kind !== "row" && block.kind !== "note") {
      open = undefined;
      out.push(drawBlock(block));
      continue;
    }
    if (open?.kind !== block.kind) {
      const [tag, className] = GROUPS[block.kind];
      open = { kind: block.kind, box: el(tag, className) };
      out.push(open.box);
    }
    open.box.append(drawBlock(block));
  }
  return out;
}

function drawWarnings(warnings: readonly Printed[]): HTMLElement {
  const list = el("ul", "warnings");
  list.setAttribute("role", "list");
  for (const message of warnings) {
    const item = el("li");
    item.append(el("strong", undefined, WORDS.warning), el("span", undefined, message));
    list.append(item);
  }
  return list;
}

/** Replaces the children of `root` with the card. createElement and textContent only, and only `Printed` text. */
export function mount(root: HTMLElement, filled: Filled): void {
  const nodes: HTMLElement[] = [];
  switch (filled.kind) {
    case "waiting":
      nodes.push(el("h1", undefined, filled.title), el("p", "status", WORDS.waiting));
      break;
    case "card": {
      // The headline is the answer and the warnings qualify it, so they sit directly under it.
      const lead = filled.blocks[0]?.kind === "headline" ? 1 : 0;
      nodes.push(el("h1", undefined, filled.title), ...drawBlocks(filled.blocks.slice(0, lead)));
      if (filled.warnings.length > 0) nodes.push(drawWarnings(filled.warnings));
      nodes.push(...drawBlocks(filled.blocks.slice(lead)));
      break;
    }
    case "error": {
      const box = el("div", "error");
      box.setAttribute("role", "alert");
      const facts = el("dl", "rows");
      for (const [label, value] of [
        [WORDS.code, filled.code],
        [WORDS.nextStep, filled.fix],
      ] as const) {
        const row = el("div", "row");
        row.append(el("dt", undefined, label), el("dd", undefined, value));
        facts.append(row);
      }
      box.append(el("h1", undefined, WORDS.errorTitle), el("p", "error-message", filled.message), facts);
      nodes.push(box);
      break;
    }
    case "text":
      nodes.push(el("p", "plain", filled.text));
      break;
  }
  root.replaceChildren(...nodes);
}
