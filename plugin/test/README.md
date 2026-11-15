# Plugin tests

These tests run the plugin in headless Claude Code against a local melt-value Worker.

## Start the local Worker

```
cd server && npm ci && cp .dev.vars.example .dev.vars
npm run dev -- --port <port>
```

Wait for the line `Ready on http://localhost:<port>`.

## Run a scenario

Run each command from the repository root.

```
node plugin/test/run-scenario.mjs plugin/test/scenarios/<scenario>.md --port <port> --out <transcript>.jsonl
node plugin/test/show-transcript.mjs <transcript>.jsonl > <transcript>.txt
node plugin/test/check-numbers.mjs <transcript>.jsonl
```

`run-scenario.mjs` prints one JSON line with the turn count, the turns that ask the person something before the first `calc_melt_value` call, and the `calc_melt_value` call count. Pass `--no-plugin` to run without the plugin, for the PR3 baseline. Pass extra `claude` flags after `--`, such as `-- --model opus`.

`check-numbers.mjs` exits with 0 when every money or mass figure in each turn's final reply appears in a tool result, 1 when a figure is missing, and 2 when the transcript has no reply. It checks a number next to a currency or mass unit, and any number with a decimal part. It skips dates, times, and percentages. It does not check a whole number with no unit, or a number written in words.

## The driver command

`run-scenario.mjs` runs this command and writes each user turn to its standard input.

```
claude -p --setting-sources local --plugin-dir plugin \
  --mcp-config <copy of plugin/test/local-mcp.json with the port set> --strict-mcp-config \
  --input-format stream-json --output-format stream-json --verbose \
  --max-turns <n> '--allowedTools=mcp__melt-value__*,WebSearch,WebFetch'
```

Each flag beyond the plan's driver has a reason.

- `--setting-sources local` skips the user and project settings, so other plugins and their session hooks do not load. The project settings enable another plugin whose hook adds instructions to every session.
- `--input-format stream-json` lets the runner send a photo and send each answer after the previous turn ends.
- `--verbose` is required with `--output-format stream-json` and `-p`.
- `--allowedTools` lets the headless session call the server's tools and web search without a permission prompt. Write it with `=`, because the flag takes several values and would read the prompt as a tool name.
- `--strict-mcp-config` hides the plugin's own `.mcp.json` server, so the tools reach the local Worker. The tools then have the names `mcp__melt-value__<tool>`.

## Scenario files

Each file in `scenarios/` is one lane. The runner reads these lines and ignores the rest.

- `prompt:` is the first user turn.
- `image:` attaches a JPEG to the first turn. The path is relative to the scenario file.
- `answer <topic>:` is the reply to an assistant turn that asks about that topic, before the first `calc_melt_value` call. The runner matches the topic in the turn's sentences that end in a question mark, or in its last paragraph when no sentence does. The topics are `stones`, `unit`, `weight`, `purity`, `metal`, and `location`. Each answer is sent once.
- `then:` is the next user turn when no answer matches. The runner stops when no answer or `then:` line is left.
- `max-turns:` sets `--max-turns`. The default is 12.

`fixture-pass.jsonl` and `fixture-fail.jsonl` are trimmed copies of a lane 1 transcript. The fail fixture changes one money figure in the reply, from 133617.88 to 133671.88.

## What headless runs show

In a `-p` session, a plugin command has only its full name, such as `/melt-value:gold-rate`. A user message of `/gold-rate` is not expanded. The model then runs the command through its Skill tool, so the command still runs, and the reply often says that it used the full name.
