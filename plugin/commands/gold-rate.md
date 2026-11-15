---
description: Show the current gold price where you are
argument-hint: [location]
---

Show the person the current price of pure gold.

The person's words about where they are: $ARGUMENTS

1. Find the person's country from their words or the conversation. If you cannot tell, ask where they are, and wait for the answer.
2. Work out the ISO 4217 code of the person's currency, such as `INR` for India or `AED` for the United Arab Emirates. If you cannot tell the currency, ask. If the person cannot name one, leave `currency` out, and repeat the server's warning that values are in US dollars.
3. Call `get_metal_rate` with `metal` set to `gold`, the country, and the currency, if you have one.
4. Show the price per gram and per troy ounce exactly as the result writes them, with the currency, the source, and the time. Do not round or convert any figure. Add nothing the result does not say, such as making charges, shop prices, or the purity of a grade.
5. Repeat every entry in `warnings` in plain words, at the strength the server gave it. Add nothing the warning does not say, such as when a market reopens.
6. If the call returns an error, never estimate. Tell the person, in plain words, what the error's `fix` says. On `rate_busy`, call `get_metal_rate` once more after a few seconds.
