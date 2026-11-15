# Privacy policy

This policy covers the melt-value Claude plugin and the melt-value server at `https://melt-value.srinivasalokeshraju.workers.dev/mcp`.

## What the server receives

When Claude calls a melt-value tool, the server receives the tool inputs: the metal, the weight and its unit, the purity, the country, the city, and the currency. It does not receive your name, your contact details, your photos, or your conversation. When you share a photo with Claude, the photo stays in your conversation and is never sent to this server.

## What the server logs

For each tool call, the server writes one usage line with the tool name, the country, the city, the metal, the time taken, and any error code. It does not log the weight or the purity. It does not log any identifier for you.

The server also logs the host name of each rate provider it contacts.

## What the server shares

To get prices, the server asks these public rate providers for the spot price of a metal or for exchange rates between currencies:

- `api.gold-api.com`
- `xaus.com`
- `api.frankfurter.dev`

These requests contain a metal symbol or currency codes only. They contain nothing you entered about your piece.

## Hosting

The server runs on Cloudflare Workers. Cloudflare processes each request, including your IP address, to deliver it. The server uses the IP address only to apply a rate limit and does not store it. Cloudflare's own handling of request data is described in the [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/).

## Accounts and cookies

The server has no accounts, no login, and no cookies.

## Contact

To ask about this policy, open an issue at <https://github.com/srinivasalokeshraju/Jewellery_value/issues>.
