# melt-value

Estimate the melt value of gold and silver jewellery in your own currency. A remote MCP server computes every number from the live spot price and exchange rate, and names the source and time of each rate. The model computes none.

## Install

### Claude Code

```
/plugin install melt-value --marketplace srinivasalokeshraju/Jewellery_value
```

The plugin adds a guided valuation flow, a hallmark reference, and the `/melt-value`, `/gold-rate`, and `/silver-rate` commands. See [plugin/README.md](plugin/README.md).

### Any MCP client

Add the server by URL:

```
https://mcp.meltvalue.dev/mcp
```

It uses the streamable HTTP transport and needs no account or API key. It offers four tools: `calc_melt_value`, `get_metal_rate`, `convert_weight`, and `list_supported`.

## Example

> **You:** I have a 22K gold chain, 20 grams, in Hyderabad. What is it worth?

> **Claude:**
>
> ```
> 22K gold chain, 20 g
>
> Pure gold content        18.33 g
> Melt value (spot)        209409.69 INR   spot at 18 Nov 2026, 05:25 UTC, gold-api.com
> Likely offer from buyer  146586.79 to 198939.21 INR   (typical 70 to 95% of melt)
>
> Warnings:
> - No weight was given for stones or other non-metal parts, so the full weight counts as metal and the value may be too high.
>
> Assumed: purity assumed from what you told me; weight from your scale; no stones deducted.
> Not included: making charges, stones, brand or antique value.
>
> This is an estimate from the stated weight and purity, not an appraisal or an offer to buy.
> ```

The figures above came from the hosted server on 18 Nov 2026, with gold at 3795.67 USD per troy ounce and 93.6 INR per USD. Your result uses the rates at the time you ask.

## Why the number differs from a shop rate

Melt value is the international spot price of the pure metal, converted to your currency. It leaves out import duty, sales tax, and the retail margin. A shop's buying or selling rate usually includes some of these, so it is often higher than melt value. In India, shop rates on 17–18 Nov 2026 ran 19–24% above melt value. The gap differs by country and changes over time.

## Estimate, not appraisal

Every result is an estimate from the stated weight and purity, not an appraisal or an offer to buy.

## More

- [PRIVACY.md](PRIVACY.md): what the server receives, logs, and shares.
- [LICENSE](LICENSE): MIT.
- [server/AGENTS.md](server/AGENTS.md): how the server is built, for contributors.
