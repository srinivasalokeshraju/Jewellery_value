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

`check-numbers.mjs` exits with 0 when every number in the assistant's text is proven or allowed, 1 when a number is missing, and 2 when the transcript has no assistant text. It also exits with 1 when a `calc_melt_value` or `convert_weight` call has an unproven numeric input. Each `MISSING` line names the number and the words around it.

### What it reads

The checker reads every number in every assistant text block, including question turns and text written before a tool call. A number counts whatever mark is next to it, or none. Before it reads the numbers, it does these steps:

1. It removes the markdown marks `*`, `_`, and backticks, and it changes each table pipe to a space.
2. It removes dates and times. These forms are dates: ISO dates and timestamps with an optional offset, `15/11/2026`, `15.11.2026`, and `15-11-26` when the first two parts are each from 1 to 31, `15 Nov 2026`, `Nov 15, 2026`, and `November 2026`. HTTP dates are in the `15 Nov 2026` form. `05:17` and `05:17:56` are times.
3. It joins digit groups that a space, a no-break space, a thin space, or an apostrophe separates, so `140 000`, `1 40 000`, and `140'000` read as 140000.

A number can have a letter in front, so `Rs140000` and `AED5600` read as 140000 and 5600. A number with both separators, such as `5.000,50` or `1,40,000.50`, has one reading. One to three digits, one separator, and three digits, such as `12.400` or `1,400`, has two readings. The checker tries the grouped whole number, 12400, and the decimal written with all three digits, 12.400. A proof of 12.4 proves neither. Every other number with one separator is a decimal, and trailing zeros do not count, so `4.50` and `4.5` are the same. A number such as `1.2.3`, which is no grouping, reads as three numbers. A digit outside 0 to 9, such as a Devanagari digit, always fails.

### Tier one: proof

A number is proven when it appears in an earlier event. These events count, after the three steps above:

- A tool result that is not an error. This includes counters such as `age_seconds` and every number in a web search result.
- The `fix` text of an errored result, when the result is JSON with a `fix` field, as the melt-value server writes its errors. Nothing else in an errored result counts.
- The person's own messages. Skill and command text that Claude Code adds to the conversation does not count.

A number is proven only when it appears before the text block that states it.

### Tier two: allowed without proof

A number that tier one does not prove passes only when it is one of these:

- A percentage, such as `92.5%`, or the first number of a range that ends in a percentage, such as the 70 in `70 to 95%`. The first number has one to three digits.
- A list marker of one or two digits at the start of a line, followed by `.` or `)` and a space.
- A step number of one or two digits after the word `step`.
- A purity mark or karat from the plugin's own skill and command files, with no currency or mass mark next to it. The checker reads the set from the files when it runs. It is each number of one or two digits that `K`, `carat`, or `karat` follows, and each three-digit number outside a URL. Today the set is 9, 10, 14, 18, 20, 22, 23, 24, 375, 585, 750, 800, 833, 900, 916, 925, 958, 990, 995, and 999.

A currency or mass mark is one of these, next to the number:

- Before it, one of `₹ $ € £ ¥`, a three-capital-letter code, or `Rs`.
- After it, one of those symbols, a three-capital-letter code, or a mass or currency word, such as `g`, `gms`, `tola`, `ozt`, `rupees`, or `dirhams`.

Every other number fails, so a mark that the checker does not know cannot hide a figure.

### Tool inputs

For each `calc_melt_value` and `convert_weight` call, every numeric input, such as `weight`, `non_metal_weight`, or `value`, must appear in an earlier person message or non-error tool result. The `fix` text of an error does not count here. An input of 0 needs no proof. A weight converted by hand or guessed from a photo fails, even though the server repeats it in its result.

### What it does not catch

- A number written in words, such as `one lakh`.
- Whether a number came from the right field. A small whole number such as `2 g` passes when any earlier tool result or person message has the number 2.
- A number in a tool result that is not a date in a form above, such as a Unix time. It counts as proof.
- A purity number with a mark that the checker does not know, such as `916 Dhs`.
- A scale word after a proven number. `12.4 lakh` passes when a tool result has 12.4.
- Words without numbers that add to what the server said, such as "shops add making charges".

### Correct replies that fail

Read the failing number before you call a lane failed.

- A unit definition, such as `1 carat = 0.2 g`.
- Scale advice, such as a scale that reads to `0.1 g`.
- The 1 of an exchange rate written as `1 USD = 94.05 INR`.
- A source citation that names a number from the skill files, such as `16 CFR 23.3`, or a URL from the skill files.
- A purity mark that is not in the skill files, such as `21K`. The skill names only the marks in its tables.

## The driver command

`run-scenario.mjs` runs this command and writes each user turn to its standard input.

```
claude -p --setting-sources local --plugin-dir plugin \
  --mcp-config <copy of plugin/test/local-mcp.json with the port set> --strict-mcp-config \
  --input-format stream-json --output-format stream-json --verbose \
  --max-turns <n> '--allowedTools=mcp__melt-value__*,WebSearch,WebFetch'
```

Each flag beyond the plan's driver has a reason.

- `--setting-sources local` skips the user and project settings. The project settings enable another plugin whose hook adds instructions to every session, and that plugin does not load. Other plugins installed on the machine still load. The `plugins` list in the transcript's `system` `init` event names them. The runner writes the person's first message before that event.
- `--input-format stream-json` lets the runner send a photo and send each answer after the previous turn ends.
- `--verbose` is required with `--output-format stream-json` and `-p`.
- `--allowedTools` lets the headless session call the server's tools and web search without a permission prompt. Write it with `=`, because the flag takes several values and would read the prompt as a tool name.
- `--strict-mcp-config` hides the plugin's own `.mcp.json` server, so the tools reach the local Worker. The tools then have the names `mcp__melt-value__<tool>`.

## Scenario files

`scenarios/` holds the lane files `lane-*.md`, the cold-start perf probe `cold-start.md`, and two checker fixtures. The runner reads these lines in a lane or probe file and ignores the rest.

- `prompt:` is the first user turn.
- `image:` attaches a JPEG to the first turn. The path is relative to the scenario file.
- `answer <topic>:` is the reply to an assistant turn that asks about that topic, before the first `calc_melt_value` result. The runner matches the topic in the turn's sentences that end in a question mark, or in its last paragraph when no sentence does. The topics are `stones`, `unit`, `weight`, `purity`, `metal`, and `location`. Each answer is sent once.
- `then:` is the next user turn when no answer matches. The runner stops when no answer or `then:` line is left.
- `max-turns:` sets `--max-turns`. The default is 12.

`fixture-pass.jsonl` and `fixture-fail.jsonl` are trimmed copies of a lane 1 transcript. Each starts with the person's message, as the runner writes it. The fail fixture changes one money figure in the reply, from 133617.88 to 133671.88.

## What headless runs show

In a `-p` session, a plugin command has only its full name, such as `/melt-value:gold-rate`. A user message of `/gold-rate` is not expanded. The model then runs the command through its Skill tool, so the command still runs, and the reply often says that it used the full name.
