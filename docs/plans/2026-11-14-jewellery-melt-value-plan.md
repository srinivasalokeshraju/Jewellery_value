# Jewellery melt value plan

This plan builds phases 1 to 3 of the design in `docs/plans/2026-11-14-jewellery-melt-value-design.md`.
The reader is a person who uses an AI agent and wants the melt value of gold or silver jewellery in local currency.
The program enforces one rule. The server computes every number, and each number carries its source and time.
Four stacked PRs deliver it, in this order.
PR1 adds the unit, purity, and melt math. PR2 adds the rate providers, the cache, and the fallback chain.
PR3 adds the MCP server with four read-only tools. PR4 adds the Claude plugin with two skills and three commands.
Development uses free rate feeds behind the provider interface until a licensed vendor signs.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-stack.md` from the installed plugin. No agent merges. The root stops when every PR is verified at its current head, and the operator lands PR1, PR2, PR3, and PR4 bottom-up. The operator also owns the GitHub remote, the Cloudflare account, every deploy, and the review of PR4.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Confirm the operator's items before any owner starts. Evidence is a line per item in `notes.md`.
  - [ ] The operator created a GitHub repository and added it as `origin`. `git remote get-url origin` prints its URL. The trunk branch is `master`.
  - [ ] The operator committed or ignored `CLAUDE.md`, `.claude/`, and `todo.md`. `git status --short` prints nothing.
  - [ ] The operator supplied three test photos in `plugin/test/images/`, named `stamped-916.jpg`, `unstamped.jpg`, and `plated-gp.jpg`. If a photo is missing, the matching PR4 lane describes the stamp in text and records the photo path as unproven.
- [ ] On the operator's go, write this exact text into `notes.md` in the program's store under `~/.claude/orchestrate/melt-value/` and restate it in your todolist. "Plan is docs/plans/2026-11-14-jewellery-melt-value-plan.md. PR ids in order are PR1 domain, PR2 rates, PR3 server, PR4 plugin, each stacked on the one before. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. No agent merges or deploys. The operator lands the stack bottom-up and runs every deploy. Done means all four PRs are verified at their current heads and handed to the operator."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] The `run` skill that ships with Claude Code. It is the driver for the CLI, the local server, and the headless plugin runs.
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/poteto-mode/playbooks/shipping.md`
  - [ ] `skills/show-me-your-work/SKILL.md`
  - [ ] `skills/technical-writing/SKILL.md` and `skills/unslop/SKILL.md`
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the objective in the program store's `notes.md`. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle that `autopilot-stack.md` names.
- [ ] Follow this dependency graph. Base each PR on its parent's branch.
  - [ ] PR1 is first. It branches from `master` as `pr1-domain`.
  - [ ] PR2 after PR1. It branches from `pr1-domain` as `pr2-rates`.
  - [ ] PR3 after PR2. It branches from `pr2-rates` as `pr3-server`.
  - [ ] PR4 after PR3. It branches from `pr3-server` as `pr4-plugin`.
- [ ] Hold the file boundaries.
  - [ ] PR1 touches only `.gitignore`, `server/package.json`, `server/package-lock.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/domain/**`, `server/test/domain/**`, `server/scripts/melt-cli.ts`, and `server/scripts/bench-domain.ts`.
  - [ ] PR2 touches only `server/src/rates/**`, `server/test/rates/**`, `server/test/fixtures/**`, `server/scripts/rates-cli.ts`, and `server/scripts/bench-rates.ts`.
  - [ ] PR3 touches only `server/wrangler.jsonc`, `server/.dev.vars.example`, `server/src/index.ts`, `server/src/server.ts`, `server/src/instructions.ts`, `server/src/log.ts`, `server/src/tools/**`, `server/test/tools/**`, `server/scripts/bench-server.sh`, and the dependency lines in `server/package.json`.
  - [ ] PR4 touches only `plugin/**`.
- [ ] Hold the review gate. PR4 changes an interaction. It waits for the operator's review in chat with screenshots and a video before merge. PR1, PR2, and PR3 are not review-gated.
- [ ] Hold the deploy rule. No owner runs `wrangler deploy` without `--dry-run`. A deploy is the operator's action.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `gh pr create --base <base-branch>`. A stack child targets its parent branch.
- [ ] Run `npm run typecheck` and `npm test` in `server/` once before the PR-facing push. Push with hooks on. The repo has no linter, and this program adds none.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `skills/poteto-mode/references/bugbot-triage.md`.
- [ ] Before the code-ready report and babysit, and again after merge prep, record the base and head SHAs prepared by the topology owner under the execution playbook.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Stop at verified. The root appends each verified PR to the stack and hands the stack to the operator, who lands it bottom-up. After the handoff, nobody pushes without the operator's go. A PR whose `git patch-id` a restack leaves unchanged keeps its verdict.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the commands recorded in this boot recipe. A lane on a terminal surface saves a text transcript in place of a screenshot.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `cd server && npm ci`. Node 25.6.1 is the measured runtime.
- [ ] For PR1 and PR2, drive the CLI scripts with `npx tsx scripts/<name>.ts`. No server starts.
- [ ] For PR3 and PR4, copy `.dev.vars.example` to `.dev.vars`, then run `npm run dev -- --port <8787 plus the lane number>`. Wait for the line `Ready on http://localhost:<port>`.
- [ ] For PR3, deliver input only through `npx -y @modelcontextprotocol/inspector@2.15.0 --cli http://localhost:<port>/mcp` or the `curl` sequence in Appendix A. Read the `wrangler dev` log as the read-only diagnostic.
- [ ] For PR4, deliver input only through `claude -p --plugin-dir plugin --mcp-config plugin/test/local-mcp.json --strict-mcp-config --output-format stream-json`. Read the stream as the read-only diagnostic.
- [ ] Save every transcript or screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>` and return the paths with the report.

## Build the unit, purity, and melt math (PR1)

**Depends on.** None.

**Files.**

- [ ] Create `.gitignore` with `node_modules`, `.wrangler`, `.dev.vars`, and `todo.md`.
- [ ] Create `server/package.json`, `server/tsconfig.json`, and `server/vitest.config.ts`.
- [ ] Create `server/src/domain/result.ts`, `errors.ts`, `units.ts`, `purity.ts`, `money.ts`, and `melt.ts`.
- [ ] Create `server/test/domain/units.test.ts`, `purity.test.ts`, and `melt.test.ts`.
- [ ] Create `server/scripts/melt-cli.ts` and `server/scripts/bench-domain.ts`.

**Build.**

- [ ] Add the dependencies `decimal.js@10.6.0` and `zod@4.6.7`, and the dev dependencies `typescript@7.0.2`, `vitest@4.1.12`, and `tsx`. Add the scripts `test` as `vitest run` and `typecheck` as `tsc -p . --noEmit`. The prototype did not run `tsx`, so confirm it on the first script run.
- [ ] In `result.ts`, define `Result<T>` as `{ ok: true, value: T }` or `{ ok: false, error: DomainError }`. No domain function throws.
- [ ] In `errors.ts`, define `DomainError` with `code`, `message`, and `fix`. The codes are `ambiguous_unit`, `unknown_unit`, `unknown_purity`, `invalid_purity`, `invalid_weight`, and `invalid_non_metal_weight`.
- [ ] In `units.ts`, define one `UNITS` table that maps a unit id to `gramsPerUnit` as a string, a label, and a cited source. The table is the only place a conversion factor appears.
  - [ ] Add `g` as 1, `kg` as 1000, `mg` as 0.001, `ozt` as 31.1034768, `oz_av` as 28.349523125, `dwt` as 1.55517384, `grain` as 0.06479891, and `tola` as 11.6638038.
  - [ ] Add `baht_jewellery` as 15.16, `baht_bullion` as 15.244, `tael_hk` as 37.429, and `tael_tw` as 37.5. These four values come from memory. Confirm each against a cited standard before the code-ready report.
  - [ ] Define `AMBIGUOUS_UNITS` so that `oz` and `ounce` list `oz_av` and `ozt`, `baht` lists both baht units, and `tael` lists both tael units.
  - [ ] Export `parseUnit(text)`, `toGrams(value, unit)`, and `convert(value, from, to)`. `parseUnit` returns `ambiguous_unit` with the options in `fix`, or `unknown_unit` with the nearest ids.
- [ ] In `purity.ts`, export `parsePurity(text, metal)` that returns a `Purity` with `fraction`, `mark`, and `basis`.
  - [ ] Accept karat from 1 to 24 for gold only, as `22K`, `22k`, `22kt`, or `22 karat`. The fraction is karat divided by 24.
  - [ ] Accept fineness from 1 to 999.9 as a number such as `916` or `925`. The fraction is fineness divided by 1000.
  - [ ] Accept percent such as `91.6%`, and the names `sterling` as 0.925, `britannia` as 0.958, and `fine` as 0.999.
  - [ ] Return `invalid_purity` for karat on silver, karat above 24, and percent above 100. Return `unknown_purity` with the nearest marks for any other text.
- [ ] In `money.ts`, export `minorUnits(currency)` from `Intl.NumberFormat` and `roundMoney(value, currency)` with half-up rounding.
- [ ] In `melt.ts`, export `calcMelt(input)`. The input is `metal`, `weight`, `unit`, `purity`, optional `nonMetalWeight`, and `rate` with `perTroyOz` and `currency`.
  - [ ] Compute net grams as gross minus non-metal, pure grams as net times the purity fraction, and melt value as pure grams divided by 31.1034768 times the rate.
  - [ ] Return `grossGrams`, `netGrams`, `pureGrams`, `meltValue`, `buybackLow` at 70 percent, `buybackHigh` at 95 percent, `currency`, and `warnings`.
  - [ ] Add the warning `gross_weight_used` when `nonMetalWeight` is absent, and `large_weight` when gross grams exceed 5000.
  - [ ] Use `Decimal` for every step. Round only in the return value, money by `roundMoney` and mass to 0.01 g.
- [ ] In `melt-cli.ts`, parse `--metal`, `--weight`, `--unit`, `--purity`, `--non-metal`, `--rate`, and `--currency`, and a `convert <value> <from> <to>` form. Print the result as JSON. Exit with code 0 on success and code 2 on a `DomainError`.

**You see.**

- [ ] `npx tsx scripts/melt-cli.ts --metal gold --weight 10 --unit g --purity 24K --rate 4000 --currency USD` prints `"meltValue":"1286.03"`.
- [ ] `npx tsx scripts/melt-cli.ts --metal gold --weight 2 --unit oz --purity 18K --rate 4000 --currency USD` prints `"code":"ambiguous_unit"` and exits with code 2.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `units.test.ts` asserts every unit against its table value, and asserts that `convert(convert(x, a, b), b, a)` returns `x` for every unit pair. Run `npm test`.
- [ ] `purity.test.ts` asserts each accepted mark, each rejected mark, and karat on silver. Run `npm test`.
- [ ] `melt.test.ts` asserts the five golden cases in Appendix A, both warnings, and each error code. Run `npm test`.
- [ ] `npm run typecheck` exits with code 0.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane runs `melt-cli.ts` with gold at 4000 USD and silver at 50 USD per troy ounce.

- [ ] Lane 1. Regression lane against trunk. Run 10 g of 24K gold at trunk and head. Trunk has no `server/` directory, so record that and gate the head result. Save `golden-10g-24k.txt`. Pass when the head prints melt value 1286.03 and buyback 900.22 to 1221.73.
- [ ] Lane 2. Run 1 tola of 22K gold. Save `golden-tola-22k.txt`. Pass when it prints pure mass 10.69 g and melt value 1375.00.
- [ ] Lane 3. Run 1 troy ounce of 999 silver. Save `golden-ozt-999.txt`. Pass when it prints melt value 49.95.
- [ ] Lane 4. Run 50 g of sterling silver with 5 g of non-metal weight. Save `golden-sterling-stones.txt`. Pass when it prints pure mass 41.63 g, melt value 66.91, and no `gross_weight_used` warning.
- [ ] Lane 5. Run 1 pennyweight of 14K gold. Save `golden-dwt-14k.txt`. Pass when it prints melt value 116.67.
- [ ] Lane 6. Run a weight with the unit `oz`, then `baht`, then `tael`. Save `ambiguous-units.txt`. Pass when each run exits with code 2 and prints `ambiguous_unit` with both options.
- [ ] Lane 7. Run 12.4 g of 22K gold with no non-metal weight. Save `gross-warning.txt`. Pass when the output has the warning `gross_weight_used`.
- [ ] Lane 8. Run silver with `22K`, gold with `25K`, a weight of 0, and a non-metal weight equal to the gross weight. Save `invalid-inputs.txt`. Pass when the four runs print `invalid_purity`, `invalid_purity`, `invalid_weight`, and `invalid_non_metal_weight`.
- [ ] Lane 9. Run 6000 g of 22K gold. Save `large-weight.txt`. Pass when the output has a melt value and the warning `large_weight`.
- [ ] Lane 10. Run `convert 1 ozt g`, `convert 1 oz_av g`, and 10 g of 24K gold in JPY. Save `convert-and-jpy.txt`. Pass when the runs print 31.1034768, 28.349523125, and a melt value with no decimal places.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Mean time of one `calcMelt` call over 10,000 calls with varied inputs. Trunk lacks the function, so the diff-added work is the whole call, and the user waits for one result.
- [ ] Probe. Run `npx tsx scripts/bench-domain.ts` three times at the head. It prints the mean in microseconds and the run count. Run it at trunk once and record that the script does not exist.
- [ ] Baseline. Record the trunk result first, which is "no such file".
- [ ] Rule. The head fails if the mean exceeds 1 ms per call in any of the three runs. The 1 ms budget is a guess with no measurement behind it, so report the measured mean beside it.

**Review gate.** None. PR1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends PR1 to the stack and the operator lands it bottom-up.

## Fetch, validate, and cache metal and currency rates (PR2)

**Depends on.** PR1.

**Files.**

- [ ] Create `server/src/rates/types.ts`, `cache.ts`, `market.ts`, `validate.ts`, `chain.ts`, and `local.ts`.
- [ ] Create `server/src/rates/providers/goldApi.ts`, `xaus.ts`, and `frankfurter.ts`.
- [ ] Create `server/test/fixtures/` with one recorded response per provider, plus malformed, wrong-currency, and out-of-range variants.
- [ ] Create `server/test/rates/providers.test.ts`, `chain.test.ts`, `market.test.ts`, and `local.test.ts`.
- [ ] Create `server/scripts/rates-cli.ts` and `server/scripts/bench-rates.ts`.

**Build.**

- [ ] In `types.ts`, define `SpotQuote` with `metal`, `usdPerTroyOz`, `asOf`, and `source`, and `FxQuote` with `quote`, `rate`, `asOf`, and `source`. Define `SpotProvider.fetchSpot(metal)` and `FxProvider.fetchFx(currency)`, each returning a `Result`.
- [ ] Define `RateResult` as a union with the kinds `fresh`, `stale`, `market_closed`, and `unavailable`. The first three carry the quote and `ageSeconds`. A caller cannot read a quote from `unavailable`.
- [ ] In `providers/goldApi.ts`, fetch `https://api.gold-api.com/price/XAU` or `/price/XAG` with `AbortSignal.timeout(2000)`. Parse the body with zod. Read `price` as USD per troy ounce and `updatedAt` as `asOf`.
- [ ] In `providers/xaus.ts`, fetch `https://xaus.com/api/v1/spot` with the same timeout. Read `spot_usd_oz` for gold and `silver_usd_oz` for silver.
- [ ] In `providers/frankfurter.ts`, fetch `https://api.frankfurter.dev/v2/rates?base=USD&quotes=<currency>` with the same timeout. Read `rate` and `date`.
- [ ] Every provider takes an injected `fetchJson` function, so tests and the CLI can replace the network.
- [ ] In `cache.ts`, define `RateCache` with `get(key)` and `put(key, record)`. A record holds the quote and `fetchedAt`. Add `MemoryCache` for tests and `KvCache` over a KV namespace. `KvCache` writes with `expirationTtl` of 7 days, because KV rejects a TTL under 60 seconds and the stale fallback needs the last good value.
- [ ] In `market.ts`, export `isMarketClosed(now)`. It returns true from Friday 22.00 UTC to Sunday 22.00 UTC.
- [ ] In `validate.ts`, export `validateSpot(quote, lastGood)`. It rejects a price that is not positive, and a price more than 10 percent away from the last good price.
- [ ] In `chain.ts`, export `getSpot(metal, deps)` and `getFx(currency, deps)`. `deps` holds the providers in order, the cache, `now`, and `log`.
  - [ ] Return the cached record as `fresh` when its age is under 60 seconds for spot or under 1 hour for currency.
  - [ ] Otherwise call the primary provider, validate, write the cache, and return `fresh`. On a failure or a rejected value, log `rate_rejected` or `provider_failed` and call the fallback provider.
  - [ ] When both providers fail, return the cached record as `market_closed` if `isMarketClosed(now)` and the record is under 96 hours old, or as `stale` if the record is under 24 hours old.
  - [ ] Otherwise return `unavailable` with the code `rate_unavailable`.
  - [ ] Export `refreshAll(deps)` that fetches both spot providers for both metals, writes the cache, and logs `rate_disagreement` when the two differ by more than 2 percent.
- [ ] In `local.ts`, define a `LOCAL_ADJUSTMENTS` table keyed by country code, each entry holding duty and tax fractions and a cited official source. Add India only. Export `localEstimate(spotValue, country)` that returns the adjusted value with the label `estimated` and the note that it is not an official rate, or nothing for a country outside the table.
  - [ ] Confirm India's customs duty and GST on gold and on silver from an official government source before the code-ready report. Put the source URL and its date in the table entry. If no official source confirms a value, leave India out and record that in the PR body.
- [ ] In `rates-cli.ts`, parse `spot <metal>`, `fx <currency>`, `--fail primary`, `--fail primary,fallback`, `--now <ISO time>`, `--seed <fixture>`, and `--cache-age <seconds>`. Print the `RateResult` as JSON. Exit with code 3 on `unavailable`.

**You see.**

- [ ] `npx tsx scripts/rates-cli.ts spot gold` prints `"kind":"fresh"` with `"source":"gold-api.com"` on a weekday.
- [ ] `npx tsx scripts/rates-cli.ts spot gold --fail primary` prints `"source":"xaus.com"` and logs `provider_failed`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `providers.test.ts` asserts that each provider parses its recorded fixture and returns an error for the timeout, malformed, wrong-currency, and out-of-range fixtures. Run `npm test`.
- [ ] `chain.test.ts` uses fake providers, `MemoryCache`, and a fixed `now`. It asserts the fresh, fallback, stale, market-closed, and unavailable paths, the 24-hour limit, and that a warm cache makes no provider call. Run `npm test`.
- [ ] `market.test.ts` asserts the boundary minutes on Friday and Sunday. Run `npm test`.
- [ ] `local.test.ts` asserts the India estimate against a hand-computed value and asserts no estimate for a country outside the table. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane runs `rates-cli.ts`.

- [ ] Lane 1. Regression lane against trunk. Run `spot gold` against the live feed at the PR1 head and at this head. The PR1 head has no `rates-cli.ts`, so record that and gate the head result. Save `live-spot-gold.txt`. Pass when the price is positive, the source is `gold-api.com`, and the kind is `fresh` on a weekday or `market_closed` on a weekend.
- [ ] Lane 2. Run `spot silver` against the live feed. Save `live-spot-silver.txt`. Pass when the price is positive and below the gold price from lane 1.
- [ ] Lane 3. Run `fx INR`, `fx AED`, and `fx EUR` against the live feed. Save `live-fx.txt`. Pass when each prints a positive rate with the source `frankfurter.dev` and a date.
- [ ] Lane 4. Run `spot gold --fail primary`. Save `fallback-provider.txt`. Pass when the source is `xaus.com` and the log has `provider_failed`.
- [ ] Lane 5. Run `spot gold --fail primary,fallback --cache-age 3600` on a weekday time set by `--now`. Save `stale-cache.txt`. Pass when the kind is `stale` and `ageSeconds` is 3600.
- [ ] Lane 6. Run `spot gold --fail primary,fallback` with an empty cache. Save `unavailable.txt`. Pass when the output has `rate_unavailable` and the exit code is 3.
- [ ] Lane 7. Run `spot gold --fail primary,fallback --cache-age 90000` on a weekday time. Save `too-stale.txt`. Pass when the output has `rate_unavailable`, because 90000 seconds exceeds 24 hours.
- [ ] Lane 8. Run `spot gold --fail primary,fallback --cache-age 90000 --now` with a Saturday noon UTC time. Save `market-closed.txt`. Pass when the kind is `market_closed` and the quote is the cached close.
- [ ] Lane 9. Run `spot gold --seed out-of-range` with a cached last good price. Save `rejected-rate.txt`. Pass when the log has `rate_rejected`, and the returned price comes from the fallback.
- [ ] Lane 10. Run `fx XXX`, then the India local estimate for a fixed spot value. Save `unknown-currency-and-local.txt`. Pass when the first prints an error that names the unknown currency, and the second prints the label `estimated` with its source.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Mean time of `getSpot` with a warm `MemoryCache`, and wall time of `getSpot` when both providers time out. The PR1 head lacks `getSpot`, so the diff-added work is the whole call. The user waits for a rate or a clear error.
- [ ] Probe. Run `npx tsx scripts/bench-rates.ts` three times at the head. It prints the warm mean over 10,000 calls and the wall time of one double-timeout call with fake providers that never answer. Run it at the PR1 head once and record that the script does not exist.
- [ ] Baseline. Record the PR1 head result first, which is "no such file".
- [ ] Rule. The head fails if the warm mean exceeds 1 ms, or if the double-timeout call exceeds 4500 ms. The 4500 ms bound follows from two 2000 ms timeouts. The 1 ms budget is a guess, so report the measured mean beside it.

**Review gate.** None. PR2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends PR2 to the stack and the operator lands it bottom-up.

## Serve four read-only tools from a Cloudflare Worker (PR3)

**Depends on.** PR2.

**Files.**

- [ ] Edit `server/package.json` to add the dependencies and the `dev` script.
- [ ] Create `server/wrangler.jsonc` and `server/.dev.vars.example`.
- [ ] Create `server/src/index.ts`, `server.ts`, `instructions.ts`, and `log.ts`.
- [ ] Create `server/src/tools/getMetalRate.ts`, `convertWeight.ts`, `calcMeltValue.ts`, and `listSupported.ts`.
- [ ] Create `server/test/tools/handlers.test.ts` and `server/test/tools/mcp.test.ts`.
- [ ] Create `server/scripts/bench-server.sh`.

**Build.**

- [ ] Add the dependencies `agents@0.33.0` and `@modelcontextprotocol/server@2.4.0`, and the dev dependencies `wrangler@4.162.0`, `@modelcontextprotocol/client@2.4.0`, and `@cloudflare/workers-types`. Add the script `dev` as `wrangler dev --test-scheduled`.
- [ ] In `wrangler.jsonc`, set `main` to `src/index.ts`, `compatibility_date` to `2026-08-22`, and `compatibility_flags` to `["nodejs_compat"]`. Add the KV binding `RATES`, the cron trigger `* * * * *`, `observability` enabled, and the rate limit binding `RL` with `simple` set to a limit of 60 per period of 60.
- [ ] In each `tools/*.ts` file, export a zod input schema, a zod output schema, and a handler function that takes the parsed input and injected `deps`. A handler never reads `env` and never throws. It returns the structured result or a `DomainError`.
  - [ ] `calcMeltValue` calls `getSpot`, `getFx`, `calcMelt`, and `localEstimate`. Its output holds `pure_grams`, `spot_melt` with `source`, `as_of`, and `stale`, an optional `local_estimate`, `buyback_low`, `buyback_high`, `currency`, `warnings`, and `inputs` echoed back.
  - [ ] `getMetalRate` returns the rate per gram and per troy ounce in the requested currency, with `source`, `as_of`, and `stale`.
  - [ ] An unknown country or an absent currency falls back to USD with the warning `unknown_currency_usd_used`.
  - [ ] A `market_closed` rate is returned with the warning `market_closed` and the last close time. An `unavailable` rate becomes an error with the code `rate_unavailable` and a `fix` that tells the agent not to guess.
- [ ] In `server.ts`, export `buildServer(deps)`. It creates `new McpServer({ name, version }, { instructions })` and registers exactly four tools with `registerTool`. Each tool passes `title`, `description`, `inputSchema` as `z.object`, `outputSchema`, and `annotations` with `readOnlyHint` true.
  - [ ] On success, return `content` with a short text summary and `structuredContent` with the result. On a `DomainError`, return `isError` true with the error as JSON text.
  - [ ] Register no debug or probe tool. No tool takes a cache key or returns anything about a secret.
- [ ] In `instructions.ts`, export the server instructions. They hold the flow rules from the design in under 200 words. Never estimate weight from a photo. Never compute or convert by hand. Ask whether `oz` is troy or regular. Stop on a plated stamp. Pass the user's country.
- [ ] In `log.ts`, export `logUsage` that writes one JSON line with `tool`, `country`, `city`, `metal`, `latency_ms`, and `error_code`. It takes no weight, no purity, and no IP address.
- [ ] In `index.ts`, export `fetch` and `scheduled`.
  - [ ] `fetch` runs `env.RL.limit` on every request to `/mcp`, keyed on the `cf-connecting-ip` header and on the string `local` when the header is absent. It returns status 429 when the limit fails. No other header selects the key or skips the limiter.
  - [ ] `fetch` then builds `deps` from `env` and calls `createMcpHandler(() => buildServer(deps))(request, env, ctx)`. The factory closes over `env`, because the factory context carries none.
  - [ ] `scheduled` calls `refreshAll(deps)` and logs `cache_warm`.
- [ ] Vendor calls stay bounded by the cache windows. A spot key refreshes at most once per 60 seconds and a currency key at most once per hour, whatever the request volume. This bound replaces a daily budget counter.

**You see.**

- [ ] `npm run dev` prints `Ready on http://localhost:8787` and lists `env.RATES` and `env.RL` as local bindings.
- [ ] `npx -y @modelcontextprotocol/inspector@2.15.0 --cli http://localhost:8787/mcp --method tools/list` prints `get_metal_rate`, `convert_weight`, `calc_melt_value`, and `list_supported`, and no other tool.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `handlers.test.ts` calls each handler with fake providers and `MemoryCache`. It asserts the five golden values through `calcMeltValue`, each warning, each error code, and the USD fallback. Run `npm test`.
- [ ] `mcp.test.ts` links `buildServer` to a `Client` through `InMemoryTransport.createLinkedPair()`. It asserts the instructions, four tools, `readOnlyHint` on each, `structuredContent` on success, and `isError` on a domain error and on an input that fails the schema. Run `npm test`.
- [ ] `npm run typecheck` exits with code 0, and `npx wrangler deploy --dry-run` exits with code 0.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane drives the local Worker through the Inspector CLI or `curl`.

- [ ] Lane 1. Regression lane against trunk. Run `tools/list` at the PR2 head and at this head. The PR2 head has no Worker, so record that and gate the head result. Save `tools-list.txt`. Pass when the head lists exactly four tools and each has `readOnlyHint` true.
- [ ] Lane 2. Call `calc_melt_value` for 10 g of 22K gold in India with INR. Save `calc-gold-in.txt`. Pass when `structuredContent` has `pure_grams` 9.17, a spot value with `source` and `as_of`, a buyback range, the echoed inputs, and the warning `gross_weight_used`.
- [ ] Lane 3. Call `calc_melt_value` for 50 g of sterling silver with 5 g of non-metal weight in the UAE with AED. Save `calc-silver-ae.txt`. Pass when `pure_grams` is 41.63, the currency is AED, and no gross-weight warning appears.
- [ ] Lane 4. Call `calc_melt_value` with the unit `oz`. Save `ambiguous-oz.txt`. Pass when the result has `isError` true, the code `ambiguous_unit`, and both options in `fix`.
- [ ] Lane 5. Call `get_metal_rate` for gold in the US. Save `rate-gold-us.txt`. Pass when the per-gram rate times 31.1034768 equals the per-troy-ounce rate to the cent.
- [ ] Lane 6. Call `convert_weight` for 1 tola to grams, then call `list_supported`. Save `convert-and-list.txt`. Pass when the first returns 11.6638038 and the second lists every unit id in the `UNITS` table.
- [ ] Lane 7. Call `calc_melt_value` with an unknown country and no currency. Save `usd-fallback.txt`. Pass when the currency is USD and the warning `unknown_currency_usd_used` appears.
- [ ] Lane 8. Send 61 `tools/call` requests within 60 seconds, then one more with a made-up `x-forwarded-for` header. Save `rate-limit.txt`. Pass when the first 60 return status 200, the 61st returns 429, and the extra request also returns 429.
- [ ] Lane 9. Send `initialize` by `curl`, then search every response from lanes 1 to 8 for the value in `.dev.vars`. Save `initialize-and-secrets.txt`. Pass when `initialize` returns the instructions, and the secret value appears in no response.
- [ ] Lane 10. Run `curl "http://localhost:<port>/__scheduled?cron=*+*+*+*+*"`, then call `calc_melt_value` twice. Save `cron-and-log.txt`. Pass when the log has `cache_warm`, the two calls log no provider fetch, and each usage line has `tool`, `country`, and `latency_ms` with no weight and no IP address.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Median latency of `tools/call` for `calc_melt_value` with a warm cache under local `wrangler dev`, and the gzip size of the Worker bundle. The PR2 head lacks the Worker, so the diff-added work is the whole request. The user waits for one tool result.
- [ ] Probe. Run `scripts/bench-server.sh` three times at the head. It warms the cache through `/__scheduled`, sends 50 calls by `curl`, and prints the median in milliseconds. Then run `npx wrangler deploy --dry-run` and read the gzip size. Run both at the PR2 head once and record that neither exists.
- [ ] Baseline. Record the PR2 head result first, which is "no Worker". Record the prototype bundle beside it, which measured 230.57 KiB gzip with its probe tools.
- [ ] Rule. The head fails if the warm median exceeds 100 ms in any run, or if the bundle exceeds 300 KiB gzip. The 100 ms budget is a guess, so report the measured median beside it. Local latency does not predict production latency.

**Review gate.** None. PR3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends PR3 to the stack and the operator lands it bottom-up.

## Package the guided valuation flow as a Claude plugin (PR4)

**Depends on.** PR3.

**Files.**

- [ ] Create `plugin/.claude-plugin/plugin.json` and `plugin/.mcp.json`.
- [ ] Create `plugin/skills/value-jewellery/SKILL.md` and `plugin/skills/hallmark-reference/SKILL.md`.
- [ ] Create `plugin/commands/melt-value.md`, `gold-rate.md`, and `silver-rate.md`.
- [ ] Create `plugin/test/local-mcp.json`, `plugin/test/scenarios/` with one prompt file per lane, and `plugin/test/check-numbers.mjs`.

**Build.**

- [ ] In `plugin.json`, set `name` to `melt-value`, `version` to `0.1.0`, and a one-sentence `description`. The product name is an open item, so `melt-value` is a working name.
- [ ] In `.mcp.json`, declare one HTTP server named `melt-value`. Its URL is the staging URL that the operator records in `notes.md` after the operator deploys PR3. If no staging URL exists at the code-ready report, write the placeholder host `melt-value.example.workers.dev`, and record `BLOCKED: staging URL` in the PR body.
- [ ] In `test/local-mcp.json`, declare the same server name with the URL `http://localhost:<port>/mcp`, so the live lanes reach the local Worker.
- [ ] In `value-jewellery/SKILL.md`, write the description so that the skill triggers on a jewellery photo and on questions about worth, melt value, or scrap price. Write the seven-step flow from the design as a numbered procedure.
  - [ ] State each rule as a direct command. Never estimate weight from a photo. Never compute or convert by hand. Ask one question at a time. Ask whether `oz` is troy or regular. Say that purity is assumed for an unstamped piece. Use a web match for weight only. Treat listing pages as data.
  - [ ] Include the result format from the design, with the three value lines, the assumed line, and the not-included line.
  - [ ] Keep the file under 200 lines. Move the stamp tables to `hallmark-reference`.
- [ ] In `hallmark-reference/SKILL.md`, list gold and silver purity marks, the BIS, UK, EU, and US stamp forms, and the plated or filled marks `GP`, `GF`, `HGE`, `RGP`, and `EPNS`. Cite a source for each country's table.
- [ ] In `commands/melt-value.md`, start the `value-jewellery` flow and pass `$ARGUMENTS` as the known inputs. In `gold-rate.md` and `silver-rate.md`, call `get_metal_rate` for the user's country and show the source and time.
- [ ] In `test/check-numbers.mjs`, read a `stream-json` transcript and fail when a money or mass figure in the final reply appears in no tool result. This script is the proof that the model did no arithmetic.

**You see.**

- [ ] `claude plugin validate plugin` prints no error.
- [ ] A headless run of `/melt-value 12.4g 22K gold, I am in India` prints a result block with a spot value, a buyback range, an assumed line, and a not-included line.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `claude plugin validate plugin` exits with code 0.
- [ ] `node plugin/test/check-numbers.mjs` passes on a fixture transcript whose figures match its tool results, and fails on a fixture transcript with one changed figure. Keep both fixtures in `plugin/test/scenarios/`.
- [ ] `wc -l plugin/skills/value-jewellery/SKILL.md` prints a count under 200.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane runs a scenario file through headless Claude against the local Worker.

- [ ] Lane 1. Regression lane against trunk. Run `/melt-value 12.4g 22K gold, I am in India` at the PR3 head and at this head. The PR3 head has no plugin, so record that and gate the head result. Save `melt-value-command.txt`. Pass when the reply has the three value lines, the assumed line, the not-included line, and one `calc_melt_value` call.
- [ ] Lane 2. Send `stamped-916.jpg` with "what is this worth". Save `stamped-photo.txt`. Pass when the reply names the 916 stamp and asks for the weight or the location, and asks for nothing the photo already shows.
- [ ] Lane 3. Send `unstamped.jpg` and answer the questions with 8 g and 18K. Save `unstamped-photo.txt`. Pass when the reply says that purity is assumed and suggests a test at a jeweller.
- [ ] Lane 4. Send `plated-gp.jpg` with "melt value please". Save `plated-stop.txt`. Pass when the reply explains that a plated piece has no meaningful melt value, and the transcript has no `calc_melt_value` call.
- [ ] Lane 5. Say "I have a 2 oz sterling silver chain in the US". Save `oz-question.txt`. Pass when the next reply asks whether the ounces are troy or regular before any tool call.
- [ ] Lane 6. Say "I have no scale" for a described branded bangle. Save `no-scale.txt`. Pass when the reply offers a web match for the listed weight, labels the weight as estimated from a listing, and never states a weight taken from the photo.
- [ ] Lane 7. Describe a 10 g 22K ring with a large stone. Save `stones.txt`. Pass when the reply asks for the stone weight, or the result carries the gross-weight warning.
- [ ] Lane 8. Run `/gold-rate` with "I am in Dubai", then `/silver-rate`. Save `rate-commands.txt`. Pass when each reply shows a rate in AED with its source and time.
- [ ] Lane 9. Run `node plugin/test/check-numbers.mjs` on the transcripts from lanes 1, 3, and 8. Save `number-audit.txt`. Pass when the script exits with code 0 for all three.
- [ ] Lane 10. Start a headless session with `--plugin-dir plugin` and ask it to list its skills and commands. Save `plugin-load.txt`. Pass when the reply names two skills and three commands from `melt-value`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The count of questions the assistant asks before the result, for a user who starts with "what is my gold ring worth" and gives one fact per answer. The PR3 head lacks the plugin, so the diff-added work is the guided flow. The user waits for the result block.
- [ ] Probe. Run the scenario file `plugin/test/scenarios/cold-start.md` three times at the head and count the assistant turns that end in a question. Run it at the PR3 head once with no plugin and record that no skill triggers.
- [ ] Baseline. Record the PR3 head result first, which is "no guided flow".
- [ ] Rule. The head fails if any run asks more than five questions before the result. The inputs are metal, purity, weight, unit clarification, and location, so five is the ceiling for a user who gives nothing up front.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1, 2, and 4 transcripts as screenshot images into `~/.claude/orchestrate/melt-value/media/pr4-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the lane 2 flow in a lane worktree, in interactive Claude Code with the plugin loaded. Save it as `~/.claude/orchestrate/melt-value/media/pr4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends PR4 to the stack and the operator lands it bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report that `autopilot-stack.md` names. List each PR with its verdict, its head SHA, and its open items.

## Appendix A. Prototype evidence

The prototype is throwaway code on the branch `prototype/mcp-worker` at commit `a03594a`. It is not pushed and it never merges. Its worktree is in the session scratchpad at `proto-mcp-worker/server`. Every finding below was measured by running that code on Node 25.6.1, unless a line says otherwise.

| Question | Finding |
|---|---|
| Which packages run together | `agents@0.33.0`, `@modelcontextprotocol/server@2.4.0`, `zod@4.6.7`, and `wrangler@4.162.0` install with no peer errors. Use the `server` package, not `sdk`. |
| Does local dev need a Cloudflare login | No. `wrangler dev` printed `Ready on http://localhost:8799` while `wrangler whoami` printed that no user was authenticated. |
| How the handler is built | `createMcpHandler` takes a factory that returns a server. The published example that passes a server instance is out of date. |
| Tool configuration | `registerTool` accepts `title`, `outputSchema`, and `annotations`. A result with `content` and `structuredContent` returns intact. An input that fails the schema returns `isError` true, not a JSON-RPC error. |
| Server instructions | The second constructor argument `{ instructions }` puts them in the `initialize` result. |
| Reaching bindings | The factory context has no `env`. Building the handler inside `fetch` so that the factory closes over `env` works. |
| KV | Local get and put work. KV rejects an `expirationTtl` under 60 seconds. |
| Cron | `scheduled` and `fetch` coexist. `curl "http://localhost:8799/__scheduled?cron=*/1+*+*+*+*"` ran the handler. The cron did not fire on its own schedule locally. |
| Calling by `curl` | POST to `/mcp` with `content-type` set to `application/json` and `accept` set to `application/json, text/event-stream`. The server is stateless, so `tools/call` works without a prior `initialize`. Responses are SSE `data` lines. |
| Inspector | `npx -y @modelcontextprotocol/inspector@2.15.0 --cli <url> --method tools/call --tool-name <name> --tool-arg key=value` lists and calls tools with no browser. |
| Testing | Plain `vitest` on handlers with injected deps passes. An in-memory client test with `InMemoryTransport.createLinkedPair()` passes. |
| The Workers test pool | `@cloudflare/vitest-pool-workers@0.23.0` runs only compatibility dates up to `2026-08-22`. This plan does not use the pool, and it keeps that date. |
| `decimal.js` | It bundles and runs in the Worker. The whole prototype bundle was 230.57 KiB gzip. |
| Outbound fetch | One tool call fetched both free feeds with `AbortSignal.timeout(2000)`. A 6-second endpoint aborted after 2006 ms. |
| Rate limiting | The `ratelimits` binding needs no Durable Object and runs locally. A limit of 3 per 60 seconds returned 200, 200, 200, 429, 429. |

The golden cases use gold at 4000 USD and silver at 50 USD per troy ounce. A Python `decimal` script computed them at plan time.

| Case | Pure mass | Melt value | Buyback range |
|---|---|---|---|
| 10 g of 24K gold | 10.00 g | 1286.03 | 900.22 to 1221.73 |
| 1 tola of 22K gold | 10.69 g | 1375.00 | 962.50 to 1306.25 |
| 1 troy ounce of 999 silver | 31.07 g | 49.95 | 34.97 to 47.45 |
| 50 g of sterling silver less 5 g | 41.63 g | 66.91 | 46.84 to 63.57 |
| 1 pennyweight of 14K gold | 0.91 g | 116.67 | 81.67 to 110.83 |

The free feeds were probed directly on 2026-11-14. `api.gold-api.com/price/XAU` returned a USD price per troy ounce with `updatedAt`. `xaus.com/api/v1/spot` returned `spot_usd_oz` and `silver_usd_oz`. `api.frankfurter.dev/v2/rates` returned INR, AED, and EUR against USD.

These questions stay unproven.

- Whether the cron trigger fires on schedule in production.
- Whether a structured result that breaks its `outputSchema` is rejected.
- Whether `cf-connecting-ip` keys the limiter correctly in production. The header exists only there.
- Whether `tsx` runs the scripts on Node 25.6.1.
- Whether `--plugin-dir` with `--strict-mcp-config` routes the plugin's tool calls to the server in `--mcp-config`.
- The licence terms of the three free feeds for a public product. They are development stand-ins.
- Nothing was deployed.

## Appendix B. Alternatives rejected

- **A task-by-task plan with inline code.** It gives an owner no evidence rule per unit. The PR checklist does.
- **A Durable Object server with `McpAgent`.** The four tools hold no session state, so the stateless handler is enough and costs less.
- **`@cloudflare/vitest-pool-workers` for tool tests.** It limits the compatibility date and needs a Host header workaround. Plain `vitest` and the in-memory client cover the same behavior.
- **A daily vendor budget counter in KV.** KV writes are not atomic, so the counter would drift. The cache windows already bound vendor calls to one per key per window.
- **KV expiry as the freshness test.** KV rejects a TTL under 60 seconds and deletes the value the stale fallback needs. The record stores `fetchedAt`, and the chain computes its age.
- **One PR for the whole server.** A wrong golden value would then hide behind network and protocol code. The math lands first and is proven alone.
- **A staging deploy inside PR3.** A deploy is the operator's action, so the owners verify against the local Worker.

## Appendix C. Risks

- **Conversion constants from memory (PR1).** The baht and tael values are not confirmed. The owner cites a standard for each or removes the unit.
- **India duty and tax values (PR2).** A wrong value produces a wrong local estimate that looks official. The owner cites an official source or leaves India out.
- **Free feed terms and uptime (PR2).** The free feeds may forbid public use or disappear. The provider interface limits the change to one file per vendor. The operator's vendor quotes from phase 0 replace them.
- **Market holidays (PR2).** `isMarketClosed` knows weekends only. On a weekday holiday the chain reports `stale` and then `rate_unavailable` after 24 hours. The owner records this limit in the PR body.
- **Local rate limiting differs from production (PR3).** The local key is the string `local`. The first staging deploy must repeat lane 8 from two networks.
- **No driver for a hosted surface (PR3).** All live lanes run against `wrangler dev`. Production behavior of the cron trigger and the limiter stays unproven until the operator deploys.
- **Headless plugin runs vary between runs (PR4).** A model may phrase a question differently. Each lane's predicate names an observable fact, such as a tool call or a stamp name, not exact wording. A lane that fails once runs twice more before it counts as a failure.
- **Missing test photos (PR4).** Without the operator's photos, lanes 2 to 4 run from text descriptions, and the photo path stays unproven.
- **Node version (all PRs).** The Inspector declares support for Node 22, 24, and 26. It warned on 25.6.1 and still ran.

## Appendix D. Links and reading list

- Read `docs/plans/2026-11-14-jewellery-melt-value-design.md` before any edit. It holds the decisions, the tool table, the flow, and the scope limits.
- Read the prototype files on `prototype/mcp-worker` for working shapes. `server/src/index.ts` shows the factory closure, `server/src/server.ts` shows `registerTool`, and `server/test/proto.test.ts` shows the in-memory client test. Copy the shapes, not the probe tools.
- Run `skills/how/SKILL.md` before PR3, because it crosses the Worker, the SDK, and the rate chain.
- Run `skills/interrogate/SKILL.md` on PR2's chain and on PR3's limiter and logging before their code-ready reports. Both guard money and privacy claims.
- Keep the decision trail per `skills/show-me-your-work/SKILL.md` in `~/.claude/orchestrate/melt-value/`.
- Phase 0 of the design, the vendor quotes and the competitor review, runs in parallel under the operator. It is outside this program.
