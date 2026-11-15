# server/AGENTS.md

The melt-value MCP server. It is a Cloudflare Worker that serves four read-only tools: `get_metal_rate`, `convert_weight`, `calc_melt_value`, and `list_supported`. Each tool links to a card, an MCP Apps `ui://` HTML resource that a host can show in place of the text result.

## Layers

Each layer imports only from the layers above it in this list.

| Layer | Path | Holds | May not |
|---|---|---|---|
| Domain | `src/domain/` | units, purity, melt math, money rounding | do I/O, read a clock, or import platform code |
| Rates | `src/rates/` | provider adapters, validation, cache, fallback chain | know about MCP or tools |
| Tools | `src/tools/` | one file per tool, input and output schemas, warnings, card templates | call `fetch` directly |
| Wiring | `src/server.ts`, `src/index.ts`, `src/ui/document.ts` | tool and card registration, rate limit, body and batch limits, cron refresh, usage log | hold business logic |
| View | `src/ui/view/` | browser code that draws a card from a tool result | compute, parse, round, or reformat a figure; write HTML as a string; load from the network; import anything but itself, `@modelcontextprotocol/ext-apps`, and types from `src/tools/card.ts` |

The View runs in the host's iframe, not in the Worker. `npm run ui:build` bundles it into `src/ui/shell.generated.ts`, which is committed. Do not edit that file by hand.

A card is data. A `CardTemplate` in the tool's file holds fixed words and `at("path")` pointers into the tool's `structuredContent`, and the compiler checks each pointer against the output type. `src/ui/view/fill.ts` is the one place that turns a result into text on screen: it copies each server string whole, prints every warning, and falls back to the server's text when a required field is missing.

`src/instructions.ts` is the text every MCP client receives. `plugin/skills/` repeats its rules, so change both together.

## Conventions

- **Decimals.** Use `D` and `parseDecimal` from `src/domain/decimal.ts`. Round only at output: currency minor units for money, 0.01 g for mass.
- **Results, not throws.** Domain functions return `Result<T>` from `src/domain/result.ts`. Rate functions return the result types in `src/rates/types.ts`. Tools return `ToolResult<T>` from `src/tools/rates.ts`.
- **Errors.** Build each one with `code`, `message`, and `fix`. Add a new code to the union in `src/domain/errors.ts`, `src/rates/types.ts`, or `src/tools/rates.ts` first, so the compiler finds every place that must handle it.
- **Boundaries.** Validate tool input with the tool's zod schema. Validate provider responses with the schemas in `src/rates/types.ts` and the checks in `src/rates/validate.ts`. Code inside those boundaries trusts its types.
- **Injected dependencies.** The clock, cache, log, and providers arrive through a `deps` object. Do not call `new Date()`, `fetch`, or KV from domain, rates, or tool code.
- **Constants with sources.** Each conversion factor in `src/domain/units.ts` and each purity mark in `src/domain/purity.ts` carries a cited source. Add the source with the constant.
- **Limits.** The rate chain's time limits are named constants at the top of `src/rates/chain.ts`, and the price checks are in `src/rates/validate.ts`. Change a limit there, not at a call site.

## Add or change a tool

1. Write `src/tools/<toolName>.ts` with the input schema, the output schema, the run function, and the summary.
2. Write the tool's card in the same file: a `CardTemplate<Output>` of labels and `at()` pointers. Point only at strings and at numbers the person typed under `inputs`. Put no digit in a label. Use `row_if_present` for an optional field. Point a date at its `as_of_text`, not its `as_of`. Give the headline a `metal` pointer when the output names one.
3. Register it in `src/server.ts` with its `card`. Pass the input and output schema types to `register` explicitly, because tsc cannot infer them through the card.
4. Test the handler in `test/tools/handlers.test.ts`, the MCP round trip in `test/tools/mcp.test.ts`, and the card in `test/ui/fill.test.ts`.
5. Run `npm run ui:preview` and look at the new card in light and dark, at full and phone width.
6. If the model must use the tool in a new way, update `src/instructions.ts` and the plugin skill.

A change to a template needs no rebuild. A change under `src/ui/view/` needs `npm run ui:build`, and the result must be committed. `test/ui/shell.test.ts` fails while the committed bundle is stale.

## Add a rate provider

1. Write the adapter in `src/rates/providers/`, next to `goldApi.ts`.
2. Record real responses in `test/fixtures/`, with the malformed, out-of-range, and wrong-currency cases.
3. Add the source name to the schema in `src/rates/types.ts`.
4. Wire it in `src/index.ts` and in `scripts/rates-cli.ts`.

## Tests

`npm test` runs Vitest over `test/**/*.test.ts`. No test reaches the network.

- `test/domain/` checks hand-computed golden cases at fixed rates.
- `test/rates/` uses recorded fixtures and a fixed clock.
- `test/tools/fakes.ts` gives fake providers, a memory cache, and fixed dates. Use it instead of a new mock.
- `test/tools/worker.test.ts` covers the Worker's rate limit, batch limit, and body limit.
- `test/ui/` checks the cards on Node with no DOM: `fill` on real tool results, a real ext-apps `App` and `AppBridge`, and the bundle's freshness and size. `test/ui/card.refusals.ts` holds template mistakes that must fail `npm run typecheck`. Only the preview checks `mount.ts` and `card.css`.

Assert what a caller sees: the structured output, the error code and `fix`, and the warnings.

## Drive it by hand

```
npx tsx scripts/melt-cli.ts --metal gold --weight 10 --unit g --purity 22K --rate 4000 --currency USD
npx tsx scripts/melt-cli.ts convert 1 tola g
npx tsx scripts/rates-cli.ts spot gold --fail primary
npx tsx scripts/smoke-mcp.ts http://localhost:8787/mcp   # or https://mcp.meltvalue.dev/mcp after a deploy
npm run dev -- --port 8787
npm run ui:preview
```

`npm run ui:preview` writes `.preview/index.html` with every card scenario, run by the real tools on the fake rates, and prints its path. Serve the folder over HTTP and open it in a browser. Add `?theme=dark` or `?width=375` to the URL, or use the buttons on the page.

`smoke-mcp.ts` lists the tools over HTTP, checks each one's title, `readOnlyHint`, and card, calls all four with real inputs, and exits non-zero on the first failure. Run it against the deployed server after every deploy.

Each CLI prints its usage when you run it with no arguments. `scripts/bench-*.ts` and `scripts/bench-server.sh` measure latency. Read the header of `bench-server.sh` before you run it, because it must fit under the rate limit.

## Local secrets

Copy `.dev.vars.example` to `.dev.vars` before `npm run dev`. Never commit `.dev.vars`.

## More detail

- Tool contracts, pricing layers, and data sources: [design](../docs/plans/2026-11-14-jewellery-melt-value-design.md), sections "MCP tools", "Pricing layers", and "Data sources".
- Fallback order, input cases, and privacy rules: the same file, sections "Robustness" and "Security and privacy".
