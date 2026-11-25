# Rate refresh

On the deployed Worker a cron trigger runs every minute and writes fresh gold and silver spot prices to KV, so a person's first call is answered from a warm cache. Locally the same handler runs when the run fires `/__scheduled`.

## Sub-features

- `refresh-warm` asks both spot providers for each metal at once and writes `spot:gold` and `spot:silver` to KV. If the two prices disagree, it writes nothing for that metal.
- `refresh-log` logs one `cache_warm` line naming the provider written for each metal.

## How to get to it (user POV)

- Nobody calls it. Its effect is that a later `get_metal_rate` or `calc_melt_value` reports a recent `as_of` without a new provider fetch.

## Driving it with verify.sh

Preconditions:

- A fresh run: `$V up`, then `$V kv` prints `[]`.

- **Fire the cron.** Run `$V scheduled`. The saved line is `{"event":"cache_warm","outcomes":[{"metal":"gold","written":"<provider>"},{"metal":"silver","written":"<provider>"}]}`. A metal with no accepted quote appears as `{"metal":"<metal>"}` with no `written`.
- **Check KV.** Run `$V kv`. It lists exactly `spot:gold` and `spot:silver`, and no `fx:` key.
- **Warm read.** Run `$V call get_metal_rate '{"metal":"gold","country":"US","currency":"USD"}' refresh-warm-read`. `rates.spot.kind` is `"fresh"`, and `$V logs 10` shows no `provider_fetch` line after the `cache_warm` line. A `provider_fetch` line names only the host, not the metal, so check for none at all. The refresh itself logs 4 of them: 2 providers for each of 2 metals.

## Gotchas

- The handler spaces its provider calls, so `$V scheduled` waits 2 s before it reads the log. If it reports no `cache_warm` line, run `$V logs` after a few seconds.
- The cron does not warm currency rates. `fx:<currency>` keys appear only after a call that converts.
