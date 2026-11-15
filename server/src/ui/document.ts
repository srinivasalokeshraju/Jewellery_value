import { SHELL } from "./shell.generated";

/** The address of a tool's card, derived from the tool name, so there is no table of addresses. */
export function cardUri(toolName: string): `ui://melt-value/card/${string}.html` {
  return `ui://melt-value/card/${toolName}.html`;
}

/**
 * One tool's card document: the shared view with this tool's template written in as JSON.
 * Every `<` in the JSON is escaped, so no label can close the script element that holds it.
 * It takes a CardTemplate's outer shape only, because inferring `T` back out of a CardTemplate<T> overflows tsc's depth limit.
 */
export function cardDocument(template: { title: string; blocks: readonly unknown[] }): string {
  return SHELL.before + JSON.stringify(template).replaceAll("<", "\\u003c") + SHELL.after;
}
