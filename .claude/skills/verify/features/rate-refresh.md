# Rate refresh

On the deployed Worker a cron trigger runs every minute and writes fresh gold and silver spot prices to KV, so a person's first call is answered from a warm cache. Locally the same handler runs when the run fires `/__scheduled`.

## Sub-features

- `refresh-warm` writes `spot:gold` and `spot:silver` to KV from the first provider that answers.
- `refresh-log` logs one `cache_warm` line naming the provider written for each metal.

## How to get to it (user POV)

- Nobody calls it. Its effect is that a later `get_metal_rate` or `calc_melt_value` reports a recent `as_of` without a new provider fetch.

## Driving it with verify.sh

Preconditions:

- A fresh run: `$V up`, then `$V kv` prints `[]`.

- **Fire the cron.** Run `$V scheduled`. The saved line is `{"event":"cache_warm","outcomes":[{"metal":"gold","written":"<provider>"},{"metal":"silver","written":"<provider>"}]}`.
- **Check KV.** Run `$V kv`. It lists `spot:gold` and `spot:silver`.
- **Warm read.** Run `$V call get_metal_rate '{"metal":"gold","country":"US","currency":"USD"}' refresh-warm-read`. `rates.spot.kind` is `"fresh"`, and `$V logs 10` shows no `provider_fetch` for gold after the `cache_warm` line.

## Gotchas

- The handler spaces its provider calls, so `$V scheduled` waits 2 s before it reads the log. If it reports no `cache_warm` line, run `$V logs` after a few seconds.
- The cron does not warm currency rates. `fx:<currency>` keys appear only after a call that converts.
