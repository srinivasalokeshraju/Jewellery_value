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

The checker is a regression guard over real runs. It catches the ways real runs have gone wrong. It does not prove that a reply is correct, and a hand-built transcript can still defeat it. The section "What the checker does not prove" names each known way.

### What it reads

The checker reads every number in the assistant's text, including question turns and text written before a tool call. Text blocks that follow each other with no tool call, user event, or end of turn between them are one assistant text. The checker joins them with a space, so a figure split across two blocks reads as one. `MISSING text 2` names the second assistant text.

Before it reads the numbers in any text, the checker does these steps:

1. It removes invisible format characters, which are Unicode category Cf, such as a zero-width space, a word joiner, or a soft hyphen. It removes HTML comments and HTML tags.
2. It applies Unicode NFKC normalisation. This changes a no-break space or a thin space to a space, and `₨` to `Rs`.
3. It removes the markdown marks `*`, `_`, and backticks, and it changes each table pipe to a space.
4. It removes dates and times. These forms are dates: ISO dates and timestamps with an optional offset, `15/11/2026`, `15.11.2026`, and `15-11-26` when the first two parts are each from 1 to 31, `15 Nov 2026`, `Nov 15, 2026`, and `November 2026`. HTTP dates are in the `15 Nov 2026` form. `05:17` and `05:17:56` are times.
5. It joins digit groups that a space, an apostrophe, or a line break separates, when the groups have the shape of a grouped number. The first group has one to three digits, the middle groups two or three, and the last group three. So `140 000`, `1 40 000`, `140'000`, and `140` with `000` on the next line all read as 140000.

In the assistant's text, a character that Unicode counts as a digit or a number, and that is not 0 to 9, fails the transcript. The checker looks for these before step 2, so Devanagari, full-width, superscript, and circled digits fail, and so do fraction signs such as `½`.

A number can have a letter in front, so `Rs140000` and `AED5600` read as 140000 and 5600. A number has these readings:

- A number with both separators, such as `5.000,50` or `1,40,000.50`, has one reading.
- A dot with three digits after it, and one to three digits before it that do not start with 0, has two readings in the assistant's text. `12.400` reads as the grouped whole number 12400, or as the decimal written with all three digits, 12.400. A proof of 12.4 proves neither.
- A comma in the same place has one reading, the grouped whole number. `1,400` reads as 1400.
- Every other number with one separator is a decimal. Trailing zeros do not count, so `4.50` and `4.5` are the same.
- A dot before the first digit starts a decimal, when no letter, digit, dot, or comma is in front of the dot. `.25` reads as 0.25. In `Rs.25`, the dot follows a letter, so the number is 25.
- Leading zeros count. `0000` is not 0, and `012` is not 12.
- A number such as `1.2.3`, which is no grouping, reads as three numbers.

Proof text has one reading, the way the tool wrote it. In proof text, `12.400` is the decimal, so it proves 12.400 and 12.4 but not 12400. `1,400` is the whole number 1400, so it does not prove 1.4. A tool's `94.051` does not prove `94,051` in a reply.

### Tier one: proof

A number is proven when one of its readings appears in an earlier event. These events count, after the steps above:

- A tool result that is not an error. This includes counters such as `age_seconds` and every number in a web search result. A `WebSearch` or `WebFetch` result does not prove a number that is also in the input of the same call, such as a number in the search query or the URL.
- The `fix` text of an errored result, when the result is JSON with a `fix` field, as the melt-value server writes its errors. Nothing else in an errored result counts.
- The person's own messages. Skill and command text that Claude Code adds to the conversation does not count.

A number is proven only when it appears before the assistant text that states it.

### Tier two: allowed without proof

A number that tier one does not prove fails when it has a currency or mass mark beside it. Otherwise it passes only when it is one of these:

- A percentage, such as `92.5%`, or the first number of a range that ends in a percentage, such as the 70 in `70 to 95%`. The first number has one to three digits.
- A list marker of one or two digits at the start of a line, followed by `.` or `)` and a space.
- A step number of one or two digits after the word `step`.
- A purity mark or karat from the plugin's own skill and command files. The checker reads the set from the files when it runs. It is each number of one or two digits that `K`, `carat`, or `karat` follows, and each three-digit number outside a URL. Today the set is 9, 10, 14, 18, 20, 22, 23, 24, 375, 585, 750, 800, 833, 900, 916, 925, 958, 990, 995, and 999.

A mark is beside a number when only these separate them: spaces and line breaks, a hyphen or an en dash, a colon, a slash, and round brackets. The markdown marks and table pipes that step 3 removes or changes also separate nothing. After the number, the scale words `k`, `thousand`, `lakh`, `lac`, `crore`, `million`, and `billion`, and the word `per`, also separate nothing. These are marks:

- Before the number, one of `₹ $ € £ ¥`, a word of three capital letters, or a currency word from the checker's list. Mass words before a number are not marks.
- After the number, one of those symbols, a word of three capital letters, or a mass or currency word from the checker's list.

The list holds mass words such as `g`, `gms`, `gram`, `kg`, `oz`, `ozt`, `troy`, `dwt`, `grain`, `tola`, `baht`, and `tael`, and currency words and codes such as `rupees`, `dollars`, `dirhams`, `rs`, `dhs`, `inr`, `usd`, and `aed`. The checker compares a word with the list without regard to case. So `18-gram`, `₹  916`, `INR: 900`, `999 rs`, `925k INR`, `916 per gram`, and a table row with `18` and `g` in neighbouring cells all fail when the number is not proven.

### Tool inputs

For each `calc_melt_value` and `convert_weight` call, every numeric top-level input, such as `weight`, `non_metal_weight`, or `value`, must appear in an earlier person message or non-error tool result. The `fix` text of an error does not count here, and a `WebSearch` or `WebFetch` result does not prove a number that is in its own input. An input of 0 needs no proof. A weight converted by hand or guessed from a photo fails, even though the server repeats it in its result.

When the call names a unit, the unit must also agree. `weight` and `non_metal_weight` are in the call's `unit`, and `value` is in its `from_unit`. A tool result agrees with any unit. A number in a person's message agrees with any unit when no mark follows it. When a mass word follows it, the word must be able to mean the call's unit. `12 dwt` sent as `weight: 12, unit: "g"` fails. `2 oz` agrees with `ozt` and `oz_av`, and `gr` agrees with `g` and `grain`. A number with a currency word after it agrees with no unit.

### What the checker does not prove

Each class below is a way that an invented or wrong figure can still pass.

- **A figure whose digits equal an unrelated earlier number.** The checker matches digits, not meaning or field. `It weighs 22 g` passes when the person wrote `22K`. `₹19076` passes when a tool result has `age_seconds` 19076, and a Unix time in a tool result proves a ten-digit figure. A web listing's price proves the same digits as a weight. A figure split into pieces passes when each piece is proven, such as `₹1` and `40000` on two lines when both numbers appear earlier.
- **A figure written in words.** `one lakh forty thousand rupees` has no digits to read.
- **A scale or rounding word after a proven number.** `₹22 lakh` passes when 22 is proven, because the checker reads only the digits. A rounded figure such as `₹133618` fails, unless its digits happen to be proven.
- **A figure written as a date or time.** `₹12:40 thousand` has no number after step 4.
- **The unit of a figure in the assistant's text.** `12 g` in a reply passes when the person wrote `12 dwt`. The unit check covers only tool inputs, and only a mass word right after the person's number. An input that a tool result proves agrees with any unit.
- **Inputs to other tools.** The checker reads numeric top-level inputs only of `calc_melt_value` and `convert_weight`. It never reads the inputs of `get_metal_rate`, `WebSearch`, `WebFetch`, or `AskUserQuestion`, so an example weight in an `AskUserQuestion` option, such as `4.2 g`, passes. A string or nested weight is skipped. The server's schema rejects it.
- **A purity-set number with no mark, or with a mark that the checker does not know.** `A typical bangle weighs about 18` passes as the purity mark 18. `The stone is 10 ct` passes, because `ct` can mean karat.
- **Words without numbers that add to what the server said.** "shops add making charges" or "so the AED figures may be off" has no number to check.

### Correct replies that fail

Read the failing number before you call a lane failed.

- A unit definition, such as `1 carat = 0.2 g`.
- Scale advice, such as a scale that reads to `0.1 g`.
- The 1 of an exchange rate written as `1 USD = 94.05 INR`.
- A weight of 1 for a rate per unit. When the person asks for the rate per tola, the call `weight: 1, unit: "tola"` is correct, but the 1 is in no earlier message.
- A source citation that names a number from the skill files, such as `16 CFR 23.3`, or a URL from the skill files.
- A purity mark that is not in the skill files, such as `21K`, `875`, or `999.9 fine`. The skill names only the marks in its tables.
- A purity mark next to a word of three capital letters, which the checker reads as a currency code, such as `916 KDM` or `BIS 916`.
- Purity marks separated only by spaces, such as `999 916 750`, which step 5 joins into one number.
- A list marker followed by a mass or currency word, such as `2) Grams are fine.`
- A line that ends in a whole number of one to three digits, when the next line starts with a number of exactly three digits. Step 5 joins them, so `line 12` and `916 is the mark` on the next line read as 12916.
- A weight that a web search confirms, when the search query also has that weight.
- A fraction sign or a superscript, such as `½ oz` or `cm²`.

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
