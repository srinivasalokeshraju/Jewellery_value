# AGENTS.md

This repository estimates the melt value of gold and silver jewellery. It holds a remote MCP server on Cloudflare Workers and a thin Claude plugin that guides the conversation. The server computes every number. The model computes none.

This file covers workflow and navigation. Package knowledge lives in the package's own `AGENTS.md`.

## Start here

- Before you change a package, read its `AGENTS.md`: [server/AGENTS.md](server/AGENTS.md) or [plugin/AGENTS.md](plugin/AGENTS.md).
- Read a document from the table under "Read when needed" only when your task matches its row.

## Repository map

```
server/                 MCP server, TypeScript, Cloudflare Worker
  src/domain/           units, purity, melt math. Pure functions, no I/O.
  src/rates/            rate providers, validation, cache, fallback chain
  src/tools/            one file per MCP tool, plus shared pricing and card templates
  src/ui/               MCP Apps cards: the browser view and its generated bundle
  scripts/              command-line drivers and benchmarks
  test/                 Vitest tests and recorded provider fixtures
plugin/                 Claude plugin: skills, commands, .mcp.json
  test/                 headless scenario runner and the number checker
.claude-plugin/         marketplace file that installs plugin/ from this repo
docs/plans/             design and build plan
```

## Commands

Run server commands from `server/`. `server/package.json` is the authority.

```
npm ci
npm test            # Vitest, all server tests
npm run typecheck   # tsc, no emit
npm run dev         # local Worker through wrangler
```

Run the plugin checker's tests from the repository root.

```
node --test plugin/test/*.test.mjs
```

Run the linter from the repository root, after `npm ci` in both the root and `server/`. The type-aware rules read `server/node_modules`. `.oxlintrc.json` holds the rules.

```
npm ci
npm run lint
```

A change is ready when `npm run lint`, `npm test`, `npm run typecheck`, and the checker tests all pass. CI runs all four on every pull request, with `.node-version` as the Node version.

## Rules that hold everywhere

- Money and mass math lives only in `server/src/domain/`, on decimals. Never use a JavaScript `number` for arithmetic on money or mass.
- The server returns each figure as a string. Skills, commands, and server instructions must tell the model to copy figures exactly and to add none.
- Every error has `code`, `message`, and `fix`. The `fix` tells the calling agent what to do next.
- Every warning, summary, and tool description must be true for every case that produces it.
- No secret goes in the repository, the plugin, or a response. `.dev.vars` is ignored by git.
- The server logs no weight tied to an identifier, and no name, contact, or image.
- Never deploy the Worker or change `server/wrangler.jsonc` bindings without the owner's approval.

## Read when needed

| When you | Read |
|---|---|
| change code under `server/` | [server/AGENTS.md](server/AGENTS.md) |
| change a skill, a command, or a plugin test | [plugin/AGENTS.md](plugin/AGENTS.md) |
| need the reason for a product or architecture decision | [docs/plans/2026-11-14-jewellery-melt-value-design.md](docs/plans/2026-11-14-jewellery-melt-value-design.md) |
| need the build history or the prototype evidence | [docs/plans/2026-11-14-jewellery-melt-value-plan.md](docs/plans/2026-11-14-jewellery-melt-value-plan.md) |
| run a plugin scenario or read a checker failure | [plugin/test/README.md](plugin/test/README.md) |

## Commits and pull requests

- Work on a branch and open a pull request into `main`. Do not commit to `main`.
- Write the subject as an imperative sentence that states the behaviour change, such as "Refuse a request body over 1 MiB before reading it". A `feat(scope):` or `fix(scope):` prefix is optional. The scopes in use are `domain`, `rates`, `tools`, `server`, and `plugin`.
- Keep one behaviour change per pull request, with the tests that prove it.

## Keeping these files useful

Add a line here only when it applies to every task. Put package detail in the package file, and link to a document instead of copying it.
