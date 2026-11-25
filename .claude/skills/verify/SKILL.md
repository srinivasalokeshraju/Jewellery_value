---
name: verify
description: Drive the melt-value MCP server (a Cloudflare Worker in server/) the way an MCP host does, and keep the proof. Starts a private local Worker, calls its four tools over HTTP, checks the cron rate refresh, the request guards, and the cards, and can run the plugin in headless Claude. Use it to prove a server, card, or plugin change works in the running app, not only in Vitest.
---

# Verify the melt-value server

The user surface is the MCP endpoint `/mcp`. A host such as Claude lists four read-only tools there (`get_metal_rate`, `convert_weight`, `calc_melt_value`, `list_supported`), calls them, and shows each result as text or as a card (an MCP Apps `ui://` resource). The plugin in `plugin/` is a second surface that runs on top of the same endpoint.

Every command below runs from the repository root. `V=.claude/skills/verify/scripts/verify.sh`.

## Launch

```
cd server && npm ci && cd ..     # once per checkout
$V up
```

`up` starts `wrangler dev` on a free port at `127.0.0.1`, with its own local KV under `.verify/<run-id>/scratch/state`, so it never shares state with a developer's `npm run dev`. It is ready when the log prints `Ready on http://127.0.0.1:<port>` and the doctor below passes. `up` waits for both and prints `up   run <run-id> at http://127.0.0.1:<port>/mcp`. Startup takes about 4 s.

The KV starts empty. The first tool call that needs a rate fetches it from the live providers (gold-api.com, xaus.com, frankfurter.dev) and writes it to KV. No seed data is needed. `.dev.vars` is optional: copy it from `.dev.vars.example` if a check needs `VENDOR_KEY`.

Each `up` starts a new run and makes it the current one. Two runs can live side by side. Set `VERIFY_RUN=<run-id>` to act on a run other than the latest.

## Doctor

```
$V doctor
```

Read-only. It passes when the worker process group this run started is alive, the port's listener belongs to that group, and the endpoint lists exactly the four tools, each with a title, `readOnlyHint: true`, and a non-empty card. It writes `evidence/doctor.json`. Run it first whenever a call fails or the instance looks wrong. If it says the port belongs to another group, do not drive that instance: start a new run.

## Drive

| Command | What it does | Evidence |
|---|---|---|
| `$V call <tool> '<json args>' [label]` | One MCP call through a real client (`server/scripts/verify-mcp.ts`), as a host makes it | `evidence/NN-<label>.json` with the arguments, `isError`, `structuredContent`, and `content` |
| `$V scheduled` | Fires the cron handler through `/__scheduled` | `evidence/NN-scheduled.json`, the `cache_warm` log line |
| `$V kv` | Lists the keys in this run's local KV | `evidence/NN-kv.json` |
| `$V cards` | Builds the card preview and serves it on a free port. Take the shots in a browser, as [features/cards.md](features/cards.md) says | `evidence/cards/index.html`, and the shots you save to `evidence/cards/` |
| `$V logs [n]` | The last lines of the Worker log | `evidence/worker.log` |
| `eval "$($V env)"` | Sets `RUN`, `EVIDENCE`, `PERSIST`, `BASE`, and `URL` for raw `curl` checks | none |

The feature map in [features/README.md](features/README.md) holds the recipes. Read it before you drive anything, then follow the file for the feature you changed.

## Evidence

Each run keeps its proof in `.verify/<run-id>/evidence/`. The folder is ignored by git and survives `down`.

Proof standards:

- Drive the real path: an MCP client over HTTP to `/mcp`, or the plugin in headless Claude. Do not call a handler in-process or use the fakes in `server/test/tools/fakes.ts`. Those belong to Vitest.
- Keep the action with its result. `call` saves the arguments next to the response.
- Check side effects as well as the response. A rate call writes `spot:<metal>` and `fx:<currency>` keys to KV (`$V kv`) and `provider_fetch` and `usage` lines to the log (`$V logs`).
- Check what a caller sees: `structuredContent`, every entry in `warnings`, and for an error the `code`, `message`, and `fix` in the text content.
- Money figures come from live rates and change between runs. Assert figures that depend only on the inputs, such as `pure_grams`, converted weights, units, and error codes. For money, assert that the field is a decimal string in the right currency, and that the source and `as_of` are present.

## Cleanup

```
$V down
```

`down` stops only the process groups this run started (the Worker and the card server), then deletes `scratch/`, which holds the local KV. It keeps `evidence/` and prints its path. Never kill by process name: a developer's own `wrangler dev` may be running. Run `down` after every failed attempt too. To remove old proof, delete `.verify/<run-id>/` yourself.

## Helpers

- `.claude/skills/verify/scripts/verify.sh`: the driver above. Run it with no arguments for its usage.
- `server/scripts/verify-mcp.ts`: the MCP client it uses. `npx tsx scripts/verify-mcp.ts doctor <url>` or `call <url> <tool> '<json>'`, from `server/`. It prints one JSON document.
- `server/scripts/smoke-mcp.ts <url>`: the release smoke test. It calls all four tools and a refusal and exits non-zero on the first failure. Run it against `$URL` for a quick end-to-end pass.

## Limits

- The rate limit allows 60 requests a minute for every local caller, and each `call` makes about three requests. A burst of checks gets `429`. Wait a minute, or run the guard recipe last.
- Card shots need a browser tool: the Playwright MCP tools (`browser_navigate`, `browser_take_screenshot` with a `filename`) or the browser pane.
- The cron refresh on the deployed Worker runs every minute. Locally it runs only when `$V scheduled` fires it.
