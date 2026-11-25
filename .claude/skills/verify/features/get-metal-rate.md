# Metal rate

A person asks for today's gold or silver price, and the server answers with the pure-metal price per gram and per troy ounce in their currency, the provider and time of the spot price, the currency conversion used, and any warnings about age or confirmation.

## Sub-features

- `rate-usd` returns a spot price in US dollars with no conversion.
- `rate-local` converts to a local currency and names the pair and its date.
- `rate-provenance` reports `source`, `as_of`, `as_of_text`, `kind`, `age_seconds`, and `unverified` for each rate.
- `rate-fallback` answers from the next provider or the cache when the primary fails.

## How to get to it (user POV)

- A host calls `get_metal_rate` over `/mcp`.
- The plugin's rate commands, which end in the same call.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes for the current run.

- **Gold in dollars.** Run `$V call get_metal_rate '{"metal":"gold","country":"US","currency":"USD"}' rate-gold-usd`. `currency` is `"USD"`, `per_gram` and `per_troy_oz` are decimal strings, `rates.spot.source` is `gold-api.com` or `xaus.com`, and there is no `rates.currency`. A `spot_unverified` warning appears when only one spot provider answered.
- **Silver in rupees.** Run `$V call get_metal_rate '{"metal":"silver","country":"IN","currency":"INR"}' rate-silver-in`. `currency` is `"INR"`, `rates.currency.pair` is `"USD/INR"`, and the text content names both sources and dates.
- **Cache reuse.** Within 60 s, repeat the gold call with label `rate-gold-usd-2`. `rates.spot.age_seconds` is the same or higher and `$V logs 20` shows no new `provider_fetch` line for `api.gold-api.com` between the two calls.
- **Fallback chain.** From `server/`, run `npx tsx scripts/rates-cli.ts spot gold --fail primary` and `npx tsx scripts/rates-cli.ts spot gold --fail primary,fallback --cache-age 600`. The first logs `provider_failed` for gold-api.com and answers `kind` `"fresh"` from `xaus.com` with `unverified: true`. The second logs both failures and answers `kind` `"stale"` from the cache with `ageSeconds` 600. Save each output into `$EVIDENCE` with `>`.

## Gotchas

- `rates-cli` runs the rate chain in-process with its own memory cache. It proves the fallback logic, not the Worker. The Worker path is the `call` steps above.
- `currency_unverified` is expected on the first conversion in a fresh run.
- From Friday 22:00 UTC to Sunday 22:00 UTC the market is closed, and `kind` is `"market_closed"` in place of `"fresh"` or `"stale"`.
- With no cached reference, the first spot read fetches both providers at once, so the log shows a `provider_fetch` for each.
- A provider outage shows as `rate_unavailable` with a `fix`. Report it as an outage with the error, and do not retry in a loop: each retry spends the rate limit.
- Live prices move between calls. Compare `source` and the shape of the figures, not their values.
