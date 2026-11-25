# Plugin

A person talks to Claude with the melt-value plugin installed. The plugin's skills ask for what the server needs (weight, unit, stamp, stones, country), refuse plated pieces, and repeat the server's figures and warnings exactly. This is the end-to-end surface: the model reads the server's answer and must add no number of its own.

## Sub-features

- `plugin-value` reaches a `calc_melt_value` result from a description, a photo, or the `/melt-value` command.
- `plugin-ask` asks for the weight, the ounce kind, or the stone weight when they are missing.
- `plugin-plated` stops at a plated or filled stamp with no value.
- `plugin-numbers` states only numbers that a tool result or the person gave.

## How to get to it (user POV)

- Install the plugin through the marketplace in `.claude-plugin/marketplace.json`, which points at `plugin/`, and talk to Claude.
- The scenarios in `plugin-dev/test/scenarios/`, one per lane, such as `lane-04-plated-photo.md` and `lane-05-oz-question.md`.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes, and `eval "$($V env)"` has set `BASE`. The port is the number at the end of `BASE`.
- The person asked for a plugin run. Each scenario runs headless Claude and spends model tokens.

- **Run a scenario.** Run `node plugin-dev/test/run-scenario.mjs plugin-dev/test/scenarios/lane-05-oz-question.md --port "${BASE##*:}" --out "$EVIDENCE/lane-05.jsonl"`. It prints one JSON line with the turn count, the asking turns, and the count of `calc_melt_value` results.
- **Read the transcript.** Run `node plugin-dev/test/show-transcript.mjs "$EVIDENCE/lane-05.jsonl" > "$EVIDENCE/lane-05.txt"`. The assistant asks troy or regular before it calls `calc_melt_value`.
- **Check the numbers.** Run `node plugin-dev/test/check-numbers.mjs "$EVIDENCE/lane-05.jsonl"; echo "exit $?" >> "$EVIDENCE/lane-05.txt"`. Exit `0` means every number was proven or allowed.
- **Plated stop.** Run the same three steps with `lane-04-plated-photo.md`. The transcript says the piece has no meaningful melt value, and there is no `calc_melt_value` result.

## Gotchas

- `check-numbers.mjs` is a regression guard, not a proof of a correct reply. Read `plugin-dev/test/README.md` for what it does not catch.
- Each scenario makes several tool calls. Running many in one minute meets the rate limit. Space them out, or start a new run.
- Pass `--no-plugin` only for a baseline without the plugin. A plugin change needs the plugin loaded.
- The Worker also serves the plugin's two skills over MCP (see [Skills](./skills.md)). With Claude Code 2.1.325, the scenario's `init` event lists only `melt-value:hallmark-reference` and `melt-value:value-jewellery`, so that client does not load the server's copies. A client that supports skills over MCP may list each skill twice, and a `--no-plugin` run on it is no longer a baseline without the skills. Check the `skills` list in the `init` event of the `.jsonl` when you change Claude Code versions.
