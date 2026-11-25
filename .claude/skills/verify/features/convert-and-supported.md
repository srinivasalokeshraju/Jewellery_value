# Units and marks

A person converts a weight between jewellery units, such as tola to grams, and a host asks which units, ambiguous unit names, and purity marks the server accepts. Neither tool needs a rate, so both answer the same on every run.

## Sub-features

- `convert-weight` converts between any two unit ids and returns the result as a string.
- `supported-units` lists each unit id with its label and grams per unit.
- `supported-ambiguous` lists names such as `oz`, `baht`, and `tael` with the unit ids to ask between.
- `supported-marks` lists the purity marks for gold and silver and the forms a purity can take.

## How to get to it (user POV)

- A host calls `convert_weight` or `list_supported` over `/mcp`.
- The plugin calls `list_supported` to match a person's words to a unit id. Stamps are read with the `hallmark-reference` skill, not with this tool.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes for the current run.

- **Tola to grams.** Run `$V call convert_weight '{"value":1,"from_unit":"tola","to_unit":"g"}' convert-tola-g`. `value` and `grams` are both `"11.6638038"`.
- **Troy ounce to grams.** Run `$V call convert_weight '{"value":1,"from_unit":"ozt","to_unit":"g"}' convert-ozt-g`. `value` is `"31.1034768"`.
- **Ambiguous unit.** Run `$V call convert_weight '{"value":1,"from_unit":"oz","to_unit":"g"}' convert-bare-oz`. `isError` is true, and `content[0].text` is JSON with `code` `"ambiguous_unit"` and a `fix` that names `oz_av` and `ozt`. An error has no `structuredContent`.
- **Unknown unit.** Run `$V call convert_weight '{"value":1,"from_unit":"stone","to_unit":"g"}' convert-unknown`. `isError` is true with `code` `"unknown_unit"`.
- **Supported list.** Run `$V call list_supported '{}' supported`. `structuredContent` has `units`, `ambiguous_units`, `purity_marks` (with `gold` and `silver`), `purity_forms`, and `local_estimate_countries`. `ambiguous_units` includes `oz` with options `oz_av` and `ozt`.

## Gotchas

- These tools fetch no rate, so `$V kv` stays empty after them. A KV key here means another tool ran.
- `convert_weight` rounds to at most 10 decimals. Compare the string exactly.
- `local_estimate_countries` is empty today. A change that adds a country must show it here.
