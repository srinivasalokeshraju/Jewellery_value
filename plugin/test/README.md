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

`run-scenario.mjs` prints one JSON line with the turn count, the turns that ask the person something before the first `calc_melt_value` result, and the count of `calc_melt_value` results. An errored result does not count as a result. Pass `--no-plugin` to run without the plugin, for the PR3 baseline. Pass extra `claude` flags after `--`, such as `-- --model opus`. The runner writes each message it sends into the transcript, with each photo replaced by its path.

Run the checker's own tests with `node --test plugin/test/*.test.mjs`. On Node 25, `node --test plugin/test/` does not find them.

## What `check-numbers.mjs` checks

`check-numbers.mjs` exits with 0 when every money or mass figure in the assistant's text appears earlier in the transcript, 1 when a figure is missing, and 2 when the transcript has no assistant text. It checks every assistant text block, including question turns and text written before a tool call. A figure must appear before the text block that states it.

A figure is a number with a currency code, symbol, or word before or after it, a number with a mass unit after it, or a number with a decimal point or digit grouping. It reads `1,40,000`, `140,000`, and `5.000,50` as their values. It skips dates, times, percentages, the `1 USD =` base of an exchange rate, and the purity marks 916.6, 958.4, and 999.9.

These numbers count as proof:

- Every number in a tool result that is not an error, after dates and times are removed. This includes counters such as `age_seconds` and numbers in web search results.
- The numbers in the `fix` text of an errored result, when the result is JSON with a `fix` field, as the melt-value server writes its errors. A reply may pass on a range from a fix. Nothing else in an errored result counts.
- The numbers in the person's own messages, so a reply may repeat a figure the person typed. Skill and command text that Claude Code adds to the conversation does not count.

The checker does not check these:

- A whole number with no unit or currency, or a number written in words.
- Whether a figure came from the right field. A small whole number such as `2 g` passes when any earlier tool result or person message has the number 2.
- A whole number with a scale word, such as `2 lakh`. A decimal with one, such as `1.4 lakh`, is checked as 1.4.

These correct replies fail the check. Read the failing figure before you call a lane failed.

- A unit definition, such as `1 carat = 0.2 g`.
- Scale advice, such as a scale that reads to `0.1 g`.

## The driver command

`run-scenario.mjs` runs this command and writes each user turn to its standard input.

```
claude -p --setting-sources local --plugin-dir plugin \
  --mcp-config <copy of plugin/test/local-mcp.json with the port set> --strict-mcp-config \
  --input-format stream-json --output-format stream-json --verbose \
  --max-turns <n> '--allowedTools=mcp__melt-value__*,WebSearch,WebFetch'
```

Each flag beyond the plan's driver has a reason.

- `--setting-sources local` skips the user and project settings. The project settings enable another plugin whose hook adds instructions to every session, and that plugin does not load. Other plugins installed on the machine still load. The `plugins` list in each transcript's first event names them.
- `--input-format stream-json` lets the runner send a photo and send each answer after the previous turn ends.
- `--verbose` is required with `--output-format stream-json` and `-p`.
- `--allowedTools` lets the headless session call the server's tools and web search without a permission prompt. Write it with `=`, because the flag takes several values and would read the prompt as a tool name.
- `--strict-mcp-config` hides the plugin's own `.mcp.json` server, so the tools reach the local Worker. The tools then have the names `mcp__melt-value__<tool>`.

## Scenario files

Each file in `scenarios/` is one lane. The runner reads these lines and ignores the rest.

- `prompt:` is the first user turn.
- `image:` attaches a JPEG to the first turn. The path is relative to the scenario file.
- `answer <topic>:` is the reply to an assistant turn that asks about that topic, before the first `calc_melt_value` result. The runner matches the topic in the turn's sentences that end in a question mark, or in its last paragraph when no sentence does. The topics are `stones`, `unit`, `weight`, `purity`, `metal`, and `location`. Each answer is sent once.
- `then:` is the next user turn when no answer matches. The runner stops when no answer or `then:` line is left.
- `max-turns:` sets `--max-turns`. The default is 12.

`fixture-pass.jsonl` and `fixture-fail.jsonl` are trimmed copies of a lane 1 transcript. The fail fixture changes one money figure in the reply, from 133617.88 to 133671.88.

## What headless runs show

In a `-p` session, a plugin command has only its full name, such as `/melt-value:gold-rate`. A user message of `/gold-rate` is not expanded. The model then runs the command through its Skill tool, so the command still runs, and the reply often says that it used the full name.
