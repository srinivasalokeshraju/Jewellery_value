# Melt-value verification map

This directory is the maintained source for verifying what a user of the melt-value server sees. Read this index before driving, then use the matching feature file as the recipe. When a change touches a feature, drive every entry point that file lists, not only the most convenient one.

## Baseline preconditions

- `server/node_modules` is installed (`cd server && npm ci`).
- Start a private run with `.claude/skills/verify/scripts/verify.sh up`. It prints the MCP URL.
- `verify.sh doctor` passes. It requires the port to belong to this run and the endpoint to list four tools.
- The local KV starts empty. Rates come from the live providers on first use, so the machine needs network access.
- Never drive an instance that this run did not start, such as a developer's `npm run dev` on port 8787.

## Driving conventions

- `V=.claude/skills/verify/scripts/verify.sh`, run from the repository root.
- Pass tool arguments as JSON exactly as written. Units and purity marks are case-sensitive strings.
- Give every `call` a label naming the feature and case, such as `calc-22k-in`. The label becomes the evidence file name.
- Run `eval "$($V env)"` before a raw `curl` check. Write scratch files under `$RUN/scratch/`, which `down` deletes.
- Run the request-guard recipe last in a run, because it uses up the rate limit for a minute.

## Proof and skip reporting

- A proof is the saved `evidence/NN-<label>.json` plus the assertion it supports, written in the report as field = value.
- Assert input-only figures exactly (`pure_grams`, converted weights). Assert money figures by shape, currency, and source, because live rates move.
- Check side effects with `$V kv` and `$V logs` when the feature writes to KV or logs.
- Repeat every `warnings` entry in the report, with its `code`.
- Report a case you could not drive with the command you tried and the reason, such as a provider being down. Do not report it as verified through another case.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the user-visible behaviour. Then come four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.sh`, and `Gotchas`.

## Features

- [Melt value](./calc-melt-value.md): `calc_melt_value` for gold and silver, stones, the gross-weight warning, and refusals.
- [Metal rate](./get-metal-rate.md): `get_metal_rate` per currency, rate provenance, and the provider fallback.
- [Units and marks](./convert-and-supported.md): `convert_weight` and `list_supported`.
- [Rate refresh](./rate-refresh.md): the cron handler that warms the KV cache.
- [Request guards](./request-guards.md): the rate limit, the batch limit, and the body limit on `/mcp`.
- [Cards](./cards.md): the MCP Apps card for each tool, in both themes, at full and phone width.
- [Skills](./skills.md): the plugin's skills served over the MCP Skills extension.
- [Plugin](./plugin.md): the Claude plugin, driven in headless Claude against this run's Worker.
