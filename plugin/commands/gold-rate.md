---
description: Show the current gold price where you are
argument-hint: [location]
---

Show the person the current price of pure gold.

The person's words about where they are: $ARGUMENTS

1. Find the person's country from their words or the conversation. If you cannot tell, ask where they are, and wait for the answer.
2. Work out the ISO 4217 code of the person's currency, such as `INR` for India or `AED` for the United Arab Emirates.
3. Call `get_metal_rate` with `metal` set to `gold`, the country, and the currency.
4. Show the price per gram and per troy ounce exactly as the result writes them, with the currency, the source, and the time. Do not round or convert any figure.
5. Repeat every entry in `warnings` in plain words.
