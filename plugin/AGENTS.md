# plugin/AGENTS.md

The melt-value Claude plugin. It holds prompts and no code that computes: two skills, three commands, and an `.mcp.json` that points at the hosted server. `test/` holds the tools that check real conversations.

## What each file does

| Path | Role |
|---|---|
| `skills/value-jewellery/SKILL.md` | the guided valuation flow and the result format |
| `skills/hallmark-reference/SKILL.md` | purity marks by country, and the plated or filled marks |
| `commands/*.md` | `/melt-value`, `/gold-rate`, `/silver-rate` |
| `.mcp.json` | the hosted server URL. Tests use `test/local-mcp.json` instead. |
| `.claude-plugin/plugin.json` | name and version. Raise `version` when behaviour changes. |
| `test/run-scenario.mjs` | runs one scenario in headless Claude Code against a local Worker |
| `test/check-numbers.mjs` | fails a transcript that states a number no tool or person gave |

## Rules for skill and command text

- The model never computes, converts, rounds, or regroups a figure. It copies what the server wrote.
- The model adds no price, charge, or fact the tools did not give.
- The model repeats every server warning, at the strength the server gave it.
- On an error, the model tells the person what the error's `fix` says and does not estimate.
- Every result says it is an estimate from the stated weight and purity, not an appraisal or an offer to buy.
- These rules repeat `server/src/instructions.ts`. Change both together.

## The checker reads the skill files

`check-numbers.mjs` builds its set of allowed purity marks from every `.md` file under `skills/` and `commands/`. A two-digit number before `K`, `carat`, or `karat`, or any three-digit number outside a URL, joins that set. So a number you add to a skill or command can make the checker pass a figure it should fail. After you edit those files, run the checker's tests.

```
node --test plugin/test/*.test.mjs
```

Run that command from the repository root. On Node 25, `node --test plugin/test/` finds no tests.

## Check a behaviour change

A change to a skill or command is proven by a real run, not by reading the prompt.

1. Start a local Worker from `server/` with `npm run dev -- --port <port>`.
2. Run the lanes that your change touches with `run-scenario.mjs`.
3. Run `check-numbers.mjs` on each transcript.
4. Read the transcript with `show-transcript.mjs`, and check it against the pass line at the top of the lane file.

[test/README.md](test/README.md) has the exact commands, the scenario file format, the checker's exit codes, and the correct replies that the checker still fails. Read it before you call a lane failed.

Scenario runs call the Claude API and cost money. Run only the lanes you need.

## Add a scenario

Copy a lane file in `test/scenarios/`. Give it one pass line, a `prompt:`, and the `answer <topic>:` lines the flow will need. Photos go in `test/images/`, with their licence in `test/images/ATTRIBUTION.md`.
