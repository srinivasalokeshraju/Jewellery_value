# Melt value

A person gives a metal, a weight with its unit, a purity, and their country, and the server answers with the pure metal weight, the melt value at spot in their currency, a likely buyer range, where the rates came from, and any warnings. Input it cannot read comes back as an error with `code`, `message`, and `fix`.

## Sub-features

- `calc-gold` values a gold piece by karat or fineness in a local currency.
- `calc-silver` values a silver piece by name or fineness.
- `calc-stones` subtracts `non_metal_weight` before the purity is applied.
- `calc-gross-warning` warns when no stone weight was given.
- `calc-refuse-unit` refuses an ambiguous unit such as `oz`.
- `calc-refuse-purity` refuses a purity mark it does not know, such as a plating stamp.

## How to get to it (user POV)

- A host calls `calc_melt_value` over `/mcp`, usually after the plugin's `value-jewellery` skill has asked for the weight and the stamp.
- The `/melt-value` plugin command, which ends in the same call.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes for the current run.

- **Gold in rupees.** Run `$V call calc_melt_value '{"metal":"gold","weight":10,"unit":"g","purity":"22K","country":"IN","currency":"INR","non_metal_weight":0}' calc-22k-in`. `isError` is false, `pure_grams` is `"9.17"`, `currency` is `"INR"`, `spot_melt.value` is a decimal string, `rates.spot.source` and `rates.currency.pair` (`"USD/INR"`) are present.
- **Silver by name.** Run `$V call calc_melt_value '{"metal":"silver","weight":20,"unit":"g","purity":"sterling","country":"US","currency":"USD"}' calc-sterling-us`. `pure_grams` is `"18.50"`, and `warnings` holds `gross_weight_used` because no stone weight was given.
- **Stones subtracted.** Run `$V call calc_melt_value '{"metal":"gold","weight":5,"unit":"g","purity":"18K","country":"US","currency":"USD","non_metal_weight":1}' calc-18k-stones`. `pure_grams` is `"3.00"` (4 g of metal at 750), and `warnings` has no `gross_weight_used`.
- **Bare ounce refused.** Run `$V call calc_melt_value '{"metal":"gold","weight":1,"unit":"oz","purity":"22K","country":"US"}' calc-bare-oz`. `isError` is true and the text is JSON with `code` `"ambiguous_unit"` and a `fix` naming `oz_av` and `ozt`.
- **Plating stamp refused.** Run `$V call calc_melt_value '{"metal":"gold","weight":5,"unit":"g","purity":"GP","country":"US"}' calc-gp`. `isError` is true with `code` `"unknown_purity"`.
- **Side effects.** Run `$V kv`. It lists `spot:gold`, `spot:silver`, `fx-codes:frankfurter.dev`, and an `fx:<currency>` key for each non-USD currency used. Run `$V logs 20`. It shows a `usage` line per call with `tool`, `country`, `metal`, and `error_code`, and no weight.

## Gotchas

- The server does not detect plating. A `GP`, `GF`, `HGE`, or `RGP` stamp reaches the server only as an unknown purity. Refusing to value plated pieces is the plugin skill's job, so prove that in [Plugin](./plugin.md).
- The `unknown_purity` fix for `GP` suggests nearest marks such as `9K`, `24K`, and `22K`. Check that the fix text stays true for the input before you approve a change to it.
- `currency_unverified` appears on the first currency rate a fresh KV sees, because no earlier rate confirmed it. It is expected on a new run. It should clear after a later provider date confirms the rate.
- A missing `currency` falls back to USD with a warning. Pass `currency` unless that fallback is the case under test.
- Money figures change every run. Never assert `spot_melt.value` or the buyer range as fixed strings.
