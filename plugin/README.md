# melt-value plugin

This Claude Code plugin estimates the melt value of gold and silver jewellery in the person's own currency. The person shows a photo or describes a piece, and the assistant asks for the weight, purity, and location one question at a time. The melt-value MCP server computes every number, with its source and time.

## Contents

- `value-jewellery` skill. The guided valuation flow and the result format.
- `hallmark-reference` skill. Purity marks for India, the UK, the Hallmarking Convention, and the US, and the plated or filled marks that mean a piece has no meaningful melt value.
- `/melt-value` command. Starts the valuation with the inputs you type after it.
- `/gold-rate` and `/silver-rate` commands. Show the current price where you are.

## Setup

`.mcp.json` points at the hosted melt-value server at `https://mcp.meltvalue.dev/mcp`.

Every result is an estimate from the stated weight and purity, not an appraisal or an offer to buy.

To test the plugin against a local server, see `test/README.md`.
